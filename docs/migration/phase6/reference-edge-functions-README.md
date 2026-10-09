# Edge-function reference (frozen)

Frozen copies of two Supabase Edge Functions that were never deployed and whose work moved to the `microns-ops`
Worker in Phase 5 (docs/migration/PLAN.md P5-4, P6-6). They live outside `supabase/functions/`, so no
`supabase functions deploy` picks them up.

| Folder | Ported to | Used by |
|---|---|---|
| `process-followups/` | `workers/ops/src/marketing/followups.ts` | the parity oracle of the port (`workers/ops/test/p5/marketing/repo-oracle.ts`, `repo-parity.test.ts`) |
| `process-warmup/` | `workers/ops/src/marketing/warmup.ts` | the same parity oracle |

The oracle reads `index.ts` at test time and runs it with stubbed Deno, Supabase and Resend objects, so the Worker
port is compared with the original on the same inputs. Do not edit these files: a change here changes what the
parity tests compare against. Bytes are identical to the last repository version before the move.
