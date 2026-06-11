"""Pipeline orchestration: preset filter, exclusion rows, dedupe, terminal statuses,
pricing + compute passes — all against fakes mirroring the real adapters."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from tests import fixtures as fx
from tests.fakes import FakeClient, FakePricer, FakeStore
from xometry_bot import config
from xometry_bot.buyer_pricer import BuyerQuote, NeedsConfirmation, PricingError
from xometry_bot.pipeline import run_compute_pass, run_pricing_pass, run_scan

TODAY = date(2026, 6, 11)


def make_settings(tmp_path: Path, **over: object) -> config.Settings:
    defaults: dict[str, object] = {
        "db_dsn": "postgresql://unused",
        "partner_auth_token": "tok",
        "partner_cookie": None,
        "review_api_token": "secret",
        "data_dir": tmp_path,
        "buyer_profile_dir": tmp_path / "buyer",
        "partner_profile_dir": tmp_path / "partner",
        "enable_buyer_pricing": False,
        "buyer_selectors_confirmed": False,
        "headless": True,
        "borderline_exclude": frozenset[str](),
    }
    defaults.update(over)
    return config.Settings(**defaults)  # type: ignore[arg-type]


class TestRunScan:
    def test_keeps_milonk_drops_laser_stores_excluded(self, tmp_path: Path) -> None:
        store = FakeStore()
        client = FakeClient(
            [
                fx.make_offer("HJO-CNC"),  # milling, step file → kept
                fx.make_offer(
                    "HJO-LASER", parts=[fx.make_part(tags=[fx.LASER_TAG])]
                ),  # laser only → not stored at all
                fx.make_offer(
                    "HJO-COATED",
                    parts=[fx.make_part(tags=[fx.MILLING_TAG, fx.ANODIZING_TAG])],
                ),  # finishing op → stored as excluded (§1C: store, don't delete)
            ]
        )
        stats = run_scan(store, client, make_settings(tmp_path))  # type: ignore[arg-type]

        assert stats.scanned == 3
        assert stats.preset_rejected == 1
        assert stats.excluded_secondary == 1
        assert set(store.rows) == {"HJO-CNC", "HJO-COATED"}

        kept = store.rows["HJO-CNC"]
        assert kept["status"] == "new"
        assert kept["partner_cost"] == 100.0
        assert kept["tolerance"] == "ISO 2768: medium (mK)"
        assert kept["roughness"] == "Ra: 3.2 (Standard)"
        assert kept["local_files"]  # downloaded
        assert kept["raw"]["code"] == "HJO-CNC"

        excluded = store.rows["HJO-COATED"]
        assert excluded["status"] == "excluded_secondary_ops"
        assert excluded["excluded_reason"] == "Anodizing type II"
        assert client.downloads == ["HJO-CNC"]  # excluded rows skip downstream work

    def test_pdf_only_goes_needs_manual(self, tmp_path: Path) -> None:
        store = FakeStore()
        client = FakeClient(
            [fx.make_offer("HJO-PDF", parts=[fx.make_part(files=[fx.PDF_FILE])])]
        )
        run_scan(store, client, make_settings(tmp_path))  # type: ignore[arg-type]
        row = store.rows["HJO-PDF"]
        assert row["status"] == "needs_manual"
        assert "files:manual" in row["flags"]

    def test_rescan_is_idempotent_and_refreshes(self, tmp_path: Path) -> None:
        store = FakeStore()
        settings = make_settings(tmp_path)
        run_scan(store, FakeClient([fx.make_offer("HJO-1")]), settings)  # type: ignore[arg-type]
        assert store.rows["HJO-1"]["partner_cost"] == 100.0

        # Re-scan with a new partner price: same row, refreshed cost, status preserved.
        store.rows["HJO-1"]["status"] = "priced"
        updated = fx.make_offer("HJO-1", cost={"amount": 110.0, "currency": "EUR"})
        run_scan(store, FakeClient([updated]), settings)  # type: ignore[arg-type]
        assert len(store.rows) == 1
        assert store.rows["HJO-1"]["partner_cost"] == 110.0
        assert store.rows["HJO-1"]["status"] == "priced"

    def test_terminal_rows_never_touched(self, tmp_path: Path) -> None:
        store = FakeStore()
        settings = make_settings(tmp_path)
        run_scan(store, FakeClient([fx.make_offer("HJO-1")]), settings)  # type: ignore[arg-type]
        store.rows["HJO-1"]["status"] = "submitted"

        updated = fx.make_offer("HJO-1", cost={"amount": 999.0, "currency": "EUR"})
        run_scan(store, FakeClient([updated]), settings)  # type: ignore[arg-type]
        assert store.rows["HJO-1"]["status"] == "submitted"
        assert store.rows["HJO-1"]["partner_cost"] == 100.0  # not refreshed

    def test_borderline_exclude_flips(self, tmp_path: Path) -> None:
        store = FakeStore()
        client = FakeClient(
            [fx.make_offer("HJO-G", parts=[fx.make_part(tags=[fx.MILLING_TAG, fx.GRINDING_TAG])])]
        )
        settings = make_settings(tmp_path, borderline_exclude=frozenset({"grinding"}))
        run_scan(store, client, settings)  # type: ignore[arg-type]
        assert store.rows["HJO-G"]["status"] == "excluded_secondary_ops"
        assert store.rows["HJO-G"]["excluded_reason"] == "Grinding flat"

    def test_one_bad_offer_does_not_kill_run(self, tmp_path: Path) -> None:
        store = FakeStore()
        bad = fx.make_offer("HJO-BAD")
        client = FakeClient([bad, fx.make_offer("HJO-OK")])

        original = client.download_files

        def explode(offer: object, dest: object) -> list[str]:
            if getattr(offer, "code", "") == "HJO-BAD":
                raise RuntimeError("disk full")
            return original(offer, dest)  # type: ignore[arg-type]

        client.download_files = explode  # type: ignore[assignment]
        stats = run_scan(store, client, make_settings(tmp_path))  # type: ignore[arg-type]
        assert "HJO-OK" in store.rows
        assert store.rows["HJO-OK"]["local_files"]
        # bad offer kept, flagged, not fatal
        assert "download_failed" in store.rows["HJO-BAD"]["flags"]
        assert stats.errors == []


class TestPricingPass:
    def seed_new_row(self, store: FakeStore, tmp_path: Path) -> None:
        run_scan(store, FakeClient([fx.make_offer("HJO-1")]), make_settings(tmp_path))  # type: ignore[arg-type]

    def test_not_confirmed_skips_quietly(self, tmp_path: Path) -> None:
        store = FakeStore()
        self.seed_new_row(store, tmp_path)
        pricer = FakePricer(NeedsConfirmation("not confirmed"))
        assert run_pricing_pass(store, pricer, make_settings(tmp_path)) == 0  # type: ignore[arg-type]
        assert store.rows["HJO-1"]["status"] == "new"

    def test_prices_row(self, tmp_path: Path) -> None:
        store = FakeStore()
        self.seed_new_row(store, tmp_path)
        pricer = FakePricer(BuyerQuote(buyer_price=320.5, quote_id="E-123", threads_locations=4))
        assert run_pricing_pass(store, pricer, make_settings(tmp_path)) == 1  # type: ignore[arg-type]
        row = store.rows["HJO-1"]
        assert row["status"] == "priced"
        assert row["buyer_price"] == 320.5
        assert row["buyer_quote_id"] == "E-123"
        assert row["threads_present"] is True

    def test_config_mismatch_goes_needs_review(self, tmp_path: Path) -> None:
        store = FakeStore()
        self.seed_new_row(store, tmp_path)
        quote = BuyerQuote(320.5, "E-123", 0, flags=["config_mismatch:material"])
        run_pricing_pass(store, FakePricer(quote), make_settings(tmp_path))  # type: ignore[arg-type]
        row = store.rows["HJO-1"]
        assert row["status"] == "needs_review"
        assert row["threads_present"] is False

    def test_pricing_error_sets_status(self, tmp_path: Path) -> None:
        store = FakeStore()
        self.seed_new_row(store, tmp_path)
        err = PricingError("analysis failed", status="needs_manual", screenshot="/s/x.png")
        run_pricing_pass(store, FakePricer(err), make_settings(tmp_path))  # type: ignore[arg-type]
        row = store.rows["HJO-1"]
        assert row["status"] == "needs_manual"
        assert any(f.startswith("pricing:") for f in row["flags"])
        assert "screenshot:/s/x.png" in row["flags"]


class TestComputePass:
    def test_priced_becomes_ready(self, tmp_path: Path) -> None:
        store = FakeStore()
        run_scan(store, FakeClient([fx.make_offer("HJO-1")]), make_settings(tmp_path))  # type: ignore[arg-type]
        store.update_fields("HJO-1", status="priced", buyer_price=1000.0)

        assert run_compute_pass(store, today=TODAY) == 1
        row = store.rows["HJO-1"]
        # partner_cost=100 → ratio 10 → implausible flag → needs_review (§7 fail loud)
        assert row["status"] == "needs_review"
        assert row["suggested_price"] == 800.0
        assert row["suggested_leadtime"] == date(2026, 6, 25)

    def test_plausible_ratio_ready(self, tmp_path: Path) -> None:
        store = FakeStore()
        offer = fx.make_offer("HJO-2", cost={"amount": 700.0, "currency": "EUR"})
        run_scan(store, FakeClient([offer]), make_settings(tmp_path))  # type: ignore[arg-type]
        store.update_fields("HJO-2", status="priced", buyer_price=1000.0)

        run_compute_pass(store, today=TODAY)
        row = store.rows["HJO-2"]
        assert row["status"] == "ready"
        assert row["suggested_price"] == 805.0  # max(1000*0.80, 700*1.15) — cost floor wins
