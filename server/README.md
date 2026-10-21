# Quickiano PDF converter

Turns a printed sheet music PDF into compressed MusicXML (`.mxl`) with [Audiveris](https://github.com/Audiveris/audiveris), so [Quickiano](https://quickiano.pages.dev/) can open it.

The public converter runs on [Modal](https://modal.com): every conversion gets its own container with Audiveris, which stops when it is done, so it only uses credits while someone converts a PDF. The same API also runs as one local server for development or self-hosting with Docker.

| File               | What it is                                             |
| ------------------ | ------------------------------------------------------ |
| `api.py`           | The HTTP API, shared by both ways of running it        |
| `convert.py`       | Upload checks and the Audiveris call                   |
| `modal_app.py`     | The Modal deployment (`modal deploy modal_app.py`)     |
| `modal_backend.py` | Jobs as Modal function calls                           |
| `app.py`           | Jobs in one in-process queue, for local use and Docker |
| `Dockerfile`       | Self-hosting image for `app.py`                        |

## API

A conversion can take minutes, so it runs as a job:

- `GET /`: health check, `{"status": "ok", "busy": false, "waiting": 0, "maxPages": 12}`. Quickiano calls it first to wake a sleeping server.
- `POST /jobs`: multipart form with a `file` field (the PDF). Answers `202` with `{"id": "…", "status": "queued" | "running", "pages": 4}`, or an error `{"detail": "…"}`: 411 (no size given), 413 (too big or too many pages), 415 (not a PDF), 422 (unreadable PDF), 429 (too busy, or too many PDFs from one address within an hour).
- `GET /jobs/{id}`: `status` is `queued` (with `ahead`), `running`, `done` or `failed` (with `error`).
- `GET /jobs/{id}/result`: the `.mxl`, with the headers `X-Pages`, `X-Movements` (Audiveris exports one file per movement; the first one is returned) and `X-Seconds`.
- `DELETE /jobs/{id}`: cancels a job.

PDFs exist only in a temporary folder while their job runs. Logs keep page counts and timings, nothing else.

## Deploy to Modal

The `Converter` GitHub workflow tests the code and deploys it on every change in `server/`. It needs two repository secrets, `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (modal.com → Settings → API Tokens → New Token). The deploy step prints the address as a notice; it looks like `https://<workspace>--quickiano-converter.modal.run`.

By hand:

```bash
pip install modal && modal token new
modal deploy modal_app.py
```

At most three conversions run at once (`max_containers=3` on `transcribe`), each with 2 CPUs and 6 GB of memory for up to 15 minutes.

## Run it locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
AUDIVERIS_BIN=/Applications/Audiveris.app/Contents/MacOS/Audiveris .venv/bin/uvicorn app:app --port 7860
```

Then start Quickiano with `VITE_CONVERTER_URL=http://localhost:7860 npm run dev`. For titles and texts, point `TESSDATA_PREFIX` to a folder with `eng.traineddata` from [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata) (the full model, not `tessdata_fast`).

## Self-host with Docker

```bash
docker build -t quickiano-converter .
docker run -p 7860:7860 quickiano-converter
```

The machine needs about 4 GB of free memory. Build Quickiano with `VITE_CONVERTER_URL` set to your server's address, and add your site to `ALLOWED_ORIGINS`.

## Settings (environment variables)

| Variable          | Default                    | Meaning                                                      |
| ----------------- | -------------------------- | ------------------------------------------------------------ |
| `MAX_PDF_MB`      | `20`                       | Largest accepted PDF                                         |
| `MAX_PAGES`       | `12`                       | Most pages per PDF                                           |
| `TIMEOUT_SECONDS` | `600`                      | Stop a conversion after this long                            |
| `MAX_WAITING`     | `4`                        | Local server only: jobs that may queue before it answers 429 |
| `JOBS_PER_HOUR`   | `10`                       | Conversions per visitor address and hour, `0` for no limit   |
| `ALLOWED_ORIGINS` | Quickiano and local dev    | Comma-separated origins allowed by CORS                      |
| `AUDIVERIS_BIN`   | `/usr/local/bin/audiveris` | Audiveris launcher                                           |

## Licenses

This code is MIT licensed like Quickiano. Audiveris is AGPL-3.0 and runs unmodified as a separate program; its source is at https://github.com/Audiveris/audiveris. The OCR model comes from [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata) (Apache-2.0).
