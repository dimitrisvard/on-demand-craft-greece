"""In-memory fakes mirroring the exact semantics of the real adapters."""

from __future__ import annotations

import copy
import datetime as dt
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

from xometry_bot.buyer_pricer import BuyerQuote
from xometry_bot.db import _REFRESH_COLS, ALLOWED_UPDATE_COLS, TERMINAL_STATUSES
from xometry_bot.models import JobOffer, OfferRow


class FakeStore:
    """Mirrors PostgresStore's upsert/refresh/terminal contract in memory."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    def upsert_offer(self, row: OfferRow) -> str:
        data = row.model_dump()
        existing = self.rows.get(row.code)
        if existing is None:
            self.rows[row.code] = copy.deepcopy(data)
            return str(data["status"])
        if existing["status"] in TERMINAL_STATUSES:
            return str(existing["status"])
        for col in _REFRESH_COLS:
            existing[col] = copy.deepcopy(data[col])
        return str(existing["status"])

    def get(self, code: str) -> dict[str, Any] | None:
        row = self.rows.get(code)
        return copy.deepcopy(row) if row else None

    def list_by_status(self, statuses: Sequence[str]) -> list[dict[str, Any]]:
        rows = [r for r in self.rows.values() if r["status"] in statuses]
        far_future = dt.datetime(9999, 1, 1, tzinfo=dt.UTC)
        rows.sort(key=lambda r: (r.get("publication_end") or far_future, r["code"]))
        return copy.deepcopy(rows)

    def update_fields(self, code: str, **fields: Any) -> None:
        bad = set(fields) - ALLOWED_UPDATE_COLS
        if bad:
            raise ValueError(f"refusing to update non-whitelisted columns: {sorted(bad)}")
        self.rows[code].update(copy.deepcopy(fields))

    def transition(
        self, code: str, *, from_statuses: Sequence[str], to_status: str
    ) -> dict[str, Any] | None:
        row = self.rows.get(code)
        if row is None or row["status"] not in from_statuses:
            return None
        row["status"] = to_status
        return copy.deepcopy(row)


class FakeSubmitter:
    def __init__(self, *, fail: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail = fail

    def submit(
        self, *, offer_id: str, code: str, price: float, leadtime: dt.date, comment: str = ""
    ) -> str:
        if self.fail is not None:
            raise self.fail
        self.calls.append(
            {
                "offer_id": offer_id,
                "code": code,
                "price": price,
                "leadtime": leadtime,
                "comment": comment,
            }
        )
        return f"/screens/{code}.png"


class FakeClient:
    """Stands in for PartnerClient inside pipeline tests."""

    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self.payloads = payloads
        self.downloads: list[str] = []

    def scan(self, **_: Any) -> Iterator[JobOffer]:
        for payload in self.payloads:
            offer = JobOffer.model_validate(payload)
            offer.raw = payload
            yield offer

    def download_files(self, offer: JobOffer, dest_root: Path) -> list[str]:
        self.downloads.append(offer.code)
        return [
            str(dest_root / offer.code / f.name)
            for p in offer.parts
            for f in p.files
            if f.download_url
        ]


class FakePricer:
    def __init__(self, result: BuyerQuote | Exception) -> None:
        self.result = result
        self.calls: list[str] = []

    def price(self, *, label: str, **_: Any) -> BuyerQuote:
        self.calls.append(label)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result
