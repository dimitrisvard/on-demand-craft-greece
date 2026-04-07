"""
Auto-detect sheet metal thickness from B-Rep geometry.

Uses multiple methods and returns a consensus value:
  1. Parallel planar face distance (most reliable)
  2. Cylindrical face inner/outer radius difference
  3. Volume / (surface_area / 2) estimation

Returns (thickness_mm, confidence) where confidence ∈ [0, 1].
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Tuple, Optional, List

from core.step_parser import Topology, FaceInfo

# Valid sheet-metal thickness range (mm)
_MIN_T = 0.3
_MAX_T = 25.0
_ROUND_PRECISION = 2  # decimals for bucketing


def detect_thickness(topo: Topology) -> Tuple[float, float]:
    """
    Return (thickness_mm, confidence).
    Confidence is 0.0–1.0 indicating how sure we are.
    Falls back to smallest bounding-box dimension if all methods fail.
    """
    candidates: List[float] = []

    t1 = _method_parallel_faces(topo)
    if t1 is not None:
        candidates.append(t1)

    t2 = _method_cylinder_radii(topo)
    if t2 is not None:
        candidates.append(t2)

    t3 = _method_volume_area(topo)
    if t3 is not None:
        candidates.append(t3)

    if not candidates:
        # Fallback: smallest bbox dimension
        if topo.bbox:
            dims = [
                topo.bbox[3] - topo.bbox[0],
                topo.bbox[4] - topo.bbox[1],
                topo.bbox[5] - topo.bbox[2],
            ]
            fallback = min(dims)
            if _MIN_T <= fallback <= _MAX_T:
                return round(fallback, _ROUND_PRECISION), 0.3
        return 2.0, 0.1  # absolute fallback

    # Use median of candidates
    candidates.sort()
    median = candidates[len(candidates) // 2]

    # Confidence based on agreement
    if len(candidates) >= 2:
        spread = max(candidates) - min(candidates)
        agreement = 1.0 - min(spread / median, 1.0) if median > 0 else 0.0
        confidence = min(0.5 + 0.5 * agreement, 1.0)
    else:
        confidence = 0.6

    return round(median, _ROUND_PRECISION), round(confidence, 2)


# ── Method 1: Parallel planar face pairs ───────────────────────────────────

def _method_parallel_faces(topo: Topology) -> Optional[float]:
    """Find the most common small distance between parallel planar face pairs."""
    planar = [f for f in topo.faces if f.surface_type == "plane" and f.normal is not None]
    if len(planar) < 2:
        return None

    distances: List[float] = []
    for i in range(len(planar)):
        ni = planar[i].normal
        ci = planar[i].center_of_mass
        for j in range(i + 1, len(planar)):
            nj = planar[j].normal
            # Check anti-parallel (opposing normals)
            dot = _dot(ni, nj)
            if abs(dot + 1.0) > 0.05:  # not anti-parallel
                continue
            # Distance between parallel planes
            diff = _sub(planar[j].center_of_mass, ci)
            dist = abs(_dot(diff, ni))
            if _MIN_T <= dist <= _MAX_T:
                distances.append(round(dist, _ROUND_PRECISION))

    if not distances:
        return None

    # Most common distance
    counter = Counter(distances)
    best, _ = counter.most_common(1)[0]
    return best


# ── Method 2: Cylindrical face radii difference ───────────────────────────

def _method_cylinder_radii(topo: Topology) -> Optional[float]:
    """
    Group cylindrical faces by bend axis and look for inner/outer pairs
    whose radius difference is the thickness.
    """
    cylinders = [f for f in topo.faces if f.surface_type == "cylinder" and f.radius is not None]
    if len(cylinders) < 2:
        return None

    # Group by axis direction (±tolerance)
    groups: dict[tuple, list[float]] = {}
    for c in cylinders:
        key = _axis_bucket(c.axis)
        groups.setdefault(key, []).append(c.radius)

    diffs: List[float] = []
    for radii in groups.values():
        radii_sorted = sorted(set(round(r, 3) for r in radii))
        for i in range(len(radii_sorted)):
            for j in range(i + 1, len(radii_sorted)):
                d = radii_sorted[j] - radii_sorted[i]
                if _MIN_T <= d <= _MAX_T:
                    diffs.append(round(d, _ROUND_PRECISION))

    if not diffs:
        return None

    counter = Counter(diffs)
    best, _ = counter.most_common(1)[0]
    return best


# ── Method 3: Volume / surface area ───────────────────────────────────────

def _method_volume_area(topo: Topology) -> Optional[float]:
    flanges = [f for f in topo.faces if f.surface_type == "plane"]
    if not flanges:
        return None
    total_flange_area = sum(f.area for f in flanges)
    if total_flange_area < 1e-6 or topo.volume < 1e-6:
        return None
    # volume ≈ thickness × (total_one_side_area)
    # total_flange_area includes both sides + thickness faces
    # Rough estimate: total_one_side = total_flange_area / 3  (top + bottom + edges)
    est = topo.volume / (total_flange_area / 2.5)
    if _MIN_T <= est <= _MAX_T:
        return round(est, _ROUND_PRECISION)
    return None


# ── Vector helpers ─────────────────────────────────────────────────────────

def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

def _axis_bucket(axis):
    """Bucket an axis direction to a canonical form (ignore sign)."""
    if axis is None:
        return (0, 0, 0)
    a = tuple(round(abs(x), 1) for x in axis)
    return tuple(sorted(a, reverse=True))
