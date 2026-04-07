"""
Tests for DXF export functionality.
"""

import os
import pytest

from core.unfolder import FlatPattern, Edge2D, BendLine2D
from core.bend_detector import BendInfo
from core.kfactor import compute_bend


def _make_test_flat_pattern():
    """Create a simple flat pattern for testing exports."""
    flat = FlatPattern()
    flat.width = 150.0
    flat.height = 60.0
    flat.outer_edges = [
        Edge2D(start=(0, 0), end=(150, 0)),
        Edge2D(start=(150, 0), end=(150, 60)),
        Edge2D(start=(150, 60), end=(0, 60)),
        Edge2D(start=(0, 60), end=(0, 0)),
    ]

    # Two bends
    bi1 = BendInfo(
        bend_id=1, face_index=0,
        inner_radius=2.0, outer_radius=4.0,
        angle_deg=90, angular_span=1.5708,
        direction="UP", axis=(0, 1, 0), axis_location=(50, 0, 0),
        adjacent_flanges=(0, 1), length=60, is_inner=True,
        orientation="VALLEY",
    )
    bi2 = BendInfo(
        bend_id=2, face_index=1,
        inner_radius=2.0, outer_radius=4.0,
        angle_deg=90, angular_span=1.5708,
        direction="DOWN", axis=(0, 1, 0), axis_location=(100, 0, 0),
        adjacent_flanges=(1, 2), length=60, is_inner=True,
        orientation="MOUNTAIN",
    )

    bc = compute_bend(90, 2.0, 2.0, 0.33)

    flat.bend_lines = [
        BendLine2D(start=(50, 0), end=(50, 60), bend_info=bi1, bend_calc=bc),
        BendLine2D(start=(100, 0), end=(100, 60), bend_info=bi2, bend_calc=bc),
    ]

    return flat


class TestDXFExport:
    def test_export_creates_file(self, tmp_path):
        from export.dxf_exporter import export_dxf
        flat = _make_test_flat_pattern()
        path = str(tmp_path / "test.dxf")
        export_dxf(flat, path, "TestPart")
        assert os.path.exists(path)
        assert os.path.getsize(path) > 100

    def test_dxf_has_correct_layers(self, tmp_path):
        import ezdxf
        from export.dxf_exporter import export_dxf
        flat = _make_test_flat_pattern()
        path = str(tmp_path / "test.dxf")
        export_dxf(flat, path)

        doc = ezdxf.readfile(path)
        layer_names = {l.dxf.name for l in doc.layers}
        assert "OUTLINE" in layer_names
        assert "BEND_UP" in layer_names
        assert "BEND_DOWN" in layer_names

    def test_dxf_has_outline_entities(self, tmp_path):
        import ezdxf
        from export.dxf_exporter import export_dxf
        flat = _make_test_flat_pattern()
        path = str(tmp_path / "test.dxf")
        export_dxf(flat, path)

        doc = ezdxf.readfile(path)
        msp = doc.modelspace()
        outline_entities = [e for e in msp if e.dxf.layer == "OUTLINE"]
        assert len(outline_entities) == 4  # 4 edges of rectangle


class TestSVGExport:
    def test_export_returns_svg(self):
        from export.svg_exporter import export_svg
        flat = _make_test_flat_pattern()
        svg = export_svg(flat, "TestPart")
        assert "<svg" in svg
        assert "</svg>" in svg

    def test_empty_pattern(self):
        from export.svg_exporter import export_svg
        flat = FlatPattern()
        svg = export_svg(flat)
        assert "<svg" in svg
        assert "not available" in svg
