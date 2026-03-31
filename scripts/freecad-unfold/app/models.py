"""Pydantic models for bend data, dimensions, and unfold results."""

from pydantic import BaseModel, Field
from typing import Optional


class Point2D(BaseModel):
    x: float = Field(..., alias="0", description="X coordinate")
    y: float = Field(..., alias="1", description="Y coordinate")

    class Config:
        populate_by_name = True


class BendLinePosition(BaseModel):
    start: list[float] = Field(..., description="[x, y] start point on flat pattern")
    end: list[float] = Field(..., description="[x, y] end point on flat pattern")


class BendData(BaseModel):
    index: int
    angle_deg: float
    inner_radius_mm: float
    direction: str = Field(..., pattern="^(UP|DOWN)$")
    length_mm: float
    k_factor: float
    bend_allowance_mm: float
    bend_deduction_mm: float
    bend_line_on_flat: BendLinePosition
    distance_from_left_edge_mm: float


class LinearDimension(BaseModel):
    label: str
    value_mm: float
    type: str = Field(..., pattern="^(edge_to_bend|bend_to_bend|bend_to_edge)$")


class BoundingBox3D(BaseModel):
    x: float
    y: float
    z: float


class FlatPatternData(BaseModel):
    width_mm: float
    height_mm: float
    dxf_path: Optional[str] = None
    outline_edges: list[dict] = Field(default_factory=list)


class UnfoldResult(BaseModel):
    success: bool
    error: Optional[str] = None
    part_name: str = "Part"
    thickness_mm: float = 0.0
    material: str = "Steel"
    material_guess: Optional[str] = None
    bounding_box_3d: BoundingBox3D = BoundingBox3D(x=0, y=0, z=0)
    flat_pattern: FlatPatternData = FlatPatternData(width_mm=0, height_mm=0)
    bends: list[BendData] = Field(default_factory=list)
    linear_dimensions: list[LinearDimension] = Field(default_factory=list)
    stl_path: Optional[str] = None
    unfold_method: str = "none"
