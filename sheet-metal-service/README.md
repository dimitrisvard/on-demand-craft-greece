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

## Cloudflare Container (migration Phase 5)

From Phase 5 of the Cloudflare migration this service also runs as the Container `microns-cad` behind
`microns-ops` (docs/migration/PLAN.md §5.5; build, push and parity procedure in `workers/cad/README.md`).
Endpoint bodies are unchanged; the service and its image gained these rules:

| Rule | Detail |
|---|---|
| Key | With `API_KEY` set, every route except `/health` and `/api/v1/health` requires `X-API-Key` (constant-time compare, 401 otherwise); with `REQUIRE_API_KEY=1` and no key those routes answer 503. The Container sets both; set `API_KEY` on every deployment that is not a local development run |
| Wall clock | Processing requests run in a forked child that is stopped after `PROCESSING_TIMEOUT` seconds (default 120): 504; a crashed child answers 500; one job at a time, `/health` answers during a job |
| Image | `linux/amd64` base pinned by digest, exact versions from `requirements.lock.txt` (`requirements.txt` stays the development list), `PYTHONHASHSEED=0` |
| Compatibility | The VPS keeps its current image until Phase 6 and is never rebuilt from this Dockerfile while the Supabase secret `UNFOLD_SERVICE_URL` points to it |
| Edge functions | At switch-over step S9 the owner replaces `UNFOLD_SERVICE_URL` with the site path of the Container (never unset; the old value is kept for rollback); `extract-flat-pattern` and `generate-manufacturing-pdf` are not redeployed |

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

This section describes the original VPS set-up, which stays in place until Phase 6 of the migration (see
"Cloudflare Container" above). Any host that can run a Docker container works (Fly.io, Railway, Render,
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
STEP files from Supabase Storage). Phase 5 adds `REQUIRE_API_KEY` and makes
`PROCESSING_TIMEOUT` (seconds) configurable; the Container sets `API_KEY`,
`REQUIRE_API_KEY=1` and `PROCESSING_TIMEOUT` and holds no storage credentials.

## Dependencies

Python 3.11+, installed via `requirements.txt` (the Docker image installs the exact
versions of `requirements.lock.txt`). Notable deps:

- `cadquery>=2.4.0`, `OCP>=7.7.0` — STEP parsing and topology
- `pyclipper>=1.3.0` — 2D polygon union for true flange outlines
- `ezdxf>=1.1.0`, `svgwrite>=1.4.0` — DXF / SVG export
- `reportlab>=4.0` — PDF export

The Dockerfile adds `libgl1-mesa-glx`, `libglib2.0-0`, and `libgomp1` for
OpenCascade.
