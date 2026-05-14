"""End-to-end fixture tests for the unfold pipeline.

Each fixture is a hand-built STEP from ``tools/build_fixtures.py`` with a
paired ``*.expected.json`` carrying analytically-derived targets. These
tests catch regressions in face classification, bend detection, angle
convention, K-factor application, and the BA-gap unfold translation —
in other words, every fix in ``UNFOLD_FIX_LOG.md``.

Fixtures that still hit known engine limitations (``z_fold`` and
``u_channel`` — the bend-graph treats the U-shape as two disconnected
components and the unfolder doesn't propagate every component's
projection into the outline bbox) are skipped here; they are exercised
manually via ``tools/build_fixtures.py`` and tracked in
``UNFOLD_FIX_LOG.md``.
"""

import json
import os
import pytest

FIX_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "unfold")


def _load_expected(name: str) -> dict:
    with open(os.path.join(FIX_DIR, f"{name}.expected.json")) as f:
        return json.load(f)


def _run_engine(name: str):
    """Run the full pipeline and return ``(flat, bends, thickness, k_factor)``."""
    from core.step_parser import load_step, build_topology
    from core.thickness_detector import detect_thickness
    from core.face_classifier import classify_faces
    from core.bend_detector import detect_bends
    from core.bend_graph import build_bend_graph
    from core.unfolder import unfold
    from core.kfactor import get_k_factor

    step_path = os.path.join(FIX_DIR, f"{name}.step")
    solids = load_step(step_path)
    topo = build_topology(solids[0])
    t, _ = detect_thickness(topo)
    classified = classify_faces(topo, t)
    bends = detect_bends(topo, classified, t)
    bend_graph = build_bend_graph(classified, bends)
    k = get_k_factor("mild_steel", t)
    flat = unfold(topo, classified, bends, bend_graph, t, k)
    return flat, bends, t, k


def _has_fixture(name: str) -> bool:
    return os.path.isfile(os.path.join(FIX_DIR, f"{name}.step"))


@pytest.mark.skipif(not _has_fixture("l_bend_90"),
                    reason="l_bend_90 fixture not generated — run tools/build_fixtures.py")
@pytest.mark.parametrize("name, expected_angle, expected_radius", [
    ("l_bend_90", 90.0, 2.0),
    ("l_bend_135", 135.0, 2.0),
    ("l_bend_45", 45.0, 2.0),
])
def test_l_bend_engine_matches_expected(name, expected_angle, expected_radius):
    expected = _load_expected(name)
    flat, bends, thickness, k = _run_engine(name)

    # Thickness within 0.05 mm (auto-detection precision).
    assert abs(thickness - expected["thickness_mm"]) < 0.05, (
        f"{name}: thickness {thickness} vs expected {expected['thickness_mm']}"
    )

    # Exactly one bend, with the right angle, radius, and direction.
    assert len(bends) == 1, f"{name}: expected 1 bend, got {len(bends)}"
    b = bends[0]
    assert abs(b.angle_deg - expected_angle) < 0.1, (
        f"{name}: angle {b.angle_deg}° vs expected {expected_angle}°"
    )
    assert abs(b.inner_radius - expected_radius) < 0.05, (
        f"{name}: R {b.inner_radius} vs expected {expected_radius}"
    )
    assert b.direction == expected["bends"][0]["direction"], (
        f"{name}: direction {b.direction} vs expected "
        f"{expected['bends'][0]['direction']}"
    )

    # Flat width within 0.01 mm of the analytic target (passes through
    # the BA-gap translation in _bfs_compose_transforms).
    expected_w = expected["flat_dimensions_mm"]["width"]
    assert abs(flat.width - expected_w) < 0.01, (
        f"{name}: flat width {flat.width} vs expected {expected_w}"
    )


@pytest.mark.skipif(not _has_fixture("z_fold"),
                    reason="z_fold fixture not generated")
@pytest.mark.xfail(reason="z_fold trips two open engine bugs documented in "
                          "UNFOLD_FIX_LOG.md: phantom bend detection on the "
                          "middle flange's tangent-continuous cylindrical "
                          "surface, and disconnected-component layout not "
                          "feeding the outline bbox.",
                  strict=False)
def test_z_fold_engine_matches_expected():
    expected = _load_expected("z_fold")
    flat, bends, thickness, k = _run_engine("z_fold")
    assert len(bends) == 2  # currently 3 — phantom from B-rep tangent issue
    expected_w = expected["flat_dimensions_mm"]["width"]
    assert abs(flat.width - expected_w) < 0.01


@pytest.mark.skipif(not _has_fixture("u_channel"),
                    reason="u_channel fixture not generated")
@pytest.mark.xfail(reason="u_channel trips the open disconnected-component "
                          "outline bug documented in UNFOLD_FIX_LOG.md: the "
                          "second side flange's projection isn't merged into "
                          "the unioned outline so the flat width comes out "
                          "short by ~one flange length.",
                  strict=False)
def test_u_channel_engine_matches_expected():
    expected = _load_expected("u_channel")
    flat, bends, thickness, k = _run_engine("u_channel")
    assert len(bends) == 2
    for b in bends:
        assert b.direction == "UP"
    expected_w = expected["flat_dimensions_mm"]["width"]
    assert abs(flat.width - expected_w) < 0.01
