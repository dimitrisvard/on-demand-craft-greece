"""
FreeCAD Sheet Metal Unfolding Service

Flask API that accepts STEP/STP files, uses FreeCAD's Sheet Metal workbench
to unfold them, and returns flat pattern data + DXF export.

Endpoints:
  POST /unfold       - Full unfold → PDF (base64) + analysis
  POST /flat-pattern  - Flat pattern extraction → DXF (base64) + bend data
  GET  /health        - Health check
"""

import os
import json
import tempfile
import base64
import traceback
from flask import Flask, request, jsonify

app = Flask(__name__)

# Import the FreeCAD worker module
from unfold_worker import (
    unfold_step_file,
    extract_flat_pattern,
    health_check_freecad,
)


@app.route("/health", methods=["GET"])
def health():
    """Health check — verifies FreeCAD is importable."""
    ok, version = health_check_freecad()
    if ok:
        return jsonify({"status": "healthy", "freecad_version": version})
    return jsonify({"status": "unhealthy", "error": version}), 503


@app.route("/unfold", methods=["POST"])
def unfold():
    """
    Full unfold pipeline:
    1. Download STEP file from file_url
    2. Import into FreeCAD
    3. Run Sheet Metal Unfold
    4. Generate flat pattern PDF
    5. Return PDF (base64) + analysis
    """
    try:
        data = request.get_json()
        file_url = data.get("file_url")
        file_name = data.get("file_name", "part.step")
        part_info = data.get("part_info", {})

        if not file_url:
            return jsonify({"error": "file_url is required"}), 400

        # Download the file
        import requests
        resp = requests.get(file_url, timeout=60)
        if resp.status_code != 200:
            return jsonify({"error": f"Failed to download file: {resp.status_code}"}), 502

        # Save to temp file
        suffix = os.path.splitext(file_name)[1] or ".step"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(resp.content)
            tmp_path = tmp.name

        try:
            result = unfold_step_file(tmp_path, file_name, part_info)
            return jsonify(result)
        finally:
            os.unlink(tmp_path)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/flat-pattern", methods=["POST"])
def flat_pattern():
    """
    Extract flat pattern data (DXF + bend info) from STEP file.
    Lighter weight than /unfold — no PDF generation.
    """
    try:
        data = request.get_json()
        file_url = data.get("file_url")
        file_name = data.get("file_name", "part.step")

        if not file_url:
            return jsonify({"error": "file_url is required"}), 400

        import requests
        resp = requests.get(file_url, timeout=60)
        if resp.status_code != 200:
            return jsonify({"error": f"Failed to download file: {resp.status_code}"}), 502

        suffix = os.path.splitext(file_name)[1] or ".step"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(resp.content)
            tmp_path = tmp.name

        try:
            result = extract_flat_pattern(tmp_path, file_name)
            return jsonify(result)
        finally:
            os.unlink(tmp_path)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8090, debug=True)
