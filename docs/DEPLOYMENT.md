# Deployment Guide

## Recommended setup

This repository now includes a production-ready Flask backend in [`web_backend.py`](/d:/Project/Dyslexia_Detection_System/web_backend.py) and a Docker deployment definition in [`Dockerfile`](/d:/Project/Dyslexia_Detection_System/Dockerfile).

The deployment serves:

- the standalone browser dashboard from [`web/`](/d:/Project/Dyslexia_Detection_System/web)
- the local transcription API at `/api/reading-transcribe`
- a health check at `/healthz`

## Deployment Options

The project now includes configuration for three common hosting paths:

| Platform | File | Best for |
|---|---|---|
| Render | [`render.yaml`](/d:/Project/Dyslexia_Detection_System/render.yaml) | Simple Docker deployment with automatic HTTPS |
| Railway | [`railway.json`](/d:/Project/Dyslexia_Detection_System/railway.json) | Fast app deployment from GitHub |
| Fly.io | [`fly.toml`](/d:/Project/Dyslexia_Detection_System/fly.toml) | Global app hosting with region control |

## Live Deployment

Current public demo:

- [https://learning-disorder-intelligence.onrender.com/](https://learning-disorder-intelligence.onrender.com/)

### Render

Render is the simplest path if you want a quick public URL.

Steps:

1. Push this repository to GitHub.
2. Connect the repo to Render.
3. Let Render build the Docker image.
4. Open the public URL and verify `/healthz` returns `ok`.
5. Test the dashboard microphone workflow from the HTTPS URL.

### Railway

Railway works well if you want a quick Git-based deploy with a Dockerfile.

Steps:

1. Push this repository to GitHub.
2. Create a Railway project from the repo.
3. Railway should use [`railway.json`](/d:/Project/Dyslexia_Detection_System/railway.json) and [`Dockerfile`](/d:/Project/Dyslexia_Detection_System/Dockerfile).
4. Confirm the service exposes the app on the assigned `$PORT`.
5. Visit `/healthz` and then open the public dashboard URL.

### Fly.io

Fly is a strong choice if you want region-aware global deployment.

Steps:

1. Install `flyctl`.
2. Run `fly launch` or reuse the included [`fly.toml`](/d:/Project/Dyslexia_Detection_System/fly.toml).
3. Deploy with `fly deploy`.
4. Confirm the app is reachable over HTTPS and `/healthz` responds successfully.
5. Open the dashboard and test the microphone workflow.

## Important notes

- Microphone access requires HTTPS or localhost.
- The transcription endpoint depends on `openai-whisper` and `ffmpeg`.
- The first audio request may be slower because the Whisper model is loaded on demand.
- The dashboard itself is mostly client-side, so browser state and records are stored locally in the user session unless you extend the backend further.
- For Fly.io, the app is configured to listen on port `10000` and expose `/healthz` as a health check.

## Local run

For local development:

```bash
python run_local_web.py
```

For production-like local testing:

```bash
gunicorn -b 0.0.0.0:10000 web_backend:app
```
