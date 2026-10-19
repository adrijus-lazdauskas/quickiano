"""Tests for the Modal job backend with stand-ins for Modal's calls."""

import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import create_api  # noqa: E402
from modal_backend import ModalBackend  # noqa: E402


class NotReady(Exception):
    pass


class Expired(Exception):
    pass


def pdf() -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


class FakeModal:
    """Remembers spawned calls; `outputs` decides what polling a call returns."""

    def __init__(self):
        self.outputs: dict[str, object] = {}
        self.stopped: list[str] = []

    async def submit(self, data: bytes, pages: int) -> str:
        job_id = f"fc-{len(self.outputs) + 1}"
        self.outputs[job_id] = NotReady()
        return job_id

    async def poll(self, job_id: str) -> dict:
        out = self.outputs.get(job_id, Expired())
        if isinstance(out, Exception):
            raise out
        return out

    async def stop(self, job_id: str) -> None:
        self.stopped.append(job_id)

    @staticmethod
    def classify(e: Exception):
        return "running" if isinstance(e, NotReady) else "expired" if isinstance(e, Expired) else "failed"


@pytest.fixture
def setup():
    fake = FakeModal()
    backend = ModalBackend(submit=fake.submit, poll=fake.poll, stop=fake.stop, classify=fake.classify)
    return fake, TestClient(create_api(backend))


def upload(client):
    return client.post("/jobs", files={"file": ("song.pdf", pdf(), "application/pdf")})


def test_a_new_job_is_running(setup):
    _, client = setup
    r = upload(client)
    assert r.status_code == 202
    assert r.json() == {"id": "fc-1", "pages": 1, "status": "running"}


def test_finished_jobs_return_their_musicxml(setup):
    fake, client = setup
    job_id = upload(client).json()["id"]
    fake.outputs[job_id] = {"ok": True, "mxl": b"MXL", "pages": 1, "movements": 2, "seconds": 40}
    assert client.get(f"/jobs/{job_id}").json()["status"] == "done"
    r = client.get(f"/jobs/{job_id}/result")
    assert r.content == b"MXL"
    assert r.headers["x-movements"] == "2"
    assert r.headers["x-seconds"] == "40"


def test_failed_jobs_carry_the_reason(setup):
    fake, client = setup
    job_id = upload(client).json()["id"]
    fake.outputs[job_id] = {"ok": False, "error": "No music could be read from this PDF."}
    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "failed"
    assert job["error"].startswith("No music")
    assert client.get(f"/jobs/{job_id}/result").status_code == 409


def test_crashed_calls_fail_with_a_general_message(setup):
    fake, client = setup
    job_id = upload(client).json()["id"]
    fake.outputs[job_id] = RuntimeError("container died")
    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "failed"
    assert "unexpectedly" in job["error"]


def test_unknown_jobs_are_404(setup):
    _, client = setup
    assert client.get("/jobs/fc-404").status_code == 404
    assert client.get("/jobs/fc-404/result").status_code == 404


def test_unfinished_results_are_409(setup):
    _, client = setup
    job_id = upload(client).json()["id"]
    assert client.get(f"/jobs/{job_id}/result").status_code == 409


def test_cancel_stops_the_call(setup):
    fake, client = setup
    job_id = upload(client).json()["id"]
    assert client.delete(f"/jobs/{job_id}").status_code == 204
    assert fake.stopped == [job_id]


def test_uploads_are_checked_before_spawning(setup):
    fake, client = setup
    r = client.post("/jobs", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 415
    assert fake.outputs == {}
