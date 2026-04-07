"""
Tests for bend detection and K-factor calculations.
"""

import math
import pytest


class TestKFactorTable:
    """Verify the K-factor lookup table."""

    def test_mild_steel_thin(self):
        from core.kfactor import get_k_factor
        assert get_k_factor("mild_steel", 1.0) == 0.33

    def test_mild_steel_medium(self):
        from core.kfactor import get_k_factor
        assert get_k_factor("mild_steel", 2.5) == 0.38

    def test_mild_steel_thick(self):
        from core.kfactor import get_k_factor
        assert get_k_factor("mild_steel", 6.0) == 0.40

    def test_aluminum(self):
        from core.kfactor import get_k_factor
        assert get_k_factor("aluminum", 1.5) == 0.33

    def test_unknown_material(self):
        from core.kfactor import get_k_factor
        # Should fall back to steel default
        kf = get_k_factor("titanium", 1.0)
        assert kf == 0.44


class TestBendAllowance:
    """Validate bend allowance formula against hand calculations."""

    def test_90deg_r2_t2_k033(self):
        from core.kfactor import compute_bend
        bc = compute_bend(90, 2.0, 2.0, 0.33)
        # BA = π/2 × (2 + 0.33×2) = π/2 × 2.66 ≈ 4.178
        assert abs(bc.bend_allowance - 4.178) < 0.01

    def test_90deg_r1_t1_k044(self):
        from core.kfactor import compute_bend
        bc = compute_bend(90, 1.0, 1.0, 0.44)
        # BA = π/2 × (1 + 0.44×1) = π/2 × 1.44 ≈ 2.262
        expected = (math.pi / 2) * 1.44
        assert abs(bc.bend_allowance - expected) < 0.01

    def test_45deg_bend(self):
        from core.kfactor import compute_bend
        bc = compute_bend(45, 3.0, 1.5, 0.33)
        expected = (math.pi / 180) * 45 * (3.0 + 0.33 * 1.5)
        assert abs(bc.bend_allowance - expected) < 0.01

    def test_180deg_hem(self):
        from core.kfactor import compute_bend
        bc = compute_bend(180, 0.1, 1.0, 0.33)
        # BA ≈ π × (0.1 + 0.33) = π × 0.43 ≈ 1.351
        expected = math.pi * (0.1 + 0.33 * 1.0)
        assert abs(bc.bend_allowance - expected) < 0.01

    def test_bend_deduction_positive(self):
        from core.kfactor import compute_bend
        bc = compute_bend(90, 2.0, 2.0, 0.33)
        assert bc.bend_deduction > 0

    def test_ossb_formula(self):
        from core.kfactor import compute_bend
        bc = compute_bend(90, 2.0, 2.0, 0.33)
        # OSSB = (R+T) × tan(A/2) = 4 × tan(45°) = 4.0
        assert abs(bc.ossb - 4.0) < 0.01


class TestFlatLength:
    def test_simple_l_bracket(self):
        from core.kfactor import compute_flat_length, compute_bend
        # L-bracket: 50mm + 30mm outer dimensions, one 90° bend
        bc = compute_bend(90, 2.0, 2.0, 0.33)
        flat = compute_flat_length([50.0, 30.0], [bc.bend_deduction])
        # Expected: 50 + 30 - BD
        expected = 80.0 - bc.bend_deduction
        assert abs(flat - expected) < 0.01

    def test_u_channel(self):
        from core.kfactor import compute_flat_length, compute_bend
        # U-channel: 25mm + 60mm + 25mm, two 90° bends
        bc = compute_bend(90, 2.0, 2.0, 0.33)
        flat = compute_flat_length([25.0, 60.0, 25.0], [bc.bend_deduction, bc.bend_deduction])
        expected = 110.0 - 2 * bc.bend_deduction
        assert abs(flat - expected) < 0.01
