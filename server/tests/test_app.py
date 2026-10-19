"""Tests for the local converter server with a fake Audiveris, so they run without Java."""

import importlib
import io
import stat
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def make_pdf(pages: int = 1) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def fake_audiveris(tmp_path: Path, script: str) -> str:
    """A stand-in launcher; `$OUT` is the -output folder Audiveris would write to."""
    path = tmp_path / "audiveris"
    path.write_text('#!/bin/sh\nOUT="$4"\n' + script + "\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


@pytest.fixture
def client_for(tmp_path, monkeypatch):
    clients = []

    def make(script: str, **env: str) -> TestClient:
        monkeypatch.setenv("AUDIVERIS_BIN", fake_audiveris(tmp_path, script))
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        import app
        import convert

        # convert reads the settings from the environment; app builds a fresh backend.
        for module in (convert, app):
            importlib.reload(module)
        client = TestClient(app.app)
        client.__enter__()  # runs the lifespan, which starts the worker
        clients.append(client)
        return client

    yield make
    for c in clients:
        c.__exit__(None, None, None)


def upload(client: TestClient, data: bytes, name: str = "song.pdf"):
    return client.post("/jobs", files={"file": (name, data, "application/pdf")})


def wait_for(client: TestClient, job_id: str, timeout: float = 10) -> dict:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_health(client_for):
    r = client_for("exit 0").get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_converts_and_returns_the_first_movement_once(client_for):
    client = client_for('printf one > "$OUT/score.mvt1.mxl"; printf two > "$OUT/score.mvt2.mxl"')
    r = upload(client, make_pdf(2))
    assert r.status_code == 202
    job = wait_for(client, r.json()["id"])
    assert job["status"] == "done"
    res = client.get(f"/jobs/{job['id']}/result")
    assert res.content == b"one"
    assert res.headers["x-pages"] == "2"
    assert res.headers["x-movements"] == "2"
    assert client.get(f"/jobs/{job['id']}").status_code == 404


def test_rejects_files_that_are_not_pdfs(client_for):
    assert upload(client_for("exit 0"), b"<score-partwise/>", "song.musicxml").status_code == 415


def test_rejects_too_many_pages(client_for):
    r = upload(client_for("exit 0", MAX_PAGES="2"), make_pdf(3))
    assert r.status_code == 413
    assert "3 pages" in r.json()["detail"]


def test_reports_when_no_music_was_found(client_for):
    client = client_for("exit 0")
    job = wait_for(client, upload(client, make_pdf()).json()["id"])
    assert job["status"] == "failed"
    assert "No music" in job["error"]


def test_stops_a_conversion_that_takes_too_long(client_for):
    client = client_for("sleep 5", TIMEOUT_SECONDS="1")
    job = wait_for(client, upload(client, make_pdf()).json()["id"])
    assert job["status"] == "failed"
    assert "too long" in job["error"]


def test_queues_jobs_and_cancels_them(client_for):
    client = client_for('sleep 1; printf x > "$OUT/score.mxl"')
    first = upload(client, make_pdf()).json()["id"]
    second = upload(client, make_pdf()).json()
    assert second["status"] == "queued"
    assert second["ahead"] == 1
    assert client.delete(f"/jobs/{second['id']}").status_code == 204
    assert client.get(f"/jobs/{second['id']}").status_code == 404
    assert wait_for(client, first)["status"] == "done"


def test_turns_people_away_when_the_line_is_full(client_for):
    client = client_for("sleep 2", MAX_WAITING="1")
    upload(client, make_pdf())  # starts running
    time.sleep(0.2)
    upload(client, make_pdf())  # waits
    assert upload(client, make_pdf()).status_code == 429


def test_allows_the_quickiano_origin(client_for):
    r = client_for("exit 0").get("/", headers={"Origin": "https://quickiano.pages.dev"})
    assert r.headers["access-control-allow-origin"] == "https://quickiano.pages.dev"


def test_ignores_other_origins(client_for):
    r = client_for("exit 0").get("/", headers={"Origin": "https://example.com"})
    assert "access-control-allow-origin" not in r.headers
