"""HTTP API of the PDF converter.

The same endpoints serve the local server (app.py, one in-process queue) and the
hosted one on Modal (modal_app.py, one container per conversion). A conversion
can take minutes, so it runs as a job: upload, poll, download.
"""

import os
from typing import Protocol

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

import convert

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://quickiano.pages.dev,http://localhost:5173,http://localhost:5186",
).split(",")


class Busy(Exception):
    """Too many conversions are waiting already."""


class Unknown(Exception):
    """No such job, or it has expired."""


class NotFinished(Exception):
    """The job has no result yet."""


class Backend(Protocol):
    def health(self) -> dict: ...

    async def submit(self, pdf: bytes, pages: int) -> str: ...

    async def status(self, job_id: str) -> dict:
        """{"status": "queued" | "running" | "done" | "failed", "ahead"?: int, "error"?: str}"""
        ...

    async def result(self, job_id: str) -> tuple[bytes, int, int, int]:
        """(mxl, pages, movements, seconds)"""
        ...

    async def cancel(self, job_id: str) -> None: ...


def create_api(backend: Backend, lifespan=None) -> FastAPI:
    app = FastAPI(
        title="Quickiano PDF converter", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
        allow_origin_regex=r"https://[a-z0-9-]+\.quickiano\.pages\.dev",
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
        expose_headers=["X-Pages", "X-Movements", "X-Seconds"],
    )

    @app.get("/")
    def health() -> dict:
        """Also used by the app to wake a sleeping server before uploading."""
        return {"status": "ok", **backend.health(), "maxPages": convert.MAX_PAGES}

    @app.post("/jobs", status_code=202)
    async def create_job(file: UploadFile = File(...)) -> dict:
        data = await file.read(convert.MAX_BYTES + 1)
        try:
            pages = convert.check_pdf(data)
        except convert.ConversionError as e:
            raise HTTPException(e.status, str(e))
        try:
            job_id = await backend.submit(data, pages)
        except Busy:
            raise HTTPException(
                429, "The converter is busy right now. Please try again in a few minutes.", {"Retry-After": "120"}
            )
        return {"id": job_id, "pages": pages, **(await job_status(job_id))}

    async def job_status(job_id: str) -> dict:
        try:
            return await backend.status(job_id)
        except Unknown:
            raise HTTPException(404, "This conversion is unknown or has expired.")

    @app.get("/jobs/{job_id}")
    async def get_job(job_id: str) -> dict:
        return {"id": job_id, **(await job_status(job_id))}

    @app.get("/jobs/{job_id}/result")
    async def get_result(job_id: str) -> Response:
        try:
            body, pages, movements, seconds = await backend.result(job_id)
        except Unknown:
            raise HTTPException(404, "This conversion is unknown or has expired.")
        except NotFinished:
            raise HTTPException(409, "The conversion is not finished.")
        return Response(
            body,
            media_type="application/vnd.recordare.musicxml",
            headers={"X-Pages": str(pages), "X-Movements": str(movements), "X-Seconds": str(seconds)},
        )

    @app.delete("/jobs/{job_id}", status_code=204)
    async def cancel_job(job_id: str) -> Response:
        await backend.cancel(job_id)
        return Response(status_code=204)

    return app
