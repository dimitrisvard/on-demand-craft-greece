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
from OCP.TopAbs import TopAbs_EDGE, TopAbs_WIRE
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
    fp.outer_edges = _build_rectangular_outline(total_width, pattern_height)

    # ── Place bend lines ────────────────────────────────────────────────────
    for bp in bend_positions:
        bend_center_x = bp["x"] + bp["ba"] / 2.0
        bl = BendLine2D(
            start=(round(bend_center_x, 4), 0.0),
            end=(round(bend_center_x, 4), round(pattern_height, 4)),
            bend_info=bp["bend_info"],
            bend_calc=bp["bend_calc"],
        )
        fp.bend_lines.append(bl)

    # ── Extract holes from flanges ──────────────────────────────────────────
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
