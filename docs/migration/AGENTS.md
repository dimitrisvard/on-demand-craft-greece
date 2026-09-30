# Microns Hub agent layer: designs

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [README.md](README.md) · [PLAN.md](PLAN.md) · [INVENTORY.md](INVENTORY.md) · [inventory.csv](inventory.csv) · [ARCHITECTURE.md](ARCHITECTURE.md) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [SEO_PARITY.md](SEO_PARITY.md) · [RISKS.md](RISKS.md) · [COSTS.md](COSTS.md)

This document expands brief §4 (and brief §7 item 6) into buildable designs: for each of the seven agents the purpose, trigger, inputs, outputs, Workflow steps, LLM calls, failure handling, idempotency key, cost per run, human view, feature flag, rollout and success metric. It also fixes the common framework (run records, AI Gateway metadata, flags, approvals, retention, evaluation, prompt versions), the Supabase schema sketch, the CAD backend contract, the stock reservation protocol and reply attribution. Task IDs (P4-n, P5-n) refer to [PLAN.md](PLAN.md); questions are cited as "PLAN.md Q<n>".

## 1. Scope, load and ground rules

### 1.1 The seven agents

| # | Agent | Runs as | Trigger | Flag | Phase (tasks) |
|---|---|---|---|---|---|
| 1 | Inbound RFQ e-mail | `microns-mail` → Workflow `rfq-intake` (`RfqIntakeWorkflow`) + DO `RfqThread` | mail to `rfq@rfq.micronshub.eu` (and forwarded Techpilot notifications, PLAN.md Q3) | `agent.rfq_intake` | 4 (P4-4, P4-5) |
| 2 | Quote | Workflow `quote` (`QuoteWorkflow`), Queue `cad-jobs`, DO `CadRouter`, Vectorize `quotes-v1` | end of `rfq-intake`, or "Start quote" on the dashboard | `agent.quote` | 4 (P4-6, P4-7, P4-8) |
| 3 | Post-order handoff | Workflow `post-order` (`PostOrderWorkflow`) + DO `MaterialStock` | new `orders` row | `agent.post_order` | 4 (P4-9) |
| 4 | Growth agents | Cron Triggers + Queue `scrapes`; Browser Rendering `BROWSER` | Cron schedules of wrangler.jsonc.draft (reddit, hn, tenders, xometry); scrapers on demand | `agent.growth.reddit`, `agent.growth.hn`, `agent.growth.tenders`, `agent.growth.scrapers`, `agent.growth.xometry` | 4 (scrapers, P4-10); 5 (P5-3, P5-5) |
| 5 | Content pipeline | Workflows `content-daily` (`ContentDailyWorkflow`) and `sitemap` (`SitemapWorkflow`), Queue `translations` | Cron 07:00 UTC | `agent.content_daily` | 5 (P5-2) |
| 6 | Ops digest | Workflow `ops-digest` (`OpsDigestWorkflow`) | Cron Monday 06:30 UTC | `agent.ops_digest` | 5 (P5-7) |
| 7 | Remote MCP | DO `MicronsMcp` in `microns-ops` on `mcp.micronshub.eu` | MCP client (Claude on desktop or mobile) | `mcp.remote` | 4 (P4-11) |

### 1.2 Design load

| Fact | Value | Source |
|---|---|---|
| RFQs in the database | 2 | live 2026-09-30 |
| Orders | 2 | live 2026-09-30 |
| Customers | 21 | live 2026-09-30 |
| RFQ rows ever inserted | 34 (27 deleted) | supabase/migrations/20260806_phase2_rls_per_user.sql:10-11 |
| Google Workspace sender accounts | 2 | live 2026-09-30 |
| Articles published per day | 1 English master + 13 translations | supabase/functions/auto-translate-articles/index.ts:18-33 |

Consequence: design for tens of runs per day, cost per run in cents, no throughput engineering. The planning load used for monthly figures (§8) is 10 inbound RFQ e-mails, 5 quote versions and 1 order per day, which is well above today's volume.

### 1.3 Ground rules

| Rule | Detail |
|---|---|
| System of record | Supabase stays the system of record for Phases 0–6 (PLAN.md §1 item 11). Agents write with the service role from `microns-ops` or `microns-mail` only; the browser never writes agent tables. |
| Human in the loop | In Phase 4 every customer-facing or partner-facing send needs a human approval (Telegram or dashboard). Automation is widened per agent through the flag's `mode` (§2.3), never by code change. |
| LLM authority | An LLM never sets a price alone, never sends mail, never calls tools that write. LLM output is JSON validated against a schema; code decides. |
| Outcome records | Every run writes an `agent_runs` row with outcome and cost (PLAN.md Phase 4 exit gate item 4; H-29: pg_cron status is not an outcome). |
| Prerequisite H-5 | An authorisation gap in tenant-role assignment must be closed before the agent layer trusts tenant roles. Details: private security note. Until P6-2 closes it, the agent layer authorises staff through Access and the `user_roles` staff roles only, never through a tenant role (PLAN.md §5.4 goal). |
| New write paths | The agent endpoints (`/api/agent/*`, MCP, CAD callbacks) are authenticated from their first deploy (Supabase JWT, Access or a signed call) and rate-limited, in line with the Phase 2 gates for H-6. Details: private security note. |
| Phase 7 note | If the optional Phase 7 proceeds, the agent tables of §7 move to D1 `microns-db` with the rest of the schema, and their staff-read policies become rules of the `microns-ops` data-access layer (PLAN.md P7-1, P7-2). |

## 2. Common framework

### 2.1 Run record (`agent_runs`)

| Field group | Content |
|---|---|
| Identity | `agent` (flag key without the `agent.` prefix, e.g. `rfq_intake`, `quote`, `growth.reddit`; `mcp` for the remote MCP), `trigger` (`email`, `cron`, `queue`, `workflow`, `dashboard`, `telegram`, `mcp`, `manual`), `idempotency_key` (unique per agent) |
| Links | `workflow_name`, `workflow_instance_id`, `parent_run_id`, `subject_type` + `subject_id` (e.g. `rfq`, `quote_workflow`, `order`, `article`) |
| Outcome | `status` (`running`, `waiting_human`, `succeeded`, `failed`, `cancelled`, `skipped`), `error`, `output` (small JSON summary, no raw e-mail text) |
| Cost | `llm_calls`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `cost_cents` (USD cents: LLM usage from each response × the price table of §2.10, plus the Cloudflare estimate of the step) |
| Human | `approval_token` (single-use, §2.4), `human_action` (JSON: channel, actor, verb, decided_at), `prompt_version` |

Lifecycle: the first step of every Workflow (or the Cron/Queue handler) inserts the row with `ON CONFLICT (agent, idempotency_key) DO NOTHING`; a conflict means the run already exists and the handler exits or resumes it. The last step sets `status` and `finished_at`. Analytics Engine `microns_events` receives one data point per run and per LLM call for dashboards (P4-13).

### 2.2 AI Gateway routes and metadata

All LLM calls go through AI Gateway `microns` (P4-3). Routes are roles, not model IDs; models are chosen at Phase 4/5 start.

| Route | Provider and model class | Used for |
|---|---|---|
| `extract` | Anthropic, current Sonnet-class model (e.g. `claude-sonnet-5-5` at time of writing) | RFQ parsing, quote notes and cover e-mails, traveller summaries, article generation, digest narrative |
| `classify` | Anthropic, current Haiku-class model (e.g. `claude-haiku-4-5`) | spam and intent triage, CNC vs sheet-metal classification, reply classification, lead relevance |
| `translate` | Google AI Studio, current Gemini Flash-class model | article translation (the repo's Gemini model IDs are retired, H-19) |
| `embed` | Workers AI `@cf/baai/bge-m3` (1,024 dimensions, index `quotes-v1`, cosine) | RAG over past quotes, tender relevance |

Every call carries header `cf-aig-metadata` with at most five flat entries (AI Gateway allows up to five, values string, number or boolean; CF docs, verified 2026-09-30):

```json
{"agent": "quote", "run_id": "<agent_runs.id>", "tenant_id": "<tenants.id>", "step": "price-notes", "prompt": "quote.price-notes@v3"}
```

The first three keys are the ones every document uses (P4-3, [ARCHITECTURE.md](ARCHITECTURE.md)); `step` and `prompt` use the two remaining entries. Gateway logs are filtered by these keys to reconcile `agent_runs.cost_cents` with provider billing. Budget and rate limits on the gateway follow PLAN.md Q20 (proposal: €50/month hard cap, alerts at 50 % and 80 %).

Call rules: structured output (JSON schema) for every `extract` and `classify` call; stable system prompt and schema first so the provider's prompt cache applies; `max_tokens` set per step; the untrusted text (e-mail body, attachment text, web page) is passed as data inside a delimited block and never concatenated into instructions.

### 2.3 Feature flags

| Aspect | Design |
|---|---|
| Store | Table `feature_flags` (PK `key`, `tenant_id`), columns `enabled`, `value` (JSON), `description`, `updated_by`, `updated_at` (§7). Written only by `microns-ops` endpoints (service role); staff edit them on the dashboard ApprovalsPage "Agent switches" section. |
| Mirror | KV `FLAGS`. Key = flag key for the default tenant (e.g. `agent.quote`), `t:<tenant_id>:<key>` for any other tenant (unused in Phase 4). Value = JSON `{"enabled":…,"mode":…,"value":{…},"updated_at":…}`. |
| Sync | Cron `* * * * *` in `microns-ops` (P4-2) writes only rows whose `updated_at` is newer than KV key `_synced_at`; seeded from the KV values set by hand in Phases 1–3 so `seo.strict_404` and `api.forward_to_vercel` keep their state. |
| Read | One KV read per run or request. Missing key, unreadable value or KV error → default: every `agent.*` and `mcp.remote` flag is off (fail closed); `seo.strict_404` and `api.forward_to_vercel` fall back to their Phase 1–2 defaults. |
| Switch-off time | Sync ≤ 1 min plus KV propagation ≈ 1 min (CF docs, re-check at execution): new runs stop within 2 min (Phase 4 exit gate item 3). Running Workflow instances check the flag again before every side-effecting step and park in `waiting_human` if it went off. |
| Canonical keys | `seo.strict_404`, `api.forward_to_vercel`, `agent.rfq_intake`, `agent.quote`, `agent.post_order`, `agent.growth.reddit`, `agent.growth.hn`, `agent.growth.tenders`, `agent.growth.scrapers`, `agent.growth.xometry`, `agent.content_daily`, `agent.ops_digest`, `mcp.remote` |

Rollout modes (`value.mode`) used by the agent flags:

| Mode | Behaviour |
|---|---|
| `shadow` | The agent runs, records `agent_runs` and posts an informational card; it creates no business rows visible to customers and sends nothing. |
| `assist` | Business rows are created; every customer-facing or partner-facing action waits for approval. Default mode for Phase 4. |
| `auto` | Steps marked "auto-eligible" below skip the approval when confidence ≥ the threshold in `value`. Never used for price or partner sends in Phase 4. |

Other per-agent settings live in `value` (for example `min_confidence`, `max_runs_per_day`, follow-up cadence, digest recipient). Recipient addresses are data in the database, never in the repo.

### 2.4 Approval path

| # | Hop | Mechanism | Guard |
|---|---|---|---|
| 1 | Workflow step `request-*` | Generates a single-use `approval_token` (random 128 bit, base32) on the run's `agent_runs` row, sets `status = waiting_human`, posts the card with Telegram `sendMessage` and an `inline_keyboard`; `callback_data` = `ap:<token>:<verb>` (≤ 64 bytes, Telegram Bot API limit; re-check at execution) | Card holds business fields only, no e-mail body, no customer e-mail address in full |
| 2 | Owner taps a button | Telegram sends a `callback_query` to the existing bot webhook, the Supabase edge function `telegram-leads-bot` (it handles text commands only today, supabase/functions/telegram-leads-bot/index.ts:210-215); P4-12 adds callback handling on top of the live source pulled in P0-5 (H-26) | Webhook secret-token header set with `setWebhook`; callback accepted only from the private chat `TELEGRAM_CHAT_ID` |
| 3 | Bot → `microns-ops` | `POST https://www.micronshub.eu/api/agent/decision`, routed by `microns-site` over `OPS`; body `{token, verb, channel, actor, ts}`; header `X-Microns-Signature` = HMAC-SHA256 over `ts + "." + body` | Shared secret (name proposed: `AGENT_APPROVAL_SECRET`, §9); ±300 s clock window; rate limit `API_RATE_LIMIT` |
| 4 | `microns-ops` claims the token | `UPDATE agent_runs SET approval_token = NULL, human_action = … WHERE approval_token = $1 AND status = 'waiting_human' RETURNING workflow_name, workflow_instance_id, output` | A double tap or a stale card finds no row and gets "already decided" |
| 5 | `microns-ops` → Workflow | `instance.sendEvent({ type, payload })` for approve/confirm verbs; for reject verbs the business row is set to `rejected` and `instance.terminate()` is called | Event type from the table below |
| 6 | Feedback | `answerCallbackQuery`, then `editMessageReplyMarkup`: the card shows "Approved by … at …" without buttons | — |

Dashboard path: ApprovalsPage and RfqInboxPage call the same `POST /api/agent/decision` with the staff user's Supabase JWT; `microns-site` verifies the JWT (Phase 2 module `workers/site/src/auth/supabase-jwt.ts`) and requires a `user_roles` role in `admin`, `sales_rep`, `production_manager`, `accountant` (the list `is_staff()` uses, supabase/migrations/20260806_phase2_rls_per_user.sql:37); steps 4–6 are identical. Optional: an Access application on `/dashboard*` (P6-4).

Workflow events (type pattern `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`, letters, digits, `-` and `_`, up to 100 characters; events sent before the step is reached are buffered; a timed-out `waitForEvent` throws and fails the instance unless caught; CF docs, verified 2026-09-30):

| Event type | Sent by | Waited for in | Timeout |
|---|---|---|---|
| `intake-confirmed` | approval endpoint | `rfq-intake` step `wait-confirmation` | 7 d, reminder, 7 d |
| `cad-done` | `cad-jobs` consumer via `RfqThread` | `quote` step `await-cad` | 2 h |
| `quote-approved` | approval endpoint (payload may carry edited lines) | `quote` step `wait-approval` | 7 d, reminder, 7 d |
| `customer-reply` | `agent-events` consumer after reply attribution (§4) | `quote` step `follow-up-*` | 3 d, 4 d, 7 d (follow-up cadence) |
| `reply-confirmed` | approval endpoint | `quote` step `confirm-reply` | 7 d, reminder, 7 d |
| `handoff-approved` | approval endpoint | `post-order` step `wait-handoff` | 7 d, reminder, 7 d |
| `reorder-approved` | approval endpoint | `post-order` step `wait-reorder` | 7 d, reminder, 7 d |
| `translations-done` | `translations` consumer (last language) | `content-daily` step `wait-translations` | 6 h |

Human waits use a 7-day timeout (the default is 24 h, maximum 365 d; CF docs, verified 2026-09-30) inside `try/catch`: on timeout a `remind-*` step invalidates the old token, posts a reminder card with a new token, and waits 7 more days; after the second timeout the item is set to `needs_review` or `expired` and stays on the dashboard. Workflow instance IDs are deterministic, so a repeated start is a no-op: `rfq-intake-<first 32 hex of message_id_sha256>`, `quote-<rfq_id>-v<quote_version>`, `post-order-<order_id>`, `content-daily-<yyyy-mm-dd>`, `sitemap-<yyyy-mm-dd>`, `ops-digest-<yyyy>-W<ww>` (instance ID length limit: CF docs, re-check at execution).

### 2.5 Retries, dead letters and human fallback

| Layer | Policy (proposal; tuned when each consumer ships) |
|---|---|
| Workflow step | Each `step.do` sets `retries` (limit, delay, backoff) and `timeout` explicitly (CF docs, re-check at execution): LLM steps 3 retries, 30 s exponential, timeout 2 min; Supabase and R2 steps 5 retries, 10 s exponential; send steps (Resend, Telegram) 3 retries with a provider idempotency key. Non-retryable errors (schema validation failure after one re-ask, 4xx from a provider) throw `NonRetryableError`. |
| Workflow instance | A failed instance sets `agent_runs.status = failed` in a `finally`-style last step where possible and posts an "agent failed" card with a **Retry** button (ops calls `instance.restart()`, which re-runs from the start; completed side effects are skipped by idempotency keys). |
| Queues | `max_retries` per consumer and DLQ `<name>-dlq` (wrangler.jsonc.draft: `cad-jobs` 2 retries, `translations` 5, `scrapes` 3, `agent-events` 3, `outbound-mail` 3). DLQs have no consumer; the ops digest lists their backlog and a manual task re-drives them. |
| Provider outage | AI Gateway returns the provider error; the step retries; after the last retry the run parks in `waiting_human` with the card "LLM unavailable, continue manually". The business path (RFQ row, dashboard) never depends on the LLM being up. |
| Budget exhausted | Gateway limit (PLAN.md Q20) → same as outage; `max_runs_per_day` in the flag `value` stops runaway loops. |

### 2.6 Personal data and retention

| Data | Location | Retention (proposal for the owner) | Mechanism |
|---|---|---|---|
| Raw MIME of inbound mail | `microns-private` `email/<message_id_sha256>/raw.eml` | 90 days | R2 object lifecycle rule on prefix `email/` (CF docs, re-check at execution) |
| Attachments not linked to an RFQ | `email/<message_id_sha256>/att/<n>-<name>` | 90 days | same rule |
| Attachments linked to an RFQ | copied to `rfq/<rfq_id>/<file_id>-<name>` | as long as the RFQ and customer record (business record) | copy in `rfq-intake` step `copy-files` |
| `inbound_emails` rows | Supabase | 24 months; after 90 days `parsed` keeps structured fields only and the body excerpt is cleared | monthly purge in the `ops-digest` run (Phase 5; run by hand before) |
| `agent_runs` | Supabase | 13 months; `output` cleared after 90 days | same purge |
| CAD inputs and outputs | `cad/<job_id>/{input,output}/…` | with the RFQ | — |
| Quote PDFs, travellers | `quotes/<rfq_id>/v<version>/quote.pdf`, `orders/<order_id>/traveler.pdf` | business record | — |
| AI Gateway logs | Cloudflare | shortest retention the gateway offers that still covers the monthly cost reconciliation; request and response bodies not logged for `extract` calls on e-mail content if the gateway allows per-request opt-out (P4-3) | gateway settings |
| Telegram cards | Telegram | minimised content (company, RFQ number, totals, masked e-mail) | card templates |

EU residency: Supabase runs in eu-central-1 (live 2026-09-30). R2 location hints (`weur`, `eeur`, …) are best effort, not guarantees; a jurisdiction (`eu`) is a guarantee, can only be chosen when a bucket is created and cannot be changed afterwards; every Worker binding of such a bucket needs `"jurisdiction": "eu"`, and the S3 endpoint becomes `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` (CF docs, verified 2026-09-30). Recommendation: create `microns-private` with jurisdiction `eu` at P2-9 (it holds e-mails, CAD files and quotes); `microns-public` holds public content and needs only a `weur` location hint. LLM providers process the texts sent to them under their API data terms; the owner confirms the provider choice with PLAN.md Q20.

### 2.7 Untrusted input

| Input | Rule |
|---|---|
| E-mail bodies, attachment text, scraped pages, tender texts | Data only; passed in a delimited block; the model returns schema-bound JSON; no tool use in these calls; instructions found in the data are ignored and flagged (`injection_suspected` field). |
| Attachments | Stored, hashed, never executed. Parsed only as STEP, STL, DXF, PDF (text + first 5 pages as document input). ZIP archives unpacked one level with a 100 MB total cap. Everything else is kept for the human. Size cap per message: Email Routing inbound limit (example 25 MiB, CF docs verified 2026-09-27). |
| Sender identity | `From` is not authentication. SPF/DKIM/DMARC results from `Authentication-Results` are recorded in `inbound_emails.auth_results`; a failed DMARC lowers confidence and forces approval. |

### 2.8 Evaluation

| Item | Design |
|---|---|
| Golden set | 30 cases to start: the 2 live RFQs (live 2026-09-30); past RFQ e-mails and Techpilot notifications from the current mailbox (PLAN.md Q3), with the owner's final RFQ entry as ground truth; past offers such as RFQ-08052026-1 (scripts/generate_offer_pdf.py:1-3) for pricing; synthetic variants to reach ≥ 2 cases per language for the 14 languages, both processes, spam, auto-replies and multi-mail threads. Stored outside the public repo because it contains customer data; the private location (for example a dedicated prefix in `microns-private`, not yet in the ARCHITECTURE.md prefix list) is fixed at P4-5. |
| Metrics | Intake: field-level accuracy for quantity, material, thickness, deadline, contact; process classification accuracy; calibration (share of errors above the 0.7 threshold). Quote: absolute percentage error of the draft total vs the owner's final price; share of drafts approved without edits. Replies: classification accuracy. |
| Gate | A prompt or model change ships only if no metric falls more than 2 points below the current version; results stored as `agent_runs` rows with `agent = eval` and gateway metadata `step = eval`. |
| Cost | ≈ 30 × $0.05 ≈ $1.50 per full evaluation run at the §2.10 prices (list price, re-check at execution). |

### 2.9 Prompt versioning

| Aspect | Design |
|---|---|
| Files | `workers/ops/src/agents/prompts/<agent>/<step>.v<N>.md` plus the JSON schema next to it (P4 file list: `workers/ops/src/agents/*`). A prompt file is never edited after release; a change is a new `v<N+1>`. |
| Identifier | `<agent>.<step>@v<N>`, written to `agent_runs.prompt_version` and to gateway metadata `prompt`. |
| Selection | The flag `value.prompts` may pin a version per step (rollback without deploy); default = highest version in the bundle. |
| Model | Route names stay stable; a model change at the gateway is treated like a prompt change and must pass the §2.8 gate. |

### 2.10 Pricing assumptions for the cost figures (USD; [COSTS.md](COSTS.md) converts and totals them)

| Item | Unit price used | Source |
|---|---|---|
| `extract` (Sonnet-class) | $2.00 input / $10.00 output per million tokens; cached input $0.20 per million | list price — re-check at execution |
| `classify` (Haiku-class) | $1.00 / $5.00 per million tokens | list price — re-check at execution |
| `translate` (Gemini Flash-class) | assumed $0.30 / $2.50 per million tokens | assumption, not verified in this pass — re-check at execution |
| `embed` (`@cf/baai/bge-m3`) | treated as $0 at well under 1 M tokens per month | list price — re-check at execution |
| Container `standard-1` (½ vCPU, 4 GiB) | ½ × $0.000020 per vCPU-s + 4 × $0.0000025 per GiB-s = $0.00002 per running second | CF docs (verified 2026-09-27); list price — re-check at execution |
| Workflows, Queues, Durable Objects, KV, R2 operations, Vectorize, Email Routing, AI Gateway | inside the Workers Paid included usage at tens of runs per day | list price — re-check at execution; monthly totals in [COSTS.md](COSTS.md) |
| Browser Rendering | inside the Workers Paid browser-time allowance at the planned scrape volume | list price — re-check at execution |

## 3. Agent designs

### 3.1 Agent 1: inbound RFQ e-mail

| Aspect | Design |
|---|---|
| Purpose | Turn an RFQ e-mail in any of the 14 languages into a draft RFQ with parts, files and a process classification, without retyping. |
| Trigger | Email Routing on `rfq.micronshub.eu`: `rfq@` → `microns-mail` (P4-4; catch-all exists only on the apex, CF docs verified 2026-09-27). Techpilot notifications are forwarded to `rfq@` (PLAN.md Q3). `replies@` goes to reply attribution (§4), not to this agent. |
| Inputs | Raw MIME (`message.raw`), envelope sender and recipient, headers; `customers` for dedupe; flag `agent.rfq_intake`. |
| Outputs | R2 `email/<message_id_sha256>/raw.eml` and `att/<n>-<name>`; `inbound_emails` row; `customers` row when new (created by the existing RPC); `rfqs` row (status `draft`, `source` `email` or `techpilot`, `inbound_email_id`, parts in `rfqs.parts_details`); `rfq_files` rows (`source`, `r2_key`, `sha256`, `content_type`); `cad_jobs` rows + `cad-jobs` messages; Telegram card; `agent_runs` row. |
| Parts storage | Parts go into `rfqs.parts_details` (JSON) through `create_public_rfq`, the shape the web form writes and the dashboard reads (supabase/migrations/20260806_link_rfqs_to_customers.sql:42-181; src/components/quote-form/MultiStepQuoteForm.tsx:429; src/pages/RfqDetails.tsx:435-437). Table `rfq_parts` has no reader or writer in app code (grep of `src/`, `api/`, `lib/`, `supabase/functions/`), so the agent does not write it. |
| Idempotency key | RFC 5322 `Message-ID` → `message_id_sha256` (unique in `inbound_emails`); fallback when the header is missing: SHA-256 of the raw MIME. Instance ID `rfq-intake-<first 32 hex>`. RFQ creation exactly once through `create_email_rfq` (§7); files unique on (`rfq_id`, `sha256`). |
| Flag | `agent.rfq_intake` (off → `microns-mail` still stores raw MIME and the `inbound_emails` row, so nothing is lost, but no Workflow starts). |

`microns-mail` handler (not a Workflow; kept short so the Email Worker finishes quickly):

| # | Step | What |
|---|---|---|
| M1 | `check-rcpt` | Recipient must be in `ALLOWED_RCPT`; otherwise `setReject`. |
| M2 | `hash` | Read `Message-ID`; compute `message_id_sha256`. |
| M3 | `store-raw` | `PRIVATE_FILES.put('email/<sha>/raw.eml')` (same key on redelivery). |
| M4 | `insert-row` | `inbound_emails` insert `ON CONFLICT (tenant_id, message_id_sha256) DO NOTHING`; conflict → stop (duplicate delivery). |
| M5 | `start` | `OPS` service binding: create instance `rfq-intake-<sha32>` (already exists → treat as success). |

Workflow `rfq-intake` (`RfqIntakeWorkflow`):

| # | Step | What | LLM route |
|---|---|---|---|
| 1 | `load-email` | Read the row and raw MIME; parse headers, text and HTML body, attachments; strip quoted history. | — |
| 2 | `store-attachments` | Each attachment → `email/<sha>/att/<n>-<name>`; SHA-256; type sniffed from content (STEP `ISO-10303-21`, DXF `SECTION`, PDF `%PDF`, STL ASCII or binary). | — |
| 3 | `triage` | Rules first (`Auto-Submitted`, bounces, DMARC fail without attachments), then kind: `rfq`, `techpilot`, `reply`, `auto_reply`, `spam`, `other`, plus language. Non-RFQ kinds end here (`reply` is handed to §4). | `classify` |
| 4 | `thread-check` | `In-Reply-To`/`References` or an RFQ number in the subject matching an existing RFQ → `RfqThread(<rfq_id>)` appends the mail and its files to that RFQ (status `attached`) instead of creating a new one. | — |
| 5 | `extract` | Company, contact, phone, VAT ID, country, deadline (ISO date), notes, and parts (name, quantity, material, thickness, finish, tolerance, attachment references), each with a confidence. Input: body (≤ 6k tokens), attachment list, up to 5 PDF pages as document input. | `extract` |
| 6 | `classify-process` | CNC, sheet metal, mixed or other with a confidence; rule signals (DXF present, "bend", "Abkantung", "laser"; "milling", "Fräsen", "turning", tolerances) combined with the model's answer. | `classify` |
| 7 | `dedupe-customer` | Match `lower(email)` against `customers` (unique index, supabase/migrations/20260806_phase2_rls_per_user.sql:423-424); same-domain or same-VAT matches are only suggestions on the card, never merged automatically. Rows also appear from trigger `on_auth_user_created_customer` (H-28), so matching is by e-mail, as `create_public_rfq` does. | — |
| 8 | `request-confirmation` | Card when overall confidence < 0.7 (`value.min_confidence`), DMARC failed, customer unknown and company missing, or `mode` is `shadow`/`assist`. Auto-eligible otherwise in `auto` mode. | — |
| 9 | `wait-confirmation` | `waitForEvent('intake-confirmed')` 7 d, reminder, 7 d; payload may correct the process or reject. Timeout → `needs_review`; the dashboard can still create the RFQ later through the same idempotent function. | — |
| 10 | `create-rfq` | `create_email_rfq(inbound_email_id, payload, source)` → RFQ number `RFQ-DDMMYYYY-n`, customer link, `rfqs.source`, `rfqs.inbound_email_id` (one transaction). The RPC requires a company name (supabase/migrations/20260806_link_rfqs_to_customers.sql:63-65); when none is found the sender's domain is used and flagged. | — |
| 11 | `copy-files` | R2 copy to `rfq/<rfq_id>/<file_id>-<name>`; insert `rfq_files` (`file_path` = `r2_key`, `part_id` from the part mapping) `ON CONFLICT (rfq_id, sha256) DO NOTHING`. | — |
| 12 | `enqueue-cad` | One `cad_jobs` row + `cad-jobs` message (`job_type` `analyse`) per STEP, STL or DXF file (§5). | — |
| 13 | `notify-and-hand-over` | Final card; `agent_runs` closed; if `agent.quote` is on, create instance `quote-<rfq_id>-v1`. Optional customer acknowledgement mail only when `value.ack` is true (off by default). | — |

LLM calls:

| Step | Route | Purpose | Tokens in / out (rough) | Cost |
|---|---|---|---|---|
| `triage` | `classify` | kind, language, spam | 1,500 / 100 | $0.002 |
| `extract` | `extract` | structured RFQ fields | 9,000 / 1,200 (15,000 / 1,500 with 5 PDF pages) | $0.030 (up to $0.045) |
| `classify-process` | `classify` | CNC vs sheet metal + confidence | 2,000 / 150 | $0.003 |

Failure modes:

| Failure | Handling |
|---|---|
| No attachment or only non-CAD files | RFQ created without CAD jobs; card says "no CAD file"; quote agent waits for files (reply attribution attaches them later). |
| Unreadable or oversized attachment | Stored as is, flagged on the card; no CAD job. |
| Low confidence, DMARC fail, unknown sender | Approval card (step 8); never auto-created. |
| Duplicate delivery or same mail to `rfq@` and `replies@` | Unique `message_id_sha256`; second copy stops at M4. |
| Follow-up mail on an existing RFQ | Step 4 attaches it through `RfqThread`; no second RFQ. |
| Spam or auto-reply | Ends at `triage` (`status` `spam`/`rejected`); raw kept for the retention period. |
| LLM or Supabase outage | Step retries (§2.5); then `waiting_human`. The raw mail and row already exist, so nothing is lost. |
| Prompt injection in the mail | Schema-bound output, no tools; `injection_suspected` forces approval. |

Cost per run: LLM ≈ $0.035 (spam path $0.002, large PDF path ≈ $0.05); Cloudflare usage (1 Email Worker invocation, ≈ 13 Workflow steps, ≈ 8 R2 operations, 2 DO requests, ≈ 12 Supabase REST calls) is inside included usage. Planning figure: **≈ $0.04 per RFQ e-mail** (list prices, re-check at execution).

Human view:

| Surface | Content |
|---|---|
| Telegram card | Title "RFQ e-mail · <company> · <country> · <language>"; sender name and masked address; parts count and file types; total quantity; process + confidence; deadline; customer "existing" or "new"; flags (DMARC fail, injection suspected). Buttons: **Confirm sheet metal**, **Confirm CNC**, **Not an RFQ**, **Open**. |
| Dashboard | New page `/dashboard/rfq-inbox` (`RfqInboxPage`, P4-12): every `inbound_emails` row with status, parsed fields highlighted with confidence, original text on demand, attachments, actions confirm/correct/reject. Created RFQs open in the existing `/rfq/:id` (src/App.tsx:271). |

Rollout and success metric:

| Stage | Duration | Exit criterion |
|---|---|---|
| `shadow` | 2 weeks; the old mailbox keeps a copy (PLAN.md Q3) | Every received mail has an `inbound_emails` row (0 lost); field accuracy ≥ 90 % on quantity, material, deadline vs the owner's manual entry; process accuracy ≥ 95 % |
| `assist` | from Phase 4 exit (P4-14) | Median time mail → RFQ row < 5 min after confirmation; ≤ 1 correction per RFQ on average |
| `auto` (high-confidence RFQ creation only) | owner decision | Two weeks of `assist` with no wrong auto-eligible case |

### 3.2 Agent 2: quote Workflow

| Aspect | Design |
|---|---|
| Purpose | From a draft RFQ to a sent quote: geometry, unfold, bend table, drawing, a rule-based price with RAG context, owner approval, PDF, send, follow-ups and outcome detection. |
| Trigger | Step 13 of `rfq-intake`; "Start quote" on `/rfq/:id` or ApprovalsPage (web-form RFQs too); a revision creates `quote_version + 1` and cancels the previous instance. |
| Inputs | `rfqs` (incl. `parts_details`, `due_date`), `rfq_files`, `customers`; CAD results (`cad_jobs.result`, outputs in R2); `pricing_rules`; material prices (`catalog_materials.price_per_kg`, src/sql/20260407_add_price_per_kg.sql:6-8; density and kerf factor in `materials`, supabase/migrations/20260401_create_inventory_system.sql:48,63); similar past quotes from Vectorize `quotes-v1`. |
| Outputs | `quote_workflows` row (state machine); `cad_jobs` for `drawing_pdf`/`flat_dxf`; R2 `quotes/<rfq_id>/v<version>/quote.pdf`; Resend e-mail with `Reply-To: replies@rfq.micronshub.eu`; stored outbound `Message-ID`s; `rfqs.status` `sent` (existing values `draft`, `sent`, `received`, `approved`, src/pages/RfqManagement.tsx:601-768); Vectorize upsert (id = `quote_workflows.id`); Telegram cards; `agent_runs`. |
| Idempotency key | `rfq_id + quote_version` (unique in `quote_workflows`; instance `quote-<rfq_id>-v<n>`); Resend `Idempotency-Key` `quote-<quote_workflow_id>-send` and `…-fu<n>` for follow-ups (Resend feature, re-check at execution). |
| Flag | `agent.quote` (also gates the reply detection of §4 for quote threads). |

Steps (Workflow `quote`, `QuoteWorkflow`):

| # | Step | What | LLM route |
|---|---|---|---|
| 1 | `load` | RFQ, files, customer; insert `quote_workflows` (`status` `started`). | — |
| 2 | `await-cad` | `waitForEvent('cad-done')` 2 h (sent when all `analyse` jobs of the RFQ are final); timeout → continue with "geometry missing" lines priced manually. | — |
| 3 | `cad-outputs` | For sheet-metal parts: `drawing_pdf` (A3 drawing with bend table and title block) and `flat_dxf` jobs through the same queue (§5); wait `cad-done` again. | — |
| 4 | `similar-quotes` | Embed a normalised description (process, material, thickness, bounding box, quantity) and query `quotes-v1` top 5 with metadata filter on process; load their pricing and outcome. | `embed` |
| 5 | `price` | Deterministic calculator: material mass × `price_per_kg` × kerf factor, cutting/bending/machining time from CAD results × rates, setup, finishing, margin, minimum order value, all from `pricing_rules` (version recorded). | — |
| 6 | `price-notes` | Model reviews the calculated lines with the RFQ notes and the similar quotes: assumptions, risks (e.g. tight tolerance), suggested adjustments with reasons. Suggestions are shown, never applied. | `extract` |
| 7 | `cover-email` | Cover e-mail text in the customer's language (from `rfq-intake` or the form language). | `extract` |
| 8 | `draft-pdf` | Quote PDF with `pdf-lib` in `microns-ops` (the library `generate-manufacturing-pdf` already uses, supabase/functions/generate-manufacturing-pdf/pdf-builder.ts), layout ported from scripts/generate_offer_pdf.py (brand colours, line table); drawing PDFs attached. | — |
| 9 | `request-approval` | Card + ApprovalsPage entry; `status` `awaiting_approval`. | — |
| 10 | `wait-approval` | `waitForEvent('quote-approved')` 7 d, reminder, 7 d; edited lines in the payload → re-run `draft-pdf`. Reject = terminate (§2.4). Second timeout → `expired`. | — |
| 11 | `send` | Resend from the existing sender identity, `Reply-To: replies@rfq.micronshub.eu`, `Message-ID` `<q.<quote_workflow_id>.<n>@rfq.micronshub.eu>` (if Resend does not keep a custom `Message-ID`, store the one it reports; re-check at execution); PDF attached; `outbound_message_ids`, `sent_at`, `rfqs.status = 'sent'`; Vectorize upsert with `outcome: open`. | — |
| 12 | `follow-up-1` … `follow-up-3` | `waitForEvent('customer-reply')` 3 d → follow-up 1; 4 d → follow-up 2; 7 d → `expired`. Follow-ups carry `In-Reply-To`/`References` of the first send; cadence in `value.follow_up_days`; follow-up sends are auto-eligible because the text is a fixed template. | — |
| 13 | `classify-reply` | On `customer-reply`: won, lost, counter-offer, question, auto-reply, with confidence. | `classify` |
| 14 | `confirm-reply` | Confidence ≥ 0.8 and not counter-offer → status set, card informational; otherwise card with buttons and `waitForEvent('reply-confirmed')`. "Won" can create the `orders` row (status `new`, `rfq_id`) through `microns-ops`, which starts agent 3. | — |
| 15 | `close` | `quote_workflows.status` final; Vectorize metadata `outcome`; `agent_runs` closed. | — |

LLM calls:

| Step | Route | Purpose | Tokens in / out | Cost |
|---|---|---|---|---|
| `similar-quotes` | `embed` | query vector | 500 / — | ≈ $0 |
| `price-notes` | `extract` | assumptions, risks, suggestions | 10,000 / 1,500 | $0.035 |
| `cover-email` | `extract` | customer-language text | 3,000 / 800 | $0.014 |
| `classify-reply` (per reply) | `classify` | outcome of a reply | 2,000 / 150 | $0.003 |

Failure modes:

| Failure | Handling |
|---|---|
| CAD job fails or times out | Card "geometry missing for part n"; the line is priced manually on the dashboard; the approval still gates the send. |
| Material not in `pricing_rules` or no `price_per_kg` | Line marked "manual price"; approval required even in `auto`. |
| Owner edits the price | Edited lines travel in the `quote-approved` payload; stored in `quote_workflows.pricing.overrides` and used by the evaluation (§2.8). |
| Resend error | Retries with the same idempotency key; after the last retry `status` `failed` and a card with **Retry send**. |
| Customer replies before the follow-up wait starts | Events are buffered (§2.4). |
| Reply cannot be attributed | §4 fallback: card asks the owner to pick the RFQ. |
| Duplicate start | Unique (`rfq_id`, `quote_version`) and one active workflow per RFQ (partial unique index, §7). |

Cost per run (one quote version, one reply): LLM ≈ $0.052; CAD: Phase 4 backend is the existing service (no marginal cost), Phase 5 Container ≈ 3 jobs × 40 s × $0.00002 = $0.0024 warm, up to ≈ $0.015 with a cold start and the ≈ 10 min `sleepAfter` tail. Planning figure: **≈ $0.06 per quote version** (list prices, re-check at execution).

Human view:

| Surface | Content |
|---|---|
| Telegram card (approval) | "Quote draft <RFQ number> v<n> · <company>"; lines count; total and currency; margin %; similar quotes (count, won/lost); top model notes; missing-geometry warnings; PDF link (signed, 7 d). Buttons: **Approve and send**, **Edit in dashboard**, **Reject**. |
| Telegram card (reply) | "<RFQ number> reply · classified <outcome> (<confidence>)"; first 200 characters. Buttons: **Won**, **Lost**, **Counter-offer**, **Ignore**. |
| Dashboard | `/dashboard/approvals` (`ApprovalsPage`, P4-12): pricing lines editable, notes, PDF preview, approve/reject; `/rfq/:id` gains an "Agent" panel with the `quote_workflows` timeline. |

Rollout and success metric: `assist` for the whole of Phase 4 (every send approved; PLAN.md Phase 4 exit gate item 1); after 20 quotes, measure. Success: ≥ 60 % of drafts approved without price edits; median RFQ-to-sent time < 24 h; win rate and absolute percentage error of the draft total tracked weekly in the digest.

### 3.3 Agent 3: post-order handoff

| Aspect | Design |
|---|---|
| Purpose | On acceptance: job traveller and drawings to the production partner, stock reserved without double-booking, supplier reorder draft when stock runs low. |
| Trigger | (a) "Won" in agent 2 creates the order and starts the instance; (b) portal "Accept Quote" inserts `orders` client-side (supabase/migrations/20260806_phase2_rls_per_user.sql:18-19), detected by the existing `*/10` dispatcher tick of `microns-ops` (orders without a `post-order` run; no new cron); (c) "Start handoff" on `/orders/:id` (src/App.tsx:274). |
| Inputs | `orders`, `order_items`, `rfqs`, `quote_workflows.pricing` (per-line material and area), `production_partners`, CAD outputs, `materials`, `stock_items`, `low_stock_alerts`, `inventory_settings`. |
| Outputs | R2 `orders/<order_id>/traveler.pdf`; `orders.partner_id` when a partner is chosen; partner e-mail (Resend) with signed links; `stock_reservations` rows and `stock_transactions` rows of the existing types `reserve`/`unreserve` (supabase/migrations/20260401_create_inventory_system.sql:24-26); reorder draft; cards; `agent_runs`. |
| Idempotency key | `order_id` (instance `post-order-<order_id>`); reservations idempotent on `order_item_id` (§6); partner mail `Idempotency-Key` `order-<order_id>-handoff`. |
| Flag | `agent.post_order`. |

Steps (Workflow `post-order`, `PostOrderWorkflow`):

| # | Step | What | LLM route |
|---|---|---|---|
| 1 | `load` | Order, items, RFQ, pricing lines, partner candidates (`production_partners.specializations`, `active`). Line mapping order item → quote line by `product_name` as set by `create_public_rfq` (supabase/migrations/20260806_link_rfqs_to_customers.sql:133-144); unmatched items go to the card. | — |
| 2 | `traveller-notes` | Partner-facing summary of special requirements from the RFQ notes, in the partner's language. | `extract` |
| 3 | `build-traveller` | Traveller PDF (`pdf-lib`): PO number, parts, quantities, material, finish, due date, QA notes, drawing references → `orders/<order_id>/traveler.pdf`. | — |
| 4 | `reserve-stock` | For items made from stocked material: `MaterialStock(<tenant>:<material_id>).reserve(order_item_id, need)` (§6); shortfall recorded. | — |
| 5 | `request-handoff` | Card with partner, traveller link and stock status; `waitForEvent('handoff-approved')` 7 d, reminder, 7 d. | — |
| 6 | `handoff` | Set `orders.partner_id` (the partner portal shows it through the existing partner visibility rules, supabase/migrations/20260806_phase2_rls_per_user.sql:90-107); Resend mail with signed links (7 d) to the traveller and drawings. | — |
| 7 | `reorder-draft` | If a shortfall exists or an unresolved `low_stock_alerts` row exists for the material: draft using `materials.supplier`, `supplier_sku`, `reorder_quantity`, `lead_time_days` (supabase/migrations/20260401_create_inventory_system.sql:53-59). | `extract` |
| 8 | `wait-reorder` | `waitForEvent('reorder-approved')` 7 d, reminder, 7 d; approval marks the draft approved and hands the text to the owner for sending (no supplier e-mail column exists, §9). | — |
| 9 | `close` | `agent_runs` closed; commit and release of reservations happen later through the inventory actions (§6). | — |

LLM calls:

| Step | Route | Purpose | Tokens in / out | Cost |
|---|---|---|---|---|
| `traveller-notes` | `extract` | requirement summary | 3,000 / 500 | $0.011 |
| `reorder-draft` (only when needed) | `extract` | supplier mail draft | 2,000 / 400 | $0.008 |

Failure modes:

| Failure | Handling |
|---|---|
| Order item cannot be mapped to a quote line | Card lists it; traveller built with the order item text; no reservation for it. |
| Not enough stock | Partial hold, shortfall on the card, reorder draft. |
| Hold conflicts with a manual stock change | `MaterialStock` re-reads `stock_items` on every call and reports "held > remaining" (§6). |
| Partner has no login or e-mail | Card asks the owner to choose another partner or send manually. |
| Order cancelled | `release(order_item_id, 'cancelled')` from the order page action; instance terminated. |

Cost per run: LLM ≈ $0.011–0.019; DO and R2 usage inside included usage. Planning figure: **≈ $0.015 per order**.

Human view:

| Surface | Content |
|---|---|
| Telegram card (handoff) | "Order <PO number> · <partner>"; items count; due date; traveller link; stock "held n sheets <material>" or "short by …". Buttons: **Send to partner**, **Change partner** (opens `/orders/:id`), **Hold**. |
| Telegram card (reorder) | "Reorder draft · <material> · <quantity> · <supplier> · lead time <n> d". Buttons: **Approve draft**, **Dismiss**. |
| Dashboard | `/orders/:id` gains the agent panel (traveller, reservations); stock view in `/dashboard/inventory` and alerts in `/dashboard/inventory/alerts` (src/App.tsx:303, 308). |

Rollout and success metric: `assist` (every partner send approved). Success: zero double-booked sheets (daily check: sum of active holds ≤ `remaining_area_mm2` per stock item); traveller ready within 1 h of the order; every order has a `post-order` run.

### 3.4 Agent 4: growth agents

Five jobs, one pattern: a Cron Trigger (or an on-demand call) enqueues one `scrapes` message per unit of work; the consumer fetches, scores, upserts with the table's unique key and posts to Telegram as today. Each job checks its own flag and writes one `agent_runs` row per cron tick (H-29).

| Job | Trigger (UTC) | Inputs | Outputs | Idempotency key | Flag | Phase |
|---|---|---|---|---|---|---|
| Reddit | tier1 `*/15`, tier2 `*/30`, tier3 hourly (live `cron.job` 2026-09-30) | `monitored_subreddits` due by `scan_interval_minutes`, `lead_keywords`; pullpush API (supabase/functions/reddit-collector/index.ts:141-146, :260-271) | `leads` upserts, Telegram lead messages | `leads.source_url` unique (supabase/migrations/20260321_create_lead_monitor.sql:10); run key `growth.reddit:<cron>:<scheduledTime>` | `agent.growth.reddit` | 5 (P5-3) |
| HN | `*/30` | `lead_keywords`; Algolia HN API | `leads` upserts, Telegram | same | `agent.growth.hn` | 5 (P5-3) |
| Tenders | 06:00 | `tender_connectors` due (26 seeded, supabase/migrations/20260322_create_tender_monitor.sql:138); `lib/connectors/*` and `scoreTender` (api/tender-scan.js:14-21, :140) | `tenders` upserts with score, Telegram | `tenders` unique (`country_code`, `tender_reference`) (supabase/migrations/20260325_fix_table_schemas.sql:200) | `agent.growth.tenders` | 5 (P5-3) |
| Scrapers (Europages, wlw) | on demand from `/dashboard/company-scanner`, MCP `scan_directory`/`run_saved_search` | search URL; Browser Rendering for pages that need a browser, plain fetch otherwise (api/scan-directory.js:1-7) | `company_leads` upserts, `scan_logs` | `company_leads` unique (`source`, `source_url`) (supabase/migrations/20260325_fix_table_schemas.sql:127) | `agent.growth.scrapers` | 4 (P4-10) |
| Xometry | `0 6,8,10,12,14,16,18 * * *` (.github/workflows/xometry-scan.yml:21) | Xometry partner GraphQL (TypeScript port or Container, PLAN.md Q8) | `xometry_offers` upserts; alert on HTTP 401 | `xometry_offers.code` unique (xometry-bot/schema.sql:8) | `agent.growth.xometry` | 5 (P5-5) |

Consumer steps (Queue `scrapes`, one message per subreddit, search term set, connector, search page or scan):

| # | Step | What | LLM route |
|---|---|---|---|
| 1 | `claim` | Insert/lookup `agent_runs` for the tick; skip if the unit was done in this tick. | — |
| 2 | `fetch` | Source API or Browser Rendering (≤ 6 concurrent connections per invocation, CF docs verified 2026-09-27); existing delays kept. | — |
| 3 | `score` | Existing keyword/CPV scoring unchanged (parity first). Tenders additionally: embed title + description and query `quotes-v1`; the similarity to past won quotes adds up to 15 points (proposal). | `embed` |
| 4 | `relevance` (optional, off by default) | Candidates above the keyword threshold get a relevance check and a draft `suggested_response`; capped at 20 per run (`value.llm_cap`). | `classify` |
| 5 | `upsert` | Upsert on the unique key above. | — |
| 6 | `notify` | Telegram messages in today's format (existing `sendMessage` texts). | — |

LLM calls and cost per run:

| Job | LLM use | Tokens in / out | Cost per run |
|---|---|---|---|
| Reddit, HN | none by default; optional `classify` per candidate | 800 / 80 per candidate | $0 (≤ $0.024 with the cap) |
| Tenders | `embed` for ≈ 50 tenders; optional `classify` for the top 10 | 25,000 / —; 10 × (1,500 / 100) | ≈ $0 (+ $0.02 optional) |
| Scrapers | none | — | browser time only, inside the allowance |
| Xometry | none (rule pricing of xometry-bot/xometry_bot/pricing.py is ported as code) | — | $0 |

Failure modes: source API down → message retried (3), then DLQ `scrapes-dlq`, reported in the digest; Xometry 401 → Telegram "token refresh needed" (the MFA-gated token is refreshed by hand today) and the job pauses until the secret changes; duplicate items → unique keys; a scraper page layout change → zero results for 3 consecutive runs raises a card.

Human view: unchanged Telegram messages; dashboards `/dashboard/leads`, `/dashboard/tenders`, `/dashboard/company-scanner`, `/dashboard/xometry` (src/App.tsx:290-295). New: the digest shows per-job run counts and failures.

Rollout and success metric: Phase 5 switch-over one job at a time (P5-8): pg_cron job deactivated, Cloudflare job enabled; 7-day output parity (P5-9): leads and tenders inserted per day within the prior 7-day range, Telegram deliveries equal, zero duplicate rows; scrapers in Phase 4 after 5 successful on-demand scans.

### 3.5 Agent 5: content pipeline

| Aspect | Design |
|---|---|
| Purpose | One daily Workflow replaces the pg_cron chain (07:00 enqueue, `*/5` queue worker, 08:00 translate, 08:30 fix links, 09:00 sitemap; live `cron.job` 2026-09-30) and fixes the translation lag (H-19: cs/da/fi/hu/nb/pl/sv 19 days behind, pt 8 days; live 2026-09-30). |
| Trigger | Cron `0 7 * * *`; manual "Run now" on `/dashboard/auto-blog` (src/App.tsx:284). |
| Inputs | Next title (`enqueue_next_article()` today, live job 17); `articles`; `content_pages` for the sitemap. |
| Outputs | 1 English article + 13 translations in `articles`; fixed links; sitemap blobs in `microns-private` `sitemaps/…` served by `microns-site` at the identical URLs; `gsc_monitored_urls` upserts; IndexNow submission (key file stays at `/indexnow_key.txt`, H-14); KV `SEO_CACHE` purge; `agent_runs`. |
| Idempotency key | Instance `content-daily-<yyyy-mm-dd>`; articles unique (`slug`, `language`) (supabase/migrations/20241202_create_articles_table.sql:19); translation message key `<translation_id>:<language>` (consumer skips if the sibling exists). |
| Flag | `agent.content_daily`. |

Steps (Workflow `content-daily`, `ContentDailyWorkflow`; child `sitemap`, `SitemapWorkflow`):

| # | Step | What | LLM route |
|---|---|---|---|
| 1 | `pick-title` | Next `article_titles` row (same logic as `enqueue_next_article()`). | — |
| 2 | `generate-en` | Port of `generate-daily-article` (today model ID `claude-sonnet-4-20250514`, `max_tokens` 16384, supabase/functions/generate-daily-article/index.ts:183-188); article inserted as published English master. | `extract` |
| 3 | `fan-out` | 13 `translations` messages (languages of supabase/functions/auto-translate-articles/index.ts:18-33); backfill messages for missing languages of earlier articles are enqueued by a one-off job and by this step (≤ 5 per language per day). | — |
| 4 | `wait-translations` | `waitForEvent('translations-done')` 6 h; timeout → continue with the languages present, missing ones listed. | — |
| 5 | `fix-links` | Port of `fix-article-links` for this `translation_id` only (not `fix_all`). | — |
| 6 | `sitemap` | Start `sitemap-<date>`: regenerate `sitemap-complete.xml` (and per-language files per SEO_PARITY.md), write to R2, upsert `gsc_monitored_urls`. | — |
| 7 | `indexnow` | Submit the 14 new URLs. | — |
| 8 | `purge-cache` | Delete affected `SEO_CACHE` keys. | — |
| 9 | `close` | `agent_runs` with per-language outcome. | — |

`translations` consumer: one language per message (`max_batch_size` 1, 5 retries, `retry_delay` 120 s, concurrency 3; wrangler.jsonc.draft), `translate` route, inserts the sibling, then checks whether all 13 exist and, if so, sends `translations-done`.

LLM calls:

| Step | Route | Purpose | Tokens in / out | Cost |
|---|---|---|---|---|
| `generate-en` | `extract` | article generation | 3,000 / 6,000 | $0.066 |
| translation (× 13) | `translate` | one language | 7,000 / 7,000 each | 13 × $0.020 = $0.255 |

Failure modes: a language fails 5 times → `translations-dlq`, missing language listed on the failure card with **Retry failed**; generation fails → no fan-out, card; sitemap regression guard (the existing one throws on `content_pages` drift, supabase/functions/generate-sitemap/index.ts:349-355) → keep yesterday's blobs and alert; IndexNow error → logged, not retried beyond 3.

Cost per run: **≈ $0.32 per day** (≈ $10 per month); this spend exists today as direct Anthropic and Gemini calls from the edge functions.

Human view: Telegram only on failure or partial success ("content-daily <date>: 11/13 languages; failed: hu, pl" with **Retry failed**); `/dashboard/auto-blog` shows the run timeline; the digest shows lag per language.

Rollout and success metric: Phase 5 switch-over with the pg_cron chain deactivated, not deleted (P5-8). Success (P5-9 gate): articles per language per day ≥ the pre-switch baseline for 7 days; lag for cs/da/fi/hu/nb/pl/sv/pt falls every day until 0; sitemap URL set equals the published rows.

### 3.6 Agent 6: ops digest

| Aspect | Design |
|---|---|
| Purpose | Weekly e-mail to the owner: RFQs in, quotes out, win rate, margin, stuck workflows, agent cost; optional Google Ads offline conversions for closed orders. |
| Trigger | Cron Monday 06:30 UTC (`30 6 * * mon`, wrangler.jsonc.draft); manual "Send now". |
| Inputs | `rfqs` (by `source`), `quote_workflows`, `orders` (`total_amount`, `total_production_costs`, `material_costs`, `working_hours_costs`), `agent_runs`, `cad_jobs`, `inbound_emails`; queue backlog of the DLQs (Cloudflare API, §9). |
| Outputs | Resend e-mail to the recipient stored in the flag `value`; short Telegram summary; optional Google Ads conversion uploads; monthly retention purge (§2.6); `agent_runs`. |
| Idempotency key | Instance `ops-digest-<yyyy>-W<ww>`; mail `Idempotency-Key` `digest-<yyyy>-W<ww>`; conversion upload per order ID. |
| Flag | `agent.ops_digest` (`value.ads_upload` off until PLAN.md Q21 is answered). |

Steps (Workflow `ops-digest`, `OpsDigestWorkflow`):

| # | Step | What | LLM route |
|---|---|---|---|
| 1 | `collect` | SQL aggregates for the ISO week: RFQs by source, quotes sent, won/lost/expired, win rate, margin = (`total_amount` − `total_production_costs`) / `total_amount` for won orders, median RFQ-to-sent time, cost per agent from `agent_runs.cost_cents`. | — |
| 2 | `stuck` | `agent_runs` in `running`/`waiting_human` older than 48 h, `quote_workflows` in `awaiting_approval`, failed `cad_jobs`, DLQ backlog, translation lag per language. | — |
| 3 | `narrative` | Five-line summary of the week with the notable changes. | `extract` |
| 4 | `send` | Resend e-mail (tables + narrative); Telegram one-liner. | — |
| 5 | `ads-conversions` (optional) | Upload won orders as offline conversions. No click ID is captured today (no `gclid` in `src/`, `api/`, `supabase/functions/`; the Ads tag is `index.html:70-72`), so the option is enhanced conversions for leads with hashed e-mail, or adding click-ID capture first (PLAN.md Q21). | — |
| 6 | `purge` | Monthly: retention purge of §2.6. | — |

LLM calls: `narrative`, `extract`, 4,000 / 600 tokens, $0.014. Cost per run: **≈ $0.014 per week**.

Failure modes: SQL error → retry, then card; mail error → retry with the same idempotency key; Ads API error → listed in next week's digest, no retry storm.

Human view: the e-mail (sections: Pipeline, Quotes, Orders and margin, Agents and cost, Stuck items with dashboard links, Content lag); Telegram "Digest W<ww> sent: <n> RFQs, <m> quotes, win rate <x> %".

Rollout and success metric: on from Phase 5 (P5-7). Success: delivered every Monday before 07:00 UTC; figures match a manual SQL spot check for 3 consecutive weeks.

### 3.7 Agent 7: remote MCP server

| Aspect | Design |
|---|---|
| Purpose | Drive the business from Claude on desktop or mobile: RFQs, quotes, orders, inventory, GSC, tenders, leads as MCP tools. |
| Trigger | MCP client over Streamable HTTP to `mcp.micronshub.eu` (Custom Domain → `microns-ops`). |
| Inputs | Tool arguments; Supabase (service role, scoped per tool); GSC through the existing client logic; the ops routes that replace the Vercel API calls of the local server (mcp-server/src/index.ts:541, :683, :815, :1290, :1552). |
| Outputs | Tool results; for write tools, the same effects as the dashboard (e.g. a `quote-approved` decision through `/api/agent/decision` logic); one `agent_runs` row per tool call (`agent` `mcp`). |
| Idempotency key | Read tools: none needed. Write tools: `mcp:<session id>:<request id>` as `agent_runs.idempotency_key`. |
| Flag | `mcp.remote` (`value.writes` false in the first stage). |

Design points:

| Point | Design |
|---|---|
| Class | `MicronsMcp` (Agents SDK `McpAgent`, as planned). CF docs (verified 2026-09-30, see wrangler.jsonc.draft) mark `McpAgent` as feature-frozen in favour of the stateless `createMcpHandler`; P4-11 decides before the first deploy. |
| Authentication | Cloudflare Access in front of the hostname plus an OAuth flow for MCP clients (secrets `MCP_OAUTH_*`); only the owner's identity is allowed. Tool handlers additionally require a `user_roles` staff role for the mapped Supabase user (never a tenant role, H-5). |
| Tools, stage 1 (read) | The 39 tools of the local server (mcp-server/src/index.ts, 39 `server.tool` registrations: leads 10, companies 6, tenders 8, funded startups 5, GSC 10) plus `list_rfqs`, `get_rfq`, `get_quote_workflow`, `list_orders`, `get_order`, `get_stock_summary` (existing RPC `get_stock_summary`, supabase/migrations/20260401_create_inventory_system.sql:572), `list_agent_runs`, `search_similar_quotes` (`embed` + `quotes-v1`). |
| Tools, stage 2 (write) | `decide_approval` (same claim-and-event logic as §2.4), `update_lead_status`, `update_tender_status`, `trigger_country_scan`, `run_saved_search`; each asks for confirmation in the tool description and is recorded in `agent_runs`. |
| Local server | The stdio server stays for Claude Desktop (PLAN.md §5.4); only its `SITE_URL` changes in Phase 2. |

LLM calls: none server-side (the client's model does the reasoning); `search_similar_quotes` uses `embed` (≈ $0).

Failure modes: Access or OAuth failure → 401, nothing logged beyond Access logs; Supabase error → tool error result; flag off → every tool returns "remote MCP disabled"; a write tool with an already-used idempotency key returns the first result.

Cost per run: Worker request + DO + Supabase call per tool call, inside included usage; **≈ $0 per call**.

Human view: Claude's tool calls on the owner's device; `agent_runs` rows with `agent = mcp` on ApprovalsPage "Activity"; Access logs.

Rollout and success metric: stage 1 read-only for 2 weeks, then stage 2 writes. Success: owner uses it weekly from mobile; zero calls outside the allowed identity in Access logs; p95 tool latency < 2 s.

## 4. Reply attribution and the Gmail poller

Replies reach the system two ways: mail sent through Resend carries `Reply-To: replies@rfq.micronshub.eu` and arrives at `microns-mail`; mail sent from the 2 Google Workspace sender accounts (live 2026-09-30) is answered into those Workspace inboxes and is read by a poller. Attribution is by message identifiers, not by address tags, because plus-addressing on a subdomain routing rule is unverified ([README.md](README.md) §7, answer 8).

| Stored outbound identifiers | Where |
|---|---|
| Quote sends and follow-ups | `quote_workflows.outbound_message_ids` (GIN index) |
| RFQ acknowledgements (when enabled) | `quote_workflows.outbound_message_ids` of version 1, or `agent_runs.output` for RFQs without a quote |
| Inbound thread messages | `inbound_emails.message_id` + `RfqThread` DO state (mirror) |
| Campaign mails (Gmail accounts) | existing `marketing_events` and `marketing_subscribers` (unchanged semantics of `check-replies`) |

Matching order for an inbound message:

| # | Rule | Confidence | Action |
|---|---|---|---|
| 1 | `In-Reply-To` equals a stored outbound or thread ID | exact | attach to that RFQ/quote; `customer-reply` event |
| 2 | Any `References` ID equals a stored ID | exact | same |
| 3 | Subject contains an RFQ number `RFQ-DDMMYYYY-n` (numbering of supabase/migrations/20260806_link_rfqs_to_customers.sql:50-51, :125-131) that exists | 0.8 | attach; card informational |
| 4 | Sender e-mail equals the customer of exactly one open quote | 0.5 | card asks the owner to confirm |
| 5 | None | — | treated as a new inbound mail (agent 1) |

Flow for `replies@`: `microns-mail` M1–M4 as in §3.1, then an `agent-events` message `{type: "inbound-reply", inbound_email_id}` instead of an intake instance; the consumer applies the matching order, updates `inbound_emails` (`status` `matched`, `quote_workflow_id`), appends to `RfqThread(<rfq_id>)`, and calls `sendEvent({type: "customer-reply"})` on `quote-<rfq_id>-v<n>`. Attachments in replies become `rfq_files` of that RFQ and new `cad_jobs`.

Gmail poller (Cron `*/10 * * * *` in `microns-ops`, Phase 4, P4-8; `check-replies` is in the repo but not deployed, live 2026-09-30):

| # | Step | What |
|---|---|---|
| 1 | `accounts` | Active `marketing_sender_accounts` with provider `google_workspace` (2 today). OAuth credentials come from the source fixed by the P0-2 consumer inventory (handling per the private security note). |
| 2 | `list` | Incremental Gmail sync from the last `historyId` (stored in the last successful poller run's `agent_runs.output`); first run falls back to the `check-replies` query `in:inbox after:<now − 7 d>` with `maxResults` 100 (supabase/functions/check-replies/index.ts:79-83). |
| 3 | `headers` | Metadata only: `Message-ID`, `In-Reply-To`, `References`, `From`, `Subject` (today `From` and `In-Reply-To`, check-replies/index.ts:98-108). |
| 4 | `route` | Quote thread match (rules 1–3) → fetch the raw message, store it like §3.1 (`inbound_emails.source` `gmail_poller`), `customer-reply` event. Campaign reply → existing semantics: `marketing_subscribers.replied_at` and `marketing_events` `replied`. Otherwise ignore (the Workspace inbox stays the owner's inbox; nothing is moved or labelled). |
| 5 | `record` | `agent_runs` per tick with counts and the new `historyId`. |

Idempotency: `inbound_emails` unique `message_id_sha256`; Gmail message IDs per account are recorded in `agent_runs.output`. Flag: `agent.quote` for the quote-thread path; the campaign-reply path runs only when `agent.quote` `value.campaign_replies` is true (no canonical flag exists for it, §9). Cost: Gmail API calls only; no LLM unless a reply reaches `classify-reply` in agent 2.

## 5. CAD backend contract (Container and Mac mini)

`CadRouter` (DO in `microns-ops`) is the only caller of a CAD backend. For agent jobs the backend receives the file bytes and returns its outputs; it writes nothing to R2 or Supabase and needs no storage credentials, because `sheet-metal-service` already streams its outputs (sheet-metal-service/main.py:243-258: "Output is streamed directly — nothing is stored").

`cad-jobs` message (JSON, schema version 1):

```json
{
  "v": 1,
  "job_id": "<cad_jobs.id>",
  "idempotency_key": "<input_sha256>:<job_type>:<params_sha256>",
  "job_type": "analyse",
  "tenant_id": "<tenants.id>",
  "rfq_id": "<rfqs.id>",
  "rfq_file_id": "<rfq_files.id>",
  "quote_workflow_id": null,
  "input": { "r2_key": "rfq/<rfq_id>/<file_id>-<name>", "sha256": "<hex>", "content_type": "model/step", "size_bytes": 482113 },
  "params": { "material": "steel", "thickness_override": 0, "k_factor_override": 0, "drawing_size": "A3" },
  "backend": "auto",
  "deadline_s": 300,
  "reply": { "workflow": "quote", "instance_id": "quote-<rfq_id>-v1", "event_type": "cad-done" },
  "run_id": "<agent_runs.id>"
}
```

| `job_type` | Backend endpoint (existing) | Outputs in R2 `cad/<job_id>/output/` |
|---|---|---|
| `analyse` | `POST /api/v1/unfold/info` ("JSON metadata only — for the quoting engine", sheet-metal-service/main.py:377-391) | `result.json` (thickness, flat size, bends, bounding box, warnings) |
| `drawing_pdf` | `POST /api/v1/unfold` with `output_format=pdf`, `drawing_size` (main.py:243-253) | `drawing.pdf` + response headers `X-Part-*` in `result.json` (main.py:270-275) |
| `flat_dxf` | `POST /api/v1/unfold` with `output_format=dxf` | `flat.dxf` |
| `flat_svg` | `POST /api/v1/unfold` with `output_format=svg` | `flat.svg` |
| `fusion_*` (future) | Mac mini Fusion 360 worker, same envelope (PLAN.md Q22) | defined with that project |

R2 contract:

| Prefix | Writer | Content |
|---|---|---|
| `cad/<job_id>/input/<name>` | not written: `CadRouter` streams the object from `rfq/…` as a multipart upload (the service accepts `file` or `file_url`, main.py:245-247) | — |
| `cad/<job_id>/output/{result.json, <artefact>, log.txt}` | `CadRouter` | parsed metadata with backend, duration and versions; PDF, DXF or SVG as returned; backend error text (truncated) |

`cad_jobs` lifecycle:

| Status | Set by | Next |
|---|---|---|
| `queued` | producer (row + message in one step; row first) | `dispatched`, `cancelled` |
| `dispatched` | consumer: `attempts + 1`, backend chosen | `running` |
| `running` | backend accepted (sync call started, or async `202`) | `succeeded`, `failed`, `timed_out` |
| `succeeded` | outputs written, `result` filled; `RfqThread` sends `cad-done` when all jobs of the RFQ are final | — |
| `failed` | backend 4xx (e.g. not a valid STEP file, main.py:262-263): no retry | card "CAD failed" |
| `timed_out` | deadline passed: message retried (queue `max_retries` 2) | `dispatched` or `dead_letter` |
| `dead_letter` | retries exhausted → `cad-jobs-dlq` | manual re-drive |
| `cancelled` | RFQ deleted or quote cancelled | — |

Reuse: before dispatch, a `succeeded` job with the same `idempotency_key` (same file bytes, type and parameters) short-circuits: its outputs are referenced, no backend call.

Backend selection and limits:

| Backend | When | Transport | Timeout | Concurrency |
|---|---|---|---|---|
| Existing unfold service (`vps`) | Phase 4 (P4-6), until the Container ships | HTTPS to the current service URL (the one `UNFOLD_SERVICE_URL` points at), shared-secret header that sheet-metal-service/main.py:51-57 checks when its API key is configured | 300 s wall clock enforced by `CadRouter` | 1 (single uvicorn worker) |
| `container` (`CadContainer`, `microns-cad`) | Phase 5 (P5-6) default | Container binding from `CadRouter`; `CAD_SHARED_SECRET` header; service-side wall clock enforced in P5-6 (`PROCESSING_TIMEOUT` = 120 s is declared, sheet-metal-service/config.py:37) | 300 s | 3 (`max_instances` 3 = `cad-jobs` `max_concurrency` 3, wrangler.jsonc.draft) |
| `mac_mini` | `fusion_*` job types only (PLAN.md Q22) | Cloudflare Tunnel (`cloudflared` on the Mac mini) to a hostname behind an Access application with a service-token policy; hostname fixed when Q22 is answered (not yet in the hostname list of ARCHITECTURE.md) | async: `202` + signed callback to `microns-ops`, 60 min | 1 |

`backend: auto` = job type decides (`fusion_*` → Mac mini, everything else → Container, or `vps` before Phase 5); if the chosen backend's `/health` (main.py:712) fails twice, a capable alternative is used, else the job waits (retry). Queue consumer wall time is 15 min (CF docs verified 2026-09-27), so any job that can exceed it must be async with a callback.

## 6. `MaterialStock` reservation protocol

Today nothing reserves stock: `select_stock_for_session()` is a plain `SELECT` and the enum values `reserve`/`unreserve`/`reserved` are never used by code (supabase/migrations/20260401_create_inventory_system.sql:9, :24-26, :625-678), so two sessions can plan the same sheet. `MaterialStock` makes one Durable Object the single writer of holds per material.

| Aspect | Design |
|---|---|
| Object name | `<tenant_id>:<material_id>` (one per material/stock key) |
| Source of truth | `stock_reservations` + `stock_transactions` in Supabase; the DO's SQLite storage is a cache and idempotency map, rebuilt from `stock_reservations` (status `held`, `committed`) on start or on a mismatch |
| Availability | `stock_items.remaining_area_mm2` (or `remaining_quantity`) of available items minus active holds, re-read from Supabase on every call (tens of calls per day) |

| Call | Idempotency | Effect |
|---|---|---|
| `reserve(order_item_id, need)` → holds | If active holds exist for `order_item_id`, return them unchanged | Choose stock like `select_stock_for_session` (remnants smallest first, then full sheets FIFO); insert `stock_reservations` rows (`held`, `expires_at` = now + 14 d) and one `stock_transactions` row type `reserve` per stock item (with `order_id`); return holds and shortfall |
| `commit(order_item_id, nesting_session_id)` | Already `committed` for that session → no-op | Holds → `committed`, `expires_at` cleared; called when the job is added to a nesting session (`inv-session-add-jobs`, lib/inventory/index.js:500) |
| `release(order_item_id, reason)` | No active holds → no-op | Holds → `released` with reason (`cancelled`, `consumed`, `expired`, `manual`); one `unreserve` transaction per stock item; `consumed` is used after `inv-session-complete` (lib/inventory/index.js:506) records the real consumption |
| `expireHolds()` (DO alarm, daily) | — | `held` past `expires_at` → `release(…, 'expired')` + card |
| `check()` | — | Returns holds vs remaining per stock item; "held > remaining" (a manual adjustment or a session completed outside the DO) raises a card |

Write order inside one call (the DO processes calls one at a time): (1) idempotency check in DO storage; (2) re-read stock and active holds from Supabase; (3) insert rows with `ON CONFLICT` on the partial unique indexes of §7 (a retried call after a crash inserts nothing twice); (4) record the result in DO storage; (5) return. Phase 4 routes `inv-session-select-stock`, `inv-session-add-jobs`, `inv-session-complete` and `inv-stock-adjust` (lib/inventory/index.js:488-508) through the DO once they run in `microns-site`/`microns-ops`, so all stock mutations of a material serialise. Extending `complete_nesting_session()` with reservation IDs and an over-consumption check is a separate, additive change proposed for P4-9.

## 7. Supabase schema sketch (Phase 4, P4-1)

File: `supabase/migrations/2026MMDD_agent_layer.sql` (applied by Dimitris; additive; regenerate `src/integrations/supabase/types.ts` as UTF-8). Existing tables that are reused and not duplicated: `rfqs`, `rfq_files`, `rfq_parts` (unused), `customers`, `orders`, `order_items`, `production_partners`, `materials`, `stock_items`, `stock_transactions`, `low_stock_alerts`, `inventory_settings`, `nesting_sessions`, `nesting_session_jobs`, `catalog_materials`, `app_settings`, `marketing_sender_accounts`, `marketing_events`. Helpers reused: `public.update_updated_at_column()` (supabase/migrations/20241202_create_articles_table.sql:39), `public.is_staff()` (supabase/migrations/20260806_phase2_rls_per_user.sql:30-39), default tenant `00000000-0000-0000-0000-000000000001` of `tenants` (supabase/migrations/20260407_create_multi_tenant_system.sql:20, :205). Sketch only: column types and checks are final at P4-1.

```sql
-- 1. agent_runs ---------------------------------------------------------------
-- Every table below also has: tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
-- REFERENCES public.tenants(id), and created_at / updated_at timestamptz NOT NULL DEFAULT now()
-- (written as "<common columns>" to keep the sketch short).
CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  <common columns>,
  agent            text NOT NULL,           -- flag key without 'agent.', e.g. rfq_intake, growth.reddit, mcp
  trigger          text NOT NULL CHECK (trigger IN ('email','cron','queue','workflow','dashboard','telegram','mcp','manual')),
  idempotency_key  text NOT NULL,
  workflow_name text, workflow_instance_id text, parent_run_id uuid REFERENCES public.agent_runs(id),
  subject_type text, subject_id uuid,       -- rfq, quote_workflow, order, inbound_email, article, ...
  status           text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','waiting_human','succeeded','failed','cancelled','skipped')),
  prompt_version   text,
  llm_calls int NOT NULL DEFAULT 0, input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0, cached_input_tokens int NOT NULL DEFAULT 0,
  cost_cents       numeric(12,4) NOT NULL DEFAULT 0,   -- USD cents
  approval_token   text UNIQUE,             -- single use, NULL when no approval is pending
  human_action     jsonb,                   -- {channel, actor, verb, decided_at}
  output jsonb, error text,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE (agent, idempotency_key)
);
CREATE INDEX agent_runs_agent_started_idx ON public.agent_runs (agent, started_at DESC);
CREATE INDEX agent_runs_subject_idx       ON public.agent_runs (subject_type, subject_id);
CREATE INDEX agent_runs_open_idx          ON public.agent_runs (status, started_at) WHERE status IN ('running','waiting_human');

-- 2. feature_flags -------------------------------------------------------------
CREATE TABLE public.feature_flags (
  key         text NOT NULL CHECK (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  <common columns>,
  enabled     boolean NOT NULL DEFAULT false,
  value       jsonb   NOT NULL DEFAULT '{}'::jsonb,   -- {mode, min_confidence, prompts, ...}
  description text, updated_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (key, tenant_id)
);

-- 3. pricing_rules -------------------------------------------------------------
CREATE TABLE public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  <common columns>,
  process        text NOT NULL CHECK (process IN ('cnc','sheet_metal','finishing','shipping','global')),
  rule_key       text NOT NULL,   -- e.g. laser_cut_per_m, bend_per_hit, setup_fixed, machine_rate_per_h, margin_pct, min_order_value
  material_match jsonb,           -- {category, grade, thickness_mm_min, thickness_mm_max}
  qty_min int, qty_max int,
  value numeric(12,4) NOT NULL, unit text NOT NULL, currency text NOT NULL DEFAULT 'EUR',
  version int NOT NULL DEFAULT 1, valid_from date NOT NULL DEFAULT current_date, valid_to date,
  is_active boolean NOT NULL DEFAULT true, notes text, updated_by uuid REFERENCES auth.users(id),
  UNIQUE (tenant_id, process, rule_key, version)
);
CREATE INDEX pricing_rules_active_idx ON public.pricing_rules (tenant_id, process) WHERE is_active;

-- 4. quote_workflows -----------------------------------------------------------
CREATE TABLE public.quote_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  <common columns>,
  rfq_id               uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  quote_version        int  NOT NULL DEFAULT 1,
  workflow_instance_id text NOT NULL UNIQUE,   -- quote-<rfq_id>-v<n>
  status               text NOT NULL DEFAULT 'started' CHECK (status IN ('started','cad_pending','pricing',
                         'awaiting_approval','approved','sent','follow_up','won','lost','counter_offer',
                         'expired','rejected','failed','cancelled')),
  current_step text, process text CHECK (process IN ('cnc','sheet_metal','mixed','other')),
  pricing              jsonb,                  -- {currency, lines[], rules_version, similar[], overrides[]}
  total_amount numeric(12,2), currency text NOT NULL DEFAULT 'EUR', quote_pdf_r2_key text,
  outbound_message_ids text[] NOT NULL DEFAULT '{}',
  resend_email_ids     text[] NOT NULL DEFAULT '{}',
  approved_by          text,                   -- 'user:<uuid>' or 'telegram:<chat>'
  approved_via         text CHECK (approved_via IN ('telegram','dashboard','mcp')),
  approved_at timestamptz, sent_at timestamptz, follow_ups_sent smallint NOT NULL DEFAULT 0,
  outcome_reason text, last_event_at timestamptz, error text,
  UNIQUE (rfq_id, quote_version)
);
CREATE UNIQUE INDEX quote_workflows_one_active_idx ON public.quote_workflows (rfq_id)
  WHERE status NOT IN ('won','lost','expired','rejected','failed','cancelled');
CREATE INDEX quote_workflows_status_idx ON public.quote_workflows (status, updated_at);
CREATE INDEX quote_workflows_msgids_gin ON public.quote_workflows USING gin (outbound_message_ids);

-- 5. inbound_emails ------------------------------------------------------------
CREATE TABLE public.inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  <common columns>,
  message_id         text NOT NULL,           -- RFC 5322 Message-ID as received
  message_id_sha256  text NOT NULL,           -- R2 prefix email/<sha>/
  mailbox            text NOT NULL CHECK (mailbox IN ('rfq','replies','gmail')),
  source             text NOT NULL DEFAULT 'email_routing' CHECK (source IN ('email_routing','gmail_poller')),
  sender_account_id  uuid REFERENCES public.marketing_sender_accounts(id),
  in_reply_to text, references_ids text[] NOT NULL DEFAULT '{}',
  from_email text NOT NULL, from_name text, to_email text, subject text,
  received_at timestamptz NOT NULL, raw_r2_key text, raw_size_bytes bigint,
  attachments        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{n, r2_key, filename, content_type, size_bytes, sha256, kind}]
  auth_results       jsonb,                   -- SPF/DKIM/DMARC verdicts
  kind               text CHECK (kind IN ('rfq','techpilot','reply','auto_reply','spam','other')),
  status             text NOT NULL DEFAULT 'received' CHECK (status IN ('received','parsed','needs_review',
                       'rfq_created','attached','matched','rejected','duplicate','spam','failed')),
  parsed jsonb, parse_confidence numeric(4,3), classification jsonb,   -- classification = {process, confidence}
  rfq_id             uuid REFERENCES public.rfqs(id) ON DELETE SET NULL,
  customer_id        uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  quote_workflow_id  uuid REFERENCES public.quote_workflows(id) ON DELETE SET NULL,
  agent_run_id uuid REFERENCES public.agent_runs(id), error text,
  UNIQUE (tenant_id, message_id_sha256)
);
CREATE INDEX inbound_emails_status_idx     ON public.inbound_emails (tenant_id, status, received_at DESC);
CREATE INDEX inbound_emails_in_reply_idx   ON public.inbound_emails (in_reply_to);
CREATE INDEX inbound_emails_message_id_idx ON public.inbound_emails (message_id);
CREATE INDEX inbound_emails_rfq_idx        ON public.inbound_emails (rfq_id);

-- 6. cad_jobs ------------------------------------------------------------------
CREATE TABLE public.cad_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  <common columns>,
  idempotency_key      text NOT NULL,          -- <input_sha256>:<job_type>:<params_sha256>
  job_type             text NOT NULL CHECK (job_type IN ('analyse','drawing_pdf','flat_dxf','flat_svg')),
  backend              text CHECK (backend IN ('vps','container','mac_mini')),
  rfq_id               uuid REFERENCES public.rfqs(id) ON DELETE CASCADE,
  rfq_file_id          uuid REFERENCES public.rfq_files(id) ON DELETE SET NULL,
  quote_workflow_id    uuid REFERENCES public.quote_workflows(id) ON DELETE SET NULL,
  input_r2_key text NOT NULL, input_sha256 text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb, output_r2_keys jsonb NOT NULL DEFAULT '[]'::jsonb, result jsonb,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dispatched','running',
                         'succeeded','failed','timed_out','dead_letter','cancelled')),
  attempts smallint NOT NULL DEFAULT 0, requested_by_run_id uuid REFERENCES public.agent_runs(id),
  enqueued_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  duration_ms int, error text
);
-- one job per (file bytes, type, params) and RFQ; a succeeded twin is reused (section 5)
CREATE UNIQUE INDEX cad_jobs_idem_idx  ON public.cad_jobs (rfq_id, idempotency_key);
CREATE INDEX cad_jobs_reuse_idx        ON public.cad_jobs (idempotency_key) WHERE status = 'succeeded';
CREATE INDEX cad_jobs_status_idx       ON public.cad_jobs (status, enqueued_at);

-- 7. stock_reservations --------------------------------------------------------
CREATE TABLE public.stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  <common columns>,
  order_item_id       uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  order_id            uuid NOT NULL REFERENCES public.orders(id),
  material_id         uuid NOT NULL REFERENCES public.materials(id),
  stock_item_id       uuid REFERENCES public.stock_items(id),     -- NULL = material-level hold
  area_mm2 numeric(12,2), quantity numeric(10,3),
  status              text NOT NULL DEFAULT 'held' CHECK (status IN ('held','committed','released')),
  release_reason      text CHECK (release_reason IN ('cancelled','consumed','expired','manual')),
  expires_at          timestamptz,
  nesting_session_id  uuid REFERENCES public.nesting_sessions(id),
  reserve_txn_id      uuid REFERENCES public.stock_transactions(id),
  held_by             text                     -- DO name <tenant_id>:<material_id>
);
CREATE UNIQUE INDEX stock_reservations_item_active_idx ON public.stock_reservations (order_item_id, stock_item_id)
  WHERE status IN ('held','committed') AND stock_item_id IS NOT NULL;
CREATE UNIQUE INDEX stock_reservations_material_active_idx ON public.stock_reservations (order_item_id, material_id)
  WHERE status IN ('held','committed') AND stock_item_id IS NULL;
CREATE INDEX stock_reservations_material_idx ON public.stock_reservations (material_id, status);

-- 8. New columns on existing tables ------------------------------------------------
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','email','techpilot','manual')),
  ADD COLUMN IF NOT EXISTS inbound_email_id uuid REFERENCES public.inbound_emails(id) ON DELETE SET NULL;
ALTER TABLE public.rfq_files
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','email','techpilot','manual')),
  ADD COLUMN IF NOT EXISTS r2_key text, ADD COLUMN IF NOT EXISTS sha256 text, ADD COLUMN IF NOT EXISTS content_type text;
CREATE UNIQUE INDEX IF NOT EXISTS rfq_files_rfq_sha256_idx ON public.rfq_files (rfq_id, sha256) WHERE sha256 IS NOT NULL;

-- 9. Exactly-once RFQ creation for an inbound e-mail (wraps the existing RPC) ------
CREATE OR REPLACE FUNCTION public.create_email_rfq(p_inbound_email_id uuid, p_payload jsonb, p_source text)
RETURNS TABLE(rfq_id uuid, rfq_number text, customer_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rfq uuid; v_num text; v_cust uuid;
BEGIN
  SELECT ie.rfq_id INTO v_rfq FROM public.inbound_emails ie
   WHERE ie.id = p_inbound_email_id FOR UPDATE;          -- serialises Workflow retries
  IF v_rfq IS NULL THEN
    SELECT c.id, c.rfq_number, c.customer_id INTO v_rfq, v_num, v_cust
      FROM public.create_public_rfq(p_payload) c;          -- customer match by e-mail, RFQ numbering
    UPDATE public.rfqs r SET source = p_source, inbound_email_id = p_inbound_email_id WHERE r.id = v_rfq;
    UPDATE public.inbound_emails ie SET rfq_id = v_rfq, customer_id = v_cust, status = 'rfq_created'
     WHERE ie.id = p_inbound_email_id;
  ELSE
    SELECT r.rfq_number, r.customer_id INTO v_num, v_cust FROM public.rfqs r WHERE r.id = v_rfq;
  END IF;
  RETURN QUERY SELECT v_rfq, v_num, v_cust;
END $$;
REVOKE ALL ON FUNCTION public.create_email_rfq(uuid, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_email_rfq(uuid, jsonb, text) TO service_role;
```

RLS sketch (identical for the seven new tables; service role bypasses RLS and is the only writer):

```sql
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['agent_runs','feature_flags','pricing_rules','quote_workflows',
                           'inbound_emails','cad_jobs','stock_reservations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff())', t || '_staff_select', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION public.update_updated_at_column()', t || '_updated_at', t);
    -- no INSERT, UPDATE or DELETE policies: writes only through microns-ops / microns-mail (service role)
  END LOOP;
END $$;
```

Notes on the sketch:

| Point | Note |
|---|---|
| `is_staff()` | It also returns true for tenant super admins (supabase/migrations/20260806_phase2_rls_per_user.sql:38), so it depends on tenant-role data. Staff read of these tables is acceptable for Phase 4 because agent actions never rely on it: approvals, flags and MCP check `user_roles` in `microns-site`/`microns-ops` (H-5 prerequisite, §1.3). |
| `rfqs.source` default | Existing rows become `web`; dashboard-created RFQs pass `manual` from Phase 4 (small change in the RFQ creation code, P4-12). |
| `rfq_files.file_path` | Stays NOT NULL (src/integrations/supabase/types.ts:715-725); agent rows set it to the `r2_key`. |
| Order of creation | `agent_runs`, `feature_flags`, `pricing_rules`, `quote_workflows`, `inbound_emails`, `cad_jobs`, `stock_reservations`, then the `ALTER TABLE` statements and the function (foreign keys point backwards only). |
| Realtime | None of the new tables joins the `supabase_realtime` publication; the dashboard polls. |
| Phase 7 | These tables move to D1 `microns-db` with the rest of the schema if Phase 7 proceeds (PLAN.md P7-1). |

## 8. Cost summary at planning load

Per-run figures from §3 at the §2.10 prices (USD, list prices — re-check at execution). Planning load: 10 RFQ e-mails, 5 quote versions, 1 order per day, 30-day month. [COSTS.md](COSTS.md) owns the monthly total with the Cloudflare plan costs.

| Agent | Runs per month | Cost per run | LLM per month |
|---|---|---|---|
| 1 Inbound RFQ e-mail | 300 | $0.04 | $12.00 |
| 2 Quote | 150 | $0.06 | $9.00 |
| 3 Post-order | 30 | $0.015 | $0.45 |
| 4 Growth (tenders with optional relevance; reddit, HN, xometry without LLM) | 30 tender runs | $0.02 | $0.60 |
| 5 Content pipeline | 30 | $0.32 | $9.60 |
| 6 Ops digest | 4–5 | $0.014 | $0.07 |
| 7 Remote MCP | — | ≈ $0 | $0 |
| **Total** | | | **≈ $32 per month** |

At today's volume (2 RFQs and 2 orders in the database, live 2026-09-30) the total is ≈ $10 per month, almost all of it the content pipeline, which runs today as direct provider calls. Both figures stay under the €50 cap proposed for PLAN.md Q20. Container minutes for CAD (Phase 5) add ≈ $0.01 per quote at most (§3.2).

## 9. Open points for this design

| # | Point | Where it is decided |
|---|---|---|
| 1 | Secret name for the signed Telegram → `microns-ops` call: proposed `AGENT_APPROVAL_SECRET` (not yet in the canonical secret lists of ARCHITECTURE.md and wrangler.jsonc.draft). Alternative: an Access service token only. | P4-12 |
| 2 | No canonical flag covers the Gmail poller's campaign-reply path; this design uses `agent.quote` `value.campaign_replies`. | P4-8 |
| 3 | DLQ backlog in the digest needs a read-only Cloudflare API token (Queues/analytics read); its secret name is not yet fixed. | P5-7 |
| 4 | Supplier e-mail addresses: `materials.supplier` is a name only (supabase/migrations/20260401_create_inventory_system.sql:53); reorder stays a draft the owner sends, unless a column is added (not in the P4-1 column list). | P4-9 |
| 5 | Two material models (`materials` for stock, `catalog_materials` with `price_per_kg` for pricing): a mapping is needed for pricing and reservation. | P4-7, P4-9 |
| 6 | Order item → quote line mapping by `product_name` must be checked against the portal's Accept Quote flow. | P4-9 |
| 7 | Google Ads offline conversions: no click ID is captured today; needs Ads API access and a capture method. | PLAN.md Q21 |
| 8 | Mac mini hostname, Tunnel and job types. | PLAN.md Q22 |
| 9 | Techpilot channel and the current RFQ mailbox. | PLAN.md Q3 |
| 10 | LLM budget cap and provider preferences. | PLAN.md Q20 |
| 11 | `McpAgent` vs `createMcpHandler`. | P4-11 |
| 12 | Whether Resend keeps a custom `Message-ID` header, and its idempotency-key behaviour. | P4-7 |
