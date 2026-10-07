# microns-mail

Email Worker of `rfq.micronshub.eu` (Phase 4 of the Cloudflare migration, docs/migration/PLAN.md §5.4, task P4-4). Email Routing rules for `rfq@` and `replies@` deliver every message to its `email()` handler. It stores the raw message in R2, writes the `inbound_emails` row and hands the mail to `microns-ops` over the service binding `OPS` (named entrypoint `MailIngest`). It never parses the body: the intake Workflow in `microns-ops` does that.

## Handler steps (`src/index.ts`)

| # | Step | Rule | On failure |
|---|---|---|---|
| M0 | check-rcpt | the envelope recipient, lower-cased, must be in `ALLOWED_RCPT`; its local part names the mailbox (`rfq`, `replies`) | `setReject('Unknown recipient')` |
| M1 | buffer | `new Response(message.raw).arrayBuffer()`, read once (at most 25 MiB by the routing limit) | M7 |
| M2 | hash | `message_id_sha256` = SHA-256 hex of the trimmed `Message-ID` (brackets and case kept); without the header, of the raw bytes | — |
| M3 | store-raw | R2 `email/<sha>/raw.eml`, `message/rfc822`, SHA-256 checked by R2; a redelivery of the same bytes writes nothing; other bytes replace the object only while no `inbound_emails` row exists for the hash, else the handler logs `duplicate_mismatch` and stops (src/store.ts); 3 attempts (200 ms, 800 ms) | M7 |
| M4 | insert-row | `POST /rest/v1/inbound_emails?on_conflict=tenant_id,message_id_sha256` with `Prefer: resolution=ignore-duplicates,return=representation`; fields from the headers and the envelope only; an empty answer is a redelivery and the handler stops; network, 408, 429 and 5xx retried twice | M7 |
| M5 | hand-over | `rfq` → `OPS.startIntake`, `replies` → `OPS.ingestReply`, ids only; an error is logged and ignored (the 10-minute dispatcher of ops starts rows left `received` after 15 minutes) | — |
| M6 | shadow-copy | when `MAIL_COPY_TO` is set: `forward()` with `X-Microns-Inbound: <first 16 hex of the sha>` | logged |
| M7 | fallback | only after M1, M3 or M4 failed (or missing configuration): `forward(MAIL_FALLBACK_TO)` when set, else `setReject('Temporary processing error, please resend later')` so the sender retries | — |

Row fields (M4): `tenant_id` (`AGENT_TENANT_ID`), `message_id` (the trimmed header, else the hash), `message_id_sha256`, `mailbox`, `source` `email_routing`, `from_email` and `from_name` (header `From` with RFC 2047 words decoded, else the envelope sender), `to_email` (envelope recipient), `subject` (decoded, at most 998 characters), `in_reply_to`, `references_ids` (at most 100 `<…>` ids), `received_at`, `raw_r2_key`, `raw_size_bytes`, `auth_results`, `status` `received`.

`auth_results` comes from the `Authentication-Results` instances of the raw header block, top to bottom, through the module this Worker shares with ops (`workers/ops/src/mail-in/auth-results.ts`): only an instance whose authserv-id equals the pinned value of the receiving infrastructure is trusted, and until that value is pinned (owner step OW-9) every verdict reads `none`, so every message goes to a human in the intake.

Log line, one per mail: `[microns-mail] mail <mailbox> <first 16 hex of the sha> <outcome> <ms>`. Outcomes: `rejected_rcpt`, `duplicate`, `duplicate_mismatch`, `started`, `exists`, `flag_off`, `queued`, `rejected`, `handover_failed`, `fallback_forwarded`, `fallback_rejected`, with `+copy` or `+copy_failed` after a shadow copy. Never an address, a subject or a full hash.

## Configuration (`wrangler.jsonc`)

| Name | Kind | Value |
|---|---|---|
| `PRIVATE_FILES` | R2 | `microns-private`, jurisdiction `eu` |
| `OPS` | service binding | `microns-ops`, entrypoint `MailIngest` |
| `ALLOWED_RCPT` | var | `rfq@rfq.micronshub.eu,replies@rfq.micronshub.eu` |
| `SUPABASE_URL`, `AGENT_TENANT_ID` | var | project URL; default tenant |
| `SUPABASE_SERVICE_ROLE_KEY` | secret (required) | `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` in this folder |
| `MAIL_COPY_TO`, `MAIL_FALLBACK_TO` | secret (optional) | verified Email Routing destination addresses, kept as secrets so no address sits in this public repository |

`workers_dev` and `preview_urls` are off and there are no routes. Configuration is checked per mail: a missing name sends that mail to M7, never fails the Worker.

## Run and test

| Command (in `workers/mail`) | What |
|---|---|
| `npm ci` | toolchain only (wrangler, vitest, TypeScript, workers-types); no runtime dependency |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | T1 (vitest in Node): header helpers, recipient check, hashes, R2 and PostgREST retries, fallback, duplicate stop, ignored RPC failure, shadow copy, log lines |
| `npm run build:dry` | `wrangler deploy --dry-run` with a metafile, then `scripts/check-bundle.mjs`: no npm package in the bundle (no `postal-mime`, no `@anthropic-ai/sdk`), inputs only from this package, `workers/shared/src` and the shared authentication-results module; size printed |
| `npm --prefix workers/ops run test:integration:agents -- test/t2/mail.t2.ts` | T2 (real workerd): mail injected through the Local Explorer into this Worker as a secondary Worker of the harness |

## Owner order

1. Deploy `microns-ops` first (it exports `MailIngest`), then this Worker (`.github/workflows/cf-mail.yml`, input `deploy: true`).
2. Set `SUPABASE_SERVICE_ROLE_KEY`, and `MAIL_COPY_TO` / `MAIL_FALLBACK_TO` once their addresses are verified destinations.
3. Email Routing on `rfq.micronshub.eu`: literal rules `rfq@` and `replies@` → Worker `microns-mail`; send one test mail; the stored `Authentication-Results` then gives the authserv-id to pin.
4. R2 lifecycle rule on `microns-private`, prefix `email/`: delete after 90 days.
