"""
Bend detection: for every cylindrical face classified as BEND, extract full
geometric parameters — radius, angle, direction, axis, adjacent flanges.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Set

from OCP.TopoDS import TopoDS_Face, TopoDS_Edge
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRep import BRep_Tool
from OCP.gp import gp_Vec, gp_Pnt, gp_Ax1, gp_Dir

from core.step_parser import Topology, FaceInfo
from core.face_classifier import ClassifiedFace, FaceType


@dataclass
class BendInfo:
    """All geometric data for a single bend."""
    bend_id: int
    face_index: int              # index into Topology.faces
    inner_radius: float          # mm
    outer_radius: float          # inner_radius + thickness
    angle_deg: float             # bend angle (e.g. 90°)
    angular_span: float          # arc span of the cylindrical face (radians)
    direction: str               # "UP" or "DOWN"
    axis: Tuple[float, float, float]           # bend axis direction
    axis_location: Tuple[float, float, float]  # a point on the axis
    adjacent_flanges: Tuple[int, int]          # (flange_index_1, flange_index_2)
    length: float                # bend line length (mm)
    is_inner: bool               # whether this face is the inner bend surface
    orientation: str             # "VALLEY" or "MOUNTAIN"


def detect_bends(
    topo: Topology,
    classified: List[ClassifiedFace],
    thickness: float,
) -> List[BendInfo]:
    """
    Detect all bends from faces classified as BEND/HEM.

    For each bend face we determine:
      - Inner vs outer radius (using adjacent face orientation)
      - Bend angle = angle between OUTWARD adjacent flange normals — i.e.
        the rotation from coplanar (90° for an L-bend, 180° for a hem,
        0° for an unbent edge). See ``core/kfactor.py`` for the
        ground-truth definition.
      - Direction (UP/DOWN) relative to the largest flange
      - Adjacent flanges (the two planar faces connected via this bend)
    """
    # Build lookup structures
    flange_indices: Set[int] = set()
    bend_face_indices: List[int] = []
    classified_map = {cf.info.index: cf for cf in classified}

    for cf in classified:
        if cf.face_type == FaceType.FLANGE:
            flange_indices.add(cf.info.index)
        elif cf.face_type in (FaceType.BEND, FaceType.HEM):
            bend_face_indices.append(cf.info.index)

    if not bend_face_indices:
        return []

    # Reference normal: outward normal of the largest flange
    base_flange_idx = _find_largest_flange(classified)
    base_normal = _get_face_normal(topo, base_flange_idx) if base_flange_idx is not None else (0, 0, 1)

    bends: List[BendInfo] = []

    for bid, fi in enumerate(bend_face_indices, start=1):
        cf = classified_map[fi]
        face_info = cf.info

        # Find adjacent flanges (planar faces sharing an edge with this bend face)
        adj_flanges = _find_adjacent_flanges(topo, fi, flange_indices)
        if len(adj_flanges) < 2:
            # Try to include thickness faces bridging to flanges
            adj_flanges = _find_adjacent_flanges_via_thickness(topo, fi, flange_indices, classified_map)
        # Filter out flanges whose normal is parallel to the bend axis — those
        # are the end-cap faces produced by an extruded sheet (e.g. the two
        # y-side faces of an L-bracket extruded along Y). They share an edge
        # with the cylindrical bend face but they are NOT the two flanges
        # the bend connects. Without this filter ``set`` iteration order is
        # what decides which two faces are picked, which made bend_angle_deg
        # report ~90° regardless of the actual fold angle.
        bend_axis = face_info.axis
        if bend_axis is not None:
            adj_flanges = _filter_perpendicular_to_axis(topo, adj_flanges, bend_axis)
        # Prefer the two largest remaining faces (the true flanges dwarf any
        # thin connector strips that survive the perpendicularity filter).
        adj_flanges = _top_two_by_area(topo, adj_flanges)
        if len(adj_flanges) < 2:
            # Can't determine bend without two flanges — skip
            continue

        f1_idx, f2_idx = adj_flanges[0], adj_flanges[1]

        # Determine bend angle from flange normals
        n1 = _get_face_normal(topo, f1_idx)
        n2 = _get_face_normal(topo, f2_idx)
        if n1 is None or n2 is None:
            continue

        # Angle between two consistently-outward flange normals equals the
        # rotation from coplanar — 90° for an L-bend, 180° for a hem (folded
        # back on itself), 0° for an unbent edge. (The previous code did
        # `180 - degrees(angle_between)`, which only happened to give the
        # right answer at exactly 90°.)
        bend_angle_deg = math.degrees(_angle_between(n1, n2))
        # Clamp to valid range — keep hems (~180°) and reject coplanar
        # faces that slipped through the BEND face classification.
        bend_angle_deg = max(0.1, min(179.9, bend_angle_deg))

        # Inner vs outer: the face whose normal points toward the cylinder axis centre
        radius = face_info.radius or 0.0
        is_inner = _is_inner_face(face_info)
        inner_radius = radius if is_inner else max(radius - thickness, 0.1)
        outer_radius = inner_radius + thickness

        # Angular span from the classifier
        angular_span = cf.angular_span or math.radians(bend_angle_deg)

        # Bend length: length of the longest straight edge of the cylindrical face
        length = _compute_bend_length(face_info.face)

        # Direction relative to base normal
        direction = _determine_direction(face_info, base_normal)
        orientation = "VALLEY" if direction == "UP" else "MOUNTAIN"

        axis = face_info.axis or (0, 0, 1)
        axis_loc = face_info.axis_location or (0, 0, 0)

        bends.append(BendInfo(
            bend_id=bid,
            face_index=fi,
            inner_radius=round(inner_radius, 3),
            outer_radius=round(outer_radius, 3),
            angle_deg=round(bend_angle_deg, 1),
            angular_span=angular_span,
            direction=direction,
            axis=axis,
            axis_location=axis_loc,
            adjacent_flanges=(f1_idx, f2_idx),
            length=round(length, 3),
            is_inner=is_inner,
            orientation=orientation,
        ))

    return _refine_bend_list(bends, thickness)


def _refine_bend_list(bends: List[BendInfo], thickness: float) -> List[BendInfo]:
    """
    Post-process raw bend candidates:

      1. Drop candidates whose flange normals are nearly parallel (angle close
         to 180°) — these are usually false positives from internal fillets
         where both adjacent "flanges" are the same physical plane.
      2. Drop candidates whose inner radius is implausibly large for the
         detected sheet thickness (> 10 × thickness) — these are usually
         rolled features or large fillets, not sheet-metal bends.
      3. Drop candidates with negligible bend length (< 0.5 × thickness).
      4. Deduplicate: the inner and outer cylindrical faces of a single
         physical bend both get classified as BEND candidates. Collapse them
         by axis direction + projected axis location on the bend axis so that
         one physical bend yields one BendInfo (prefer the inner face).
    """
    if not bends:
        return bends

    # Note: hem features fold the flange back on itself ⇒ ~180° bend angle
    # with a very tight radius. We accept up to 179.5° to keep them in the
    # bend graph (so hem flanges get proper transforms during unfolding).
    # False positives from coplanar internal fillets are still filtered by
    # the inner-radius cap and the bend-length floor.
    MAX_BEND_ANGLE_DEG = 179.5
    MIN_BEND_ANGLE_DEG = 10.0
    MAX_INNER_RADIUS = max(thickness * 10.0, 0.5)  # absolute cap
    MIN_BEND_LENGTH = max(thickness * 0.5, 0.1)

    filtered: List[BendInfo] = []
    for b in bends:
        if not (MIN_BEND_ANGLE_DEG <= b.angle_deg <= MAX_BEND_ANGLE_DEG):
            continue
        if b.inner_radius > MAX_INNER_RADIUS:
            continue
        if b.length < MIN_BEND_LENGTH:
            continue
        filtered.append(b)

    # Deduplicate by axis key. Two cylindrical faces forming the inner and
    # outer of the same bend share the same axis direction AND the same point
    # on that axis. We bucket by a quantised key and keep the candidate with
    # the smaller inner_radius (that is the "inner" face of the bend).
    def _axis_key(b: BendInfo) -> tuple:
        ax = b.axis
        # Normalise direction sign so that (ax) and (-ax) hash the same.
        if (ax[0], ax[1], ax[2]) < (-ax[0], -ax[1], -ax[2]):
            ax = (-ax[0], -ax[1], -ax[2])
        loc = b.axis_location
        return (
            round(ax[0], 3), round(ax[1], 3), round(ax[2], 3),
            round(loc[0], 1), round(loc[1], 1), round(loc[2], 1),
        )

    dedup: dict[tuple, BendInfo] = {}
    for b in filtered:
        k = _axis_key(b)
        if k not in dedup or b.inner_radius < dedup[k].inner_radius:
            dedup[k] = b

    refined = sorted(dedup.values(), key=lambda b: b.bend_id)
    # Re-number bend_ids to be 1..N after filtering
    renumbered: List[BendInfo] = []
    for idx, b in enumerate(refined, start=1):
        renumbered.append(BendInfo(
            bend_id=idx,
            face_index=b.face_index,
            inner_radius=b.inner_radius,
            outer_radius=b.outer_radius,
            angle_deg=b.angle_deg,
            angular_span=b.angular_span,
            direction=b.direction,
            axis=b.axis,
            axis_location=b.axis_location,
            adjacent_flanges=b.adjacent_flanges,
            length=b.length,
            is_inner=b.is_inner,
            orientation=b.orientation,
        ))
    return renumbered


# ── Internal helpers ───────────────────────────────────────────────────────


def _find_largest_flange(classified: List[ClassifiedFace]) -> Optional[int]:
    best_idx = None
    best_area = 0.0
    for cf in classified:
        if cf.face_type == FaceType.FLANGE and cf.info.area > best_area:
            best_area = cf.info.area
            best_idx = cf.info.index
    return best_idx


def _get_face_normal(topo: Topology, face_idx: int) -> Optional[Tuple[float, float, float]]:
    if face_idx < len(topo.faces):
        return topo.faces[face_idx].normal
    return None


def _find_adjacent_flanges(
    topo: Topology,
    bend_idx: int,
    flange_indices: Set[int],
) -> List[int]:
    """Return flange indices directly adjacent to the bend face."""
    adj = topo.face_adjacency.get(bend_idx, set())
    return [i for i in adj if i in flange_indices]


def _filter_perpendicular_to_axis(
    topo: Topology,
    face_indices: List[int],
    axis: Tuple[float, float, float],
    tol: float = 0.1,
) -> List[int]:
    """Drop faces whose normal is parallel to *axis* (end-cap faces).

    A genuine flange adjacent to a bend has its outward normal in the plane
    perpendicular to the bend axis, so ``|normal · axis|`` is near zero.
    End-cap faces produced by extruding a sheet-metal profile have their
    normal along the extrusion direction = the bend axis, so the same dot
    product is ~1.
    """
    ax_len = math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2)
    if ax_len < 1e-9:
        return list(face_indices)
    ax = (axis[0] / ax_len, axis[1] / ax_len, axis[2] / ax_len)
    kept: List[int] = []
    for idx in face_indices:
        if idx >= len(topo.faces):
            continue
        n = topo.faces[idx].normal
        if n is None:
            kept.append(idx)
            continue
        dot = abs(n[0] * ax[0] + n[1] * ax[1] + n[2] * ax[2])
        if dot < 1.0 - tol:
            kept.append(idx)
    return kept


def _top_two_by_area(topo: Topology, face_indices: List[int]) -> List[int]:
    """Return up to two face indices ordered by descending area."""
    scored = sorted(
        (i for i in face_indices if i < len(topo.faces)),
        key=lambda i: topo.faces[i].area,
        reverse=True,
    )
    return scored[:2]


def _find_adjacent_flanges_via_thickness(
    topo: Topology,
    bend_idx: int,
    flange_indices: Set[int],
    classified_map: dict,
) -> List[int]:
    """
    Sometimes a thickness face sits between the bend and the flange.
    Walk one hop through thickness faces to find flanges.
    """
    direct = _find_adjacent_flanges(topo, bend_idx, flange_indices)
    found = set(direct)

    adj_to_bend = topo.face_adjacency.get(bend_idx, set())
    for mid in adj_to_bend:
        cf = classified_map.get(mid)
        if cf and cf.face_type == FaceType.THICKNESS:
            # Check what the thickness face connects to
            for nxt in topo.face_adjacency.get(mid, set()):
                if nxt in flange_indices and nxt not in found:
                    found.add(nxt)

    return list(found)[:2]


def _is_inner_face(fi: FaceInfo) -> bool:
    """
    Heuristic: for a cylindrical face, check if the face normal at the mid-point
    points toward the axis (inner) or away (outer).
    """
    face = fi.face
    adaptor = BRepAdaptor_Surface(face)
    u_mid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2
    v_mid = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2

    pnt = gp_Pnt()
    d1u = gp_Vec()
    d1v = gp_Vec()
    adaptor.D1(u_mid, v_mid, pnt, d1u, d1v)

    normal = d1u.Crossed(d1v)
    if normal.Magnitude() < 1e-10:
        return True

    normal.Normalize()

    # Vector from point to axis
    if fi.axis_location is None:
        return True

    to_axis = gp_Vec(
        fi.axis_location[0] - pnt.X(),
        fi.axis_location[1] - pnt.Y(),
        fi.axis_location[2] - pnt.Z(),
    )
    # Project to radial direction (remove axial component)
    if fi.axis:
        ax_dir = gp_Vec(fi.axis[0], fi.axis[1], fi.axis[2])
        axial_comp = to_axis.Dot(ax_dir)
        to_axis = to_axis - ax_dir * axial_comp  # type: ignore[operator]

    return normal.Dot(to_axis) > 0


def _compute_bend_length(face: TopoDS_Face) -> float:
    """Length of the longest straight edge on the cylindrical face (the bend line length)."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Line
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopoDS import TopoDS

    max_len = 0.0
    explorer = TopExp_Explorer(face, TopAbs_EDGE)
    while explorer.More():
        edge = TopoDS.Edge_s(explorer.Current())
        curve = BRepAdaptor_Curve(edge)
        if curve.GetType() == GeomAbs_Line:
            length = abs(curve.LastParameter() - curve.FirstParameter())
            # For lines, parameter range equals length
            p1 = curve.Value(curve.FirstParameter())
            p2 = curve.Value(curve.LastParameter())
            seg_len = p1.Distance(p2)
            max_len = max(max_len, seg_len)
        explorer.Next()

    return max_len


def _determine_direction(fi: FaceInfo, base_normal: Tuple[float, float, float]) -> str:
    """UP if the bend goes toward the base normal side, else DOWN."""
    face = fi.face
    adaptor = BRepAdaptor_Surface(face)
    u_mid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2
    v_mid = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2

    pnt = gp_Pnt()
    d1u = gp_Vec()
    d1v = gp_Vec()
    adaptor.D1(u_mid, v_mid, pnt, d1u, d1v)

    face_normal = d1u.Crossed(d1v)
    if face_normal.Magnitude() < 1e-10:
        return "UP"
    face_normal.Normalize()

    base_vec = gp_Vec(base_normal[0], base_normal[1], base_normal[2])

    # Cross product of base normal and bend axis gives the expected bend direction
    if fi.axis:
        axis_vec = gp_Vec(fi.axis[0], fi.axis[1], fi.axis[2])
        cross = base_vec.Crossed(axis_vec)
        if cross.Dot(face_normal) > 0:
            return "UP"
        return "DOWN"

    return "UP"


def _angle_between(
    n1: Tuple[float, float, float],
    n2: Tuple[float, float, float],
) -> float:
    """Angle in radians between two unit-ish vectors."""
    dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
    dot = max(-1.0, min(1.0, dot))
    return math.acos(dot)
