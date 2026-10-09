"""Golden vectors for the TypeScript port of xometry-bot (PHASE5_SPEC §6.4, X-4).

Runs the REAL Python modules (xometry_bot.*) on the repo's own test fixtures (tests/fixtures.py) and records
inputs and outputs as JSON; workers/ops/test/p5/xometry/golden.test.ts replays every vector against
workers/ops/src/xometry/*. Synthetic data only: no live offer, no credential.

The output also records the SHA-256 of every xometry-bot module the run imported (_meta.sources); a T1 test fails
when one of those files changes, so a Python change forces a regeneration. The output is deterministic (no date,
Python major.minor only), so a regeneration with unchanged sources reproduces the file byte for byte:

    cd xometry-bot && <venv>/bin/python ../workers/ops/scripts/xometry-golden/gen_golden.py \
        > ../workers/ops/test/fixtures/xometry/golden.json

Dependencies of the venv: httpx, pydantic 2, psycopg (imported by xometry_bot.db), pytest not needed.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True  # leave no __pycache__ behind in xometry-bot/
sys.path.insert(0, ".")

from pydantic import ValidationError  # noqa: E402

from tests import fixtures as fx  # noqa: E402
from tests.fakes import FakeClient, FakeStore  # noqa: E402
from xometry_bot import config, filters, pricing  # noqa: E402
from xometry_bot.models import JobOffer, Money, ScanPage  # noqa: E402
from xometry_bot.partner_client import GSH_JOB_OFFERS_QUERY_TMPL, MONEY_FRAGMENT  # noqa: E402
from xometry_bot.pipeline import build_row, run_compute_pass, run_scan  # noqa: E402

TODAY = date(2026, 6, 11)


def jd(v: Any) -> Any:
    """JSON-safe dump: dates/datetimes as ISO strings, frozensets sorted."""
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: jd(x) for k, x in v.items()}
    if isinstance(v, list | tuple):
        return [jd(x) for x in v]
    if isinstance(v, frozenset | set):
        return sorted(jd(x) for x in v)
    return v


def err_or(fn):  # type: ignore[no-untyped-def]
    try:
        return {"ok": jd(fn())}
    except ValidationError as e:
        return {"error": "ValidationError", "locs": [list(map(str, x["loc"])) for x in e.errors()]}
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__, "message": str(e)}


out: dict[str, Any] = {
    "_meta": {
        "generator": "workers/ops/scripts/xometry-golden/gen_golden.py",
        "python": f"{sys.version_info.major}.{sys.version_info.minor}",
        "source": "xometry-bot/xometry_bot/* run directly; inputs from xometry-bot/tests/fixtures.py",
    }
}

# ---------------------------------------------------------------- config constants
out["config"] = {
    "PARTNER_GRAPHQL_URL": config.PARTNER_GRAPHQL_URL,
    "PRESETS": {k: {"include": sorted(p.include), "exclude": sorted(p.exclude)} for k, p in config.PRESETS.items()},
    "ACTIVE_PRESETS": list(config.ACTIVE_PRESETS),
    "SCAN_FILTER": config.SCAN_FILTER,
    "SCAN_PAGE_LIMIT": config.SCAN_PAGE_LIMIT,
    "SCAN_MAX_PAGES": config.SCAN_MAX_PAGES,
    "SECONDARY_OP_RE": config.SECONDARY_OP_RE.pattern,
    "BORDERLINE_RE": config.BORDERLINE_RE.pattern,
    "TOLERANCE_RE": filters.TOLERANCE_RE.pattern,
    "ROUGHNESS_RE": filters.ROUGHNESS_RE.pattern,
    "THREAD_RISK_RE": filters.THREAD_RISK_RE.pattern,
    "INSTANT_QUOTE_EXTS": sorted(config.INSTANT_QUOTE_EXTS),
    "MANUAL_ONLY_EXTS": sorted(config.MANUAL_ONLY_EXTS),
    "PREFERRED_QUOTE_EXTS": list(config.PREFERRED_QUOTE_EXTS),
    "DISCOUNT": config.DISCOUNT,
    "MIN_MARGIN": config.MIN_MARGIN,
    "LEADTIME_BUSINESS_DAYS": config.LEADTIME_BUSINESS_DAYS,
    "PLAUSIBLE_BUYER_TO_PARTNER_RATIO": list(config.PLAUSIBLE_BUYER_TO_PARTNER_RATIO),
    "QUERY": GSH_JOB_OFFERS_QUERY_TMPL.replace("__MONEY__", MONEY_FRAGMENT),
}

# ---------------------------------------------------------------- pricing
abd = []
for start, n, hol in [
    ("2026-06-11", 10, []), ("2026-06-12", 1, []), ("2026-06-12", 1, ["2026-06-15"]),
    ("2026-06-11", 0, []), ("2026-06-11", -1, []), ("2026-06-13", 1, []), ("2026-06-14", 5, []),
    ("2026-12-23", 10, ["2026-12-25", "2027-01-01"]), ("2026-02-27", 2, []), ("2028-02-28", 2, []),
]:
    abd.append({
        "start": start, "n": n, "holidays": hol,
        "result": err_or(lambda s=start, k=n, h=hol: pricing.add_business_days(
            date.fromisoformat(s), k, frozenset(date.fromisoformat(x) for x in h))),
    })
out["add_business_days"] = abd

sp = []
for b, c in [(1000.0, 100.0), (1000.0, 900.0), (333.33, 1.0), (100.0, 95.0), (0.15625, 0.0),
             (100.15625, 0.0), (2.675, 0.0), (1.005, 0.0), (0.125, 0.0), (0.375, 0.0),
             (10.03125, 0.0), (0.0, 0.0), (1e9, 1.0), (12.345, 10.0), (99.99, 87.0)]:
    sp.append({"buyer": b, "cost": c, "result": pricing.suggested_price(b, c)})
out["suggested_price"] = sp

# Python round(x, 2) and f"{x:.2f}" on raw floats (the TS helpers pyRound2 / pyFixed2 must match)
rnd = []
for x in [0.125, 0.375, 0.625, 0.875, 2.675, 1.005, 1.015, 1.025, 80.125, 266.664, 805.0, 109.25,
          1035.0, 5.125, 0.005, 0.015, 1234567.125, 1.0000000000000002, 10.0, 4.995, -0.125, -2.675]:
    rnd.append({"x": x, "round2": round(x, 2), "fixed2": f"{x:.2f}", "fixed0pct": f"{x:.0%}"})
out["py_round"] = rnd

slt = []
for xo in [None, "2026-07-20", "2026-06-18", "2026-06-25", "2026-06-24"]:
    slt.append({"xo": xo, "today": TODAY.isoformat(),
                "result": pricing.suggested_leadtime(date.fromisoformat(xo) if xo else None, today=TODAY).isoformat()})
out["suggested_leadtime"] = slt

cmp = []
for kw in [
    dict(buyer_price=1000.0, partner_cost=700.0, your_cost=None, xo_leadtime="2026-06-18"),
    dict(buyer_price=1000.0, partner_cost=700.0, your_cost=900.0, xo_leadtime=None),
    dict(buyer_price=100.0, partner_cost=95.0, your_cost=None, xo_leadtime=None),
    dict(buyer_price=None, partner_cost=100.0, your_cost=None, xo_leadtime=None),
    dict(buyer_price=0.0, partner_cost=100.0, your_cost=None, xo_leadtime=None),
    dict(buyer_price=-5.0, partner_cost=None, your_cost=None, xo_leadtime=None),
    dict(buyer_price=1000.0, partner_cost=100.0, your_cost=None, xo_leadtime=None),
    dict(buyer_price=500.0, partner_cost=None, your_cost=None, xo_leadtime=None),
    dict(buyer_price=41.0, partner_cost=8.0, your_cost=None, xo_leadtime=None),      # ratio 5.125 -> "5.12"
    dict(buyer_price=1.0, partner_cost=8.0, your_cost=None, xo_leadtime=None),       # ratio 0.125 -> "0.12"
    dict(buyer_price=800.0, partner_cost=1000.0, your_cost=None, xo_leadtime=None),  # ratio exactly 0.8
    dict(buyer_price=5000.0, partner_cost=1000.0, your_cost=None, xo_leadtime=None),  # ratio exactly 5.0
    dict(buyer_price=1000.0, partner_cost=0.0, your_cost=None, xo_leadtime=None),    # partner 0 -> no ratio check
    dict(buyer_price=1000.0, partner_cost=-1.0, your_cost=None, xo_leadtime=None),
    dict(buyer_price=1000.0, partner_cost=None, your_cost=600.0, xo_leadtime="2026-08-01"),
]:
    xo = kw.pop("xo_leadtime")
    r = pricing.compute(**kw, xo_leadtime=date.fromisoformat(xo) if xo else None, today=TODAY)
    cmp.append({"input": {**kw, "xo_leadtime": xo, "today": TODAY.isoformat()},
                "result": {"suggested_price": r.suggested_price, "suggested_leadtime": r.suggested_leadtime.isoformat(),
                           "status": r.status, "flags": r.flags}})
out["compute"] = cmp

sg = []
for kw in [
    dict(final_price=800.0, final_leadtime="2026-06-25", allow_counter_from=500.0, your_cost=600.0),
    dict(final_price=400.0, final_leadtime="2026-06-25", allow_counter_from=500.0, your_cost=None),
    dict(final_price=600.0, final_leadtime="2026-06-25", allow_counter_from=None, your_cost=600.0),
    dict(final_price=800.0, final_leadtime="2026-06-24", allow_counter_from=None, your_cost=None),
    dict(final_price=0.125, final_leadtime="2026-06-01", allow_counter_from=0.375, your_cost=0.125),
    dict(final_price=114.99, final_leadtime="2026-06-25", allow_counter_from=None, your_cost=100.0),
]:
    lt = kw.pop("final_leadtime")
    reasons = pricing.submit_guard(**kw, final_leadtime=date.fromisoformat(lt), today=TODAY)
    sg.append({"input": {**kw, "final_leadtime": lt, "today": TODAY.isoformat()}, "result": reasons})
out["submit_guard"] = sg

# ---------------------------------------------------------------- filters
def offer_with_tags(*tags: dict[str, Any], finish: str = "") -> dict[str, Any]:
    return fx.make_offer(parts=[fx.make_part(tags=list(tags), finish=finish)])


def tag(name: str, ctx: str = "production_method_features", tid: int = 999) -> dict[str, Any]:
    return {"id": tid, "name": name, "context": ctx}


fcases: list[dict[str, Any]] = []
payloads: dict[str, dict[str, Any]] = {
    "milling": offer_with_tags(fx.MILLING_TAG),
    "laser_only": offer_with_tags(fx.LASER_TAG),
    "milling_laser": offer_with_tags(fx.MILLING_TAG, fx.LASER_TAG),
    "turning_anodizing": offer_with_tags(fx.TURNING_TAG, fx.ANODIZING_TAG),
    "no_tags": offer_with_tags(),
    "finish_anodizing": offer_with_tags(fx.MILLING_TAG, finish="Anodizing black matt"),
    "finish_brushed": offer_with_tags(fx.MILLING_TAG, finish="Brushed"),
    "finish_none": fx.make_offer(parts=[fx.make_part(finish=None)]),
    "risk_chrome": offer_with_tags(tag("Chrome plating", "production_risks")),
    "grinding": offer_with_tags(fx.MILLING_TAG, fx.GRINDING_TAG),
    "grinding_heat": offer_with_tags(fx.GRINDING_TAG, fx.HEAT_TAG),
    "grind_then_anod_parts": fx.make_offer(parts=[fx.make_part(tags=[fx.GRINDING_TAG]), fx.make_part(tags=[fx.ANODIZING_TAG])]),
    "full_spec": fx.make_offer(parts=[fx.make_part(tags=[fx.MILLING_TAG, fx.TOLERANCE_TAG, fx.RA_TAG, fx.THREAD_RISK_TAG],
                                                   measurementProtocolNeeded=True, samplesNeeded=True)]),
    "multi_part": fx.make_offer(parts=[fx.make_part(), fx.make_part(code="P-2")]),
    "multi_part_dup_flags": fx.make_offer(parts=[fx.make_part(samplesNeeded=True, finish="Brushed"),
                                                 fx.make_part(code="P-2", samplesNeeded=True, finish="Polished")]),
    "zero_parts": fx.make_offer(parts=[]),
    "tol_pm": offer_with_tags(tag("Tolerance: ± 0.500 mm")),
    "tol_coarse": offer_with_tags(tag("ISO 2768: coarse")),
    "tol_grade": offer_with_tags(tag("Tol.grade: 5 / ISO 286-1")),
    "tol_plusminus_only": offer_with_tags(tag("± 0.05")),
    "ra_lower": offer_with_tags(tag("  ra 0.8")),
    "ra_word": offer_with_tags(tag("Rapid prototype")),       # \b: 'Rap' is not Ra
    "ra_unicode_word": offer_with_tags(tag("Raé finish")),    # Python \b is Unicode-aware
    "ra_colon_first_then_tol": offer_with_tags(tag("Ra: 1.6"), tag("ISO 2768: fine")),
    "thread_risk_feature": offer_with_tags(tag("Deep drilling")),
    "thread_risk_method": offer_with_tags(tag("Thread rolling", "production_methods", 77)),
    "marking_feature": offer_with_tags(tag("Laser marking")),
    "case_hardening": offer_with_tags(tag("Case Hardening")),
    "long_s_sandblast": offer_with_tags(tag("ſandblasting")),   # U+017F LATIN SMALL LETTER LONG S
    "kelvin_k": offer_with_tags(tag("BlaK oxide")),             # U+212A KELVIN SIGN (not in regex)
    "galvanized_upper": offer_with_tags(tag("HOT-DIP GALVANIZED")),
    "finish_color": offer_with_tags(tag("Finish color RAL 9005")),
    "polish_plain": offer_with_tags(tag("Polishing")),                 # not in SECONDARY_OP_RE
    "vapor": offer_with_tags(tag("Vapor polishing")),
    "tag_methods_ctx_anod": offer_with_tags(tag("Anodizing", "production_methods", 86)),
    "materials_ctx": offer_with_tags(fx.MILLING_TAG, fx.MATERIAL_TAG),
}
for name, p in payloads.items():
    offer = JobOffer.model_validate(copy.deepcopy(p))
    case: dict[str, Any] = {"name": name, "offer": p}
    case["matches_any_active_preset"] = filters.matches_any_active_preset(offer)
    for be in [frozenset(), frozenset({"grinding"}), frozenset({"heat treat", "marking"}), frozenset({"case harden"})]:
        hit = filters.find_secondary_op(offer, borderline_exclude=be)
        case.setdefault("find_secondary_op", []).append(
            {"borderline_exclude": sorted(be), "hit": None if hit is None else {"op_name": hit.op_name, "source": hit.source}})
    s = filters.extract_spec(offer)
    case["extract_spec"] = {"tolerance": s.tolerance, "roughness": s.roughness, "finish": s.finish,
                            "inspection_needed": s.inspection_needed, "flags": s.flags}
    fcases.append(case)
out["filters"] = fcases

custom = config.Preset("custom", include=frozenset({14}), exclude=frozenset({36}))
out["matches_preset_custom"] = {
    "preset": {"include": [14], "exclude": [36]},
    "cases": [{"offer": n, "result": filters.matches_preset(JobOffer.model_validate(copy.deepcopy(payloads[n])), custom)}
              for n in ["milling", "milling_laser", "laser_only", "no_tags"]],
}

fk = []
for names in [["bracket.step"], ["BRACKET.STP", "drawing.pdf"], ["drawing.pdf"], ["model.dwg", "spec.pdf"],
              ["plate.dxf"], [], ["a.stl"], ["part.SLDPRT"], ["x.x_t"], ["x.X_B", "y.dxf"], ["plate.dxf", "d.pdf"],
              [".step"], ["noext"], ["file."], ["a.tar.step"], ["a.step.zip"], ["a.STEP "], ["dir/a.iges"],
              ["a.igs"], ["a.3MF"], ["a.dws"], ["a.dwf"], ["a.catpart"], ["weird..step"], ["a.Step"]]:
    fk.append({"names": names, "result": filters.file_kind(names)})
out["file_kind"] = fk

pq = []
for paths in [["/d/a.stl", "/d/b.step", "/d/c.pdf"], ["/d/a.stl"], ["/d/c.pdf", "/d/p.dxf"], ["/d/A.STP", "/d/b.step"],
              ["/d/x.sldprt", "/d/y.STL"], [], ["/d/a.step.bak", "/d/b.stl"], ["/d/.step"], ["/d/z.x_b"]]:
    pq.append({"paths": paths, "result": filters.pick_quote_file(paths)})
out["pick_quote_file"] = pq

# ---------------------------------------------------------------- models
mcases = []
for name, p in [
    ("money_amount_currency", {"amount": 123.45, "currency": "EUR"}),
    ("money_value_code", {"value": 99.5, "currencyCode": "EUR"}),
    ("money_amount_code", {"amount": 7, "currencyCode": "USD"}),
    ("money_bare_int", 75),
    ("money_bare_float", 75.5),
    ("money_numeric_string", {"amount": "12.50"}),
    ("money_missing_amount", {"currency": "EUR"}),
    ("money_null", None),
    ("money_bool", {"amount": True}),
    ("money_both_amount_and_value", {"amount": 1, "value": 2}),
]:
    mcases.append({"name": name, "input": p, "result": err_or(lambda q=p: Money.model_validate(q).model_dump())})
out["money"] = mcases

jo = []
base = fx.make_offer()
variants: list[tuple[str, dict[str, Any]]] = [
    ("full", base),
    ("acf_money_obj", fx.make_offer(allowCounterofferFrom={"amount": 81.5, "currency": "EUR"})),
    ("acf_value_obj", fx.make_offer(allowCounterofferFrom={"value": 82.5})),
    ("acf_string", fx.make_offer(allowCounterofferFrom="83.25")),
    ("acf_null", fx.make_offer(allowCounterofferFrom=None)),
    ("leadtime_iso_dt", fx.make_offer(leadtime="2026-07-01T00:00:00Z")),
    ("leadtime_iso_dt_late", fx.make_offer(leadtime="2026-07-01T23:30:00-05:00")),
    ("leadtime_ms", fx.make_offer(leadtime=int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000))),
    ("leadtime_s", fx.make_offer(leadtime=int(datetime(2026, 7, 1, 12, tzinfo=UTC).timestamp()))),
    ("leadtime_null", fx.make_offer(leadtime=None)),
    ("leadtime_empty", fx.make_offer(leadtime="")),
    ("pub_ms", fx.make_offer(publicationEnd=int(datetime(2026, 6, 14, 10, tzinfo=UTC).timestamp() * 1000))),
    ("pub_s", fx.make_offer(publicationEnd=int(datetime(2026, 6, 14, 10, tzinfo=UTC).timestamp()))),
    ("pub_5e10", fx.make_offer(publicationEnd=50_000_000_000)),
    ("pub_naive", fx.make_offer(publicationEnd="2026-06-14T10:00:00")),
    ("pub_offset", fx.make_offer(publicationEnd="2026-06-14T12:00:00+02:00")),
    ("pub_frac", fx.make_offer(publicationEnd="2026-06-14T10:00:00.123456Z")),
    ("unknown_field", fx.make_offer(unexpectedField={"x": 1})),
    ("finish_null", fx.make_offer(parts=[fx.make_part(finish=None)])),
    ("minimal", {"id": 1, "code": "HJO-1", "parts": []}),
    ("id_string", fx.make_offer(id="684001")),
    ("qty_string", fx.make_offer(parts=[fx.make_part(quantity="3")])),
    ("qty_float_int", fx.make_offer(parts=[fx.make_part(quantity=3.0)])),
    ("qty_float_frac", fx.make_offer(parts=[fx.make_part(quantity=3.5)])),
    ("tag_id_string", fx.make_offer(parts=[fx.make_part(tags=[{"id": "14", "name": "Milling", "context": "production_methods"}])])),
    ("tag_no_context", fx.make_offer(parts=[fx.make_part(tags=[{"id": 14, "name": "Milling"}])])),
    ("tag_context_null", fx.make_offer(parts=[fx.make_part(tags=[{"id": 14, "name": "Milling", "context": None}])])),
    ("is_urgent_null", fx.make_offer(isUrgent=None)),
    ("mpn_null", fx.make_offer(parts=[fx.make_part(measurementProtocolNeeded=None)])),
    ("tags_null", fx.make_offer(parts=[fx.make_part(tags=None)])),
    ("code_missing", {k: v for k, v in base.items() if k != "code"}),
    ("weight_string", fx.make_offer(parts=[fx.make_part(weightKg="1.25")])),
    ("file_id_null", fx.make_offer(parts=[fx.make_part(files=[{"id": None, "name": "a.step", "downloadUrl": None}])])),
]
for name, p in variants:
    def dump(q: dict[str, Any] = p) -> Any:
        o = JobOffer.model_validate(copy.deepcopy(q))
        return o.model_dump(mode="json", by_alias=False)
    jo.append({"name": name, "input": p, "result": err_or(dump)})
out["job_offer"] = jo

pages = []
for name, node in [
    ("one", fx.gql_page([fx.make_offer()])["data"]["gshJobOffers"]),
    ("has_more", fx.gql_page([fx.make_offer("A"), fx.make_offer("B")], has_more=True)["data"]["gshJobOffers"]),
    ("bad_offer_in_page", fx.gql_page([fx.make_offer("A"), fx.make_offer("B", isUrgent=None)])["data"]["gshJobOffers"]),
    ("no_metadata", {"offers": []}),
    ("metadata_hasmore_null", {"metadata": {"hasMore": None}, "offers": []}),
]:
    pages.append({"name": name, "input": node,
                  "result": err_or(lambda q=node: ScanPage.model_validate(copy.deepcopy(q)).model_dump(mode="json"))})
out["scan_page"] = pages

# ---------------------------------------------------------------- build_row + pipeline scenarios
br = []
for name in ["full_spec", "multi_part", "multi_part_dup_flags", "zero_parts", "finish_brushed", "finish_none", "grinding"]:
    p = payloads[name]
    offer = JobOffer.model_validate(copy.deepcopy(p))
    offer.raw = copy.deepcopy(p)
    row = build_row(offer, filters.extract_spec(offer))
    br.append({"name": name, "offer": p, "row": row.model_dump(mode="json")})
out["build_row"] = br


class S:
    """Minimal settings stand-in matching config.Settings fields used by run_scan."""

    def __init__(self, tmp: Path, **over: Any) -> None:
        self.borderline_exclude = frozenset()
        self.download_files = False   # the Worker never downloads (XB_DOWNLOAD_FILES=0 in the Action)
        self.files_dir = tmp / "files"
        for k, v in over.items():
            setattr(self, k, v)


def scan(store: FakeStore, offers: list[dict[str, Any]], **over: Any) -> dict[str, Any]:
    st = run_scan(store, FakeClient(copy.deepcopy(offers)), S(Path("/nonexistent/xometry-golden"), **over))  # type: ignore[arg-type]
    return {"scanned": st.scanned, "preset_rejected": st.preset_rejected, "excluded_secondary": st.excluded_secondary,
            "upserted": st.upserted, "needs_manual": st.needs_manual, "errors": st.errors}


def rows(store: FakeStore) -> dict[str, Any]:
    return {k: jd(v) for k, v in sorted(store.rows.items())}


scen = []
# S1: mixed board
st1 = FakeStore()
o1 = [fx.make_offer("HJO-CNC"), fx.make_offer("HJO-LASER", parts=[fx.make_part(tags=[fx.LASER_TAG])]),
      fx.make_offer("HJO-COATED", parts=[fx.make_part(tags=[fx.MILLING_TAG, fx.ANODIZING_TAG])]),
      fx.make_offer("HJO-PDF", parts=[fx.make_part(files=[fx.PDF_FILE])]),
      fx.make_offer("HJO-DXF", parts=[fx.make_part(files=[{"id": 3, "name": "p.dxf", "downloadUrl": "https://files.example/p.dxf"}])]),
      fx.make_offer("HJO-NOFILE", parts=[fx.make_part(files=[])])]
scen.append({"name": "S1_mixed_board", "steps": [{"offers": o1, "stats": scan(st1, o1)}], "final_rows": rows(st1)})
# S2: rescan refresh, status preserved; then terminal untouched
st2 = FakeStore()
a = scan(st2, [fx.make_offer("HJO-1")])
st2.rows["HJO-1"]["status"] = "priced"
st2.rows["HJO-1"]["suggested_price"] = 123.0
upd = fx.make_offer("HJO-1", cost={"amount": 110.0, "currency": "EUR"}, isUrgent=True,
                    parts=[fx.make_part(tags=[fx.MILLING_TAG], material="Alu 6082")])
b = scan(st2, [upd])
snap_after_refresh = rows(st2)
st2.rows["HJO-1"]["status"] = "submitted"
c = scan(st2, [fx.make_offer("HJO-1", cost={"amount": 999.0, "currency": "EUR"})])
scen.append({"name": "S2_refresh_then_terminal",
             "steps": [{"offers": [fx.make_offer("HJO-1")], "stats": a},
                       {"set": {"HJO-1": {"status": "priced", "suggested_price": 123.0}}, "offers": [upd], "stats": b,
                        "rows_after": snap_after_refresh},
                       {"set": {"HJO-1": {"status": "submitted"}}, "offers": [fx.make_offer("HJO-1", cost={"amount": 999.0, "currency": "EUR"})], "stats": c}],
             "final_rows": rows(st2)})
# S3: excluded row re-scanned without the coating -> refresh cols only (status stays excluded)
st3 = FakeStore()
x1 = [fx.make_offer("HJO-X", parts=[fx.make_part(tags=[fx.MILLING_TAG, fx.ANODIZING_TAG])])]
x2 = [fx.make_offer("HJO-X")]
scen.append({"name": "S3_excluded_then_clean",
             "steps": [{"offers": x1, "stats": scan(st3, x1)}, {"offers": x2, "stats": scan(st3, x2)}],
             "final_rows": rows(st3)})
# S4: borderline exclude flips
st4 = FakeStore()
g = [fx.make_offer("HJO-G", parts=[fx.make_part(tags=[fx.MILLING_TAG, fx.GRINDING_TAG])])]
scen.append({"name": "S4_borderline_exclude", "settings": {"borderline_exclude": ["grinding"]},
             "steps": [{"offers": g, "stats": scan(st4, g, borderline_exclude=frozenset({"grinding"}))}],
             "final_rows": rows(st4)})
# S5: skipped is terminal too
st5 = FakeStore()
scan(st5, [fx.make_offer("HJO-S")])
st5.rows["HJO-S"]["status"] = "skipped"
s5b = scan(st5, [fx.make_offer("HJO-S", cost={"amount": 5.0, "currency": "EUR"})])
scen.append({"name": "S5_skipped_terminal",
             "steps": [{"offers": [fx.make_offer("HJO-S")]}, {"set": {"HJO-S": {"status": "skipped"}},
                        "offers": [fx.make_offer("HJO-S", cost={"amount": 5.0, "currency": "EUR"})], "stats": s5b}],
             "final_rows": rows(st5)})
out["scan_scenarios"] = scen

# compute pass over priced rows
cps = []
st6 = FakeStore()
scan(st6, [fx.make_offer("HJO-1"), fx.make_offer("HJO-2", cost={"amount": 700.0, "currency": "EUR"}),
           fx.make_offer("HJO-3", cost=None), fx.make_offer("HJO-4")])
st6.update_fields("HJO-1", status="priced", buyer_price=1000.0)
st6.update_fields("HJO-2", status="priced", buyer_price=1000.0)
st6.update_fields("HJO-3", status="priced", buyer_price=500.0)
st6.update_fields("HJO-4", status="new", buyer_price=1000.0)
n = run_compute_pass(st6, today=TODAY)
cps.append({"name": "C1", "today": TODAY.isoformat(), "computed": n, "final_rows": rows(st6)})
out["compute_pass"] = cps

# ---------------------------------------------------------------- sources the vectors depend on
def source_hashes() -> dict[str, str]:
    """SHA-256 of every imported module file inside xometry-bot (xometry_bot/*, tests/*), by relative path."""
    root = Path(".").resolve()
    hashes: dict[str, str] = {}
    for name, module in sorted(sys.modules.items()):
        if not (name == "xometry_bot" or name.startswith("xometry_bot.") or name == "tests" or name.startswith("tests.")):
            continue
        file = getattr(module, "__file__", None)
        if not file:
            continue
        path = Path(file).resolve()
        if root not in path.parents:
            continue
        hashes[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return dict(sorted(hashes.items()))


out["_meta"]["sources"] = source_hashes()

json.dump(jd(out), sys.stdout, indent=1, ensure_ascii=False, sort_keys=False)
sys.stdout.write("\n")
