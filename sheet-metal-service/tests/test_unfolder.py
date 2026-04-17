"""
Tests for the sheet metal unfolding pipeline.

Uses CadQuery to generate test STEP files programmatically, then runs
the full pipeline and validates results.
"""

import math
import os
import tempfile

import pytest

# ── Test STEP file generators (using CadQuery) ─────────────────────────────


def _make_l_bracket(flange1=50, flange2=30, width=40, thickness=2, radius=2):
    """L-bracket: one 90° bend."""
    import cadquery as cq

    result = (
        cq.Workplane("XY")
        .box(flange1, width, thickness)
        .faces(">Z").workplane()
        .transformed(offset=(flange1 / 2 - thickness / 2, 0, 0))
        .box(thickness, width, flange2)
    )

    # Simpler approach: create as a sheet metal part via extrude + fillet
    # For testing, use a solid L-shape
    result = (
        cq.Workplane("XY")
        .moveTo(0, 0)
        .lineTo(flange1, 0)
        .lineTo(flange1, thickness)
        .lineTo(thickness + radius, thickness)
        .threePointArc((thickness, thickness + radius), (thickness, thickness + radius))
        .lineTo(thickness, flange2)
        .lineTo(0, flange2)
        .close()
        .extrude(width)
    )

    return result


def _make_u_channel(flange_top=30, flange_bottom=60, flange_side=25,
                    width=40, thickness=2, radius=2):
    """U-channel: two 90° bends, same direction."""
    import cadquery as cq

    # Cross-section profile
    r_inner = radius
    r_outer = radius + thickness

    result = (
        cq.Workplane("XY")
        .moveTo(0, 0)
        .lineTo(flange_bottom, 0)
        .lineTo(flange_bottom, thickness)
        .lineTo(flange_bottom - thickness + r_inner, thickness)
        # Right bend (inner)
        .tangentArcPoint((flange_bottom - thickness, thickness + r_inner), relative=False)
        .lineTo(flange_bottom - thickness, flange_side)
        .lineTo(flange_bottom, flange_side)
        .lineTo(flange_bottom, thickness + r_outer)
        # Right bend (outer)
        .tangentArcPoint((flange_bottom - thickness + r_outer, 0), relative=False)
        # Already at bottom right — this approach is tricky
        # Use a simpler box-based approach
    )

    # Simpler: just create a U-shape with sharp corners for testing
    result = (
        cq.Workplane("XY")
        .moveTo(0, 0)
        .lineTo(flange_bottom, 0)
        .lineTo(flange_bottom, flange_side)
        .lineTo(flange_bottom - thickness, flange_side)
        .lineTo(flange_bottom - thickness, thickness)
        .lineTo(thickness, thickness)
        .lineTo(thickness, flange_side)
        .lineTo(0, flange_side)
        .close()
        .extrude(width)
    )

    return result


def _save_step(cq_result, path):
    """Export a CadQuery result to STEP."""
    import cadquery as cq
    cq.exporters.export(cq_result, path, exportType="STEP")


# ── K-factor / bend calc tests (pure math, no OCC needed) ──────────────────


class TestBendCalculations:
    """Test bend allowance and deduction formulas."""

    def test_90deg_bend_allowance(self):
        from core.kfactor import compute_bend
        bc = compute_bend(angle_deg=90, inner_radius=2.0, thickness=2.0, k_factor=0.33)
        # BA = (π/180) × 90 × (2.0 + 0.33 × 2.0) = π/2 × 2.66 = 4.178
        expected_ba = (math.pi / 180) * 90 * (2.0 + 0.33 * 2.0)
        assert abs(bc.bend_allowance - expected_ba) < 0.01

    def test_90deg_bend_deduction(self):
        from core.kfactor import compute_bend
        bc = compute_bend(angle_deg=90, inner_radius=2.0, thickness=2.0, k_factor=0.33)
        # OSSB = (2 + 2) × tan(45°) = 4.0
        # BD = 2 × 4.0 - BA = 8.0 - 4.178 = 3.822
        expected_ossb = (2.0 + 2.0) * math.tan(math.radians(45))
        expected_bd = 2 * expected_ossb - bc.bend_allowance
        assert abs(bc.bend_deduction - expected_bd) < 0.01

    def test_135deg_bend(self):
        from core.kfactor import compute_bend
        bc = compute_bend(angle_deg=135, inner_radius=1.5, thickness=1.0, k_factor=0.33)
        expected_ba = (math.pi / 180) * 135 * (1.5 + 0.33 * 1.0)
        assert abs(bc.bend_allowance - expected_ba) < 0.01

    def test_k_factor_lookup(self):
        from core.kfactor import get_k_factor
        assert get_k_factor("aluminum", 1.0) == 0.33
        assert get_k_factor("stainless_steel", 2.0) == 0.35
        assert get_k_factor("mild_steel", 1.0) == 0.33
        assert get_k_factor("mild_steel", 3.0) == 0.38
        assert get_k_factor("mild_steel", 5.0) == 0.40

    def test_flat_length(self):
        from core.kfactor import compute_flat_length
        # Simple L-bracket: two flanges 50mm and 30mm outer, one 90° bend
        # BD ≈ 3.82 for R2, T2, K0.33
        length = compute_flat_length([50.0, 30.0], [3.82])
        assert abs(length - 76.18) < 0.1


# ── Integration tests (require CadQuery / OCC) ────────────────────────────


@pytest.fixture
def l_bracket_step(tmp_path):
    """Generate and save an L-bracket STEP file."""
    try:
        result = _make_l_bracket()
        path = str(tmp_path / "l_bracket.step")
        _save_step(result, path)
        return path
    except ImportError:
        pytest.skip("CadQuery not available")


@pytest.fixture
def u_channel_step(tmp_path):
    """Generate and save a U-channel STEP file."""
    try:
        result = _make_u_channel()
        path = str(tmp_path / "u_channel.step")
        _save_step(result, path)
        return path
    except ImportError:
        pytest.skip("CadQuery not available")


class TestSTEPParser:
    def test_load_step(self, l_bracket_step):
        from core.step_parser import load_step
        solids = load_step(l_bracket_step)
        assert len(solids) >= 1

    def test_build_topology(self, l_bracket_step):
        from core.step_parser import load_step, build_topology
        solids = load_step(l_bracket_step)
        topo = build_topology(solids[0])
        assert len(topo.faces) > 0
        assert topo.volume > 0
        assert topo.bbox is not None


class TestThicknessDetection:
    def test_detect_thickness(self, l_bracket_step):
        from core.step_parser import load_step, build_topology
        from core.thickness_detector import detect_thickness
        solids = load_step(l_bracket_step)
        topo = build_topology(solids[0])
        t, conf = detect_thickness(topo)
        # Our L-bracket is 2mm thick
        assert 1.5 <= t <= 2.5
        assert conf > 0.3


class TestFaceClassification:
    def test_classify(self, l_bracket_step):
        from core.step_parser import load_step, build_topology
        from core.thickness_detector import detect_thickness
        from core.face_classifier import classify_faces, FaceType
        solids = load_step(l_bracket_step)
        topo = build_topology(solids[0])
        t, _ = detect_thickness(topo)
        classified = classify_faces(topo, t)

        types = [cf.face_type for cf in classified]
        assert FaceType.FLANGE in types
        # L-bracket should have at least one cylindrical bend
        # (depends on whether our CadQuery model has fillets)


class TestFullPipeline:
    def test_l_bracket_unfold(self, l_bracket_step):
        from core.step_parser import load_step, build_topology
        from core.thickness_detector import detect_thickness
        from core.face_classifier import classify_faces
        from core.bend_detector import detect_bends
        from core.bend_graph import build_bend_graph
        from core.unfolder import unfold

        solids = load_step(l_bracket_step)
        topo = build_topology(solids[0])
        t, _ = detect_thickness(topo)
        classified = classify_faces(topo, t)
        bends = detect_bends(topo, classified, t)
        bend_graph = build_bend_graph(classified, bends)
        flat = unfold(topo, classified, bends, bend_graph, t, 0.33)

        assert flat.width > 0
        assert flat.height > 0
        # At minimum 4 edges (rectangular fallback); real flange geometry may
        # produce more when non-rectangular (notches, radiused corners, etc.).
        assert len(flat.outer_edges) >= 4

    def test_dxf_export(self, l_bracket_step, tmp_path):
        from core.step_parser import load_step, build_topology
        from core.thickness_detector import detect_thickness
        from core.face_classifier import classify_faces
        from core.bend_detector import detect_bends
        from core.bend_graph import build_bend_graph
        from core.unfolder import unfold
        from export.dxf_exporter import export_dxf

        solids = load_step(l_bracket_step)
        topo = build_topology(solids[0])
        t, _ = detect_thickness(topo)
        classified = classify_faces(topo, t)
        bends = detect_bends(topo, classified, t)
        bend_graph = build_bend_graph(classified, bends)
        flat = unfold(topo, classified, bends, bend_graph, t, 0.33)

        dxf_path = str(tmp_path / "test.dxf")
        export_dxf(flat, dxf_path)
        assert os.path.exists(dxf_path)
        assert os.path.getsize(dxf_path) > 100

    def test_svg_export(self, l_bracket_step):
        from core.step_parser import load_step, build_topology
        from core.thickness_detector import detect_thickness
        from core.face_classifier import classify_faces
        from core.bend_detector import detect_bends
        from core.bend_graph import build_bend_graph
        from core.unfolder import unfold
        from export.svg_exporter import export_svg

        solids = load_step(l_bracket_step)
        topo = build_topology(solids[0])
        t, _ = detect_thickness(topo)
        classified = classify_faces(topo, t)
        bends = detect_bends(topo, classified, t)
        bend_graph = build_bend_graph(classified, bends)
        flat = unfold(topo, classified, bends, bend_graph, t, 0.33)

        svg = export_svg(flat, "test_part")
        assert "<svg" in svg
        assert len(svg) > 100

    def test_pdf_generation(self, l_bracket_step, tmp_path):
        from core.step_parser import load_step, build_topology
        from core.thickness_detector import detect_thickness
        from core.face_classifier import classify_faces
        from core.bend_detector import detect_bends
        from core.bend_graph import build_bend_graph
        from core.unfolder import unfold
        from drawing.pdf_generator import generate_pdf

        solids = load_step(l_bracket_step)
        topo = build_topology(solids[0])
        t, _ = detect_thickness(topo)
        classified = classify_faces(topo, t)
        bends = detect_bends(topo, classified, t)
        bend_graph = build_bend_graph(classified, bends)
        flat = unfold(topo, classified, bends, bend_graph, t, 0.33)

        pdf_bytes = generate_pdf(
            flat=flat,
            bends=bends,
            thickness=t,
            k_factor=0.33,
            part_name="L_Bracket",
            material="Steel",
            shape=solids[0],
        )
        assert len(pdf_bytes) > 1000
        assert pdf_bytes[:4] == b"%PDF"
