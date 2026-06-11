"""Persistence against Supabase Postgres (direct connection, psycopg).

The idempotency contract (§3) is enforced at the SQL level:
- upsert on `code`; a seen code never produces a second row,
- re-scan refreshes price/expiry/raw only,
- `submitted` / `skipped` are terminal — the upsert's WHERE clause skips them,
- submit claims happen via an atomic status transition (no double-submit).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any, Protocol

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import OfferRow

log = logging.getLogger(__name__)

TERMINAL_STATUSES: tuple[str, ...] = ("submitted", "skipped")

# Columns the worker/API may update after insert (whitelist — never interpolate caller keys).
ALLOWED_UPDATE_COLS: frozenset[str] = frozenset(
    {
        "status", "flags", "tags", "local_files", "buyer_price", "buyer_quote_id",
        "suggested_price", "suggested_leadtime", "threads_present", "excluded_reason",
        "tolerance", "roughness", "finish", "inspection_needed",
        "final_price", "final_leadtime", "submitted_at", "submit_screenshot",
    }
)
_JSONB_COLS = frozenset({"part_files", "local_files", "raw"})


class OfferStore(Protocol):
    """Persistence interface; FakeStore in tests mirrors these exact semantics."""

    def upsert_offer(self, row: OfferRow) -> str: ...

    def get(self, code: str) -> dict[str, Any] | None: ...

    def list_by_status(self, statuses: Sequence[str]) -> list[dict[str, Any]]: ...

    def update_fields(self, code: str, **fields: Any) -> None: ...

    def transition(
        self, code: str, *, from_statuses: Sequence[str], to_status: str
    ) -> dict[str, Any] | None: ...


_INSERT_COLS: tuple[str, ...] = (
    "code", "offer_id", "is_urgent", "process_type", "material", "quantity",
    "dimensions", "weight_kg", "volume_mm3", "tags", "tolerance", "roughness",
    "finish", "threads_present", "inspection_needed", "excluded_reason",
    "part_files", "local_files", "production_remark", "partner_cost",
    "allow_counter_from", "buyer_price", "buyer_quote_id", "suggested_price",
    "xo_leadtime", "publication_end", "suggested_leadtime", "status", "flags", "raw",
)

# Fields refreshed on re-scan (everything else — incl. status and computed prices —
# is preserved so pricing work and operator decisions survive a re-scan).
_REFRESH_COLS: tuple[str, ...] = (
    "is_urgent", "partner_cost", "allow_counter_from", "xo_leadtime",
    "publication_end", "part_files", "raw",
)

_UPSERT_SQL = sql.SQL(
    "insert into xometry_offers ({cols}) values ({placeholders}) "
    "on conflict (code) do update set {refresh}, updated_at = now() "
    "where xometry_offers.status not in ('submitted', 'skipped') "
    "returning status"
).format(
    cols=sql.SQL(", ").join(sql.Identifier(c) for c in _INSERT_COLS),
    placeholders=sql.SQL(", ").join(sql.Placeholder(c) for c in _INSERT_COLS),
    refresh=sql.SQL(", ").join(
        sql.SQL("{c} = excluded.{c}").format(c=sql.Identifier(c)) for c in _REFRESH_COLS
    ),
)


class PostgresStore:
    def __init__(self, dsn: str) -> None:
        if not dsn:
            raise ValueError("XB_DB_DSN is not set (Supabase Postgres connection string)")
        self._dsn = dsn

    def _connect(self) -> psycopg.Connection[dict[str, Any]]:
        return psycopg.connect(self._dsn, row_factory=dict_row)

    def upsert_offer(self, row: OfferRow) -> str:
        """Insert or refresh by code; terminal rows untouched. Returns resulting status."""
        params = row.model_dump()
        for col in _JSONB_COLS:
            params[col] = Jsonb(params[col])
        params = {k: v for k, v in params.items() if k in _INSERT_COLS}
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(_UPSERT_SQL, params)
            result = cur.fetchone()
            if result is not None:
                return str(result["status"])
            # Conflict row was terminal — fetch and report its status untouched.
            cur.execute("select status from xometry_offers where code = %s", (row.code,))
            existing = cur.fetchone()
            return str(existing["status"]) if existing else row.status

    def get(self, code: str) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("select * from xometry_offers where code = %s", (code,))
            return cur.fetchone()

    def list_by_status(self, statuses: Sequence[str]) -> list[dict[str, Any]]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "select * from xometry_offers where status = any(%s) "
                "order by publication_end asc nulls last, code",
                (list(statuses),),
            )
            return cur.fetchall()

    def update_fields(self, code: str, **fields: Any) -> None:
        bad = set(fields) - ALLOWED_UPDATE_COLS
        if bad:
            raise ValueError(f"refusing to update non-whitelisted columns: {sorted(bad)}")
        if not fields:
            return
        assignments = sql.SQL(", ").join(
            sql.SQL("{c} = {p}").format(c=sql.Identifier(k), p=sql.Placeholder(k))
            for k in fields
        )
        params: dict[str, Any] = {
            k: Jsonb(v) if k in _JSONB_COLS else v for k, v in fields.items()
        }
        params["code"] = code
        query = sql.SQL(
            "update xometry_offers set {assignments}, updated_at = now() where code = {code}"
        ).format(assignments=assignments, code=sql.Placeholder("code"))
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, params)

    def transition(
        self, code: str, *, from_statuses: Sequence[str], to_status: str
    ) -> dict[str, Any] | None:
        """Atomic status claim: returns the row iff it was in `from_statuses`."""
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "update xometry_offers set status = %s, updated_at = now() "
                "where code = %s and status = any(%s) returning *",
                (to_status, code, list(from_statuses)),
            )
            return cur.fetchone()
