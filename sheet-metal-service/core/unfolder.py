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
    # to the bending direction. Use the median bend length (robust against
    # outliers like small fillet-generated bends).
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
    #
    # Regardless of outline success, we always collect each flange's inner
    # wires (holes) and map them into flat-pattern coords so holes appear in
    # the DXF even when the outline falls back to a rectangle.
    outline_poly, composed_holes = _compose_multi_flange_outline(
        topo, cf_map, segments, pattern_height, bend_map
    )
    # Append per-flange holes unconditionally (they're in strip coords).
    for hp in composed_holes:
        fp.holes.append(_hole_from_polyline(hp))

    if outline_poly:
        fp.outer_edges = _edges_from_polyline(outline_poly)
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
    # Fallback path: if we got no holes at all from the composition step,
    # try the legacy per-flange wire extractor directly. This catches cases
    # where _project_face_to_2d returned no outer points (e.g. non-planar
    # "flange" face) so _compose_multi_flange_outline never ran per-flange.
    if not fp.holes:
        _extract_holes(topo, classified, fp, segments, pattern_height, bend_map)

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
    bend_map: Optional[Dict[int, BendInfo]] = None,
) -> Tuple[List[Tuple[float, float]], List[List[Tuple[float, float]]]]:
    """
    Build the true outer contour for a multi-flange unfolding by laying each
    flange's actual projected outline side-by-side along X, separated by the
    bend-allowance gaps already recorded in *segments*, then unioning the
    pieces with pyclipper.

    Returns (outer_polyline, holes) where:
      - outer_polyline is a closed list of (x, y) points, CCW, or [] on failure
      - holes is a list of closed polylines in the same coordinate system.

    *holes is always returned even if the outer-polyline union fails* — that
    way callers can still render hole data on top of the rectangular fallback.
    """
    # Walk segments, collecting (x_start, bend_before, face_idx) tuples for
    # each flange. X positions are measured along the flat pattern. Bend
    # segments contribute only to the accumulated X offset — their face is
    # not projected directly. `bend_before` is the BendInfo of the bend that
    # precedes this flange in the unfolding order (None for the base flange).
    x_cursor = 0.0
    flange_placements: List[Tuple[float, int, Optional[BendInfo]]] = []
    pending_bend: Optional[BendInfo] = None
    for seg in segments:
        if seg["type"] == "flange":
            fi = seg.get("face_idx", -1)
            if fi >= 0:
                flange_placements.append((x_cursor, fi, pending_bend))
            pending_bend = None
        elif seg["type"] == "bend":
            # A bend segment carries BendInfo on the next flange placement.
            pending_bend = seg.get("bend_info")
        x_cursor += max(0.0, float(seg.get("width", 0.0)))

    if not flange_placements:
        return [], []

    flange_polys: List[List[Tuple[float, float]]] = []
    flange_holes: List[List[Tuple[float, float]]] = []
    projection_ok = True

    for x_start, face_idx, bend_before in flange_placements:
        try:
            face_info = topo.faces[face_idx]
            outer_pts, hole_pts_list = _project_face_to_2d(face_info.face)
            if not outer_pts:
                projection_ok = False
                continue

            aligned = _align_flange_to_strip(
                outer_pts, hole_pts_list, x_start, pattern_height,
                face_info.face, bend_before,
            )
            if aligned is None:
                projection_ok = False
                continue
            flange_polys.append(aligned[0][0])
            flange_holes.extend(aligned[1])
        except Exception:
            projection_ok = False
            continue

    # Outline union: only attempted if pyclipper is installed AND we have
    # at least one successfully-projected flange outline.
    outer_mm: List[Tuple[float, float]] = []
    if _HAS_PYCLIPPER and flange_polys:
        try:
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
            if solution:
                outers = [r for r in solution if pyclipper.Orientation(r)]
                inners = [r for r in solution if not pyclipper.Orientation(r)]
                if len(outers) == 1:
                    outer_mm = [
                        (x / _CLIPPER_SCALE, y / _CLIPPER_SCALE)
                        for (x, y) in outers[0]
                    ]
                    # Inner rings from the union become additional holes.
                    for ring in inners:
                        flange_holes.append(
                            [(x / _CLIPPER_SCALE, y / _CLIPPER_SCALE)
                             for (x, y) in ring]
                        )
        except Exception:
            outer_mm = []

    return outer_mm, flange_holes


def _align_flange_to_strip(
    outer_pts: List[Tuple[float, float]],
    hole_pts_list: List[List[Tuple[float, float]]],
    x_start: float,
    pattern_height: float,
    face: Optional[TopoDS_Face] = None,
    bend_before: Optional[BendInfo] = None,
) -> Optional[Tuple[List[List[Tuple[float, float]]], List[List[Tuple[float, float]]]]]:
    """
    Position a flange's projected outline into the flat-pattern strip.

    The flat pattern uses Y as the bend-line-parallel direction (pattern_height)
    and X as the bending direction. To place a flange correctly we need to
    rotate its projected outline so that the bend axis — which is shared
    between the two flanges meeting at the bend — ends up parallel to +Y.

    Strategy:
      1. If we know the bend axis 3D direction AND the face plane, project
         the 3D bend axis into the face's local (u, v) coords and rotate
         the outline so that projected direction becomes +Y.
      2. Otherwise fall back to the span-matching heuristic (longer axis → Y).

    _project_face_to_2d normalises the outline to have its bounding-box min at
    the origin. After rotation we re-normalise, centre vertically on
    pattern_height/2, then translate so the flange's left edge sits at x_start.

    Returns ([outer_aligned], holes_aligned) or None on failure.
    """
    if not outer_pts:
        return None

    # ── 1. Compute desired rotation angle ────────────────────────────────
    angle = None
    if face is not None and bend_before is not None:
        angle = _bend_axis_angle_in_face(face, bend_before)

    if angle is not None:
        # Rotate so the bend axis points along +Y in face coords (angle=90°).
        target = math.pi / 2.0
        theta = target - angle
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)

        def _rot(poly):
            return [
                (p[0] * cos_t - p[1] * sin_t, p[0] * sin_t + p[1] * cos_t)
                for p in poly
            ]
        outer_pts = _rot(outer_pts)
        hole_pts_list = [_rot(h) for h in hole_pts_list]
    else:
        # Heuristic fallback: rotate 90° if swapping axes makes h closer to
        # pattern_height. This isn't exact for non-axis-aligned faces but is
        # the best we can do without bend-axis info.
        xs0 = [p[0] for p in outer_pts]
        ys0 = [p[1] for p in outer_pts]
        w0 = max(xs0) - min(xs0)
        h0 = max(ys0) - min(ys0)
        if abs(w0 - pattern_height) < abs(h0 - pattern_height):
            def _swap(poly):
                return [(p[1], p[0]) for p in poly]
            outer_pts = _swap(outer_pts)
            hole_pts_list = [_swap(h) for h in hole_pts_list]

    # ── 2. Re-normalise & place into strip ───────────────────────────────
    xs = [p[0] for p in outer_pts]
    ys = [p[1] for p in outer_pts]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    minx = min(xs)
    miny = min(ys)
    y_offset = (pattern_height - h) / 2.0

    def _place(poly):
        return [(p[0] - minx + x_start, p[1] - miny + y_offset) for p in poly]

    outer_aligned = _place(outer_pts)
    holes_aligned = [_place(h) for h in hole_pts_list]

    return [outer_aligned], holes_aligned


def _bend_axis_angle_in_face(
    face: TopoDS_Face,
    bend: BendInfo,
) -> Optional[float]:
    """
    Project the 3D bend axis direction onto the face's local (u, v) plane
    coords and return the angle (radians) of that projected direction.

    Returns None if the face isn't planar or the axis is perpendicular to
    the plane (ambiguous projection).
    """
    try:
        adaptor = BRepAdaptor_Surface(face)
        from OCP.GeomAbs import GeomAbs_Plane as _GeomAbs_Plane
        if adaptor.GetType() != _GeomAbs_Plane:
            return None
        plane = adaptor.Plane()
        ax_x = plane.XAxis().Direction()
        ax_y = plane.YAxis().Direction()

        # Bend axis 3D direction from BendInfo.axis tuple.
        ax = bend.axis
        if ax is None:
            return None
        # Project onto face X/Y axes.
        u = ax[0] * ax_x.X() + ax[1] * ax_x.Y() + ax[2] * ax_x.Z()
        v = ax[0] * ax_y.X() + ax[1] * ax_y.Y() + ax[2] * ax_y.Z()
        mag = math.hypot(u, v)
        if mag < 1e-6:
            return None
        return math.atan2(v, u)
    except Exception:
        return None


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
    bend_map: Optional[Dict[int, BendInfo]] = None,
) -> None:
    """
    Fallback hole extractor: walks each flange's inner wires and projects
    them into flat-pattern coords.

    Unlike the old circle-only implementation this handles ANY hole shape
    — circles, slots, rectangular cutouts, arbitrary wires — by calling
    the same face-plane projection + strip alignment pipeline used by the
    main outline composition. Used when _compose_multi_flange_outline
    collected nothing (e.g. all flange projections failed).
    """
    # Build a map: face_idx → (x_offset, bend_before_this_flange)
    x_offset = 0.0
    flange_offsets: Dict[int, Tuple[float, Optional[BendInfo]]] = {}
    pending_bend: Optional[BendInfo] = None
    for seg in segments:
        if seg["type"] == "flange":
            flange_offsets[seg.get("face_idx", -1)] = (x_offset, pending_bend)
            pending_bend = None
        elif seg["type"] == "bend":
            pending_bend = seg.get("bend_info")
        x_offset += seg["width"]

    cf_map = {cf.info.index: cf for cf in classified}

    for face_idx, (offset_x, bend_before) in flange_offsets.items():
        cf = cf_map.get(face_idx)
        if cf is None or cf.face_type != FaceType.FLANGE:
            continue

        face = cf.info.face
        outer_pts, hole_pts_list = _project_face_to_2d(face)
        if not hole_pts_list:
            # No inner wires — nothing to extract for this flange.
            continue

        aligned = _align_flange_to_strip(
            outer_pts, hole_pts_list, offset_x, pattern_height,
            face, bend_before,
        )
        if aligned is None:
            continue
        _outer, holes_aligned = aligned
        for hole_pts in holes_aligned:
            fp.holes.append(_hole_from_polyline(hole_pts))


def _hole_from_polyline(pts: List[Tuple[float, float]]) -> Hole2D:
    """
    Build a Hole2D from a closed polyline. If the polyline is well
    approximated by a circle (all points roughly equidistant from the
    centroid), emit it as center+diameter so the DXF exporter can write a
    CIRCLE entity; otherwise emit as a polyline of edges (LWPOLYLINE).
    """
    if len(pts) < 3:
        return Hole2D(edges=_edges_from_polyline(pts))

    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    rs = [math.hypot(p[0] - cx, p[1] - cy) for p in pts]
    r_mean = sum(rs) / len(rs)
    if r_mean < 1e-6:
        return Hole2D(edges=_edges_from_polyline(pts))

    max_dev = max(abs(r - r_mean) for r in rs)
    # Treat as circle if max radial deviation is <2% of mean radius
    # AND radius is at least 0.1 mm (avoid degenerate tiny holes).
    if max_dev / r_mean < 0.02 and r_mean > 0.1:
        return Hole2D(
            center=(round(cx, 2), round(cy, 2)),
            diameter=round(r_mean * 2, 2),
        )
    return Hole2D(edges=_edges_from_polyline(pts))


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
