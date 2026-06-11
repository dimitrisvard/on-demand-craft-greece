"""FastAPI review/submit API — the ONLY side-effecting surface toward Xometry (§6C).

Runs on the Hetzner box next to the worker; the dashboard proxies to it with a
bearer token. POST /submit/{code} is triggered by a human dashboard click,
guarded by pricing.submit_guard, and idempotent via an atomic status claim
(ready → submitting → submitted). A failed attempt parks the row in `error`
and is never auto-retried — the form may have half-submitted.
"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from . import config, pricing
from .db import OfferStore, PostgresStore
from .partner_form import PlaywrightFormSubmitter, SubmitError, Submitter

log = logging.getLogger(__name__)

SUBMITTABLE_STATUSES: tuple[str, ...] = ("ready",)
REVIEWABLE_STATUSES: tuple[str, ...] = ("ready", "needs_review", "priced")
DEFAULT_PENDING = ["ready", "needs_review", "priced", "new", "needs_manual"]
# `raw` is a full offer dump — keep it out of list responses.
_LIST_OMIT = {"raw"}


class SubmitBody(BaseModel):
    price: float | None = None  # default: row.suggested_price
    leadtime: date | None = None  # default: row.suggested_leadtime
    comment: str = ""
    # Explicit operator override to submit a needs_review/priced row.
    accept_review_row: bool = False


def create_app(
    store: OfferStore,
    submitter: Submitter,
    *,
    api_token: str,
    today_fn: Any = date.today,
) -> FastAPI:
    if not api_token:
        raise ValueError("XB_REVIEW_API_TOKEN must be set — the submit API is never open")

    app = FastAPI(title="xometry-bot review API", version="0.1.0")

    def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
        expected = f"Bearer {api_token}"
        if authorization is None or not secrets.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="missing or invalid bearer token")

    auth = Depends(require_token)

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/pending", dependencies=[auth])
    def pending(statuses: str | None = None) -> list[dict[str, Any]]:
        wanted = [s.strip() for s in statuses.split(",")] if statuses else DEFAULT_PENDING
        rows = store.list_by_status(wanted)
        return [{k: v for k, v in row.items() if k not in _LIST_OMIT} for row in rows]

    @app.post("/skip/{code}", dependencies=[auth])
    def skip(code: str) -> dict[str, str]:
        row = store.transition(
            code,
            from_statuses=[
                "new", "priced", "ready", "needs_manual", "needs_review",
                "excluded_secondary_ops", "error",
            ],
            to_status="skipped",
        )
        if row is None:
            raise HTTPException(status_code=409, detail="row not found or already terminal")
        return {"code": code, "status": "skipped"}

    @app.post("/submit/{code}", dependencies=[auth])
    def submit(code: str, body: SubmitBody) -> dict[str, Any]:
        row = store.get(code)
        if row is None:
            raise HTTPException(status_code=404, detail=f"unknown offer {code}")

        final_price = body.price if body.price is not None else _f(row.get("suggested_price"))
        final_leadtime = body.leadtime or row.get("suggested_leadtime")
        if final_price is None or final_leadtime is None:
            raise HTTPException(
                status_code=422,
                detail="no price/lead time available — row was never priced; pass both explicitly",
            )

        today = today_fn()
        your_cost = pricing.estimate_cost(row)
        if your_cost is None:
            your_cost = _f(row.get("partner_cost"))
        reasons = pricing.submit_guard(
            final_price=final_price,
            final_leadtime=final_leadtime,
            allow_counter_from=_f(row.get("allow_counter_from")),
            your_cost=your_cost,
            today=today,
        )
        if reasons:
            raise HTTPException(status_code=409, detail={"blocked": reasons})

        allowed = SUBMITTABLE_STATUSES if not body.accept_review_row else REVIEWABLE_STATUSES
        claimed = store.transition(code, from_statuses=allowed, to_status="submitting")
        if claimed is None:
            raise HTTPException(
                status_code=409,
                detail=f"row not submittable from status '{row.get('status')}' "
                f"(allowed: {', '.join(allowed)}; already submitted rows stay submitted)",
            )

        try:
            screenshot = submitter.submit(
                offer_id=str(row["offer_id"]),
                code=code,
                price=final_price,
                leadtime=final_leadtime,
                comment=body.comment,
            )
        except SubmitError as exc:
            flags = list(dict.fromkeys([*(row.get("flags") or []), f"submit_failed:{exc}"]))
            store.update_fields(code, status="error", flags=flags)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        store.update_fields(
            code,
            status="submitted",
            final_price=final_price,
            final_leadtime=final_leadtime,
            submitted_at=datetime.now(tz=UTC),
            submit_screenshot=screenshot,
        )
        log.info("submitted %s at %.2f, lead %s", code, final_price, final_leadtime)
        return {
            "code": code,
            "status": "submitted",
            "final_price": final_price,
            "final_leadtime": final_leadtime.isoformat(),
            "screenshot": screenshot,
        }

    return app


def _f(v: Any) -> float | None:
    return None if v is None else float(v)


def main() -> None:
    import uvicorn

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    settings = config.Settings.from_env()
    app = create_app(
        PostgresStore(settings.db_dsn),
        PlaywrightFormSubmitter(
            profile_dir=settings.partner_profile_dir,
            screenshots_dir=settings.screenshots_dir,
            headless=settings.headless,
        ),
        api_token=settings.review_api_token,
    )
    uvicorn.run(app, host="127.0.0.1", port=8077)


if __name__ == "__main__":
    main()
