"""Pure pricing + lead-time math (§6A). No I/O — exhaustively unit-tested.

suggested = max(buyer_price * (1 - DISCOUNT), your_cost * (1 + MIN_MARGIN))
lead time = max(Xometry's required date, today + 10 business days)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from . import config


def add_business_days(
    start: date, n: int, holidays: frozenset[date] = frozenset()
) -> date:
    """`n` business days after `start`, skipping Sat/Sun and `holidays`."""
    if n < 0:
        raise ValueError("n must be >= 0")
    d = start
    remaining = n
    while remaining > 0:
        d += timedelta(days=1)
        if d.weekday() < 5 and d not in holidays:
            remaining -= 1
    return d


def suggested_price(
    buyer_price: float,
    your_cost: float,
    *,
    discount: float = config.DISCOUNT,
    min_margin: float = config.MIN_MARGIN,
) -> float:
    return round(max(buyer_price * (1 - discount), your_cost * (1 + min_margin)), 2)


def suggested_leadtime(
    xo_leadtime: date | None,
    *,
    today: date,
    business_days: int = config.LEADTIME_BUSINESS_DAYS,
    holidays: frozenset[date] = frozenset(),
) -> date:
    """Always >= today + N business days, even if Xometry asked for sooner (§6A)."""
    floor = add_business_days(today, business_days, holidays)
    return max(xo_leadtime, floor) if xo_leadtime is not None else floor


def estimate_cost(row: dict[str, Any]) -> float | None:
    """Microns Hub quote-engine hook (§8.2).

    v1: no engine wired — return None so compute() falls back to partner_cost
    (i.e. the floor is ~never below Xometry's own offer).
    """
    return None


@dataclass
class ComputeResult:
    suggested_price: float | None
    suggested_leadtime: date
    status: str  # 'ready' | 'needs_review'
    flags: list[str] = field(default_factory=list)


def compute(
    *,
    buyer_price: float | None,
    partner_cost: float | None,
    your_cost: float | None,
    xo_leadtime: date | None,
    today: date,
    holidays: frozenset[date] = frozenset(),
) -> ComputeResult:
    """§6A compute + §7 plausibility checks. Never returns a guessed number:
    anything implausible lands in needs_review with an explanatory flag."""
    lead = suggested_leadtime(xo_leadtime, today=today, holidays=holidays)
    flags: list[str] = []
    cost = your_cost if your_cost is not None else partner_cost

    if buyer_price is None or buyer_price <= 0 or cost is None:
        if buyer_price is not None and buyer_price <= 0:
            flags.append("price_implausible:buyer_price<=0")
        if buyer_price is not None and buyer_price > 0 and cost is None:
            flags.append("no_cost_floor")
        return ComputeResult(None, lead, "needs_review", flags)

    if partner_cost is not None and partner_cost > 0:
        ratio = buyer_price / partner_cost
        lo, hi = config.PLAUSIBLE_BUYER_TO_PARTNER_RATIO
        if not (lo <= ratio <= hi):
            flags.append(f"price_implausible:buyer/partner_ratio={ratio:.2f}")

    price = suggested_price(buyer_price, cost)
    status = "ready" if price <= buyer_price and not flags else "needs_review"
    return ComputeResult(price, lead, status, flags)


def submit_guard(
    *,
    final_price: float,
    final_leadtime: date,
    allow_counter_from: float | None,
    your_cost: float | None,
    today: date,
    min_margin: float = config.MIN_MARGIN,
    business_days: int = config.LEADTIME_BUSINESS_DAYS,
    holidays: frozenset[date] = frozenset(),
) -> list[str]:
    """§6C guard: reasons why a submit must be refused. Empty list = OK to send."""
    reasons: list[str] = []
    if allow_counter_from is not None and final_price < allow_counter_from:
        reasons.append(
            f"price {final_price:.2f} is below Xometry's counteroffer floor "
            f"{allow_counter_from:.2f} (allowCounterofferFrom)"
        )
    if your_cost is not None and final_price < your_cost * (1 + min_margin):
        reasons.append(
            f"price {final_price:.2f} is below cost floor "
            f"{your_cost * (1 + min_margin):.2f} (cost {your_cost:.2f} + {min_margin:.0%})"
        )
    floor = add_business_days(today, business_days, holidays)
    if final_leadtime < floor:
        reasons.append(
            f"lead time {final_leadtime.isoformat()} is earlier than {floor.isoformat()} "
            f"(today + {business_days} business days)"
        )
    return reasons
