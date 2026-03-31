"""
Unfold orchestrator — runs the FreeCAD worker as a subprocess and parses results.

FreeCAD has its own Python environment, so we communicate via JSON on stdout.
"""

import os
import json
import subprocess

from config import FREECAD_TIMEOUT, JSON_START_MARKER, JSON_END_MARKER


def run_freecad_unfold(step_path: str, output_dir: str,
                       thickness: float = 0.0, k_factor: float = 0.44) -> dict:
    """
    Run the FreeCAD unfold worker script as a subprocess.

    Args:
        step_path: Path to the input STEP file
        output_dir: Directory for output files (DXF, STL)
        thickness: Sheet thickness in mm (0 = auto-detect)
        k_factor: K-factor for bend allowance calculation

    Returns:
        dict with unfold results (matches UnfoldResult schema)
    """
    worker_script = os.path.join(os.path.dirname(__file__), "freecad_unfold_worker.py")

    env = os.environ.copy()
    env["DISPLAY"] = env.get("DISPLAY", ":99")

    try:
        result = subprocess.run(
            [
                "freecadcmd",
                worker_script,
                step_path,
                output_dir,
                str(thickness),
                str(k_factor),
            ],
            capture_output=True,
            text=True,
            timeout=FREECAD_TIMEOUT,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": f"FreeCAD processing timed out after {FREECAD_TIMEOUT}s",
        }
    except FileNotFoundError:
        return {
            "success": False,
            "error": "freecadcmd not found — is FreeCAD installed?",
        }

    stdout = result.stdout
    stderr = result.stderr

    if JSON_START_MARKER in stdout:
        json_str = stdout.split(JSON_START_MARKER)[1].split(JSON_END_MARKER)[0].strip()
        try:
            data = json.loads(json_str)
            return data
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "error": f"Failed to parse FreeCAD output JSON: {e}",
                "stdout": stdout[-2000:],
                "stderr": stderr[-2000:],
            }
    else:
        return {
            "success": False,
            "error": "FreeCAD worker did not produce JSON output",
            "stdout": stdout[-2000:],
            "stderr": stderr[-2000:],
        }
