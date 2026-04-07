"""
3D → 2D projection utilities for isometric/orthographic views.

Uses OCC's HLR (Hidden Line Removal) for proper engineering projections,
with a matplotlib fallback.
"""

from __future__ import annotations

import io
import math
from typing import List, Tuple, Optional

from OCP.TopoDS import TopoDS_Shape
from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2, gp_Vec
from OCP.HLRAlgo import HLRAlgo_Projector
from OCP.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib


def project_isometric_svg(
    shape: TopoDS_Shape,
    width: int = 400,
    height: int = 300,
) -> str:
    """
    Generate an SVG string with an isometric projection of *shape*
    using OCC Hidden Line Removal.
    """
    try:
        return _hlr_projection(shape, width, height)
    except Exception:
        return _fallback_bbox_svg(shape, width, height)


def _hlr_projection(shape: TopoDS_Shape, width: int, height: int) -> str:
    """Use OCC HLR for proper hidden-line-removed projection."""
    # Tessellate for HLR
    BRepMesh_IncrementalMesh(shape, 0.1)

    # Isometric view direction: (1, 1, 1) normalised
    inv_sqrt3 = 1.0 / math.sqrt(3.0)
    view_dir = gp_Dir(inv_sqrt3, inv_sqrt3, inv_sqrt3)
    up_dir = gp_Dir(-1, 1, 0)  # approximate up

    origin = gp_Pnt(0, 0, 0)
    ax2 = gp_Ax2(origin, view_dir, up_dir)
    projector = HLRAlgo_Projector(ax2)

    hlr = HLRBRep_Algo()
    hlr.Add(shape)
    hlr.Projector(projector)
    hlr.Update()
    hlr.Hide()

    hlr_shapes = HLRBRep_HLRToShape(hlr)

    # Collect visible and hidden edges
    visible_edges = _extract_hlr_edges(hlr_shapes.VCompound())
    hidden_edges = _extract_hlr_edges(hlr_shapes.HCompound())
    outline_edges = _extract_hlr_edges(hlr_shapes.OutLineVCompound())

    # Compute bounding box of all projected edges
    all_pts = []
    for edges in [visible_edges, hidden_edges, outline_edges]:
        for e in edges:
            all_pts.extend(e)

    if not all_pts:
        return _fallback_bbox_svg(shape, width, height)

    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)

    data_w = xmax - xmin or 1
    data_h = ymax - ymin or 1
    margin = 20
    scale = min((width - 2 * margin) / data_w, (height - 2 * margin) / data_h)

    def tx(x, y):
        return (
            margin + (x - xmin) * scale,
            margin + (ymax - y) * scale,  # flip Y
        )

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="white"/>',
    ]

    # Visible edges
    for seg in visible_edges + outline_edges:
        if len(seg) >= 2:
            p1, p2 = tx(*seg[0]), tx(*seg[1])
            lines.append(
                f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" '
                f'x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" '
                f'stroke="#1A1A2E" stroke-width="1.5"/>'
            )

    # Hidden edges (dashed)
    for seg in hidden_edges:
        if len(seg) >= 2:
            p1, p2 = tx(*seg[0]), tx(*seg[1])
            lines.append(
                f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" '
                f'x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" '
                f'stroke="#808080" stroke-width="0.5" stroke-dasharray="4,3"/>'
            )

    lines.append("</svg>")
    return "\n".join(lines)


def _extract_hlr_edges(compound) -> List[List[Tuple[float, float]]]:
    """Extract 2D line segments from an HLR result compound."""
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopoDS import TopoDS
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Line

    edges = []
    if compound is None:
        return edges

    try:
        explorer = TopExp_Explorer(compound, TopAbs_EDGE)
        while explorer.More():
            edge = TopoDS.Edge_s(explorer.Current())
            try:
                curve = BRepAdaptor_Curve(edge)
                p1 = curve.Value(curve.FirstParameter())
                p2 = curve.Value(curve.LastParameter())
                edges.append([(p1.X(), p1.Y()), (p2.X(), p2.Y())])
            except Exception:
                pass
            explorer.Next()
    except Exception:
        pass

    return edges


def _fallback_bbox_svg(shape: TopoDS_Shape, width: int, height: int) -> str:
    """Simple wireframe bounding box as SVG fallback."""
    bbox = Bnd_Box()
    BRepBndLib.Add_s(shape, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()

    dx, dy, dz = xmax - xmin, ymax - ymin, zmax - zmin

    # Simple isometric projection of the 8 corners
    def iso(x, y, z):
        ix = (x - y) * math.cos(math.radians(30))
        iy = (x + y) * math.sin(math.radians(30)) - z
        return ix, -iy

    corners_3d = [
        (0, 0, 0), (dx, 0, 0), (dx, dy, 0), (0, dy, 0),
        (0, 0, dz), (dx, 0, dz), (dx, dy, dz), (0, dy, dz),
    ]
    corners_2d = [iso(*c) for c in corners_3d]

    xs = [c[0] for c in corners_2d]
    ys = [c[1] for c in corners_2d]
    cxmin, cxmax = min(xs), max(xs)
    cymin, cymax = min(ys), max(ys)
    cw = cxmax - cxmin or 1
    ch = cymax - cymin or 1

    margin = 30
    scale = min((width - 2 * margin) / cw, (height - 2 * margin) / ch)

    def tx(pt):
        return (
            margin + (pt[0] - cxmin) * scale,
            margin + (pt[1] - cymin) * scale,
        )

    # Draw the 12 edges of the box
    box_edges = [
        (0, 1), (1, 2), (2, 3), (3, 0),  # bottom
        (4, 5), (5, 6), (6, 7), (7, 4),  # top
        (0, 4), (1, 5), (2, 6), (3, 7),  # verticals
    ]

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}">',
        f'<rect width="{width}" height="{height}" fill="white"/>',
    ]
    for a, b in box_edges:
        p1 = tx(corners_2d[a])
        p2 = tx(corners_2d[b])
        lines.append(
            f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" '
            f'x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" '
            f'stroke="#2E6EA6" stroke-width="1.5"/>'
        )

    lines.append("</svg>")
    return "\n".join(lines)
