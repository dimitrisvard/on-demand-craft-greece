# Sheet Metal Unfold Service
# Uses CadQuery (OpenCascade) — no FreeCAD, no Xvfb needed.
#
# Build:  docker build -t sheet-metal-service .
# Run:    docker run -p 8000:8000 sheet-metal-service

FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

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

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import httpx; r = httpx.get('http://localhost:8000/health'); assert r.status_code == 200"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
