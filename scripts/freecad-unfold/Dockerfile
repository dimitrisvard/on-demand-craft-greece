# FreeCAD Sheet Metal Unfolding & Bending Shop Drawing Service
#
# Production-grade service that takes STEP files and produces:
# - Professional PDF bending shop drawings (A4 landscape)
# - DXF flat patterns with bend lines on separate layers
# - JSON metadata with all bend/dimension data
#
# Build:  docker build -t freecad-unfold .
# Run:    docker run -p 8000:8000 freecad-unfold

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

# Install FreeCAD, Xvfb, and system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    freecad \
    freecad-python3 \
    xvfb \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    python3-pip \
    python3-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install FreeCAD SheetMetal Workbench
RUN mkdir -p /root/.local/share/FreeCAD/Mod && \
    cd /root/.local/share/FreeCAD/Mod && \
    git clone https://github.com/shaise/FreeCAD_SheetMetal.git SheetMetal

# Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r /app/requirements.txt

# Copy application code
COPY app/ /app/
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

WORKDIR /app
EXPOSE 8000

CMD ["/app/start.sh"]
