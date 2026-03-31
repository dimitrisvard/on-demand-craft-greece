#!/usr/bin/env python3
"""
FreeCAD Render Worker — runs inside FreeCAD to produce a solid-shaded isometric PNG.

Requires Xvfb (DISPLAY=:99) for offscreen rendering via FreeCADGui.

Usage:
    freecadcmd freecad_render_worker.py <step_path> <output_png_path> <width> <height>
"""

import sys
import os
import json

# Parse arguments
args = sys.argv[1:]
if len(args) < 4:
    all_args = sys.argv
    script_idx = -1
    for i, a in enumerate(all_args):
        if a.endswith("freecad_render_worker.py"):
            script_idx = i
            break
    if script_idx >= 0:
        args = all_args[script_idx + 1:]

step_path = args[0]
output_png_path = args[1]
width = int(args[2])
height = int(args[3])


def render_with_gui():
    """Render using FreeCADGui with Coin3D — produces solid shaded view."""
    import FreeCAD
    import FreeCADGui

    # Initialize the GUI (required even in headless mode with Xvfb)
    FreeCADGui.showMainWindow()
    mw = FreeCADGui.getMainWindow()
    mw.hide()

    # Open STEP file
    import Part
    doc = FreeCAD.newDocument("Render")
    Part.insert(step_path, doc.Name)
    doc.recompute()

    # Set material appearance for all objects
    for obj in doc.Objects:
        if hasattr(obj, "ViewObject"):
            vo = obj.ViewObject
            vo.ShapeColor = (0.69, 0.74, 0.77)  # Steel blue-grey
            vo.Transparency = 0
            vo.LineWidth = 1.0
            try:
                vo.Lighting = "Two side"
            except Exception:
                pass

    # Get the active 3D view
    view = FreeCADGui.getDocument(doc.Name).activeView()

    # Configure view
    view.setAnimationEnabled(False)

    # Set isometric orientation
    view.viewIsometric()

    # Fit all objects in view
    FreeCADGui.SendMsgToActiveView("ViewFit")

    # Set visual style to solid shaded
    try:
        view.setDrawStyle("As Is")
    except Exception:
        pass

    # Save the rendered image
    view.saveImage(output_png_path, width, height, "White")

    FreeCAD.closeDocument(doc.Name)
    return True


def render_with_mesh_fallback():
    """
    Fallback: render using matplotlib with STL mesh data.
    Used when FreeCADGui is not available.
    """
    import FreeCAD
    import Part
    import Mesh

    doc = FreeCAD.newDocument("RenderFallback")
    Part.insert(step_path, doc.Name)
    doc.recompute()

    # Get shape
    shape = None
    for obj in doc.Objects:
        if hasattr(obj, "Shape") and obj.Shape and obj.Shape.Volume > 0:
            shape = obj.Shape
            break

    if shape is None:
        FreeCAD.closeDocument(doc.Name)
        return False

    # Tessellate
    verts, tris = shape.tessellate(0.1)
    FreeCAD.closeDocument(doc.Name)

    # Render with matplotlib
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from mpl_toolkits.mplot3d.art3d import Poly3DCollection
        import numpy as np

        fig = plt.figure(figsize=(width / 100, height / 100), dpi=100)
        ax = fig.add_subplot(111, projection="3d")

        # Build polygons
        polys = []
        for tri in tris:
            polygon = [
                [verts[tri[0]].x, verts[tri[0]].y, verts[tri[0]].z],
                [verts[tri[1]].x, verts[tri[1]].y, verts[tri[1]].z],
                [verts[tri[2]].x, verts[tri[2]].y, verts[tri[2]].z],
            ]
            polys.append(polygon)

        collection = Poly3DCollection(polys,
                                       facecolors="#B0BCC4",
                                       edgecolors="#8090A0",
                                       linewidths=0.1,
                                       alpha=1.0)
        ax.add_collection3d(collection)

        # Set axis limits
        all_pts = np.array([[v.x, v.y, v.z] for v in verts])
        mins = all_pts.min(axis=0)
        maxs = all_pts.max(axis=0)
        center = (mins + maxs) / 2
        span = max(maxs - mins) / 2 * 1.2

        ax.set_xlim(center[0] - span, center[0] + span)
        ax.set_ylim(center[1] - span, center[1] + span)
        ax.set_zlim(center[2] - span, center[2] + span)

        # Isometric-ish view
        ax.view_init(elev=30, azim=-45)
        ax.set_axis_off()
        ax.set_facecolor("white")
        fig.patch.set_facecolor("white")

        plt.tight_layout(pad=0)
        plt.savefig(output_png_path, dpi=150, bbox_inches="tight",
                    facecolor="white", pad_inches=0.05)
        plt.close(fig)
        return True
    except Exception as e:
        print(f"Matplotlib fallback failed: {e}", file=sys.stderr)
        return False


if __name__ == "__main__":
    success = False
    error_msg = ""

    # Try GUI rendering first (requires Xvfb)
    try:
        success = render_with_gui()
    except Exception as e:
        error_msg = str(e)
        print(f"GUI rendering failed: {e}, trying fallback...", file=sys.stderr)

    # Fallback to matplotlib
    if not success:
        try:
            success = render_with_mesh_fallback()
        except Exception as e:
            error_msg += f"; Fallback also failed: {e}"

    result = {"success": success}
    if not success:
        result["error"] = error_msg

    print("===JSON_START===")
    print(json.dumps(result))
    print("===JSON_END===")
