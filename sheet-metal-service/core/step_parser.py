"""
STEP file loading and B-Rep topology extraction using OpenCascade (via CadQuery/OCP).

Provides:
- load_step() → list of TopoDS_Solid
- build_topology() → face list, edge-face adjacency map
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Dict, Set, Tuple, Optional

from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_SOLID, TopAbs_REVERSED
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCP.TopoDS import TopoDS, TopoDS_Solid, TopoDS_Face, TopoDS_Edge, TopoDS_Shape
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.GeomAbs import (
    GeomAbs_Plane,
    GeomAbs_Cylinder,
    GeomAbs_Cone,
    GeomAbs_Sphere,
    GeomAbs_Torus,
    GeomAbs_BSplineSurface,
)
from OCP.IFSelect import IFSelect_RetDone


@dataclass
class FaceInfo:
    """Lightweight container for a single B-Rep face and its geometric metadata."""
    index: int
    face: TopoDS_Face
    surface_type: str          # "plane", "cylinder", "cone", "sphere", "other"
    area: float                # mm²
    center_of_mass: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    normal: Optional[Tuple[float, float, float]] = None  # outward normal (planes)
    # Cylinder/cone extras
    radius: Optional[float] = None
    axis: Optional[Tuple[float, float, float]] = None
    axis_location: Optional[Tuple[float, float, float]] = None


@dataclass
class Topology:
    """Complete topology of a single solid body."""
    solid: TopoDS_Solid
    faces: List[FaceInfo] = field(default_factory=list)
    # Maps edge index → set of face indices that share that edge
    edge_face_map: Dict[int, List[int]] = field(default_factory=dict)
    # Maps face index → set of adjacent face indices
    face_adjacency: Dict[int, Set[int]] = field(default_factory=dict)
    # Maps (face_i, face_j) → list of shared TopoDS_Edge objects
    shared_edges: Dict[Tuple[int, int], List[TopoDS_Edge]] = field(default_factory=dict)
    # Bounding box
    bbox: Optional[Tuple[float, float, float, float, float, float]] = None  # xmin,ymin,zmin,xmax,ymax,zmax
    volume: float = 0.0


# ── Public API ──────────────────────────────────────────────────────────────


def load_step(file_path: str) -> List[TopoDS_Solid]:
    """Read a STEP file and return all solid bodies."""
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"STEP file not found: {file_path}")

    reader = STEPControl_Reader()
    status = reader.ReadFile(file_path)
    if status != IFSelect_RetDone:
        raise ValueError(f"Failed to read STEP file (status={status}): {file_path}")

    reader.TransferRoots()
    shape = reader.OneShape()

    solids: List[TopoDS_Solid] = []
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More():
        solid = TopoDS.Solid_s(explorer.Current())
        solids.append(solid)
        explorer.Next()

    if not solids:
        raise ValueError("No solid bodies found in STEP file")

    return solids


def build_topology(solid: TopoDS_Solid) -> Topology:
    """
    Analyse *solid* and build a full topology description:
    face list, edge-face adjacency, face-face adjacency, shared edges.
    """
    topo = Topology(solid=solid)

    # ── Collect faces ───────────────────────────────────────────────────────
    faces_list: List[TopoDS_Face] = []
    face_explorer = TopExp_Explorer(solid, TopAbs_FACE)
    while face_explorer.More():
        faces_list.append(TopoDS.Face_s(face_explorer.Current()))
        face_explorer.Next()

    # Build a map from TopoDS_Face hash → index for fast lookup
    face_hash_to_idx: Dict[int, int] = {}
    for i, f in enumerate(faces_list):
        face_hash_to_idx[hash(f)] = i

    for i, face in enumerate(faces_list):
        topo.faces.append(_analyse_face(i, face))

    # ── Edge-face adjacency via MapShapesAndAncestors ───────────────────────
    edge_face_occ_map = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(solid, TopAbs_EDGE, TopAbs_FACE, edge_face_occ_map)

    for edge_idx in range(1, edge_face_occ_map.Extent() + 1):
        edge = TopoDS.Edge_s(edge_face_occ_map.FindKey(edge_idx))
        face_list_occ = edge_face_occ_map.FindFromIndex(edge_idx)

        adjacent_face_indices: List[int] = []
        for shape in face_list_occ:
            adj_face = TopoDS.Face_s(shape)
            h = hash(adj_face)
            if h in face_hash_to_idx:
                adjacent_face_indices.append(face_hash_to_idx[h])

        topo.edge_face_map[edge_idx] = adjacent_face_indices

        # Build face-face adjacency and shared edges
        for a in adjacent_face_indices:
            if a not in topo.face_adjacency:
                topo.face_adjacency[a] = set()
            for b in adjacent_face_indices:
                if a != b:
                    topo.face_adjacency[a].add(b)
                    key = (min(a, b), max(a, b))
                    topo.shared_edges.setdefault(key, []).append(edge)

    # Ensure every face has an adjacency entry
    for i in range(len(faces_list)):
        topo.face_adjacency.setdefault(i, set())

    # ── Bounding box & volume ──────────────────────────────────────────────
    bbox = Bnd_Box()
    BRepBndLib.Add_s(solid, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
    topo.bbox = (xmin, ymin, zmin, xmax, ymax, zmax)

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(solid, props)
    topo.volume = props.Mass()

    return topo


# ── Internals ──────────────────────────────────────────────────────────────


_SURFACE_TYPE_MAP = {
    GeomAbs_Plane: "plane",
    GeomAbs_Cylinder: "cylinder",
    GeomAbs_Cone: "cone",
    GeomAbs_Sphere: "sphere",
    GeomAbs_Torus: "torus",
    GeomAbs_BSplineSurface: "bspline",
}


def _analyse_face(index: int, face: TopoDS_Face) -> FaceInfo:
    """Extract geometric metadata from a single face."""
    adaptor = BRepAdaptor_Surface(face)
    surface_type = _SURFACE_TYPE_MAP.get(adaptor.GetType(), "other")

    # Area
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    area = props.Mass()
    com = props.CentreOfMass()
    center = (com.X(), com.Y(), com.Z())

    info = FaceInfo(
        index=index,
        face=face,
        surface_type=surface_type,
        area=area,
        center_of_mass=center,
    )

    if surface_type == "plane":
        plane = adaptor.Plane()
        d = plane.Axis().Direction()
        # The surface's intrinsic axis direction is not orientation-aware:
        # a face with TopAbs_REVERSED orientation in the parent solid has
        # its true outward normal flipped. Every downstream stage assumes
        # info.normal points OUT of the solid, so honour orientation here.
        sign = -1.0 if face.Orientation() == TopAbs_REVERSED else 1.0
        info.normal = (sign * d.X(), sign * d.Y(), sign * d.Z())

    elif surface_type == "cylinder":
        cyl = adaptor.Cylinder()
        info.radius = cyl.Radius()
        ax = cyl.Axis()
        info.axis = (ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z())
        loc = ax.Location()
        info.axis_location = (loc.X(), loc.Y(), loc.Z())

    elif surface_type == "cone":
        cone = adaptor.Cone()
        info.radius = cone.RefRadius()
        ax = cone.Axis()
        info.axis = (ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z())
        loc = ax.Location()
        info.axis_location = (loc.X(), loc.Y(), loc.Z())

    return info
