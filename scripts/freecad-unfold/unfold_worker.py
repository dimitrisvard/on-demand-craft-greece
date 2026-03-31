"""
FreeCAD Worker — performs actual CAD operations

Uses FreeCAD's Python API to:
1. Import STEP files
2. Detect sheet metal features
3. Unfold using Sheet Metal workbench
4. Export flat pattern as DXF
5. Calculate bend allowances, dimensions, etc.
"""

import os
import sys
import json
import math
import base64
import tempfile
import traceback

# Add FreeCAD to Python path
FREECAD_PATHS = [
    "/usr/lib/freecad/lib",
    "/usr/lib/freecad-python3/lib",
    "/usr/share/freecad/Mod",
    "/usr/lib/freecad/Mod",
]
for p in FREECAD_PATHS:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)


def health_check_freecad():
    """Check if FreeCAD can be imported."""
    try:
        import FreeCAD
        return True, FreeCAD.Version()[0] + "." + FreeCAD.Version()[1]
    except Exception as e:
        return False, str(e)


def _get_bounding_box(shape):
    """Get bounding box dimensions from a FreeCAD shape."""
    bb = shape.BoundBox
    return {
        "x": round(bb.XLength, 3),
        "y": round(bb.YLength, 3),
        "z": round(bb.ZLength, 3),
    }


def _get_volume_and_area(shape):
    """Calculate volume and surface area."""
    return {
        "volume_mm3": round(shape.Volume, 3),
        "surface_area_mm2": round(shape.Area, 3),
    }


def _detect_cylindrical_faces(shape):
    """
    Detect cylindrical faces (bends) in the shape.
    Returns list of bend info with radius and angle.
    """
    bends = []
    for i, face in enumerate(shape.Faces):
        surface = face.Surface
        type_name = surface.__class__.__name__

        if type_name == "Cylinder":
            # This is a cylindrical face — likely a bend
            radius = surface.Radius
            # Estimate bend angle from the face's angular extent
            edges = face.Edges
            max_angle = 0
            for edge in edges:
                if hasattr(edge, 'Curve'):
                    curve = edge.Curve
                    if curve.__class__.__name__ == "Circle":
                        # Get parameter range
                        fp = edge.FirstParameter
                        lp = edge.LastParameter
                        angle = abs(lp - fp) * 180 / math.pi
                        max_angle = max(max_angle, angle)

            if max_angle > 5:  # Skip very small angles
                bends.append({
                    "face_index": i,
                    "radius": round(radius, 3),
                    "angle": round(max_angle, 1),
                    "type": "cylindrical_bend",
                })

    return bends


def _try_sheet_metal_unfold(doc, shape):
    """
    Try to unfold the shape using FreeCAD's Sheet Metal workbench.
    Returns the unfolded shape or None.
    """
    try:
        import Part
        import importlib

        # Try to import SheetMetal module
        try:
            sm = importlib.import_module("SheetMetal")
            SMUnfold = importlib.import_module("SheetMetalUnfolder")
        except ImportError:
            # Sheet Metal workbench not installed — try manual unfold
            return _manual_unfold(shape)

        # Create a Part Feature from the shape
        part_obj = doc.addObject("Part::Feature", "SheetPart")
        part_obj.Shape = shape
        doc.recompute()

        # Try the unfolder
        try:
            unfolder = SMUnfold.SMUnfold(part_obj)
            unfolder.run()
            if hasattr(unfolder, 'UnfoldedShape'):
                return unfolder.UnfoldedShape
        except Exception:
            pass

        return None
    except Exception:
        traceback.print_exc()
        return None


def _manual_unfold(shape):
    """
    Manual flat pattern approximation when Sheet Metal workbench isn't available.
    Projects the shape onto the XY plane and extracts the outline.
    """
    try:
        import Part

        # Project shape onto XY plane
        # This gives an approximate flat pattern for simple sheet metal parts
        direction = FreeCAD.Vector(0, 0, 1)
        projected = shape.makeParallelProjection(
            Part.Plane(FreeCAD.Vector(0, 0, 0), direction).toShape(),
            direction
        )
        return projected
    except Exception:
        return None


def _export_dxf(shape, output_path):
    """Export shape as DXF."""
    try:
        import Part
        import importDXF

        # Create temp doc with shape
        doc = FreeCAD.newDocument("DXFExport")
        obj = doc.addObject("Part::Feature", "FlatPattern")
        obj.Shape = shape
        doc.recompute()

        importDXF.export([obj], output_path)
        FreeCAD.closeDocument("DXFExport")
        return True
    except Exception:
        # Fallback: try direct wire export
        try:
            shape.exportStep(output_path.replace(".dxf", ".step"))
            return False  # Exported as STEP instead
        except Exception:
            return False


def unfold_step_file(step_path, file_name, part_info):
    """
    Full unfold pipeline for a STEP file.
    Returns dict with pdf_base64 and analysis.
    """
    import FreeCAD
    import Part

    # Load the STEP file
    doc = FreeCAD.newDocument("Unfold")
    Part.insert(step_path, "Unfold")
    doc.recompute()

    # Get the shape
    shapes = []
    for obj in doc.Objects:
        if hasattr(obj, 'Shape') and obj.Shape and obj.Shape.Volume > 0:
            shapes.append(obj.Shape)

    if not shapes:
        FreeCAD.closeDocument("Unfold")
        raise ValueError("No valid shapes found in STEP file")

    # Use the largest shape (main part)
    main_shape = max(shapes, key=lambda s: s.Volume)

    # Get metrics
    dims = _get_bounding_box(main_shape)
    metrics = _get_volume_and_area(main_shape)

    # Detect bends
    bends = _detect_cylindrical_faces(main_shape)

    # Try to unfold
    unfolded = _try_sheet_metal_unfold(doc, main_shape)

    result = {
        "analysis": {
            "dimensions": dims,
            **metrics,
            "triangle_count": len(main_shape.tessellate(0.1)[1]),
            "face_count": len(main_shape.Faces),
            "bend_count": len(bends),
            "bends": [
                {"id": f"B{i+1}", "angle": b["angle"], "radius": b["radius"]}
                for i, b in enumerate(bends)
            ],
        },
    }

    # Export flat pattern DXF if unfold succeeded
    if unfolded:
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
            dxf_path = tmp.name

        try:
            success = _export_dxf(unfolded, dxf_path)
            if success and os.path.exists(dxf_path):
                with open(dxf_path, "rb") as f:
                    result["dxf_base64"] = base64.b64encode(f.read()).decode()
                result["flat_pattern_available"] = True

                # Get flat pattern dimensions
                flat_dims = _get_bounding_box(unfolded)
                result["flat_pattern"] = {
                    "dimensions": flat_dims,
                    "source": "sheet_metal_unfold",
                }
        finally:
            if os.path.exists(dxf_path):
                os.unlink(dxf_path)
    else:
        result["flat_pattern_available"] = False
        result["flat_pattern"] = {
            "dimensions": {"width": dims["x"], "height": dims["z"]},
            "source": "projection_approximation",
        }

    FreeCAD.closeDocument("Unfold")
    return result


def extract_flat_pattern(step_path, file_name):
    """
    Extract flat pattern data from STEP file.
    Returns bend info + DXF if available.
    """
    import FreeCAD
    import Part

    doc = FreeCAD.newDocument("FlatExtract")
    Part.insert(step_path, "FlatExtract")
    doc.recompute()

    shapes = []
    for obj in doc.Objects:
        if hasattr(obj, 'Shape') and obj.Shape and obj.Shape.Volume > 0:
            shapes.append(obj.Shape)

    if not shapes:
        FreeCAD.closeDocument("FlatExtract")
        raise ValueError("No valid shapes found in STEP file")

    main_shape = max(shapes, key=lambda s: s.Volume)
    dims = _get_bounding_box(main_shape)
    metrics = _get_volume_and_area(main_shape)
    bends = _detect_cylindrical_faces(main_shape)

    result = {
        "flat_pattern": {
            "dimensions": {
                "width": dims["x"],
                "height": dims["z"],
                "thickness": dims["y"],
            },
            "bends": [
                {
                    "id": f"B{i+1}",
                    "angle": b["angle"],
                    "radius": b["radius"],
                    "length": 0,  # Would need edge length calculation
                }
                for i, b in enumerate(bends)
            ],
            "bend_count": len(bends),
        },
        "analysis": {
            "dimensions": dims,
            **metrics,
            "face_count": len(main_shape.Faces),
        },
    }

    # Try DXF export
    unfolded = _try_sheet_metal_unfold(doc, main_shape)
    if unfolded:
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
            dxf_path = tmp.name
        try:
            if _export_dxf(unfolded, dxf_path) and os.path.exists(dxf_path):
                with open(dxf_path, "rb") as f:
                    result["dxf_base64"] = base64.b64encode(f.read()).decode()
        finally:
            if os.path.exists(dxf_path):
                os.unlink(dxf_path)

    FreeCAD.closeDocument("FlatExtract")
    return result
