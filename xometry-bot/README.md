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

## How it runs (serverless — no Hetzner box)

The original design assumed a Hetzner box running the scanner (cron) and the
FastAPI review API. **The default deployment is now serverless** and needs no
server:

| Piece | Where it runs | Status |
| --- | --- | --- |
| Phase 1 scan (GraphQL/HTTP, no browser) | GitHub Action `.github/workflows/xometry-scan.yml` | live once you set the secrets below |
| Queue table `xometry_offers` | Supabase (RLS on, no policies) | already migrated |
| Read / Skip / Submit | Supabase edge function `xometry-review` | deployed |
| Review page `/dashboard/xometry` | the hub SPA | deployed |
| Phase 2 buyer auto-pricing (Playwright) | needs a browser — still box/local only | optional |

The box path (`python -m xometry_bot.pipeline` on a cron + `review_api`) is still
valid — see "Box alternative" below — but you do not need it.

## Operator setup (do these to make it work)

### A. Scanner → GitHub Actions (fills the queue)

1. **Get a partner token.** Log into partner.xometry.eu, open DevTools →
   Application → Local Storage, copy `authToken`. (MFA can't be scripted — this
   is the recurring manual step; the token expires, refresh it when scans 401.)
2. **Get the DB string.** Supabase → Project Settings → Database → Connection
   string → **Session pooler** (IPv4, supports prepared statements). It looks
   like `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
3. **Add repo secrets** (GitHub → Settings → Secrets and variables → Actions):
   `XB_DB_DSN`, `XB_PARTNER_AUTH_TOKEN` (and optionally `XB_PARTNER_COOKIE`).
4. **Run it**: Actions tab → "Xometry job-board scan" → Run workflow. After it
   succeeds, open `/dashboard/xometry` — survivors of the **milonk** preset show
   up as `new` rows (Xometry's partner cost, part-file links, expiry). It then
   runs ~7×/day on the schedule. Re-runs never duplicate (dedupe on `code`).

Skip works immediately at this point — no further setup.

### B. Submit → edge function (places the counteroffer)

Submitting is the only money-moving step, so it needs one capture you must do by
hand (the counteroffer mutation is account-specific and was not captured in the
build spec):

1. On partner.xometry.eu, open a job and submit one counteroffer manually with
   DevTools → Network open. Find the GraphQL request and copy its **mutation
   string** and operation name.
2. Adapt the mutation to this exact variable signature (rename variables if the
   capture differs — the edge function always sends these four):
   ```graphql
   mutation SubmitCounteroffer($offerId: ID!, $value: Float!, $leadtime: Date!, $comment: String) {
     # ...the body you captured, using $offerId / $value / $leadtime / $comment...
   }
   ```
3. **Add Supabase secrets** (`supabase secrets set …`, or Dashboard → Edge
   Functions → Manage secrets):
   `XOMETRY_PARTNER_AUTH_TOKEN` (same token as the scanner),
   `XOMETRY_COUNTEROFFER_MUTATION` (the string above), and optionally
   `XOMETRY_COUNTEROFFER_OPERATION_NAME` / `XOMETRY_PARTNER_COOKIE`.
4. On `/dashboard/xometry`, set a price + lead time on a row and click Submit.
   The edge function enforces the §6C floors (≥ `allowCounterofferFrom`,
   ≥ cost × 1.15, lead time ≥ today + 10 business days), claims the row
   atomically (no double-submit), sends the mutation, and flips it to
   `submitted`. A failed send parks the row in `error` and is never auto-retried
   — check "My Responses" on Xometry before doing anything with it.

Until B is configured, Submit returns a clear "submit backend not configured"
error (never a silent success).

### C. (Optional) Phase 2 buyer auto-pricing — needs a browser

Auto-suggesting a price from a buyer-side instant quote uses Playwright, so it
can't run in the Action. Run it locally/on a box:

1. `pip install -r requirements.txt && playwright install chromium`
2. `python -m xometry_bot.buyer_pricer login` then
   `python -m xometry_bot.buyer_pricer probe path/to/a.step`; pin the Order Value
   + control selectors in `selectors.py`.
3. Set `XB_ENABLE_BUYER_PRICING=1` and `XB_BUYER_SELECTORS_CONFIRMED=1` and run
   `python -m xometry_bot.pipeline`. Priced rows reach `ready` with a suggested
   price; without it, you price each `new` row by hand in the dashboard.

### Box alternative (instead of A + the submit half of B)

`python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium`,
fill `.env` from `.env.example`, run `python -m xometry_bot.pipeline` on the
cron in `crontab.example`, and `python -m xometry_bot.review_api` (binds
127.0.0.1:8077). Point the edge function at it with `XOMETRY_REVIEW_API_URL` +
`XOMETRY_REVIEW_API_TOKEN` and it proxies Submit to the box's Playwright form
(no mutation capture needed). Quality gates: `ruff check .` · `mypy` · `pytest`.

## One-time TODO(confirm) checklist (§8.3)

| Item | How it resolves |
| --- | --- |
| Money field names | ✅ Resolved: live `Money` is `amount`/`amountCents`/`currencyCode`; the scan query selects `cost { amount currencyCode }` (fallback seam retired) |
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
