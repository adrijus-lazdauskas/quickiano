"""Quickiano PDF converter as a single server: for local development and self-hosting with Docker.

Jobs wait in one in-process line and run one at a time. PDFs live in a temporary
folder only while their job runs, results are dropped once downloaded or after
15 minutes, and the log keeps page counts and timings, nothing else.

Run: AUDIVERIS_BIN=/path/to/Audiveris uvicorn app:app --port 7860
"""

import asyncio
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

import convert
from api import Busy, NotFinished, Unknown, create_api

MAX_WAITING = int(os.environ.get("MAX_WAITING", "4"))
KEEP_SECONDS = 15 * 60
UNEXPECTED = "The conversion failed unexpectedly. Please try again."


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


class LocalBackend:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.line: list[str] = []
        self.wakeup = asyncio.Event()

    @asynccontextmanager
    async def lifespan(self, _app):
        worker = asyncio.create_task(self.work())
        yield
        worker.cancel()

    def running(self) -> bool:
        return any(j.status == "running" for j in self.jobs.values())

    def health(self) -> dict:
        return {"busy": self.running(), "waiting": len(self.line)}

    async def submit(self, pdf: bytes, pages: int) -> str:
        self.forget_old()
        if len(self.line) >= MAX_WAITING:
            raise Busy()
        job_id = uuid.uuid4().hex
        self.jobs[job_id] = Job(pdf=pdf, pages=pages)
        self.line.append(job_id)
        self.wakeup.set()
        return job_id

    def find(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if not job:
            raise Unknown()
        return job

    async def status(self, job_id: str) -> dict:
        job = self.find(job_id)
        out: dict = {"status": job.status}
        if job.status == "queued":
            out["ahead"] = self.line.index(job_id) + (1 if self.running() else 0)
        if job.status == "failed":
            out["error"] = job.error
        return out

    async def result(self, job_id: str) -> tuple[bytes, int, int, int]:
        job = self.find(job_id)
        if job.status != "done" or job.result is None:
            raise NotFinished()
        self.jobs.pop(job_id, None)  # one download, then it's gone
        return job.result, job.pages, job.movements, job.seconds

    async def cancel(self, job_id: str) -> None:
        job = self.jobs.pop(job_id, None)
        if not job:
            return
        if job_id in self.line:
            self.line.remove(job_id)
        job.status = "cancelled"
        job.pdf = None
        if job.proc and job.proc.returncode is None:
            job.proc.kill()

    def forget_old(self) -> None:
        now = time.monotonic()
        for job_id, job in list(self.jobs.items()):
            if job.finished and now - job.finished > KEEP_SECONDS:
                self.jobs.pop(job_id, None)

    async def work(self) -> None:
        """Runs the jobs in line one after another."""
        while True:
            if not self.line:
                self.wakeup.clear()
                await self.wakeup.wait()
                continue
            job = self.jobs.get(self.line.pop(0))
            if not job or job.pdf is None:
                continue
            job.status = "running"
            started = time.monotonic()
            try:
                job.result, job.movements = await self.run(job)
                job.status = "done"
            except convert.ConversionError as e:
                if job.status != "cancelled":
                    job.status, job.error = "failed", str(e)
            except Exception:
                job.status, job.error = "failed", UNEXPECTED
            finally:
                job.pdf = None
                job.proc = None
                job.seconds = round(time.monotonic() - started)
                job.finished = time.monotonic()
            if job.status in ("done", "failed"):
                print(f"{job.status} pages={job.pages} movements={job.movements} seconds={job.seconds}", flush=True)

    async def run(self, job: Job) -> tuple[bytes, int]:
        """Like convert.convert_blocking, but in the background and killable by cancel()."""
        with tempfile.TemporaryDirectory(prefix="omr-") as tmp:
            src = Path(tmp) / "score.pdf"
            out = Path(tmp) / "out"
            src.write_bytes(job.pdf or b"")
            out.mkdir()
            job.proc = await asyncio.create_subprocess_exec(
                *convert.audiveris_args(src, out),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await asyncio.wait_for(job.proc.wait(), convert.TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                job.proc.kill()
                await job.proc.wait()
                raise convert.ConversionError(convert.TOO_LONG, 504)
            if job.status == "cancelled":
                raise convert.ConversionError("Cancelled.")
            return convert.pick_result(out)


backend = LocalBackend()
app = create_api(backend, lifespan=backend.lifespan)
