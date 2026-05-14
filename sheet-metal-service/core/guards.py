"""Runtime sanity checks for the unfold pipeline.

Each guard raises a typed exception when its invariant is violated. The
caller (FastAPI endpoint in ``main.py``) catches these and returns a
clear 4xx / 5xx with an actionable message so support can triage real
customer parts.

The thresholds are intentionally loose enough that legitimate sheet
metal geometry never trips them — they are there to detect *garbage in*
(non-sheet-metal STEPs, corrupted exports, mis-categorised faces).
"""

from __future__ import annotations

from typing import Iterable


# ── Typed exceptions ──────────────────────────────────────────────────────


class UnfoldGuardError(Exception):
    """Base class for every runtime guard failure."""


class ThicknessOutOfRangeError(UnfoldGuardError):
    """Detected sheet thickness outside the supported range."""


class BendAngleOutOfRangeError(UnfoldGuardError):
    """A detected bend has an angle outside the physical range [1°, 180°]."""


class FlatAreaMismatchError(UnfoldGuardError):
    """Unfolded sheet area differs from the input B-rep surface area by more than 5%."""


class DisconnectedSheetWarning(UnfoldGuardError):
    """The face adjacency graph has more than one disconnected component."""


# ── Thresholds ────────────────────────────────────────────────────────────


MIN_THICKNESS_MM = 0.3
MAX_THICKNESS_MM = 20.0

MIN_BEND_ANGLE_DEG = 1.0
MAX_BEND_ANGLE_DEG = 180.0

MAX_FLAT_AREA_DELTA_FRACTION = 0.05


# ── Guards ────────────────────────────────────────────────────────────────


def check_thickness(thickness_mm: float) -> None:
    if not (MIN_THICKNESS_MM <= thickness_mm <= MAX_THICKNESS_MM):
        raise ThicknessOutOfRangeError(
            f"Detected sheet thickness {thickness_mm:.3f} mm outside the "
            f"supported range [{MIN_THICKNESS_MM}, {MAX_THICKNESS_MM}] mm. "
            "Either the input is not a sheet-metal part, the STEP units "
            "are wrong (m vs mm), or the parallel-plane heuristic picked "
            "the wrong face pair. Pass an explicit thickness_override on "
            "the API call to bypass auto-detection."
        )


def check_bend_angles(angles_deg: Iterable[float]) -> None:
    for a in angles_deg:
        if not (MIN_BEND_ANGLE_DEG <= a <= MAX_BEND_ANGLE_DEG):
            raise BendAngleOutOfRangeError(
                f"Detected bend angle {a:.2f}° outside the physical range "
                f"[{MIN_BEND_ANGLE_DEG}°, {MAX_BEND_ANGLE_DEG}°]. The face "
                "classifier or the dihedral computation produced a "
                "non-physical value."
            )


def check_flat_area(flat_area_mm2: float, solid_surface_area_mm2: float) -> None:
    # A single sheet of thickness T has its planar surface area = 2 ×
    # flat_pattern_area + the edge strips (which are O(T·perimeter), tiny
    # in absolute terms). We compare flat against solid/2 with a 5%
    # tolerance to allow for the edge strip contribution and rounded
    # corners that aren't perfectly preserved by the unfolding.
    if solid_surface_area_mm2 <= 0 or flat_area_mm2 <= 0:
        return
    expected = solid_surface_area_mm2 / 2.0
    delta = abs(flat_area_mm2 - expected) / expected
    if delta > MAX_FLAT_AREA_DELTA_FRACTION:
        raise FlatAreaMismatchError(
            f"Flat pattern area {flat_area_mm2:.1f} mm² differs from "
            f"½ × solid surface area ({expected:.1f} mm²) by "
            f"{delta * 100:.1f}% — exceeds the 5% guard threshold. "
            "The unfold likely missed a flange or double-counted one."
        )
