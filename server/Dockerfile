# Quickiano PDF converter as one self-hosted server: Audiveris behind the job API (app.py).
# The public converter runs on Modal instead (modal_app.py); this image is for running it yourself.
# docker build -t quickiano-converter . && docker run -p 7860:7860 quickiano-converter
FROM ubuntu:24.04

ARG AUDIVERIS_VERSION=5.11.0
ENV DEBIAN_FRONTEND=noninteractive

# Audiveris ships as a .deb with its own Java runtime. Fonts are needed for headless Java.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-venv fontconfig fonts-dejavu-core \
 && curl -fsSL -o /tmp/audiveris.deb \
    "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb" \
 && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
 && rm -f /tmp/audiveris.deb \
 && rm -rf /var/lib/apt/lists/* \
 && bin="$(find /opt /usr -type f -name Audiveris -path '*/bin/*' | head -n 1)" \
 && test -n "$bin" \
 && ln -s "$bin" /usr/local/bin/audiveris

# OCR for titles and texts. Audiveris uses the legacy Tesseract engine, so this must be
# the full model from tesseract-ocr/tessdata (not tessdata_fast).
RUN mkdir -p /opt/tessdata \
 && curl -fsSL -o /opt/tessdata/eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
ENV TESSDATA_PREFIX=/opt/tessdata \
    JAVA_TOOL_OPTIONS="-Djava.awt.headless=true -Xmx8g"

# Run as an unprivileged user; Ubuntu's default user already has uid 1000.
RUN userdel -r ubuntu && useradd -m -u 1000 user
USER user
ENV HOME=/home/user
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN python3 -m venv /home/user/venv && /home/user/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY --chown=user app.py api.py convert.py ./

EXPOSE 7860
CMD ["/home/user/venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
