"""The only side-effecting surface (§6C): auth, guards, idempotency, audit trail."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeStore, FakeSubmitter
from xometry_bot.partner_form import SubmitError
from xometry_bot.pricing import add_business_days
from xometry_bot.review_api import create_app

TODAY = date(2026, 6, 11)
GOOD_LEAD = add_business_days(TODAY, 10)  # 2026-06-25
TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def seed_row(store: FakeStore, code: str = "HJO-1", **over: Any) -> None:
    row: dict[str, Any] = {
        "code": code,
        "offer_id": "684001",
        "is_urgent": False,
        "status": "ready",
        "partner_cost": 600.0,
        "allow_counter_from": 500.0,
        "buyer_price": 1000.0,
        "suggested_price": 800.0,
        "suggested_leadtime": GOOD_LEAD,
        "publication_end": datetime(2026, 6, 14, 10, tzinfo=UTC),
        "flags": [],
        "raw": {"secret": "full offer dump"},
    }
    row.update(over)
    store.rows[code] = row


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def submitter() -> FakeSubmitter:
    return FakeSubmitter()


@pytest.fixture
def client(store: FakeStore, submitter: FakeSubmitter) -> TestClient:
    app = create_app(store, submitter, api_token=TOKEN, today_fn=lambda: TODAY)
    return TestClient(app)


class TestAuth:
    def test_health_is_open(self, client: TestClient) -> None:
        assert client.get("/health").status_code == 200

    def test_pending_requires_token(self, client: TestClient) -> None:
        assert client.get("/pending").status_code == 401
        assert client.get("/pending", headers={"Authorization": "Bearer wrong"}).status_code == 401

    def test_submit_requires_token(self, client: TestClient, store: FakeStore) -> None:
        seed_row(store)
        assert client.post("/submit/HJO-1", json={}).status_code == 401

    def test_empty_token_refused_at_startup(self, store: FakeStore) -> None:
        with pytest.raises(ValueError):
            create_app(store, FakeSubmitter(), api_token="")


class TestPending:
    def test_sorted_by_expiry_and_raw_omitted(self, client: TestClient, store: FakeStore) -> None:
        seed_row(store, "HJO-LATER", publication_end=datetime(2026, 6, 16, tzinfo=UTC))
        seed_row(store, "HJO-SOON", publication_end=datetime(2026, 6, 12, tzinfo=UTC))
        rows = client.get("/pending", headers=AUTH).json()
        assert [r["code"] for r in rows] == ["HJO-SOON", "HJO-LATER"]
        assert all("raw" not in r for r in rows)

    def test_statuses_filter(self, client: TestClient, store: FakeStore) -> None:
        seed_row(store, "HJO-R", status="ready")
        seed_row(store, "HJO-X", status="excluded_secondary_ops")
        rows = client.get("/pending?statuses=excluded_secondary_ops", headers=AUTH).json()
        assert [r["code"] for r in rows] == ["HJO-X"]


class TestSubmit:
    def test_happy_path(
        self, client: TestClient, store: FakeStore, submitter: FakeSubmitter
    ) -> None:
        seed_row(store)
        resp = client.post("/submit/HJO-1", json={}, headers=AUTH)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "submitted"
        assert body["final_price"] == 800.0
        assert body["final_leadtime"] == "2026-06-25"

        assert len(submitter.calls) == 1
        assert submitter.calls[0]["offer_id"] == "684001"
        assert submitter.calls[0]["price"] == 800.0

        row = store.rows["HJO-1"]
        assert row["status"] == "submitted"
        assert row["final_price"] == 800.0
        assert row["submit_screenshot"] == "/screens/HJO-1.png"
        assert row["submitted_at"] is not None

    def test_double_submit_blocked(self, client: TestClient, store: FakeStore) -> None:
        seed_row(store)
        assert client.post("/submit/HJO-1", json={}, headers=AUTH).status_code == 200
        assert client.post("/submit/HJO-1", json={}, headers=AUTH).status_code == 409

    def test_operator_can_edit_price_and_leadtime(
        self, client: TestClient, store: FakeStore, submitter: FakeSubmitter
    ) -> None:
        seed_row(store)
        resp = client.post(
            "/submit/HJO-1",
            json={"price": 850.0, "leadtime": "2026-07-01", "comment": "incl. inspection"},
            headers=AUTH,
        )
        assert resp.status_code == 200
        assert submitter.calls[0]["price"] == 850.0
        assert submitter.calls[0]["leadtime"] == date(2026, 7, 1)
        assert submitter.calls[0]["comment"] == "incl. inspection"

    def test_guard_blocks_below_xometry_floor(
        self, client: TestClient, store: FakeStore, submitter: FakeSubmitter
    ) -> None:
        seed_row(store)
        resp = client.post("/submit/HJO-1", json={"price": 400.0}, headers=AUTH)
        assert resp.status_code == 409
        assert "counteroffer floor" in str(resp.json()["detail"]["blocked"])
        assert submitter.calls == []
        assert store.rows["HJO-1"]["status"] == "ready"  # untouched

    def test_guard_blocks_below_cost_floor(self, client: TestClient, store: FakeStore) -> None:
        # partner_cost 600 → floor 690; 650 is above allow_counter_from but below margin floor
        seed_row(store)
        resp = client.post("/submit/HJO-1", json={"price": 650.0}, headers=AUTH)
        assert resp.status_code == 409
        assert "cost floor" in str(resp.json()["detail"]["blocked"])

    def test_guard_blocks_early_leadtime(self, client: TestClient, store: FakeStore) -> None:
        seed_row(store)
        resp = client.post("/submit/HJO-1", json={"leadtime": "2026-06-24"}, headers=AUTH)
        assert resp.status_code == 409
        assert "business days" in str(resp.json()["detail"]["blocked"])

    def test_needs_review_requires_explicit_override(
        self, client: TestClient, store: FakeStore
    ) -> None:
        seed_row(store, status="needs_review")
        assert client.post("/submit/HJO-1", json={}, headers=AUTH).status_code == 409
        resp = client.post("/submit/HJO-1", json={"accept_review_row": True}, headers=AUTH)
        assert resp.status_code == 200
        assert store.rows["HJO-1"]["status"] == "submitted"

    def test_unpriced_row_needs_explicit_values(
        self, client: TestClient, store: FakeStore
    ) -> None:
        seed_row(store, suggested_price=None, suggested_leadtime=None)
        assert client.post("/submit/HJO-1", json={}, headers=AUTH).status_code == 422

    def test_unknown_code_404(self, client: TestClient) -> None:
        assert client.post("/submit/HJO-NOPE", json={}, headers=AUTH).status_code == 404

    def test_submitter_failure_parks_row_in_error(self, store: FakeStore) -> None:
        seed_row(store)
        failing = FakeSubmitter(fail=SubmitError("selector drift"))
        app = create_app(store, failing, api_token=TOKEN, today_fn=lambda: TODAY)
        resp = TestClient(app).post("/submit/HJO-1", json={}, headers=AUTH)
        assert resp.status_code == 502
        row = store.rows["HJO-1"]
        assert row["status"] == "error"  # never auto-retried (§6C)
        assert any(f.startswith("submit_failed:") for f in row["flags"])


class TestSkip:
    def test_skip_then_terminal(self, client: TestClient, store: FakeStore) -> None:
        seed_row(store)
        assert client.post("/skip/HJO-1", headers=AUTH).status_code == 200
        assert store.rows["HJO-1"]["status"] == "skipped"
        assert client.post("/skip/HJO-1", headers=AUTH).status_code == 409  # terminal
        assert client.post("/submit/HJO-1", json={}, headers=AUTH).status_code == 409
