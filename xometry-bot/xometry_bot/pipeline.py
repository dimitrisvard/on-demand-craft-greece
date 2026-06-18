"""Cron entrypoint: scan → preset filter → exclusion → dedupe/upsert → download
→ buyer pricing → compute (§4-§6A).

Read-only toward Xometry apart from file downloads. NEVER submits anything —
the only side-effecting call lives in review_api, behind a human click (§7).
One scan at a time (lockfile); per-offer failures flag the row and continue,
they never kill the cron run.
"""

from __future__ import annotations

import fcntl
import logging
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import IO, Any

from . import config, filters, pricing
from .buyer_pricer import BuyerPricer, NeedsConfirmation, PricingError
from .db import TERMINAL_STATUSES, OfferStore, PostgresStore
from .models import JobOffer, OfferRow
from .partner_client import PartnerClient

log = logging.getLogger(__name__)


@dataclass
class ScanStats:
    scanned: int = 0
    preset_rejected: int = 0
    excluded_secondary: int = 0
    upserted: int = 0
    needs_manual: int = 0
    priced: int = 0
    ready: int = 0
    errors: list[str] = field(default_factory=list)


def build_row(offer: JobOffer, spec: filters.Spec) -> OfferRow:
    """Flatten a JobOffer (+ extracted spec) into a xometry_offers row (§3)."""
    p0 = offer.parts[0] if offer.parts else None
    tags = list(
        dict.fromkeys(
            f"{t.context}/{t.name}" if t.context else t.name
            for p in offer.parts
            for t in p.tags
        )
    )
    part_files: list[dict[str, str | None]] = [
        {"name": f.name, "downloadUrl": f.download_url}
        for p in offer.parts
        for f in p.files
    ]
    return OfferRow(
        code=offer.code,
        offer_id=str(offer.id),
        is_urgent=offer.is_urgent,
        process_type=p0.process_type if p0 else None,
        material=p0.material if p0 else None,
        quantity=p0.quantity if p0 else None,
        dimensions=p0.dimensions if p0 else None,
        weight_kg=p0.weight_kg if p0 else None,
        volume_mm3=p0.volume_mm3 if p0 else None,
        tags=tags,
        tolerance=spec.tolerance,
        roughness=spec.roughness,
        finish=spec.finish if spec.finish is not None else (p0.finish if p0 else None),
        inspection_needed=spec.inspection_needed,
        part_files=part_files,
        production_remark=p0.production_remark if p0 else None,
        partner_cost=offer.cost.amount if offer.cost else None,
        allow_counter_from=offer.allow_counteroffer_from,
        xo_leadtime=offer.leadtime,
        publication_end=offer.publication_end,
        flags=list(spec.flags),
        raw=offer.raw,
        status="new",
    )


def run_scan(store: OfferStore, client: PartnerClient, settings: config.Settings) -> ScanStats:
    """Phase 1 (§4): fetch the board, filter, dedupe, download, upsert."""
    stats = ScanStats()
    for offer in client.scan():
        stats.scanned += 1
        try:
            _process_offer(store, client, settings, offer, stats)
        except Exception as exc:  # one bad offer must not kill the cron run (§7)
            log.exception("offer %s failed", offer.code)
            stats.errors.append(f"{offer.code}: {exc}")
    return stats


def _process_offer(
    store: OfferStore,
    client: PartnerClient,
    settings: config.Settings,
    offer: JobOffer,
    stats: ScanStats,
) -> None:
    if not filters.matches_any_active_preset(offer):
        stats.preset_rejected += 1
        return

    spec = filters.extract_spec(offer)
    row = build_row(offer, spec)

    hit = filters.find_secondary_op(offer, borderline_exclude=settings.borderline_exclude)
    if hit:
        # Store, don't delete — Dimitris can see what was skipped (§1C).
        row.status = "excluded_secondary_ops"
        row.excluded_reason = hit.op_name
        row.flags = list(dict.fromkeys([*row.flags, f"secondary_op:{hit.op_name}"]))
        store.upsert_offer(row)
        stats.excluded_secondary += 1
        return

    kind = filters.file_kind([f.name for p in offer.parts for f in p.files])
    if kind != "instant":
        # PDF/DWG-only (or dxf-only for CNC) can't be instant-priced (§1B).
        row.status = "needs_manual"
        row.flags = list(dict.fromkeys([*row.flags, f"files:{kind}"]))
        stats.needs_manual += 1

    status = store.upsert_offer(row)
    stats.upserted += 1
    if status in TERMINAL_STATUSES:
        return

    if not settings.download_files:
        # Serverless/CI scan: skip local CAD copies (only the buyer pricer needs
        # them); the dashboard links to Xometry's own downloadUrl instead.
        return

    try:
        local = client.download_files(offer, settings.files_dir)
        if local:
            store.update_fields(offer.code, local_files=local)
    except Exception as exc:
        log.warning("download failed for %s: %s", offer.code, exc)
        existing = store.get(offer.code)
        flags = list((existing or {}).get("flags") or [])
        store.update_fields(
            offer.code, flags=list(dict.fromkeys([*flags, "download_failed"]))
        )


def run_pricing_pass(store: OfferStore, pricer: BuyerPricer, settings: config.Settings) -> int:
    """Phase 2 (§5): buyer-price every status='new' row that has an instant-quotable file."""
    priced = 0
    for row in store.list_by_status(["new"]):
        code = str(row["code"])
        local_files = list(row.get("local_files") or [])
        quote_file = filters.pick_quote_file(local_files)
        if quote_file is None:
            store.update_fields(
                code,
                status="needs_manual",
                flags=list(dict.fromkeys([*(row.get("flags") or []), "no_quote_file"])),
            )
            continue
        try:
            quote = pricer.price(
                label=code,
                quote_file=Path(quote_file),
                quantity=row.get("quantity"),
                material=row.get("material"),
                tolerance=row.get("tolerance"),
                roughness=row.get("roughness"),
            )
        except NeedsConfirmation as exc:
            log.warning("buyer pricing skipped: %s", exc)
            return priced
        except PricingError as exc:
            flags = list(dict.fromkeys([*(row.get("flags") or []), f"pricing:{exc}"]))
            if exc.screenshot:
                flags.append(f"screenshot:{exc.screenshot}")
            store.update_fields(code, status=exc.status, flags=flags)
            continue
        flags = list(dict.fromkeys([*(row.get("flags") or []), *quote.flags]))
        status = "needs_review" if any(f.startswith("config_mismatch") for f in flags) else "priced"
        store.update_fields(
            code,
            status=status,
            buyer_price=quote.buyer_price,
            buyer_quote_id=quote.quote_id,
            threads_present=(quote.threads_locations or 0) > 0
            if quote.threads_locations is not None
            else None,
            flags=flags,
        )
        priced += 1
    return priced


def run_compute_pass(store: OfferStore, *, today: date | None = None) -> int:
    """§6A: suggested price + lead time for every priced row → ready / needs_review."""
    today = today or date.today()
    computed = 0
    for row in store.list_by_status(["priced"]):
        code = str(row["code"])
        your_cost = pricing.estimate_cost(row)
        result = pricing.compute(
            buyer_price=_to_float(row.get("buyer_price")),
            partner_cost=_to_float(row.get("partner_cost")),
            your_cost=your_cost,
            xo_leadtime=row.get("xo_leadtime"),
            today=today,
        )
        store.update_fields(
            code,
            status=result.status,
            suggested_price=result.suggested_price,
            suggested_leadtime=result.suggested_leadtime,
            flags=list(dict.fromkeys([*(row.get("flags") or []), *result.flags])),
        )
        computed += 1
    return computed


def _to_float(v: Any) -> float | None:
    return None if v is None else float(v)


def _acquire_lock(data_dir: Path) -> IO[str] | None:
    data_dir.mkdir(parents=True, exist_ok=True)
    handle = (data_dir / "scan.lock").open("w")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return None
    return handle


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    settings = config.Settings.from_env()
    lock = _acquire_lock(settings.data_dir)
    if lock is None:
        log.info("another scan is running — exiting (one scan at a time, §7)")
        return 0
    try:
        store = PostgresStore(settings.db_dsn)
        with PartnerClient(
            auth_token=settings.partner_auth_token, cookie=settings.partner_cookie
        ) as client:
            stats = run_scan(store, client, settings)
        log.info(
            "scan done: scanned=%d preset_rejected=%d excluded=%d upserted=%d "
            "needs_manual=%d errors=%d",
            stats.scanned, stats.preset_rejected, stats.excluded_secondary,
            stats.upserted, stats.needs_manual, len(stats.errors),
        )

        if settings.enable_buyer_pricing:
            pricer = BuyerPricer(
                profile_dir=settings.buyer_profile_dir,
                screenshots_dir=settings.screenshots_dir,
                headless=settings.headless,
                confirmed=settings.buyer_selectors_confirmed,
            )
            priced = run_pricing_pass(store, pricer, settings)
            log.info("pricing pass done: priced=%d", priced)
        else:
            log.info("buyer pricing disabled (XB_ENABLE_BUYER_PRICING=0) — Phase 1 only")

        computed = run_compute_pass(store)
        log.info("compute pass done: computed=%d", computed)
        return 1 if stats.errors else 0
    finally:
        lock.close()


if __name__ == "__main__":
    sys.exit(main())
