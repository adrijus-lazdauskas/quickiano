---
title: Quickiano PDF converter
emoji: 🎹
colorFrom: pink
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Turns sheet music PDFs into MusicXML for Quickiano
---

# Quickiano PDF converter

A small service that turns a printed sheet music PDF into compressed MusicXML (`.mxl`) with [Audiveris](https://github.com/Audiveris/audiveris), so [Quickiano](https://quickiano.pages.dev/) can open it. It runs as a free [Hugging Face Space](https://huggingface.co/docs/hub/spaces-sdks-docker) and is deployed from the [Quickiano repo](https://github.com/adrijus-lazdauskas/quickiano) by the `Converter` workflow.

## API

- `GET /`: health check, `{"status": "ok", "busy": false, "waiting": 0, "maxPages": 12}`. Quickiano calls it first to wake a sleeping Space.
- `POST /convert`: multipart form with a `file` field (the PDF). Returns the `.mxl` with the headers `X-Pages`, `X-Movements` (Audiveris exports one file per movement; the first one is returned) and `X-Seconds`. Errors come back as `{"detail": "…"}` with 413 (too big or too many pages), 415 (not a PDF), 422 (no music found), 429 (busy), 504 (took too long).

One conversion runs at a time and up to four more may wait. Files are written to a temporary folder for the conversion only and deleted right after; the log keeps page counts and timings, nothing else.

## Settings (environment variables)

| Variable          | Default                    | Meaning                                                  |
| ----------------- | -------------------------- | -------------------------------------------------------- |
| `MAX_PDF_MB`      | `20`                       | Largest accepted PDF                                     |
| `MAX_PAGES`       | `12`                       | Most pages per PDF                                       |
| `TIMEOUT_SECONDS` | `480`                      | Stop a conversion after this long                        |
| `MAX_WAITING`     | `4`                        | Requests that may queue before the converter answers 429 |
| `ALLOWED_ORIGINS` | Quickiano and local dev    | Comma-separated origins allowed by CORS                  |
| `AUDIVERIS_BIN`   | `/usr/local/bin/audiveris` | Audiveris launcher                                       |

## Run it locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
AUDIVERIS_BIN=/Applications/Audiveris.app/Contents/MacOS/Audiveris .venv/bin/uvicorn app:app --port 7860
```

Then start Quickiano with `VITE_CONVERTER_URL=http://localhost:7860 npm run dev`.

## Licenses

This wrapper is MIT licensed like Quickiano. Audiveris is AGPL-3.0 and runs unmodified as a separate program; its source is at https://github.com/Audiveris/audiveris. The OCR model comes from [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata) (Apache-2.0).
