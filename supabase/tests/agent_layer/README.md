# Agent layer SQL tests

Tests for the Phase 4 data layer (PLAN.md P4-1, P4-2; contract: `docs/migration/specs/PHASE4_SPEC.md` §4.13):

| File | What |
|---|---|
| `supabase/migrations/*_agent_layer.sql` | The migration (today `20261005_agent_layer.sql`, named after its build day; the owner applies it in the SQL editor, PLAN.md §5.4 OW-6): 7 tables, 6 columns on `rfqs` / `rfq_files`, the staff helper `has_staff_role()`, the guard trigger `agent_columns_guard`, 14 service-role RPCs, 13 seeded flags, amendments AM-1…AM-5 |
| `supabase/rollback/*_agent_layer_down.sql` | Full removal (kept outside `migrations/` so that no migration tool runs it) |

The runner finds both files by name pattern and stops with exit code 1 unless each pattern matches exactly one file.

## Run

```sh
npm --prefix supabase/tests/agent_layer ci
npm --prefix supabase/tests/agent_layer test            # PGlite 0.5.8  = Postgres 18.3
npm --prefix supabase/tests/agent_layer run test:pg16   # PGlite 0.2.17 = Postgres 16.4
npm --prefix supabase/tests/agent_layer run test:rpc-parity   # SQL functions vs the in-memory RPCs of the Worker tests
```

Node 22 or later; no network and no database server needed (PGlite runs Postgres in WebAssembly, about 20 s per run). `node test.mjs --engine=pg` with `PG_URL` runs the same assertions on a Postgres server: it creates and drops a temporary database there, so point it only at a disposable local server, never at the Supabase project. Exit code 0 means every assertion passed; failures are listed by name.

## Files

| File | What |
|---|---|
| `live_min.sql` | Minimal recreation of the objects the migration touches: Supabase roles and default privileges, `auth.uid()`/`jwt()`/`role()`, the referenced tables with their columns, defaults and constraints, the functions `is_staff`, `is_super_admin`, `my_customer_ids`, `my_rfq_ids`, `update_updated_at_column`, `fn_stock_remaining`, `create_public_rfq`, `next_po_number`, and the row policies of the tables the tests write to |
| `flags-sync.mjs` | Reference implementation of the every-minute flags-sync tick (seed → `feature_flags_sync_batch` → KV put → `feature_flags_mark_synced`) with a fake KV; a failing seed call for one row is reported (`seed_failed`) and the tick goes on; `workers/ops/src/cron/flags-sync.ts` ports it |
| `test.mjs` | The assertions (identities simulated as PostgREST does: `SET ROLE` + `request.jwt.claims`); with `--rpc-parity` the parity run below |
| `vectors/flags-sync.json` | KV mirror vectors: seed rules per KV state (including records the table's CHECKs refuse, on extra pending rows of a second tenant) and a scenario of ticks, edits, two batch/mark races (one where the older put lands after the newer rev was written and marked), a failed put and a second tenant. `test.mjs` runs them with the reference tick against the SQL functions; `workers/ops/test/flags` runs the same file with microns-ops' `flagsSyncTick` over the in-memory RPCs and over the T2 mini-PostgREST |
| `vectors/rpc.json` | RPC parity vectors: fixtures plus steps (RPC calls, inserts, updates; an update marked `compare` is compared too) run against the SQL functions and against `workers/ops/test/helpers/memory-rpc.ts`, which the Worker tests (MemoryDb) and the T2 mini-PostgREST use instead of a database |

## What the tests check

| Area | Rules |
|---|---|
| Apply | One transaction with `COMMIT;` as the last statement; a second apply aborts and changes nothing; a missing default tenant or helper function aborts before any change; the file with its final `COMMIT;` replaced by `ROLLBACK;` (the owner's dry run) leaves the catalogue unchanged |
| Access | anon: no privilege; authenticated non-staff (customer, tenant roles only, partner): no rows, no writes; staff (`user_roles` admin, sales_rep, production_manager, accountant): read only; service role: the only writer; every RPC executable by `service_role` only; the flag revision sequence not usable by clients |
| Flags | Exactly the 13 canonical keys, all off and pending; KV import rules (valid, absent, malformed: a present value that is not a flag record stays pending, and so does a record the table refuses: a JSON null or unknown mode at the top level or in `value`, a merged value over 8 KiB); the import function never raises for a KV value; an import call that fails for one row leaves that row pending while the other rows are imported and mirrored in the same tick; revision ordering; `mark_synced` refuses an outdated revision and leaves that row unsynced, so a put of an older revision that lands after a newer one is rewritten on the next tick; failed KV writes retried; tenant-prefixed keys; rows never deleted |
| Runs | `agent_run_begin` idempotent per (agent, key); approval tokens stored as SHA-256, claimable once; status, instance-id and agent formats |
| Agent columns | `source`, `inbound_email_id`, `r2_key`, `sha256` set only by the service role and definer functions; staff may create `manual` rows; the web form still works |
| Business rows | `create_email_rfq` exactly once per e-mail; one active quote workflow per RFQ; e-mail dedupe and source rules; CAD job idempotency keys; stock holds, commits and releases idempotent and atomic; retention windows |
| AM-1 | `cad_jobs.backend` accepts `inline`, `vps`, `container`, `mac_mini` or NULL, nothing else |
| AM-2 | `quote_workflows.drafts` is a JSON object of at most 64 KiB; `pdf_sha256` is 64 lower-case hex characters; staff read both, clients write neither |
| AM-3 | `agent_runs.parked_reason` ∈ `flag_off`, `budget`, `llm_unavailable`, `failed`, only on `waiting_human` runs; a parked run without a token is never claimed; a failure card (`failed` + token) is claimable once and the claim clears the reason; the exit-gate-4 query of PHASE4_SPEC.md §10 runs on the final schema |
| AM-4 | `create_order_from_quote` writes the rows the portal's Accept Quote writes (status, PO number, total = (part totals + shipping) × 1.24, currency explicit with EUR as fallback, delivery in 14 days, one item per part with `''`/`0` fallbacks, tenant); a second call, a second quote version or an existing portal order for the RFQ returns that order without writing |
| AM-5 | `agent_staff_for_email` returns the user id and the staff roles from `user_roles` for a case-insensitive e-mail match, and no row for customers, partners, tenant-only roles, unknown or empty addresses |
| Removal | Up + down restores the catalogue (columns, constraints, indexes, policies, functions, triggers, relations) exactly |
| RPC parity | Every step of `vectors/rpc.json` gives the same result (rows, scalar or error code and message) and leaves the same rows in the listed tables in both implementations; generated ids are compared by position, timestamps as whole minutes from the start of the run, numerics as numbers. The in-memory file is loaded by Node's TypeScript type stripping (Node 22.18 or later) |

## Not covered here

| Item | Where it is covered |
|---|---|
| Postgres 15 (the production major version) | Static review: the file uses nothing newer than Postgres 15 (`UNIQUE NULLS NOT DISTINCT` needs 15). The owner first runs the file with its final `COMMIT;` replaced by `ROLLBACK;` (PHASE4_SPEC.md §12 OW-6), then the unchanged file |
| PostgREST request handling (`on_conflict` targets, `Prefer` headers) | The mini-PostgREST stub of the T2 profile `agents` and the preview run (PHASE4_SPEC.md §6) |
| Supabase advisors | After the apply, PHASE4_SPEC.md §12 OW-6 |

## Status (2026-10-07, local)

Nothing is applied to the live database. Phase 4 exit gate as a whole: docs/migration/PLAN.md §5.4, build record.

| Command | Result |
|---|---|
| `npm --prefix supabase/tests/agent_layer test` | 572 assertions passed, 0 failed (PGlite 0.5.8, Postgres 18.3) |
| `npm --prefix supabase/tests/agent_layer run test:pg16` | 572 passed, 0 failed (PGlite 0.2.17, Postgres 16.4) |
| `npm --prefix supabase/tests/agent_layer run test:rpc-parity` | 95 passed, 0 failed |

The same RPC semantics back the Worker tests (`workers/ops/test/helpers/memory-rpc.ts`) and the mini-PostgREST of the T2 profile `agents`; the flag mirror vectors run in `workers/ops/test/flags` and `test/t2/flags.t2.ts`. After OW-6, `src/integrations/supabase/types.ts` is regenerated in a separate commit (UTF-8, 79 tables; PHASE4_SPEC.md §5.1 DB-7).
