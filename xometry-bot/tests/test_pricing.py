"""§6A math — including the prompt's own worked example (11 Jun → 25 Jun 2026)."""

from __future__ import annotations

from datetime import date

import pytest

from xometry_bot.pricing import (
    add_business_days,
    compute,
    submit_guard,
    suggested_leadtime,
    suggested_price,
)

TODAY = date(2026, 6, 11)  # Thursday — the capture date used throughout the spec


class TestAddBusinessDays:
    def test_golden_case_from_spec(self) -> None:
        # "Today 11 Jun 2026 → 25 Jun 2026" (§6A)
        assert add_business_days(TODAY, 10) == date(2026, 6, 25)

    def test_skips_weekend(self) -> None:
        friday = date(2026, 6, 12)
        assert add_business_days(friday, 1) == date(2026, 6, 15)  # Monday

    def test_skips_holidays(self) -> None:
        friday = date(2026, 6, 12)
        monday = date(2026, 6, 15)
        assert add_business_days(friday, 1, frozenset({monday})) == date(2026, 6, 16)

    def test_zero_days(self) -> None:
        assert add_business_days(TODAY, 0) == TODAY

    def test_negative_raises(self) -> None:
        with pytest.raises(ValueError):
            add_business_days(TODAY, -1)


class TestSuggestedPrice:
    def test_buyer_discount_wins(self) -> None:
        # max(1000*0.80, 100*1.15) = 800
        assert suggested_price(1000.0, 100.0) == 800.0

    def test_cost_floor_wins(self) -> None:
        # max(1000*0.80, 900*1.15) = 1035
        assert suggested_price(1000.0, 900.0) == 1035.0

    def test_rounding(self) -> None:
        assert suggested_price(333.33, 1.0) == 266.66


class TestSuggestedLeadtime:
    def test_xometry_date_later_than_floor(self) -> None:
        xo = date(2026, 7, 20)
        assert suggested_leadtime(xo, today=TODAY) == xo

    def test_floor_wins_when_xometry_asks_sooner(self) -> None:
        # Xometry asked for 18 Jun; we never go below today+10bd (§6A).
        assert suggested_leadtime(date(2026, 6, 18), today=TODAY) == date(2026, 6, 25)

    def test_no_xometry_date(self) -> None:
        assert suggested_leadtime(None, today=TODAY) == date(2026, 6, 25)


class TestCompute:
    def test_ready(self) -> None:
        res = compute(
            buyer_price=1000.0, partner_cost=700.0, your_cost=None,
            xo_leadtime=date(2026, 6, 18), today=TODAY,
        )
        assert res.status == "ready"
        assert res.suggested_price == 805.0  # max(1000*0.80, 700*1.15) — cost floor wins
        assert res.suggested_leadtime == date(2026, 6, 25)
        assert res.flags == []

    def test_your_cost_overrides_partner_cost(self) -> None:
        res = compute(
            buyer_price=1000.0, partner_cost=700.0, your_cost=900.0,
            xo_leadtime=None, today=TODAY,
        )
        assert res.suggested_price == 1035.0  # floor 900*1.15 beats 800
        assert res.status == "needs_review"  # suggested > buyer_price

    def test_floor_above_buyer_needs_review(self) -> None:
        res = compute(
            buyer_price=100.0, partner_cost=95.0, your_cost=None,
            xo_leadtime=None, today=TODAY,
        )
        assert res.suggested_price == pytest.approx(109.25)
        assert res.status == "needs_review"

    def test_no_buyer_price(self) -> None:
        res = compute(
            buyer_price=None, partner_cost=100.0, your_cost=None,
            xo_leadtime=None, today=TODAY,
        )
        assert res.status == "needs_review"
        assert res.suggested_price is None

    def test_zero_buyer_price_flagged(self) -> None:
        res = compute(
            buyer_price=0.0, partner_cost=100.0, your_cost=None,
            xo_leadtime=None, today=TODAY,
        )
        assert res.status == "needs_review"
        assert "price_implausible:buyer_price<=0" in res.flags

    def test_implausible_ratio_flagged(self) -> None:
        # buyer 10x partner cost — wildly off (§7), price computed but parked for review
        res = compute(
            buyer_price=1000.0, partner_cost=100.0, your_cost=None,
            xo_leadtime=None, today=TODAY,
        )
        assert res.status == "needs_review"
        assert any(f.startswith("price_implausible:buyer/partner_ratio") for f in res.flags)

    def test_no_cost_floor_flagged(self) -> None:
        res = compute(
            buyer_price=500.0, partner_cost=None, your_cost=None,
            xo_leadtime=None, today=TODAY,
        )
        assert res.status == "needs_review"
        assert "no_cost_floor" in res.flags


class TestSubmitGuard:
    def test_all_clear(self) -> None:
        assert (
            submit_guard(
                final_price=800.0, final_leadtime=date(2026, 6, 25),
                allow_counter_from=500.0, your_cost=600.0, today=TODAY,
            )
            == []
        )

    def test_below_xometry_floor(self) -> None:
        reasons = submit_guard(
            final_price=400.0, final_leadtime=date(2026, 6, 25),
            allow_counter_from=500.0, your_cost=None, today=TODAY,
        )
        assert len(reasons) == 1
        assert "counteroffer floor" in reasons[0]

    def test_below_cost_floor(self) -> None:
        reasons = submit_guard(
            final_price=600.0, final_leadtime=date(2026, 6, 25),
            allow_counter_from=None, your_cost=600.0, today=TODAY,
        )
        assert len(reasons) == 1
        assert "cost floor" in reasons[0]

    def test_leadtime_too_early(self) -> None:
        reasons = submit_guard(
            final_price=800.0, final_leadtime=date(2026, 6, 24),
            allow_counter_from=None, your_cost=None, today=TODAY,
        )
        assert len(reasons) == 1
        assert "business days" in reasons[0]
