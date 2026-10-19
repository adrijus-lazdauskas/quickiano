"""Shared pieces of the PDF converter: checking uploads and running Audiveris."""

import io
import os
import subprocess
import tempfile
from pathlib import Path

from pypdf import PdfReader

AUDIVERIS = os.environ.get("AUDIVERIS_BIN", "/usr/local/bin/audiveris")
MAX_BYTES = int(os.environ.get("MAX_PDF_MB", "20")) * 1024 * 1024
MAX_PAGES = int(os.environ.get("MAX_PAGES", "12"))
TIMEOUT_SECONDS = int(os.environ.get("TIMEOUT_SECONDS", "600"))

NO_MUSIC = (
    "No music could be read from this PDF. Clean printed scores work best; "
    "photos, scans with shadows and handwriting rarely do."
)
TOO_LONG = "The conversion took too long. Try a PDF with fewer pages."


class ConversionError(Exception):
    """A failure with a message meant for the user and the HTTP status that fits it."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def check_pdf(data: bytes) -> int:
    """Validates an upload and returns its page count."""
    if len(data) > MAX_BYTES:
        raise ConversionError(f"The PDF is larger than {MAX_BYTES // (1024 * 1024)} MB.", 413)
    if not data.startswith(b"%PDF"):
        raise ConversionError("Please choose a PDF file.", 415)
    try:
        pages = len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        raise ConversionError("This PDF could not be opened. It may be damaged or password protected.", 422)
    if pages > MAX_PAGES:
        raise ConversionError(f"This PDF has {pages} pages. The converter takes up to {MAX_PAGES}.", 413)
    return pages


def audiveris_args(src: Path, out: Path) -> list[str]:
    return [AUDIVERIS, "-batch", "-export", "-output", str(out), "--", str(src)]


def pick_result(out: Path) -> tuple[bytes, int]:
    """Audiveris writes one .mxl per movement (score.mxl, or score.mvt1.mxl, …).
    Quickiano opens one piece, so the first one goes back, with the count."""
    found = sorted(out.rglob("*.mxl"))
    if not found:
        raise ConversionError(NO_MUSIC, 422)
    return found[0].read_bytes(), len(found)


def convert_blocking(pdf: bytes, timeout: int = TIMEOUT_SECONDS) -> tuple[bytes, int]:
    """Runs Audiveris to the end; used where each conversion has its own container."""
    with tempfile.TemporaryDirectory(prefix="omr-") as tmp:
        src = Path(tmp) / "score.pdf"
        out = Path(tmp) / "out"
        src.write_bytes(pdf)
        out.mkdir()
        try:
            subprocess.run(
                audiveris_args(src, out),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise ConversionError(TOO_LONG, 504)
        return pick_result(out)
