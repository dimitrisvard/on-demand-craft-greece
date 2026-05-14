"""
Build the canonical sheet-metal test fixtures.

Generates five STEP files into ``tests/fixtures/unfold/`` plus a paired
``*.expected.json`` carrying analytically-computed target values for each
fixture. Re-run whenever the engine math changes, the K-factor table
changes, or a new canonical geometry is added.

Each fixture is a sheet of mild_steel-equivalent geometry, thickness 2 mm,
inner bend radius 2 mm, K-factor 0.33 (matches kfactor.py for mild_steel
at 2 mm). All bends are measured as **rotation from coplanar** — 90° for
an L-bend, 135° for an obtuse fold, 45° for an acute fold.

Usage:
    python tools/build_fixtures.py            # regenerate all fixtures
    python tools/build_fixtures.py --verify   # re-check expected math
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, asdict
from typing import List, Tuple

import cadquery as cq


# ── Fixture parameters (shared across all five fixtures) ──────────────────

THICKNESS = 2.0          # mm
INNER_RADIUS = 2.0       # mm
WIDTH = 60.0             # mm (length along the bend axis)
K_FACTOR = 0.33          # matches kfactor.py for mild_steel at 2 mm
MATERIAL = "mild_steel"

# Base flange is always the longest planar face so the bend-graph algorithm
# picks it as the unfolding origin.
BASE_LEN = 100.0
FLANGE_LEN = 50.0


# ── Math helpers ──────────────────────────────────────────────────────────


def bend_allowance(angle_deg: float, inner_radius: float, thickness: float,
                   k_factor: float) -> float:
    """BA = (π/180) * angle * (R + K*T)  — same as kfactor.compute_bend."""
    return math.radians(angle_deg) * (inner_radius + k_factor * thickness)


def flat_length_at_bend_axis(flange_outer_len: float, inner_radius: float,
                             thickness: float) -> float:
    """
    Distance from the bend axis to the far edge of a flange, measured along
    the OUTER surface, given the user-facing "flange length" is also along
    the outer surface, starting from the outer corner at the bend.

    All five fixtures use this convention: ``FLANGE_LEN`` is the outer-edge
    length of the second (and third) flange measured from the outer edge of
    the bend tangent to its far end.
    """
    return flange_outer_len  # alias — kept explicit for readability


# ── Fixture data models ───────────────────────────────────────────────────


@dataclass
class ExpectedBend:
    angle_deg: float
    inner_radius_mm: float
    direction: str          # "UP" or "DOWN"
    length_mm: float        # bend line length (the dimension along the bend axis)


@dataclass
class Expected:
    name: str
    thickness_mm: float
    k_factor: float
    material: str
    bends: List[ExpectedBend]
    flat_dimensions_mm: dict      # {"width": ..., "height": ...}
    bend_lines_on_flat: List[dict]  # [{"x_from_left_mm": ..., "y0": ..., "y1": ...}]
    notes: str = ""


# ── 2D profile construction ──────────────────────────────────────────────


def _arc_midpoint(center: Tuple[float, float], radius: float,
                  start_angle: float, end_angle: float) -> Tuple[float, float]:
    """Return the point on a circle at the midpoint angle between start and end."""
    mid = 0.5 * (start_angle + end_angle)
    cx, cy = center
    return (cx + radius * math.cos(mid), cy + radius * math.sin(mid))


def _arc_endpoint(center: Tuple[float, float], radius: float,
                  angle: float) -> Tuple[float, float]:
    cx, cy = center
    return (cx + radius * math.cos(angle), cy + radius * math.sin(angle))


def _build_l_bend_profile(angle_deg: float) -> List[Tuple[str, tuple]]:
    """
    Build the cross-section profile of an L-bend (base flange + one bent
    flange) in the XZ plane. The base flange occupies x ∈ [0, BASE_LEN]
    with z ∈ [0, THICKNESS]; the bend rotates the second flange CCW by
    ``angle_deg`` around an axis parallel to Y at (BASE_LEN, T+R).

    Returns a list of profile commands::

        [("moveTo", (x, y)),
         ("lineTo", (x, y)),
         ("threePointArc", (mid_xy, end_xy)),
         ...]

    The caller is responsible for closing the polyline.

    Geometry:
        Bend axis (in XZ plane)     : (BASE_LEN, T + R)
        Inner arc radius            : R
        Outer arc radius            : R + T
        Inner arc start angle       : -π/2  (straight down from axis)
        Inner arc end angle         : -π/2 + θ   (rotated CCW by bend angle)
    """
    T = THICKNESS
    R = INNER_RADIUS
    L1 = BASE_LEN
    L2 = FLANGE_LEN
    θ = math.radians(angle_deg)
    sin_θ, cos_θ = math.sin(θ), math.cos(θ)

    # Bend centre (axis in XZ projection)
    cx, cz = L1, T + R

    # Outer arc endpoints (start straight below the centre, end rotated CCW by θ)
    p_outer_start = (cx, cz - (R + T))                              # = (L1, 0)
    p_outer_end_x = cx + (R + T) * math.cos(-math.pi / 2 + θ)
    p_outer_end_z = cz + (R + T) * math.sin(-math.pi / 2 + θ)
    p_outer_end = (p_outer_end_x, p_outer_end_z)
    p_outer_mid = _arc_midpoint((cx, cz), R + T,
                                -math.pi / 2, -math.pi / 2 + θ)

    # Inner arc endpoints (we will draw it back along the inner radius)
    p_inner_start = (cx, cz - R)                                    # = (L1, T)
    p_inner_end_x = cx + R * math.cos(-math.pi / 2 + θ)
    p_inner_end_z = cz + R * math.sin(-math.pi / 2 + θ)
    p_inner_end = (p_inner_end_x, p_inner_end_z)
    p_inner_mid = _arc_midpoint((cx, cz), R, -math.pi / 2, -math.pi / 2 + θ)

    # Second flange — extends from each arc endpoint by L2 along the rotated
    # +X direction (cos_θ, sin_θ).
    p_outer_far = (p_outer_end[0] + L2 * cos_θ, p_outer_end[1] + L2 * sin_θ)
    p_inner_far = (p_inner_end[0] + L2 * cos_θ, p_inner_end[1] + L2 * sin_θ)

    # Walk the profile CCW (looking at +Y), starting at the base-flange
    # bottom-left corner.
    return [
        ("moveTo", (0.0, 0.0)),
        ("lineTo", p_outer_start),
        ("threePointArc", (p_outer_mid, p_outer_end)),
        ("lineTo", p_outer_far),
        ("lineTo", p_inner_far),
        ("lineTo", p_inner_end),
        ("threePointArc", (p_inner_mid, p_inner_start)),
        ("lineTo", (0.0, T)),
        ("close", None),
    ]


def _build_z_fold_profile() -> List[Tuple[str, tuple]]:
    """
    Z-fold: base flange → UP 90° → middle flange → DOWN 90° → top flange.

    Both bends are 90° and both have inner radius R, thickness T. The middle
    flange runs vertically (along +Z) for FLANGE_LEN, then the second bend
    rotates the top flange to run along +X again, at height z ≈ 2(T+R) +
    FLANGE_LEN.
    """
    T = THICKNESS
    R = INNER_RADIUS
    L = FLANGE_LEN

    # Bend 1: same as l_bend_90, axis at (BASE_LEN, T+R)
    c1 = (BASE_LEN, T + R)
    arc1_start = (BASE_LEN, 0.0)
    arc1_end_outer = (BASE_LEN + (R + T), T + R)
    arc1_mid_outer = _arc_midpoint(c1, R + T, -math.pi / 2, 0.0)
    arc1_end_inner = (BASE_LEN + R, T + R)
    arc1_mid_inner = _arc_midpoint(c1, R, -math.pi / 2, 0.0)

    # After bend 1, the middle flange runs along +Z. Outer surface is at x
    # = BASE_LEN + R + T (the OUTSIDE of the Z-fold). Inner surface at
    # x = BASE_LEN + R.
    middle_outer_top = (BASE_LEN + R + T, T + R + L)
    middle_inner_top = (BASE_LEN + R, T + R + L)

    # Bend 2 (DOWN, 90° rotation from middle-flange direction back to +X):
    # axis at (BASE_LEN + 2*R + T, T + R + L + R) measured from outer of bend 2.
    # Actually we need axis at (cx2, cz2) such that the inner surface (radius R)
    # passes through (BASE_LEN + R, T + R + L) and the outer surface (radius
    # R + T) passes through (BASE_LEN + R + T, T + R + L).
    #
    # The middle flange runs along +Z. The bend rotates 90° from +Z back to
    # +X, so the axis is offset to the +X side of the middle flange. Inner
    # of bend 2 is on the LEFT side of the middle flange (the -X side of the
    # middle flange's outer surface).
    cx2 = BASE_LEN + R + T + R
    cz2 = T + R + L
    c2 = (cx2, cz2)

    # Outer arc of bend 2 (radius R + T) goes from (BASE_LEN + R + T, cz2) at
    # angle π (pointing -X from centre) around CCW to (cx2, cz2 + R + T) at
    # angle π/2 (pointing +Z).
    arc2_outer_start = (BASE_LEN + R + T, cz2)           # = middle_outer_top
    arc2_outer_end = (cx2, cz2 + R + T)
    arc2_mid_outer = _arc_midpoint(c2, R + T, math.pi, math.pi / 2)
    # Inner arc of bend 2 (radius R) from (BASE_LEN + R, cz2) at angle π to
    # (cx2, cz2 + R) at angle π/2.
    arc2_inner_start = (BASE_LEN + R, cz2)               # = middle_inner_top
    arc2_inner_end = (cx2, cz2 + R)
    arc2_mid_inner = _arc_midpoint(c2, R, math.pi, math.pi / 2)

    # Top flange — runs along +X from the end of bend 2 for FLANGE_LEN.
    # Outer surface at z = cz2 + R + T, inner surface at z = cz2 + R.
    top_outer_far = (arc2_outer_end[0] + L, arc2_outer_end[1])
    top_inner_far = (arc2_inner_end[0] + L, arc2_inner_end[1])

    return [
        ("moveTo", (0.0, 0.0)),
        ("lineTo", arc1_start),
        ("threePointArc", (arc1_mid_outer, arc1_end_outer)),
        ("lineTo", arc2_outer_start),
        ("threePointArc", (arc2_mid_outer, arc2_outer_end)),
        ("lineTo", top_outer_far),
        ("lineTo", top_inner_far),       # vertical sheet edge, length = T
        ("lineTo", arc2_inner_end),
        ("threePointArc", (arc2_mid_inner, arc2_inner_start)),
        ("lineTo", arc1_end_inner),
        ("threePointArc", (arc1_mid_inner, (BASE_LEN, T))),
        ("lineTo", (0.0, T)),
        ("close", None),
    ]


def _build_u_channel_profile() -> List[Tuple[str, tuple]]:
    """
    U-channel: base flange flat on z=0 with two 90° UP bends, one at each
    end of the base flange. Both side flanges rise vertically.
    """
    T = THICKNESS
    R = INNER_RADIUS
    L = FLANGE_LEN
    B = BASE_LEN

    # Bend at +X end (mirror of l_bend_90)
    cR = (B, T + R)
    arcR_outer_start = (B, 0.0)
    arcR_outer_end = (B + (R + T), T + R)
    arcR_mid_outer = _arc_midpoint(cR, R + T, -math.pi / 2, 0.0)
    arcR_inner_start = (B, T)
    arcR_inner_end = (B + R, T + R)
    arcR_mid_inner = _arc_midpoint(cR, R, -math.pi / 2, 0.0)

    # Bend at -X end (mirror image)
    cL = (0.0, T + R)
    arcL_outer_start = (-(R + T), T + R)
    arcL_outer_end = (0.0, 0.0)
    arcL_mid_outer = _arc_midpoint(cL, R + T, math.pi, -math.pi / 2)
    arcL_inner_start = (-R, T + R)
    arcL_inner_end = (0.0, T)
    arcL_mid_inner = _arc_midpoint(cL, R, math.pi, -math.pi / 2)

    # Side flange tops
    right_outer_top = (B + R + T, T + R + L)
    right_inner_top = (B + R, T + R + L)
    left_outer_top = (-(R + T), T + R + L)
    left_inner_top = (-R, T + R + L)

    return [
        ("moveTo", arcL_outer_end),                # (0, 0)
        ("lineTo", arcR_outer_start),              # (B, 0)
        ("threePointArc", (arcR_mid_outer, arcR_outer_end)),
        ("lineTo", right_outer_top),
        ("lineTo", right_inner_top),
        ("lineTo", arcR_inner_end),
        ("threePointArc", (arcR_mid_inner, arcR_inner_start)),
        ("lineTo", arcL_inner_end),                # (0, T)
        ("threePointArc", (arcL_mid_inner, arcL_inner_start)),
        ("lineTo", left_inner_top),
        ("lineTo", left_outer_top),
        ("lineTo", arcL_outer_start),
        ("threePointArc", (arcL_mid_outer, arcL_outer_end)),
        ("close", None),
    ]


# ── Profile → STEP via CadQuery ───────────────────────────────────────────


def _profile_to_solid(commands: List[Tuple[str, tuple]], width: float = WIDTH) -> cq.Workplane:
    """Replay the profile commands on a CadQuery sketch and extrude along Y."""
    wp = cq.Workplane("XZ")
    for op, arg in commands:
        if op == "moveTo":
            wp = wp.moveTo(*arg)
        elif op == "lineTo":
            wp = wp.lineTo(*arg)
        elif op == "threePointArc":
            mid, end = arg
            wp = wp.threePointArc(mid, end)
        elif op == "close":
            wp = wp.close()
        else:
            raise ValueError(f"Unknown profile op: {op!r}")
    return wp.extrude(width).translate((0.0, -width / 2, 0.0))


def _save_step(solid: cq.Workplane, path: str) -> None:
    cq.exporters.export(solid, path, exportType="STEP")


# ── Expected-result construction ──────────────────────────────────────────


def _expected_l_bend(angle_deg: float, name: str) -> Expected:
    """
    Flat-pattern dimensions for an L-bend.

    In every fixture in this file, ``BASE_LEN`` and ``FLANGE_LEN`` are the
    **bend-tangent-to-sheet-edge** dimensions — i.e. the length of the
    flat portion of each flange, measured from the bend tangent (where
    the cylindrical bend starts) to the sheet's far edge along the outer
    surface. They are *not* the outer mold-line lengths and they are not
    the neutral-axis lengths.

    With that convention, the flat length is:

        flat = Σ flange_bend_tangent_lengths + Σ BA
             = BASE_LEN + FLANGE_LEN + BA

    where BA = (π/180) · angle · (R + K·T). This is the "k-line" /
    "tangent-line" method: the bend allowance arc is *added between*
    the flat portions (it is not subtracted, because the flat portions
    do not include the bend region).

    The bend line on the flat pattern is at the *center* of the BA gap:

        x_bend = BASE_LEN + BA/2
    """
    ba = bend_allowance(angle_deg, INNER_RADIUS, THICKNESS, K_FACTOR)
    flat_width = BASE_LEN + FLANGE_LEN + ba
    flat_height = WIDTH
    x_bend = BASE_LEN + ba / 2.0

    return Expected(
        name=name,
        thickness_mm=THICKNESS,
        k_factor=K_FACTOR,
        material=MATERIAL,
        bends=[ExpectedBend(angle_deg=angle_deg,
                            inner_radius_mm=INNER_RADIUS,
                            direction="UP",
                            length_mm=WIDTH)],
        flat_dimensions_mm={"width": round(flat_width, 3),
                            "height": round(flat_height, 3)},
        bend_lines_on_flat=[{"x_from_left_mm": round(x_bend, 3),
                             "y0": 0.0, "y1": round(flat_height, 3)}],
        notes=("Flat length = BASE_LEN + FLANGE_LEN + BA where "
               f"BA = (π/180)·{angle_deg}·(R+K·T)."),
    )


def _expected_z_fold() -> Expected:
    """Z-fold: two 90° bends, one UP one DOWN. Both BAs added."""
    ba = bend_allowance(90.0, INNER_RADIUS, THICKNESS, K_FACTOR)
    flat_width = BASE_LEN + FLANGE_LEN + FLANGE_LEN + 2.0 * ba
    flat_height = WIDTH
    x_bend_1 = BASE_LEN + ba / 2.0
    x_bend_2 = BASE_LEN + ba + FLANGE_LEN + ba / 2.0

    return Expected(
        name="z_fold",
        thickness_mm=THICKNESS,
        k_factor=K_FACTOR,
        material=MATERIAL,
        bends=[
            ExpectedBend(angle_deg=90.0, inner_radius_mm=INNER_RADIUS,
                         direction="UP", length_mm=WIDTH),
            ExpectedBend(angle_deg=90.0, inner_radius_mm=INNER_RADIUS,
                         direction="DOWN", length_mm=WIDTH),
        ],
        flat_dimensions_mm={"width": round(flat_width, 3),
                            "height": round(flat_height, 3)},
        bend_lines_on_flat=[
            {"x_from_left_mm": round(x_bend_1, 3),
             "y0": 0.0, "y1": round(flat_height, 3)},
            {"x_from_left_mm": round(x_bend_2, 3),
             "y0": 0.0, "y1": round(flat_height, 3)},
        ],
        notes="Z-fold: UP then DOWN, both 90°. Flat length adds 2× BA.",
    )


def _expected_u_channel() -> Expected:
    """U-channel: two 90° UP bends, one at each end of the base flange."""
    ba = bend_allowance(90.0, INNER_RADIUS, THICKNESS, K_FACTOR)
    flat_width = BASE_LEN + 2.0 * FLANGE_LEN + 2.0 * ba
    flat_height = WIDTH
    # The base flange is the largest planar face → engine puts it as the
    # unfolding anchor at the centre. Left side flange unfolds out to the
    # left, right side flange to the right.
    x_bend_left = FLANGE_LEN + ba / 2.0
    x_bend_right = FLANGE_LEN + ba + BASE_LEN + ba / 2.0

    return Expected(
        name="u_channel",
        thickness_mm=THICKNESS,
        k_factor=K_FACTOR,
        material=MATERIAL,
        bends=[
            ExpectedBend(angle_deg=90.0, inner_radius_mm=INNER_RADIUS,
                         direction="UP", length_mm=WIDTH),
            ExpectedBend(angle_deg=90.0, inner_radius_mm=INNER_RADIUS,
                         direction="UP", length_mm=WIDTH),
        ],
        flat_dimensions_mm={"width": round(flat_width, 3),
                            "height": round(flat_height, 3)},
        bend_lines_on_flat=[
            {"x_from_left_mm": round(x_bend_left, 3),
             "y0": 0.0, "y1": round(flat_height, 3)},
            {"x_from_left_mm": round(x_bend_right, 3),
             "y0": 0.0, "y1": round(flat_height, 3)},
        ],
        notes="U-channel: two 90° UP bends, one at each end of the base flange.",
    )


# ── Orchestration ─────────────────────────────────────────────────────────


def _fixtures_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.normpath(os.path.join(here, "..", "tests", "fixtures", "unfold"))
    os.makedirs(root, exist_ok=True)
    return root


_FIXTURES = [
    ("l_bend_90",  lambda: _profile_to_solid(_build_l_bend_profile(90.0)),
     lambda: _expected_l_bend(90.0, "l_bend_90")),
    ("l_bend_135", lambda: _profile_to_solid(_build_l_bend_profile(135.0)),
     lambda: _expected_l_bend(135.0, "l_bend_135")),
    ("l_bend_45",  lambda: _profile_to_solid(_build_l_bend_profile(45.0)),
     lambda: _expected_l_bend(45.0, "l_bend_45")),
    ("z_fold",     lambda: _profile_to_solid(_build_z_fold_profile()),
     _expected_z_fold),
    ("u_channel",  lambda: _profile_to_solid(_build_u_channel_profile()),
     _expected_u_channel),
]


def _expected_to_json(exp: Expected) -> dict:
    d = asdict(exp)
    return d


def build_all(root: str) -> List[str]:
    """Build every fixture; return the list of generated file paths."""
    written: List[str] = []
    for name, build_solid, build_expected in _FIXTURES:
        step_path = os.path.join(root, f"{name}.step")
        json_path = os.path.join(root, f"{name}.expected.json")
        try:
            solid = build_solid()
            _save_step(solid, step_path)
            with open(json_path, "w") as f:
                json.dump(_expected_to_json(build_expected()), f, indent=2)
            written.extend([step_path, json_path])
            print(f"[ok] {name}: {step_path} + {json_path}")
        except Exception as e:
            print(f"[FAIL] {name}: {type(e).__name__}: {e}", file=sys.stderr)
            raise
    return written


def verify_all(root: str) -> int:
    """Sanity-check the expected JSONs without rebuilding the STEPs.

    Re-derives the analytic numbers and confirms they match the on-disk
    JSON to within 0.01 mm. Returns the number of mismatches.
    """
    mismatches = 0
    for name, _, build_expected in _FIXTURES:
        json_path = os.path.join(root, f"{name}.expected.json")
        if not os.path.isfile(json_path):
            print(f"[miss] {name}: {json_path} not on disk")
            mismatches += 1
            continue
        with open(json_path) as f:
            on_disk = json.load(f)
        recomputed = _expected_to_json(build_expected())
        for key in ("flat_dimensions_mm",):
            w_disk = on_disk[key]["width"]
            w_recomp = recomputed[key]["width"]
            if abs(w_disk - w_recomp) > 0.01:
                print(f"[diff] {name}: width {w_disk} vs recomputed {w_recomp}")
                mismatches += 1
        if mismatches == 0:
            print(f"[ok]   {name}: width {recomputed['flat_dimensions_mm']['width']:.3f} mm")
    return mismatches


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    p.add_argument("--verify", action="store_true",
                   help="Re-check the math without regenerating STEP files.")
    args = p.parse_args()

    root = _fixtures_root()
    if args.verify:
        return verify_all(root)

    build_all(root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
