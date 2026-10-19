"""Quickiano PDF converter on Modal (https://modal.com).

Deploy: modal deploy modal_app.py
The web API lives at https://<workspace>--quickiano-converter.modal.run and every
conversion runs in its own container with Audiveris, which stops when it is done.
Containers only run, and cost credits, while someone converts a PDF.
"""

import time

import modal

AUDIVERIS_VERSION = "5.11.0"
AUDIVERIS_DEB = (
    f"https://github.com/Audiveris/audiveris/releases/download/{AUDIVERIS_VERSION}/"
    f"Audiveris-{AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb"
)

app = modal.App("quickiano-converter")

# Audiveris ships as a .deb with its own Java runtime. Its install script registers a desktop
# menu entry, which fails on a server, so the package is only unpacked and its libraries are
# installed by hand (its Depends list without xdg-utils). The OCR model must be the full one
# from tesseract-ocr/tessdata, because Audiveris uses the legacy Tesseract engine.
AUDIVERIS_LIBS = ["libasound2t64", "libbsd0", "libx11-6", "libxext6", "libxi6", "libxrender1", "libxtst6", "zlib1g"]

worker_image = (
    modal.Image.from_registry("ubuntu:24.04", add_python="3.12")
    .apt_install("ca-certificates", "curl", "fontconfig", "fonts-dejavu-core", *AUDIVERIS_LIBS)
    .run_commands(
        f"curl -fsSL -o /tmp/audiveris.deb {AUDIVERIS_DEB}"
        " && dpkg-deb -x /tmp/audiveris.deb / && rm -f /tmp/audiveris.deb"
        " && test -x /opt/audiveris/bin/Audiveris"
        " && ln -s /opt/audiveris/bin/Audiveris /usr/local/bin/audiveris",
        "mkdir -p /opt/tessdata && curl -fsSL -o /opt/tessdata/eng.traineddata"
        " https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata",
    )
    .pip_install("pypdf==6.21.1")
    .env(
        {
            "AUDIVERIS_BIN": "/usr/local/bin/audiveris",
            "TESSDATA_PREFIX": "/opt/tessdata",
            "JAVA_TOOL_OPTIONS": "-Djava.awt.headless=true -Xmx4g",
        }
    )
    .add_local_python_source("convert")
)

web_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi==0.148.0", "python-multipart==0.0.32", "pypdf==6.21.1")
    .add_local_python_source("api", "convert", "modal_backend")
)


# At most three conversions at once keeps the free monthly credits safe.
@app.function(image=worker_image, cpu=2.0, memory=6144, timeout=900, max_containers=3)
def transcribe(pdf: bytes, pages: int) -> dict:
    from convert import ConversionError, convert_blocking

    started = time.monotonic()
    try:
        mxl, movements = convert_blocking(pdf)
    except ConversionError as e:
        print(f"failed pages={pages}", flush=True)
        return {"ok": False, "error": str(e)}
    seconds = round(time.monotonic() - started)
    print(f"done pages={pages} movements={movements} seconds={seconds}", flush=True)
    return {"ok": True, "mxl": mxl, "pages": pages, "movements": movements, "seconds": seconds}


@app.function(image=web_image, max_containers=1)
@modal.concurrent(max_inputs=100)
@modal.asgi_app(label="quickiano-converter")
def web():
    from api import create_api
    from modal_backend import ModalBackend

    async def submit(pdf: bytes, pages: int) -> str:
        call = await transcribe.spawn.aio(pdf, pages)
        return call.object_id

    async def poll(job_id: str) -> dict:
        call = await modal.FunctionCall.from_id.aio(job_id)
        return await call.get.aio(timeout=0)

    async def stop(job_id: str) -> None:
        call = await modal.FunctionCall.from_id.aio(job_id)
        await call.cancel.aio(terminate_containers=True)

    def classify(e: Exception):
        if isinstance(e, (modal.exception.OutputExpiredError, modal.exception.NotFoundError)):
            return "expired"
        # get(timeout=0) on an unfinished call raises the plain Modal TimeoutError;
        # its subclasses mean the function itself timed out or failed.
        if type(e) is modal.exception.TimeoutError:
            return "running"
        return "failed"

    return create_api(ModalBackend(submit=submit, poll=poll, stop=stop, classify=classify))
