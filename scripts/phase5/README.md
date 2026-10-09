# Phase 5 owner scripts

SQL and tools for the Phase 5 switch-over (PLAN.md P5-8, P5-9) and the 7-day output-parity window. Contract: `docs/migration/specs/PHASE5_SPEC.md` §6.8 (rules), §10.2 (runbook), §10.3 (window), §12 (exit gate). Nothing here runs on its own: every file is run by the owner, by hand, at the step the runbook names. Build status, gate status and the owner checklist in order: `docs/migration/PLAN.md` §5.5.

| File | What | Writes? |
|---|---|---|
| `flag-values.sql` | One template `UPDATE feature_flags SET value = value \|\| '<json>'::jsonb …` per switch-over step (S1-S8), with the enable and rollback lines next to each; `<RECIPIENT>` is the only placeholder (the digest address, never committed) | yes, `feature_flags.value` of the default tenant; never `enabled` |
| `parity.sql` | Read-only queries Q1-Q13 for the window: articles and translation lag (Q1-Q3), sitemap (Q4), leads and tenders (Q5-Q7), run rows per agent with a time limit per agent (Q8), old schedulers (Q9), the article queue (Q10), IndexNow (Q11), the digest spot check (Q12, Q12b: every figure of the Monday e-mail), Xometry slots (Q13) | no |
| `compare-sitemap.mjs` | Byte and URL-set comparison of two sitemap files (S4 shadow day); owned by the content unit | no (local files only) |

The pg_cron switch itself is in `supabase/migrations/*_deactivate_ported_crons.sql` (per step, reversible) and `supabase/migrations/*_unschedule_ported_crons.sql` (after the signed gate). Both change nothing unless their session settings are made first in the same SQL-editor run.

## Switch-over, step by step (one step at a time, at least 24 h apart)

| Step | Old scheduler | Order inside the step | Rollback |
|---|---|---|---|
| S1 | pg_cron `hn-collector` | `flag-values.sql` S1, enable `agent.growth.hn`; after the first succeeded `growth.hn:*` run: `SET microns.p5_step = 'S1'; SET microns.p5_action = 'deactivate';` + the deactivate file | flag off; same SET with `'reactivate'` + the deactivate file |
| S2 | `reddit-tier1/2/3` | as S1 with `agent.growth.reddit` and `'S2'` | as S1 |
| S3 | `tender-scan-daily` | the day before: re-measure tenders per day and connector scans (Q5, Q6) to pick the baseline; before 06:00: deactivate `'S3'`; then `flag-values.sql` S3 (a) with the canary countries, or (b) when tenders were already flowing; after 24 h of the canary, (b) | flag off; reactivate `'S3'` |
| S4 | `auto-update-sitemap` | the day before: S4 (a) (shadow, sitemap only) and enable `agent.content_daily`; after 09:05 compare `phase5-shadow/sitemaps/<date>/sitemap-complete.xml` with the Storage object (`node scripts/phase5/compare-sitemap.mjs <a> <b>`); then deactivate `'S4'` and S4 (b) | flag off; reactivate `'S4'` |
| S5 | `enqueue-daily-article`, `process-article-queue`, `auto-translate-daily-articles`, `auto-fix-article-links` | day D after 09:05: deactivate `'S5'`; the same evening `flag-values.sql` S5; the first Worker run is D+1 07:00. Never both chains on one day | before 06:55: flag off; reactivate `'S5'` |
| S6 | — | marketing route (Worker vars, no flag): owner test campaign to two owner-controlled addresses | `OUTBOUND_MAIL_PAUSED = "true"` (dashboard falls back); incident stop `OUTBOUND_MAIL_STOPPED = "true"` |
| S7 | — | `flag-values.sql` S7 with the recipient, enable `agent.ops_digest` | flag off |
| S8 | GitHub Action schedule | S8 (a) for one day, then S8 (b) and the repository variable `XOMETRY_SCAN_SCHEDULE = off` | flag off; delete the variable |
| S9 | VPS | CAD Container: gate procedure and preview checks, then the Supabase secret `UNFOLD_SERVICE_URL`, then `CAD_BACKEND_DEFAULT = "container"` | the previous secret value; `CAD_BACKEND_DEFAULT = "vps"` |

Record each step's first Worker run time: it is `<S_SWITCH_UTC>` in `parity.sql` (S1-S5), and the first Xometry slot after S8 is `<S8_SWITCH_UTC>`.

From S4 on, the sitemap run refuses to upload a sitemap with more than 5 % fewer URLs than the last uploaded one and sends a text alert. After an intended unpublish of that size, run the commented `sitemap_accept_drop_on` template of `flag-values.sql` with the day of the blocked run: the next run uploads once and becomes the new reference; a second drop is blocked again.

## During the window

- Daily for 7 days after S5: run `parity.sql` with the placeholders replaced (one query at a time; each states its pass rule in the header), or read the Monday digest. After S8 also Q13.
- Every Monday: compare the digest e-mail with Q12b, section by section. The digest sent on Monday M reports the ISO week before M; Q12b reads the same window, so on the day of the e-mail the figures are equal row for row (rows marked "now" are point in time).
- The gate (PHASE5_SPEC §12) is signed when Q1-Q11 pass for 7 consecutive days after S5. Then `SET microns.p5_gate = 'signed';` + the unschedule file (P5-9). After unscheduling, a rollback needs a new `cron.schedule(...)` per job with a credential issued at P6-1.

## Tests

```sh
npm --prefix supabase/tests/phase5 ci
npm --prefix supabase/tests/phase5 test
```

On PGlite (Postgres 18 and 16), no network: the two switch-over files against a pg_cron stand-in, every `parity.sql` statement against the Phase 4 schema plus stand-ins of the live tables (Q12b against hand-computed figures that the Worker's digest code is tested with too), and every `flag-values.sql` template against the migration's flag rows. Details: `supabase/tests/phase5/README.md`.

Status (2026-10-09, local): 138 assertions pass on both engines. Nothing here has been run against the live database.

## Literal-scan exceptions

Reviewed hits of the Phase 5 literal scan (PHASE5_SPEC §7.2). A scan skips a hit only when its file, its line number and the SHA-256 of that line's text (first 16 hex digits, line ending removed) all match a row; any other hit is a finding.

| File:line | Line SHA-256 | Reviewed | Why it is not a credential |
|---|---|---|---|
| `supabase/functions/gsc-index-url/index.ts:31` | `637cc5ed812ec28f` | 2026-10-09 | The PEM header marker is the pattern of a `.replace()` call that strips it from a key read at runtime; no key material; the file equals the live function |
