#!/bin/bash
# Start Xvfb (virtual framebuffer) for offscreen rendering
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

# Wait for Xvfb to be ready
sleep 2

# Start the FastAPI service
exec uvicorn main:app --host 0.0.0.0 --port 8000
