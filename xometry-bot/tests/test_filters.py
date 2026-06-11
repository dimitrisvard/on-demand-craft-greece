"""Preset matching, §1C exclusion regex behaviour, and spec extraction."""

from __future__ import annotations

import pytest

from tests import fixtures as fx
from xometry_bot import config
from xometry_bot.filters import (
    extract_spec,
    file_kind,
    find_secondary_op,
    matches_any_active_preset,
    matches_preset,
    pick_quote_file,
)
from xometry_bot.models import JobOffer


def offer_with_tags(*tags: dict[str, object], finish: str = "") -> JobOffer:
    payload = fx.make_offer(parts=[fx.make_part(tags=list(tags), finish=finish)])
    return JobOffer.model_validate(payload)


class TestPresets:
    def test_milonk_keeps_milling(self) -> None:
        offer = offer_with_tags(fx.MILLING_TAG)
        assert matches_any_active_preset(offer)

    def test_laser_only_offer_rejected(self) -> None:
        offer = offer_with_tags(fx.LASER_TAG)
        assert not matches_any_active_preset(offer)

    def test_exclude_list_wins(self) -> None:
        preset = config.Preset("custom", include=frozenset({14}), exclude=frozenset({36}))
        both = offer_with_tags(fx.MILLING_TAG, fx.LASER_TAG)
        assert not matches_preset(both, preset)

    def test_active_presets_is_milonk_only(self) -> None:
        # §8.1: "milonk" only; the Laser preset stays documented but OFF.
        assert config.ACTIVE_PRESETS == ("milonk",)


class TestSecondaryOpExclusion:
    @pytest.mark.parametrize(
        "name",
        [
            "Anodizing type II",
            "Powder coating",
            "Nickel coating",
            "Glass Bead Blasting",
            "Passivating",
            "Chrome plating",
            "Wet Painting",
            "Tumbling",
            "Electropolish",
            "Phosphating",
        ],
    )
    def test_finishing_tags_exclude(self, name: str) -> None:
        tag = {"id": 999, "name": name, "context": "production_method_features"}
        hit = find_secondary_op(offer_with_tags(tag))
        assert hit is not None
        assert hit.op_name == name
        assert hit.source == "tag"

    def test_coating_finish_field_excludes(self) -> None:
        offer = offer_with_tags(fx.MILLING_TAG, finish="Anodizing black matt")
        hit = find_secondary_op(offer)
        assert hit is not None
        assert hit.source == "finish"

    def test_empty_finish_keeps(self) -> None:
        assert find_secondary_op(offer_with_tags(fx.MILLING_TAG)) is None

    def test_finishing_context_required_for_tags(self) -> None:
        # Same word in another context group must not exclude (names in
        # production_method_features are the §1C source of truth).
        risk = {"id": 999, "name": "Chrome plating", "context": "production_risks"}
        assert find_secondary_op(offer_with_tags(risk)) is None

    @pytest.mark.parametrize("name", ["Grinding flat", "Heat treatment", "Case Harden", "Marking"])
    def test_borderline_kept_by_default(self, name: str) -> None:
        tag = {"id": 184, "name": name, "context": "production_method_features"}
        assert find_secondary_op(offer_with_tags(tag)) is None

    def test_borderline_flip_to_exclude(self) -> None:
        offer = offer_with_tags(fx.GRINDING_TAG)
        hit = find_secondary_op(offer, borderline_exclude=frozenset({"grinding"}))
        assert hit is not None
        assert hit.op_name == "Grinding flat"

    def test_secondary_beats_borderline_on_other_parts(self) -> None:
        payload = fx.make_offer(
            parts=[
                fx.make_part(tags=[fx.GRINDING_TAG]),
                fx.make_part(tags=[fx.ANODIZING_TAG]),
            ]
        )
        hit = find_secondary_op(JobOffer.model_validate(payload))
        assert hit is not None
        assert hit.op_name == "Anodizing type II"


class TestExtractSpec:
    def test_full_spec(self) -> None:
        payload = fx.make_offer(
            parts=[
                fx.make_part(
                    tags=[fx.MILLING_TAG, fx.TOLERANCE_TAG, fx.RA_TAG, fx.THREAD_RISK_TAG],
                    measurementProtocolNeeded=True,
                    samplesNeeded=True,
                )
            ]
        )
        spec = extract_spec(JobOffer.model_validate(payload))
        assert spec.tolerance == "ISO 2768: medium (mK)"
        assert spec.roughness == "Ra: 3.2 (Standard)"
        assert spec.inspection_needed is True
        assert "samples_needed" in spec.flags
        assert "threads_flagged_partner" in spec.flags
        assert "risk:Threads at risk" in spec.flags

    def test_borderline_flagged_not_excluded(self) -> None:
        spec = extract_spec(offer_with_tags(fx.GRINDING_TAG, fx.HEAT_TAG))
        assert "borderline:Grinding flat" in spec.flags
        assert "borderline:Heat treatment" in spec.flags

    def test_multi_part_flag(self) -> None:
        payload = fx.make_offer(parts=[fx.make_part(), fx.make_part(code="P-2")])
        spec = extract_spec(JobOffer.model_validate(payload))
        assert "multi_part" in spec.flags

    def test_unmapped_finish_flag(self) -> None:
        # Non-empty finish that did not trip the exclusion regex → never trust the price.
        spec = extract_spec(offer_with_tags(fx.MILLING_TAG, finish="Brushed"))
        assert spec.finish == "Brushed"
        assert "finish_unmapped:Brushed" in spec.flags

    def test_tolerance_variants(self) -> None:
        for name in ["Tolerance: ± 0.500 mm", "ISO 2768: coarse", "Tol.grade: 5 / ISO 286-1"]:
            tag = {"id": 1, "name": name, "context": "production_method_features"}
            assert extract_spec(offer_with_tags(tag)).tolerance == name


class TestFileKind:
    def test_step_is_instant(self) -> None:
        assert file_kind(["bracket.step"]) == "instant"
        assert file_kind(["BRACKET.STP", "drawing.pdf"]) == "instant"

    def test_pdf_only_is_manual(self) -> None:
        assert file_kind(["drawing.pdf"]) == "manual"
        assert file_kind(["model.dwg", "spec.pdf"]) == "manual"

    def test_dxf_only_flagged_separately(self) -> None:
        # DXF = flat-cut only (§1B) — not instant-quotable for the CNC preset.
        assert file_kind(["plate.dxf"]) == "dxf_only"

    def test_no_files(self) -> None:
        assert file_kind([]) == "none"

    def test_pick_prefers_step(self) -> None:
        files = ["/d/a.stl", "/d/b.step", "/d/c.pdf"]
        assert pick_quote_file(files) == "/d/b.step"
        assert pick_quote_file(["/d/a.stl"]) == "/d/a.stl"
        assert pick_quote_file(["/d/c.pdf", "/d/p.dxf"]) is None
