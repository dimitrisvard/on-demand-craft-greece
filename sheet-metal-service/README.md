# sheet-metal-service

FastAPI micro-service that unfolds STEP sheet-metal parts into 2D flat
patterns (DXF + SVG) using OpenCascade via the OCP / CadQuery Python
bindings.

Endpoints:

| Method | Path                       | Purpose                                 |
|--------|----------------------------|-----------------------------------------|
| POST   | `/api/v1/unfold`           | Streams a PDF/DXF/SVG flat pattern      |
| POST   | `/api/v1/unfold/preview`   | Returns raw SVG for preview             |
| POST   | `/api/v1/unfold/info`      | Returns thickness / bends / flat dims   |
| POST   | `/flat-pattern`            | JSON contract used by Supabase edge fn  |
| GET    | `/api/v1/health` / `/health` | Health check (returns OCP version)    |

## Local development

1. Copy env template:

   ```bash
   cp .env.example .env
   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
   ```

2. Build + run via Docker Compose:

   ```bash
   docker-compose up --build
   ```

3. Smoke test:

   ```bash
   curl http://localhost:8000/health
   ```

## Production deployment

Any host that can run a Docker container works (Fly.io, Railway, Render,
DigitalOcean App Platform, a self-managed VPS with Docker, AWS Fargate,
Google Cloud Run). A single 512 MB VM handles typical unfold workloads.

**After deploying:**

1. Note the public HTTPS URL of the service (e.g.
   `https://unfold.your-domain.com`).
2. In the Supabase dashboard, set the `UNFOLD_SERVICE_URL` secret to that
   URL — **without** a trailing slash:

   ```
   supabase secrets set UNFOLD_SERVICE_URL=https://unfold.your-domain.com
   ```

3. Re-deploy the Supabase edge functions so they pick up the new secret:

   ```
   supabase functions deploy extract-flat-pattern
   supabase functions deploy generate-manufacturing-pdf
   ```

4. Verify from the frontend: upload a STEP file in the RFQ flow, click
   **View drawing** — you should see the flat pattern with red bend lines
   and a populated bend schedule table.

## Environment variables

See `.env.example`. Only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
required for basic operation (they allow the service to download uploaded
STEP files from Supabase Storage).

## Dependencies

Python 3.11+, installed via `requirements.txt`. Notable deps:

- `cadquery>=2.4.0`, `OCP>=7.7.0` — STEP parsing and topology
- `pyclipper>=1.3.0` — 2D polygon union for true flange outlines
- `ezdxf>=1.1.0`, `svgwrite>=1.4.0` — DXF / SVG export
- `reportlab>=4.0` — PDF export

The Dockerfile adds `libgl1-mesa-glx`, `libglib2.0-0`, and `libgomp1` for
OpenCascade.
