# FreeCAD Sheet Metal Unfolding Service
#
# Provides true B-Rep flat pattern extraction from STEP/STP files
# using FreeCAD's Sheet Metal workbench + OpenCascade.
#
# Build:  docker build -t freecad-unfold .
# Run:    docker run -p 8090:8090 freecad-unfold
#
# The edge function calls this service when UNFOLD_SERVICE_URL is set.

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV FREECAD_PATH=/usr/lib/freecad

# Install FreeCAD + dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    freecad \
    freecad-python3 \
    python3-pip \
    python3-dev \
    xvfb \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# Copy application code
COPY app.py /app/app.py
COPY unfold_worker.py /app/unfold_worker.py

WORKDIR /app

EXPOSE 8090

# Run with xvfb for headless FreeCAD
CMD ["xvfb-run", "--auto-servernum", "gunicorn", "-w", "2", "-b", "0.0.0.0:8090", "--timeout", "300", "app:app"]
