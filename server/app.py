"""Quickiano PDF converter.

Turns a printed sheet music PDF into compressed MusicXML (.mxl) with Audiveris,
so Quickiano can open it. One conversion runs at a time; a few more may wait.
Uploaded files live in a temporary folder only for the conversion and are
deleted right after. Nothing is stored or logged except page counts and timings.
"""

import asyncio
import io
import os
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pypdf import PdfReader

AUDIVERIS = os.environ.get("AUDIVERIS_BIN", "/usr/local/bin/audiveris")
MAX_BYTES = int(os.environ.get("MAX_PDF_MB", "20")) * 1024 * 1024
MAX_PAGES = int(os.environ.get("MAX_PAGES", "12"))
TIMEOUT_SECONDS = int(os.environ.get("TIMEOUT_SECONDS", "480"))
MAX_WAITING = int(os.environ.get("MAX_WAITING", "4"))
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://quickiano.pages.dev,http://localhost:5173,http://localhost:5186",
).split(",")

app = FastAPI(title="Quickiano PDF converter", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_origin_regex=r"https://[a-z0-9-]+\.quickiano\.pages\.dev",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-Pages", "X-Movements", "X-Seconds"],
)

slot = asyncio.Semaphore(1)
state = {"waiting": 0}


@app.get("/")
def health() -> dict:
    """Also used by the app to wake the Space up before uploading."""
    return {"status": "ok", "busy": slot.locked(), "waiting": state["waiting"], "maxPages": MAX_PAGES}


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> Response:
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

    if state["waiting"] >= MAX_WAITING:
        raise HTTPException(429, "The converter is busy right now. Please try again in a minute.", {"Retry-After": "60"})
    state["waiting"] += 1
    try:
        await slot.acquire()
    finally:
        state["waiting"] -= 1
    try:
        started = time.monotonic()
        body, movements = await run_audiveris(data)
        seconds = round(time.monotonic() - started)
        print(f"converted pages={pages} movements={movements} seconds={seconds}", flush=True)
        return Response(
            body,
            media_type="application/vnd.recordare.musicxml",
            headers={"X-Pages": str(pages), "X-Movements": str(movements), "X-Seconds": str(seconds)},
        )
    finally:
        slot.release()


async def run_audiveris(pdf: bytes) -> tuple[bytes, int]:
    """Runs Audiveris in batch mode and returns the first exported .mxl and how many there were."""
    with tempfile.TemporaryDirectory(prefix="omr-") as tmp:
        src = Path(tmp) / "score.pdf"
        out = Path(tmp) / "out"
        src.write_bytes(pdf)
        out.mkdir()
        proc = await asyncio.create_subprocess_exec(
            AUDIVERIS, "-batch", "-export", "-output", str(out), "--", str(src),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(proc.wait(), TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise HTTPException(504, "The conversion took too long. Try a PDF with fewer pages.")
        # One file per movement (score.mxl, or score.mvt1.mxl, score.mvt2.mxl, …).
        # Quickiano opens one piece, so the first movement goes back.
        found = sorted(out.rglob("*.mxl"))
        if not found:
            raise HTTPException(
                422,
                "No music could be read from this PDF. Clean printed scores work best; "
                "photos, scans with shadows and handwriting rarely do.",
            )
        return found[0].read_bytes(), len(found)
