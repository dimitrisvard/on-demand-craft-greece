"""
Classify every face of a sheet-metal solid into one of:

    FLANGE      – planar top/bottom sheet surface
    BEND        – cylindrical face connecting two flanges
    THICKNESS   – narrow planar strip on the sheet edge
    HEM         – very tight bend (radius ≈ 0)
    CONICAL     – conical transition between flanges
    OTHER       – fillets, chamfers, non-sheet-metal features
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

from core.step_parser import Topology, FaceInfo


class FaceType(str, Enum):
    FLANGE = "FLANGE"
    BEND = "BEND"
    THICKNESS = "THICKNESS"
    HEM = "HEM"
    CONICAL = "CONICAL"
    OTHER = "OTHER"


@dataclass
class ClassifiedFace:
    """A face with its classification attached."""
    info: FaceInfo
    face_type: FaceType
    # Extra for bends: angular span in radians
    angular_span: Optional[float] = None


def classify_faces(topo: Topology, thickness: float) -> List[ClassifiedFace]:
    """
    Classify every face in *topo* given the detected *thickness* (mm).

    Strategy:
      1. Cylindrical faces with angular span > 5° → BEND (or HEM if radius ≈ 0).
      2. Conical faces → CONICAL.
      3. Planar faces: if the narrowest bounding-box dimension ≈ thickness → THICKNESS,
         otherwise → FLANGE.
      4. Everything else → OTHER.
    """
    results: List[ClassifiedFace] = []

    for fi in topo.faces:
        ft, span = _classify_one(fi, thickness)
        results.append(ClassifiedFace(info=fi, face_type=ft, angular_span=span))

    return results


# ── Internal helpers ───────────────────────────────────────────────────────


def _classify_one(fi: FaceInfo, thickness: float) -> tuple[FaceType, Optional[float]]:
    if fi.surface_type == "cylinder":
        return _classify_cylinder(fi, thickness)
    if fi.surface_type == "cone":
        return FaceType.CONICAL, None
    if fi.surface_type == "plane":
        return _classify_plane(fi, thickness), None
    return FaceType.OTHER, None


def _classify_cylinder(fi: FaceInfo, thickness: float) -> tuple[FaceType, Optional[float]]:
    """Cylindrical → BEND or HEM."""
    adaptor = BRepAdaptor_Surface(fi.face)
    u_lo = adaptor.FirstUParameter()
    u_hi = adaptor.LastUParameter()
    angular_span = abs(u_hi - u_lo)

    if angular_span < math.radians(5):
        return FaceType.OTHER, angular_span

    radius = fi.radius or 0.0
    # A hem has an inner radius approximately zero (< half the thickness)
    if radius < thickness * 0.5:
        return FaceType.HEM, angular_span

    return FaceType.BEND, angular_span


def _classify_plane(fi: FaceInfo, thickness: float) -> FaceType:
    """Planar → FLANGE or THICKNESS based on bounding-box narrowness."""
    face = fi.face
    bbox = Bnd_Box()
    BRepBndLib.Add_s(face, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()

    dims = sorted([xmax - xmin, ymax - ymin, zmax - zmin])
    min_dim = dims[0]

    # A thickness face has its narrowest dimension very close to the sheet
    # thickness. Tolerance ±50 % accounts for fillets / rounding.
    if min_dim < 1e-3:
        # Essentially zero-width (degenerate face) → OTHER
        return FaceType.OTHER

    if abs(min_dim - thickness) < thickness * 0.50:
        # Second dimension should also be small (it's thickness-like)
        # But some thickness faces are long strips — the key is that one dim ≈ thickness
        return FaceType.THICKNESS

    # Large face → FLANGE
    return FaceType.FLANGE
