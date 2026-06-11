"""Tolerant parsing seams: money shapes, date formats, unknown fields (§1A TODOs)."""

from __future__ import annotations

from datetime import UTC, date, datetime

from tests import fixtures as fx
from xometry_bot.models import JobOffer, Money, ScanPage


class TestMoneySeam:
    def test_amount_currency(self) -> None:
        m = Money.model_validate({"amount": 123.45, "currency": "EUR"})
        assert (m.amount, m.currency) == (123.45, "EUR")

    def test_value_currency_code(self) -> None:
        # TODO(confirm) alternative shape — must normalise transparently.
        m = Money.model_validate({"value": 99.5, "currencyCode": "EUR"})
        assert (m.amount, m.currency) == (99.5, "EUR")

    def test_bare_number(self) -> None:
        assert Money.model_validate(75).amount == 75.0


class TestJobOffer:
    def test_full_payload(self) -> None:
        offer = JobOffer.model_validate(fx.make_offer())
        assert offer.code == "HJO-21991-684"
        assert offer.cost is not None and offer.cost.amount == 100.0
        assert offer.allow_counteroffer_from == 80.0
        assert offer.leadtime == date(2026, 6, 18)
        assert offer.publication_end == datetime(2026, 6, 14, 10, 0, tzinfo=UTC)
        assert offer.parts[0].process_type == "cnc_milling"
        assert offer.parts[0].tags[0].context == "production_methods"

    def test_allow_counteroffer_from_as_money_object(self) -> None:
        offer = JobOffer.model_validate(
            fx.make_offer(allowCounterofferFrom={"amount": 81.5, "currency": "EUR"})
        )
        assert offer.allow_counteroffer_from == 81.5

    def test_leadtime_iso_datetime(self) -> None:
        offer = JobOffer.model_validate(fx.make_offer(leadtime="2026-07-01T00:00:00Z"))
        assert offer.leadtime == date(2026, 7, 1)

    def test_leadtime_epoch_millis(self) -> None:
        millis = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000)
        offer = JobOffer.model_validate(fx.make_offer(leadtime=millis))
        assert offer.leadtime == date(2026, 7, 1)

    def test_publication_epoch_millis(self) -> None:
        millis = int(datetime(2026, 6, 14, 10, tzinfo=UTC).timestamp() * 1000)
        offer = JobOffer.model_validate(fx.make_offer(publicationEnd=millis))
        assert offer.publication_end == datetime(2026, 6, 14, 10, tzinfo=UTC)

    def test_unknown_fields_ignored(self) -> None:
        payload = fx.make_offer(unexpectedField={"x": 1})
        offer = JobOffer.model_validate(payload)
        assert offer.code == "HJO-21991-684"

    def test_null_finish_coerced_to_empty(self) -> None:
        payload = fx.make_offer(parts=[fx.make_part(finish=None)])
        assert JobOffer.model_validate(payload).parts[0].finish == ""

    def test_missing_optionals(self) -> None:
        minimal = {"id": 1, "code": "HJO-1", "parts": []}
        offer = JobOffer.model_validate(minimal)
        assert offer.cost is None
        assert offer.leadtime is None


class TestScanPage:
    def test_page_parses(self) -> None:
        page = ScanPage.model_validate(fx.gql_page([fx.make_offer()])["data"]["gshJobOffers"])
        assert page.metadata.has_more is False
        assert len(page.offers) == 1
