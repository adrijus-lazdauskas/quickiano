"""Quickiano PDF converter.

Turns a printed sheet music PDF into compressed MusicXML (.mxl) with Audiveris,
so Quickiano can open it. A conversion can take minutes, so it runs as a job:
the app uploads the PDF, polls the job and downloads the result. One job runs at
a time; a few more may wait in line. PDFs live in a temporary folder only while
their job runs, results are dropped once downloaded or after 15 minutes, and the
log keeps page counts and timings, nothing else.
"""

import asyncio
import io
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pypdf import PdfReader

AUDIVERIS = os.environ.get("AUDIVERIS_BIN", "/usr/local/bin/audiveris")
MAX_BYTES = int(os.environ.get("MAX_PDF_MB", "20")) * 1024 * 1024
MAX_PAGES = int(os.environ.get("MAX_PAGES", "12"))
TIMEOUT_SECONDS = int(os.environ.get("TIMEOUT_SECONDS", "600"))
MAX_WAITING = int(os.environ.get("MAX_WAITING", "4"))
KEEP_SECONDS = 15 * 60
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://quickiano.pages.dev,http://localhost:5173,http://localhost:5186",
).split(",")


@dataclass
class Job:
    pdf: bytes | None
    pages: int
    status: str = "queued"  # queued → running → done | failed | cancelled
    result: bytes | None = None
    movements: int = 0
    error: str = ""
    seconds: int = 0
    finished: float = 0.0
    proc: asyncio.subprocess.Process | None = field(default=None, repr=False)


jobs: dict[str, Job] = {}
line: list[str] = []
wakeup = asyncio.Event()


@asynccontextmanager
async def lifespan(_: FastAPI):
    worker = asyncio.create_task(work())
    yield
    worker.cancel()


app = FastAPI(title="Quickiano PDF converter", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_origin_regex=r"https://[a-z0-9-]+\.quickiano\.pages\.dev",
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
    expose_headers=["X-Pages", "X-Movements", "X-Seconds"],
)


def running() -> bool:
    return any(j.status == "running" for j in jobs.values())


@app.get("/")
def health() -> dict:
    """Also used by the app to wake the Space up before uploading."""
    return {"status": "ok", "busy": running(), "waiting": len(line), "maxPages": MAX_PAGES}


@app.post("/jobs", status_code=202)
async def create_job(file: UploadFile = File(...)) -> dict:
    forget_old()
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"The PDF is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Please choose a PDF file.")
    try:
        pages = len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        raise HTTPException(422, "This PDF could not be opened. It may be damaged or password protected.")
    if pages > MAX_PAGES:
        raise HTTPException(413, f"This PDF has {pages} pages. The converter takes up to {MAX_PAGES}.")
    if len(line) >= MAX_WAITING:
        raise HTTPException(429, "The converter is busy right now. Please try again in a few minutes.", {"Retry-After": "120"})
    job_id = uuid.uuid4().hex
    jobs[job_id] = Job(pdf=data, pages=pages)
    line.append(job_id)
    wakeup.set()
    return describe(job_id)


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    return describe(job_id)


@app.get("/jobs/{job_id}/result")
def get_result(job_id: str) -> Response:
    job = find(job_id)
    if job.status != "done" or job.result is None:
        raise HTTPException(409, "The conversion is not finished.")
    body = job.result
    jobs.pop(job_id, None)  # one download, then it's gone
    return Response(
        body,
        media_type="application/vnd.recordare.musicxml",
        headers={"X-Pages": str(job.pages), "X-Movements": str(job.movements), "X-Seconds": str(job.seconds)},
    )


@app.delete("/jobs/{job_id}", status_code=204)
def cancel_job(job_id: str) -> Response:
    job = jobs.pop(job_id, None)
    if job:
        if job_id in line:
            line.remove(job_id)
        job.status = "cancelled"
        job.pdf = None
        if job.proc and job.proc.returncode is None:
            job.proc.kill()
    return Response(status_code=204)


def find(job_id: str) -> Job:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "This conversion is unknown or has expired.")
    return job


def describe(job_id: str) -> dict:
    job = find(job_id)
    out = {"id": job_id, "status": job.status, "pages": job.pages}
    if job.status == "queued":
        out["ahead"] = line.index(job_id) + (1 if running() else 0)
    if job.status == "failed":
        out["error"] = job.error
    return out


def forget_old() -> None:
    now = time.monotonic()
    for job_id, job in list(jobs.items()):
        if job.finished and now - job.finished > KEEP_SECONDS:
            jobs.pop(job_id, None)


async def work() -> None:
    """Runs the jobs in line one after another."""
    while True:
        if not line:
            wakeup.clear()
            await wakeup.wait()
            continue
        job_id = line.pop(0)
        job = jobs.get(job_id)
        if not job or job.pdf is None:
            continue
        job.status = "running"
        started = time.monotonic()
        try:
            job.result, job.movements = await run_audiveris(job)
            job.status = "done"
        except ConversionError as e:
            if job.status != "cancelled":
                job.status, job.error = "failed", str(e)
        except Exception:
            job.status, job.error = "failed", "The conversion failed unexpectedly. Please try again."
        finally:
            job.pdf = None
            job.proc = None
            job.seconds = round(time.monotonic() - started)
            job.finished = time.monotonic()
        if job.status in ("done", "failed"):
            print(f"{job.status} pages={job.pages} movements={job.movements} seconds={job.seconds}", flush=True)


class ConversionError(Exception):
    """A failure with a message meant for the user."""


async def run_audiveris(job: Job) -> tuple[bytes, int]:
    """Runs Audiveris in batch mode and returns the first exported .mxl and how many there were."""
    with tempfile.TemporaryDirectory(prefix="omr-") as tmp:
        src = Path(tmp) / "score.pdf"
        out = Path(tmp) / "out"
        src.write_bytes(job.pdf or b"")
        out.mkdir()
        job.proc = await asyncio.create_subprocess_exec(
            AUDIVERIS, "-batch", "-export", "-output", str(out), "--", str(src),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(job.proc.wait(), TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            job.proc.kill()
            await job.proc.wait()
            raise ConversionError("The conversion took too long. Try a PDF with fewer pages.")
        if job.status == "cancelled":
            raise ConversionError("Cancelled.")
        # One file per movement (score.mxl, or score.mvt1.mxl, score.mvt2.mxl, …).
        # Quickiano opens one piece, so the first movement goes back.
        found = sorted(out.rglob("*.mxl"))
        if not found:
            raise ConversionError(
                "No music could be read from this PDF. Clean printed scores work best; "
                "photos, scans with shadows and handwriting rarely do."
            )
        return found[0].read_bytes(), len(found)
