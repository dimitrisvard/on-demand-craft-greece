# xometry-bot — semi-automatic counteroffer pipeline

Scans Xometry's partner job board 7×/day, filters to jobs Microns Hub can make
(CNC preset, no coating/finishing ops), prices each survivor as a buyer on
get.xometry.eu, and queues a one-click counteroffer at
`max(buyer_price × 0.80, cost × 1.15)` with a lead time of at least
**today + 10 business days**.

**A human clicks Submit.** The scanner stops at `ready`; only
`POST /submit/{code}` on the review API — triggered from the dashboard —
contacts Xometry with a counteroffer. There is no auto-accept and no
auto-commit, ever.

> Built from the live-capture spec of 11 Jun 2026. This folder is the bot that
> runs on the Hetzner box. The hub-side review page is integrated in this repo:
> `src/pages/dashboard/XometryQueuePage.tsx` (route `/dashboard/xometry`) backed
> by the `xometry-review` edge function — see `dashboard/README.md`.

## Layout

```
xometry_bot/
  config.py          # every knob: presets, regexes, pricing, env settings
  selectors.py       # ALL DOM selectors (buyer + partner form), one-file fix
  models.py          # tolerant pydantic models (money/date seams)
  filters.py         # preset match, §1C secondary-op exclusion, spec extraction
  pricing.py         # pure §6A math + submit guard (unit-tested)
  partner_client.py  # gshJobOffers scan + file download (GraphQL, httpx)
  buyer_pricer.py    # Playwright: upload → quote → match spec → Order Value
  partner_form.py    # Playwright: "Offer my price and time" form submit
  db.py              # Supabase Postgres (psycopg); terminal-status-safe upsert
  pipeline.py        # cron entry: scan → filter → dedupe → download → price → compute
  review_api.py      # FastAPI: GET /pending, POST /submit/{code}, POST /skip/{code}
schema.sql           # xometry_offers table (applied to Supabase as migration
                     # `create_xometry_offers` on project cfjrtmtaitwzggzpkhxi)
dashboard/           # original Next.js drop-in, kept as a portable reference —
                     # the live page is integrated in this repo (dashboard/README.md)
tests/               # 106 tests, no network needed
```

## Install (Hetzner box)

```bash
python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
cp .env.example .env   # fill in (gitignored)
```

Quality gates: `ruff check .` · `mypy` · `pytest` — all clean.

## Bring-up order (ship Phase 1 before wiring any Submit)

### Phase 1 — read-only scanner (run this first)

1. Log into partner.xometry.eu in your browser; copy `localStorage.authToken`
   into `XB_PARTNER_AUTH_TOKEN` (and/or the session cookie into
   `XB_PARTNER_COOKIE`). MFA can't be scripted — this is the one manual step.
2. `python -m xometry_bot.pipeline` — scans, filters to the **milonk** preset,
   stores excluded-coating rows, downloads CAD files, upserts to Supabase.
3. Check `/dashboard/xometry` on the dashboard: rows must match what you see with the
   milonk filter on the board; every row has the right `HJO-…` code; re-running
   adds no duplicates.
4. Install the cron: `crontab.example`.

### Phase 2 — buyer pricing (gated until you confirm one selector)

1. `python -m xometry_bot.buyer_pricer login` — log into get.xometry.eu once
   (persistent profile keeps the session warm).
2. `python -m xometry_bot.buyer_pricer probe path/to/a.step` — runs one real
   instant quote headed and prints every candidate "Order Value / excl. VAT /
   Threads" node. Pin `BUYER_ORDER_VALUE_*` and the qty/material/tolerance/Ra
   control selectors in `selectors.py`.
3. Set `XB_BUYER_SELECTORS_CONFIRMED=1` and `XB_ENABLE_BUYER_PRICING=1`.
4. Acceptance: for a known STEP, the stored `buyer_price` matches what the
   Xometry UI shows for the same qty/material.

### Phase 3 — submit (human-gated)

1. `python -m xometry_bot.partner_form login` — warm the partner profile.
2. Run the review API: `python -m xometry_bot.review_api` (binds 127.0.0.1:8077;
   front it with TLS or keep it on a private network).
3. Configure the edge-function secrets (see `dashboard/README.md`) and submit ONE real
   counteroffer; verify it in "My Responses" with the right price and a
   ≥10-business-day date; the row flips to `submitted` and can't be re-sent.

## One-time TODO(confirm) checklist (§8.3)

| Item | How it resolves |
| --- | --- |
| Money field names (`amount/currency` vs `value/currencyCode`) | Auto: the client retries with the alt fragment and logs `TODO(confirm) resolved: money fields = …` on the first scan |
| Partner auth header (bearer vs cookie) | Auto: configure one or both; the first scan succeeds or fails loudly |
| "Order Value excl. VAT" node + quote-config controls | `buyer_pricer probe` on one STEP file, then update `selectors.py` |
| Urgent-tab filter enum | Read one DevTools request on the Urgent tab → `config.URGENT_FILTER_ENUM`, flip `SCAN_URGENT_TAB` |
| Partner form date format / decimal separator | First live submit; the form drive fails loudly (with screenshot) if the date doesn't register |
| Counteroffer GraphQL mutation (optional, faster path) | Capture once from DevTools while submitting; implement `PartnerClient.submit_counteroffer` behind the same `Submitter` interface |
| `exclusive` (race) field on offers | Not in the captured query; column exists, left null until confirmed |

## Guardrails (hard requirements, §7)

- **No autonomous sending** — pipeline stops at `ready`; only a human dashboard
  click reaches Xometry, one offer per click.
- **Idempotent** — dedupe by `code` at the SQL level; `submitted`/`skipped` are
  terminal; a transient `submitting` status makes double-clicks impossible.
- **Fail loud** — auth expiry, analysis failure, selector miss, implausible
  price (`buyer_price <= 0`, suggested > buyer, buyer/partner ratio outside
  0.8–5.0) all flag the row (+ screenshot) instead of guessing. A failed submit
  parks the row in `error` and is never auto-retried (the form may have
  half-submitted — check "My Responses" first).
- **Guarded submit** — refused if price < `allowCounterofferFrom`, price <
  cost × 1.15, or lead time < today + 10 business days.
- **Cadence** — 7×/day 09:00–21:00, one scan at a time (lockfile), single
  location, gentle pagination.
- **Audit** — full offer JSON in `raw`, `buyer_quote_id`, final price/lead
  time, `submitted_at`, and a submit screenshot per counteroffer.

## Operator knobs

- `ACTIVE_PRESETS` = `("milonk",)` — CNC only; the Laser preset is documented
  in `config.py` but off (§8.1).
- `XB_BORDERLINE_EXCLUDE` — flip grinding / heat treatment / case harden /
  marking from "keep + flag" to "exclude".
- `pricing.estimate_cost()` — hook for the Microns Hub quote engine (§8.2);
  v1 returns None so the floor falls back to Xometry's own partner cost.
- Multi-part offers are kept and flagged `multi_part`; the pricer quotes the
  first STEP file, so review those rows before trusting the price.
