"""
FastAPI service for sheet metal unfolding and bending shop drawing generation.

Endpoints:
    POST /unfold     - Upload STEP file → ZIP (PDF + DXF + JSON)
    GET  /health     - Health check
"""

import os
import json
import shutil
import tempfile
import zipfile

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from config import MAX_FILE_SIZE, K_FACTORS, DEFAULT_K_FACTOR
from freecad_unfold import run_freecad_unfold
from freecad_render import render_isometric
from pdf_generator import generate_shop_drawing_pdf
from dxf_export import export_flat_dxf_with_bend_lines

app = FastAPI(
    title="Microns Hub Sheet Metal Unfold Service",
    description="STEP → Bending Shop Drawing PDF + DXF + JSON",
    version="2.0.0",
)


@app.post("/unfold")
async def unfold_step_file(
    file: UploadFile = File(...),
    thickness: float = Form(0.0),
    material: str = Form("Steel"),
    k_factor: float = Form(0.0),
):
    """
    Upload a STEP file and receive a ZIP containing:
    - {part_name}_bending_drawing.pdf  (professional shop drawing)
    - {part_name}_flat.dxf             (flat pattern with bend lines)
    - {part_name}_metadata.json        (all extracted data)
    """
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    if not file.filename.lower().endswith((".step", ".stp")):
        raise HTTPException(400, "Only STEP/STP files are accepted")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")

    # Use material-specific k-factor if not explicitly provided
    if k_factor <= 0:
        k_factor = K_FACTORS.get(material, DEFAULT_K_FACTOR)

    tmpdir = tempfile.mkdtemp(prefix="unfold_")
    try:
        # Save uploaded STEP file
        step_path = os.path.join(tmpdir, file.filename)
        with open(step_path, "wb") as f:
            f.write(content)

        output_dir = os.path.join(tmpdir, "output")
        os.makedirs(output_dir)

        # Step 1: Run FreeCAD unfold (geometry extraction)
        unfold_result = run_freecad_unfold(step_path, output_dir, thickness, k_factor)

        if not unfold_result.get("success"):
            error_msg = unfold_result.get("error", "Unknown error during unfold")
            raise HTTPException(500, f"Unfold failed: {error_msg}")

        unfold_result["material"] = material
        part_name = unfold_result.get("part_name", "Part")

        # Step 2: Render isometric view
        iso_path = os.path.join(output_dir, f"{part_name}_iso.png")
        render_isometric(step_path, iso_path)

        # Step 3: Export clean DXF with bend lines on separate layer
        dxf_path = os.path.join(output_dir, f"{part_name}_flat.dxf")
        flat_data = unfold_result.get("flat_pattern", {})
        bends = unfold_result.get("bends", [])
        outline_edges = flat_data.get("outline_edges", [])
        export_flat_dxf_with_bend_lines(outline_edges, bends, dxf_path, part_name)
        # Update the DXF path in the result
        unfold_result.setdefault("flat_pattern", {})["dxf_path"] = dxf_path

        # Step 4: Generate PDF shop drawing
        pdf_path = os.path.join(output_dir, f"{part_name}_bending_drawing.pdf")
        generate_shop_drawing_pdf(unfold_result, iso_path, pdf_path)

        # Step 5: Save metadata JSON
        json_path = os.path.join(output_dir, f"{part_name}_metadata.json")
        # Remove internal paths from the JSON output
        json_output = {k: v for k, v in unfold_result.items()
                       if k not in ("stl_path",)}
        if "flat_pattern" in json_output:
            json_output["flat_pattern"] = {
                k: v for k, v in json_output["flat_pattern"].items()
                if k != "dxf_path"
            }
        with open(json_path, "w") as f:
            json.dump(json_output, f, indent=2)

        # Step 6: Package into ZIP
        zip_path = os.path.join(tmpdir, f"{part_name}_bending_package.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            if os.path.exists(pdf_path):
                zf.write(pdf_path, os.path.basename(pdf_path))
            if os.path.exists(dxf_path):
                zf.write(dxf_path, os.path.basename(dxf_path))
            zf.write(json_path, os.path.basename(json_path))

        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=os.path.basename(zip_path),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Processing error: {e}")
    finally:
        # Cleanup is handled by the OS for temp dirs,
        # but we schedule it after response is sent
        pass


@app.api_route("/flat-pattern", methods=["POST"])
async def flat_pattern_endpoint(request):
    """
    Backward-compatible /flat-pattern endpoint.
    Accepts JSON: { file_url, file_name, part_info? }
    Returns JSON with flat pattern data, bends, and optional DXF base64.
    """
    import base64

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    file_url = body.get("file_url")
    file_name = body.get("file_name", "part.step")
    part_info = body.get("part_info", {})

    if not file_url:
        raise HTTPException(400, "file_url is required")

    # Download the file
    import urllib.request
    tmpdir = tempfile.mkdtemp(prefix="flatpattern_")
    try:
        step_path = os.path.join(tmpdir, file_name)
        urllib.request.urlretrieve(file_url, step_path)

        output_dir = os.path.join(tmpdir, "output")
        os.makedirs(output_dir)

        material = part_info.get("material", "Steel")
        thickness = float(part_info.get("thickness", 0))
        k_factor = K_FACTORS.get(material, DEFAULT_K_FACTOR)

        unfold_result = run_freecad_unfold(step_path, output_dir, thickness, k_factor)

        if not unfold_result.get("success"):
            raise HTTPException(500, unfold_result.get("error", "Unfold failed"))

        # Build response compatible with extract-flat-pattern edge function
        flat_data = unfold_result.get("flat_pattern", {})
        bends = unfold_result.get("bends", [])

        # Read DXF file as base64 if available
        dxf_base64 = None
        dxf_path = flat_data.get("dxf_path", "")
        if dxf_path and os.path.exists(dxf_path):
            with open(dxf_path, "rb") as f:
                dxf_base64 = base64.b64encode(f.read()).decode()

        return JSONResponse({
            "status": "completed",
            "source": "freecad",
            "file_name": file_name,
            "part_name": unfold_result.get("part_name", "Part"),
            "thickness_mm": unfold_result.get("thickness_mm", 0),
            "unfold_method": unfold_result.get("unfold_method", "unknown"),
            "flat_pattern": {
                "dimensions": {
                    "width": flat_data.get("width_mm", 0),
                    "height": flat_data.get("height_mm", 0),
                    "thickness": unfold_result.get("thickness_mm", 0),
                },
                "bends": [
                    {
                        "id": f"B{b.get('index', i + 1)}",
                        "index": b.get("index", i + 1),
                        "angle": b.get("angle_deg", 90),
                        "angle_deg": b.get("angle_deg", 90),
                        "radius": b.get("inner_radius_mm", 0),
                        "inner_radius_mm": b.get("inner_radius_mm", 0),
                        "direction": b.get("direction", "UP"),
                        "length": b.get("length_mm", 0),
                        "length_mm": b.get("length_mm", 0),
                        "k_factor": b.get("k_factor", 0.44),
                        "bend_allowance_mm": b.get("bend_allowance_mm", 0),
                        "bend_deduction_mm": b.get("bend_deduction_mm", 0),
                        "bend_line_on_flat": b.get("bend_line_on_flat"),
                        "distance_from_left_edge_mm": b.get("distance_from_left_edge_mm", 0),
                    }
                    for i, b in enumerate(bends)
                ],
                "bend_count": len(bends),
                "outline_edges": flat_data.get("outline_edges", []),
            },
            "bends": bends,
            "linear_dimensions": unfold_result.get("linear_dimensions", []),
            "analysis": {
                "dimensions": unfold_result.get("bounding_box_3d", {}),
            },
            **({"dxf_base64": dxf_base64} if dxf_base64 else {}),
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Processing error: {e}")
    finally:
        pass


@app.get("/health")
async def health():
    """Health check — verifies FreeCAD is available."""
    freecad_ok = _check_freecad()
    status = "healthy" if freecad_ok else "degraded"
    return JSONResponse({
        "status": status,
        "freecad_available": freecad_ok,
        "service": "unfold-service",
        "version": "2.0.0",
    })


def _check_freecad() -> bool:
    """Check if freecadcmd is available."""
    try:
        import subprocess
        result = subprocess.run(
            ["freecadcmd", "--version"],
            capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0
    except Exception:
        return False
