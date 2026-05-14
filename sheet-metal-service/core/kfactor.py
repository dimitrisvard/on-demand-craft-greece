"""
K-factor, bend allowance, and bend deduction calculations.

Ground-truth math
-----------------
For every formula below ``angle_deg`` is the **rotation from coplanar** —
90° for an L-bend, 180° for a hem (folded back on itself), 0° for an
unbent edge. It is *not* the included interior dihedral between the
flanges. Every consumer of these formulas must feed the rotation-from-
coplanar angle; ``bend_detector.detect_bends`` is responsible for
producing that value from the B-rep.

    Bend Allowance       BA  = (π / 180) · angle_deg · (R + K · T)
    Outside Setback      SB  = (R + T)  · tan(angle_deg / 2)
    Bend Deduction       BD  = 2 · SB - BA
    Flat length          L   = Σ flange_outer_dim - Σ BD
                            = Σ mold_line_flange_len  +  Σ BA

where
    R = inner bend radius (mm)
    T = sheet thickness (mm)
    K = K-factor (dimensionless, neutral-axis position ratio)

Default K-factor table (``K_FACTOR_TABLE`` below) is the source of truth
for this service. It does not always match published values from other
references; it was tuned against the existing production part library
and the per-customer override on the ``/flat-pattern`` endpoint takes
precedence.
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
