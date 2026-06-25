# Release Notes

## Current Public Deployment

- Live demo: https://learning-disorder-intelligence.onrender.com/
- Hosting platform: Render
- Auto-deploy: enabled through `render.yaml`

## Current Repository State

The repository is configured to deploy from the `main` branch when the connected Render service is linked to this GitHub repo.

## Recent Release Highlights

- Documentation now reflects the learning-disorder framing and the current three-model comparison set
- Standalone web dashboard workflow updates
- Bengali and English language consistency fixes
- Speech therapy and screening flow improvements
- Render deployment documentation and troubleshooting notes

## Verification

- Health check endpoint: `/healthz`
- Backend entrypoint: `web_backend.py`
- Container start command: `gunicorn -b 0.0.0.0:10000 web_backend:app`
