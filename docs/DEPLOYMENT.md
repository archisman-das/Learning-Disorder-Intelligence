# Deployment Guide

## Recommended setup

This repository now includes a production-ready Flask backend in [`web_backend.py`](/d:/Project/Dyslexia_Detection_System/web_backend.py) and a Docker deployment definition in [`Dockerfile`](/d:/Project/Dyslexia_Detection_System/Dockerfile).

The deployment serves:

- the standalone browser dashboard from [`web/`](/d:/Project/Dyslexia_Detection_System/web)
- the local transcription API at `/api/reading-transcribe`
- a health check at `/healthz`

## Best cloud target

The easiest global deployment path is Render using the provided [`render.yaml`](/d:/Project/Dyslexia_Detection_System/render.yaml).

### Steps

1. Push this repository to GitHub.
2. Connect the repo to Render.
3. Let Render build the Docker image.
4. Open the public URL and verify `/healthz` returns `ok`.
5. Test the dashboard microphone workflow from the HTTPS URL.

## Important notes

- Microphone access requires HTTPS or localhost.
- The transcription endpoint depends on `openai-whisper` and `ffmpeg`.
- The first audio request may be slower because the Whisper model is loaded on demand.
- The dashboard itself is mostly client-side, so browser state and records are stored locally in the user session unless you extend the backend further.

## Local run

For local development:

```bash
python run_local_web.py
```

For production-like local testing:

```bash
gunicorn -b 0.0.0.0:10000 web_backend:app
```

