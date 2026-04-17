"""
Core unfolding algorithm.

Takes the bend graph (tree), bend info, thickness, and K-factors,
and produces a 2D flat pattern: outer contour, bend lines, hole positions.

Algorithm:
  1. Pick the base flange (largest area).
  2. Project the base flange onto XY.
  3. BFS through the bend graph; for each bend, rotate the next flange
     around the bend axis until coplanar, offset by the bend allowance.
  4. Collect all edges into a combined 2D flat pattern.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional

from OCP.gp import gp_Trsf, gp_Vec, gp_Pnt, gp_Dir, gp_Ax1, gp_Ax3, gp_Pln
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE, TopAbs_WIRE, TopAbs_VERTEX
from OCP.TopoDS import TopoDS, TopoDS_Face, TopoDS_Edge
from OCP.BRep import BRep_Tool
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.GeomAbs import GeomAbs_Line, GeomAbs_Circle
from OCP.BRepAdaptor import BRepAdaptor_Curve

from core.step_parser import Topology
from core.face_classifier import ClassifiedFace, FaceType
from core.bend_detector import BendInfo
from core.bend_graph import BendGraph
from core.kfactor import compute_bend, BendCalc

try:
    import pyclipper  # 2D polygon union for real flange outlines
    _HAS_PYCLIPPER = True
except Exception:
    _HAS_PYCLIPPER = False

# Scale used to convert mm → int when feeding polygons to pyclipper. 1e4
# gives us 0.1 µm resolution, well below anything sheet-metal cares about.
_CLIPPER_SCALE = 10_000


@dataclass
class Edge2D:
    """A 2D edge segment."""
    start: Tuple[float, float]
    end: Tuple[float, float]
    edge_type: str = "line"  # "line" or "arc"
    # Arc extras
    center: Optional[Tuple[float, float]] = None
    radius: Optional[float] = None


@dataclass
class BendLine2D:
    """A bend line in the flat pattern."""
    start: Tuple[float, float]
    end: Tuple[float, float]
    bend_info: BendInfo
    bend_calc: BendCalc


@dataclass
class Hole2D:
    """A hole / internal cutout in the flat pattern."""
    edges: List[Edge2D] = field(default_factory=list)
    center: Optional[Tuple[float, float]] = None
    diameter: Optional[float] = None


@dataclass
class FlatPattern:
    """Complete 2D flat pattern result."""
    outer_edges: List[Edge2D] = field(default_factory=list)
    bend_lines: List[BendLine2D] = field(default_factory=list)
    holes: List[Hole2D] = field(default_factory=list)
    width: float = 0.0   # mm
    height: float = 0.0  # mm
    # Per-flange dimensions for the dimension chain
    flange_widths: List[float] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def unfold(
    topo: Topology,
    classified: List[ClassifiedFace],
    bends: List[BendInfo],
    bend_graph: BendGraph,
    thickness: float,
    k_factor: float,
) -> FlatPattern:
    """
    Unfold the sheet metal part into a 2D flat pattern.

    Uses a simplified approach for robustness:
      - Measure flange widths along the primary bending direction
      - Compute bend allowances
      - Lay out flanges sequentially with BA gaps
      - Place bend lines at the centres of the BA gaps

    This handles the most common sheet metal geometries (L-brackets, U-channels,
    Z-brackets, boxes) without needing full OCC Boolean operations on 2D shapes.
    """
    fp = FlatPattern()

    if not bend_graph.unfolding_order:
        # No bends — just project the base flange
        return _unfold_no_bends(topo, classified, fp)

    # Build a lookup: bend_id → BendInfo
    bend_map: Dict[int, BendInfo] = {b.bend_id: b for b in bends}

    # Map face index → ClassifiedFace
    cf_map: Dict[int, ClassifiedFace] = {cf.info.index: cf for cf in classified}

    # ── Compute the pattern height ──────────────────────────────────────────
    # Pattern height = the bend line length = the dimension perpendicular
    # to the bending direction.  Use the median bend length.
    bend_lengths = [b.length for b in bends if b.length > 0]
    if bend_lengths:
        bend_lengths.sort()
        pattern_height = bend_lengths[len(bend_lengths) // 2]
    else:
        # Fallback: use the second-largest bounding box dimension
        pattern_height = _fallback_height(topo, classified, bend_graph)

    # ── Walk the unfolding order and accumulate flat segments ────────────────
    accumulated_x = 0.0
    segments: List[dict] = []  # {type: "flange"|"bend", width, ...}
    bend_positions: List[dict] = []

    # Start with the base flange
    base_idx = bend_graph.base_flange
    base_width = _measure_flange_width(topo, cf_map.get(base_idx), bends, pattern_height)
    segments.append({"type": "flange", "width": base_width, "face_idx": base_idx})
    accumulated_x += base_width
    fp.flange_widths.append(round(base_width, 2))

    for from_flange, bend_id, to_flange in bend_graph.unfolding_order:
        bi = bend_map.get(bend_id)
        if bi is None:
            continue

        # Compute bend allowance
        bc = compute_bend(bi.angle_deg, bi.inner_radius, thickness, k_factor)

        # Record bend position
        bend_positions.append({
            "x": accumulated_x,
            "ba": bc.bend_allowance,
            "bend_info": bi,
            "bend_calc": bc,
        })

        segments.append({"type": "bend", "width": bc.bend_allowance})
        accumulated_x += bc.bend_allowance

        # Measure the next flange width
        flange_width = _measure_flange_width(
            topo, cf_map.get(to_flange), bends, pattern_height
        )
        segments.append({"type": "flange", "width": flange_width, "face_idx": to_flange})
        accumulated_x += flange_width
        fp.flange_widths.append(round(flange_width, 2))

    total_width = accumulated_x
    fp.width = round(total_width, 2)
    fp.height = round(pattern_height, 2)

    # ── Build the outer contour ─────────────────────────────────────────────
    # Try to compose the real outline by projecting each flange's true face
    # shape and unioning the pieces along the accumulated X strip. Falls back
    # to a rectangular outline if projection/union fails for any reason —
    # callers still get a usable flat pattern + warning.
    outline_poly, composed_holes = _compose_multi_flange_outline(
        topo, cf_map, segments, pattern_height
    )
    if outline_poly:
        fp.outer_edges = _edges_from_polyline(outline_poly)
        for hp in composed_holes:
            fp.holes.append(Hole2D(edges=_edges_from_polyline(hp)))
        # Refresh width/height from the actual composed outline.
        xs = [p[0] for p in outline_poly]
        ys = [p[1] for p in outline_poly]
        fp.width = round(max(xs) - min(xs), 2)
        fp.height = round(max(ys) - min(ys), 2)
    else:
        fp.outer_edges = _build_rectangular_outline(total_width, pattern_height)
        if not _HAS_PYCLIPPER:
            fp.warnings.append(
                "pyclipper not installed — outline approximated as bounding "
                "rectangle. Install pyclipper to recover true flange shape."
            )
        else:
            fp.warnings.append(
                "Flange projection failed — outline approximated as bounding "
                "rectangle."
            )

    # ── Place bend lines ────────────────────────────────────────────────────
    for bp in bend_positions:
        bend_center_x = bp["x"] + bp["ba"] / 2.0
        y_lo, y_hi = _outline_y_range_at_x(fp.outer_edges, bend_center_x)
        if y_hi <= y_lo:
            y_lo, y_hi = 0.0, pattern_height
        bl = BendLine2D(
            start=(round(bend_center_x, 4), round(y_lo, 4)),
            end=(round(bend_center_x, 4), round(y_hi, 4)),
            bend_info=bp["bend_info"],
            bend_calc=bp["bend_calc"],
        )
        fp.bend_lines.append(bl)

    # ── Extract holes from flanges ──────────────────────────────────────────
    # If _compose_multi_flange_outline already placed holes, skip the legacy
    # per-flange circle detector — the projection path is more accurate.
    if not fp.holes:
        _extract_holes(topo, classified, fp, segments, pattern_height)

    # ── Warnings ────────────────────────────────────────────────────────────
    _check_warnings(fp, bends, thickness)

    return fp


# ── Helpers ────────────────────────────────────────────────────────────────


def _unfold_no_bends(
    topo: Topology, classified: List[ClassifiedFace], fp: FlatPattern
) -> FlatPattern:
    """Handle the simple case where there are no bends (flat plate)."""
    flanges = [cf for cf in classified if cf.face_type == FaceType.FLANGE]
    if not flanges:
        if topo.bbox:
            dims = sorted([
                topo.bbox[3] - topo.bbox[0],
                topo.bbox[4] - topo.bbox[1],
                topo.bbox[5] - topo.bbox[2],
            ])
            fp.width = round(dims[2], 2)  # largest
            fp.height = round(dims[1], 2)  # second largest
        return fp

    largest = max(flanges, key=lambda cf: cf.info.area)

    # Project the actual face outline onto 2D (in the face's own plane). This
    # gives us the true outer/inner contours rather than an axis-aligned
    # bounding rectangle — important for non-rectangular plates (notches, slots,
    # radiused corners) and for downstream nesting / drawing accuracy.
    outer, holes = _project_face_to_2d(largest.info.face)

    if outer:
        fp.outer_edges = _edges_from_polyline(outer)
        xs = [p[0] for p in outer]
        ys = [p[1] for p in outer]
        fp.width = round(max(xs) - min(xs), 2)
        fp.height = round(max(ys) - min(ys), 2)
        # Attach hole polylines (each is a closed contour in face-plane coords).
        for hole_pts in holes:
            fp.holes.append(Hole2D(edges=_edges_from_polyline(hole_pts)))
        return fp

    # Fallback: bounding-box-derived rectangle if projection failed.
    bbox = Bnd_Box()
    BRepBndLib.Add_s(largest.info.face, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
    dims = sorted([xmax - xmin, ymax - ymin, zmax - zmin])
    fp.width = round(dims[2], 2)
    fp.height = round(dims[1], 2)
    fp.outer_edges = _build_rectangular_outline(fp.width, fp.height)
    return fp


def _measure_flange_width(
    topo: Topology,
    cf: Optional[ClassifiedFace],
    bends: List[BendInfo],
    pattern_height: float,
) -> float:
    """
    Measure the width of a flange in the bending direction.

    The "width" is the dimension perpendicular to the bend line
    (i.e. the dimension that contributes to the flat pattern length).
    """
    if cf is None:
        return 10.0  # fallback

    face = cf.info.face
    bbox = Bnd_Box()
    BRepBndLib.Add_s(face, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()

    dims = sorted([xmax - xmin, ymax - ymin, zmax - zmin])
    # The flange "width" is the dimension that is NOT the height and NOT the thickness.
    # Height ≈ pattern_height (the bend line length).
    # Thickness ≈ smallest dimension (filtered out).
    # Width ≈ the remaining dimension.

    # Find the dimension closest to pattern_height → that's the height direction
    # The other large dimension is the width.
    candidates = []
    for d in dims:
        if d > 0.1:
            candidates.append(d)

    if len(candidates) < 2:
        return candidates[0] if candidates else 10.0

    # Sort candidates: the one closest to pattern_height is the height
    # The other is the width
    best_width = 10.0
    min_diff = float("inf")
    for i, d in enumerate(candidates):
        diff = abs(d - pattern_height)
        if diff < min_diff:
            min_diff = diff
            # Width is the OTHER dimension
            remaining = [c for j, c in enumerate(candidates) if j != i]
            if remaining:
                best_width = max(remaining)

    return best_width


def _fallback_height(
    topo: Topology,
    classified: List[ClassifiedFace],
    bend_graph: BendGraph,
) -> float:
    """Estimate pattern height from the base flange bounding box."""
    if bend_graph.base_flange is not None:
        fi = topo.faces[bend_graph.base_flange]
        bbox = Bnd_Box()
        BRepBndLib.Add_s(fi.face, bbox)
        xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
        dims = sorted([xmax - xmin, ymax - ymin, zmax - zmin])
        return dims[-2] if len(dims) >= 2 else dims[-1]

    if topo.bbox:
        dims = sorted([
            topo.bbox[3] - topo.bbox[0],
            topo.bbox[4] - topo.bbox[1],
            topo.bbox[5] - topo.bbox[2],
        ])
        return dims[-2]

    return 50.0  # absolute fallback


def _build_rectangular_outline(width: float, height: float) -> List[Edge2D]:
    """Build a simple rectangular outline."""
    w = round(width, 4)
    h = round(height, 4)
    return [
        Edge2D(start=(0, 0), end=(w, 0)),
        Edge2D(start=(w, 0), end=(w, h)),
        Edge2D(start=(w, h), end=(0, h)),
        Edge2D(start=(0, h), end=(0, 0)),
    ]


def _edges_from_polyline(pts: List[Tuple[float, float]]) -> List[Edge2D]:
    """Convert a closed polyline of points into a list of Edge2D segments."""
    edges: List[Edge2D] = []
    if len(pts) < 2:
        return edges
    for i in range(len(pts)):
        a = pts[i]
        b = pts[(i + 1) % len(pts)]
        if abs(a[0] - b[0]) < 1e-9 and abs(a[1] - b[1]) < 1e-9:
            continue
        edges.append(Edge2D(
            start=(round(a[0], 4), round(a[1], 4)),
            end=(round(b[0], 4), round(b[1], 4)),
        ))
    return edges


def _project_face_to_2d(face: TopoDS_Face) -> Tuple[List[Tuple[float, float]], List[List[Tuple[float, float]]]]:
    """
    Project a planar face's outer and inner wires into the face's own 2D plane.

    Returns (outer_points, [hole_points, ...]). Coordinates are normalised so
    the outer contour starts at (0, 0) — i.e. its bounding-box min is the
    origin. Points are ordered along each wire using the parametric range of
    its edges, with curves discretised at ~1° steps.

    Returns empty lists on any failure (non-planar surface, OCC exceptions, …).
    """
    try:
        adaptor = BRepAdaptor_Surface(face)
        from OCP.GeomAbs import GeomAbs_Plane as _GeomAbs_Plane
        if adaptor.GetType() != _GeomAbs_Plane:
            return [], []
        plane = adaptor.Plane()
        origin = plane.Location()
        ax_x = plane.XAxis().Direction()
        ax_y = plane.YAxis().Direction()

        def to_uv(pnt: gp_Pnt) -> Tuple[float, float]:
            dx = pnt.X() - origin.X()
            dy = pnt.Y() - origin.Y()
            dz = pnt.Z() - origin.Z()
            u = dx * ax_x.X() + dy * ax_x.Y() + dz * ax_x.Z()
            v = dx * ax_y.X() + dy * ax_y.Y() + dz * ax_y.Z()
            return (u, v)

        from OCP.ShapeAnalysis import ShapeAnalysis
        outer_wire = ShapeAnalysis.OuterWire_s(face)
        if outer_wire is None or outer_wire.IsNull():
            return [], []

        outer_points = _wire_to_polyline(outer_wire, to_uv)
        if len(outer_points) < 3:
            return [], []

        # Extract holes = all wires other than the outer one.
        hole_polylines: List[List[Tuple[float, float]]] = []
        wire_explorer = TopExp_Explorer(face, TopAbs_WIRE)
        while wire_explorer.More():
            wire = TopoDS.Wire_s(wire_explorer.Current())
            if not wire.IsSame(outer_wire):
                pts = _wire_to_polyline(wire, to_uv)
                if len(pts) >= 3:
                    hole_polylines.append(pts)
            wire_explorer.Next()

        # Translate so the outer contour's bounding box starts at (0, 0).
        xs = [p[0] for p in outer_points]
        ys = [p[1] for p in outer_points]
        minx, miny = min(xs), min(ys)
        outer_points = [(x - minx, y - miny) for (x, y) in outer_points]
        hole_polylines = [
            [(x - minx, y - miny) for (x, y) in h] for h in hole_polylines
        ]
        return outer_points, hole_polylines
    except Exception:
        return [], []


def _wire_to_polyline(wire, to_uv) -> List[Tuple[float, float]]:
    """
    Walk a wire's edges and return a list of 2D points sampled along each
    edge. Straight edges contribute their endpoints; curves are discretised
    into ~1° steps (or a minimum of 8 steps per edge).
    """
    try:
        from OCP.BRepTools import BRepTools_WireExplorer
    except Exception:
        BRepTools_WireExplorer = None  # type: ignore

    pts: List[Tuple[float, float]] = []

    def add(p: Tuple[float, float]) -> None:
        if not pts:
            pts.append(p)
            return
        last = pts[-1]
        if abs(last[0] - p[0]) < 1e-4 and abs(last[1] - p[1]) < 1e-4:
            return
        pts.append(p)

    try:
        if BRepTools_WireExplorer is not None:
            exp = BRepTools_WireExplorer(wire)
            while exp.More():
                edge = TopoDS.Edge_s(exp.Current())
                _sample_edge(edge, to_uv, add)
                exp.Next()
        else:
            exp = TopExp_Explorer(wire, TopAbs_EDGE)
            while exp.More():
                edge = TopoDS.Edge_s(exp.Current())
                _sample_edge(edge, to_uv, add)
                exp.Next()
    except Exception:
        return []

    # Drop the closing duplicate so the polyline is an open list of unique pts.
    if len(pts) > 2:
        first = pts[0]
        last = pts[-1]
        if abs(first[0] - last[0]) < 1e-3 and abs(first[1] - last[1]) < 1e-3:
            pts.pop()
    return pts


def _sample_edge(edge, to_uv, add) -> None:
    """Discretise a single edge and feed its 2D points to the accumulator."""
    try:
        curve = BRepAdaptor_Curve(edge)
    except Exception:
        return

    try:
        u0 = curve.FirstParameter()
        u1 = curve.LastParameter()
    except Exception:
        return

    # Straight edges: just the two endpoints.
    ctype = curve.GetType()
    if ctype == GeomAbs_Line:
        add(to_uv(curve.Value(u0)))
        add(to_uv(curve.Value(u1)))
        return

    # Curved edges: sample adaptively — ~1° steps for circles, fixed 24 for
    # everything else (splines, ellipses, etc.).
    steps = 24
    if ctype == GeomAbs_Circle:
        try:
            sweep_deg = abs(math.degrees(u1 - u0))
        except Exception:
            sweep_deg = 360.0
        steps = max(8, int(math.ceil(sweep_deg)))

    for i in range(steps + 1):
        t = u0 + (u1 - u0) * (i / steps)
        try:
            add(to_uv(curve.Value(t)))
        except Exception:
            continue


def _compose_multi_flange_outline(
    topo: Topology,
    cf_map: Dict[int, "ClassifiedFace"],
    segments: List[dict],
    pattern_height: float,
) -> Tuple[List[Tuple[float, float]], List[List[Tuple[float, float]]]]:
    """
    Build the true outer contour for a multi-flange unfolding by laying each
    flange's actual projected outline side-by-side along X, separated by the
    bend-allowance gaps already recorded in *segments*, then unioning the
    pieces with pyclipper.

    Returns (outer_polyline, holes) where:
      - outer_polyline is a closed list of (x, y) points, CCW, or [] on failure
      - holes is a list of closed polylines in the same coordinate system.

    Returns ([], []) if pyclipper is unavailable, if any flange fails to
    project, or if the union produces zero / multiple disjoint outers —
    caller falls back to the rectangular outline in that case.
    """
    if not _HAS_PYCLIPPER:
        return [], []

    # Walk segments, collecting (x_start, face_idx) tuples for each flange.
    # X positions are measured along the flat pattern. Bend segments contribute
    # only to the accumulated X offset — their face is not projected directly.
    x_cursor = 0.0
    flange_placements: List[Tuple[float, int]] = []
    for seg in segments:
        if seg["type"] == "flange":
            fi = seg.get("face_idx", -1)
            if fi >= 0:
                flange_placements.append((x_cursor, fi))
        x_cursor += max(0.0, float(seg.get("width", 0.0)))

    if not flange_placements:
        return [], []

    try:
        flange_polys: List[List[Tuple[float, float]]] = []
        flange_holes: List[List[Tuple[float, float]]] = []

        for x_start, face_idx in flange_placements:
            face_info = topo.faces[face_idx]
            outer_pts, hole_pts_list = _project_face_to_2d(face_info.face)
            if not outer_pts:
                return [], []

            outer_aligned = _align_flange_to_strip(
                outer_pts, hole_pts_list, x_start, pattern_height
            )
            if not outer_aligned:
                return [], []
            flange_polys.append(outer_aligned[0])
            flange_holes.extend(outer_aligned[1])

        # Union the flanges — pyclipper expects ints.
        subj = [
            [(int(round(x * _CLIPPER_SCALE)), int(round(y * _CLIPPER_SCALE)))
             for (x, y) in poly]
            for poly in flange_polys
        ]

        pc = pyclipper.Pyclipper()
        pc.AddPaths(subj, pyclipper.PT_SUBJECT, True)
        solution = pc.Execute(
            pyclipper.CT_UNION,
            pyclipper.PFT_NONZERO,
            pyclipper.PFT_NONZERO,
        )

        if not solution:
            return [], []

        # Expect exactly one outer ring (positively-oriented); any inner rings
        # returned are implicit holes produced by the union (rare for strips).
        outers = []
        inners = []
        for ring in solution:
            if pyclipper.Orientation(ring):
                outers.append(ring)
            else:
                inners.append(ring)

        if len(outers) != 1:
            return [], []

        outer_mm = [
            (x / _CLIPPER_SCALE, y / _CLIPPER_SCALE) for (x, y) in outers[0]
        ]

        holes_mm: List[List[Tuple[float, float]]] = []
        for ring in inners:
            holes_mm.append(
                [(x / _CLIPPER_SCALE, y / _CLIPPER_SCALE) for (x, y) in ring]
            )
        # Append any flange-local holes (they're already in strip coordinates).
        holes_mm.extend(flange_holes)

        return outer_mm, holes_mm
    except Exception:
        return [], []


def _align_flange_to_strip(
    outer_pts: List[Tuple[float, float]],
    hole_pts_list: List[List[Tuple[float, float]]],
    x_start: float,
    pattern_height: float,
) -> Optional[Tuple[List[List[Tuple[float, float]]], List[List[Tuple[float, float]]]]]:
    """
    Position a flange's projected outline into the flat-pattern strip so that
    its shortest axis becomes the bending direction (X) and its longest axis
    becomes the transverse direction (Y).

    _project_face_to_2d normalises the outline to have its bounding-box min at
    the origin. We rotate (if needed) so the Y span matches pattern_height,
    centre vertically on pattern_height/2, then translate so the flange's
    left edge sits at x_start.

    Returns ([outer_aligned], holes_aligned) or None on failure.
    """
    if not outer_pts:
        return None

    xs = [p[0] for p in outer_pts]
    ys = [p[1] for p in outer_pts]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)

    # If the projection is oriented with its "long" axis along X but the
    # flat-pattern strip's height is along Y, rotate 90° so the longer axis
    # becomes Y. We pick the axis whose span is closer to pattern_height as Y.
    def _swap(poly):
        return [(p[1], p[0]) for p in poly]

    diff_no_swap = abs(h - pattern_height)
    diff_swap = abs(w - pattern_height)
    if diff_swap < diff_no_swap:
        outer_pts = _swap(outer_pts)
        hole_pts_list = [_swap(h) for h in hole_pts_list]
        xs = [p[0] for p in outer_pts]
        ys = [p[1] for p in outer_pts]
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)

    # Re-normalise to (0, 0) then centre vertically about pattern_height / 2.
    minx = min(xs)
    miny = min(ys)
    y_offset = (pattern_height - h) / 2.0

    def _place(poly):
        return [(p[0] - minx + x_start, p[1] - miny + y_offset) for p in poly]

    outer_aligned = _place(outer_pts)
    holes_aligned = [_place(h) for h in hole_pts_list]

    return [outer_aligned], holes_aligned


def _outline_y_range_at_x(
    edges: List[Edge2D], x: float
) -> Tuple[float, float]:
    """
    Return the (y_min, y_max) range of the outline's coverage at the given x.
    Used to clamp bend lines to the actual outline height at the bend
    position. Falls back to the global bbox if the outline doesn't span x.
    """
    ys: List[float] = []
    for e in edges:
        x1, y1 = e.start
        x2, y2 = e.end
        lo_x, hi_x = min(x1, x2), max(x1, x2)
        if lo_x - 1e-6 <= x <= hi_x + 1e-6:
            if abs(x2 - x1) < 1e-9:
                ys.append(y1)
                ys.append(y2)
            else:
                t = (x - x1) / (x2 - x1)
                ys.append(y1 + t * (y2 - y1))
    if len(ys) >= 2:
        return min(ys), max(ys)
    # Fall back to the overall Y range
    all_ys: List[float] = []
    for e in edges:
        all_ys.append(e.start[1])
        all_ys.append(e.end[1])
    if all_ys:
        return min(all_ys), max(all_ys)
    return 0.0, 0.0


def _extract_holes(
    topo: Topology,
    classified: List[ClassifiedFace],
    fp: FlatPattern,
    segments: List[dict],
    pattern_height: float,
) -> None:
    """
    Extract circular holes from flanges and place them in the flat pattern.

    For each flange, find internal wires (holes), transform their positions
    to the flat pattern coordinate system based on the flange's position in
    the unfolding sequence.
    """
    # Build a map: face_idx → x_offset in the flat pattern
    x_offset = 0.0
    flange_offsets: Dict[int, float] = {}
    for seg in segments:
        if seg["type"] == "flange":
            flange_offsets[seg.get("face_idx", -1)] = x_offset
        x_offset += seg["width"]

    for cf in classified:
        if cf.face_type != FaceType.FLANGE:
            continue
        if cf.info.index not in flange_offsets:
            continue

        face = cf.info.face
        offset_x = flange_offsets[cf.info.index]

        # Look for circular edges (holes)
        explorer = TopExp_Explorer(face, TopAbs_EDGE)
        while explorer.More():
            edge = TopoDS.Edge_s(explorer.Current())
            curve = BRepAdaptor_Curve(edge)
            if curve.GetType() == GeomAbs_Circle:
                circle = curve.Circle()
                center = circle.Location()
                radius = circle.Radius()

                # Map hole center to flat pattern coordinates
                # This is simplified — we place relative to the flange bbox
                face_bbox = Bnd_Box()
                BRepBndLib.Add_s(face, face_bbox)
                fxmin, fymin, fzmin, fxmax, fymax, fzmax = face_bbox.Get()

                # Relative position within flange
                cx = center.X()
                cy = center.Y()
                cz = center.Z()

                # Determine which axes map to the flat pattern X and Y
                dims = {
                    "x": fxmax - fxmin,
                    "y": fymax - fymin,
                    "z": fzmax - fzmin,
                }
                sorted_axes = sorted(dims.items(), key=lambda kv: kv[1], reverse=True)

                # Map to 2D: largest dim → along pattern, second → height
                if sorted_axes[0][0] == "x":
                    hx = offset_x + (cx - fxmin)
                elif sorted_axes[0][0] == "y":
                    hx = offset_x + (cy - fymin)
                else:
                    hx = offset_x + (cz - fzmin)

                if sorted_axes[1][0] == "x":
                    hy = cx - fxmin
                elif sorted_axes[1][0] == "y":
                    hy = cy - fymin
                else:
                    hy = cz - fzmin

                # Clamp to pattern bounds
                hx = max(0, min(hx, fp.width))
                hy = max(0, min(hy, fp.height))

                fp.holes.append(Hole2D(
                    center=(round(hx, 2), round(hy, 2)),
                    diameter=round(radius * 2, 2),
                ))

            explorer.Next()


def _check_warnings(fp: FlatPattern, bends: List[BendInfo], thickness: float) -> None:
    """Generate warnings for potential manufacturing issues."""
    for hole in fp.holes:
        if hole.center is None:
            continue
        for bl in fp.bend_lines:
            # Distance from hole center to bend line (vertical line at x)
            dx = abs(hole.center[0] - bl.start[0])
            min_dist = thickness * 2  # Minimum safe distance = 2× thickness
            if dx < min_dist and hole.diameter:
                fp.warnings.append(
                    f"Hole ⌀{hole.diameter:.1f} at ({hole.center[0]:.1f}, "
                    f"{hole.center[1]:.1f}) is {dx:.1f}mm from bend B{bl.bend_info.bend_id} "
                    f"(min recommended: {min_dist:.1f}mm)"
                )
