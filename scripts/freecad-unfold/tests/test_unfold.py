"""
Tests for the sheet metal unfold service.

These tests cover:
- Bend allowance / deduction calculations
- Dimension computation logic
- DXF export
- PDF generation (smoke test)
- Config validation

Note: Tests that require FreeCAD (geometry extraction, rendering) are marked
with @pytest.mark.freecad and skipped in environments without FreeCAD.
"""

import os
import sys
import math
import json
import tempfile

import pytest

# Add the app directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from config import (
    MIN_THICKNESS_MM,
    MAX_THICKNESS_MM,
    K_FACTORS,
    DEFAULT_K_FACTOR,
    MAX_FILE_SIZE,
)


# ---- Bend calculation tests ----

class TestBendCalculations:
    """Test bend allowance and bend deduction formulas."""

    def _bend_allowance(self, angle_deg, inner_r, k, thickness):
        return (math.pi / 180.0) * angle_deg * (inner_r + k * thickness)

    def _bend_deduction(self, angle_deg, inner_r, k, thickness):
        ba = self._bend_allowance(angle_deg, inner_r, k, thickness)
        return 2.0 * (inner_r + thickness) * math.tan(math.radians(angle_deg / 2.0)) - ba

    def test_90_degree_bend_allowance(self):
        """Standard 90-degree bend in 2mm steel with R2.0."""
        ba = self._bend_allowance(90, 2.0, 0.44, 2.0)
        assert 4.4 < ba < 4.6, f"Expected ~4.52, got {ba:.4f}"

    def test_90_degree_bend_deduction(self):
        """Bend deduction for 90-degree bend."""
        bd = self._bend_deduction(90, 2.0, 0.44, 2.0)
        assert 1.0 < bd < 2.0, f"Expected ~1.48, got {bd:.4f}"

    def test_45_degree_bend(self):
        """45-degree bend."""
        ba = self._bend_allowance(45, 2.0, 0.44, 2.0)
        assert 2.0 < ba < 2.5

    def test_180_degree_hem(self):
        """180-degree hem bend (hemmed edge)."""
        ba = self._bend_allowance(180, 0.5, 0.44, 1.0)
        assert ba > 0

    def test_aluminum_k_factor(self):
        """Different K-factor for aluminum."""
        ba_steel = self._bend_allowance(90, 2.0, 0.44, 2.0)
        ba_alu = self._bend_allowance(90, 2.0, 0.33, 2.0)
        assert ba_alu < ba_steel  # Aluminum has smaller K → smaller BA

    def test_zero_angle_gives_zero_ba(self):
        ba = self._bend_allowance(0, 2.0, 0.44, 2.0)
        assert ba == 0


class TestDimensionComputation:
    """Test linear dimension computation from bend positions."""

    def _compute_dimensions(self, bend_positions, flat_width):
        """Replicate the dimension computation from the worker."""
        dims = []
        if not bend_positions:
            return dims

        sorted_pos = sorted(bend_positions)

        # Edge to first bend
        if sorted_pos[0] > 0.01:
            dims.append({
                "label": "Edge -> B1",
                "value_mm": round(sorted_pos[0], 1),
                "type": "edge_to_bend",
            })

        # Bend to bend
        for i in range(1, len(sorted_pos)):
            dist = sorted_pos[i] - sorted_pos[i - 1]
            dims.append({
                "label": f"B{i} -> B{i + 1}",
                "value_mm": round(dist, 1),
                "type": "bend_to_bend",
            })

        # Last bend to edge
        last_dist = flat_width - sorted_pos[-1]
        if last_dist > 0.01:
            dims.append({
                "label": f"B{len(sorted_pos)} -> Edge",
                "value_mm": round(last_dist, 1),
                "type": "bend_to_edge",
            })

        return dims

    def test_single_bend(self):
        dims = self._compute_dimensions([45.0], 200.0)
        assert len(dims) == 2
        assert dims[0]["value_mm"] == 45.0
        assert dims[1]["value_mm"] == 155.0

    def test_two_bends(self):
        dims = self._compute_dimensions([45.0, 145.0], 342.5)
        assert len(dims) == 3
        assert dims[0]["value_mm"] == 45.0  # edge to B1
        assert dims[1]["value_mm"] == 100.0  # B1 to B2
        assert dims[2]["value_mm"] == 197.5  # B2 to edge

    def test_no_bends(self):
        dims = self._compute_dimensions([], 200.0)
        assert len(dims) == 0

    def test_dimensions_sum_to_width(self):
        positions = [30.0, 80.0, 150.0, 220.0]
        flat_width = 300.0
        dims = self._compute_dimensions(positions, flat_width)
        total = sum(d["value_mm"] for d in dims)
        assert abs(total - flat_width) < 0.1


class TestDXFExport:
    """Test DXF file export."""

    def test_dxf_export_creates_file(self):
        from dxf_export import export_flat_dxf_with_bend_lines

        outline = [
            {"start": [0, 0], "end": [100, 0]},
            {"start": [100, 0], "end": [100, 50]},
            {"start": [100, 50], "end": [0, 50]},
            {"start": [0, 50], "end": [0, 0]},
        ]
        bends = [
            {
                "index": 1,
                "angle_deg": 90.0,
                "inner_radius_mm": 2.0,
                "direction": "UP",
                "bend_line_on_flat": {
                    "start": [40, 0],
                    "end": [40, 50],
                },
            }
        ]

        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
            dxf_path = tmp.name

        try:
            export_flat_dxf_with_bend_lines(outline, bends, dxf_path, "TestPart")
            assert os.path.exists(dxf_path)
            assert os.path.getsize(dxf_path) > 0

            # Verify we can read it back
            import ezdxf
            doc = ezdxf.readfile(dxf_path)
            layers = [l.dxf.name for l in doc.layers]
            assert "OUTLINE" in layers
            assert "BEND_LINES" in layers

            # Count entities
            entities = list(doc.modelspace())
            assert len(entities) >= 5  # 4 outline + 1 bend line + annotation
        finally:
            os.unlink(dxf_path)

    def test_dxf_export_empty_bends(self):
        from dxf_export import export_flat_dxf_with_bend_lines

        outline = [
            {"start": [0, 0], "end": [100, 0]},
            {"start": [100, 0], "end": [100, 50]},
            {"start": [100, 50], "end": [0, 50]},
            {"start": [0, 50], "end": [0, 0]},
        ]

        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
            dxf_path = tmp.name

        try:
            export_flat_dxf_with_bend_lines(outline, [], dxf_path)
            assert os.path.exists(dxf_path)
        finally:
            os.unlink(dxf_path)


class TestPDFGeneration:
    """Smoke tests for PDF generation."""

    def test_pdf_generates(self):
        from pdf_generator import generate_shop_drawing_pdf

        unfold_data = {
            "success": True,
            "part_name": "Test-L-Bracket",
            "thickness_mm": 2.0,
            "material": "Steel",
            "bounding_box_3d": {"x": 100, "y": 50, "z": 80},
            "flat_pattern": {
                "width_mm": 200.0,
                "height_mm": 100.0,
                "outline_edges": [
                    {"start": [0, 0], "end": [200, 0]},
                    {"start": [200, 0], "end": [200, 100]},
                    {"start": [200, 100], "end": [0, 100]},
                    {"start": [0, 100], "end": [0, 0]},
                ],
            },
            "bends": [
                {
                    "index": 1,
                    "angle_deg": 90.0,
                    "inner_radius_mm": 2.0,
                    "direction": "UP",
                    "length_mm": 100.0,
                    "k_factor": 0.44,
                    "bend_allowance_mm": 4.52,
                    "bend_deduction_mm": 1.48,
                    "bend_line_on_flat": {
                        "start": [80, 0],
                        "end": [80, 100],
                    },
                    "distance_from_left_edge_mm": 80.0,
                },
            ],
            "linear_dimensions": [
                {"label": "Edge -> B1", "value_mm": 80.0, "type": "edge_to_bend"},
                {"label": "B1 -> Edge", "value_mm": 120.0, "type": "bend_to_edge"},
            ],
        }

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            pdf_path = tmp.name

        try:
            generate_shop_drawing_pdf(unfold_data, None, pdf_path)
            assert os.path.exists(pdf_path)
            assert os.path.getsize(pdf_path) > 1000  # Reasonable PDF size
        finally:
            os.unlink(pdf_path)

    def test_pdf_with_multiple_bends(self):
        from pdf_generator import generate_shop_drawing_pdf

        unfold_data = {
            "success": True,
            "part_name": "U-Channel",
            "thickness_mm": 1.5,
            "material": "Aluminum",
            "bounding_box_3d": {"x": 150, "y": 80, "z": 60},
            "flat_pattern": {
                "width_mm": 300.0,
                "height_mm": 80.0,
                "outline_edges": [],
            },
            "bends": [
                {
                    "index": i + 1,
                    "angle_deg": 90.0,
                    "inner_radius_mm": 1.5,
                    "direction": "UP" if i % 2 == 0 else "DOWN",
                    "length_mm": 80.0,
                    "k_factor": 0.33,
                    "bend_allowance_mm": 3.2,
                    "bend_deduction_mm": 1.1,
                    "bend_line_on_flat": {
                        "start": [75 + 75 * i, 0],
                        "end": [75 + 75 * i, 80],
                    },
                    "distance_from_left_edge_mm": 75 + 75.0 * i,
                }
                for i in range(3)
            ],
            "linear_dimensions": [],
        }

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            pdf_path = tmp.name

        try:
            generate_shop_drawing_pdf(unfold_data, None, pdf_path)
            assert os.path.exists(pdf_path)
            assert os.path.getsize(pdf_path) > 1000
        finally:
            os.unlink(pdf_path)


class TestConfig:
    """Test configuration values."""

    def test_thickness_bounds(self):
        assert MIN_THICKNESS_MM > 0
        assert MAX_THICKNESS_MM > MIN_THICKNESS_MM

    def test_k_factors_present(self):
        assert "Steel" in K_FACTORS
        assert "Aluminum" in K_FACTORS
        assert all(0 < v < 1 for v in K_FACTORS.values())

    def test_default_k_factor(self):
        assert 0 < DEFAULT_K_FACTOR < 1

    def test_file_size_limit(self):
        assert MAX_FILE_SIZE > 0
        assert MAX_FILE_SIZE == 50 * 1024 * 1024


@pytest.mark.freecad
class TestFreeCADIntegration:
    """Integration tests requiring FreeCAD. Skipped without FreeCAD."""

    @pytest.fixture(autouse=True)
    def check_freecad(self):
        try:
            import subprocess
            result = subprocess.run(
                ["freecadcmd", "--version"],
                capture_output=True, timeout=10
            )
            if result.returncode != 0:
                pytest.skip("FreeCAD not available")
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pytest.skip("FreeCAD not available")

    def test_health_check(self):
        import subprocess
        result = subprocess.run(
            ["freecadcmd", "--version"],
            capture_output=True, text=True, timeout=10
        )
        assert result.returncode == 0
