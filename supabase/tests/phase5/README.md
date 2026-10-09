# Phase 5 SQL tests

Tests for the two pg_cron switch-over files of Phase 5 (PLAN.md P5-8, P5-9; contract: `docs/migration/specs/PHASE5_SPEC.md` §6.8, runbook §10.2) and for the owner scripts `scripts/phase5/parity.sql` and `scripts/phase5/flag-values.sql` (§10.2, §10.3):

| File | What | When the owner runs it |
|---|---|---|
| `supabase/migrations/*_deactivate_ported_crons.sql` | Deactivates (never deletes) the pg_cron jobs that a Cloudflare job replaces, one switch-over step at a time, or reactivates them for a rollback. Jobs are addressed by name and each job's target path is checked before any change | Each step S1-S5, in the SQL editor, after `SET microns.p5_step = '<S>'; SET microns.p5_action = 'deactivate';` (or `'reactivate'`) in the same run |
| `supabase/migrations/*_unschedule_ported_crons.sql` | Removes the ten ported jobs once the Phase 5 gate is signed; a job that is still active is left alone | Once, after `SET microns.p5_gate = 'signed';` (OW5-17) |

Both files change nothing without their session settings, so applying them by mistake (or through a migration tool) is a no-op; each file resets its own settings at the end. The date in the file names is the day the files were built; neither file is applied by a builder.

## Run

```sh
npm --prefix supabase/tests/phase5 ci
npm --prefix supabase/tests/phase5 test              # both engines
npm --prefix supabase/tests/phase5 run test:pg18     # PGlite 0.5.8  = Postgres 18
npm --prefix supabase/tests/phase5 run test:pg16     # PGlite 0.2.17 = Postgres 16
```

Status (2026-10-09, local): 138 assertions pass on PGlite 18.3 and 16.4.

Node 22 or later; no network and no database server (PGlite runs Postgres in WebAssembly, about 10 s for both files on both engines). The pins are the ones of `supabase/tests/agent_layer`. Exit code 0 means every assertion passed on every engine; failures are listed by name. The runner finds each SQL file by its name suffix and stops with exit code 1 unless exactly one file matches, so renaming a file to its application date needs no change here.

## Files

| File | What |
|---|---|
| `mock_cron.sql` | Stand-in for the pg_cron 1.6 objects the files use: `cron.job` (with `jobname` of type `name`), `cron.job_run_details`, `cron.alter_job(job_id bigint, schedule, command, database, username, active)` and both `cron.unschedule` overloads (by id and by name), plus a call log so the tests see which function and overload ran |
| `cron-switch.test.mjs` | Seeds the ten ported jobs with the live ids, names, schedules and command shapes (token values assembled at runtime) and three jobs the files must never touch, then runs the files as the SQL editor does (one session) |
| `parity_schema.sql` | Stand-ins (live column names and types) for the tables `parity.sql` and the ops digest read that neither `supabase/tests/agent_layer/live_min.sql` nor the agent-layer migration creates: articles, article_titles, article_generation_queue, leads, tenders, tender_connectors, monitored_subreddits, gsc_monitored_urls, marketing_events, storage.objects |
| `vectors/digest.json` | Rows of one reported week (with rows on and just outside both window edges) and every digest figure computed by hand. `scripts.test.mjs` runs `parity.sql` Q12b over them; `workers/ops/test/p5/digest` runs the Worker's digest code (`src/digest/*.ts`) over the same rows, so the Monday e-mail and the owner's SQL spot check are proven to agree |
| `scripts.test.mjs` | Builds the schema (live_min.sql + the agent-layer migration + mock_cron.sql + parity_schema.sql), seeds the vectors, runs every `parity.sql` statement with the placeholders filled in and `now()` fixed, then applies every `flag-values.sql` template |

## What the tests check

| Case | Rule |
|---|---|
| No settings | No change, no pg_cron call, a notice says nothing changed |
| `S1` | Only `hn-collector` deactivated through one `cron.alter_job(…, active := false)`; the check query lists the ten jobs without their command; the settings are reset afterwards |
| `'S2, S5'` | Comma list with spaces; seven jobs deactivated; a repeated step makes no call |
| Reactivate | The rollback of a step re-activates exactly its jobs; an active job gets no call |
| Re-run after `RESET` | The file run again without new settings is a no-op |
| Changed target | A job whose command no longer contains its target path is skipped with a warning and keeps its state |
| Missing job, unknown action or step | Reported or ignored; nothing else changes |
| Unschedule without the gate | No change (also for a gate value other than `signed`); the gate is reset |
| Unschedule with the gate | Only inactive ported jobs are removed (by name), active ported jobs stay with a warning, every other job stays, including an inactive one and one with a similar name; the token check query counts what is left |
| Static | Neither SQL file, the mock nor the test holds a credential-shaped literal; no notice or warning ever prints a command or token |
| `parity.sql` | The blocks the spec gives verbatim (Q1-Q10 with Q2b, Q12, Q13) equal its text after removing comments and collapsing whitespace (SHA-256 pins), so a pass rule cannot change without a spec change; Q1-Q13 are all reads and all run on both engines; Q12 and Q12b equal the hand-computed figures (queue final failures: failed runs with trigger `queue`, and failed `growth.hn`, `growth.reddit` and `growth.xometry` runs, which the scrapes consumer closes); Q4 counts published rows + 252; Q8 applies the limit per agent (a `content_daily` row running 9 h is stuck, 7 h is not; `growth.hn` 2 h is stuck; `marketing.send` 30 h is not); Q11 counts `indexnow` true, `'not_configured'` and all translations (the analysis' boolean cast fails on `'not_configured'`, which the test shows); Q13 lists the slots after the switch, gives the current slot 5 minutes and joins the runs by key |
| `flag-values.sql` | Ten templates and one check query; each template updates exactly the one default-tenant row and only `value`; the value after each template in runbook order (S4 (a) and S8 (a) stay `shadow`) and the final values per flag; the digest template never returns the recipient; a mistyped mode is refused by the table. The commented `sitemap_accept_drop_on` template runs on its own on both engines and must set the key that the sitemap Workflow reads and its alert names |
