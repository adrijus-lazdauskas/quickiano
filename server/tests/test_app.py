"""Tests for the converter API with a fake Audiveris, so they run without Java."""

import importlib
import io
import os
import stat
import sys
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
    def make(script: str, **env: str) -> TestClient:
        monkeypatch.setenv("AUDIVERIS_BIN", fake_audiveris(tmp_path, script))
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        import app

        importlib.reload(app)
        return TestClient(app.app)

    return make


def post(client: TestClient, data: bytes, name: str = "song.pdf"):
    return client.post("/convert", files={"file": (name, data, "application/pdf")})


def test_health(client_for):
    r = client_for("exit 0").get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_returns_the_first_movement(client_for):
    client = client_for('printf one > "$OUT/score.mvt1.mxl"; printf two > "$OUT/score.mvt2.mxl"')
    r = post(client, make_pdf(2))
    assert r.status_code == 200
    assert r.content == b"one"
    assert r.headers["x-pages"] == "2"
    assert r.headers["x-movements"] == "2"


def test_rejects_files_that_are_not_pdfs(client_for):
    r = post(client_for("exit 0"), b"<score-partwise/>", "song.musicxml")
    assert r.status_code == 415


def test_rejects_too_many_pages(client_for):
    r = post(client_for("exit 0", MAX_PAGES="2"), make_pdf(3))
    assert r.status_code == 413
    assert "3 pages" in r.json()["detail"]


def test_reports_when_no_music_was_found(client_for):
    r = post(client_for("exit 0"), make_pdf())
    assert r.status_code == 422


def test_stops_a_conversion_that_takes_too_long(client_for):
    r = post(client_for("sleep 5", TIMEOUT_SECONDS="1"), make_pdf())
    assert r.status_code == 504


def test_allows_the_quickiano_origin(client_for):
    r = client_for("exit 0").get("/", headers={"Origin": "https://quickiano.pages.dev"})
    assert r.headers["access-control-allow-origin"] == "https://quickiano.pages.dev"


def test_ignores_other_origins(client_for):
    r = client_for("exit 0").get("/", headers={"Origin": "https://example.com"})
    assert "access-control-allow-origin" not in r.headers


@pytest.fixture(autouse=True)
def _cwd(monkeypatch):
    monkeypatch.chdir(os.path.dirname(os.path.dirname(__file__)))
