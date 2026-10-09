# Sheet Metal Unfold Service
# Uses CadQuery (OpenCascade) — no FreeCAD, no Xvfb needed.
#
# Build:  docker build --platform linux/amd64 -t sheet-metal-service .
# Run:    docker run -p 8000:8000 -e API_KEY=<key> -e REQUIRE_API_KEY=1 sheet-metal-service
#
# P5-6 (CAD Container image, built and pushed by .github/workflows/cad-image.yml):
#   - linux/amd64 base image pinned by digest (Cloudflare Containers run amd64 images only)
#   - exact dependency versions from requirements.lock.txt (requirements.txt stays the development list)
#   - PYTHONHASHSEED=0, so the DXF CLASSES record order is the same on every start
#   - the service requires X-API-Key on every route except /health and /api/v1/health, and stops a request after
#     PROCESSING_TIMEOUT seconds (main.py, config.py); the Container sets API_KEY, REQUIRE_API_KEY=1 and
#     PROCESSING_TIMEOUT.
#   - Compatibility rule: the VPS keeps its current image until Phase 6 and is never rebuilt from this Dockerfile
#     while UNFOLD_SERVICE_URL points to it (workers/cad/README.md).

FROM --platform=linux/amd64 python:3.11-slim@sha256:bab1b7ef4b450c81002278d035eff85ebe394ae94df904f7a3ba14f7e16e487b

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONHASHSEED=0

# System dependencies for OpenCascade
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libxrender1 \
    libsm6 \
    libxi6 \
    libfontconfig1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (exact versions)
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt

# Copy application code
COPY . .

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import httpx; r = httpx.get('http://localhost:8000/health'); assert r.status_code == 200"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
