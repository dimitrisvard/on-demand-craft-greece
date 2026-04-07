"""
K-factor, bend allowance, and bend deduction calculations.

Bend Allowance (BA) = arc length along the neutral axis:
    BA = (π/180) × bend_angle × (R_inner + K × T)

Bend Deduction (BD) = material to subtract for accurate flat length:
    BD = 2 × OSSB - BA
    where OSSB (Outside SetBack) = (R + T) × tan(A/2)

Flat length of a part:
    L_flat = Σ(flange_outer_dimensions) - Σ(bend_deductions)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# ── Default K-factor table ─────────────────────────────────────────────────

K_FACTOR_TABLE: dict[str, list[tuple[float, float]]] = {
    # (max_thickness_mm, k_factor)
    "mild_steel": [(2.0, 0.33), (4.0, 0.38), (float("inf"), 0.40)],
    "steel": [(float("inf"), 0.44)],
    "stainless_steel": [(float("inf"), 0.35)],
    "aluminum": [(float("inf"), 0.33)],
    "copper": [(float("inf"), 0.35)],
    "brass": [(float("inf"), 0.35)],
}


def get_k_factor(material: str = "steel", thickness: float = 1.0) -> float:
    """Look up the K-factor for *material* at *thickness*."""
    key = material.lower().replace(" ", "_").replace("-", "_")
    table = K_FACTOR_TABLE.get(key, K_FACTOR_TABLE["steel"])
    for max_t, kf in table:
        if thickness <= max_t:
            return kf
    return 0.44  # absolute fallback


@dataclass
class BendCalc:
    """Result of a single bend calculation."""
    bend_allowance: float   # mm — arc at neutral axis
    bend_deduction: float   # mm — amount to subtract from outer dims
    ossb: float             # mm — outside setback
    neutral_radius: float   # mm — radius of neutral axis
    arc_length: float       # mm — same as bend_allowance


def compute_bend(
    angle_deg: float,
    inner_radius: float,
    thickness: float,
    k_factor: float,
) -> BendCalc:
    """
    Compute bend allowance and deduction for a single bend.

    Parameters
    ----------
    angle_deg : float
        Bend angle in degrees (e.g. 90).
    inner_radius : float
        Inner bend radius in mm.
    thickness : float
        Sheet thickness in mm.
    k_factor : float
        K-factor (0–1).
    """
    angle_rad = math.radians(angle_deg)
    neutral_r = inner_radius + k_factor * thickness

    ba = angle_rad * neutral_r
    ossb = (inner_radius + thickness) * math.tan(angle_rad / 2.0)
    bd = 2.0 * ossb - ba

    return BendCalc(
        bend_allowance=round(ba, 4),
        bend_deduction=round(bd, 4),
        ossb=round(ossb, 4),
        neutral_radius=round(neutral_r, 4),
        arc_length=round(ba, 4),
    )


def compute_flat_length(
    flange_outer_dims: list[float],
    bend_deductions: list[float],
) -> float:
    """
    Compute the total flat length of a part.

    flange_outer_dims : outer dimension of each flange (from bend line to far edge,
                        measured on the outside surface)
    bend_deductions   : BD for each bend (in order matching flanges)

    L_flat = Σ flange_dims - Σ bend_deductions
    """
    return sum(flange_outer_dims) - sum(bend_deductions)
