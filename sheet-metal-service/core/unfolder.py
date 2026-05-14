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
from OCP.GeomAbs import GeomAbs_Line, GeomAbs_Circle, GeomAbs_Plane
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
    # Additional disjoint outer contours (e.g. detached flanges that share
    # the base plane but aren't connected to the main chain). The DXF
    # exporter emits each as its own closed LWPOLYLINE on the OUTLINE
    # layer. Empty for simple single-region parts.
    extra_outlines: List[List[Edge2D]] = field(default_factory=list)
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

    # ── Try true 3D unfolding first ────────────────────────────────────────
    # Compose an accumulated gp_Trsf per flange by BFS-walking the bend
    # graph, applying rotations around each bend axis. When it succeeds we
    # also try to fold in orphan flanges (those with no bend-graph
    # connection — e.g. hem features that were filtered out) by matching
    # their plane to a chain flange with parallel normal + close origin.
    result_3d = _unfold_via_3d_transforms(
        topo, classified, bends, bend_graph, thickness, k_factor, bend_map, cf_map,
    )
    if result_3d is not None:
        fp = result_3d
        # Place bend lines at the projected bend axis positions
        _place_bend_lines_3d(
            fp, bends, bend_graph, bend_map, cf_map, topo,
            thickness, k_factor,
        )
        _check_warnings(fp, bends, thickness)
        return fp

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


# ════════════════════════════════════════════════════════════════════════════
# True 3D unfolding via accumulated gp_Trsf transforms
# ════════════════════════════════════════════════════════════════════════════
#
# The 1D-strip approach (above) handles only single-axis bend chains. Real
# parts often have:
#   - Multi-axis bends (one bend around X, the next around Y) — flanges
#     don't lay out into a straight strip.
#   - Hem features (very tight radius bends folding the flange back on
#     itself) — these are filtered out of the bend graph by the angle filter.
#   - Disconnected bend-graph components — face-classification gaps leave
#     some flanges without bend connections; their holes/outline get lost.
#
# The 3D approach: for every flange, compute an accumulated gp_Trsf that
# maps that flange's geometry from its folded 3D position to the flat
# pattern (Z = 0 plane in some chosen "base" coord system). Then project
# each transformed face's outline + holes by dropping Z, and union the
# outlines with pyclipper.
#
# Algorithm:
#   1. Pick a base flange (largest area in the main connected component).
#   2. Compute T_base = transform mapping base plane → world XY plane.
#   3. BFS through the bend graph. For each bend (parent → child):
#        axis_current = T_parent applied to (axis_location, axis_direction)
#        For sign in {+1, -1}: try R_bend = rotation(axis_current, sign·angle)
#                              T_child_candidate = R_bend ∘ T_parent
#                              Pick sign that makes child normal align +Z best.
#        T_child = best T_child_candidate.
#   4. Repeat for additional connected components, offsetting them in 2D.
#   5. For "orphan" flanges (no bend graph connection at all), match them
#      to the chain flange whose plane is parallel and closest in space,
#      then apply that flange's transform. (Captures hem-flange holes.)
#   6. Project all transformed face outlines + holes by dropping Z, union
#      with pyclipper.


def _unfold_via_3d_transforms(
    topo: "Topology",
    classified: List["ClassifiedFace"],
    bends: List[BendInfo],
    bend_graph: "BendGraph",
    thickness: float,
    k_factor: float,
    bend_map: Dict[int, BendInfo],
    cf_map: Dict[int, "ClassifiedFace"],
) -> Optional[FlatPattern]:
    """
    Run the 3D-transform unfolding pipeline. Returns a FlatPattern on
    success, or None on any failure (caller falls back to strip layout).
    """
    base_idx = bend_graph.base_flange
    if base_idx is None:
        return None

    base_cf = cf_map.get(base_idx)
    if base_cf is None:
        return None

    # ── 1. Transform that maps base plane → world XY ─────────────────────
    T_base = _world_to_base_plane_trsf(base_cf.info.face)
    if T_base is None:
        return None

    # ── 2. BFS walk of the main bend chain, computing T per flange ───────
    transforms: Dict[int, gp_Trsf] = {base_idx: T_base}
    _bfs_compose_transforms(
        bend_graph.unfolding_order, bend_map, cf_map, transforms,
        thickness=thickness, k_factor=k_factor,
    )

    # ── 3. Process additional MULTI-NODE connected components ──────────
    # For each multi-node component not in the main chain, try to anchor
    # it to a chain flange via parallel-plane matching: if any member of
    # the component is coplanar (or near-parallel and close) with some
    # chain flange, treat that chain flange's transform as the anchor,
    # then BFS the component starting from the matched member (not by
    # picking a "local base" plane). This means hem-fold pairs like
    # {59, 69} get folded back onto their parent chain flange in 2D
    # rather than being scattered as separate islands.
    component_member_set: set = set()
    try:
        import networkx as nx  # type: ignore
        full_graph = bend_graph.graph
        all_components = [c for c in nx.connected_components(full_graph)]

        # Pre-collect chain flanges' planes for matching.
        chain_planes_for_match: List[Tuple[int, gp_Trsf, gp_Pnt, gp_Dir]] = []
        for cidx in transforms:
            cf_c = cf_map.get(cidx)
            if cf_c is None:
                continue
            pdata = _face_plane_origin_normal(cf_c.info.face)
            if pdata is None:
                continue
            chain_planes_for_match.append(
                (cidx, transforms[cidx], pdata[0], pdata[1])
            )

        ANCHOR_PERP_DIST = max(thickness * 4.0, 3.0)

        for comp in all_components:
            if any(n in transforms for n in comp):
                continue
            if len(comp) < 2:
                # Singleton — handled later via orphan-matching pass.
                continue

            # Find the component member with smallest perpendicular distance
            # to any chain flange's plane (and whose normal is parallel).
            anchor_idx: Optional[int] = None
            anchor_T: Optional[gp_Trsf] = None
            best_perp = float("inf")
            for n in comp:
                cf_n = cf_map.get(n)
                if cf_n is None:
                    continue
                pdata = _face_plane_origin_normal(cf_n.info.face)
                if pdata is None:
                    continue
                n_origin, n_normal = pdata
                for chain_idx, T_chain, p_o, p_n in chain_planes_for_match:
                    dot = (
                        n_normal.X() * p_n.X()
                        + n_normal.Y() * p_n.Y()
                        + n_normal.Z() * p_n.Z()
                    )
                    if abs(abs(dot) - 1.0) > 0.05:
                        continue
                    ox = n_origin.X() - p_o.X()
                    oy = n_origin.Y() - p_o.Y()
                    oz = n_origin.Z() - p_o.Z()
                    perp = abs(
                        ox * p_n.X() + oy * p_n.Y() + oz * p_n.Z()
                    )
                    if perp < best_perp:
                        best_perp = perp
                        anchor_idx = n
                        anchor_T = T_chain
            if anchor_T is None or best_perp > ANCHOR_PERP_DIST:
                # No coplanar chain flange — the component is unrelated
                # geometry. Skip it (don't scatter it across the flat
                # pattern).
                continue

            # BFS from the anchor flange, composing transforms via the
            # component's own bend edges. The anchor's transform IS the
            # chain flange's transform (we treat the anchor flange as
            # coplanar with that chain flange).
            sub = full_graph.subgraph(comp)
            local_t: Dict[int, gp_Trsf] = {anchor_idx: anchor_T}
            local_order: List[Tuple[int, int, int]] = []
            seen = {anchor_idx}
            queue = [anchor_idx]
            while queue:
                cur = queue.pop(0)
                for nbr in sub.neighbors(cur):
                    if nbr in seen:
                        continue
                    seen.add(nbr)
                    edge_data = sub.edges[cur, nbr]
                    bid = edge_data.get("bend_id", 0)
                    local_order.append((cur, bid, nbr))
                    queue.append(nbr)
            _bfs_compose_transforms(
                local_order, bend_map, cf_map, local_t,
                thickness=thickness, k_factor=k_factor,
            )
            # Merge into transforms map (we treat these as part of main flat).
            for face_idx, T in local_t.items():
                if face_idx not in transforms:
                    transforms[face_idx] = T
            component_member_set.update(local_t.keys())
    except Exception:
        pass

    # Empty out the legacy island list (we no longer use islands).
    component_local_transforms: List[Dict[int, gp_Trsf]] = []

    # ── 4. Project chain flanges + holes ─────────────────────────────────
    flange_polys: List[List[Tuple[float, float]]] = []
    hole_polys: List[List[Tuple[float, float]]] = []
    flange_normals_2d: Dict[int, Tuple[float, float, float]] = {}

    for face_idx, T in transforms.items():
        cf = cf_map.get(face_idx)
        if cf is None:
            continue
        outer_pts, hole_pts_list = _flatten_face_via_trsf(cf.info.face, T)
        if outer_pts:
            flange_polys.append(outer_pts)
        hole_polys.extend(hole_pts_list)
        # Record the flange's transformed normal direction (used to skip
        # mismatched orphan-flange matches later).
        n3 = _face_normal_after_trsf(cf.info.face, T)
        if n3 is not None:
            flange_normals_2d[face_idx] = n3

    # ── 5. Process orphan flanges (no bend graph connection) ─────────────
    # Find flanges with parallel plane to a chain flange; copy that
    # chain flange's transform. This captures hem-feature flanges.
    chain_flange_planes: Dict[int, Tuple[gp_Trsf, gp_Pnt, gp_Dir]] = {}
    for face_idx, T in transforms.items():
        cf = cf_map.get(face_idx)
        if cf is None:
            continue
        plane_data = _face_plane_origin_normal(cf.info.face)
        if plane_data is None:
            continue
        chain_flange_planes[face_idx] = (T, plane_data[0], plane_data[1])

    # Orphan flange filter — accept only flanges whose plane is:
    #   (a) parallel to a chain flange's plane (dot ≈ ±1), AND
    #   (b) within ~few thicknesses perpendicular distance of that plane.
    # Condition (a)+(b) characterises duplicates (back side of the same
    # sheet) and hem-side flanges (folded back onto the parent flange).
    # Random unrelated parallel faces further away are rejected.
    ORPHAN_MAX_PLANE_DIST = max(thickness * 4.0, 3.0)

    orphan_holes_added = 0
    for cf in classified:
        if cf.face_type != FaceType.FLANGE:
            continue
        face_idx = cf.info.index
        if face_idx in transforms:
            continue
        if face_idx in component_member_set:
            continue
        # Match to closest parallel chain flange (via perpendicular distance
        # to that plane, not origin-origin distance — same-plane faces can
        # have their origin points far from each other yet be coplanar).
        plane_data = _face_plane_origin_normal(cf.info.face)
        if plane_data is None:
            continue
        my_origin, my_normal = plane_data
        best_T: Optional[gp_Trsf] = None
        best_perp_dist = float("inf")
        for chain_idx, (T_chain, p_o, p_n) in chain_flange_planes.items():
            dot = (
                my_normal.X() * p_n.X()
                + my_normal.Y() * p_n.Y()
                + my_normal.Z() * p_n.Z()
            )
            if abs(abs(dot) - 1.0) > 0.05:
                continue
            # Perpendicular distance from orphan's origin to chain's plane
            ox = my_origin.X() - p_o.X()
            oy = my_origin.Y() - p_o.Y()
            oz = my_origin.Z() - p_o.Z()
            perp = abs(ox * p_n.X() + oy * p_n.Y() + oz * p_n.Z())
            if perp < best_perp_dist:
                best_perp_dist = perp
                best_T = T_chain
        if best_T is None:
            continue
        if best_perp_dist > ORPHAN_MAX_PLANE_DIST:
            # Too far from any chain plane — probably unrelated geometry.
            continue
        # Project this orphan flange using the chain flange's transform.
        # Keep its outline AND holes (so hem holes appear).
        outer_pts, hole_pts_list = _flatten_face_via_trsf(cf.info.face, best_T)
        if outer_pts:
            flange_polys.append(outer_pts)
        if hole_pts_list:
            hole_polys.extend(hole_pts_list)
            orphan_holes_added += len(hole_pts_list)

    # ── 6. Project additional components into separate islands ──────────
    # Compute the bbox of the main result so we know where to offset
    # additional components.
    if not flange_polys and not component_local_transforms:
        return None

    main_bbox = _polys_bbox(flange_polys + hole_polys)
    island_offset_x = (main_bbox[2] - main_bbox[0] + 10.0) if main_bbox else 0.0

    for ct in component_local_transforms:
        local_polys: List[List[Tuple[float, float]]] = []
        local_holes: List[List[Tuple[float, float]]] = []
        for face_idx, T in ct.items():
            cf = cf_map.get(face_idx)
            if cf is None:
                continue
            outer_pts, hole_pts_list = _flatten_face_via_trsf(cf.info.face, T)
            if outer_pts:
                local_polys.append(outer_pts)
            local_holes.extend(hole_pts_list)
        if not local_polys and not local_holes:
            continue
        # Translate to (island_offset_x, 0) of the local bbox
        local_bbox = _polys_bbox(local_polys + local_holes)
        if local_bbox is None:
            continue
        dx = island_offset_x - local_bbox[0]
        dy = -local_bbox[1]
        local_polys = [
            [(p[0] + dx, p[1] + dy) for p in poly] for poly in local_polys
        ]
        local_holes = [
            [(p[0] + dx, p[1] + dy) for p in poly] for poly in local_holes
        ]
        flange_polys.extend(local_polys)
        hole_polys.extend(local_holes)
        island_offset_x += (local_bbox[2] - local_bbox[0]) + 10.0

    if not flange_polys:
        return None

    # ── 7. Union all flange outlines via pyclipper ─────────────────────
    outer_mm: List[Tuple[float, float]] = []
    extra_outer_rings: List[List[Tuple[float, float]]] = []
    extra_holes_from_union: List[List[Tuple[float, float]]] = []
    if _HAS_PYCLIPPER:
        try:
            subj = []
            for poly in flange_polys:
                if len(poly) < 3:
                    continue
                path = [
                    (int(round(x * _CLIPPER_SCALE)), int(round(y * _CLIPPER_SCALE)))
                    for (x, y) in poly
                ]
                # Force CCW orientation so pyclipper treats them as fills
                if not pyclipper.Orientation(path):
                    path.reverse()
                subj.append(path)
            if subj:
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
                    if outers:
                        def _area_int(ring):
                            n = len(ring)
                            a = 0
                            for i in range(n):
                                x1, y1 = ring[i]
                                x2, y2 = ring[(i + 1) % n]
                                a += x1 * y2 - x2 * y1
                            return abs(a) / 2
                        outers_sorted = sorted(outers, key=_area_int, reverse=True)
                        outer_mm = [
                            (x / _CLIPPER_SCALE, y / _CLIPPER_SCALE)
                            for (x, y) in outers_sorted[0]
                        ]
                        # Smaller disjoint outer rings → extra outlines
                        # (additional flange regions that don't touch the
                        # main outline). Filter out tiny fragments (area
                        # below 5×thickness²) which are typically clipper
                        # numerical noise from near-overlapping inputs.
                        min_area_int = (5.0 * thickness * thickness) * (
                            _CLIPPER_SCALE * _CLIPPER_SCALE
                        )
                        for ring in outers_sorted[1:]:
                            if len(ring) < 4:
                                continue
                            if _area_int(ring) < min_area_int:
                                continue
                            extra_outer_rings.append([
                                (x / _CLIPPER_SCALE, y / _CLIPPER_SCALE)
                                for (x, y) in ring
                            ])
                        # Holes inside the unioned outer region (from clipper)
                        for ring in inners:
                            extra_holes_from_union.append([
                                (x / _CLIPPER_SCALE, y / _CLIPPER_SCALE)
                                for (x, y) in ring
                            ])
        except Exception:
            outer_mm = []

    # If pyclipper failed, fall back to using the largest individual flange
    if not outer_mm and flange_polys:
        def _area_f(poly):
            n = len(poly)
            a = 0.0
            for i in range(n):
                x1, y1 = poly[i]
                x2, y2 = poly[(i + 1) % n]
                a += x1 * y2 - x2 * y1
            return abs(a) / 2
        outer_mm = max(flange_polys, key=_area_f)

    if not outer_mm:
        return None

    # ── 8. Translate everything so combined bbox starts at (0, 0) ───────
    # Use the bbox of EVERYTHING (main outline + extra rings + holes) so
    # disjoint outline pieces and orphan holes don't end up at negative
    # coords or with the main outline shoved off centre.
    all_xs: List[float] = [p[0] for p in outer_mm]
    all_ys: List[float] = [p[1] for p in outer_mm]
    for r in extra_outer_rings:
        for (x, y) in r:
            all_xs.append(x); all_ys.append(y)
    for r in hole_polys + extra_holes_from_union:
        for (x, y) in r:
            all_xs.append(x); all_ys.append(y)
    minx, miny = min(all_xs), min(all_ys)
    outer_mm = [(x - minx, y - miny) for (x, y) in outer_mm]
    hole_polys = [
        [(x - minx, y - miny) for (x, y) in h] for h in hole_polys
    ]
    extra_holes_from_union = [
        [(x - minx, y - miny) for (x, y) in h] for h in extra_holes_from_union
    ]
    extra_outer_rings = [
        [(x - minx, y - miny) for (x, y) in h] for h in extra_outer_rings
    ]

    # ── 9. Build FlatPattern result ─────────────────────────────────────
    fp = FlatPattern()
    fp.outer_edges = _edges_from_polyline(outer_mm)
    for ring in extra_outer_rings:
        fp.extra_outlines.append(_edges_from_polyline(ring))
    # Width/height = bbox of the WHOLE pattern (main outline + extras).
    bbox_xs = [p[0] for p in outer_mm]
    bbox_ys = [p[1] for p in outer_mm]
    for ring in extra_outer_rings:
        for (x, y) in ring:
            bbox_xs.append(x); bbox_ys.append(y)
    fp.width = round((max(bbox_xs) - min(bbox_xs)) if bbox_xs else 0.0, 2)
    fp.height = round((max(bbox_ys) - min(bbox_ys)) if bbox_ys else 0.0, 2)

    # Deduplicate holes by approximate centre+size (chain processing can
    # surface the same hole twice — once from each face of a thin sheet,
    # plus once from each anchored hem flange).
    seen_holes: List[Tuple[float, float, float]] = []
    for hp in hole_polys + extra_holes_from_union:
        h2d = _hole_from_polyline(hp)
        if h2d.center and h2d.diameter:
            key = (round(h2d.center[0], 1), round(h2d.center[1], 1),
                   round(h2d.diameter, 1))
            if any(
                abs(k[0] - key[0]) < 1.0 and abs(k[1] - key[1]) < 1.0
                and abs(k[2] - key[2]) < 0.5
                for k in seen_holes
            ):
                continue
            seen_holes.append(key)
            fp.holes.append(h2d)
        else:
            # Polyline holes — dedup by approximate bounding box centre + size
            xs = [p[0] for p in hp]; ys = [p[1] for p in hp]
            if not xs:
                continue
            cx = (min(xs) + max(xs)) / 2
            cy = (min(ys) + max(ys)) / 2
            sz = max(max(xs) - min(xs), max(ys) - min(ys))
            key = (round(cx, 1), round(cy, 1), round(sz, 1))
            if any(
                abs(k[0] - key[0]) < 1.0 and abs(k[1] - key[1]) < 1.0
                and abs(k[2] - key[2]) < 1.0
                for k in seen_holes
            ):
                continue
            seen_holes.append(key)
            fp.holes.append(h2d)

    # Store for bend-line placement
    fp.flange_widths = []
    fp._3d_transforms = transforms  # type: ignore[attr-defined]
    fp._3d_origin_offset = (minx, miny)  # type: ignore[attr-defined]
    return fp


def _bfs_compose_transforms(
    unfolding_order: List[Tuple[int, int, int]],
    bend_map: Dict[int, BendInfo],
    cf_map: Dict[int, "ClassifiedFace"],
    transforms: Dict[int, gp_Trsf],
    thickness: float = 0.0,
    k_factor: float = 0.0,
) -> None:
    """
    Walk the unfolding order, composing per-flange transforms via
    rotation around each bend's axis followed by an outward translation
    of the bend's bend-allowance length.

    Without the translation the rotation alone collapses the cylindrical
    bend region into a single column at the bend axis, so the flat
    pattern is short by ``BA`` for every bend — flange widths just add
    up to ``Σ flange_lengths`` instead of ``Σ flange_lengths + Σ BA``.
    """
    for from_idx, bend_id, to_idx in unfolding_order:
        T_parent = transforms.get(from_idx)
        bend = bend_map.get(bend_id)
        if T_parent is None or bend is None:
            continue
        if bend.axis is None or bend.axis_location is None:
            continue

        try:
            ax_loc_world = gp_Pnt(*bend.axis_location)
            ax_dir_world = gp_Dir(*bend.axis)

            # Apply T_parent to get axis location & direction in the
            # currently-flattened parent frame.
            ax_loc_current = ax_loc_world.Transformed(T_parent)
            ax_dir_current = ax_dir_world.Transformed(T_parent)
            axis_current = gp_Ax1(ax_loc_current, ax_dir_current)
        except Exception:
            continue

        child_cf = cf_map.get(to_idx)
        parent_cf = cf_map.get(from_idx)
        if child_cf is None or parent_cf is None:
            continue
        child_normal_world = _face_plane_normal(child_cf.info.face)
        if child_normal_world is None:
            continue

        angle_rad = math.radians(bend.angle_deg)

        best_T_child: Optional[gp_Trsf] = None
        best_align = -2.0
        for sign in (+1, -1):
            try:
                R = gp_Trsf()
                R.SetRotation(axis_current, sign * angle_rad)
                T_candidate = gp_Trsf()
                T_candidate.Multiply(R)
                # OCC: Multiply(other) sets self = self * other. We want
                # T_candidate = R * T_parent, so start with R and multiply
                # by T_parent on the right (R operates LAST so it must be
                # applied after T_parent → we want a point P transformed
                # as: P' = R(T_parent(P)) which in matrix terms is M_R · M_Tparent
                # · P. gp_Trsf's Multiplied(other) returns self · other,
                # treating points as column vectors, meaning self is
                # applied AFTER other. So R.Multiplied(T_parent) means
                # T_parent first then R — exactly what we want.
                T_combined = R.Multiplied(T_parent)
                # Test alignment of child normal after the candidate.
                n_after = child_normal_world.Transformed(T_combined)
                align = n_after.Z()
                if align > best_align:
                    best_align = align
                    best_T_child = T_combined
            except Exception:
                continue

        if best_T_child is None:
            continue

        # ── Apply the bend-allowance translation ─────────────────────────
        # In the unfolded XY plane, push the child flange outward — away
        # from the parent flange — by BA along the direction perpendicular
        # to the bend axis. This is the missing piece that turns a pure
        # rotation into a real unfold.
        if thickness > 0.0 and k_factor > 0.0 and bend.inner_radius > 0.0:
            try:
                bc = compute_bend(
                    bend.angle_deg, bend.inner_radius, thickness, k_factor,
                )
                ba = bc.bend_allowance
                # Bend axis direction in the unfolded frame (after applying
                # T_combined to the world-space axis direction).
                ax_dir_unf = ax_dir_world.Transformed(best_T_child)
                ax_x, ax_y = ax_dir_unf.X(), ax_dir_unf.Y()
                # Perpendicular to the axis in the XY plane.
                perp_x, perp_y = -ax_y, ax_x
                perp_len = math.sqrt(perp_x ** 2 + perp_y ** 2)
                if perp_len > 1e-9:
                    perp_x /= perp_len
                    perp_y /= perp_len
                    # Decide the sign: the outward direction is the one
                    # pointing AWAY from the parent flange's centroid in
                    # the unfolded frame.
                    parent_com_world = gp_Pnt(*parent_cf.info.center_of_mass)
                    child_com_world = gp_Pnt(*child_cf.info.center_of_mass)
                    pc_unf = parent_com_world.Transformed(T_parent)
                    cc_unf = child_com_world.Transformed(best_T_child)
                    dx = cc_unf.X() - pc_unf.X()
                    dy = cc_unf.Y() - pc_unf.Y()
                    sign_t = 1.0 if (dx * perp_x + dy * perp_y) >= 0 else -1.0
                    perp_x *= sign_t
                    perp_y *= sign_t
                    T_shift = gp_Trsf()
                    T_shift.SetTranslation(gp_Vec(perp_x * ba, perp_y * ba, 0.0))
                    best_T_child = T_shift.Multiplied(best_T_child)
            except Exception:
                pass

        transforms[to_idx] = best_T_child


def _world_to_base_plane_trsf(face: TopoDS_Face) -> Optional[gp_Trsf]:
    """
    Build a gp_Trsf that maps points expressed in world coords to the
    coordinate system of the base plane. Result: a point on the base
    plane has Z=0 in the new frame, and the plane's local X/Y axes are
    the new X/Y axes.
    """
    try:
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() != GeomAbs_Plane:
            return None
        plane = adaptor.Plane()
        T = gp_Trsf()
        T.SetTransformation(plane.Position())
        return T
    except Exception:
        return None


def _face_plane_normal(face: TopoDS_Face) -> Optional[gp_Dir]:
    """Return the planar face's normal as a gp_Dir, or None."""
    try:
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() != GeomAbs_Plane:
            return None
        plane = adaptor.Plane()
        return plane.Axis().Direction()
    except Exception:
        return None


def _face_plane_origin_normal(
    face: TopoDS_Face,
) -> Optional[Tuple[gp_Pnt, gp_Dir]]:
    """Return (origin_point, normal) for a planar face, or None."""
    try:
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() != GeomAbs_Plane:
            return None
        plane = adaptor.Plane()
        return plane.Location(), plane.Axis().Direction()
    except Exception:
        return None


def _face_normal_after_trsf(
    face: TopoDS_Face, T: gp_Trsf,
) -> Optional[Tuple[float, float, float]]:
    """Return the face normal after applying T, as a (x, y, z) tuple."""
    n = _face_plane_normal(face)
    if n is None:
        return None
    try:
        n_after = n.Transformed(T)
        return (n_after.X(), n_after.Y(), n_after.Z())
    except Exception:
        return None


def _flatten_face_via_trsf(
    face: TopoDS_Face, T: gp_Trsf,
) -> Tuple[List[Tuple[float, float]], List[List[Tuple[float, float]]]]:
    """
    Apply transform T to all wire points of *face* and project to 2D by
    dropping the Z coordinate.

    Returns (outer_pts, [hole_pts, ...]) — both as (x, y) tuples.
    """
    try:
        from OCP.ShapeAnalysis import ShapeAnalysis
        outer_wire = ShapeAnalysis.OuterWire_s(face)
        if outer_wire is None or outer_wire.IsNull():
            return [], []

        def to_xy(pnt: gp_Pnt) -> Tuple[float, float]:
            transformed = pnt.Transformed(T)
            return (transformed.X(), transformed.Y())

        outer_pts = _wire_to_polyline(outer_wire, to_xy)
        if len(outer_pts) < 3:
            return [], []

        hole_polylines: List[List[Tuple[float, float]]] = []
        wire_explorer = TopExp_Explorer(face, TopAbs_WIRE)
        while wire_explorer.More():
            wire = TopoDS.Wire_s(wire_explorer.Current())
            if not wire.IsSame(outer_wire):
                pts = _wire_to_polyline(wire, to_xy)
                if len(pts) >= 3:
                    hole_polylines.append(pts)
            wire_explorer.Next()

        return outer_pts, hole_polylines
    except Exception:
        return [], []


def _polys_bbox(
    polys: List[List[Tuple[float, float]]],
) -> Optional[Tuple[float, float, float, float]]:
    """Return (xmin, ymin, xmax, ymax) of all points in all polys, or None."""
    xs: List[float] = []
    ys: List[float] = []
    for p in polys:
        for (x, y) in p:
            xs.append(x)
            ys.append(y)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def _place_bend_lines_3d(
    fp: FlatPattern,
    bends: List[BendInfo],
    bend_graph: "BendGraph",
    bend_map: Dict[int, BendInfo],
    cf_map: Dict[int, "ClassifiedFace"],
    topo: "Topology",
    thickness: float = 1.0,
    k_factor: float = 0.4,
) -> None:
    """
    Place bend lines at the actual 2D position of each bend axis after
    applying the parent's accumulated transform.
    """
    transforms: Dict[int, gp_Trsf] = getattr(fp, "_3d_transforms", {})
    origin_offset = getattr(fp, "_3d_origin_offset", (0.0, 0.0))
    if not transforms:
        return

    minx, miny = origin_offset

    for from_idx, bend_id, to_idx in bend_graph.unfolding_order:
        T_parent = transforms.get(from_idx)
        bend = bend_map.get(bend_id)
        if T_parent is None or bend is None:
            continue
        if bend.axis is None or bend.axis_location is None:
            continue

        try:
            ax_loc_world = gp_Pnt(*bend.axis_location)
            ax_dir_world = gp_Dir(*bend.axis)
            ax_loc_current = ax_loc_world.Transformed(T_parent)
            ax_dir_current = ax_dir_world.Transformed(T_parent)
        except Exception:
            continue

        # Bend line direction in 2D = projection of ax_dir to XY plane.
        dx = ax_dir_current.X()
        dy = ax_dir_current.Y()
        mag = math.hypot(dx, dy)
        if mag < 1e-6:
            continue
        ux, uy = dx / mag, dy / mag

        # Bend line midpoint = projection of axis location.
        cx = ax_loc_current.X() - minx
        cy = ax_loc_current.Y() - miny

        # Use bend.length (3D) as the visual length of the bend line.
        L = bend.length if bend.length and bend.length > 0 else 50.0
        x0 = cx - ux * (L / 2)
        y0 = cy - uy * (L / 2)
        x1 = cx + ux * (L / 2)
        y1 = cy + uy * (L / 2)

        try:
            bc = compute_bend(bend.angle_deg, bend.inner_radius, thickness, k_factor)
        except Exception:
            # Last resort fallback so BendLine2D can still be created.
            bc = compute_bend(90.0, 1.0, 1.0, 0.4)

        bl = BendLine2D(
            start=(round(x0, 4), round(y0, 4)),
            end=(round(x1, 4), round(y1, 4)),
            bend_info=bend,
            bend_calc=bc,
        )
        fp.bend_lines.append(bl)
