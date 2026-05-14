"""
FastAPI entry point for the Sheet Metal Unfold Service.

Endpoints:
    POST /api/v1/unfold          – Full pipeline: STEP → PDF/DXF/SVG
    POST /api/v1/unfold/preview  – Quick SVG flat pattern preview
    POST /api/v1/unfold/info     – JSON metadata only (for quoting)
    GET  /api/v1/health          – Health check
"""

from __future__ import annotations

import io
import os
import json
import shutil
import logging
import tempfile
from typing import Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from config import MAX_FILE_SIZE, API_KEY, get_k_factor
from storage.s3_client import download_file, validate_step_file

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}',
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Microns Hub Sheet Metal Unfold Service",
    description="STEP → Flat Pattern DXF / Professional PDF Drawing / SVG Preview",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Middleware: optional API key check ──────────────────────────────────────

@app.middleware("http")
async def check_api_key(request: Request, call_next):
    if API_KEY and request.url.path.startswith("/api/"):
        key = request.headers.get("X-API-Key", "")
        if key != API_KEY:
            return JSONResponse({"error": "Invalid API key"}, status_code=401)
    return await call_next(request)


# ── Core processing pipeline ──────────────────────────────────────────────

def _run_pipeline(step_path: str, material: str, thickness_override: float,
                  k_factor_override: float, debug: bool = False):
    """
    Run the full unfold pipeline on a STEP file.

    Returns ``(flat_pattern, bends, thickness, k_factor, topo, shape,
    bbox_3d, debug_dump)``. ``debug_dump`` is an empty dict unless
    ``debug=True``.
    """
    from core.step_parser import load_step, build_topology
    from core.thickness_detector import detect_thickness
    from core.face_classifier import classify_faces
    from core.bend_detector import detect_bends
    from core.bend_graph import build_bend_graph
    from core.unfolder import unfold
    from core import guards

    debug_dump: dict = {} if debug else {}

    # Load STEP
    solids = load_step(step_path)
    # Use the largest solid
    main_solid = max(solids, key=lambda s: s.IsNull() == False)  # noqa: E712
    if len(solids) > 1:
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps
        def _vol(s):
            p = GProp_GProps()
            BRepGProp.VolumeProperties_s(s, p)
            return p.Mass()
        main_solid = max(solids, key=_vol)

    # Build topology
    topo = build_topology(main_solid)

    if debug:
        debug_dump["topology"] = {
            "num_faces": len(topo.faces),
            "volume_mm3": round(topo.volume, 2),
            "bbox": list(topo.bbox) if topo.bbox else None,
        }

    # Detect thickness
    if thickness_override > 0:
        thickness = thickness_override
        thickness_confidence = 1.0
    else:
        thickness, thickness_confidence = detect_thickness(topo)
        logger.info("Auto-detected thickness: %.2f mm (confidence: %.0f%%)",
                     thickness, thickness_confidence * 100)

    # Guard: thickness in plausible range
    try:
        guards.check_thickness(thickness)
    except guards.ThicknessOutOfRangeError as e:
        logger.warning("Thickness guard: %s", e)

    # K-factor
    k_factor = k_factor_override if k_factor_override > 0 else get_k_factor(material, thickness)

    # Classify faces
    classified = classify_faces(topo, thickness)
    if debug:
        ft_counts: dict = {}
        for cf in classified:
            ft_counts[cf.face_type.name] = ft_counts.get(cf.face_type.name, 0) + 1
        debug_dump["face_classification"] = {
            "thickness_mm": round(thickness, 3),
            "thickness_confidence": round(thickness_confidence, 3),
            "k_factor": k_factor,
            "type_counts": ft_counts,
            "faces": [
                {
                    "index": cf.info.index,
                    "type": cf.face_type.name,
                    "area_mm2": round(cf.info.area, 2),
                    "normal": cf.info.normal,
                    "radius": cf.info.radius,
                    "axis": cf.info.axis,
                }
                for cf in classified
            ],
        }

    # Detect bends
    bends = detect_bends(topo, classified, thickness)

    # Guard: bend angles in physical range
    try:
        guards.check_bend_angles([b.angle_deg for b in bends])
    except guards.BendAngleOutOfRangeError as e:
        logger.warning("Bend-angle guard: %s", e)

    # Build bend graph
    bend_graph = build_bend_graph(classified, bends)
    if debug:
        debug_dump["bends"] = [
            {
                "id": b.bend_id,
                "face_index": b.face_index,
                "inner_radius_mm": b.inner_radius,
                "angle_deg": b.angle_deg,
                "direction": b.direction,
                "axis": list(b.axis),
                "axis_location": list(b.axis_location),
                "adjacent_flanges": list(b.adjacent_flanges),
                "length_mm": b.length,
            }
            for b in bends
        ]
        debug_dump["bend_graph"] = {
            "base_flange": bend_graph.base_flange,
            "edges": [
                [u, v, bend_graph.graph.edges[u, v].get("bend_id")]
                for u, v in bend_graph.graph.edges()
            ],
            "unfolding_order": [list(t) for t in bend_graph.unfolding_order],
            "has_cycles": bend_graph.has_cycles,
        }

    # Unfold
    flat = unfold(topo, classified, bends, bend_graph, thickness, k_factor)

    if debug:
        debug_dump["flat_pattern"] = {
            "width_mm": flat.width,
            "height_mm": flat.height,
            "num_outer_edges": len(flat.outer_edges),
            "num_extra_outlines": len(flat.extra_outlines),
            "num_holes": len(flat.holes),
            "num_bend_lines": len(flat.bend_lines),
            "flange_widths": flat.flange_widths,
            "warnings": list(flat.warnings),
            "bend_line_positions": [
                {"start": list(bl.start), "end": list(bl.end),
                 "bend_id": bl.bend_info.bend_id}
                for bl in flat.bend_lines
            ],
        }

    # Bounding box
    bbox_3d = {}
    if topo.bbox:
        bbox_3d = {
            "x": round(topo.bbox[3] - topo.bbox[0], 2),
            "y": round(topo.bbox[4] - topo.bbox[1], 2),
            "z": round(topo.bbox[5] - topo.bbox[2], 2),
        }

    return flat, bends, thickness, k_factor, topo, main_solid, bbox_3d, debug_dump


async def _get_step_path(
    file: Optional[UploadFile],
    file_url: Optional[str],
    storage_path: Optional[str],
    tmpdir: str,
) -> str:
    """Resolve the STEP file to a local path."""
    if file:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(400, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")
        fname = file.filename or "part.step"
        path = os.path.join(tmpdir, fname)
        with open(path, "wb") as f:
            f.write(content)
        return path

    if file_url or storage_path:
        return await download_file(
            file_url=file_url,
            storage_path=storage_path,
            dest_dir=tmpdir,
        )

    raise HTTPException(400, "Provide a file upload, file_url, or storage_path")


# ── Endpoints ──────────────────────────────────────────────────────────────

@app.post("/api/v1/unfold")
async def unfold_endpoint(
    file: Optional[UploadFile] = File(None),
    file_url: Optional[str] = Form(None),
    storage_path: Optional[str] = Form(None),
    material: str = Form("steel"),
    thickness_override: float = Form(0.0),
    k_factor_override: float = Form(0.0),
    output_format: str = Form("pdf"),
    drawing_size: str = Form("A3"),
):
    """
    Full unfold pipeline: STEP → PDF / DXF / SVG.

    Output is streamed directly — nothing is stored.
    """
    tmpdir = tempfile.mkdtemp(prefix="unfold_")
    try:
        step_path = await _get_step_path(file, file_url, storage_path, tmpdir)

        if not validate_step_file(step_path):
            raise HTTPException(400, "File does not appear to be a valid STEP file")

        part_name = os.path.splitext(os.path.basename(step_path))[0]

        flat, bends, thickness, k_factor, topo, solid, bbox_3d, _debug = _run_pipeline(
            step_path, material, thickness_override, k_factor_override
        )

        # Add metadata headers
        meta_headers = {
            "X-Part-Thickness": str(thickness),
            "X-Part-Flat-Width": str(flat.width),
            "X-Part-Flat-Height": str(flat.height),
            "X-Part-Num-Bends": str(len(bends)),
        }
        if flat.warnings:
            meta_headers["X-Part-Warnings"] = json.dumps(flat.warnings)

        if output_format == "dxf":
            from export.dxf_exporter import export_dxf
            dxf_path = os.path.join(tmpdir, f"{part_name}_flat.dxf")
            export_dxf(flat, dxf_path, part_name)
            with open(dxf_path, "rb") as f:
                content = f.read()
            return StreamingResponse(
                io.BytesIO(content),
                media_type="application/dxf",
                headers={
                    "Content-Disposition": f'attachment; filename="{part_name}_flat.dxf"',
                    **meta_headers,
                },
            )

        if output_format == "svg":
            from export.svg_exporter import export_svg
            svg_str = export_svg(flat, part_name)
            return StreamingResponse(
                io.BytesIO(svg_str.encode("utf-8")),
                media_type="image/svg+xml",
                headers=meta_headers,
            )

        # Default: PDF
        from drawing.pdf_generator import generate_pdf
        pdf_bytes = generate_pdf(
            flat=flat,
            bends=bends,
            thickness=thickness,
            k_factor=k_factor,
            part_name=part_name,
            material=material,
            drawing_size=drawing_size,
            shape=solid,
            bbox_3d=bbox_3d,
        )
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{part_name}_bending_drawing.pdf"',
                **meta_headers,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Processing error")
        raise HTTPException(500, f"Processing error: {e}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/api/v1/unfold/preview")
async def unfold_preview(
    file: Optional[UploadFile] = File(None),
    file_url: Optional[str] = Form(None),
    storage_path: Optional[str] = Form(None),
    material: str = Form("steel"),
    thickness_override: float = Form(0.0),
    k_factor_override: float = Form(0.0),
):
    """Quick SVG flat pattern preview for the web viewer."""
    tmpdir = tempfile.mkdtemp(prefix="preview_")
    try:
        step_path = await _get_step_path(file, file_url, storage_path, tmpdir)

        if not validate_step_file(step_path):
            raise HTTPException(400, "Invalid STEP file")

        part_name = os.path.splitext(os.path.basename(step_path))[0]

        flat, bends, thickness, k_factor, topo, solid, bbox_3d, _debug = _run_pipeline(
            step_path, material, thickness_override, k_factor_override
        )

        from export.svg_exporter import export_svg
        svg_str = export_svg(flat, part_name)

        return StreamingResponse(
            io.BytesIO(svg_str.encode("utf-8")),
            media_type="image/svg+xml",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Preview error")
        raise HTTPException(500, f"Preview error: {e}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/api/v1/unfold/info")
async def unfold_info(
    request: Request,
    file: Optional[UploadFile] = File(None),
    file_url: Optional[str] = Form(None),
    storage_path: Optional[str] = Form(None),
    material: str = Form("steel"),
    thickness_override: float = Form(0.0),
    k_factor_override: float = Form(0.0),
):
    """JSON metadata only — for the quoting engine.

    Pass ``?debug=true`` to also receive the full per-stage intermediate
    state as a ``debug_dump`` field for triaging customer-support
    tickets.
    """
    debug = request.query_params.get("debug", "").lower() in ("1", "true", "yes")
    tmpdir = tempfile.mkdtemp(prefix="info_")
    try:
        step_path = await _get_step_path(file, file_url, storage_path, tmpdir)

        if not validate_step_file(step_path):
            raise HTTPException(400, "Invalid STEP file")

        flat, bends, thickness, k_factor, topo, solid, bbox_3d, debug_dump = _run_pipeline(
            step_path, material, thickness_override, k_factor_override,
            debug=debug,
        )

        from core.kfactor import compute_bend

        payload: dict = {
            "success": True,
            "part_info": {
                "thickness_detected": thickness,
                "material": material,
                "num_bends": len(bends),
                "flat_size": {"width": flat.width, "height": flat.height},
                "bounding_box_3d": bbox_3d,
            },
            "bends": [
                {
                    "id": f"B{b.bend_id}",
                    "angle": b.angle_deg,
                    "radius": b.inner_radius,
                    "direction": b.direction,
                    "k_factor": k_factor,
                    "bend_allowance": compute_bend(
                        b.angle_deg, b.inner_radius, thickness, k_factor
                    ).bend_allowance,
                }
                for b in bends
            ],
            "warnings": flat.warnings,
        }
        if debug:
            payload["debug_dump"] = debug_dump
        return JSONResponse(payload)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Info error")
        raise HTTPException(500, f"Info error: {e}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.api_route("/flat-pattern", methods=["POST"])
async def flat_pattern_compat(request: Request):
    """
    Backward-compatible /flat-pattern endpoint.

    Accepts JSON: { file_url, file_name, part_info? }
    Returns JSON matching the existing edge function contract.
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

    tmpdir = tempfile.mkdtemp(prefix="compat_")
    try:
        step_path = await download_file(file_url=file_url, dest_dir=tmpdir, file_name=file_name)

        material = part_info.get("material", "steel")
        thickness_input = float(part_info.get("thickness", 0))
        k_factor_input = float(part_info.get("k_factor", 0))
        debug = (
            str(body.get("debug", "")).lower() in ("1", "true", "yes")
            or request.query_params.get("debug", "").lower() in ("1", "true", "yes")
        )

        flat, bends, thickness, k_factor, topo, solid, bbox_3d, debug_dump = _run_pipeline(
            step_path, material, thickness_input, k_factor_input,
            debug=debug,
        )

        part_name = os.path.splitext(file_name)[0]
        extra_warnings: list[str] = []

        # Export DXF for base64 embedding
        dxf_base64 = None
        try:
            from export.dxf_exporter import export_dxf
            dxf_path = os.path.join(tmpdir, f"{part_name}_flat.dxf")
            export_dxf(flat, dxf_path, part_name)
            with open(dxf_path, "rb") as f:
                dxf_base64 = base64.b64encode(f.read()).decode()
        except Exception as e:
            logger.exception("DXF export failed")
            extra_warnings.append(f"DXF export failed: {e}")

        # Always render an SVG so the frontend has at least a preview even
        # when DXF export fails.
        svg_base64 = None
        try:
            from export.svg_exporter import export_svg
            svg_str = export_svg(flat, part_name)
            svg_base64 = base64.b64encode(svg_str.encode("utf-8")).decode()
        except Exception as e:
            logger.exception("SVG export failed")
            extra_warnings.append(f"SVG export failed: {e}")

        from core.kfactor import compute_bend

        response = {
            "status": "completed",
            "source": "cadquery",
            "file_name": file_name,
            "part_name": part_name,
            "thickness_mm": thickness,
            "unfold_method": "occ_direct",
            "flat_pattern": {
                "dimensions": {
                    "width": flat.width,
                    "height": flat.height,
                    "thickness": thickness,
                },
                "bends": [
                    {
                        "id": f"B{b.bend_id}",
                        "index": b.bend_id,
                        "angle": b.angle_deg,
                        "angle_deg": b.angle_deg,
                        "radius": b.inner_radius,
                        "inner_radius_mm": b.inner_radius,
                        "direction": b.direction,
                        "length": b.length,
                        "length_mm": b.length,
                        "k_factor": k_factor,
                        "bend_allowance_mm": compute_bend(
                            b.angle_deg, b.inner_radius, thickness, k_factor
                        ).bend_allowance,
                        "bend_deduction_mm": compute_bend(
                            b.angle_deg, b.inner_radius, thickness, k_factor
                        ).bend_deduction,
                        "bend_line_on_flat": {
                            "start": list(bl.start),
                            "end": list(bl.end),
                        } if (bl := next((x for x in flat.bend_lines if x.bend_info.bend_id == b.bend_id), None)) else None,
                        "distance_from_left_edge_mm": next(
                            (x.start[0] for x in flat.bend_lines if x.bend_info.bend_id == b.bend_id), 0
                        ),
                    }
                    for b in bends
                ],
                "bend_count": len(bends),
                "outline_edges": [
                    {"start": list(e.start), "end": list(e.end)}
                    for e in flat.outer_edges
                ],
            },
            "bends": [
                {
                    "index": b.bend_id,
                    "angle_deg": b.angle_deg,
                    "inner_radius_mm": b.inner_radius,
                    "direction": b.direction,
                    "length_mm": b.length,
                    "k_factor": k_factor,
                    "bend_allowance_mm": compute_bend(
                        b.angle_deg, b.inner_radius, thickness, k_factor
                    ).bend_allowance,
                    "bend_deduction_mm": compute_bend(
                        b.angle_deg, b.inner_radius, thickness, k_factor
                    ).bend_deduction,
                }
                for b in bends
            ],
            "analysis": {"dimensions": bbox_3d},
            "warnings": list(flat.warnings) + extra_warnings,
        }

        if dxf_base64:
            response["dxf_base64"] = dxf_base64
        if svg_base64:
            response["svg_base64"] = svg_base64
        if debug:
            response["debug_dump"] = debug_dump

        return JSONResponse(response)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Compat endpoint error")
        raise HTTPException(500, f"Processing error: {e}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.get("/api/v1/health")
async def health():
    """Health check with OCC version info."""
    try:
        import OCP
        occ_ok = True
        occ_version = getattr(OCP, "__version__", "unknown")
    except ImportError:
        occ_ok = False
        occ_version = "not installed"

    return JSONResponse({
        "status": "healthy" if occ_ok else "degraded",
        "occ_available": occ_ok,
        "occ_version": occ_version,
        "service": "sheet-metal-service",
        "version": "2.0.0",
        "engine": "cadquery/ocp",
    })


# Also keep a /health alias for backward compatibility
@app.get("/health")
async def health_compat():
    return await health()
