"""
Isometric render orchestrator — runs the FreeCAD render worker as a subprocess.
"""

import os
import json
import subprocess

from config import (
    FREECAD_TIMEOUT,
    JSON_START_MARKER,
    JSON_END_MARKER,
    ISO_RENDER_WIDTH,
    ISO_RENDER_HEIGHT,
)


def render_isometric(step_path: str, output_png_path: str,
                     width: int = ISO_RENDER_WIDTH,
                     height: int = ISO_RENDER_HEIGHT) -> bool:
    """
    Render a solid-shaded isometric PNG of the STEP file.

    Args:
        step_path: Path to the input STEP file
        output_png_path: Path for the output PNG image
        width: Image width in pixels
        height: Image height in pixels

    Returns:
        True if rendering succeeded
    """
    worker_script = os.path.join(
        os.path.dirname(__file__), "freecad_render_worker.py"
    )

    env = os.environ.copy()
    env["DISPLAY"] = env.get("DISPLAY", ":99")

    try:
        result = subprocess.run(
            [
                "freecadcmd",
                worker_script,
                step_path,
                output_png_path,
                str(width),
                str(height),
            ],
            capture_output=True,
            text=True,
            timeout=FREECAD_TIMEOUT,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return False
    except FileNotFoundError:
        return False

    if JSON_START_MARKER in result.stdout:
        json_str = (
            result.stdout.split(JSON_START_MARKER)[1]
            .split(JSON_END_MARKER)[0]
            .strip()
        )
        try:
            data = json.loads(json_str)
            return data.get("success", False)
        except json.JSONDecodeError:
            return False

    # Check if the file was created even without JSON output
    return os.path.exists(output_png_path) and os.path.getsize(output_png_path) > 0
