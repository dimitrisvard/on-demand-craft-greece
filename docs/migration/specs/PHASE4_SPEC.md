# Phase 4 build spec: agent layer (P4-1 … P4-14), consolidated

Status: Phase 4 build specification · 2026-10-03, completed 2026-10-04, critique applied 2026-10-04 (Appendix C, "Critique log"; pre-critique copy `PHASE4_SPEC.pre-critique.md`) · scratch (not in the repo) · nothing here is deployed, committed or applied.

Related (repo): docs/migration/PLAN.md §5.4 (authoritative task list, file list, exit gate: PLAN.md:308-357) and §5.5 (PLAN.md:362-409) · docs/migration/AGENTS.md (agent designs §3, framework §2, reply attribution §4, CAD contract §5, MaterialStock §6, schema sketch §7, open points §9) · docs/migration/ARCHITECTURE.md · docs/migration/wrangler.jsonc.draft · COSTS.md · RISKS.md · INVENTORY.md. Related (scratch): `../phase2/PHASE2_SPEC.md` (the layout this builds on), `../phase2/gates_PRIVATE.md`, `../phase5/PHASE5_SPEC.md` (written 2026-10-03 against the annexes; the names it imports from Phase 4 are kept, §9); canon `CANON.md` + `CANON_ADDENDUM.md` (cd2d8729 scratchpad).

Annexes (same folder; this spec cites them as **[data]**, **[agents]**, **[surfaces]**):

| Annex | Content | Precedence |
|---|---|---|
| `data.md` + `agent_layer.sql`, `agent_layer_down.sql`, `pglite/*` | P4-1 migration (883 lines, 366 assertions green on Postgres 18.3 and 16.4), P4-2 flag table and KV mirror | Detailed design for unit DB |
| `agents.md` | P4-3…P4-9, P4-13: step tables, ports, CAD contract, pricing, PDF, replies, post-order | Detailed design for units K, IN, CQ, RP |
| `surfaces.md` | P4-10…P4-12: remote MCP, dashboard pages, Telegram relay, scrapers | Detailed design for units W, XZ |

**This spec wins wherever an annex differs.** Every difference is listed in §2 (conflict resolutions). A builder reads this spec first, then the annex sections named in its unit card (§5).

> **Handling.** §0–§15 and Appendix C follow the public-repo rules of CANON.md §1 (no secret values, security at summary level, rules stated as rules, never as descriptions of today's weaknesses). They may be quoted in repo docs, READMEs, commit messages and PRs. **Appendix P is PRIVATE**: never copy it, or the annexes' private sections (`data.md` §14, `agents.md` Appendix P, `surfaces.md` Appendix P), into the repository, a commit message, a PR, a code comment or a log line. The GitHub repository is public (PLAN.md:47).

Evidence tags:

| Tag | Meaning |
|---|---|
| `path:line` | Repo at branch `claude/microns-cloudflare-migration-j6ffpt`. Citations outside `workers/` were checked at `90d2391` (2026-10-03, "phase1: close Phase 1 code work") and re-checked at HEAD `91f1376` (2026-10-04 07:31 UTC, "wip(phase2): unit builds in progress"); `90d2391..91f1376` adds only `workers/{ops,shared,site}/**` files of Phase 2 (`git diff --stat 90d2391 HEAD`, 64 files, all under `workers/`). The annexes cite `ca87d83`; between `ca87d83` and `90d2391` only `docs/migration/{ARCHITECTURE,PLAN,RISKS,SEO_PARITY}.md`, `scripts/seo-parity/**`, `tests/e2e/**` and `workers/site/README.md` changed, so every other annex citation is still exact. PLAN.md citations here use HEAD line numbers |
| `agent_layer.sql:n` | Scratch DDL of unit DB (`phase4/agent_layer.sql`) |
| live 2026-10-03 | Read-only Supabase MCP (`execute_sql` SELECT, `get_edge_function`) on project `cfjrtmtaitwzggzpkhxi`; aggregates and catalogue only, no row contents or credentials |
| CF docs (fetched 2026-10-03) | developers.cloudflare.com pages fetched on that date; copies in `phase4/cfdocs/` (file name = doc path with `/` → `_`) |
| skill (2026-10-03) | Bundled `claude-api` skill, model table cached 2026-09-25, read on 2026-10-03 |
| probe 2026-10-03 | Local runs without a Cloudflare account: `phase4/probe/PROBE_NOTES.md` (#1-#14, wrangler 4.145.0 `--local`), `phase4/mcpprobe/PROBE_NOTES.md` (#1-#10) |
| probe 2026-10-04 | `phase4/topoprobe/PROBE_NOTES.md` T-1…T-7 (three-Worker `wrangler dev` topology, Local Explorer mail and cron injection) and its "Inline CAD parser memory" table (`phase4/memprobe`, Node 22.22.2); `phase4/mcpprobe/vt` (vitest 5.0.3 loading `agents/mcp`, `.md` and `.ttf` modules; configs `vitest.inline.config.mjs`, `vitest.rules.config.mjs`) |
| P2 tree | The landed Phase 2 code is the uncommitted working tree on top of `91f1376` (read 2026-10-04 08:55-09:10 UTC); its line numbers may move before the Phase 2 closing commit, the patterns cited stay |
| P2 §x / F-n | `PHASE2_SPEC.md` section / fixed decision |

---

## 0. Scope and ground rules

| # | Rule | Evidence |
|---|---|---|
| R-1 | In scope: P4-1…P4-13 as code and tests; P4-14 is the owner's end-to-end run with Claude's evidence. P4-3, P4-4, P4-11 have owner parts (dashboards, DNS, Access), collected in §12 | PLAN.md:314-327 |
| R-2 | Phase 4 code is built on top of the commit that closes Phase 2 (owner instruction: coding phases are built back to back; deploys and the Phase 3 gate are owner steps at the end, §12). Phase 2 is being built now: Wave 0 is committed (`b9e6fbc`, 2026-10-04) and unit work is in `91f1376` ("wip(phase2)") plus the uncommitted working tree, which already holds `workers/ops/src/{index,app,env}.ts`, `queues/{messages,scrapes}.ts` and the Phase 2 tests cited in §7.2 (read 2026-10-04 09:00 UTC). Phase 4 builders start only after the Phase 2 closing commit, adapt to the landed Phase 2 code inside their own files when it differs from P2 §2 (reporting the difference), and never stage, revert or reformat another unit's files | PLAN.md:42, :356; P2 G-4; `git log` 2026-10-04 |
| R-3 | Phase 2 ground rules G-1…G-9 apply unchanged: one owner unit per file; no deploys, uploads, `secret put`, `queues create`, `vectorize create`; never call `www.micronshub.eu`, the apex or `*.vercel.app` (this runner gets 429 challenge pages); never call Supabase with a real key from a test; no secret-looking literals; log prefixes `[microns-ops]`, `[microns-site]`, new `[microns-mail]`; toolchain pins wrangler 4.145.0, vitest 5.0.3, TypeScript 7.0.2, `@cloudflare/workers-types` 5.20260930.2, `compatibility_date` 2026-09-01, `nodejs_compat`, Node 22 (22.22.2 in this container); British spelling; no emojis | P2 §0 G-1…G-9 |
| R-4 | Every external effect (LLM, embeddings, Vectorize, CAD backend, Browser, Resend, Telegram, Gmail, Supabase, R2, Analytics Engine, clock) sits behind a port with a production implementation, a T1 fake and a T2 stub path (§6). The whole agent layer is built and tested without a Cloudflare account and without any real provider | [agents] R-4; CF docs (fetched 2026-10-03) https://developers.cloudflare.com/workers/development-testing/ (no local simulation for Workers AI, Vectorize, Browser Run) |
| R-5 | Supabase stays the system of record. Agents write with the service role from `microns-ops` and `microns-mail` only. The LLM never sets a price, sends mail or calls a writing tool | AGENTS.md:36-46 |
| R-6 | Staff checks use the four `user_roles` staff roles (`admin`, `sales_rep`, `production_manager`, `accountant`), never a tenant role | PLAN.md:310; AGENTS.md:44; agent_layer.sql:55-68 |
| R-7 | No business rate, margin, price, customer or recipient address is committed: rates live in `pricing_rules` rows the owner enters, addresses in secrets or database rows | AGENTS.md:102; CANON.md §1 |
| R-8 | Read-only towards production: no Supabase write, no migration apply, no edge-function deploy, no Cloudflare resource creation during the build. All of those are owner steps (§12) | task brief; PLAN.md:44 |
| R-9 | Citations: every factual statement in code comments, READMEs and PR text cites `path:line`, a live query date or a doc URL with fetch date, in the public wording of CANON.md §1 | CANON.md §1 rule 5 |
| R-10 | Several Phase 2 tests pin exact shapes (config keys, vars, queues, dependencies, endpoint and principal unions, action-ID counts, `.dev.vars.example` names, a zero-argument default `fetch`). Phase 4 changes them only at the test extension points of §7.2, and only by adding expectations for Phase 4 items: every Phase 2 expectation stays as written. G4-10 checks that no other Phase 2 test file changed | workers/ops/test/config.test.ts:60-65, :77-98, :114-128; workers/shared/test/http/rpc.test.ts:6-22; workers/site/test/policy.test.ts:9-31; workers/site/test/env-api.test.ts:228-246; workers/ops/test/ops-api.test.ts:46-50 |

---

## 1. Fixed decisions (architecture; each open point resolved to the plan's recommended default)

| ID | Decision | Reason (one line) | Source |
|---|---|---|---|
| F4-1 | All Phase 4 code lives in `microns-ops` (`workers/ops/src/{agents,workflows,do,queues,cron,cad,pricing,pdf,mail-in,mail-out,replies,mcp,scrapers,ports,db,routes}`) and the new package `workers/mail`; `workers/shared` gains types and two pure helpers only | PLAN.md file list; P2 F-1 package layout | PLAN.md:329-344; P2 F-1 |
| F4-2 | `microns-mail` calls `microns-ops` through service binding `OPS` with the **named entrypoint `MailIngest`** (methods `startIntake`, `ingestReply` only); `OpsApi` stays the only path for `/api/*` | Least privilege: the mail Worker can never present a principal; probe ran this exact shape | [agents] A-2; probe #1-#2 |
| F4-3 | `microns-mail` stores raw MIME in R2 and inserts the `inbound_emails` row itself (canonical secret `SUPABASE_SERVICE_ROLE_KEY`); the `*/10` dispatcher restarts rows left in `received` | Mail is never lost when ops is down or deploying | CANON.md §3 (mail bindings); [agents] A-3 |
| F4-4 | Durable Objects use the `migrations` form, tag `v1` = `RfqThread`, `MaterialStock`, `CadRouter`. No `MicronsMcp` class (F4-12); Phase 5 adds `SenderLimiter` and `CadContainer` in tag `v2` | A tag is never edited after deploy; the draft forbids mixing forms | wrangler.jsonc.draft:394-405; [agents] A-4 |
| F4-5 | LLM calls: `@anthropic-ai/sdk` 0.131.0 `messages.parse` with `jsonSchemaOutputFormat` against the AI Gateway **provider-native** Anthropic endpoint (`baseURL = await env.AI.gateway('microns').getUrl('anthropic')`), keys stored in the gateway (BYOK, `x-api-key` omitted), authenticated gateway (`cf-aig-authorization`) | Native Messages API keeps structured outputs, caching and `usage`; dynamic routes take the OpenAI shape only | [agents] A-5; sdkprobe `package/client.js:316-340`; CF docs (fetched 2026-10-03) https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/ |
| F4-6 | Routes: `extract` = `claude-sonnet-5-5` (list $2.00 / $10.00 per MTok, cache read $0.20), `classify` = `claude-haiku-4-5` ($1.00 / $5.00), `embed` = `@cf/baai/bge-m3` (1,024 dims), `translate` Phase 5 only | Route classes fixed by CANON; model IDs and prices from the skill | CANON.md §8; skill (2026-10-03) model table |
| F4-7 | `extract` calls send server-side fallback `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` (Claude API form for Sonnet 5.5); if the gateway path rejects it at O4-3, the client drops both fields and treats `refusal` as a human card | Skill default for Sonnet 5.5; gateway behaviour unverified | skill (2026-10-03) "Refusal fallbacks", model-migration § Sonnet 5.5 |
| F4-8 | Payload logging off for every call with customer data (`cf-aig-collect-log-payload: false`); metadata logged (5 `cf-aig-metadata` keys: `agent`, `run_id`, `tenant_id`, `step`, `prompt`) | Data minimisation with cost visibility | [agents] A-7; AGENTS.md:73-77 |
| F4-9 | Quote and traveller PDFs: `pdf-lib` 1.17.1 (resolved from the root install, one copy in the bundle) + `@pdf-lib/fontkit` 1.1.1 + Liberation Sans Regular/Bold (SIL OFL 1.1) embedded with `subset: true`; layout ported from the dashboard offer template | Standard fonts cannot encode Greek; the dashboard PDF is browser-only code | probe #9-#10; src/pages/RfqDetails.tsx:1024-1366; `/usr/share/fonts/truetype/liberation/` (OFL 1.1 per `/usr/share/doc/fonts-liberation/copyright`) |
| F4-10 | Quote mail through Resend from `MicronsHub Quotations <info@micronshub.eu>`, `Reply-To: replies@rfq.micronshub.eu`, our own `Message-ID`, `Idempotency-Key`; Resend's `message_id` is read back with `GET /emails/{id}` and both ids are stored | Same identity as today; whether Resend keeps a custom Message-ID is undocumented | api/emails.js:293; [agents] A-9 |
| F4-11 | `CadRouter` is a lease and health coordinator; the `cad-jobs` consumer executes. `HttpUnfoldBackend` serves the existing unfold service now and the Phase 5 Container (only the fetcher changes); DXF, STL and CNC geometry run on an inline TypeScript backend ported from the edge-function parsers, one inline job per isolate, with per-kind input caps that fit the 128 MB isolate (§4.12) | Keeps CPU out of the single-threaded DO; the unfold service accepts STEP only; the parsers hold the whole input and its derived structures in memory | sheet-metal-service/main.py:263, :398; [agents] A-10, A-11; probe 2026-10-04 (memprobe) |
| F4-12 | Remote MCP uses the Agents SDK **stateless `createMcpHandler`** with an MCP SDK v2 server factory `createMicronsMcpServer()`; no Durable Object, no `MCP_OBJECT` binding | `McpAgent` is deprecated and feature-frozen | CF docs (fetched 2026-10-03) https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/; [surfaces] SF-1 |
| F4-13 | MCP authentication = Cloudflare Access "MCP server" application with Managed OAuth; the Worker verifies `Cf-Access-Jwt-Assertion` and maps the e-mail to a `user_roles` staff role through RPC `agent_staff_for_email` | No OAuth code or `MCP_OAUTH_*` secrets in the Worker | [surfaces] SF-3; CF docs (fetched 2026-10-03) https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/ |
| F4-14 | Approval decisions: one endpoint `POST /api/agent/decision`; dashboard sends `run_id` + `token_sha256` under a staff JWT, the Telegram relay sends the raw token + a button code under an HMAC; both end in one `decide()` in ops | The database stores only the token hash | agent_layer.sql:91, :652-664; [surfaces] SF-7 |
| F4-15 | Flags: `feature_flags` table is the source of truth from the first sync tick; KV `FLAGS` mirror by revision every minute plus write-through on edits; ops reads agent flags with `cacheTtl: 30`, fail closed | Exit gate 3 (switch-off ≤ 2 min) | [data] §4; PLAN.md:350 |
| F4-16 | Every run (Workflow, consumer, cron tick with an effect, MCP tool call) has one `agent_runs` row opened through `rpc/agent_run_begin` and closed with status, usage and `cost_cents`; a failed Workflow run waits for a human on a `failure` card (`waiting_human`, `parked_reason = 'failed'`, §4.7) until Retry or Dismiss | Exit gate 4; a failure card needs a token, which the schema allows only on `waiting_human` rows | PLAN.md:351; agent_layer.sql:105, :108-109, :625-664 |
| F4-17 | Scrapers: new module with a robots.txt gate that fails closed and a Browser Run path only for client-rendered pages of owner-permitted hosts; flag `agent.growth.scrapers` stays off; the Phase 2 plain-fetch handlers stay byte-identical | Fetching third-party directories follows their robots.txt and published terms, with permissions the owner records (OW-24); Phase 2 parity | [surfaces] SF-12; robots (fetched 2026-10-03) `phase4/robots/*` |
| F4-18 | `api/*` stays untouched: the scraper parsers are **ported** into `workers/ops/src/scrapers/parsers/*.ts` with a byte-equality test against the Vercel handlers run through the Phase 2 shim | Owner constraint "api/* unchanged" (overrides [surfaces] D-Z5, §2 CR-20) | task brief; P2 G-3 |
| F4-19 | Dashboard: two lazy routes `/dashboard/rfq-inbox`, `/dashboard/approvals`; reads through supabase-js under staff RLS; actions only through `/api/agent/*` after a successful `GET /api/agent/status` probe; "not installed" state when the tables are missing | Pages reach Vercel production on merge before the agent layer exists | [surfaces] §6.2; PostgREST errors (fetched 2026-10-03) `PGRST205`, `42P01` |
| F4-20 | Telegram callbacks in `telegram-leads-bot` from the live v6 source plus one new module `agent-callback.ts`; `callback_data = ap:<token>:<code>` (≤ 34 bytes) | Telegram limit 1-64 bytes; live source differs from the repo copy | [surfaces] SF-11; live 2026-10-03 (`get_edge_function` v6) |
| F4-21 | Agent stubs are selected by var `AGENT_STUBS` that only generated T2 configs set; production config never has it; a runtime guard and the bundle check refuse it | One code path, explicit seams | [agents] A-19 |
| F4-22 | Workflow params and step results carry ids and compact JSON only (no e-mail bodies or addresses); instance state is kept 30 days by Cloudflare | Data minimisation | CF docs (fetched 2026-10-03) https://developers.cloudflare.com/workflows/reference/limits/ |

---

## 2. Conflict resolutions between the annexes (binding)

| # | Topic | [data] says | [agents] says | [surfaces] says | Resolution (this spec) |
|---|---|---|---|---|---|
| CR-1 | Stock RPC names | `stock_hold(p_order_item_id, p_material_id, p_holds, p_expires_at, p_held_by)`, `stock_commit`, `stock_release` (agent_layer.sql:669-783, tested) | `stock_reserve(…, p_holder)` (S-2) | — | **[data] names and signatures.** `MaterialStock.reserve()` calls `rpc/stock_hold` with `p_expires_at = now + 14 d`, `p_held_by = '<tenant_id>:<material_id>'` |
| CR-2 | Approval claim | `agent_run_claim_approval(p_token_sha256, p_human_action)`, no verb check (agent_layer.sql:652-664) | `claim_approval(p_token, p_verb, …)` with verb check (S-7) | verb check in `decide()` before the claim (X-2) | **[data] RPC; `decide()` checks the verb against `output.allowed_verbs` before claiming** (§4.14) |
| CR-3 | Raw token in the database | hash only (D-3) | hash ("Token storage" row) | hash; dashboard sends the hash | **Hash only.** Dashboard body carries `token_sha256`; relay body carries the raw token |
| CR-4 | `rfq_files (rfq_id, sha256)` | full unique constraint (D-11) | asks for non-partial index (S-1) | — | Done in [data]; no action |
| CR-5 | Order creation on "won" | — | RPC `create_order_from_quote` (S-3) | — | **Added to P4-1 as AM-4** (§4.13): same effects as the portal Accept Quote (src/pages/customer/QuoteDetailPage.tsx:396-449) in one transaction, idempotent per RFQ |
| CR-6 | Quote drafts and PDF hash | — | `quote_workflows.drafts`, `pdf_sha256` (S-4) | reads `drafts` defensively | **Added as AM-2** (columns on a new table) |
| CR-7 | `materials.catalog_material_id` | no new `materials` columns (decision 21) | add the column (S-5) | — | **[data] wins: no change to `materials`.** `reserve-stock` maps a quote line to `materials` in code (exact normalised grade and thickness ± 0.05 mm, exactly one active row, else "not stocked"); live `materials` has 0 rows (live 2026-10-03) |
| CR-8 | Parked runs | — | `agent_runs.parked_reason` (S-6) | — | **Added as AM-3** (column on a new table) |
| CR-9 | CAD backend `inline` | `cad_jobs.backend` CHECK allows `vps`, `container`, `mac_mini` (agent_layer.sql:461) | inline backend writes `backend = 'inline'` | — | **AM-1: CHECK gains `inline`** (new finding of this consolidation) |
| CR-10 | e-mail → staff roles for MCP | — | — | RPC `agent_staff_for_email` (X-9) | **Added as AM-5** |
| CR-11 | `zod` in `workers/ops` | — | 3.25.76 | 4.6.5 (X-3; `agents` peers need `^4`) | **4.6.5** for the whole ops package; `@anthropic-ai/sdk` 0.131.0 accepts `^3.25.0 \|\| ^4.0.0` (sdkprobe `package/package.json:24`). Prompt schemas are JSON Schema files, not zod |
| CR-12 | Flag reader | `cacheTtl: 30` for agent flags | `readAgentFlag`, `cacheTtl: 60`, `agent.*` keys only | `readFlag` for `mcp.remote` too (X-11) | **`readFlag(env, key)`** plus the alias `readAgentFlag` (kept for annex text; Phase 5 imports `readFlag`, PHASE5_SPEC §3.1 and CD5-1), `cacheTtl: 30`, any `agent.*` key or `mcp.remote`, fail closed |
| CR-13 | Decision body | — | `{token, verb, edits?, note?}` | dashboard `{v, run_id, token_sha256, verb, edits?, note?}`, relay `{v, token, code, tg}` | **[surfaces] shapes** (§4.4) |
| CR-14 | Quote verb `edit` | — | `approve`, `reject`, `edit` | `approve` + `edits` (X-13) | **No `edit` verb.** `approve` with optional `edits` (dashboard only) |
| CR-15 | Actor format | `approved_by` CHECK `user:<uuid>` or `telegram:<id>` (agent_layer.sql:361) | `tg:<from.id>` | `tg:<user id>` | **`telegram:<from.id>`** everywhere, so `quote_workflows.approved_by` accepts it |
| CR-16 | `rfq_files.file_path` of agent rows | — | `file_path = r2_key` | without the leading `rfq/` (X-1) | **`file_path = <rfq_id>/<file_id>-<safe-name>`, `r2_key = rfq/<rfq_id>/<file_id>-<safe-name>`**: the Phase 2 files API prefixes `rfq/` (P2 F-10) and the RFQ page presigns `file_path` (src/utils/awsS3Storage.ts:59-66) |
| CR-17 | `inbound_emails.body_excerpt` | column exists, ≤ 4,000 chars (agent_layer.sql:394) | no writer | intake writes it (X-5) | **Intake step `parse-and-store` writes the first 4,000 characters of the quote-stripped plain text** |
| CR-18 | `/api/agent/*` and `api.forward_to_vercel` | — | — | never forwarded (X-6) | **Never forwarded** (site `forward.ts` extension point, §7) |
| CR-19 | Decision logic location | — | in `routes/agent.ts` | factor into `decide()` (X-8) | **`workers/ops/src/agents/decision.ts` `decide()`**, used by the route and MCP `decide_approval` |
| CR-20 | Scraper parsers | — | — | named exports added to `api/scan-directory.js`, `api/scrape-company-profile.js` | **No change to `api/*`** (F4-18): parsers ported, byte-equality test |
| CR-21 | Scrape rule validators | — | — | move to `workers/shared/src/auth/scrape-rules.ts` and rewire the site policy (X-10) | **New shared module for MCP in-process calls; the site gate's scrape rows stay as Phase 2 built them.** A shared vector file is run against both (consolidation is a Phase 6 clean-up, as P2 F-3) |
| CR-22 | Card fields | — | card built per step | `output.card_kind`, `allowed_verbs`, `card`, `telegram_message_id` (X-12) | **[surfaces] fields** written by `approval.request()` (§4.14) |
| CR-23 | Principal of the relay | — | `MACHINE:telegram` | `Principal.machine` gains `'telegram'` (X-14) | **Accepted**; `rpc.ts` extension point owned by K |
| CR-24 | `reply_pick` verbs on Telegram | — | `attach_1`…`attach_3`, `new_rfq`, `ignore` | only `new_rfq`, `ignore` have codes | **Codes `a1`, `a2`, `a3` added** (candidates are stored in `output.candidates`, no input needed); `change_partner` stays dashboard-only |
| CR-25 | Owner of the T2 stubs | — | unit T | — | **Unit K** owns the harness extension and the stub modules, except `stubs/postgrest.mjs` (unit DB, implements the SQL semantics) and `stubs/unfold.mjs` (unit CQ) |
| CR-26 | `pdf-lib`, `@supabase/supabase-js` in ops | — | pdf-lib in ops `package.json` | supabase-js 2.101.1 in ops `package.json` | **Resolved from the root install** (pdf-lib 1.17.1, supabase-js 2.101.1, root `node_modules` 2026-10-03) so the bundle holds one copy next to `lib/inventory` and `api/*`; `check-bundle` asserts a single copy |
| CR-27 | Run opening | `agent_run_begin` RPC | INSERT … ON CONFLICT then SELECT | `agent_run_begin` | **`rpc/agent_run_begin`** |
| CR-28 | MCP audit keys | `agent` pattern allows `mcp` | — | `agent = 'mcp'`, `trigger = 'mcp'` | Accepted (agent_layer.sql:98-99) |
| CR-29 | Phase 2 `inv-*` through `MaterialStock` | — | not in Phase 4 (D4-17) | — | Accepted: inventory tables are empty (live 2026-10-03) |
| CR-30 | Sidebar gating | — | — | "shown when `isAdmin()`" | **Correction:** `PersistentDashboardLayout.tsx` gates Operations entries with `!isProductionPartner && !isTenantAdminUser` (src/components/dashboard/PersistentDashboardLayout.tsx:51-53, :267, :503) and never calls `isAdmin()`. The two new entries use that same gate plus `isAdmin()` from `useAuth()` (src/contexts/AuthContext.tsx:263-265) |
| CR-31 | Test harness for SQL in the repo | `pglite/live_min.sql` recreates live objects including grants | — | — | **Repo copy is sanitised** (Appendix P.1): `supabase/tests/agent_layer/live_min.sql` keeps columns, constraints, functions and the policies already public in repo migrations, nothing else |
| CR-32 | T2 command | — | `npm --prefix workers/site run test:integration -- …` | same | **`npm --prefix workers/ops run test:integration:agents`** (profile `agents`, §6.3); the Phase 2 `test:integration` scripts keep their meaning |
| CR-33 | Phase 4 secrets in `secrets.required` | — | ops adds `AI_GATEWAY_TOKEN`, `CAD_UNFOLD_URL`, `CAD_SHARED_SECRET` ([agents] §17.1) | site adds `AGENT_APPROVAL_SECRET` ([surfaces] §10.2) | **None added** in either Worker; names checked per use (P2 F-22), so an unrelated deploy never fails for agent config (DF-72). Because wrangler loads only the `secrets.required` names from `.dev.vars` when the list exists, the T2 profile `agents` appends the Phase 4 names to `secrets.required` in its **generated** configs only (§6.3) |
| CR-34 | `AgentKey` location | — | `agents/runs.ts` ([agents] §4.4) | — | **`workers/ops/src/agents/runs.ts`** (PHASE5_SPEC §3.2, re-read 2026-10-04 09:05 UTC: K5 adds its eleven keys there); `workers/shared` carries `FlagKey` and the cross-Worker types only |
| CR-35 | Owner of `workers/shared/src/agent-api.ts`; relay unit | — | — | W writes it; separate unit L for the relay | **K writes it in Wave 0** (every unit codes against it); the relay belongs to unit W |
| CR-36 | Eval runner and MCP parity script | — | `node eval/run-eval.mjs` | `node scripts/mcp-parity.mjs` | **vitest entry points** (`eval:synthetic`, `mcp:parity`): ops sources use extensionless TypeScript imports that plain Node cannot resolve (DF-77) |
| CR-37 | Failure path of a Workflow run | `failed` ⇒ `finished_at` set and no approval token (agent_layer.sql:105, :108-109); the claim matches `waiting_human` only (:652-664) | `fail-run` sets `failed` and posts a card with Retry (agents.md:631) | `failure` card with `retry`/`dismiss` | **`failRun()` (§4.7):** the run stays `waiting_human` with `parked_reason = 'failed'` (AM-3 CHECK gains `failed`), `error` set, token hash and `output.{card_kind:'failure', failed_step, …}`; Retry = claim + `instance.restart({from:{name: failed_step}})`; Dismiss = claim + `closeRun` `failed` (DF-82) |
| CR-38 | Flood-control outcome | `needs_review` exists only for `inbound_emails.status` (agent_layer.sql:417-418) | runs "end as `needs_review`" (agents.md:1334) | — | **`closeRun` `skipped`, error `daily_cap`**, no LLM call; intake also sets its `inbound_emails` row to `needs_review` (re-runnable from the inbox, surfaces.md:438) |
| CR-39 | Inline CAD input cap | — | 40 MB inline cap (A-10) | — | **Per-kind caps STEP 5 MB, DXF 3 MB, STL 0.75 MB; one inline job per isolate** (§4.12, DF-81): measured peak memory of the unchanged parsers exceeds the 128 MB isolate far below 40 MB (probe 2026-10-04, memprobe) |
| CR-40 | Typing of the Phase 4 ops env | — | required bindings and vars on `OpsEnv` ([agents] §4.2) | — | **Every Phase 4 field of `OpsEnv` is optional** (P2 F-22 pattern) and checked per use with `need()` (§4.2): Phase 2 test helpers build `OpsEnv` literals with Phase 2 fields only (workers/ops/test/helpers/ops.ts:37-53), and Phase 5 passes `OpsEnv` to Phase 4 functions (PHASE5_SPEC §5) |

---

## 3. Layout and file ownership

### 3.1 Units (one builder each; 7 builders, disjoint files)

| Unit | Builder scope | PLAN tasks | Annex sections |
|---|---|---|---|
| **DB** | migration + amendments, SQL tests, flag mirror cron, mini-PostgREST stub, types regeneration procedure | P4-1, P4-2 | [data] all; this spec §4.13 |
| **K** kernel | ops scaffold and config, shared contracts, ports, run records, flags reader, AI Gateway client, prompt registry, approval and decision core, Analytics Engine, eval runner, T2 harness extension and provider stubs | P4-3, P4-13 (+ cross-cutting) | [agents] §4, §6, §7, §13, §14, §15; [surfaces] §4.3-§4.4 |
| **IN** inbound | `microns-mail` package, `MailIngest`, `mail-in/*`, `RfqIntakeWorkflow`, `RfqThread` | P4-4, P4-5 | [agents] §5, §8 |
| **CQ** CAD + quote | `CadRouter`, `cad-jobs` consumer, CAD backends, pricing calculator, Vectorize use, quote PDF, Resend client, `QuoteWorkflow` | P4-6, P4-7 | [agents] §9, §10 |
| **RP** replies + post-order | reply attribution, `agent-events` consumer, Gmail poller, `*/10` dispatcher, `PostOrderWorkflow`, `MaterialStock`, traveller PDF | P4-8, P4-9 | [agents] §11, §12 |
| **W** web + relay | site `/api/agent/*` resolver/gate/forward rows, ops `agent-admin` actions, dashboard pages, Telegram relay | P4-12 | [surfaces] §4, §6, §7 |
| **XZ** MCP + scrapers | remote MCP on `mcp.micronshub.eu`, scraper module, `directory-scan` queue kind | P4-10, P4-11 | [surfaces] §5, §8 |

### 3.2 Tree and owners (`+` new, `~` changed, `=` unchanged; Phase 1/2 files may change only at the extension points of §7.2)

```
.gitattributes                                    + DB   src/integrations/supabase/types.ts text eol=lf
supabase/
  migrations/<yyyymmdd>_agent_layer.sql           + DB   agent_layer.sql + AM-1…AM-5 (§4.13); date = day of application
  rollback/<yyyymmdd>_agent_layer_down.sql        + DB   outside migrations/ so no tool runs it
  tests/agent_layer/{package.json,package-lock.json,live_min.sql,test.mjs,flags-sync.mjs,README.md}   + DB   (live_min.sql sanitised, CR-31)
  functions/telegram-leads-bot/index.ts           ~ W    live v6 source + one callback branch
  functions/telegram-leads-bot/agent-callback.ts  + W
src/integrations/supabase/types.ts                ~ DB   regenerated only after the owner applied the migration (§12 OW-6), separate commit
src/App.tsx                                       ~ W    2 lazy imports + 2 routes
src/components/dashboard/PersistentDashboardLayout.tsx   ~ W   2 nav entries (desktop and mobile) + getActiveModule
src/pages/dashboard/{RfqInboxPage,ApprovalsPage}.tsx     + W
src/pages/dashboard/agent/{ApprovalCard,QuoteApprovalEditor,AgentSwitches,AgentActivity,NotInstalled}.tsx   + W
src/utils/agentApi.ts, src/lib/agentDb.ts, src/types/agent.ts   + W
tests/frontend-api/{agentApi,agentDb}.test.ts     + W
tests/edge/{vitest.config.mjs,telegram-callback.test.ts}   + W
tests/e2e/agent-dashboard.spec.ts                 + W
mcp-server/README.md                              ~ XZ   "Remote MCP" section only (mcp-server/src unchanged)
mcp-server/.gitignore                             + XZ   `build/` (output of the XZ-3 parity build stays untracked)
scripts/eval/README.md                            + K    how the owner runs the private golden set (no data)
.github/workflows/cf-mail.yml                     + IN   workflow_dispatch only (pattern of cf-ops.yml)
.github/workflows/cf-ops.yml                      ~ K    header comment only (§7.2)
workers/shared/
  src/http/rpc.ts                                 ~ K    EndpointId + 'agent'; Principal.machine + 'telegram'
  test/http/rpc.test.ts                           ~ K    expected unions gain 'agent' and 'telegram' (§7.2; typecheck-only test)
  src/agent-types.ts                              + K    §4.3
  src/agent-api.ts                                + K    §4.4 (bodies, results, verb/code table)
  src/auth/scrape-rules.ts, src/limit.ts          + XZ
  test/agent-api.test.ts, test/fixtures/agent-api/*.json   + K
  test/{scrape-rules,limit}.test.ts, test/fixtures/scrape-rules.json   + XZ
workers/site/                                     (Phase 1/2 package)
  src/api/{resolve,router}.ts                     ~ K→W  Wave 0: K adds the two stub lines that keep the exhaustive tables compiling (§3.3); then W: endpoint 'agent' (§4.14), body cap 64 KiB
  src/api/forward.ts                              ~ W    never forwarded under /api/agent/
  src/auth/{gate,policy}.ts                       ~ W    ActionId AG-1…AG-7 and their rows
  src/auth/agent-hmac.ts                          + W    relay HMAC check; `AgentSiteEnv extends Env { AGENT_APPROVAL_SECRET?: string }` (§4.2)
  src/env.ts                                      =      unchanged (the env-api test pins its Phase 2 section, workers/site/test/env-api.test.ts:228-238)
  wrangler.jsonc                                  =      unchanged: AGENT_APPROVAL_SECRET is optional and not in secrets.required (§5 unit W)
  scripts/check-bundle.mjs                        ~ W    forbidden list gains the agent packages and workers/ops sources (§7.2)
  test/policy.test.ts                             ~ W    action-ID count 34 → 41 and expectations for AG-1…AG-7; Phase 2 expectations unchanged (§7.2)
  test/agent-*.test.ts                            + W
  test/scrape-rules-crosscheck.test.ts            + XZ
  test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs}   ~ K   profile 'agents', binding stripping, stub module mount
  test/integration/stubs/{anthropic,resend,telegram,gmail,google-token}.mjs   + K
  test/integration/stubs/postgrest.mjs            + DB   mini-PostgREST (tables + RPCs of §4.13)
  test/integration/stubs/unfold.mjs               + CQ
workers/mail/                                     + IN   whole package (§4.3, [agents] §5); skeleton (package.json, lockfile, tsconfig, vitest config, typed stubs) by K in Wave 0
  package.json, package-lock.json, tsconfig.json, vitest.config.ts, .gitignore, .dev.vars.example, README.md, wrangler.jsonc
  src/{index,headers,store,db,ingest}.ts, test/**
workers/ops/                                      (Phase 2 package)
  package.json, package-lock.json, wrangler.jsonc, vitest.config.ts, .dev.vars.example, .gitignore, README.md   ~ K   (.gitignore + eval/recordings/)
  vitest.t2.config.ts                             ~ K    Phase 2 T2 config: exclude test/t2/** (§7.2)
  vitest.t2.agents.config.ts                      + K    T2 profile 'agents' (§6.3)
  scripts/check-bundle.mjs                        ~ K    Phase 2 guard kept (bundleProblems, qrcode rule); Phase 4 checks added (§7.2)
  test/config.test.ts                             ~ K    Phase 2 subset still exact; Phase 4 additions asserted (§7.2)
  src/index.ts, src/env.ts, src/app.ts            ~ K    exports, dispatchers, Phase 4 env fields, agent route registration
  src/entrypoints/mail-ingest.ts                  + IN
  src/ports/**                                    + K    interfaces, makePorts, real and stub adapters
  src/db/postgrest.ts, src/db/repos/agent-runs.ts + K
  src/db/repos/feature-flags.ts                   + DB
  src/db/repos/{inbound-emails,rfqs,rfq-files}.ts + IN
  src/db/repos/{cad-jobs,quote-workflows,pricing,catalog}.ts   + CQ
  src/db/repos/{senders,orders,stock,partners}.ts + RP
  src/agents/{config,flags,runs,ids,gateway,prices,approval,decision,events}.ts   + K
  src/agents/cards/{index,failure,test}.ts        + K
  src/agents/cards/intake.ts                      + IN
  src/agents/cards/quote.ts                       + CQ
  src/agents/cards/{reply,handoff,reorder}.ts     + RP
  src/agents/prompts/registry.ts                  + K
  src/agents/prompts/rfq_intake/**                + IN   *.v1.md, *.v1.schema.json, LOCK.json
  src/agents/prompts/quote/**                     + CQ
  src/agents/prompts/post_order/**                + RP
  src/workflows/steps.ts                          + K
  src/workflows/rfq-intake.ts                     + IN
  src/workflows/quote.ts                          + CQ
  src/workflows/post-order.ts                     + RP
  src/do/rfq-thread.ts                            + IN
  src/do/cad-router.ts                            + CQ
  src/do/material-stock.ts                        + RP
  src/queues/messages.ts                          ~ K    + CadJobMessageV1, AgentEventV1, DirectoryScanMessage (ScrapeMessage unchanged, §4.9)
  src/queues/scrapes.ts                           =      Phase 2 consumer unchanged (index.ts routes 'directory-scan' elsewhere, §4.9)
  src/queues/cad-jobs.ts                          + CQ
  src/queues/agent-events.ts                      + RP
  src/queues/directory-scan.ts                    + XZ
  src/cron/flags-sync.ts                          + DB
  src/cron/{dispatcher,gmail-poller}.ts           + RP
  src/cad/**                                      + CQ   types, registry, router-client, multipart, dxf-metrics, result, backends/{http-unfold,inline,container}, inline/*
  src/pricing/**                                  + CQ
  src/pdf/{fonts,layout,trim,quote-pdf}.ts, src/pdf/assets/{LiberationSans-Regular.ttf,LiberationSans-Bold.ttf,OFL.txt,logo.png}   + CQ
  src/pdf/traveller-pdf.ts                        + RP
  src/mail-in/**                                  + IN   parse, quote-strip, sniff, attachments, safe-name, auth-results
  src/mail-out/**                                 + CQ   resend, mime-ids, templates (RP calls them for the hand-off mail)
  src/replies/match.ts                            + RP   (IN's step thread-check calls it)
  src/routes/agent.ts                             + K    decision, signed file link; delegates status/flag/start/staff file
  src/routes/agent-admin.ts                       + W
  src/routes/{scan-directory,scrape}.ts           ~ XZ   flag-on branch only; flag-off path byte-identical
  src/mcp/**                                      + XZ
  src/scrapers/**                                 + XZ   incl. parsers/{directory,profile}.ts (ported, F4-18)
  eval/{run-eval.ts,synthetic.eval.ts,vitest.eval.config.ts,fixtures.schema.json,README.md}   + K   (vitest-run; ops sources use extensionless imports)
  test/helpers/{cloudflare-workers.ts}            ~ K    + WorkflowEntrypoint, DurableObject, RpcTarget, env, exports, waitUntil stubs (WorkerEntrypoint kept)
  test/helpers/{cloudflare-workflows,cloudflare-email,agent-env,fake-step,fake-do,memory-db,recorders}.ts   + K
  test/helpers/{memory-rpc,check-lists}.ts        + DB   RPCs of §4.13 for T1 (self-contained); CHECK-list reader for the unions
  test/routes/agent-admin.test.ts, test/t2/web.t2.ts   + W
  test/<unit>/**, test/t2/<unit>.t2.ts            + each unit (dirs: kernel, flags, mail-ingest, intake, mail-in, cad, quote, pricing, pdf, replies, post-order, routes, mcp, scrapers)
  test/fixtures/mime/**                           + IN
  test/fixtures/llm/<prompt id>/**                + unit of the prompt
  test/fixtures/{cad,pdf}/**                      + CQ
  test/fixtures/scrapers/**                       + XZ
```

### 3.3 Wave 0 contract stubs (unit K first, ≈ 2-3 h; unit DB in parallel)

| Who | Commits | Gate |
|---|---|---|
| K | Every exported type and signature of §4 as stub files (`throw new Error('not implemented: <unit>')`): shared `agent-types.ts`, `agent-api.ts`, `rpc.ts` additions; ops `env.ts`, `index.ts` (all class exports wired to stub modules), `app.ts` registration line, `wrangler.jsonc`, `package.json` + lockfile (§4.19), `vitest.config.ts` aliases, test helpers; **cross-unit modules** `ports/index.ts`, `agents/*.ts`, `workflows/steps.ts`, `queues/messages.ts`, `do/{rfq-thread,cad-router,material-stock}.ts`, `workflows/{rfq-intake,quote,post-order}.ts`, `entrypoints/mail-ingest.ts`, `replies/match.ts`, `mail-in/parse.ts`, `mail-out/resend.ts`, `pdf/layout.ts`, `cad/{types,registry}.ts`, `routes/agent-admin.ts`, `mcp/index.ts`, `queues/{cad-jobs,agent-events,directory-scan}.ts`, `cron/{flags-sync,dispatcher}.ts`; the `workers/mail` package skeleton (`package.json` and lockfile with the toolchain pins of §4.19 and no runtime dependency, `tsconfig.json` with the `compilerOptions` of workers/site/tsconfig.json, `vitest.config.ts`, typed stub `src/index.ts`, `wrangler.jsonc` of [agents] §5.1); the **test extension points** of §7.2 that the Wave 0 changes would otherwise break (`workers/shared/test/http/rpc.test.ts`, `workers/ops/test/config.test.ts`, `workers/ops/vitest.t2.config.ts`); the **two site stub lines** that keep W's exhaustive tables compiling after `EndpointId += 'agent'`: `agent: 'ops'` in `ENDPOINT_TARGETS` (workers/site/src/api/router.ts:40-55) and `case 'agent':` returning the `#unknown` sentinel resolution in `resolveAction` (workers/site/src/api/resolve.ts:257-280; `endpointOfPath` does not yet return `'agent'`, so no request reaches it). Ownership of each stub then passes to the unit of §3.2 (the two site files to W) | K-0 (§5.2): shared, ops, site and mail typecheck green; every Phase 2 suite of shared, site and ops green |
| DB | Repo migration file with AM-1…AM-5 (§4.13), down script, `supabase/tests/agent_layer` package, tests extended for the amendments | `npm --prefix supabase/tests/agent_layer ci && npm --prefix supabase/tests/agent_layer test && npm --prefix supabase/tests/agent_layer run test:pg16` green |

### 3.4 Waves

| Wave | Units | Gate to the next wave |
|---|---|---|
| 0 | K (contract stubs), DB (SQL + tests) | §3.3 gates |
| 1 | K (implementation), DB (flags-sync, memory-rpc, stub postgrest), IN (mail package, `MailIngest`, `mail-in`), CQ (CAD backends, `CadRouter`, consumer, calculator, PDF, Resend client), RP (`replies/match.ts`, `MaterialStock`), W (site rows, `agent-hmac`, ops `agent-admin`, relay), XZ (scrape-rules, limit, robots, parsers, MCP auth + registry + read tools) | each unit's T1 green (§5) |
| 2 | IN (`RfqIntakeWorkflow`, `RfqThread`), CQ (`QuoteWorkflow`), RP (consumer, poller, dispatcher, `PostOrderWorkflow`), W (pages), XZ (write tools, in-process calls, audit, `directory-scan`, parity) | T1 green; `eval:synthetic` green |
| 3 | all: T2 (`test:integration:agents`), bundle checks, secret scans, Phase 1-2 regression (§5.8) | all green; bundle sizes printed |
| 4 | owner (§12), then P4-14 | PLAN.md:346-352 exit gate |

Merge order inside a wave is free (files are disjoint). A cross-unit need is solved through the contracts of §4, never by editing another unit's file (P2 G-1); a contract change after Wave 0 goes through K and is announced to every unit.

---

## 4. Binding contracts (names, signatures, shapes; bodies per unit)

### 4.1 Bindings, vars and secrets

| Name | Worker | Kind | Value / target | Status | Evidence |
|---|---|---|---|---|---|
| `FLAGS` | ops (new), site (P1) | KV | same namespace id as the site | canonical | CANON.md §3; wrangler.jsonc.draft:270-272 |
| `PRIVATE_FILES` | ops (new), mail | R2 | `microns-private`, `"jurisdiction": "eu"` | canonical | CANON.md §3-§4; P2 F-20 |
| `CAD_JOBS`, `AGENT_EVENTS` | ops | Queue producer + consumer | `cad-jobs`, `agent-events` (DLQs `cad-jobs-dlq`, `agent-events-dlq`) | canonical | CANON.md §3 |
| `RFQ_INTAKE`, `QUOTE`, `POST_ORDER` | ops | Workflow | `rfq-intake`/`RfqIntakeWorkflow`, `quote`/`QuoteWorkflow`, `post-order`/`PostOrderWorkflow` | canonical | CANON.md §3 |
| `RFQ_THREAD`, `MATERIAL_STOCK`, `CAD_ROUTER` | ops | Durable Object | `RfqThread`, `MaterialStock`, `CadRouter` (tag `v1`) | canonical | CANON.md §3 |
| `QUOTES_INDEX` | ops | Vectorize | `quotes-v1` (1,024 dims, cosine) | canonical | CANON.md §3 |
| `AI` | ops | Workers AI | gateway id via var `AI_GATEWAY_ID` = `microns` | canonical | CANON.md §3, §8 |
| `EVENTS` | ops | Analytics Engine | dataset `microns_events` | canonical | CANON.md §3 |
| `BROWSER` | ops | Browser Run | — | canonical | CANON.md §3 |
| `MCP_RATE_LIMIT` | ops | Rate Limiting | `namespace_id` `"2004"`, 60 per 60 s | proposed | [surfaces] §10.1 |
| route `mcp.micronshub.eu` | ops | Custom Domain | `{"pattern":"mcp.micronshub.eu","custom_domain":true}` | canonical host | CANON.md §5 |
| `OPS` | mail | Service binding | `microns-ops`, `"entrypoint": "MailIngest"` | entrypoint proposed | F4-2 |
| `AI_GATEWAY_ID` | ops | var | `microns` | canonical | wrangler.jsonc.draft:266 |
| `AGENT_TENANT_ID` | ops, mail | var | `00000000-0000-0000-0000-000000000001` | proposed | live 2026-10-03 (default tenant) |
| `QUOTE_FROM`, `QUOTE_REPLY_TO`, `MESSAGE_ID_DOMAIN` | ops | var | `MicronsHub Quotations <info@micronshub.eu>`, `replies@rfq.micronshub.eu`, `rfq.micronshub.eu` | proposed | api/emails.js:293; PLAN.md:320 |
| `CAD_BACKEND_DEFAULT` | ops | var | `vps` (Phase 5: `container`) | proposed | F4-11 |
| `MCP_HOSTNAME`, `MCP_ROUTE` | ops | var | `mcp.micronshub.eu`, `/mcp` | proposed | [surfaces] SF-4 |
| `ACCESS_TEAM_DOMAIN`, `MCP_ACCESS_AUD` | ops | var | placeholders `<ACCESS_TEAM_DOMAIN>`, `<ACCESS_AUD_MCP>` (identifiers, not secrets; P2 placeholder pattern) | proposed | [surfaces] §10.1 |
| `SCRAPER_USER_AGENT`, `SCRAPER_PERMITTED_HOSTS` | ops | var | `MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)`, `"{}"` | proposed | [surfaces] Z-R2, Z-R4 |
| `ALLOWED_RCPT`, `SUPABASE_URL` | mail | var | `rfq@rfq.micronshub.eu,replies@rfq.micronshub.eu`; project URL | canonical | PLAN.md:331 |
| `AGENT_STUBS`, `AGENT_LLM_BASE_URL`, `RESEND_API_BASE`, `TELEGRAM_API_BASE`, `GMAIL_API_BASE`, `GOOGLE_TOKEN_URL` | ops | var | **T2 generated configs only** | proposed | F4-21 |
| `AI_GATEWAY_TOKEN` | ops | secret | gateway token (Run) for `cf-aig-authorization` | proposed | F4-5 |
| `CAD_UNFOLD_URL` | ops | secret | base URL of the existing unfold service (infrastructure detail) | proposed | F4-11 |
| `CAD_SHARED_SECRET` | ops | secret | sent as `X-API-Key` to the unfold service | canonical | CANON.md §3 |
| `CAD_ACCESS_CLIENT_ID`, `CAD_ACCESS_CLIENT_SECRET` | ops | secret (optional) | Access service token for the CAD backend hostname, only with the network path chosen at OW-11 | proposed | Appendix P.3 |
| `AGENT_APPROVAL_SECRET` | site (relay verification), ops (signed file links), Supabase function secret (relay signing) | secret | one value, three holders | proposed in AGENTS.md:887 | §4.14 |
| `SUPABASE_SERVICE_ROLE_KEY` | mail (new consumer), ops (existing) | secret | — | canonical | CANON.md §3 |
| `MAIL_COPY_TO`, `MAIL_FALLBACK_TO` | mail | secret (optional) | verified destination addresses (addresses stay out of the public repo) | proposed | [agents] §5.2 |
| `TELEGRAM_WEBHOOK_SECRET`, `AGENT_DECISION_URL` | Supabase function secrets | secret | `setWebhook secret_token` value; `https://www.micronshub.eu/api/agent/decision` | proposed | [surfaces] §10.3 |
| `ANTHROPIC_API_KEY` | — | not set | only if BYOK is declined | canonical name kept | wrangler.jsonc.draft:478-479 |
| `MCP_OBJECT`, `MCP_OAUTH_*` | — | not created | F4-12, F4-13 | canonical names retired (doc correction §11) | wrangler.jsonc.draft:383-387, :480 |

`workers/ops/wrangler.jsonc` Phase 4 additions (K writes them all in Wave 0; Phase 2 entries unchanged):

```jsonc
"kv_namespaces": [ { "binding": "FLAGS", "id": "<KV_ID_FLAGS>" } ],
"r2_buckets": [ { "binding": "PRIVATE_FILES", "bucket_name": "microns-private", "jurisdiction": "eu" } ],
"queues": {
  "producers": [ /* SCRAPES (P2) */ { "binding": "CAD_JOBS", "queue": "cad-jobs" }, { "binding": "AGENT_EVENTS", "queue": "agent-events" } ],
  "consumers": [ /* scrapes (P2, unchanged) */
    { "queue": "cad-jobs", "max_batch_size": 1, "max_retries": 2, "max_concurrency": 3, "dead_letter_queue": "cad-jobs-dlq" },
    { "queue": "agent-events", "max_batch_size": 25, "max_batch_timeout": 10, "max_retries": 3, "dead_letter_queue": "agent-events-dlq" } ] },
"workflows": [
  { "name": "rfq-intake", "binding": "RFQ_INTAKE", "class_name": "RfqIntakeWorkflow" },
  { "name": "quote", "binding": "QUOTE", "class_name": "QuoteWorkflow" },
  { "name": "post-order", "binding": "POST_ORDER", "class_name": "PostOrderWorkflow" } ],
"durable_objects": { "bindings": [
  { "name": "RFQ_THREAD", "class_name": "RfqThread" }, { "name": "MATERIAL_STOCK", "class_name": "MaterialStock" },
  { "name": "CAD_ROUTER", "class_name": "CadRouter" } ] },
"migrations": [ { "tag": "v1", "new_sqlite_classes": ["RfqThread", "MaterialStock", "CadRouter"] } ],
"vectorize": [ { "binding": "QUOTES_INDEX", "index_name": "quotes-v1" } ],
"ai": { "binding": "AI" },
"browser": { "binding": "BROWSER" },
"analytics_engine_datasets": [ { "binding": "EVENTS", "dataset": "microns_events" } ],
"ratelimits": [ { "name": "MCP_RATE_LIMIT", "namespace_id": "2004", "simple": { "limit": 60, "period": 60 } } ],
"routes": [ { "pattern": "mcp.micronshub.eu", "custom_domain": true } ],
"rules": [ { "type": "Data", "globs": ["**/*.ttf", "**/*.png"], "fallthrough": true },
           { "type": "Text", "globs": ["**/*.md"], "fallthrough": true } ],
"triggers": { "crons": [ "* * * * *", "*/10 * * * *" ] },
"vars": { /* P2 vars */ "AI_GATEWAY_ID": "microns", "AGENT_TENANT_ID": "00000000-0000-0000-0000-000000000001",
  "QUOTE_FROM": "MicronsHub Quotations <info@micronshub.eu>", "QUOTE_REPLY_TO": "replies@rfq.micronshub.eu",
  "MESSAGE_ID_DOMAIN": "rfq.micronshub.eu", "CAD_BACKEND_DEFAULT": "vps",
  "MCP_HOSTNAME": "mcp.micronshub.eu", "MCP_ROUTE": "/mcp",
  "ACCESS_TEAM_DOMAIN": "<ACCESS_TEAM_DOMAIN>", "MCP_ACCESS_AUD": "<ACCESS_AUD_MCP>",
  "SCRAPER_USER_AGENT": "MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)", "SCRAPER_PERMITTED_HOSTS": "{}" },
"secrets": { "required": [ /* P2 list, unchanged */ ] }
```

Phase 4 secrets are **not** added to `secrets.required`: an ops deploy for a Phase 2/3 fix must not fail because the agent layer is not configured yet; each Phase 4 name is checked where it is used (P2 F-22 pattern, §4.2). Locally, wrangler loads only the `secrets.required` names from `.dev.vars` once that list exists (CF docs (fetched 2026-10-02) `phase2/cfdocs/workers_configuration_secrets.md:103`; workers/ops/wrangler.jsonc:57), so the T2 profile `agents` appends the Phase 4 secret names to `secrets.required` in its generated configs only (§6.3). The `rules` entries (Data for `.ttf`/`.png`, Text for `.md`) are mirrored in T1 by a vitest plugin (§6.2). Bindings are different: a deploy with this config needs the queues `cad-jobs` and `agent-events`, the Vectorize index `quotes-v1`, the KV id and the custom-domain zone to exist (owner items OW-3…OW-5, §12), so the first ops deploy after the Phase 4 merge waits for them.

`limits.cpu_ms` stays 300,000 (P2 F-12); it also bounds Workflow steps and consumers (CF docs (fetched 2026-10-03) https://developers.cloudflare.com/workflows/reference/limits/).

### 4.2 `workers/ops/src/env.ts` (K)

```ts
export interface OpsEnv {
  /* Phase 2 fields (workers/ops/src/env.ts:7-21) unchanged, including SCRAPES: Queue<ScrapeMessage> */
  // ----- Phase 4: agent layer (all optional, checked per use; CR-40) -----
  FLAGS?: KVNamespace; PRIVATE_FILES?: R2Bucket;
  CAD_JOBS?: Queue<CadJobMessageV1>; AGENT_EVENTS?: Queue<AgentEventV1>;
  RFQ_INTAKE?: Workflow<RfqIntakeParams>; QUOTE?: Workflow<QuoteParams>; POST_ORDER?: Workflow<PostOrderParams>;
  RFQ_THREAD?: DurableObjectNamespace<RfqThread>; MATERIAL_STOCK?: DurableObjectNamespace<MaterialStock>; CAD_ROUTER?: DurableObjectNamespace<CadRouter>;
  QUOTES_INDEX?: VectorizeIndex; AI?: Ai; BROWSER?: Fetcher; EVENTS?: AnalyticsEngineDataset;   // removed in T2 configs
  MCP_RATE_LIMIT?: RateLimit;
  AI_GATEWAY_ID?: string; AGENT_TENANT_ID?: string; QUOTE_FROM?: string; QUOTE_REPLY_TO?: string; MESSAGE_ID_DOMAIN?: string;
  CAD_BACKEND_DEFAULT?: 'vps' | 'container';
  MCP_HOSTNAME?: string; MCP_ROUTE?: string; ACCESS_TEAM_DOMAIN?: string; MCP_ACCESS_AUD?: string;
  SCRAPER_USER_AGENT?: string; SCRAPER_PERMITTED_HOSTS?: string;
  AGENT_STUBS?: string; AGENT_LLM_BASE_URL?: string; RESEND_API_BASE?: string; TELEGRAM_API_BASE?: string;
  GMAIL_API_BASE?: string; GOOGLE_TOKEN_URL?: string;                       // T2 only (F4-21)
  AI_GATEWAY_TOKEN?: string; CAD_UNFOLD_URL?: string; CAD_SHARED_SECRET?: string; AGENT_APPROVAL_SECRET?: string;   // secrets, optional at deploy
  CAD_ACCESS_CLIENT_ID?: string; CAD_ACCESS_CLIENT_SECRET?: string;
}

// agents/config.ts (K)
export class ConfigMissingError extends Error { readonly code = 'config_missing'; constructor(readonly names: string[]) }
/** Narrows env to the named fields or throws ConfigMissingError (uses Phase 2 missingNames(), workers/shared/src/http/env-check.ts:8). */
export function need<K extends keyof OpsEnv>(env: OpsEnv, ...names: K[]): asserts env is OpsEnv & Required<Pick<OpsEnv, K>>;
```

Why optional: the Phase 2 test helpers and tests build `OpsEnv` object literals with the Phase 2 fields only (workers/ops/test/helpers/ops.ts:37-53, test/marketing-webhook.test.ts:54-66, test/google-auth.test.ts:22-35) and `workers/ops/tsconfig.json` includes `test/**/*.ts`, so a required Phase 4 field would fail K-0; Phase 5 passes `OpsEnv` to Phase 4 functions (PHASE5_SPEC §5), so a separate required-field env type would not reach those calls either. Every Phase 4 entry point calls `need()` for what it uses: a missing `CAD_UNFOLD_URL` fails CAD jobs only, never mail intake; a missing `AI_GATEWAY_TOKEN` fails the LLM step with `config_missing` (run on a `failure` card), never the Worker; `readFlag()` without `FLAGS` answers fail closed. Phase 4 tests build their env with `opsEnv({...agentBindings()})` (`test/helpers/agent-env.ts`, K). The site `Env` (workers/site/src/env.ts) stays unchanged: W declares `export interface AgentSiteEnv extends Env { AGENT_APPROVAL_SECRET?: string }` in `src/auth/agent-hmac.ts` and the gate rows that need the secret read it through that type and check it per request (the name is not added to `NAMES_BY_TARGET`, so workers/site/test/env-api.test.ts:240-246 keeps passing).

### 4.3 Cross-Worker types (`workers/shared/src/agent-types.ts`, K) and `MailIngest`

```ts
export type FlagKey = 'seo.strict_404' | 'api.forward_to_vercel' | 'agent.rfq_intake' | 'agent.quote' | 'agent.post_order'
  | 'agent.growth.reddit' | 'agent.growth.hn' | 'agent.growth.tenders' | 'agent.growth.scrapers' | 'agent.growth.xometry'
  | 'agent.content_daily' | 'agent.ops_digest' | 'mcp.remote';             // exactly the 13 canonical keys (CANON.md §7)
export interface StartIntakeInput { v: 1; inbound_email_id: string; message_id_sha256: string; tenant_id: string }
export interface IngestReplyInput { v: 1; inbound_email_id: string; message_id_sha256: string; tenant_id: string; mailbox: 'replies' | 'gmail' }
export type StartIntakeResult =
  | { status: 'started' | 'exists'; instance_id: string }
  | { status: 'flag_off' }                                   // row stays 'received'; the dispatcher retries when the flag is on
  | { status: 'rejected'; reason: 'bad_input' };
export interface MailIngestRpc {
  startIntake(i: StartIntakeInput): Promise<StartIntakeResult>;
  ingestReply(i: IngestReplyInput): Promise<{ status: 'queued' } | { status: 'rejected'; reason: 'bad_input' }>;
}
```

`MailIngest extends WorkerEntrypoint<OpsEnv> implements MailIngestRpc` (IN, `workers/ops/src/entrypoints/mail-ingest.ts`) validates `v === 1`, UUID and 64-hex shapes, reads the `inbound_emails` row itself and has no other method. `microns-mail` env (IN): `PRIVATE_FILES: R2Bucket; OPS: Service<MailIngestRpc>; ALLOWED_RCPT; SUPABASE_URL; AGENT_TENANT_ID; SUPABASE_SERVICE_ROLE_KEY; MAIL_COPY_TO?; MAIL_FALLBACK_TO?`. Handler steps M0-M7 exactly as [agents] §5.2; log line `[microns-mail] mail <mailbox> <sha16> <outcome> <ms>`, never addresses or subjects.

### 4.4 `/api/agent/*` types (`workers/shared/src/agent-api.ts`, K; mirrored by `src/types/agent.ts`, W; shared JSON fixtures)

```ts
export const AGENT_API_VERSION = 1 as const;
export type CardKind = 'intake' | 'quote' | 'reply' | 'reply_pick' | 'handoff' | 'reorder' | 'failure' | 'test';
export type AgentAction = 'decision' | 'status' | 'flag' | 'start' | 'file';

/** Verb -> Telegram code per card kind. A verb without a code is dashboard-only. */
export const VERB_CODES: Readonly<Record<CardKind, Readonly<Record<string, string | null>>>> = {
  intake:     { confirm_sheet_metal: 'csm', confirm_cnc: 'cnc', confirm_mixed: 'mix', not_rfq: 'nrfq' },
  quote:      { approve: 'ok', reject: 'rej' },                      // 'approve' with edits: dashboard only (CR-14)
  reply:      { won: 'won', lost: 'lost', counter: 'ctr', ignore: 'ign' },
  reply_pick: { attach_1: 'a1', attach_2: 'a2', attach_3: 'a3', new_rfq: 'new', ignore: 'ign' },
  handoff:    { send_partner: 'sp', hold: 'hold', change_partner: null },
  reorder:    { approve_draft: 'apd', dismiss: 'dis' },
  failure:    { retry: 'rty', dismiss: 'dis' },
  test:       { dismiss: 'dis' },
};
export const CALLBACK_DATA_RE = /^ap:([A-Z2-7]{26}):([a-z0-9]{1,4})$/;   // ≤ 34 bytes (Telegram 1-64)

export interface QuoteEdits {
  overrides?: Array<{ line_no: number; unit_price: number; note?: string }>;
  shipping?: number;
  drafts?: { subject?: string; body_text?: string };
}
export interface DecisionBodyDashboard { v: 1; run_id: string; token_sha256: string; verb: string; edits?: QuoteEdits; note?: string }
export interface DecisionBodyRelay { v: 1; token: string; code: string; tg: { user_id: number; chat_id: number; message_id: number } }
export type DecisionOutcome = 'event_sent' | 'terminated' | 'restarted' | 'dismissed';
export interface DecisionResult { v: 1; ok: true; run_id: string; verb: string; outcome: DecisionOutcome; label: string }  // label ≤ 200 chars
export interface AgentStatus { v: 1; ok: true; actions: AgentAction[]; principal: 'STAFF' | 'ADMIN' }
export interface FlagEditBody { v: 1; key: string; expected_rev: number; enabled: boolean; mode?: 'shadow' | 'assist' | 'auto'; writes?: boolean }
export interface FlagEditResult { v: 1; ok: true; key: string; rev: number; kv: 'written' | 'pending' }
export type StartBody = { v: 1; kind: 'quote'; rfq_id: string } | { v: 1; kind: 'rfq_intake'; inbound_email_id: string } | { v: 1; kind: 'test_card' };
export interface StartResult { v: 1; ok: true; instance_id: string; created: boolean }
export type AgentApiError = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'method_not_allowed' | 'payload_too_large'
  | 'already_decided' | 'stale' | 'verb_not_allowed' | 'flag_off' | 'active_quote_exists' | 'rate_limited';
```

Code letters: the 1-4 character codes are lower-case letters or digits (`a1`…`a3`), so the relay regex is `[a-z0-9]{1,4}` (amends [surfaces] §7.3, which allowed letters only).

`failure` cards carry `allowed_verbs = ['retry', 'dismiss']` when the failed run belongs to a Workflow instance and the failed step is known, else `['dismiss']`; the run behind such a card is `waiting_human` with `parked_reason = 'failed'` (§4.7, CR-37), which is the only state in which the database accepts an approval token (agent_layer.sql:108-109).

### 4.5 `workers/shared/src/http/rpc.ts` extension (K)

```ts
export type EndpointId = /* Phase 2 ids */ | 'agent';
export interface Principal { /* Phase 2 fields */ machine?: 'collector' | 'mcp' | 'telegram' }
```

The same Wave 0 commit extends the typecheck-only test `workers/shared/test/http/rpc.test.ts:6-22` (its `toEqualTypeOf` unions gain `'agent'` and `'telegram'`) and adds the two site stub lines of §3.3; without them `npm --prefix workers/shared run typecheck` and `npm --prefix workers/site run typecheck` fail (exhaustive `TargetTable` at workers/site/src/api/router.ts:40-55; `resolveAction` switch without `default` at workers/site/src/api/resolve.ts:257-280). The site's own machine union (`MachineName`, workers/site/src/auth/policy.ts:19; access.ts:17) is not widened: the relay principal is produced by W's HMAC path, not by Access.

### 4.6 Ports (`workers/ops/src/ports/index.ts`, K) and stub seams

```ts
export interface Ports {
  llm: LlmPort; embed: EmbedPort; vector: VectorPort; cad: CadBackendRegistry; mailer: MailerPort; telegram: TelegramPort;
  gmail: GmailPort; db: Db; blob: BlobPort; events: EventsPort; clock: ClockPort; browser: BrowserPort;
}
export function makePorts(env: OpsEnv): Ports;   // reads AGENT_STUBS; throws if AGENT_STUBS is set while AI or QUOTES_INDEX is bound
export interface BrowserPort { render(url: string, o: { timeoutMs: number; userAgent: string }): Promise<{ status: number; html: string }> }
// BlobPort ([agents] §4.3) gains one method for streamed ZIP handling (IN):
//   getRange(key: string, offset: number, length: number): Promise<ReadableStream | null>;   // R2 get with {range: {offset, length}}
```

All other port interfaces (`LlmCall`, `LlmContent`, `LlmResult`, `LlmFailure`, `LlmUsage`, `EmbedPort`, `VectorPort`, `MailerPort`, `TelegramPort`, `GmailPort`, `BlobPort`, `EventsPort`, `ClockPort`) are exactly [agents] §4.3. `Db` = `PostgrestDb` (`db/postgrest.ts`): `select`, `insert` (with `onConflict`, `ignoreDuplicates`, `returning`), `update` (filters, `returning`), `rpc(name, args)`; filters `eq`, `in`, `ov`, `cs`, `ilike` (with `%`, `_`, `\` escaped), `gte`, `lt`, `is`; never logs bodies. `cad` comes from `cad/registry.ts` (CQ), `browser` from `scrapers/browser.ts` (XZ).

| Port | Production | T1 fake (vitest, Node) | T2 (`wrangler dev --local`) | `AGENT_STUBS` token |
|---|---|---|---|---|
| `llm` | SDK → `env.AI.gateway(AI_GATEWAY_ID).getUrl('anthropic')` | `FakeLlm` (fixture by prompt id + SHA-256 of user content; unknown → `schema` failure) | same SDK, `baseURL = AGENT_LLM_BASE_URL` → `stubs/anthropic.mjs` | `llm` |
| `embed` | `env.AI.run('@cf/baai/bge-m3', …, {gateway})` | `HashEmbed` (deterministic unit vectors, 1,024 dims) | `HashEmbed` | `embed` |
| `vector` | `env.QUOTES_INDEX` | `MemoryVectorIndex` (cosine; `$eq/$in/$gte/$lte`) | `MemoryVectorIndex` persisted in local R2 `__stub/vectors/<ns>.json` | `vector` |
| `cad` | `HttpUnfoldBackend` + `InlineBackend` | `FakeCadBackend` | `stubs/unfold.mjs` via `CAD_UNFOLD_URL` + real `InlineBackend`; `cad` token → `FakeCadBackend` | `cad` |
| `browser` | `@cloudflare/puppeteer` on `env.BROWSER` | fake launcher | fixture renderer (binding removed) | `browser` |
| `mailer` | `fetch` `https://api.resend.com` | recorder | `RESEND_API_BASE` → `stubs/resend.mjs` | — |
| `telegram` | `fetch` Bot API | recorder | `TELEGRAM_API_BASE` → `stubs/telegram.mjs` | — |
| `gmail` | `fetch` Gmail API + token endpoint | scripted | `GMAIL_API_BASE`, `GOOGLE_TOKEN_URL` → `stubs/gmail.mjs`, `stubs/google-token.mjs` | — |
| `db` | PostgREST, service role | `MemoryDb` + `memory-rpc.ts` | `SUPABASE_URL` → `stubs/postgrest.mjs` | — |
| `blob` | `env.PRIVATE_FILES` | `MemoryBlob` | local R2 | — |
| `events` | `env.EVENTS.writeDataPoint` (no-op when absent, never throws) | recorder | local AE | — |
| `clock` | `Date` | settable | `Date` | — |

Email and Containers seams: inbound mail is driven in T2 through the Local Explorer `POST /cdn-cgi/local/explorer/api/local/email/routing/send?worker=microns-mail`, because the raw `POST /cdn-cgi/local/email?from=…&to=…` route (probe #12; CF docs (fetched 2026-10-03) https://developers.cloudflare.com/email-service/local-development/routing/) reaches only the primary Worker, which is the site (§6.3; probe 2026-10-04 T-3, T-4); the Phase 5 Container backend exists as `cad/backends/container.ts` returning `{ok:false, code:'unsupported'}` until P5-6.

### 4.7 Runs, flags and helpers (K)

```ts
// agents/runs.ts
/** Values of agent_runs.agent written by Phase 4 (CHECK ^[a-z0-9_]+(\.[a-z0-9_]+)*$, agent_layer.sql:98).
 *  Phase 5 extends this union here (PHASE5_SPEC §3.2, §5.5); idempotency keys start with '<agent>:' or a fixed prefix of §4.8. */
export type AgentKey = 'rfq_intake' | 'quote' | 'post_order' | 'quote.reply_poller' | 'cad' | 'eval' | 'mcp' | 'flags' | 'growth.scrapers';
export type RunTrigger = 'email' | 'cron' | 'queue' | 'workflow' | 'dashboard' | 'telegram' | 'mcp' | 'manual';  // = agent_runs CHECK
export type RunStatus = 'running' | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
export interface OpenRun { agent: AgentKey; trigger: RunTrigger; idempotency_key: string; workflow_name?: string; workflow_instance_id?: string;
  parent_run_id?: string; subject_type?: string; subject_id?: string; prompt_version?: string; tenant_id?: string }
export function openRun(db: Db, r: OpenRun): Promise<{ run_id: string; created: boolean; status: RunStatus }>;   // rpc/agent_run_begin
export function addUsage(acc: UsageAcc, u: LlmUsage | EmbedUsage, step: string): UsageAcc;                       // pure
export function checkpointRun(db: Db, run_id: string, acc: UsageAcc, patch?: { status?: RunStatus; output?: unknown }): Promise<void>;
// a patch to status 'running' also sets parked_reason = null (a resumed parked run; AM-3 CHECK)
export function closeRun(db: Db, run_id: string, outcome: { status: 'succeeded' | 'failed' | 'cancelled' | 'skipped'; error?: string; output?: unknown }, acc: UsageAcc): Promise<void>;
// one PATCH: status, finished_at, error, output, usage columns, cost_cents, approval_token_sha256 = null, parked_reason = null
// (agent_runs_token_check and _finished_check, agent_layer.sql:105, :108-109); cost_cents > 0 whenever llm_calls > 0
export function parkRun(db: Db, run_id: string, reason: 'flag_off' | 'budget' | 'llm_unavailable'): Promise<void>;   // status waiting_human + parked_reason (AM-3); no token
export function failRun(env: OpsEnv, ports: Ports, run_id: string, f: { error: string; failed_step: string | null; restartable: boolean }, acc: UsageAcc): Promise<void>;
// agents/approval.ts helper, one PATCH through approval.request(): status waiting_human, parked_reason 'failed', error, usage, token hash,
// output.{card_kind:'failure', allowed_verbs: restartable && failed_step ? ['retry','dismiss'] : ['dismiss'], failed_step, card, telegram_message_id}
export function dailyCapReached(db: Db, agent: AgentKey, flag: AgentFlag, now: Date): Promise<boolean>;
// today's (UTC) runs of the agent incl. this one > cap (flag.value.max_runs_per_day ?? 200); one select of `id` with
// agent=eq, started_at=gte.<UTC midnight>, limit cap + 1 (no count API needed in Db, MemoryDb or the mini-PostgREST)

// agents/flags.ts
export interface AgentFlag { enabled: boolean; mode: 'shadow' | 'assist' | 'auto'; value: Record<string, unknown>; rev?: number }
export function readFlag(env: OpsEnv, key: Exclude<FlagKey, `seo.${string}` | `api.${string}`>): Promise<AgentFlag>;
export function readAgentFlag(env: OpsEnv, key: `agent.${string}`): Promise<AgentFlag>;   // same function, narrower key type (annex name); Phase 5 imports readFlag (PHASE5_SPEC §3.1, CD5-1)
// KV FLAGS, cacheTtl 30; missing / malformed / KV error -> {enabled:false, mode:'shadow', value:{}} (fail closed)
// mode = value.mode ?? kv.mode ?? 'shadow'; seo.* and api.* keys are never read here (the site reads them, P2 §2.7)

// agents/ids.ts
export function sha256hex(data: ArrayBuffer | Uint8Array | string): Promise<string>;
export function rfqIntakeInstanceId(messageIdSha256: string): string;          // 'rfq-intake-' + first 32 hex
export function quoteInstanceId(rfqId: string, version: number): string;       // 'quote-<rfq_id>-v<n>'
export function postOrderInstanceId(orderId: string): string;                  // 'post-order-<order_id>'
export function cadJobKey(inputSha256: string, jobType: string, params: unknown): Promise<string>;   // <sha>:<type>:<sha256(canonical JSON)>
export function safeName(name: string): string;                                // NFC, [^A-Za-z0-9._-] -> _, ≤ 100 chars, extension kept
export function newApprovalToken(): { token: string; sha256: Promise<string> };   // 128 random bits, base32 (26 chars, no padding)
export function outboundMessageId(qwid: string, k: number, domain: string): string; // '<q.<qwid>.<k>@<domain>>'
export function isAlreadyExists(e: unknown): boolean;                          // Workflow create error text contains 'instance.already_exists' (probe #2)
```

Run rules: `open-run` is the first step of every Workflow and the first action of every consumer and cron unit; `created = false` with a final status → exit. Flood control (DF-80, CR-38): for an LLM-using agent, `open-run` then calls `dailyCapReached()`; when true the run closes `skipped` with error `daily_cap` before any LLM call (intake also sets its `inbound_emails` row to `needs_review`), and one plain Telegram notice per agent and UTC day reports it. `request-*` steps set `status = waiting_human`, the token hash and `output.{card_kind, allowed_verbs, card, telegram_message_id}` in one PATCH. `output` ≤ 8 KB summary, no e-mail bodies or addresses (agent_layer.sql:111 caps at 64 KiB). The step sequence of every Workflow runs inside a top-level `try/catch`; the catch runs step `fail-run`, which calls `failRun()` with the name of the step that threw (CR-37): the run stays `waiting_human` (`parked_reason = 'failed'`) behind a `failure` card, and the instance then ends. Retry and Dismiss go through `decide()` (§4.14). Consumers and cron units do not post failure cards: they close `failed` and rely on queue retries and DLQs. `llm_calls` counts Anthropic calls that returned `usage` (embedding calls are counted in Analytics Engine `embed_call` points only), so `closeRun` writes `cost_cents > 0` whenever `llm_calls > 0` (exit gate 4, §10).

### 4.8 Identifiers and keys

| Item | Format | Source |
|---|---|---|
| `message_id_sha256` | lower-case hex SHA-256 of the trimmed `Message-ID` header value (brackets and case kept); missing header → SHA-256 of the raw MIME bytes | AGENTS.md:207; [agents] §4.5 |
| Instance ids | `rfq-intake-<32 hex>` (43 chars), `quote-<rfq_id>-v<n>`, `post-order-<order_id>`; all ≤ 100 chars, pattern `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` | CF docs (fetched 2026-10-03) workflows limits; agent_layer.sql:101-102, :354 |
| `agent_runs` idempotency keys | intake `<message_id_sha256>`; quote `<rfq_id>:v<n>`; post-order `<order_id>`; CAD `<cad_jobs.id>`; poller `gmail:<scheduledTime ISO>`; flags `flags-sync:<ISO minute>`; MCP read `mcp:r:<uuid>`, MCP write `mcp:w:<tool>:<32 hex of sha256(uid‖tool‖canonical args)>:<floor(now/600 s)>`; scraper `directory-scan:<run_id>`; test card `test-card:<uuid>` | [agents] §4.4; [surfaces] §5.5; [data] §4.4 |
| R2 keys | `email/<sha>/raw.eml`, `email/<sha>/att/<n>-<safe>`, `rfq/<rfq_id>/<file_id>-<safe>`, `cad/<job_id>/output/{result.json,flat.dxf,drawing.pdf,flat.svg,log.txt}`, `quotes/<rfq_id>/v<n>/quote.pdf`, `orders/<order_id>/traveler.pdf`, `eval/golden/<yyyy-mm-dd>/…` (proposed) | CANON.md §4; agent_layer.sql:359-360, :413 |
| `rfq_files` of agent rows | `file_id` = UUIDv5(`rfq_id`, `sha256`); `file_path = <rfq_id>/<file_id>-<safe>`; `r2_key = rfq/` + `file_path`; `source` `email`/`techpilot`; `content_type`, `sha256` set | CR-16; agent_layer.sql:529-538 |
| CAD job key | `<input_sha256>:<job_type>:<params_sha256>` | agent_layer.sql:463-464 |
| Outbound Message-ID | `<q.<quote_workflow_id>.<k>@rfq.micronshub.eu>`, `k` = 0 quote, 1-2 follow-ups | AGENTS.md:301 |
| Resend `Idempotency-Key` | `quote/<qwid>/send`, `quote/<qwid>/fu<k>`, `order/<order_id>/handoff` (≤ 256 chars, kept 24 h) | Resend docs (fetched 2026-10-03) https://resend.com/docs/dashboard/emails/idempotency-keys |
| Approval token | 26 chars base32 (RFC 4648, no padding); only its SHA-256 hex is stored | agent_layer.sql:91, :113 |
| Vector id / namespace | `<quote_workflow_id>:<line_no>` / `tenant_id` | [agents] A-16 |

### 4.9 Queues (`workers/ops/src/queues/messages.ts`, K)

```ts
export interface CadJobMessageV1 {
  v: 1; job_id: string; idempotency_key: string; job_type: 'analyse' | 'drawing_pdf' | 'flat_dxf' | 'flat_svg';
  tenant_id: string; rfq_id: string | null; rfq_file_id: string | null; quote_workflow_id: string | null;
  input: { store: 'r2'; r2_key: string; sha256: string; content_type: string; size_bytes: number; file_name: string };
  params: { material: string; thickness_override: number; k_factor_override: number; drawing_size: 'A3' | 'A4'; process: 'sheet_metal' | 'cnc' | 'mixed' | 'other' };
  backend: 'auto' | 'vps' | 'container' | 'inline'; deadline_s: number; run_id: string;
}
export type AgentEventV1 =
  | { v: 1; type: 'inbound-reply'; inbound_email_id: string; tenant_id: string }
  | { v: 1; type: 'order-created'; order_id: string; tenant_id: string; source: 'quote' | 'portal' | 'dashboard' }
  | { v: 1; type: 'resume-parked'; run_id: string }
  | { v: 1; type: 'card'; card: CardV1; run_id: string };
// ScrapeMessage (Phase 2, workers/ops/src/queues/messages.ts:12-19) is NOT changed: its kind union keys two exhaustive
// Records in the frozen Phase 2 consumer (workers/ops/src/queues/scrapes.ts:28-31, :36). Phase 4 kinds use their own envelope
// on the same queue, the pattern Phase 5 uses for P5ScrapeMessage (PHASE5_SPEC D-27).
export interface DirectoryScanMessage {
  v: 1; kind: 'directory-scan'; params: DirectoryScanParams; run_id: string; enqueued_at: string; requested_by: string;   // run_id = agent_runs id
}
export function isDirectoryScanMessage(body: unknown): body is DirectoryScanMessage;   // v === 1 and kind === 'directory-scan'
export interface DirectoryScanParams { url: string; source: 'europages' | 'wlw'; max_pages: number; saved_search_id?: string; enrich_profiles: boolean }  // max_pages ≤ 10
// queues/directory-scan.ts (XZ): sendDirectoryScan(env, m) = the only typed send of this envelope on env.SCRAPES (one cast, size check
// as enqueueScrape, workers/ops/src/queues/messages.ts:39-41); directoryScanConsumer(batch, env, ctx)
```

| Queue | Consumer config | `index.ts` dispatch (K) |
|---|---|---|
| `scrapes` (P2) | unchanged (`max_batch_size` 1, `max_concurrency` 2) | `batch.queue === 'scrapes'`: every message passes `isDirectoryScanMessage` → `directoryScanConsumer` (XZ); otherwise the Phase 2 `scrapesConsumer` unchanged (Phase 5 inserts its own `isP5ScrapeMessage` branch before this fallback, PHASE5_SPEC D-27). Batch size 1 makes mixed batches impossible; a mixed batch would be retried whole |
| `cad-jobs` | `max_batch_size` 1, `max_retries` 2, `max_concurrency` 3, DLQ `cad-jobs-dlq` | `cadJobsConsumer` (CQ) |
| `agent-events` | `max_batch_size` 25, `max_batch_timeout` 10, `max_retries` 3, DLQ `agent-events-dlq`; per-message `ack()`/`retry()` | `agentEventsConsumer` (RP) |

Messages stay far below the 128 KB limit (CF docs (fetched 2026-10-03) https://developers.cloudflare.com/queues/platform/limits/). Producers write the database row first, then send (AGENTS.md:614).

### 4.10 Workflows

```ts
export interface RfqIntakeParams { v: 1; inbound_email_id: string; message_id_sha256: string; tenant_id: string }
export interface QuoteParams { v: 1; rfq_id: string; quote_version: number; tenant_id: string; trigger: 'intake' | 'dashboard' | 'revision'; requested_by?: string }
export interface PostOrderParams { v: 1; order_id: string; tenant_id: string; source: 'quote' | 'portal' | 'dashboard' }
export class RfqIntakeWorkflow extends WorkflowEntrypoint<OpsEnv, RfqIntakeParams> {}   // IN, steps [agents] §8.2
export class QuoteWorkflow extends WorkflowEntrypoint<OpsEnv, QuoteParams> {}           // CQ, steps [agents] §10.1
export class PostOrderWorkflow extends WorkflowEntrypoint<OpsEnv, PostOrderParams> {}   // RP, steps [agents] §12.1
```

| Event type | Sent by | Waited for in | Timeout |
|---|---|---|---|
| `intake-confirmed` | `decide()` | `rfq-intake` `wait-confirmation` | 7 d → `remind-confirmation` → 7 d |
| `cad-done` | `RfqThread` (once all registered jobs are final) | `quote` `await-cad` | 2 h, then manual-price lines |
| `quote-approved` | `decide()` (payload `{verb:'approve', overrides?, shipping?, drafts?}`) | `quote` `wait-approval` | 7 d → remind → 7 d |
| `customer-reply` | `RfqThread.appendInbound` after attribution | `quote` follow-up waits | `value.follow_up_days` (3, 4, 7 d) |
| `reply-confirmed` | `decide()` | `quote` `confirm-reply` | 7 d → remind → 7 d |
| `handoff-approved`, `reorder-approved` | `decide()` | `post-order` `wait-handoff`, `wait-reorder` | 7 d → remind → 7 d |
| `agent-resumed` (new) | dispatcher via `resume-parked` only (parked runs carry no token, so `decide()` never reaches them) | any parked step | 7 d, then `cancelled` |

A failed Workflow run is not resumed by an event: `decide()` verb `retry` on its `failure` card calls `instance.restart({from: {name: output.failed_step}})`, which reuses the cached results of the earlier steps and runs the failed step and every later step again (CF docs (fetched 2026-10-03) https://developers.cloudflare.com/workflows/build/workers-api/#restart, copy `phase4/cfdocs/workflows_build_workers-api.md:942-963`); `open-run` is cached (and `agent_run_begin` returns the same row anyway), so the same `agent_runs` row continues. Restarting an instance that has ended is exercised in T2 (K-5) before any unit relies on it. If `restart` throws (no such step in the history), `decide()` closes the run `failed` with error `restart_failed` and answers outcome `dismissed`.

Step rules (binding for IN, CQ, RP): retry profiles `DB`, `BLOB`, `LLM_EXTRACT` (3 × 30 s exponential, timeout 3 min), `LLM_CLASSIFY`, `EMBED`, `SEND`, `NOTIFY`, `PDF`, `PURE` exactly as [agents] §8.1 (`workflows/steps.ts`, K); step names are constants (plus a stable index), never time- or random-based; every side-effecting step re-reads its flag first and parks on `flag_off` (AGENTS.md:91); `NonRetryableError` for schema failure after one re-ask, provider 4xx other than 408/429, `refusal`, invalid input; human waits through `waitWithReminder()` (`agents/approval.ts`, K); "already exists" on `create` = success. Step results ≤ 1 MiB and compact (F4-22).

### 4.11 Durable Objects

| Class (owner) | Id | Methods (RPC, signatures binding) | Storage |
|---|---|---|---|
| `RfqThread` (IN) | `idFromName(rfq_id)` | `expectCadJobs(jobIds: string[]): Promise<void>`; `bindQuote(instanceId: string, quoteWorkflowId: string): Promise<void>`; `cadJobFinal(jobId: string, status: 'succeeded'\|'failed'\|'timed_out'\|'dead_letter'\|'cancelled'): Promise<void>`; `registerOutbound(messageIds: string[], quoteWorkflowId: string): Promise<void>`; `appendInbound(inboundEmailId: string, messageId: string): Promise<void>`; `state(): Promise<RfqThreadState>` | SQLite; rebuilt from Supabase when empty ([agents] §8.4) |
| `CadRouter` (CQ) | `idFromName('global')` | `acquire(r: {job_id: string; backend_candidates: BackendName[]; deadline_s: number}): Promise<{granted: true; lease_id: string; backend: BackendName} \| {granted: false; retry_after_s: number}>`; `release(lease_id: string, outcome: {ok: boolean; retryable?: boolean; backend_down?: boolean}): Promise<void>`; `report(backend: BackendName, ok: boolean): Promise<void>`; `snapshot(): Promise<CadRouterSnapshot>`; `alarm()` | SQLite leases + health ([agents] §9.3) |
| `MaterialStock` (RP) | `idFromName('<tenant_id>:<material_id>')` | `reserve(orderItemId: string, need: {area_mm2?: number; quantity?: number}): Promise<StockHoldResult>`; `commit(orderItemId: string, nestingSessionId: string): Promise<void>`; `release(orderItemId: string, reason: 'cancelled'\|'consumed'\|'expired'\|'manual'): Promise<void>`; `check(): Promise<StockCheck>`; `alarm()` (daily `expireHolds`) | SQLite idempotency; truth in `stock_reservations` ([agents] §12.2, CR-1) |

### 4.12 CAD contract (CQ; types imported by IN and RP)

`cad/types.ts` exports exactly the types of [agents] §9.2: `BackendName = 'vps' | 'container' | 'inline' | 'mac_mini'`, `CadKind`, `CadInput`, `CadResultV1` (`v: 1`, units mm, `flat`, `bends`, `bbox_mm`, `volume_mm3`, `warnings`, `versions`, `duration_ms`), `CadArtefact`, `CadOutcome`, `CadBackend`, `CadBackendRegistry`; `cad/backends/http-unfold.ts` exports `HttpUnfoldBackend(name: 'vps' | 'container', fetcher, {baseUrl, apiKey, maxConcurrency})`.

| Rule | Value | Source |
|---|---|---|
| STEP sheet-metal `analyse` | one `POST {CAD_UNFOLD_URL}/api/v1/unfold`, multipart streamed from R2, `output_format=dxf`, header `X-API-Key`; metrics from `X-Part-*` headers + in-Worker DXF metrics | sheet-metal-service/main.py:273-280; [agents] §9.2 |
| Calls to the unfold service | only `/api/v1/unfold` and `/api/v1/health`; the file always travels as a multipart upload of the R2 object with a sanitised name; no URL- or path-based input field is ever sent (field rules: Appendix P.3) | sheet-metal-service/main.py:243-336, :690-714; Appendix P.3 |
| DXF, STL, CNC STEP | `InlineBackend` (copies of supabase/functions/generate-manufacturing-pdf/{dxf-parser,stl-parser,step-parser,mesh-analyzer}.ts, imports rewritten, no Deno globals); input caps per kind: **STEP 5 MB, DXF 3 MB, binary or ASCII STL 0.75 MB** (half of the largest synthetic worst-case input that parsed under a 96 MB V8 heap: STEP 10 MB, DXF 6 MB, STL 1.5 MB; STEP 15 MB, DXF 8 MB and STL 2 MB ran out of memory; probe 2026-10-04 memprobe, Node 22.22.2); the Workers isolate has 128 MB shared by concurrent invocations (`phase2/cfdocs/workers_platform_limits.md:121-125`, fetched 2026-10-02). Above the cap: STEP sheet metal still goes to the unfold service; every other kind becomes a manual-price line with warning `inline_too_large` (DF-81). The source edge function's own cap was 25 MB (supabase/functions/generate-manufacturing-pdf/index.ts:34) | [agents] A-10 (40 MB cap replaced, CR-39) |
| Concurrency | VPS 1, **inline 1**, container 3 (Phase 5); `CadRouter` grants at most one `inline` lease at a time, and `InlineBackend` also holds a module-level mutex so one isolate never parses two inputs at once; consumer `max_concurrency` 3 (VPS and inline jobs can run side by side) | [agents] §9.3; CR-39 |
| Deadline | 300 s wall clock enforced by the consumer; objects > 50 MB fail `too_large` before any call | sheet-metal-service/config.py:36; AGENTS.md:629 |
| Reuse | a `succeeded` row with the same `idempotency_key` → copy `result` and `output_r2_keys` | AGENTS.md:623 |
| Outputs | `cad/<job_id>/output/*`; `cad_jobs.status` final values `succeeded`, `failed`, `timed_out`, `dead_letter`, `cancelled`; `RfqThread.cadJobFinal()` exactly once per final state | agent_layer.sql:465-466 |
| Legacy-store inputs | not fetched; "geometry missing" manual-price line | [agents] A-12 |

### 4.13 Database contract (unit DB; everything else reads it)

Base: `agent_layer.sql` as tested ([data] §0-§6). Tables `agent_runs`, `feature_flags`, `pricing_rules`, `quote_workflows`, `inbound_emails`, `cad_jobs`, `stock_reservations`; columns `rfqs.source` (`web|email|techpilot|manual`), `rfqs.inbound_email_id`, `rfq_files.source`, `rfq_files.r2_key`, `rfq_files.sha256`, `rfq_files.content_type`; helper `has_staff_role()`; guard trigger `agent_columns_guard`; 13 flag rows seeded off with `kv_seed_pending = true`. Access: anon nothing; authenticated `SELECT` with staff-only RLS; service role writes (agent_layer.sql:841-862). Live runs Postgres 15.8 (live 2026-10-04 `server_version`) while the tests run on PGlite 18.3 and 16.4 ([data] §7; data.md:232 records the static review for 15: `NULLS NOT DISTINCT` needs 15+, nothing 16+-only), so OW-6 first runs the file on live with its final `COMMIT;` replaced by `ROLLBACK;` (the script is one transaction, agent_layer.sql:29, :883).

Amendments added by this spec (all inside new objects; no change to an existing live column, policy or grant):

| ID | Change | Why | Test to add (`supabase/tests/agent_layer/test.mjs`) |
|---|---|---|---|
| AM-1 | `cad_jobs_backend_check` (agent_layer.sql:461): `backend IS NULL OR backend IN ('vps','container','inline','mac_mini')` (NULL still allowed for queued rows) | Inline backend jobs (CR-9) | insert with `inline` succeeds; `other` fails; NULL succeeds |
| AM-2 | `quote_workflows.drafts jsonb` (CHECK object, `pg_column_size ≤ 65536`), `quote_workflows.pdf_sha256 text` (CHECK `^[0-9a-f]{64}$`) | Approved texts and PDF hash stored with their version (CR-6) | CHECK vectors; staff read, client write denied |
| AM-3 | `agent_runs.parked_reason text` (CHECK `NULL` or `flag_off`/`budget`/`llm_unavailable`/`failed`, and `parked_reason IS NULL OR status = 'waiting_human'`); index `agent_runs_parked_idx (status, parked_reason) WHERE parked_reason IS NOT NULL`; `agent_run_claim_approval` also sets `parked_reason = NULL` | Dispatcher finds parked runs (CR-8); `failed` marks a run waiting on a `failure` card (CR-37) | park → claim clears it; a `failed` park with a token is claimable once; `parked_reason` on a `succeeded` row rejected; CHECK vectors |
| AM-4 | `create_order_from_quote(p_quote_workflow_id uuid) RETURNS TABLE(order_id uuid, po_number text, created boolean)`, SECURITY INVOKER, `search_path = public`, EXECUTE `service_role` only. Locks the `quote_workflows` row; if an order with this `rfq_id` and `from_rfq_number` exists → returns it (`created = false`); else in one transaction: `rfqs.status = 'approved'`; `po := next_po_number()`; `orders` row as the portal writes it (`customer_id`, `rfq_id`, `status 'new'`, `total_amount` = (Σ `parts_details[*].total_price` + `shipping_cost`) × 1.24, `currency` = `rfqs.currency` or `EUR` **set explicitly** (the `orders.currency` default is `USD`), `title = po_number = po`, `from_rfq_number`, `start_date now()`, `delivery_date now() + 14 d`, `tenant_id`); one `order_items` row per part with the portal's fallbacks for sparse parts: `product_name = coalesce(p->>'product_name', '')`, `description = coalesce(p->>'description', '')`, `quantity = coalesce((p->>'quantity')::int, 0)`, `unit_price = coalesce((p->>'unit_price')::numeric, 0)`, `total_price = coalesce((p->>'total_price')::numeric, 0)` (explicit NULLs do not take column defaults; live 2026-10-04: `product_name` NOT NULL without default, `quantity`/`unit_price`/`total_price` NOT NULL with defaults; portal src/pages/customer/QuoteDetailPage.tsx:440-447), `tenant_id` | "Won" path equals the portal Accept Quote (CR-5) | idempotent second call; totals equal the portal formula; currency explicit; a part without `product_name`, `quantity` or prices inserts with `''`/`0`; anon/authenticated denied |
| AM-5 | `agent_staff_for_email(p_email text) RETURNS TABLE(user_id uuid, roles text[])`, SECURITY DEFINER, `search_path = public`, `lower(email)` match on `auth.users`, roles = `array_agg(role::text)` over the four staff roles from `user_roles` only (`user_roles.role` is enum `app_role`, live 2026-10-04; 0 rows when none), EXECUTE `service_role` only | MCP principal mapping (CR-10) | staff → roles; customer → 0 rows; tenant-only role → 0 rows; anon/authenticated denied |

Portal evidence for AM-4: src/pages/customer/QuoteDetailPage.tsx:171-178 (`total` at :178, written at :427) (currency, subtotal, shipping, 24 % VAT in `total`), :396-449 (status update, `next_po_number`, order and items; `delivery_date` = `rfq.delivery_date` or now + 14 d, and live `rfqs` has no `delivery_date` column, so the portal always writes now + 14 d; live 2026-10-04 `information_schema.columns`); live 2026-10-03: `next_po_number()` returns `text`, SECURITY DEFINER, executable by `service_role`; `orders` has no unique key on `rfq_id`; `orders.currency` default `'USD'`; `orders.tenant_id` and `order_items.tenant_id` have defaults (live 2026-10-04), AM-4 still sets both from `rfqs.tenant_id`. The 24 % factor is copied for parity, not endorsed (the quote PDF shows the intra-Community notice, src/pages/RfqDetails.tsx:1294-1296); listed as owner-sensitive default DF-43 (§11).

Service-role RPCs (exact signatures):

| RPC | Signature | Caller |
|---|---|---|
| `create_email_rfq` | `(p_inbound_email_id uuid, p_payload jsonb, p_source text) → TABLE(rfq_id uuid, rfq_number text, customer_id uuid)`; `p_source ∈ {email, techpilot}`; payload in the web-form shape of [agents] §8.3 | IN step `create-rfq` |
| `agent_run_begin` | `(p_agent text, p_trigger text, p_idempotency_key text, p_fields jsonb DEFAULT '{}', p_tenant_id uuid DEFAULT <default tenant>) → TABLE(run_id uuid, created boolean, run_status text)`; `p_fields` keys `workflow_name`, `workflow_instance_id`, `parent_run_id`, `subject_type`, `subject_id`, `prompt_version` | `openRun()` (K) |
| `agent_run_claim_approval` | `(p_token_sha256 text, p_human_action jsonb) → TABLE(run_id uuid, agent text, workflow_name text, workflow_instance_id text, output jsonb)`; second claim → no row | `decide()` (K) |
| `stock_hold` | `(p_order_item_id uuid, p_material_id uuid, p_holds jsonb /* [{stock_item_id?, area_mm2?, quantity?}] */, p_expires_at timestamptz, p_held_by text DEFAULT NULL) → SETOF stock_reservations` | `MaterialStock.reserve` (RP) |
| `stock_commit` | `(p_order_item_id uuid, p_nesting_session_id uuid) → SETOF stock_reservations` | `MaterialStock.commit` |
| `stock_release` | `(p_order_item_id uuid, p_reason text /* cancelled\|consumed\|expired\|manual */) → SETOF stock_reservations` | `MaterialStock.release`, `expireHolds` |
| `agent_retention_purge` | `(p_now timestamptz DEFAULT now()) → jsonb` | owner by hand before Phase 5; `ops-digest` monthly (P5-7) |
| `feature_flags_sync_batch`, `feature_flags_mark_synced(p_key, p_tenant_id, p_rev)`, `feature_flags_seed_from_kv(p_key, p_tenant_id, p_kv)`, `feature_flags_kv_key(p_key, p_tenant_id)`, `feature_flags_kv_value(p_enabled, p_value, p_updated_at, p_rev)` | as agent_layer.sql:190-287 | `cron/flags-sync.ts` (DB), flag edit action (W) |
| `create_order_from_quote` | AM-4 | CQ step `won` |
| `agent_staff_for_email` | AM-5 | XZ `mcp/auth.ts` |

Single-statement idempotent writes through PostgREST (no RPC): `inbound_emails` `on_conflict=tenant_id,message_id_sha256` + `Prefer: resolution=ignore-duplicates,return=representation`; `rfq_files` `on_conflict=rfq_id,sha256`; `cad_jobs` `on_conflict=rfq_id,idempotency_key`; `quote_workflows` `on_conflict=rfq_id,quote_version`; reply lookup `quote_workflows?outbound_message_ids=ov.{<ids>}` (GIN). Status vocabularies are the CHECK lists of agent_layer.sql (`inbound_emails.status` :417-418, `quote_workflows.status` :356-357, `cad_jobs.status` :465-466, `agent_runs.status` :104); code uses string-literal unions copied from them, and a T1 test in each unit parses the migration file to assert the union equals the CHECK list.

KV mirror (P4-2) contract: key = flag key for the default tenant, `t:<tenant_id>:<key>` otherwise; value `{"enabled": bool, "value": {...}, "updated_at": "…Z", "rev": n}` plus `"mode"` when `value.mode` is set; tick order seed → `sync_batch` → `FLAGS.put` → `mark_synced`; `agent_runs` row (`agent 'flags'`, `trigger 'cron'`) only when something changed or failed; hourly drift check at minute 0 reports only ([data] §4.2-§4.5; reference implementation `pglite/flags-sync.mjs`, tested).

`types.ts` (R-54): regenerated by Claude with the Supabase MCP generator **after** the owner applies the migration; UTF-8 without BOM, LF; 79 tables expected; gate = zero `tsc` errors in Phase 4 frontend files plus `npx vite build` (baseline 321 errors in other files, not gated) ([data] §8). Until then the dashboard uses the untyped accessor of §8.

### 4.14 Decision and agent endpoint contract

Site (W): `endpointOfPath()` returns `'agent'` for any path under `/api/agent/`; actions and methods: `decision` POST, `status` GET, `flag` POST, `start` POST, `file` GET. Unknown action → 404 `{"error":"not_found"}`, wrong method → 405 with `Allow`, body > 65,536 bytes → 413, all answered at the site and never dispatched; target `ops` via `callOps` (P2 §2.4); `Cache-Control: no-store`; **never forwarded to Vercel**, whatever `api.forward_to_vercel` says (CR-18). Gate rows (action IDs AG-1…AG-7, details Appendix P.2):

| ID | Action | Principal | Rate key |
|---|---|---|---|
| AG-1 | `decision` with `DecisionBodyDashboard` | STAFF or ADMIN (Supabase JWT, `user_roles` array) | `u:<uid>:agent` |
| AG-2 | `decision` with `DecisionBodyRelay` | `MACHINE:telegram` by HMAC headers `X-Microns-Timestamp`, `X-Microns-Signature` (key `AGENT_APPROVAL_SECRET`) | `m:telegram:agent` |
| AG-3 | `file` with `k`, `exp`, `sig` | signed partner link | `file:<ip>` |
| AG-4 | `flag` | ADMIN | `u:<uid>:agent` |
| AG-5 | `status` | STAFF or ADMIN | `u:<uid>:agent` |
| AG-6 | `start` (`test_card`: ADMIN) | STAFF or ADMIN | `u:<uid>:agent` |
| AG-7 | `file` with `Authorization` | STAFF or ADMIN, fixed key patterns | `u:<uid>:agent` |

Ops (K owns `routes/agent.ts` and `agents/decision.ts`; W owns `routes/agent-admin.ts` for `status`, `flag`, `start` and the staff `file` read):

```ts
export interface DecideInput {
  channel: 'dashboard' | 'telegram' | 'mcp'; actor: string;           // 'user:<uuid>' | 'telegram:<from.id>' (CR-15)
  run_id?: string; token?: string; token_sha256?: string;             // exactly one of token / token_sha256
  verb?: string; code?: string; edits?: QuoteEdits; note?: string;    // telegram: code; dashboard and mcp: verb
}
export type DecideError = 'bad_request' | 'not_found' | 'already_decided' | 'verb_not_allowed';
export function decide(env: OpsEnv, ports: Ports, i: DecideInput): Promise<{ ok: true; result: DecisionResult } | { ok: false; error: DecideError }>;
```

| # | `decide()` step | Rule |
|---|---|---|
| 1 | Hash | `token` → SHA-256 hex (relay only); `token_sha256` accepted only for `dashboard` and `mcp` |
| 2 | Load | `agent_runs?approval_token_sha256=eq.<h>&status=eq.waiting_human` → none: `already_decided`; `run_id` given and different: `not_found` |
| 3 | Verb | telegram: `verb` from `VERB_CODES[output.card_kind]` by code; every channel: `verb ∈ output.allowed_verbs` else `verb_not_allowed`; `edits` only with card kind `quote`, verb `approve`, channel `dashboard`, validated (Appendix P.2) |
| 4 | Claim | `rpc/agent_run_claim_approval(h, {channel, actor, verb, note?})`; no row → `already_decided` |
| 5 | Act | event per §4.10 table (`sendEvent`), or reject (`not_rfq`, quote `reject`: business row `rejected`, `instance.terminate()`), or `retry` on a `failure` card (`instance.restart({from: {name: output.failed_step}})`, outcome `restarted`; §4.10), or `dismiss` (`closeRun` `failed` for a `failure` card keeping its `error`, `succeeded` for a `test` card, `cancelled` otherwise; outcome `dismissed`). Parked runs (no token) are never decided; the dispatcher resumes them |
| 6 | Card | edit the Telegram card for every channel ("<label> by <actor> at <time>", buttons removed) |

Card and approval helpers (K; card builders per kind are owned by the unit of §3.2):

```ts
// agents/cards/index.ts
export interface CardV1 {
  v: 1; kind: CardKind; run_id: string; title: string;                      // title ≤ 120 chars, e.g. 'RFQ-20261004-1 · Example GmbH (DE)'
  lines: Array<{ label: string; value: string }>;                           // business fields only (≤ 12 lines, values ≤ 200 chars)
  flags: Array<'dmarc_fail' | 'injection_suspected' | 'low_confidence' | 'flag_off' | 'manual_lines'>;
  allowed_verbs: string[];                                                  // subset of keys of VERB_CODES[kind]
  open_url: string;                                                         // `${SITE_ORIGIN}/dashboard/approvals?run=<run_id>` (intake: rfq-inbox)
}
export function renderTelegram(c: CardV1, token: string | null): { text: string; reply_markup: { inline_keyboard: unknown[][] } };
// HTML parse mode, every value escaped, text ≤ 4,096 chars; token null -> URL button only (decided, reminder replaced, or no relay secret yet)
export function maskEmail(addr: string): string;                            // 'h***@example.de'

// agents/approval.ts
export function request(env: OpsEnv, ports: Ports, r: { run_id: string; card: CardV1 }): Promise<{ token: string; telegram_message_id: number | null }>;
// new token; one PATCH: status waiting_human, approval_token_sha256, output.{card_kind, allowed_verbs, card, telegram_message_id}
export function waitWithReminder<T>(step: WorkflowStep, o: { run_id: string; type: string; first: WorkflowTimeoutDuration; second: WorkflowTimeoutDuration;
  card: () => CardV1; onTimeout: () => Promise<void> }): Promise<{ event: T } | { timedOut: true }>;
// waitForEvent in try/catch (probe #4) -> step 'remind-<type>' (new token, old hash replaced, reminder card) -> second wait -> onTimeout
```

HTTP mapping: 200 `DecisionResult`; 400 `bad_request`; 404 `not_found`; 409 `already_decided`; 422 `verb_not_allowed`. `approval.request()` (K) writes `output.card_kind`, `output.allowed_verbs`, `output.card` (business fields only: RFQ/PO number, company, country, language, masked sender, parts count, file kinds, totals, confidence, DMARC/injection flags, dashboard link), `output.telegram_message_id`, and the token hash, in one PATCH. Telegram cards carry one row of callback buttons (`ap:<token>:<code>`) for verbs with a code and a URL button "Open" → `${SITE_ORIGIN}/dashboard/approvals?run=<run_id>` (intake: `/dashboard/rfq-inbox?email=<id>`).

### 4.15 LLM contract (K builds the client; IN, CQ, RP write prompts)

| Item | Contract | Source |
|---|---|---|
| Client | `async anthropicFor(env, meta): Promise<Anthropic>` of [agents] §6.2 (asynchronous because `getUrl()` is; callers write `(await anthropicFor(env, meta)).messages.parse(…)`): `apiKey: null`, `baseURL` from `getUrl('anthropic')` (or `AGENT_LLM_BASE_URL` in T2), `maxRetries: 0`, `timeout: 170_000`, headers `x-api-key: null`, `cf-aig-authorization`, `cf-aig-metadata` (5 keys), `cf-aig-collect-log-payload: 'false'`, `cf-aig-request-timeout: '150000'` | sdkprobe; probe #11 |
| Call | `messages.parse` with `output_config: {format: jsonSchemaOutputFormat(schema), effort?}`; `extract` on the beta namespace with `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'` (F4-7); no `thinking` field (Sonnet 5.5 rejects `disabled`); no forced `tool_choice` | skill (2026-10-03) Sonnet 5.5 notes |
| Prompts | `src/agents/prompts/<agent>/<step>.v<N>.md` (front matter `route`, `max_tokens`, `effort`) + `<step>.v<N>.schema.json`; ids `rfq_intake.triage@v1`, `rfq_intake.extract@v1`, `rfq_intake.classify_process@v1`, `quote.price_notes@v1`, `quote.cover_email@v1`, `quote.classify_reply@v1`, `post_order.traveller_notes@v1`, `post_order.reorder_draft@v1`; released files immutable (per-agent `LOCK.json` of SHA-256); flag `value.prompts["<step>"]` may pin a version | [agents] §7.1 |
| Schemas | `additionalProperties: false` on every object, every property required (optional = nullable), no numeric or length constraints | [agents] N-7 |
| Untrusted data | e-mail text and attachments only in the user turn inside `<untrusted_email>` / `<attachment n="…">` blocks; schemas carry `injection_suspected` | AGENTS.md:158-164 |
| Caching | one `cache_control` breakpoint on the last system block for Sonnet prompts (minimum cacheable prefix 512 tokens); Haiku prompts unmarked (minimum 4,096) | skill (2026-10-03) prompt-caching table |
| Stop handling | `refusal` → non-retryable, human card; `max_tokens` → one retry with doubled `max_tokens` (cap 8,192); parse failure → one re-ask; gateway 429 → `budget` → park | [agents] §6.2 |
| Prices (`agents/prices.ts`, `PRICES_VERSION = '2026-09-25'`) | Sonnet 5.5 in 2.00, out 10.00, cache read 0.20, cache write 2.50; Haiku 4.5 in 1.00, out 5.00, cache read 0.10, cache write 1.25 (USD per MTok); bge-m3 0.0118 per M input tokens | skill (2026-10-03); CF docs (fetched 2026-10-03) https://developers.cloudflare.com/workers-ai/models/bge-m3/ |
| Documents | PDF trimmed to pages 1-5 (`pdf/trim.ts`, CQ, used by IN), ≤ 3 images ≤ 3.75 MB each, request ≤ 20 MB; CAD files never sent to the model | [agents] §6.4 |

### 4.16 Analytics Engine data point (`agents/events.ts`, K)

`indexes[0]` = `run_id`; `blobs` = `event` (`llm_call`, `embed_call`, `step`, `run_end`, `cad_job`, `mail_in`, `send`), `agent`, `step`, `route` or backend, `model`, `outcome`, `prompt_version`, `tenant_id`, `workflow_instance_id`; `doubles` = `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `latency_ms`, `attempt`, `bytes`. Fixed order; writer is a no-op without the binding and never throws ([agents] §13.2; CF docs (fetched 2026-10-03) https://developers.cloudflare.com/analytics/analytics-engine/limits/). Per-run cost: `agent_runs.cost_cents` = 100 × USD sum of successful calls, written once at close ([agents] §13.1).

### 4.17 Cron table (`microns-ops` `scheduled()`, K dispatches by `controller.cron`)

| Cron (UTC) | Handler (owner) | Work |
|---|---|---|
| `* * * * *` | `cron/flags-sync.ts` `flagsSyncTick(env, controller)` (DB) | seed, mirror, mark; drift check when the minute is 0 |
| `*/10 * * * *` | `cron/dispatcher.ts` `dispatcherTick(env, controller)` (RP) | Gmail poller; orphan inbound rows (`received` > 15 min); portal orders without a post-order run; parked runs whose flag is on again (`flag_off`) or older than 30 min (`llm_unavailable`); runs on a `failure` card (`parked_reason = 'failed'`) are never resumed, and those older than 14 days are closed `failed` (token cleared, card edited); `cad_jobs` stuck > 30 min → `dead_letter` |

Cron Triggers run in UTC; trigger changes take up to 15 min to propagate; a cron under 1 h gets 30 s CPU per invocation (CF docs (fetched 2026-10-03) https://developers.cloudflare.com/workers/configuration/cron-triggers/, https://developers.cloudflare.com/workers/platform/limits/).

### 4.18 Remote MCP contract (XZ)

| Item | Contract |
|---|---|
| Entry | ops default `fetch(req?, env?, ctx?)`: `req` present and `new URL(req.url).hostname === env.MCP_HOSTNAME` → `handleMcp(req, env, ctx)` (`mcp/index.ts`); every other case keeps the Phase 2 404 with no body (P2 F-6). The parameters stay optional because a frozen Phase 2 test calls `worker.fetch()` without arguments (workers/ops/test/ops-api.test.ts:46-50). In `wrangler dev` the request URL's hostname follows the `Host` header (probe 2026-10-04 T-7), so T2 reaches this branch with `Host: mcp.micronshub.eu` on a harness instance whose primary Worker is ops (§6.3) |
| Handler | `createMcpHandler(() => createMicronsMcpServer(ctx), {route: env.MCP_ROUTE, allowedHostnames: [env.MCP_HOSTNAME], corsOptions: false, authContext: {props: {uid, roles, class, stage}}})` |
| Auth | `verifyAccessAssertion(headers, {teamDomain: ACCESS_TEAM_DOMAIN, audiences: [MCP_ACCESS_AUD]})` (P2 `access-jwt.ts`) → e-mail required → `rpc/agent_staff_for_email` → staff principal; per-isolate cache 60 s; failures 401/403 JSON |
| Rate limit | `MCP_RATE_LIMIT`, key `mcp:<uid>` → 429 |
| Stages (`readFlag(env, 'mcp.remote')`) | off/missing → tool `mcp_status` only; on → 35 read tools + 3 resources + 2 prompts; `value.writes` → + `decide_approval`, `update_lead_status`, `update_tender_status`, `trigger_country_scan`, `run_saved_search`; `value.write_tools: string[]` → named opt-in tools ([surfaces] §5.4, §5.6) |
| Tools | the 39 local tools (mcp-server/src/index.ts has 39 `server.tool(` calls, grep 2026-10-03) ported with a parity test, plus 12 new (`list_rfqs`, `get_rfq`, `list_inbound_emails`, `get_quote_workflow`, `list_pending_approvals`, `list_orders`, `get_order`, `get_stock_summary`, `list_agent_runs`, `search_similar_quotes`, `decide_approval`, `start_quote`); `api_base_url` arguments dropped; long jobs queued on `scrapes` |
| Audit | one `agent_runs` row per `tools/call` (`agent 'mcp'`, `trigger 'mcp'`, `output = {tool, actor, ok, ms, args_sha256, result_summary}`); write tools deduplicated by the key of §4.8 |
| Packages | §4.19 |

### 4.19 Packages (exact pins)

| Package | Where | Version | Note |
|---|---|---|---|
| `@anthropic-ai/sdk` | ops | 0.131.0 | F4-5 |
| `zod` | ops | 4.6.5 | CR-11 |
| `postal-mime` | ops | 2.7.4 | same version as root `node_modules` (2026-10-03) |
| `@pdf-lib/fontkit` | ops | 1.1.1 | F4-9 |
| `agents` | ops | 0.24.0 | F4-12 |
| `@modelcontextprotocol/server`, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/client` | ops | 2.0.0, 1.30.0, 2.0.0 | exact non-optional peers of `agents` 0.24.0 |
| `@cloudflare/puppeteer` | ops | 1.4.0 | Browser Run |
| `pdf-lib`, `@supabase/supabase-js` | root (not added to ops) | 1.17.1, 2.101.1 | CR-26; `check-bundle` asserts one copy each |
| `hono` | ops | 4.13.12 | P2 |
| `@electric-sql/pglite`, `pglite-pg16` (`npm:@electric-sql/pglite@0.2.17`), `pg` | `supabase/tests/agent_layer` | 0.5.8, 0.2.17, 8.23.1 | [data] §7 |
| Toolchain | all packages | wrangler 4.145.0, vitest 5.0.3, TypeScript 7.0.2, workers-types 5.20260930.2 | P2 G-8 |
| Frontend | root | none new | shadcn, TanStack Query, sonner present (package.json:64, :104) |

No new dependency in the root `package.json` or root lockfile (P2 F-2). Not used: `@cloudflare/workers-oauth-provider` (fallback only, §14 BR-9).

### 4.20 Scraper contract (XZ)

| Rule | Value |
|---|---|
| Module | `scrapers/{robots,fetch-page,browser,directory,profile}.ts`, `scrapers/parsers/{directory,profile}.ts` (ported from api/scan-directory.js:71-440 and api/scrape-company-profile.js:54-382) |
| robots gate | every new fetch path checks robots.txt for product token `MicronsHubBot` (RFC 9309 matching; unreachable → disallow) → `{"error":"robots_disallowed"}`; override only per host via `SCRAPER_PERMITTED_HOSTS` (JSON host → permission reference, owner-recorded) |
| Browser use | only when a permitted page answers 200, the parser finds no company cards and the page needs client rendering; a 403, 429, challenge page or CAPTCHA ends that host for 24 h; at most 1 browser per invocation, 1 tab, closed in `finally` |
| Fan-out | `limit(6)` (shared `limit.ts`); `scrapes` consumer `max_concurrency` stays 2 |
| Identity | `User-Agent: SCRAPER_USER_AGENT`; delays ≥ 2.5 s (Europages) / 4 s (wlw) and ≥ `Crawl-delay` |
| Routes | `/api/scan-directory`, `/api/scrape-company-profile`: flag off or host not permitted → the Phase 2 path byte-identical; flag on and host permitted → module path, same response JSON + `scan_logs` + `agent_runs` (`growth.scrapers`) |
| Queue kind | `directory-scan` ([surfaces] §8.5) |

---

## 5. Build units (disjoint file ownership; acceptance runnable in this container without a Cloudflare account)

Common rules for every card: the unit owns exactly the files listed under "Owns" (plus the tree rows of §3.2 with its letter); "Reads" names the annex sections that hold the detailed design; every command runs from the repo root with Node 22 and no network to production; T2 commands use the `agents` profile of §6.3; a unit is done when every row of its acceptance table passes and §5.8 is green. Effort figures are estimates against PLAN.md:314-327 (Phase 4 total ≈ 14.5 d, PLAN.md:360).

Shared scan commands used below:

| Name | Command | Pass |
|---|---|---|
| SCAN-SECRET `<paths>` | `rg -n -e 'eyJ[A-Za-z0-9_-]{10,}' -e 'whsec_[A-Za-z0-9]' -e '(^\|[^A-Za-z0-9_])re_[A-Za-z0-9]{8}' -e 'sk-ant-' -e 'AKIA[0-9A-Z]{16}' -e '[0-9]{8,10}:[A-Za-z0-9_-]{35}' <paths>` (the `\|` escapes only protect this table; in a shell each is a plain bar) | no output (P2 G-5; the last pattern is the Telegram bot-token shape). The Resend pattern is anchored so identifiers such as `hardware_confidence` (src/pages/dashboard/FundedStartupsPage.tsx:179; mcp-server/src/index.ts:1349, :1386) do not match; checked 2026-10-04: the anchored pattern gives no output on `src/pages/dashboard mcp-server/src workers` |
| SCAN-WORDING `<paths>` | `rg -n -i -e 'appendix p' -e '_private' -e 'private note' -e 'any chat' -e 'disallow generic' -e 'without a secret' -e 'not restricted' <paths>` | no output (public-repo rule, CANON.md §1: rules are stated as rules, never as descriptions of today's weaknesses) |
| CHANGED `<paths>` | `git diff --name-only --diff-filter=AM <phase2-close> -- <paths>` (the files a unit added or changed since the Phase 2 closing commit) | used as the path list of the scans when a scanned directory also holds pre-existing files |
| CHECK-LISTS | each unit's T1 suite contains one test that reads the status/CHECK lists it uses through `test/helpers/check-lists.ts` (DB) from the migration file and asserts the TypeScript string-literal union equals the list | green |

### 5.1 Unit DB: data layer — P4-1 (1 d), P4-2 (0.5 d)

| Item | Detail |
|---|---|
| Owns | `.gitattributes`; `supabase/migrations/<yyyymmdd>_agent_layer.sql`; `supabase/rollback/<yyyymmdd>_agent_layer_down.sql`; `supabase/tests/agent_layer/{package.json,package-lock.json,live_min.sql,test.mjs,flags-sync.mjs,vectors/*.json,README.md}`; `workers/ops/src/db/repos/feature-flags.ts`; `workers/ops/src/cron/flags-sync.ts`; `workers/ops/test/helpers/{memory-rpc,check-lists}.ts`; `workers/ops/test/flags/**`; `workers/ops/test/t2/flags.t2.ts`; `workers/site/test/integration/stubs/postgrest.mjs`; later, in a separate commit: `src/integrations/supabase/types.ts` |
| Reads | [data] all; §4.13 (amendments AM-1…AM-5), §4.17 (cron), Appendix P.1 |
| Builds | The repo migration = `agent_layer.sql` + AM-1…AM-5 inside the same transaction and precondition block; the down script removes the AM objects too; `supabase/tests/agent_layer` = `phase4/pglite` with the file paths changed to glob `../../migrations/*_agent_layer.sql` and `../../rollback/*_agent_layer_down.sql` (exactly one match each, else exit 1), scripts `test` (PGlite 0.5.8) and `test:pg16` (PGlite 0.2.17), `live_min.sql` sanitised per Appendix P.1, tests added for AM-1…AM-5; `flags-sync.ts` = TypeScript port of `pglite/flags-sync.mjs` behind `Db` and `KVNamespace` (tick order of §4.13); `memory-rpc.ts` = JavaScript versions of every RPC of §4.13 for `MemoryDb`, **self-contained (no imports)** so Node 22.22.2 type stripping can load it from the SQL test package (probe 2026-10-04: `node` imports a `.ts` file directly); the mini-PostgREST stub (§6.3) |
| File name date | `<yyyymmdd>` = the build day of the commit that adds the file; it is not renamed when the owner applies it on another day (the file is applied in the SQL editor, not by a migration runner: `supabase_migrations.schema_migrations` stops at `20260713092040`, [data] key facts) |
| Depends on | Nothing for Wave 0; K's `Db` interface (§4.6) for `flags-sync.ts` |

Acceptance:

| # | Command | Pass |
|---|---|---|
| DB-1 | `npm --prefix supabase/tests/agent_layer ci && npm --prefix supabase/tests/agent_layer test` | every assertion passes on Postgres 18.3 (≥ 366 of [data] §5 plus the AM tests of §4.13); includes the failed second apply and the removal round trip |
| DB-2 | `npm --prefix supabase/tests/agent_layer run test:pg16` | same on Postgres 16.4 |
| DB-3 | `npm --prefix supabase/tests/agent_layer run test:rpc-parity` | the vectors in `vectors/rpc.json` (claim twice, claim of a `failed` park (`parked_reason` cleared), hold over remaining, commit, release, `create_order_from_quote` twice and with a sparse part (no `product_name`, `quantity` or prices), `agent_run_begin` twice, `create_email_rfq` duplicate) give the same rows from the SQL RPCs (PGlite) and from `workers/ops/test/helpers/memory-rpc.ts` |
| DB-4 | `npm --prefix workers/ops test -- test/flags` | `flagsSyncTick` against a fake KV: seed rules of [data] §4.5 (valid, absent, malformed), `rev` ordering, `mark_synced` only after `put`, drift report at minute 0 without overwrite, run row only on change or failure; the KV vectors of `pglite/flags-sync.mjs` reused as JSON |
| DB-5 | the sanitisation check of Appendix P.1 (P1-d); SCAN-WORDING `supabase/tests/agent_layer supabase/migrations/*_agent_layer.sql supabase/rollback`; SCAN-SECRET same paths | no output |
| DB-6 | `rg -c "^CREATE TABLE public\." supabase/migrations/*_agent_layer.sql`; then `awk '/^INSERT INTO public.feature_flags/{f=1;next} f&&/^ *\(/{match($0,/^ *\(\x27[^\x27]+\x27/);print substr($0,RSTART,RLENGTH)} f&&/;[[:space:]]*$/{f=0}' supabase/migrations/*_agent_layer.sql \| tr -d " ('" \| sort \| uniq -c` | `7`; exactly 13 lines, each with count 1, whose keys equal the 13 canonical keys of CANON.md §7 (= `FlagKey`, §4.3) |
| DB-7 (after the owner applied the migration, §12 OW-6) | `file src/integrations/supabase/types.ts`; `awk '/^  public: \{/{p=1} p&&/^    Tables: \{/{f=1;next} f&&/^    Views: \{/{exit} f&&/^      [a-z0-9_]+: \{$/{c++} END{print c}' src/integrations/supabase/types.ts` (counts only the `public.Tables` entries; Views and Functions entries share the indentation, e.g. `has_role: {` under `Functions`); `npx vite build`; `npx tsc --noEmit -p tsconfig.app.json 2>&1 \| rg "src/(pages/dashboard/(RfqInboxPage\|ApprovalsPage\|agent/)\|utils/agentApi\|lib/agentDb\|types/agent)"` | UTF-8/ASCII text without CRLF; 79 tables; build succeeds; no output from the last command ([data] §8; baseline 321 errors elsewhere is reported, not gated) |

### 5.2 Unit K: kernel — P4-3 (0.5 d), P4-13 (0.25 d), ports and decision core (0.5 d), test infrastructure and Phase 2 test-pin extensions (0.75 d)

| Item | Detail |
|---|---|
| Owns | The K rows of §3.2: shared `rpc.ts` (extension), `test/http/rpc.test.ts` (extension), `agent-types.ts`, `agent-api.ts`, `test/agent-api.test.ts`, `test/fixtures/agent-api/*.json`; ops `package.json`, `package-lock.json`, `wrangler.jsonc`, `vitest.config.ts`, `vitest.t2.config.ts` (extension), `vitest.t2.agents.config.ts` (new), `.dev.vars.example`, `.gitignore`, `README.md`, `scripts/check-bundle.mjs` (extension), `test/config.test.ts` (extension), `src/index.ts`, `src/env.ts`, `src/app.ts` (one line), `src/ports/**`, `src/db/postgrest.ts`, `src/db/repos/agent-runs.ts`, `src/agents/{config,flags,runs,ids,gateway,prices,approval,decision,events}.ts`, `src/agents/cards/{index,failure,test}.ts`, `src/agents/prompts/registry.ts`, `src/workflows/steps.ts`, `src/queues/messages.ts` (extension), `src/routes/agent.ts`, `eval/**`, `test/helpers/{cloudflare-workers,cloudflare-workflows,cloudflare-email,agent-env,fake-step,fake-do,memory-db,recorders}.ts`, `test/kernel/**`, `test/t2/kernel.t2.ts`; site `src/api/{resolve,router}.ts` (Wave 0 stub lines only, then W), `test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs}` (extension), `test/integration/stubs/{anthropic,resend,telegram,gmail,google-token}.mjs`; `scripts/eval/README.md`; `.github/workflows/cf-ops.yml` (header comment, §7.2) |
| Reads | [agents] §4, §6, §7.1, §7.4, §8.1, §13, §14, §15; [surfaces] §4.2-§4.4; this spec §4 (all), §6 |
| Builds | Wave 0 contract stubs (§3.3), then: `makePorts` and every production and fake adapter except `cad` (CQ) and `browser` (XZ); `PostgrestDb`; run records; `readFlag`/`readAgentFlag`; ids; AI Gateway client and prices; `approval.request`, `waitWithReminder`, card renderer, `failure` and `test` cards; `decide()` (§4.14); `routes/agent.ts` (`decision`, signed `file`, delegation to `agent-admin.ts`); Analytics Engine writer; step profiles; `index.ts` exports and dispatchers (`fetch(req?, env?, ctx?)` with the MCP host branch, §4.18; `queue` by `batch.queue` and message envelope, §4.9; `scheduled` by `controller.cron`); `need()`, `failRun()`, `dailyCapReached()`; eval runner (`eval/{run-eval.ts,synthetic.eval.ts,vitest.eval.config.ts,fixtures.schema.json,README.md}`); T2 harness profile `agents` and provider stubs (§6.3); the T1 vitest contract of §6.2 (aliases, `agents` inlined, wrangler-rules plugin); the Phase 2 test extensions of §7.2 (`rpc.test.ts`, `config.test.ts`, `vitest.t2.config.ts`); the `check-bundle.mjs` extension |
| `package.json` scripts (K writes all names in Wave 0) | `test`, `typecheck`, `build:dry` (P2) · `test:integration` (P2) · `test:integration:agents` = `T2_PROFILE=agents vitest run -c vitest.t2.agents.config.ts` · `eval:synthetic` = `vitest run -c eval/vitest.eval.config.ts` · `eval:live` = `EVAL_MODE=live vitest run -c eval/vitest.eval.config.ts` (owner only) · `pdf:samples` = `PDF_SAMPLES=1 vitest run test/pdf/samples.test.ts` (file owned by CQ) · `mcp:parity` = `MCP_PARITY=1 vitest run test/mcp/parity.test.ts` (file owned by XZ) |
| Depends on | Phase 2 closing commit; DB's SQL shapes (§4.13) |

Acceptance:

| # | Command | Pass |
|---|---|---|
| K-0 (Wave 0) | `npm --prefix workers/shared run typecheck && npm --prefix workers/ops ci && npm --prefix workers/ops run typecheck && npm --prefix workers/site run typecheck && npm --prefix workers/mail ci && npm --prefix workers/mail run typecheck && npm --prefix workers/shared test && npm --prefix workers/site test && npm --prefix workers/ops test` | green with every stub in place (mail package skeleton is written by K in Wave 0, then owned by IN); every Phase 2 suite green, `test/config.test.ts` and `test/http/rpc.test.ts` extended as §7.2 allows and no other Phase 2 test file changed (G4-10) |
| K-1 | `npm --prefix workers/shared test -- test/agent-api.test.ts` | `VERB_CODES` codes unique per kind; every `ap:<token>:<code>` ≤ 34 bytes and matches `CALLBACK_DATA_RE`; every fixture in `test/fixtures/agent-api/` parses into its type guard |
| K-2 | `npm --prefix workers/ops test -- test/kernel` | `readFlag` fail-closed matrix (missing, malformed, KV throw, `seo.*` refused by type); `openRun` created/existing/final; ids (instance ids ≤ 100 chars and match `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`; token 26 chars base32; Message-ID format); gateway request: no `x-api-key`, `cf-aig-authorization`, `cf-aig-metadata` with exactly 5 keys, `cf-aig-collect-log-payload: false`, `cf-aig-request-timeout`, beta + `fallbacks` only on `extract`, `refusal`/`max_tokens`/parse/429 mapping (SDK against a recorded fetch); prices → `cost_cents`; data-point layout; `decide()` matrix (both bodies, wrong channel for a hash, verb not allowed, double claim → `already_decided`, every outcome kind, `edits` validation); `approval.request` writes one PATCH; `waitWithReminder` timeout → reminder → second timeout through `FakeStep`; `makePorts` throws with `AGENT_STUBS` while `AI` is bound; prompt `LOCK.json` hashes and schema rules (N-7) for every prompt file present; T1 loader smoke: `import('agents/mcp')` resolves and exports `createMcpHandler` (agents SDK under Node, §6.2), one prompt `.md` loads as a string and `LiberationSans-Regular.ttf` as an `ArrayBuffer` through the same import paths the code uses; `need()` throws `ConfigMissingError` naming the missing fields; `closeRun` writes `cost_cents > 0` whenever `llm_calls > 0` and clears the token and `parked_reason`; `failRun` (one PATCH: `waiting_human`, `parked_reason 'failed'`, token hash, `failure` card with `retry`/`dismiss`, or `dismiss` only without a failed step); `decide()` on a failure card: `rty` → `restart({from:{name: failed_step}})` once, `dis` → `failed`, restart error → `restart_failed`; `dailyCapReached` at cap and cap + 1; default `fetch()` without arguments → 404 with no body, non-MCP host → 404, MCP host → `handleMcp`; `index.ts` `queue()` routes a `DirectoryScanMessage` to XZ and a Phase 2 `ScrapeMessage` to `scrapesConsumer` (spies) |
| K-3 | `npm --prefix workers/ops run build:dry && node workers/ops/scripts/check-bundle.mjs` | the Phase 2 rules still pass (`bundleProblems()`: `qrcode` resolves to its server build); bundles; one copy each of `pdf-lib`, `@supabase/supabase-js`, `zod`; contains `@anthropic-ai/sdk`, `postal-mime`, `@pdf-lib/fontkit`, `agents`; production `wrangler.jsonc` `vars` contain none of `AGENT_STUBS`, `AGENT_LLM_BASE_URL`, `*_API_BASE`, `GOOGLE_TOKEN_URL`; uncompressed size printed and below 64 MiB (Workers limit, `phase2/cfdocs/workers_platform_limits.md:264-282`, fetched 2026-10-02) |
| K-4 | `npm --prefix workers/ops run eval:synthetic` | replay over the public synthetic fixtures; metrics printed; no network (fetch is replaced by a thrower) |
| K-5 | `npm --prefix workers/ops run test:integration:agents -- test/t2/kernel.t2.ts` | harness starts site (primary) + ops + mail with the stripped bindings and asserts at start-up that every Phase 4 secret name reached `env` (§6.3); `GET /api/agent/status` through the site with a stub-minted staff JWT → `{v:1, ok:true}`; `test_card` start → Telegram stub recorded one `sendMessage` with `ap:` buttons; relay-signed decision `dis` → run `succeeded`, card edited; Local Explorer `scheduled?worker=microns-ops` with `{"cron":"* * * * *"}` runs `flagsSyncTick` |
| K-6 | SCAN-SECRET and SCAN-WORDING on `workers/ops/src workers/ops/eval workers/shared/src workers/site/test/integration` | no output |

### 5.3 Unit IN: inbound mail and intake — P4-4 (1.25 d), P4-5 (2 d)

| Item | Detail |
|---|---|
| Owns | `workers/mail/**` (after K's Wave 0 skeleton); `.github/workflows/cf-mail.yml`; ops `src/entrypoints/mail-ingest.ts`, `src/mail-in/**`, `src/workflows/rfq-intake.ts`, `src/do/rfq-thread.ts`, `src/agents/cards/intake.ts`, `src/agents/prompts/rfq_intake/**`, `src/db/repos/{inbound-emails,rfqs,rfq-files}.ts`, `test/{mail-ingest,intake,mail-in}/**`, `test/t2/{mail,intake}.t2.ts`, `test/fixtures/mime/**`, `test/fixtures/llm/rfq_intake.*/**` |
| Reads | [agents] §5, §7.2-§7.3, §8; this spec §4.3, §4.8, §4.10-§4.11, §4.15, CR-16, CR-17 |
| Builds | `microns-mail` (handler steps M0-M7, `wrangler.jsonc` with `OPS` entrypoint `MailIngest`, `ALLOWED_RCPT`, `PRIVATE_FILES`, scripts `test`, `typecheck`, `build:dry`); `MailIngest`; MIME parsing, quote stripping, type sniffing, safe names, ZIP rules (entries streamed one at a time: R2 range read of the compressed bytes → `DecompressionStream('deflate-raw')` → `FixedLengthStream(<declared size>)` → R2 put, never a whole archive or entry in memory; limits Appendix P.5), `Authentication-Results` parsing; the intake Workflow steps of [agents] §8.2 (including `body_excerpt`, CR-17, and agent `rfq_files` paths, CR-16); `RfqThread`; intake prompts v1 with `LOCK.json`; synthetic MIME fixtures (no real customer data, [agents] §7.3) |
| Depends on | K Wave 0; CQ `cad/types.ts` (types only); RP `replies/match.ts` (step `thread-check`) |

Acceptance:

| # | Command | Pass |
|---|---|---|
| IN-1 | `npm --prefix workers/mail ci && npm --prefix workers/mail run typecheck && npm --prefix workers/mail test` | [agents] M-1 |
| IN-2 | `npm --prefix workers/ops test -- test/mail-ingest test/mail-in test/intake` | [agents] M-2, I-1, I-2, I-3 (raw-MIME edge cases run here, with postal-mime in Node, because T2 injects composed messages only); daily cap reached → run `skipped` `daily_cap`, no LLM call, row `needs_review`; a ZIP entry whose declared size disagrees with its stream is flagged, and archives are read only through `BlobPort` range reads and written as streams (spy: no whole-object read of the archive); CHECK-LISTS for `inbound_emails.status`, `rfqs.source`, `rfq_files.source` |
| IN-3 | `npm --prefix workers/ops run test:integration:agents -- test/t2/mail.t2.ts test/t2/intake.t2.ts` | [agents] M-3, M-4, I-4, with mail injected through the Local Explorer `POST /cdn-cgi/local/explorer/api/local/email/routing/send?worker=microns-mail` (JSON `from`, `to`, `subject`, `text`, `headers`, base64 `attachments`; the runtime sets its own `Message-ID` and returns it as `result.messageId`, which the tests use; `In-Reply-To`, `References` and `Authentication-Results` pass as given; probe 2026-10-04 T-4) and events through the Local Explorer API; failure path: an intake run whose `extract` fixture is missing ends on a `failure` card, the test then registers the fixture and sends relay code `rty` → the instance restarts from the failed step and the run ends `succeeded` (restart of an ended instance in workerd, §4.10) |
| IN-4 | `npm --prefix workers/mail run build:dry` | bundles; no `postal-mime`, no `@anthropic-ai/sdk` in the mail bundle (headers parsed in `headers.ts`); size printed |
| IN-5 | `python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/cf-mail.yml'));t=d.get('on',d.get(True));assert list(t)==['workflow_dispatch'],t"` | exit 0 (pattern of P2 C-4) |
| IN-6 | SCAN-SECRET and SCAN-WORDING on `workers/mail workers/ops/src/mail-in workers/ops/src/workflows/rfq-intake.ts workers/ops/test/fixtures/mime` | no output; fixture addresses use `example.com`/`example.de` only |

### 5.4 Unit CQ: CAD and quote — P4-6 (0.75 d + 0.25 d inline ports), P4-7 (2.5 d)

| Item | Detail |
|---|---|
| Owns | ops `src/do/cad-router.ts`, `src/queues/cad-jobs.ts`, `src/cad/**`, `src/db/repos/{cad-jobs,quote-workflows,pricing,catalog}.ts`, `src/pricing/**`, `src/pdf/{fonts,layout,trim,quote-pdf}.ts`, `src/pdf/assets/**`, `src/mail-out/**`, `src/workflows/quote.ts`, `src/agents/cards/quote.ts`, `src/agents/prompts/quote/**`, `test/{cad,quote,pricing,pdf}/**` (incl. `test/pdf/samples.test.ts`), `test/t2/{cad,quote}.t2.ts`, `test/fixtures/{cad,pdf}/**`, `test/fixtures/llm/quote.*/**`; site `test/integration/stubs/unfold.mjs` |
| Reads | [agents] §9, §10; this spec §4.10-§4.12, §4.13 (AM-1, AM-2, AM-4), §4.15, F4-9…F4-11 |
| Builds | CAD types, registry, `HttpUnfoldBackend`, `InlineBackend` (copied parsers, imports rewritten; per-kind input caps and module-level mutex of §4.12), `container.ts` stub (`unsupported`), DXF metrics; `CadRouter`; `cad-jobs` consumer; deterministic calculator; Vectorize use through `VectorPort`; PDF fonts (Liberation Sans Regular/Bold 2.1.5 copied from `/usr/share/fonts/truetype/liberation/`; `OFL.txt` = the SIL OFL 1.1 text of `/usr/share/doc/fonts-liberation/copyright:9-114`, package `fonts-liberation` 1:2.1.5-3 in this container), layout, trim, quote PDF; Resend client and Message-ID helpers; the quote Workflow of [agents] §10.1 including the "won" step through `rpc/create_order_from_quote` (AM-4) and write-back of approved prices to `rfqs` ([agents] A-13) |
| Phase 5 seam | `UnfoldFetcher = (req: Request) => Promise<Response>` and `CadBackend.run(job, input, signal)` exactly as [agents] §9.2, so P5-6 can add the optional lease argument (PHASE5_SPEC §5.8) |
| Depends on | K; IN (`mail-in` shared helpers, `RfqThread.bindQuote`) |

Acceptance:

| # | Command | Pass |
|---|---|---|
| CQ-1 | `npm --prefix workers/ops test -- test/cad` | [agents] D-1, D-2, D-3; the unfold request carries only the multipart file part and the fields allowed by Appendix P.3; inputs above the per-kind inline caps become `inline_too_large` manual-price lines without parsing; `CadRouter` never grants two `inline` leases at once; memory case `test/cad/inline-memory.test.ts` spawns `node --max-old-space-size=96` on a script that imports the unchanged originals from `supabase/functions/generate-manufacturing-pdf/` (CQ-3 proves the copies equal them) and parses synthetic worst-case inputs at twice each cap (STEP 10 MB, DXF 6 MB, STL 1.5 MB): exit 0 (generators as in the scratch memprobe); CHECK-LISTS for `cad_jobs.status`, `cad_jobs.backend` (with `inline`, AM-1) |
| CQ-2 | `npm --prefix workers/ops test -- test/pricing test/quote test/pdf` | [agents] Q-1…Q-4; CHECK-LISTS for `quote_workflows.status`; `create_order_from_quote` called once per "won" across replays; `test/pdf/samples.test.ts` is skipped unless `PDF_SAMPLES=1` (`describe.skipIf`), so the default T1 run never needs the sample output folder |
| CQ-3 | `for f in dxf-parser stl-parser step-parser mesh-analyzer; do diff <(rg -v '^import\|^export \* from' supabase/functions/generate-manufacturing-pdf/$f.ts) <(rg -v '^import\|^export \* from' workers/ops/src/cad/inline/$f.ts); done` | no output: the copies differ only in import lines |
| CQ-4 | `npm --prefix workers/ops run pdf:samples` | three PDFs under `workers/ops/.wrangler/pdf-samples/` (gitignored) for the owner's review (§12); same input → same SHA-256 on a second run |
| CQ-5 | `npm --prefix workers/ops run test:integration:agents -- test/t2/cad.t2.ts test/t2/quote.t2.ts` | [agents] D-4, Q-5 |
| CQ-6 | `test -f workers/ops/src/pdf/assets/OFL.txt && rg -c "SIL OPEN FONT LICENSE" workers/ops/src/pdf/assets/OFL.txt`; SCAN-SECRET on `workers/ops/src/{cad,pricing,pdf,mail-out}` | licence present; no output from the scan; no rate, margin or price literal in `src/pricing/**` other than test fixtures (`rg -n "[0-9]+\.[0-9]+ *(EUR\|€)" workers/ops/src/pricing` → no output) |

### 5.5 Unit RP: replies and post-order — P4-8 (1 d), P4-9 (1.25 d)

| Item | Detail |
|---|---|
| Owns | ops `src/replies/**`, `src/queues/agent-events.ts`, `src/cron/{dispatcher,gmail-poller}.ts`, `src/workflows/post-order.ts`, `src/do/material-stock.ts`, `src/pdf/traveller-pdf.ts`, `src/agents/cards/{reply,handoff,reorder}.ts`, `src/agents/prompts/post_order/**`, `src/db/repos/{senders,orders,stock,partners}.ts`, `test/{replies,post-order}/**`, `test/t2/{replies,post-order}.t2.ts`, `test/fixtures/llm/post_order.*/**` |
| Reads | [agents] §11, §12; this spec §4.9-§4.11, §4.13 (CR-1, AM-3), §4.17 |
| Builds | Attribution rules 1-5 (`replies/match.ts`, also called by IN); `agent-events` consumer (`inbound-reply`, `order-created`, `resume-parked`, `card`); Gmail poller (tokens refreshed in memory only); `*/10` dispatcher (orphans, portal orders, parked runs, stuck CAD jobs); post-order Workflow (traveller PDF through CQ's `pdf/layout.ts`, hand-off mail through CQ's `mail-out`, reorder draft); `MaterialStock` over `rpc/stock_hold`/`stock_commit`/`stock_release` (CR-1) with code-side material matching (CR-7) |
| Depends on | K; IN (`mail-in`); CQ (`pdf/layout.ts`, `mail-out`, outbound id format) |

Acceptance:

| # | Command | Pass |
|---|---|---|
| RP-1 | `npm --prefix workers/ops test -- test/replies` | [agents] R-1, R-2 (no token value in any log line or `agent_runs.output`) |
| RP-2 | `npm --prefix workers/ops test -- test/post-order` | [agents] P-1, P-2, P-3; dispatcher: `flag_off` and `llm_unavailable` parks resumed per §4.17, `failed` parks never resumed, `failed` parks older than 14 days closed `failed` with the token cleared; CHECK-LISTS for `stock_reservations.status` |
| RP-3 | `npm --prefix workers/ops run test:integration:agents -- test/t2/replies.t2.ts test/t2/post-order.t2.ts` | [agents] R-3, P-4 (dispatcher fired with `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=microns-ops` and `{"cron":"*/10 * * * *"}`, which reaches ops as a secondary Worker, probe 2026-10-04 T-5) |
| RP-4 | SCAN-SECRET on `workers/ops/src/{replies,cron,do,pdf}` and `rg -n "refresh_token\|access_token" workers/ops/src/cron workers/ops/src/replies` | no secret output; token field names appear only in `gmail` port types and the token-store reader, never in a log call (`rg -n "console\.(log\|error\|warn).*token" workers/ops/src` → no output) |

### 5.6 Unit W: web, site routes and Telegram relay — P4-12 (1 d + 0.25 d for `status`/`flag`/`start`/`file`)

| Item | Detail |
|---|---|
| Owns | site `src/api/{resolve,router}.ts` (extension, after K's two Wave 0 stub lines), `src/api/forward.ts` (extension), `src/auth/{gate,policy}.ts` (extension), `src/auth/agent-hmac.ts`, `scripts/check-bundle.mjs` (extension), `test/policy.test.ts` (extension), `test/agent-*.test.ts`; ops `src/routes/agent-admin.ts`, `test/routes/agent-admin.test.ts`, `test/t2/web.t2.ts`; frontend `src/App.tsx` (extension), `src/components/dashboard/PersistentDashboardLayout.tsx` (extension), `src/pages/dashboard/{RfqInboxPage,ApprovalsPage}.tsx`, `src/pages/dashboard/agent/*`, `src/utils/agentApi.ts`, `src/lib/agentDb.ts`, `src/types/agent.ts`, `tests/frontend-api/{agentApi,agentDb}.test.ts`, `tests/e2e/agent-dashboard.spec.ts`; relay `supabase/functions/telegram-leads-bot/{index.ts,agent-callback.ts}`, `tests/edge/{vitest.config.mjs,telegram-callback.test.ts}` |
| Reads | [surfaces] §4, §6, §7; this spec §4.4, §4.14, §8, Appendix P.2 |
| Builds | Site: endpoint `agent` in `endpointOfPath`/`resolveApi` (actions and methods of §4.14, unknown action 404, wrong method 405 with `Allow`, body > 65,536 bytes 413, all answered at the site); the `/api/agent/` prefix is matched before the exact-match catalogue, which keeps its 13 paths (workers/site/src/api/resolve.ts:46-63; workers/site/test/resolve.test.ts:52); `targetOf` → `ops`, `shouldForward` never true under `/api/agent/`; gate rows AG-1…AG-7 and their `policy.test.ts` expectations; `agent-hmac.ts` (relay signature verification, `AgentSiteEnv`, §4.2); `AGENT_APPROVAL_SECRET` optional (checked per decision, P2 F-22; **not** added to `secrets.required` or `NAMES_BY_TARGET`, so a site deploy never fails for it and workers/site/test/env-api.test.ts stays green); site bundle guard extension (§7.2). Ops: `routes/agent-admin.ts` exports `handleStatus`, `handleFlag`, `handleStart`, `handleStaffFile` (each `(c: Context<OpsHono>) => Promise<Response>`, called by K's `routes/agent.ts`). Frontend: the pages of [surfaces] §6 with the degrade rules of §8. Relay: live v6 source (read-only copy in the scratch `live-functions/telegram-leads-bot/index.ts`) plus one branch and `agent-callback.ts` ([surfaces] §7.4-§7.5) |
| Depends on | K (`agent-api.ts`, `decide()`, ports); Phase 2 E's `src/utils/apiAuth.ts` (`fetchWithAuth`, `downloadWithAuth`) |

Acceptance:

| # | Command | Pass |
|---|---|---|
| W-1 | `workers/site/node_modules/.bin/vitest run -c tests/frontend-api/vitest.config.mjs tests/frontend-api/agentApi.test.ts tests/frontend-api/agentDb.test.ts` | [surfaces] W-1; `src/types/agent.ts` parses the shared fixtures of `workers/shared/test/fixtures/agent-api/` |
| W-2 | `npm --prefix workers/site test -- test/agent- test/policy.test.ts test/env-api.test.ts test/resolve.test.ts` | [surfaces] W-2; `AGENT_APPROVAL_SECRET` missing → relay decision 500 config error, dashboard decision unaffected; `policy.test.ts` counts 41 IDs with the Phase 2 expectations unchanged; `env-api.test.ts` and `resolve.test.ts` unchanged and green |
| W-3 | `npm --prefix workers/ops test -- test/routes/agent-admin.test.ts` | [surfaces] W-3 |
| W-4 | `npm --prefix workers/ops run test:integration:agents -- test/t2/web.t2.ts` | [surfaces] W-4, through the site as the primary Worker of the `agents` harness (§6.3) |
| W-5 | `npx vite build && (npx vite preview --port 4173 --strictPort &) && BASE_URL=http://localhost:4173 npx playwright test tests/e2e/agent-dashboard.spec.ts` | [surfaces] W-5; the spec aborts unless `BASE_URL` is `http://localhost:*` or `http://127.0.0.1:*` (the frozen `playwright.config.ts:23` defaults to production) and routes every request to a non-local host through `page.route` mocks or `abort()` |
| W-6 | `npx tsc --noEmit -p tsconfig.app.json 2>&1 \| rg "src/(pages/dashboard/(RfqInboxPage\|ApprovalsPage\|agent/)\|utils/agentApi\|lib/agentDb\|types/agent)"` | no output |
| W-7 | `workers/site/node_modules/.bin/vitest run -c tests/edge/vitest.config.mjs` | [surfaces] L-1 |
| W-8 | `rg -c "callback_query" supabase/functions/telegram-leads-bot/index.ts`; `diff <scratch live v6 copy> supabase/functions/telegram-leads-bot/index.ts \| rg -v '^(> \|[0-9,]+a[0-9,]+$\|---$)'` (the live copy stays in the scratchpad and is never committed) | 1; no output from the second command: the new file only adds lines to the live v6 source ([surfaces] L-2, §7.5) |
| W-9 | `npx eslint src/pages/dashboard/RfqInboxPage.tsx src/pages/dashboard/ApprovalsPage.tsx src/pages/dashboard/agent src/utils/agentApi.ts src/lib/agentDb.ts src/types/agent.ts` | no errors |
| W-10 | SCAN-SECRET and SCAN-WORDING on CHANGED `src/pages/dashboard src/components/dashboard src/App.tsx src/utils/agentApi.ts src/lib/agentDb.ts src/types/agent.ts supabase/functions/telegram-leads-bot workers/site workers/ops/src/routes/agent-admin.ts tests/frontend-api tests/edge tests/e2e/agent-dashboard.spec.ts` (only W's added or changed files, not pre-existing ones) | no output |
| W-11 | `npm --prefix workers/site run build:dry && node workers/site/scripts/check-bundle.mjs` | the Phase 2 forbidden inputs still absent; the new rules find none of `@anthropic-ai/*`, `agents`, `@modelcontextprotocol/*`, `postal-mime`, `@pdf-lib/fontkit`, `@cloudflare/puppeteer` or a `workers/ops/src/` input in the site bundle |

### 5.7 Unit XZ: remote MCP and scrapers — P4-11 (1.25 d), P4-10 (0.75 d)

| Item | Detail |
|---|---|
| Owns | ops `src/mcp/**`, `src/scrapers/**` (incl. `parsers/{directory,profile}.ts`), `src/queues/directory-scan.ts`, `src/routes/{scan-directory,scrape}.ts` (flag-on branch only), `test/{mcp,scrapers}/**` (incl. `test/mcp/parity.test.ts`, `test/mcp/parity.allow.json`), `test/t2/{mcp,scrapers}.t2.ts`, `test/fixtures/scrapers/**`; shared `src/auth/scrape-rules.ts`, `src/limit.ts`, `test/{scrape-rules,limit}.test.ts`, `test/fixtures/scrape-rules.json`; site `test/scrape-rules-crosscheck.test.ts`; `mcp-server/README.md` ("Remote MCP" section only); `mcp-server/.gitignore` (new, `build/`) |
| Reads | [surfaces] §5, §8, §9; this spec §4.18, §4.20, F4-12, F4-13, F4-17, F4-18 |
| Builds | `handleMcp` with `createMcpHandler`, Access assertion check, staff mapping through `rpc/agent_staff_for_email` (AM-5), stages, the 39 ported tools and 12 new ones, audit rows, rate limit; scraper module with robots gate, fetch, browser, directory and profile scans, parsers **ported** from `api/scan-directory.js:71-440` and `api/scrape-company-profile.js:54-382` (no change to `api/*`, F4-18); queue envelope `DirectoryScanMessage` with `sendDirectoryScan()` and `directoryScanConsumer` (§4.9); the flag-on branch in the two Phase 2 routes; shared scrape-rule validators (CR-21) and `limit()` |
| Depends on | K (`decide()`, ports, `readFlag`); DB (AM-5); Phase 2 `access-jwt.ts` |

Acceptance:

| # | Command | Pass |
|---|---|---|
| XZ-1 | `npm --prefix workers/shared test -- test/scrape-rules.test.ts test/limit.test.ts && npm --prefix workers/site test -- test/scrape-rules-crosscheck.test.ts` | [surfaces] Z-4; the vectors file `workers/shared/test/fixtures/scrape-rules.json` gives the same allow/deny answers from the shared validators and from the site gate's Phase 2 scrape rows (CR-21) |
| XZ-2 | `npm --prefix workers/ops test -- test/mcp` | [surfaces] X-1…X-5 (T1 imports `src/mcp/index.ts` under the §6.2 vitest contract); `test/mcp/parity.test.ts` is skipped unless `MCP_PARITY=1` (`describe.skipIf`) |
| XZ-3 | `npm --prefix mcp-server ci && npm --prefix mcp-server run build && npm --prefix workers/ops run mcp:parity && git check-ignore -q mcp-server/build/index.js` | [surfaces] X-7: 0 unexplained differences; exit 0 (the build output is ignored by XZ's new `mcp-server/.gitignore`; `mcp-server/node_modules` by the root `.gitignore:10`; on 2026-10-04 `mcp-server/build/index.js` was not ignored) |
| XZ-4 | `npm --prefix workers/ops test -- test/scrapers` | [surfaces] Z-1, Z-2 (parser output byte-equal to the Vercel handler run through the Phase 2 shim with a fetch stub on the same synthetic HTML), Z-3 |
| XZ-5 | `npm --prefix workers/ops run test:integration:agents -- test/t2/mcp.t2.ts test/t2/scrapers.t2.ts` | [surfaces] X-6, Z-5 (flag off → Phase 2 response byte-identical); `mcp.t2.ts` and `scrapers.t2.ts` each start their own harness instance with **ops as the primary Worker** (`startHarness({profile: 'agents', primary: 'ops', …})`, §6.3), because only the primary is reachable over HTTP; MCP requests carry `Host: mcp.micronshub.eu` (probe 2026-10-04 T-1, T-7) |
| XZ-6 | `git diff --exit-code <phase2-close> -- api/ mcp-server/src/` | no change |
| XZ-7 | SCAN-SECRET and SCAN-WORDING on `workers/ops/src/mcp workers/ops/src/scrapers workers/shared/src` | no output |

### 5.8 Cross-unit gate (Wave 3; run by K, every unit fixes its own failures)

| # | Command | Pass |
|---|---|---|
| G4-1 | `npm --prefix workers/shared test && npm --prefix workers/site test && npm --prefix workers/ops test && npm --prefix workers/mail test` | all green, including every Phase 1 and Phase 2 suite with every Phase 2 expectation as written (test files changed only at the §7.2 extension points, G4-10); `PDF_SAMPLES`/`MCP_PARITY` unset, so the opt-in files are skipped |
| G4-2 | `npm --prefix workers/site run test:integration` and `npm --prefix workers/ops run test:integration` (Phase 2 profile `api`) | Phase 2 T2 unchanged and green; the ops Phase 2 config collects `test/integration/*.t2.ts` only (`exclude` of `test/t2/**`, §7.2), so no Phase 4 file runs under profile `api` |
| G4-3 | `npm --prefix workers/ops run test:integration:agents` | every `test/t2/*.t2.ts` green (`vitest.t2.agents.config.ts` collects exactly `test/t2/*.t2.ts`; Phase 5 files live in `test/t2-jobs/` with their own config, PHASE5_SPEC F5-25) |
| G4-4 | `npm --prefix workers/site run build:dry && node workers/site/scripts/check-bundle.mjs` | site bundle guard green with W's extension (W-11): the Phase 2 forbidden inputs (workers/site/scripts/check-bundle.mjs:32-34, among them `pdf-lib` and `@pdf-lib`) plus `@anthropic-ai/*`, `agents`, `@modelcontextprotocol/*`, `postal-mime`, `@cloudflare/puppeteer` and any `workers/ops/src/` input |
| G4-5 | K-3, IN-4 | bundles and sizes printed for `microns-ops` and `microns-mail` |
| G4-6 | `git diff --exit-code <phase2-close> -- vercel.json middleware.ts middleware api lib index.html vite.config.ts public/robots.txt workers/site/src/index.ts workers/site/src/sitemap.ts workers/site/src/seo workers/site/src/redirects.ts workers/site/src/static.ts workers/site/src/preview.ts workers/site/src/compat/vercel-shim.ts scripts/seo-parity playwright.config.ts tests/e2e/fixtures mcp-server/src docs/migration` | no change (§7.1) |
| G4-7 | `git diff --name-only <phase2-close> -- package.json package-lock.json bun.lockb` | no output (no new root dependency) |
| G4-8 | `npm run test` (root jest) and `npx vite build` | unchanged result versus the Phase 2 closing commit (the root jest suite does not cover Phase 4 files) |
| G4-9 | SCAN-SECRET and SCAN-WORDING over `git diff --name-only --diff-filter=AM <phase2-close>` | no output |
| G4-10 | `git diff --name-only --diff-filter=MD <phase2-close> -- workers/shared/test workers/site/test workers/ops/test workers/ops/vitest.t2.config.ts workers/site/vitest.config.ts workers/site/vitest.t2.config.ts` | exactly these lines, none deleted: `workers/ops/test/config.test.ts`, `workers/ops/test/helpers/cloudflare-workers.ts`, `workers/ops/vitest.t2.config.ts`, `workers/shared/test/http/rpc.test.ts`, `workers/site/test/integration/global-setup.mjs`, `workers/site/test/integration/harness.mjs`, `workers/site/test/integration/stub-server.mjs`, `workers/site/test/policy.test.ts` (R-10) |

The Phase 1 parity tool is not run from this runner (production answers 429 here, P2 G-2); parity on production is exit gate 5, run by the owner (OW-23).

Effort: DB 1.5 d + K 2 d + IN 3.25 d + CQ 3.5 d + RP 2.25 d + W 1.25 d + XZ 2 d = 15.75 d, plus P4-14 0.5 d, against PLAN.md's ≈ 14.5 d (PLAN.md:360); the difference is the ports and decision core, the inline CAD ports, the T2 test infrastructure, the Phase 2 test-pin extensions and the extra agent actions.

---

## 6. Testing without a Cloudflare account (tiers, fakes, T2 profile, stub seams)

### 6.1 Tiers

| Tier | What | Where | Account | Evidence |
|---|---|---|---|---|
| T1 | vitest 5.0.3 in Node 22 per package (`workers/{shared,site,ops,mail}`, `supabase/tests/agent_layer`, `tests/frontend-api`, `tests/edge`); Workflows through `FakeStep`, Durable Objects through `FakeDurableObjectState` over `node:sqlite` `DatabaseSync` (Node 22.22.2, experimental warning) behind the `ctx.storage.sql.exec` subset the classes use; every port faked | container / CI | no | P2 F-18 (`@cloudflare/vitest-plugin` needs vitest ^4.1, not used); [agents] §15.1-§15.2 |
| T2 | `wrangler dev --local` with generated configs (mail + ops + site), the Phase 2 stub server extended with provider stubs and a mini-PostgREST; site primary; mail injection (`…/local/email/routing/send?worker=microns-mail`), Workflow events, crons (`…/local/scheduled?worker=microns-ops`) and e-mail capture through the Local Explorer API; a second instance with ops primary for MCP and scraper tests | container / CI | no | probe 2026-10-03 #1-#14 (`phase4/probe/PROBE_NOTES.md`); probe 2026-10-04 T-1…T-7 (`phase4/topoprobe/PROBE_NOTES.md`); CF docs (fetched 2026-10-03) https://developers.cloudflare.com/email-service/local-development/routing/ |
| T3 | preview deploy with real providers on owner-approved test data, then P4-14 on production | Cloudflare | yes | PLAN.md:327, :346-352 (owner steps, §12) |

### 6.2 Fakes and helpers (`workers/ops/test/helpers/*`)

| Helper | Owner | Contract |
|---|---|---|
| `cloudflare-workers.ts` (alias of `cloudflare:workers`, P2) | K | adds `WorkflowEntrypoint<Env, P>` (stores `ctx`, `env`), `DurableObject<Env>` (stores `ctx`, `env`), `RpcTarget`, `env` (empty object), `exports` (empty object), `waitUntil()` (no-op); keeps `WorkerEntrypoint` exactly as Phase 2 wrote it (workers/ops/test/cloudflare-workers-alias.test.ts stays green). The agents SDK imports `RpcTarget` and `exports` from this module (probe 2026-10-04, mcpprobe/vt) |
| `cloudflare-email.ts` (new alias `cloudflare:email`) | K | `EmailMessage` class (`from`, `to`, `raw`); the agents SDK chunk behind `agents/mcp` imports `cloudflare:email` (agents 0.24.0 `dist/src-BNU3ZiJM.js`, probe 2026-10-04) |
| `agent-env.ts` | K | `agentBindings(overrides?)`: fakes for every Phase 4 `OpsEnv` field (KV, R2, queues, Workflow and DO namespaces, vars) to spread into the Phase 2 `opsEnv()` helper |
| `vitest.config.ts` (extension, K) | K | aliases `cloudflare:workers`, `cloudflare:workflows`, `cloudflare:email`; `test.server.deps.inline: [/node_modules\/agents\//]` (without it Node's loader rejects the `cloudflare:` scheme inside the SDK: "Only URLs with a scheme in: file, data, and node are supported", probe 2026-10-04); a plugin `wrangler-rules` that mirrors the wrangler `rules` of §4.1 (`.md` → `export default <string>`, `.ttf`/`.png` → `export default <ArrayBuffer>` read with `readFileSync`; without it a `.md` import fails with a parse error and a `.ttf` import yields an asset path string, probe 2026-10-04 `mcpprobe/vt/vitest.rules.config.mjs` passes both cases); `include` stays `test/**/*.test.ts` |
| `cloudflare-workflows.ts` (new alias `cloudflare:workflows` in `vitest.config.ts`) | K | `NonRetryableError` with the runtime's `name` |
| `fake-step.ts` | K | `FakeStep implements WorkflowStep`: `do(name, cfg?, fn)` caches by `(name, occurrence)`, applies retry profiles on a virtual clock, honours `NonRetryableError`; `waitForEvent(name, {type, timeout})` resolves from a test-controlled buffer (events buffered as in production) or throws `Error('Execution timed out after <ms>ms')` (probe #4); `sleep` advances the clock; `crashAt(stepName)` throws once to prove replay idempotency |
| `fake-do.ts` | K | `FakeDurableObjectState` (`storage.sql.exec`, `storage.setAlarm/getAlarm`, `blockConcurrencyWhile`, `id.name`) and a namespace fake that returns one instance per name |
| `memory-db.ts` | K | `MemoryDb implements Db` with unique keys, filters of §4.6, `on_conflict` semantics, and `rpc()` dispatch to `memory-rpc.ts` |
| `memory-rpc.ts`, `check-lists.ts` | DB | §5 unit DB |
| `recorders.ts` | K | `RecordingMailer`, `RecordingTelegram`, `RecordingEvents`, `RecordingLogger` (asserts that no recorded line contains a token, e-mail address or subject: one helper `assertNoSecretsLogged()`) |

### 6.3 T2 profile `agents` (K extends the Phase 2 harness; P2 §2.12 stays the contract for profile `api`)

| Item | Contract |
|---|---|
| Start | `T2_PROFILE=agents` read by `workers/site/test/integration/global-setup.mjs`; `node workers/site/test/integration/harness.mjs up --profile agents` for shells; the default profile stays `api` so every Phase 2 command keeps its meaning (CR-32); `startHarness({profile: 'agents', primary?: 'site' \| 'ops', …})` for test files that need their own instance |
| Process | Default instance: `wrangler dev -c <tmp>/site/wrangler.jsonc -c <tmp>/ops/wrangler.jsonc -c <tmp>/mail/wrangler.jsonc --local --persist-to <tmp>/state --port <port>` with the wrangler of `workers/site/node_modules`. Only the first config is served over HTTP; the others are reachable only through service bindings and the Local Explorer (CF docs (fetched 2026-10-02) `phase2/cfdocs/workers_runtime-apis_bindings_service-bindings.md:163`; probe 2026-10-04 T-1, T-2). So the **site stays primary** (Phase 2 shape: every `/api/agent/*` request enters through the site and reaches ops over `OPS`), mail is injected with the Local Explorer `POST /cdn-cgi/local/explorer/api/local/email/routing/send?worker=microns-mail` (T-4; the raw `POST /cdn-cgi/local/email` route reaches the primary only, T-3), crons with `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=microns-ops` (T-5), Workflow events and state through `/cdn-cgi/local/explorer/api/workflows/…` (probe #13). Second instance, started by `test/t2/mcp.t2.ts` and `test/t2/scrapers.t2.ts` only: `primary: 'ops'` (`-c ops` first, then site and mail), so the ops default `fetch` (MCP host branch, §4.18) is the HTTP surface; requests carry `Host: mcp.micronshub.eu`, which the request URL follows (T-7). The harness publishes `site`, `ops` (second instance only), `explorer` and `stub` URLs in `urls.json` |
| Generated ops config | Phase 2 overrides plus: `ai`, `vectorize` and `browser` blocks removed (no local simulation, CF docs (fetched 2026-10-03) `workers_local-development.md:178-291` per [agents] key facts); `routes` (custom domain) removed; `vars.AGENT_STUBS = "llm,embed,vector,browser"` (a test adds `cad` for the fake backend); `AGENT_LLM_BASE_URL`, `RESEND_API_BASE`, `TELEGRAM_API_BASE`, `GMAIL_API_BASE`, `GOOGLE_TOKEN_URL` → stub origin; `MCP_HOSTNAME` kept (tests send `Host: mcp.micronshub.eu`); `ACCESS_TEAM_DOMAIN` → stub; `MCP_ACCESS_AUD` → `t2-aud-mcp`; `secrets.required` of the **generated** config = the production list + `AI_GATEWAY_TOKEN`, `CAD_UNFOLD_URL`, `CAD_SHARED_SECRET`, `AGENT_APPROVAL_SECRET` (wrangler loads only listed names from `.dev.vars`, §4.1), with `.dev.vars` values `dummy-not-a-secret` except `CAD_UNFOLD_URL` = the stub origin (where `stubs/unfold.mjs` answers `/api/v1/unfold`) and `AGENT_APPROVAL_SECRET` = the run's random value; the production `workers/ops/wrangler.jsonc` stays unchanged; queue consumers kept for `cad-jobs` and `agent-events` (local only), removed for `scrapes` as in Phase 2 except in the second instance of `test/t2/scrapers.t2.ts`, which keeps the `scrapes` consumer and uses a fixture-only fetch. Start-up assertion: the harness reads wrangler's per-Worker binding tables ("<worker> has access to the following bindings", one per config, probe 2026-10-04 `topoprobe/dev.log`) and fails unless every name of each generated `secrets.required` is listed for its Worker as `env.<NAME> ("(hidden)")` |
| Generated mail config | `OPS` entrypoint `MailIngest` kept; `SUPABASE_URL` → stub; `secrets.required` = the production list (`SUPABASE_SERVICE_ROLE_KEY`) + `MAIL_COPY_TO`/`MAIL_FALLBACK_TO` only when a test asks for them (M-4), each with a value in the generated `.dev.vars` |
| Generated site config | Phase 2 `api` profile config; `secrets.required` of the generated config gains `AGENT_APPROVAL_SECRET` (same random value as ops), the production `workers/site/wrangler.jsonc` stays unchanged |
| Stub modules (mounted by `stub-server.mjs` from `stubs/*.mjs`; canned `/__stub/routes` registrations win over a module) | `anthropic.mjs` (K): `POST /anthropic/v1/messages` replays `test/fixtures/llm/<prompt id>/<sha16>.json` by header `x-microns-prompt` and the SHA-256 of the user content; unknown → 400 · `resend.mjs` (K): `POST /resend/emails` (records, honours `Idempotency-Key`, returns an id), `GET /resend/emails/:id` (returns `message_id`) · `telegram.mjs` (K): `/telegram/bot*/{sendMessage,editMessageReplyMarkup,editMessageText,answerCallbackQuery}` · `gmail.mjs`, `google-token.mjs` (K): scripted history/list/metadata/raw and token refresh · `unfold.mjs` (CQ): `POST /api/v1/unfold` (checks `X-API-Key`, returns fixture DXF and `X-Part-*` headers), `GET /api/v1/health` · `postgrest.mjs` (DB): mini-PostgREST below |
| Mini-PostgREST (`stubs/postgrest.mjs`, DB) | In-memory rows for `agent_runs`, `feature_flags`, `inbound_emails`, `rfqs`, `rfq_files`, `cad_jobs`, `quote_workflows`, `pricing_rules`, `catalog_materials`, `customers`, `orders`, `order_items`, `production_partners`, `materials`, `stock_items`, `stock_reservations`, `marketing_sender_accounts`, `company_leads`, `scan_logs`, `saved_searches`, `user_roles`; filters `eq`, `in`, `ov`, `cs`, `ilike`, `gte`, `lt`, `is`, `not`; `select` column lists; `order`, `limit`, `range`; `on_conflict` with `Prefer: resolution=ignore-duplicates\|merge-duplicates, return=representation`; RPCs `create_email_rfq`, `agent_run_begin`, `agent_run_claim_approval`, `stock_hold`, `stock_commit`, `stock_release`, `create_order_from_quote`, `agent_staff_for_email`, `feature_flags_sync_batch`, `feature_flags_mark_synced`, `feature_flags_seed_from_kv`, `feature_flags_kv_key`, `feature_flags_kv_value`, `next_po_number` (the same JavaScript as `memory-rpc.ts`, loaded by Node type stripping); `POST /__stub/seed`, `GET /__stub/rows/:table`; errors in PostgREST's JSON shape (`code`, `message`, `details`, `hint`) |
| Flags in T2 | tests write KV `FLAGS` with `wrangler kv key put --local --persist-to <tmp>/state --binding FLAGS -c <tmp>/ops/wrangler.jsonc` or the Local Explorer KV routes, then wait 1 s |
| Not covered (T3 only) | real model behaviour (eval), Vectorize ranking, Email Routing delivery and `Authentication-Results` content, Resend Message-ID behaviour, AI Gateway billing and authentication, Browser Run, Access Managed OAuth, Telegram delivery |

### 6.4 Production safety of the seams

| Check | How |
|---|---|
| No stub var in production | K-3 fails when the production `workers/ops/wrangler.jsonc` `vars` contain `AGENT_STUBS`, `AGENT_LLM_BASE_URL`, `GOOGLE_TOKEN_URL` or any `*_API_BASE` (the list is an exported array in `check-bundle.mjs` that Phase 5 extends, PHASE5_SPEC §5.4) |
| Fail closed at runtime | `makePorts` throws when `AGENT_STUBS` is set while `AI` or `QUOTES_INDEX` is bound (every production deploy binds both) |
| No stub code for money or mail | Resend, Telegram, Gmail and the LLM are stubbed only as HTTP endpoints of the test server; production code always uses the real base URLs unless an override var is set |
| No test data in production paths | fixtures live under `workers/*/test/**` and `eval/`; `check-bundle.mjs` fails if the metafile contains `test/` or `eval/` inputs |

### 6.5 Fixtures

| Rule | Detail |
|---|---|
| Synthetic only | MIME, HTML, CAD, LLM responses and PDFs in the repo are made up for the tests; addresses use `example.com`, `example.de`, `example.gr`; company names are fictitious ([agents] §7.3) |
| LLM fixtures | `test/fixtures/llm/<prompt id>/<sha16>.json` = `{prompt, request_sha256, response}` (shape in `eval/fixtures.schema.json`, K); written by hand to the prompt's JSON Schema; the owner's `eval:live` recordings stay in `eval/recordings/`, which K adds to `workers/ops/.gitignore` in Wave 0 (not ignored on 2026-10-04: `git check-ignore workers/ops/eval/recordings/x.json` printed nothing) |
| Golden set | private, in R2 `microns-private` prefix `eval/golden/<yyyy-mm-dd>/`, never in git (§12 OW-19) |

---

## 7. What must not change

### 7.1 Frozen in Phase 4 (G4-6 checks the list against the Phase 2 closing commit)

| Area | Paths | Why |
|---|---|---|
| SEO path | `workers/site/src/{index.ts,sitemap.ts,redirects.ts,static.ts,preview.ts}`, `workers/site/src/seo/**`, `workers/site/src/compat/vercel-shim.ts`, `workers/site/{vitest.config.ts,tsconfig.json}`, every Phase 1 test and fixture under `workers/site/test/` (except the new `agent-*` files and the harness extension of §7.2), `scripts/seo-parity/**`, `scripts/verify-ssr.sh`, `tests/middleware/**`, `tests/e2e/{seo,homepage,navigation}.spec.ts`, `tests/e2e/fixtures/**`, `playwright.config.ts` | "Agent deploys never touch the SEO path" (PLAN.md:344); exit gate 5 (PLAN.md:352) |
| Vercel production | `vercel.json`, `middleware.ts`, `middleware/**`, `api/**`, `lib/**`, `index.html`, `vite.config.ts`, `public/robots.txt`, root `package.json`, `package-lock.json`, `bun.lockb` | Vercel keeps serving production until Phase 6 (PLAN.md:300); `api/*` moves only in Phase 6 (F4-18) |
| Phase 2 code | Every Phase 2 file except the extension points of §7.2: `workers/shared/src/**` (except `http/rpc.ts`; new files allowed), `workers/site/src/api/{files,emails,track,ops-client}.ts`, `workers/site/src/auth/*` (except `gate.ts`, `policy.ts`), `workers/site/src/flags.ts`, `workers/site/src/env.ts`, `workers/site/wrangler.jsonc`, `workers/ops/src/compat/**`, `workers/ops/src/routes/*` (except the flag-on branch in `scan-directory.ts`, `scrape.ts`), `workers/ops/src/queues/scrapes.ts`, `ScrapeMessage` in `workers/ops/src/queues/messages.ts`, every Phase 2 test except the test extension points of §7.2 (R-10, G4-10) | Phase 2 parity and its exit gate stay valid (P2 G-1, G-3) |
| Local MCP server | `mcp-server/src/**`, `mcp-server/package*.json` | The remote server is a port with a parity test (D-S8); the local server keeps working for the owner |
| Edge functions | `supabase/functions/**` except `telegram-leads-bot/` | PLAN.md:392 untouched list; P5-1 owns re-syncs |
| Docs | `docs/migration/**` | Corrections need the owner's OK (PLAN.md:45); proposals are listed in §11.3 |
| Live database objects | every existing column, constraint, policy, grant and function body; P4-1 only adds objects, the six columns, and the guard trigger on `rfqs`/`rfq_files` | P4-1 is additive (PLAN.md:354); [data] §0 |

### 7.2 Extension points (the only allowed edits to files written before Phase 4; owner unit in the last column)

| File (written by) | Exact change | Unit |
|---|---|---|
| `workers/shared/src/http/rpc.ts` (P2 A) | `EndpointId` += `'agent'`; `Principal.machine` += `'telegram'` | K |
| `workers/shared/test/http/rpc.test.ts` (P2 A; typecheck-only) | the two `toEqualTypeOf` unions gain `'agent'` and `'telegram'`; nothing else (Phase 5 M5 extends the same lines for its own endpoint, PHASE5_SPEC §3.2) | K (Wave 0) |
| `workers/site/src/api/resolve.ts`, `router.ts` (P2 B), Wave 0 | K: `case 'agent':` returning the `#unknown` sentinel resolution in `resolveAction`, and `agent: 'ops'` in `ENDPOINT_TARGETS` (keeps the exhaustive switch and `TargetTable` compiling after the `EndpointId` change); ownership then passes to W | K (Wave 0) |
| `workers/site/src/api/resolve.ts` (P2 B) | `endpointOfPath`: the `/api/agent/` prefix is tested before the exact-match catalogue, which keeps its 13 paths (workers/site/test/resolve.test.ts:52); any path under `/api/agent/` → `'agent'`; `resolveApi` for `agent`: action = the path segment after `/api/agent/` if it is one of `decision`, `status`, `flag`, `start`, `file`, else sentinel `#unknown` (site answers 404 `{"error":"not_found"}`); wrong method → `#method` (405 with `Allow`) | W |
| `workers/site/src/api/router.ts` (P2 B) | `targetOf` → `ops` for `agent`; body cap 65,536 bytes for `agent` (413 before the gate); sentinels of `agent` answered by the site (no handler behind them) | W |
| `workers/site/src/api/forward.ts` (P2 B) | `shouldForward()` returns false for any path under `/api/agent/` | W |
| `workers/site/src/auth/gate.ts`, `policy.ts` (P2 G) | `ActionId` += `'AG-1'…'AG-7'`; rows of Appendix P.2; the secret is read through `AgentSiteEnv` (§4.2) | W |
| `workers/site/test/policy.test.ts` (P2 G) | the ID count becomes 41; the machine-caller map and the access-class lists gain the AG rows (e.g. `'AG-2': ['telegram']` if W models the relay as a machine caller of the policy); every expectation about the 34 Phase 2 IDs stays as written (workers/site/test/policy.test.ts:9-31) | W |
| `workers/site/scripts/check-bundle.mjs` (P2 B) | forbidden inputs gain `@anthropic-ai/*`, `agents`, `@modelcontextprotocol/*`, `postal-mime`, `@pdf-lib/fontkit`, `@cloudflare/puppeteer` and any `workers/ops/src/` path; the Phase 2 rules (:32-34) stay | W |
| `workers/site/test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs}` (P2 B) | profile `agents`, binding stripping, stub module mount (§6.3) | K |
| `workers/ops/{package.json,package-lock.json,wrangler.jsonc,vitest.config.ts,.dev.vars.example,.gitignore,README.md}` (P2 C) | §4.1, §4.19, §6.2, §5 unit K; `.dev.vars.example` keeps the ten Phase 2 names first, in order, then the Phase 4 names; `.gitignore` gains `eval/recordings/`; README gains a "Phase 4" section (run, test, owner order) | K |
| `workers/ops/test/config.test.ts` (P2 C) | the exact-match assertions become "Phase 2 subset exact + Phase 4 additions present": `routes` = exactly the `mcp.micronshub.eu` custom domain (`route` still absent); `vars` ⊇ the two Phase 2 vars with their values, plus the Phase 4 vars of §4.1 and nothing named like a T2-only var; `queues` contains the Phase 2 `scrapes` producer and consumer objects unchanged (exact objects) plus `cad-jobs` and `agent-events`; top-level keys = the Phase 2 list + the Phase 4 keys of §4.1; `secrets.required` stays exactly the ten Phase 2 names; `dependencies` ⊇ `{hono: '4.13.12'}` + the pins of §4.19; `devDependencies` exact as Phase 2; `.dev.vars.example` begins with the ten Phase 2 names; scripts as Phase 2 plus the Phase 4 names of §5.2. Every other assertion stays as written: name, entry and toolchain (workers/ops/test/config.test.ts:52-58), `workers_dev`/`preview_urls` false and `route` absent (:61-62, :64), limits and observability (:67-70), the `qrcode` alias (:72-75), the queue retry constants against `scrapes.ts` (:86-87), the Phase 2 script values (:104-112), `.gitignore` (:130-134) | K (Wave 0) |
| `workers/ops/vitest.t2.config.ts` (P2 C) | `exclude: [...configDefaults.exclude, 'test/t2/**']` so profile `api` never collects Phase 4 T2 files (its `include` `test/**/*.t2.ts` at :10 also matches `test/t2/*.t2.ts`) | K (Wave 0) |
| `workers/ops/scripts/check-bundle.mjs` (P2 C) | keeps `bundleProblems()` and the `qrcode` server-build rule (:21-41) and the size print; adds the Phase 4 checks of K-3 and the exported forbidden-var array (§6.4) | K |
| `workers/ops/src/index.ts` (P2 C) | exports `RfqIntakeWorkflow`, `QuoteWorkflow`, `PostOrderWorkflow`, `RfqThread`, `MaterialStock`, `CadRouter`, `MailIngest`; default `fetch(req?, env?, ctx?)`: MCP host → `handleMcp`, else the Phase 2 404 with no body (callable without arguments, workers/ops/test/ops-api.test.ts:46-50); `queue`: dispatch by `batch.queue` (§4.9); `scheduled`: dispatch by `controller.cron` (§4.17) | K |
| `workers/ops/src/env.ts` (P2 C) | the Phase 4 fields of §4.2, all optional, in one marked Phase 4 block after the Phase 2 fields; no Phase 2 field changes (config.test.ts:46-49 type-checks the Phase 2 names) | K |
| `.github/workflows/cf-ops.yml` (P2 C) | header comment only: `microns-ops` now has the `mcp.micronshub.eu` Custom Domain, the queues `cad-jobs`/`agent-events` and the Vectorize index must exist before a deploy, and the CI token needs the permissions of OW-8; trigger stays `workflow_dispatch` (P2 C-4) | K |
| `workers/ops/src/app.ts` (P2 C) | one `register(app)` line for `routes/agent.ts` | K |
| `workers/ops/src/queues/messages.ts` (P2 C) | §4.9 types (`CadJobMessageV1`, `AgentEventV1`, `DirectoryScanMessage`, `isDirectoryScanMessage`); `ScrapeMessage` and `enqueueScrape` unchanged | K |
| `workers/ops/src/routes/{scan-directory,scrape}.ts` (P2 C) | one branch at the top: flag `agent.growth.scrapers` on and host permitted → module path; else the Phase 2 code below, unchanged | XZ |
| `workers/ops/test/helpers/cloudflare-workers.ts` (P2 A) | §6.2 (additions only; `WorkerEntrypoint` unchanged) | K |
| `src/App.tsx` | two `lazy()` imports, two `<Route>` entries after `/dashboard/xometry` (src/App.tsx:58-67, :290-295) | W |
| `src/components/dashboard/PersistentDashboardLayout.tsx` | two `NavButton`s in both Operations sections with the gate of CR-30, `getActiveModule()` cases | W |
| `supabase/functions/telegram-leads-bot/index.ts` | replaced by the live v6 source plus one import, three `Deno.env.get` reads, the webhook header rule (updates need `X-Telegram-Bot-Api-Secret-Token`) and one `callback_query` branch ([surfaces] §7.5) | W |
| `mcp-server/README.md` (P2 F) | new section "Remote MCP" (URL, connector steps, stages); existing text unchanged | XZ |
| `src/integrations/supabase/types.ts` | regenerated after the owner applied P4-1, separate commit (§4.13) | DB |

---

## 8. Frontend changes that reach Vercel production on merge (must degrade safely)

Merging the branch into `main` deploys the SPA to Vercel production (P2 G-6; Vercel builds `main` through its Git integration; `.github/workflows/auto-merge-claude.yml:10` keeps this branch out of auto-merge, and `cf-preview.yml`, `cf-ops.yml`, `cf-mail.yml` are manual dispatch only). The Supabase migration and the Telegram function are **not** applied on merge: no workflow runs `supabase db push` or `functions deploy` (`rg -n "db push\|functions deploy" .github/workflows` → no output, 2026-10-04), and `schema_migrations` stops at `20260713092040` while later repo migrations exist ([data] key facts), which indicates no Supabase Git integration applies `supabase/migrations/*`; the owner confirms this at OW-1.

| Change | Production state on merge | Safe because | Test |
|---|---|---|---|
| Routes `/dashboard/rfq-inbox`, `/dashboard/approvals` (lazy chunks) | reachable by URL | page shell redirects to `/login` unless `isAdmin()` (staff roles, src/contexts/AuthContext.tsx:263-265); `/dashboard` is disallowed in `public/robots.txt:20-21` and not prerendered (vite.config.ts:27-49) | W-5 |
| Two nav entries | visible to staff in the Operations sections | same gate as the neighbouring entries (CR-30) plus `isAdmin()` | W-5 |
| Reads of the 7 tables | tables absent until OW-6 | `PGRST205`/`42P01`/404 "schema cache" → `NotInstalled` banner, `retry: false`, no polling ([surfaces] §6.2); PostgREST docs (fetched 2026-10-03) `phase4/cfdocs/postgrest_errors.rst:96`, `:308-310` | W-1, W-5 |
| Actions (`/api/agent/*`) | Vercel answers the SPA shell (`vercel.json` rewrite `/(.*)` → `/index.html`, rewrite #7); before the Phase 4 ops deploy the Worker forwards unknown paths or the ops route answers 404 | every action button is disabled until `GET /api/agent/status` returns JSON `{v:1, ok:true}`; no POST is ever sent without that probe | W-1, W-5 |
| Untyped table access | `src/lib/agentDb.ts` casts once until types are regenerated | imported only by the new pages | W-6 |
| Types regeneration (separate commit after OW-6) | `src/integrations/supabase/types.ts` becomes UTF-8 with 79 tables | `npx vite build` passes; Phase 4 files have zero `tsc` errors; the production build does not typecheck (`package.json:9`) | DB-7 |
| No new dependency | root `package.json` and lockfiles unchanged | G4-7 | G4-7 |
| No secret or address in the bundle | pages read only via supabase-js under RLS and `/api/agent/*` | W-10 | W-10 |

Rules for W: no page writes to Supabase directly (the agent tables have no client write grant, agent_layer.sql:849-851); `body_excerpt` and every e-mail field render as text, never HTML; sender addresses are masked in lists; polling intervals 30 s (approvals) and 60 s (inbox) only after the first query succeeded.

---

## 9. Phase 5 on this layout (contracts Phase 4 must leave in place)

PHASE5_SPEC.md (scratch `phase5/`, 2026-10-03; its critique pass was being applied while this pass ran, re-read 2026-10-04 09:05 UTC) builds on these Phase 4 names; renaming any of them breaks Phase 5. PHASE5_SPEC also cites `PHASE4_SPEC.md:<line>` numbers of the pre-critique file; the section and row ids below are the stable references.

| Phase 4 item | Phase 5 use | Rule for Phase 4 builders |
|---|---|---|
| `readFlag()` (`agents/flags.ts`); alias `readAgentFlag()` | every Phase 5 job imports `readFlag` (PHASE5_SPEC §3.1, CD5-1) | export both names (§4.7) |
| `AgentKey` in `agents/runs.ts`; `openRun`, `checkpointRun`, `closeRun`, `failRun` | K5 adds its eleven keys to the union in `runs.ts`, nothing else in that file (PHASE5_SPEC §3.2) | keep the union in `runs.ts` (CR-34); keep the file free of anything Phase 5 would have to edit besides the union |
| `OpsEnv` with every Phase 4 field optional; `need()` (`agents/config.ts`) | Phase 5 adds its own fields to `OpsEnv` and passes `OpsEnv` to Phase 4 functions | Phase 4 functions take `OpsEnv` and narrow with `need()` (CR-40); Phase 5 fields should follow the same optional pattern, because the Phase 2 test helpers build `OpsEnv` literals (workers/ops/test/helpers/ops.ts:37-53) |
| `Ports`, `makePorts`, `PostgrestDb`, `MemoryDb`, `TelegramPort`, `MailerPort`, `GmailPort.accessToken`, `LlmPort`, `BlobPort` (with `getRange`), `EventsPort` | reused; Phase 5 adds `ports/p5.ts` beside them | no Phase 5 port in Phase 4 |
| `workflows/steps.ts` profiles, `FakeStep` | Phase 5 Workflows | export profile constants by name |
| `agents/gateway.ts`: `async anthropicFor(env, meta): Promise<Anthropic>` and `gatewayHeaders(env, meta)` | Phase 5 text calls to Anthropic and Google AI Studio | `anthropicFor` is asynchronous (it awaits `getUrl()`); callers write `(await anthropicFor(env, meta)).messages.create(…)` (PHASE5_SPEC §5 `textLlm.anthropic` row writes the call without `await`); header builder exported as `gatewayHeaders(env, meta)` |
| `failure` cards through `failRun()` and `decide()` (`retry` = restart from the failed step, `dismiss`) | Phase 5 failure cards use kind `failure` (codes `rty`, `dis`; surfaces.md:653) | a run behind a failure card is `waiting_human` with `parked_reason = 'failed'` (CR-37); a Phase 5 job that is not a Workflow closes `failed` without a card or offers `dismiss` only |
| `index.ts` `scheduled()` switch on `controller.cron` with case `'* * * * *'` | Phase 5 appends `ctx.waitUntil(runSchedule(…))` to that case | one `switch`, one case per cron string |
| `index.ts` `queue()` dispatch by `batch.queue` and envelope guard; `ScrapeMessage` and `queues/scrapes.ts` unchanged in Phase 4 | Phase 5 adds the queues `translations`, `outbound-mail` and its own envelope `P5ScrapeMessage` on `scrapes`, routed in `index.ts` to `queues/scrapes-p5.ts` (PHASE5_SPEC D-27) | `DirectoryScanMessage` routing stays in `index.ts` (§4.9); the Phase 2 consumer stays the fallback branch |
| `cad/types.ts` (`UnfoldFetcher`, `CadBackend.run`), `CadRouter`, `HttpUnfoldBackend`, `cad/backends/container.ts` stub, `CAD_BACKEND_DEFAULT` | P5-6 Container drop-in (optional lease argument, slots, recycle) | shapes exactly [agents] §9.2; inline caps and inline concurrency 1 stay (§4.12) |
| DO migration tag `v1` (3 classes) | Phase 5 tag `v2` = `SenderLimiter`, `CadContainer` | never edit `v1` after the first deploy |
| `check-bundle.mjs` forbidden-var array (ops) | Phase 5 adds its T2-only names | export the array |
| Phase 2 test extension points (§7.2): `workers/ops/test/config.test.ts` in "Phase 2 subset exact + additions present" form, `workers/shared/test/http/rpc.test.ts`, `workers/site/test/policy.test.ts` | Phase 5 changes ops `wrangler.jsonc`/`package.json`, shared `rpc.ts` and the site policy | K writes `config.test.ts` so that further additions (Phase 5 vars, bindings, dependencies) need no new edit, except `secrets.required`, which stays an exact list; `rpc.test.ts` and `policy.test.ts` are extended again by the Phase 5 unit that widens the union or adds IDs |
| Site `Env` unchanged; agent secret through `AgentSiteEnv` | Phase 5 M5 adds `CAD_COMPAT_TOKEN?` (PHASE5_SPEC §3.2) | the env-api test fails on any new field in the Phase 2 section of the site `Env` (workers/site/test/env-api.test.ts:228-238); the same `extends Env` pattern avoids it |
| T2 harness profiles, stub modules; ops T2 configs | Phase 5 profile `jobs`, files `test/t2-jobs/*.jobs.ts`, config `vitest.t2.jobs.config.ts` (PHASE5_SPEC F5-25) | profile switch by `T2_PROFILE`, stub modules mounted from `stubs/*.mjs`, `startHarness({profile, primary})`; the Phase 2 ops T2 config excludes `test/t2/**` and the `agents` config collects only `test/t2/*.t2.ts` |
| Site `/api/agent/` exclusion in `shouldForward` | Phase 5 adds `/api/cad/` the same way | one prefix list |
| `agent_retention_purge()`, `agent_runs` indexes, `parked_reason` | `ops-digest` monthly purge and counts | no change |

---

## 10. Exit gate mapping (PLAN.md:346-352) and P4-14

| Exit gate | Evidence | Who | Units |
|---|---|---|---|
| 1 One real RFQ end to end with the approval gate | P4-14 run on production after OW-1…OW-21: test e-mail from an owner-controlled address to `rfq@rfq.micronshub.eu` → `inbound_emails` row → intake (shadow, then assist) → RFQ rows → CAD job `succeeded` → quote draft card → owner approves on Telegram or the dashboard → quote sent to the owner's own address; `agent_runs` rows and timestamps exported as numbers only | Both | all |
| 2 Cost per RFQ measured | `agent_runs.cost_cents` of the P4-14 runs + AI Gateway log totals for `run_id` metadata + CAD wall-clock seconds from `cad_jobs` (`finished_at − started_at`) and the Analytics Engine `cad_job` points ([agents] §13) | Both | K, CQ |
| 3 Every agent has a flag; switching it off stops new runs within 2 min | owner switches `agent.rfq_intake` off on the dashboard (write-through to KV), sends a test mail 120 s later: no new run (row stays `received`, `MailIngest` answers `flag_off`); timing basis: ops reads with `cacheTtl` 30 s, KV changes reach other locations in up to 60 s (CF docs (fetched 2026-10-03) https://developers.cloudflare.com/kv/concepts/how-kv-works/), and the every-minute sync covers a missed write-through | Dimitris | DB, K, W |
| 4 Every run has an `agent_runs` row with outcome and cost | SQL (owner, read-only): `select agent, status, count(*) as runs, count(*) filter (where llm_calls > 0 and cost_cents = 0) as llm_runs_without_cost, count(*) filter (where status = 'running' and coalesce((human_action->>'decided_at')::timestamptz, started_at) < now() - interval '1 hour') as stuck_running, count(*) filter (where status = 'waiting_human' and approval_token_sha256 is null and parked_reason is null) as waiting_without_card from agent_runs where started_at > <P4-14 start> group by 1, 2;` → `llm_runs_without_cost`, `stuck_running` and `waiting_without_card` are 0 in every row (`cost_cents` is `NOT NULL DEFAULT 0`, agent_layer.sql:90, so a null check would always pass; waiting runs legitimately exceed 1 h, so they count only when they have neither a card nor a park reason); T1 coverage: every Workflow, consumer, cron unit and MCP call opens a run (K-2, IN-2, CQ-2, RP-2, XZ-2) | Both | all |
| 5 Parity diff on production unchanged | Phase 1 parity tool against production from the owner's machine (this runner gets 429, P2 G-2): 0 unexplained differences after the Phase 4 site deploy | Dimitris | W (site rows only) |

Rollback (PLAN.md:354): per-agent flag off (≈ 1-2 min); disable the Email Routing rules for `rfq.micronshub.eu` and restore the previous mailbox routing; the migration is additive and stays; the site's `/api/agent/*` rows can stay (inert without ops routes).

---

## 11. Defaults chosen for the owner

Owner instruction (2026-10-02, scratch `LEDGER.md`): Claude takes the plan's recommended default for every open question and lists each choice; the owner reviews the list at the end. Every row below is built as stated. "Annex" names the detailed row ([data] §11 #n, [agents] D4-n/A-n, [surfaces] D-x). Rows marked **owner-sensitive** change customer-visible behaviour or money and deserve a deliberate yes.

### 11.1 Defaults table

| # | Open question | Default chosen | Reason (one line) | Source / annex |
|---|---|---|---|---|
| DF-1 | PLAN Q3: Techpilot channel, current RFQ mailbox, may `rfq.micronshub.eu` Email Routing records be created? | Yes to `rfq.micronshub.eu`; Techpilot notifications forwarded to `rfq@rfq.micronshub.eu`; the current mailbox receives a shadow copy (`MAIL_COPY_TO`) during Phase 4 | PLAN.md recommended default | PLAN.md:618; D4-1 |
| DF-2 | PLAN Q20: LLM budget and providers | €50/month hard cap in AI Gateway, alerts at 50 % and 80 %; Anthropic for `extract`/`classify`, Workers AI for `embed`, Gemini (`translate`) only in Phase 5 | PLAN.md recommended default | PLAN.md:635; D4-2 |
| DF-3 | PLAN Q22: Mac mini CAD worker | not built; `BackendName` keeps `'mac_mini'` so it can be added behind the same interface | PLAN.md default (Container only in Phase 5, Mac mini later) | PLAN.md:637 |
| DF-4 | PLAN Q11 applied to agents: files that exist only in legacy S3 | agents read inputs from R2 only; legacy-only files become "geometry missing" manual-price lines | legacy buckets stay read-only; no new legacy consumer | PLAN.md:626; D4-13, A-12 |
| DF-5 | PLAN Q18: where security detail lives | only in the PRIVATE appendices of the scratch specs, never in the repo | the repository is public | PLAN.md:633; CANON.md §1 |
| DF-6 | Staff check for agent data | new `has_staff_role()` (the 4 `user_roles` staff roles), `is_staff()` unchanged | agents must not trust tenant roles | PLAN.md:310; [data] §11 #1 |
| DF-7 | Raw approval token in the database | SHA-256 hex only | a table read cannot forge a decision | [data] #2 |
| DF-8 | Flag sync cursor | per-row `rev` / `kv_synced_rev`, no `_synced_at` KV key | exact convergence per row | [data] #3 |
| DF-9 | Seeding `feature_flags` from today's KV | first cron tick imports valid KV values; absent keys are not written; malformed keys stay pending and are reported | `api.forward_to_vercel` and `seo.strict_404` keep their state (P4-2) | PLAN.md:315; [data] #4 |
| DF-10 | Deleting flags; hand edits to KV | DELETE/TRUNCATE blocked; hand edits allowed as break-glass, reported hourly, overwritten at the row's next edit | flags are an audit trail | [data] #5, #6 |
| DF-11 | Logging the every-minute sync | `agent_runs` row only when something changed or failed | avoids 1,440 rows a day | [data] #7 |
| DF-12 | Agent flag read cache | `cacheTtl` 30 s (KV minimum) with write-through on edits | exit gate 3 (≤ 2 min) | [data] #8; CR-12 |
| DF-13 | Seed values | all off; intake `shadow`; quote and post-order `assist`; follow-ups 3/4/7 days; tender relevance off, cap 20; MCP writes off | AGENTS.md rollout | [data] #9 |
| DF-14 | `pricing_rules` uniqueness; kerf factor and supplier data | unique on (tenant, process, rule_key, version, material_match, qty_min, qty_max) NULLS NOT DISTINCT; kerf factor as a rule key; supplier data from `catalog_materials`; no new `materials` columns | live `materials` lacks those columns | [data] #10, #21; CR-7 |
| DF-15 | `rfq_files (rfq_id, sha256)`; `cad_jobs` dedupe without an RFQ | full unique constraints (PostgREST `on_conflict` needs them); `NULLS NOT DISTINCT` for `cad_jobs` | idempotent single-statement writes | [data] #11, #12; CR-4 |
| DF-16 | Agent columns on `rfqs`/`rfq_files` written by clients | guard trigger; staff may create `manual` rows | agent provenance cannot be forged by a client | [data] #13 |
| DF-17 | `create_email_rfq` privilege | SECURITY INVOKER, service role only, advisory lock around `create_public_rfq` | no new client-callable path | [data] #14 |
| DF-18 | Multi-row stock writes and their names | RPCs `stock_hold`/`stock_commit`/`stock_release` (tested names); signed reserve amounts; `stock_items` untouched; RESTRICT on order items and sessions with holds | atomic holds; one truth (`stock_reservations`) | [data] #15-#17; CR-1 |
| DF-19 | Original e-mail text for the inbox | `inbound_emails.body_excerpt` ≤ 4,000 chars, written by intake, cleared after 90 days | dashboard needs text without fetching R2 | [data] #18; CR-17 |
| DF-20 | Retention | `agent_retention_purge()`: by hand before Phase 5, monthly from `ops-digest` afterwards; `agent_runs` 13 months, `inbound_emails` 24 months, raw mail 90 days (R2 lifecycle) | AGENTS.md §2.6 proposal | [data] #19; D4-22 |
| DF-21 | Migration file name and location | `supabase/migrations/<yyyymmdd>_agent_layer.sql` with the build day; down script in `supabase/rollback/` | applied in the SQL editor; the name orders files only | [data] #20; §5 unit DB |
| DF-22 | `types.ts` gate | zero `tsc` errors in Phase 4 files + `vite build`; total count reported, not gated | the app build does not typecheck (package.json:9) | [data] #22 |
| DF-23 | Who writes the `inbound_emails` row | `microns-mail` (service-role secret in the mail Worker) | mail is never lost when ops is down | D4-6; F4-3 |
| DF-24 | DO and Workflow declaration form | `migrations` with tag `v1` (3 classes) + `workflows` entries | draft form; tags are immutable | D4-7, D4-8; F4-4 |
| DF-25 | Anthropic key placement | BYOK in AI Gateway (alias `default`); `ANTHROPIC_API_KEY` not set; gateway authentication on | PLAN.md:316 names BYOK | D4-3; F4-5 |
| DF-26 | Gateway path for Anthropic | provider-native endpoint through `@anthropic-ai/sdk` (`getUrl('anthropic')`) | keeps structured outputs, caching and usage | D4-4; F4-5 |
| DF-27 | Models at Phase 4 start | `extract` = `claude-sonnet-5-5`, `classify` = `claude-haiku-4-5`, `embed` = `@cf/baai/bge-m3` | CANON role classes; current models | D4-5; F4-6 |
| DF-28 | Refusal fallback on `extract` | `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`; if the gateway path rejects it at OW-10, the client drops both fields and a refusal becomes a human card | default for Sonnet 5.5; unverified through the gateway | F4-7 |
| DF-29 | Payload logging | off for every customer-data call; metadata (5 keys) on | data minimisation with cost visibility | A-7; F4-8 |
| DF-30 | LLM step timeouts | `extract` 3 min (PDF input), `classify` 1 min | AGENTS.md's 2 min is short for documents | D4-9 |
| DF-31 | Quote sender identity | `MicronsHub Quotations <info@micronshub.eu>`, `Reply-To: replies@rfq.micronshub.eu` | same identity as today (api/emails.js:293) | D4-10; F4-10 |
| DF-32 | Message-ID: ours or Resend's | both stored; reply rules match either | Resend's handling of a custom Message-ID is undocumented | D4-11 |
| DF-33 | CAD for DXF, STL and CNC | inline TypeScript backend ported from the edge-function parsers; unfold service for STEP sheet metal only | the unfold service accepts STEP only | D4-12; F4-11 |
| DF-34 | CAD backend value `inline` in the database | `cad_jobs.backend` CHECK gains `inline` (AM-1) | the inline backend writes it | CR-9 |
| DF-35 | Drawing PDFs in the customer quote mail | not attached (`value.attach_drawings` false) | AGENTS.md:298 is ambiguous; smaller mails | D4-14 |
| DF-36 | Follow-up texts | generated with the cover e-mail and approved once | one approval per quote | D4-15 |
| DF-37 | Gmail token write-back by the poller | none; refresh in memory; `invalid_grant` → card, account skipped | no new writer of the grants | D4-16 |
| DF-38 | Phase 2 `inv-*` actions through `MaterialStock` | no (inventory tables are empty) | revisit when inventory is used | D4-17 |
| DF-39 | Partner download links | signed `/api/agent/file` links (HMAC, ≤ 7 days) | no presigned R2 URL leaves the system | D4-18 |
| DF-40 | Vector granularity | one vector per quote line, namespace = tenant | similar-part retrieval | D4-19 |
| DF-41 | Prompt caching for Haiku prompts | none (below the 4,096-token minimum) | no effect, no cost | D4-20 |
| DF-42 | **owner-sensitive** VAT on quote drafts | shown as "to be confirmed", manual line; the quote PDF keeps today's intra-Community notice (src/pages/RfqDetails.tsx:1294-1296) | no tax rule is invented | D4-21 |
| DF-43 | **owner-sensitive** Order total on "won" (AM-4) | same formula as the portal Accept Quote: (Σ part totals + shipping) × 1.24, currency from the RFQ (EUR default) set explicitly | the portal and the agent create identical orders (src/pages/customer/QuoteDetailPage.tsx:175-178, :427) | CR-5; AM-4 |
| DF-44 | Font for PDFs | Liberation Sans 2.1.5 (SIL OFL 1.1), embedded subset | Greek text; metric-compatible with Arial/Helvetica | D4-23; F4-9 |
| DF-45 | Approved prices on the RFQ | written back to `rfqs.parts_details`, `total_amount`, `shipping_cost` before the send | the portal's Accept Quote keeps working | A-13 |
| DF-46 | €/kg derivation and missing rates | `price_per_kg`, else `price_per_unit` when `stock_unit` is kg, else `price_per_unit / weight_per_unit`; rates only from owner-entered `pricing_rules`; anything missing → manual line | no invented business numbers (R-7) | A-17 |
| DF-47 | Mail during shadow mode | every accepted mail is also forwarded to `MAIL_COPY_TO` | nothing changes for the team until `assist` | A-18 |
| DF-48 | Remote MCP framework | stateless `createMcpHandler`; no `McpAgent`, no DO, no `MCP_OBJECT` | `McpAgent` is deprecated (CF docs 2026-10-03) | D-S1; F4-12 |
| DF-49 | MCP package pins | `agents` 0.24.0, `@modelcontextprotocol/server` 2.0.0, `sdk` 1.30.0, `client` 2.0.0, `zod` 4.6.5 (whole ops package), `@cloudflare/puppeteer` 1.4.0 | exact peers; probed together | D-S2; CR-11 |
| DF-50 | MCP sign-in | Cloudflare Access MCP server application with Managed OAuth; Worker checks the Access assertion and maps the e-mail to a staff role (`agent_staff_for_email`, AM-5); no `MCP_OAUTH_*` secrets | no OAuth code in the Worker | D-S3, D-S4; F4-13 |
| DF-51 | MCP URL | `https://mcp.micronshub.eu/mcp` | Agents SDK default route | D-S5 |
| DF-52 | MCP write stages | flag `mcp.remote`: off → status tool only; on → read tools; `value.writes` → stage-2 writes; `value.write_tools` → named opt-ins | AGENTS.md staged rollout | D-S6 |
| DF-53 | Long MCP jobs | queued on `scrapes` (`directory-scan`, tender and funding scans) | Workers request limits | D-S7 |
| DF-54 | Share or port MCP tool code | port with a parity test; local server unchanged | the local server stays usable offline | D-S8 |
| DF-55 | `api_base_url` tool arguments | dropped on the remote server; `run_saved_search` fixed for the live schema | a server never fetches caller-supplied base URLs; live columns differ | D-S9, D-S10 |
| DF-56 | MCP audit and personal data | one `agent_runs` row per call (reads async; writes deduplicated by args digest + 10-min bucket); e-mails masked in list tools | exit gate 4; data minimisation | D-S11, D-S12 |
| DF-57 | Dashboard decisions without the raw token | `run_id` + `token_sha256` under a staff JWT; only the Telegram relay sends raw tokens | the database holds hashes only | D-W1; F4-14 |
| DF-58 | Detecting the Worker API from the SPA | `GET /api/agent/status` probe; buttons disabled otherwise | the pages ship to Vercel first | D-W2; §8 |
| DF-59 | Extra agent actions | `status`, `flag` (ADMIN, `agent.*` and `mcp.remote`, optimistic `rev`, write-through), `start` (`quote`, `rfq_intake`, `test_card` ADMIN), staff `file` preview | dashboard parity with Telegram | D-W3…D-W5 |
| DF-60 | `/api/agent/*` under `api.forward_to_vercel` | never forwarded | Vercel has no such route | D-W6; CR-18 |
| DF-61 | Types before regeneration; sidebar; live updates | untyped accessor + `src/types/agent.ts`; staff-only nav entries; polling 30/60 s, no Realtime | smallest safe change | D-W7…D-W9 |
| DF-62 | "Original text" and the `/rfq/:id` agent panel | `body_excerpt` as plain text plus `.eml` download; no panel on `/rfq/:id` in Phase 4 (follow-up) | PLAN file list names two pages only | D-W10, D-W11 |
| DF-63 | Telegram relay base file | live v6 source + callback branch; repo-only `/keywords` dropped (never ran live) | the live file is what runs | D-L1 |
| DF-64 | `callback_data` and codes | `ap:<token>:<code>`, codes of §4.4 (incl. `a1`…`a3` for reply picks) | ≤ 34 bytes (Telegram 1-64) | D-L2; CR-24 |
| DF-65 | Who answers and who edits a card | relay answers the callback; ops edits the card for every channel | one place renders decisions | D-L3 |
| DF-66 | Who may press approval buttons | approval callbacks are accepted only from the owner chat and the owner's Telegram user; the relay changes nothing else in the bot (details Appendix P.4) | approvals are owner decisions; Phase 4 adds only the callback path | D-L4 |
| DF-67 | Relay rollout and target | the relay accepts updates only with the webhook secret token header; OW-17 sets the token with `setWebhook` before the deploy; decision URL in a function secret; if the webhook points at `telegram-tenders-bot`, the hook moves there | no window of rejected updates | D-L5…D-L7 |
| DF-68 | robots.txt for the new scraper path | enforced, fail closed; owner-recorded permissions only (`SCRAPER_PERMITTED_HOSTS`) | scraping of third-party directories follows their robots.txt and published terms | D-Z1; F4-17 |
| DF-69 | Browser use, identity, concurrency | client-rendered pages of permitted hosts only, never after a block; UA `MicronsHubBot/1.0`; 1 browser per invocation, `limit(6)`, consumer concurrency 2 | PLAN.md:323 cap of 6 | D-Z2…D-Z4 |
| DF-70 | Parser reuse | **ported** into `scrapers/parsers/*` with a byte-equality test; `api/*` unchanged | owner constraint "api/* unchanged" overrides the annex | F4-18 (overrides D-Z5) |
| DF-71 | Background scans | envelope `DirectoryScanMessage` on queue `scrapes` (§4.9); the Phase 2 handlers stay byte-identical (parity); which directories may be scanned is the owner's decision OW-24 under their published terms | parity first | D-Z6, D-Z7 |
| DF-72 | Phase 4 secrets at deploy time | optional (`secrets.required` unchanged in site and ops); checked per use | an unrelated ops or site deploy never fails for agent config | §4.1-§4.2 |
| DF-73 | `rfq_files.file_path` of agent rows | `<rfq_id>/<file_id>-<safe-name>`; `r2_key` = `rfq/` + that | the RFQ page presigns `file_path` through the files API, which prefixes `rfq/` | CR-16 |
| DF-74 | Quote verb `edit` and actor format | no `edit` verb (`approve` with `edits`); actor `telegram:<from.id>` or `user:<uuid>` | matches the stored CHECK (agent_layer.sql:361) | CR-14, CR-15 |
| DF-75 | `pdf-lib` and `@supabase/supabase-js` in ops | resolved from the root install (1.17.1, 2.101.1); one copy each in the bundle | same versions as `api/*` and `lib/*` | CR-26 |
| DF-76 | SQL test harness in the public repo | sanitised copy of `live_min.sql` (Appendix P.1) | the harness must not describe live weaknesses | CR-31 |
| DF-77 | Eval runner and parity test runtime | vitest (`eval:synthetic`, `mcp:parity`), not plain Node scripts | ops sources use extensionless TypeScript imports | §5 unit K |
| DF-78 | Default tenant for agents | var `AGENT_TENANT_ID` = `00000000-0000-0000-0000-000000000001` | the only tenant that owns RFQs today (live 2026-10-03) | §4.1 |
| DF-79 | Phase 5 alignment | `readFlag` (Phase 5 imports it; alias `readAgentFlag` kept for the annex text); `AgentKey` lives in `agents/runs.ts`, where Phase 5 adds its keys; `anthropicFor` is asynchronous | PHASE5_SPEC §3.1, §3.2 (re-read 2026-10-04 09:05 UTC) | §9 |
| DF-80 | Agent flood control | `value.max_runs_per_day` default 200 per agent, checked at `open-run`; above it the run closes `skipped` with error `daily_cap` without LLM calls, an intake mail is set to `needs_review` (re-runnable from the inbox), one Telegram notice per agent and day | second fence after the gateway cap; `needs_review` is a mail status, not a run status (agent_layer.sql:104, :417-418) | CR-38; Appendix P.5 |
| DF-81 | **owner-sensitive** Inline CAD limits | inline analysis only for STEP ≤ 5 MB, DXF ≤ 3 MB, STL ≤ 0.75 MB, one inline job per isolate; larger non-sheet-metal files become manual-price lines (`inline_too_large`); STEP sheet metal of any size up to 50 MB goes to the unfold service as before | the parsers keep the whole model in memory and the isolate has 128 MB (§4.12, probe 2026-10-04); the Phase 5 Container is the place for heavier analysis | CR-39 |
| DF-82 | Failure handling of Workflow runs | the run waits on a `failure` card (Retry restarts from the failed step, Dismiss closes it `failed`); unanswered failure cards close `failed` after 14 days | a human sees every failed agent run; the schema allows a token only on waiting runs | CR-37 |
| DF-83 | AI Gateway rate limiting | not configured in Phase 4; the €50/month spend limit (DF-2), the per-agent daily cap (DF-80) and the Workflow retry profiles bound the request rate; a gateway 429 parks the run as `budget` | Q20 names a budget only (PLAN.md:635); a rate-limit 429 would park runs that need no human | DC-19 |
| DF-84 | First apply of the migration on live Postgres 15.8 | dry run with `ROLLBACK` first, then the real run (OW-6) | the tests run on Postgres 18.3 and 16.4 only | §4.13 |

### 11.2 Proposed names (built as listed; the owner approves them with the defaults)

| Kind | Names |
|---|---|
| Named entrypoint | `MailIngest` (ops) |
| Vars (ops) | `AGENT_TENANT_ID`, `QUOTE_FROM`, `QUOTE_REPLY_TO`, `MESSAGE_ID_DOMAIN`, `CAD_BACKEND_DEFAULT`, `MCP_HOSTNAME`, `MCP_ROUTE`, `MCP_ACCESS_AUD`, `SCRAPER_USER_AGENT`, `SCRAPER_PERMITTED_HOSTS`; T2-only `AGENT_STUBS`, `AGENT_LLM_BASE_URL`, `RESEND_API_BASE`, `TELEGRAM_API_BASE`, `GMAIL_API_BASE`, `GOOGLE_TOKEN_URL` |
| Vars (mail) | `AGENT_TENANT_ID` (with canonical `ALLOWED_RCPT`, `SUPABASE_URL`) |
| Secrets | ops `AI_GATEWAY_TOKEN`, `CAD_UNFOLD_URL`, optional `CAD_ACCESS_CLIENT_ID`/`CAD_ACCESS_CLIENT_SECRET`; mail `MAIL_COPY_TO`, `MAIL_FALLBACK_TO`; site + ops + Supabase function `AGENT_APPROVAL_SECRET` (named in AGENTS.md:887); Supabase function `TELEGRAM_WEBHOOK_SECRET`, `AGENT_DECISION_URL` |
| Bindings | `MCP_RATE_LIMIT` (`namespace_id` `"2004"`) |
| Database | functions `has_staff_role`, `create_email_rfq`, `agent_run_begin`, `agent_run_claim_approval`, `stock_hold`, `stock_commit`, `stock_release`, `agent_retention_purge`, `feature_flags_*` (5), `create_order_from_quote`, `agent_staff_for_email`; trigger `agent_columns_guard`; columns `quote_workflows.drafts`, `quote_workflows.pdf_sha256`, `agent_runs.parked_reason` |
| Agent keys and events | `quote.reply_poller`, `cad`, `eval`, `mcp`, `flags`, `growth.scrapers`; Workflow event `agent-resumed`; queue envelope `DirectoryScanMessage` (kind `directory-scan`); `parked_reason` value `failed`; run error codes `daily_cap`, `restart_failed`, `config_missing`; CAD warning `inline_too_large` |
| Storage | R2 prefix `eval/golden/`; CAD output names `cad/<job_id>/output/{result.json,flat.dxf,drawing.pdf,flat.svg,log.txt}` |
| Access | MCP application `microns-mcp`; optional CAD application with service token `microns-machine-cad` (Appendix P.3) |
| Files | `workers/mail/**`, `.github/workflows/cf-mail.yml`, `supabase/rollback/`, `supabase/tests/agent_layer/`, `tests/edge/`, `.gitattributes`, `mcp-server/.gitignore`, `workers/ops/src/agents/config.ts` |

### 11.3 Deviations from the repo docs and corrections to propose (written into `docs/migration/**` only with the owner's OK, PLAN.md:45)

| # | Doc statement | Build | Annex |
|---|---|---|---|
| DC-1 | P4-11 `MicronsMcp` (`McpAgent`) Durable Object with `MCP_OBJECT`, in tag `v1`; secrets `MCP_OAUTH_*` (PLAN.md:324; AGENTS.md:21, :519; ARCHITECTURE.md:107, :451; CANON.md:66, :73; wrangler.jsonc.draft:383-387, :402, :480) | stateless handler, no DO, no OAuth secrets | DV-S1, DV-S2, DV4-2 |
| DC-2 | `microns-mail` `OPS` binding without entrypoint (wrangler.jsonc.draft:568-571) | `entrypoint: "MailIngest"` | DV4-1 |
| DC-3 | `analyse` = `POST /api/v1/unfold/info` (AGENTS.md:597); `CadRouter.submit` executes jobs (ARCHITECTURE.md:450); quote waits for drawing jobs (AGENTS.md:293) | `/api/v1/unfold` with DXF output; router grants leases, consumer executes; drawings not awaited | DV4-3…DV4-5 |
| DC-4 | Drawing PDFs attached to the quote (AGENTS.md:298) | not attached by default | DV4-6 |
| DC-5 | `materials` supplier/lead-time/kerf columns; `stock_transactions.order_id` (AGENTS.md:282, :358-361, :647, :890) | `reference_type`/`reference_id`; supplier from `catalog_materials`; kerf as a pricing rule | DV4-7; [data] C-1, C-2 |
| DC-6 | Event list (AGENTS.md:117-128); LLM timeout 2 min (AGENTS.md:136); poller runs under `quote` (AGENTS.md:566-568) | + `agent-resumed`; 3 min for `extract`; `quote.reply_poller` | DV4-8…DV4-10 |
| DC-7 | Schema sketch AGENTS.md §7 (:657-864), token storage (:108, :111), `_synced_at` KV key (:89), `idempotency_key UNIQUE` (ARCHITECTURE.md:613) | reconciled DDL; hashes; revision columns; unique per (agent, key) | [data] C-3…C-6 |
| DC-8 | Inventory migration (supabase/migrations/20260401_create_inventory_system.sql) describes `materials` columns that are not live | schema-drift note for P0-4/P6 | [data] C-7 |
| DC-9 | Decision bodies (AGENTS.md:110, :115) | dashboard `{v, run_id, token_sha256, verb, edits?}`, relay `{v, token, code, tg}` + signed headers | DV-S4, DV-S5 |
| DC-10 | MCP write idempotency `mcp:<session>:<request>` (AGENTS.md:511); remote tool list (AGENTS.md:521) | args digest + 10-min bucket; + `list_inbound_emails`, `list_pending_approvals`, `start_quote`, `mcp_status` | DV-S3, DV-S10 |
| DC-11 | P4-12 file list (PLAN.md:338-343) | + nav layout, helpers, `src/types/agent.ts`, `src/pages/dashboard/agent/*`, `agent-callback.ts` | DV-S6, DV-S7 |
| DC-12 | `scan_directory`/`run_saved_search` use Browser Rendering on Europages/wlw (AGENTS.md:403) | new fetch paths follow the robots gate and owner-recorded permissions (OW-24) | DV-S9 |
| DC-13 | New endpoint actions beyond `decision` and `file` | `status`, `flag`, `start` | DV-S11 |
| DC-14 | "Two bots" (INVENTORY.md:744) | one token for both functions, one webhook | DV-S12 |
| DC-15 | Product names "Email Routing", "Browser Rendering" | Cloudflare now titles them Email Service / Browser Run; names kept in repo docs, URLs updated | DV4-12, DV-S13 |
| DC-16 | DV-S8 (annex): named exports added to `api/*` | withdrawn: `api/*` unchanged (F4-18) | — |
| DC-17 | `api.forward_to_vercel` semantics (P2 §2.7) | `/api/agent/*` excluded | CR-18 |
| DC-18 | P4-3: AI Gateway routes `extract`, `classify`, `translate`, `embed` (PLAN.md:316) | `translate` is created in Phase 5 (P5-2), where its first caller is built | F4-6 |
| DC-19 | P4-3: "budget and rate limits per Q20" (PLAN.md:316) | spend limit with alerts only (Q20 proposes a budget cap, PLAN.md:635); no gateway rate limit; per-agent daily cap DF-80 instead | DF-83 |

---

## 12. Owner checklist (final manual steps; Dimitris unless marked Both)

All items run after the Phase 4 code is merged and the Phase 3 gate is signed (PLAN.md:356). Claude prepares commands and checks; the owner executes every account, dashboard, DNS, deploy and database-apply step. Every new credential, token, Access application and rate-limit namespace is appended to the P0-2 consumer checklist on the day it is created (PLAN.md:85).

| # | Step | When | Blocks | Reference |
|---|---|---|---|---|
| OW-1 | Review §11 (defaults, owner-sensitive DF-42/DF-43), approve §11.2 names, decide which §11.3 doc corrections go into `docs/migration/**`; confirm in the Supabase dashboard that no GitHub integration applies `supabase/migrations/*` on merge | before merging the branch into `main` | merge | §8, §11 |
| OW-2 | AI Gateway `microns`: create; **Authentication on first**; create a gateway token with Run permission → `npx wrangler secret put AI_GATEWAY_TOKEN` (in `workers/ops`); then store the Anthropic key as a provider key (BYOK, alias `default`); Logs on with payload logging off; caching off; spend limit €50/month with alerts at 50 % and 80 % (Q20) | before OW-10 | LLM steps | F4-5; Appendix P.6 |
| OW-3 | `npx wrangler queues create cad-jobs` and `npx wrangler queues create agent-events` (DLQs appear when first named) | before OW-8 | ops deploy | §4.1 |
| OW-4 | `npx wrangler vectorize create quotes-v1 --dimensions=1024 --metric=cosine`, then **before any insert** `npx wrangler vectorize create-metadata-index quotes-v1 --property-name=<p> --type=<t>` for `process` string, `material_family` string, `outcome` string, `thickness_mm` number, `sent_at_unix` number (vectors upserted before an index exists are not in it, CF docs (fetched 2026-10-03) `vectorize_reference_metadata-filtering.md:35`) | before OW-8 | ops deploy, similar quotes | [agents] §10.4 |
| OW-5 | In `workers/ops/wrangler.jsonc` replace `<KV_ID_FLAGS>` (the existing `FLAGS` namespace of the site) and `<ACCESS_TEAM_DOMAIN>`; confirm the zone is active on Cloudflare and that the Phase 3 runbook left `mcp.micronshub.eu` free for the ops Custom Domain (Claude commits the ID change on request) | before OW-8 | ops deploy | §4.1 |
| OW-6 | Apply P4-1 on live Postgres 15.8 (DF-84): first a dry run (paste the file with its final `COMMIT;` replaced by `ROLLBACK;`; success = no error, and afterwards `select to_regclass('public.agent_runs')` is still null), then paste the unchanged `supabase/migrations/<yyyymmdd>_agent_layer.sql` once (one transaction; aborts without changes if a precondition fails); run the checks of [data] §9 (13 flag rows, 7 grant rows, advisors); tell Claude, who regenerates `src/integrations/supabase/types.ts` (DB-7) | before OW-8 | every agent, dashboard pages | [data] §9 |
| OW-7 | Ops secrets: `AI_GATEWAY_TOKEN` (OW-2), `CAD_UNFOLD_URL`, `CAD_SHARED_SECRET`, `AGENT_APPROVAL_SECRET` (+ `CAD_ACCESS_CLIENT_ID`/`CAD_ACCESS_CLIENT_SECRET` if OW-11 picks the Tunnel path); mail secrets: `SUPABASE_SERVICE_ROLE_KEY`, `MAIL_COPY_TO`, `MAIL_FALLBACK_TO`; site secret `AGENT_APPROVAL_SECRET` (same value as ops) | with OW-8 | — | §4.1 |
| OW-8 | Deploy order: `microns-ops` first (`cf-ops.yml`, input `deploy: true`; creates the Workflows, the DO classes of tag `v1` and the `mcp.` Custom Domain), then `microns-mail` (`cf-mail.yml`, `deploy: true`), then the site through the Phase 3 production workflow; after the first minute run the flag checks of [data] §4.6. The CI token used by `cf-ops.yml`/`cf-mail.yml` needs, besides Workers Scripts and Queues edit, the permissions for Vectorize, Workers Routes/Custom Domains on the zone, as Cloudflare's token templates name them (re-check at creation) | after OW-2…OW-7 | everything below | P2 O-9 |
| OW-9 (Both) | Email Routing on `rfq.micronshub.eu`: enable for the subdomain (Cloudflare adds MX/TXT; the wildcard record then no longer answers for `rfq.`); add and verify the destination addresses of `MAIL_COPY_TO` (today's RFQ mailbox, Q3) and `MAIL_FALLBACK_TO`; create the literal rules `rfq@` and `replies@` → Worker `microns-mail`; send one test mail; Claude reads the stored `Authentication-Results` and pins the trusted `authserv-id` (Appendix P.5) | after OW-8 | inbound mail | [agents] §5.4; CF docs (fetched 2026-10-03) `email-service_configuration_subdomains.md` |
| OW-10 (Both) | On the preview: one gateway test call through the provider-native endpoint (BYOK works; `fallbacks: "default"` accepted, else DF-28 applies); one call without `cf-aig-authorization` must fail; one test quote to an own address: check `Reply-To`, the stored Resend `message_id` and whether our `Message-ID` header survived | before OW-22 | LLM steps, reply attribution | DF-28, DF-32 |
| OW-11 (Both) | Unfold service: set its `API_KEY` environment variable to the `CAD_SHARED_SECRET` value and restart; choose the network path of Appendix P.3 (default: Tunnel + Access service token) and set `CAD_UNFOLD_URL` accordingly | before the first agent CAD job | CAD jobs | sheet-metal-service/config.py:14; Appendix P.3 |
| OW-12 | R2 lifecycle rule on `microns-private`, prefix `email/`: delete after 90 days | with OW-9 | retention | DF-20 |
| OW-13 | Pricing data: enter `pricing_rules` rows (rates, margins, minimum order, shipping) and material prices (`catalog_materials.price_per_kg`, or per-sheet prices with `weight_per_unit`); until then every line is "manual price" | before `agent.quote` is enabled | price drafts | DF-46 |
| OW-14 | Review the three sample PDFs (`npm --prefix workers/ops run pdf:samples`) against a current offer, and the font licence file | before the first send | quote send | CQ-4 |
| OW-15 | Access: Zero Trust → Access controls → AI controls → MCP servers → add `microns-mcp`, URL `https://mcp.micronshub.eu/mcp`, policy Allow = owner identity only, Managed OAuth on, redirect URIs `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`, localhost and loopback clients allowed, access token 15 min, grant session 14 days; copy the AUD tag into ops var `MCP_ACCESS_AUD` (Claude commits it) and redeploy ops | after OW-8 | remote MCP | [surfaces] O-S1; CF docs (fetched 2026-10-03) `cloudflare-one_access-controls_applications_http-apps_managed-oauth.md` |
| OW-16 | Flag `mcp.remote` `{enabled: true, value: {writes: false}}` on the dashboard; Claude → Settings → Connectors → add `https://mcp.micronshub.eu/mcp`; sign in through Access; check `curl -i -X POST https://mcp.micronshub.eu/mcp` → 401 with `WWW-Authenticate`, the protected-resource `resource` equals the URL (else set `MCP_ROUTE` to `/` and reconnect, or BR-9), zone security rules do not challenge `160.79.104.0/21` | after OW-15 | MCP stage 1 | [surfaces] O-S4…O-S6 |
| OW-17 | Telegram: `getWebhookInfo` (confirm the webhook targets `telegram-leads-bot`; if it targets `telegram-tenders-bot`, Claude moves the change there, DF-67); set the webhook secret token to a new 64-hex value with `setWebhook` (same URL, `secret_token`, `allowed_updates: ["message","callback_query"]`); `supabase secrets set TELEGRAM_WEBHOOK_SECRET=… AGENT_APPROVAL_SECRET=… AGENT_DECISION_URL=https://www.micronshub.eu/api/agent/decision`; `supabase functions deploy telegram-leads-bot --no-verify-jwt`; dashboard "Send test card" (ADMIN) → tap "Dismiss" → card answered and edited, run `succeeded` | after OW-8 | approval buttons | [surfaces] §7.6 |
| OW-18 | Flags, stage by stage: `agent.rfq_intake` `{enabled: true, mode: "shadow"}`; `agent.quote` off until OW-13 and OW-14, then `assist`; `agent.post_order` off, then `assist`; `auto` is never honoured for prices or partner sends in Phase 4 | stage by stage | — | DF-13; AGENTS.md:96-100 |
| OW-19 | Golden set: export ≥ 30 past RFQ e-mails and a ground-truth CSV into R2 `microns-private` `eval/golden/<yyyy-mm-dd>/`; approve one `npm --prefix workers/ops run eval:live` run (≈ $1.50, list price) before switching `rfq_intake` from `shadow` to `assist` | before `assist` | intake rollout | [agents] §7.4 |
| OW-20 | After 2 weeks of MCP stage 1: `mcp.remote` `value.writes: true` | +2 weeks | MCP stage 2 | AGENTS.md:533 |
| OW-21 | Until Phase 5: run `select public.agent_retention_purge();` once a month (service role, SQL editor) | monthly | retention | DF-20 |
| OW-22 (Both) | P4-14: one real RFQ end to end with the approval gate (§10 gate 1); record the cost per RFQ (gate 2) | end | Phase 4 gate | PLAN.md:327 |
| OW-23 | Exit gates 3 and 5: switch `agent.rfq_intake` off and confirm no new run 120 s later; run the Phase 1 parity tool against production from the owner's machine (0 unexplained differences) | end | Phase 4 gate | §10 |
| OW-24 | Directory sources (Europages, wlw): read their current terms and decide on operator permission or a data agreement for every scanning path (Appendix P.10); only with permission add the host to `SCRAPER_PERMITTED_HOSTS` and enable `agent.growth.scrapers` | before any scraper flag change | P4-10 use | DF-68, DF-71 |
| OW-25 | Gmail: when a poller card reports `invalid_grant`, reconnect the account from the dashboard (Phase 2 flow) | when reported | reply poller | DF-37 |
| OW-26 | Sign the Phase 4 gate | end | Phase 5 | PLAN.md:51-56 |

---

## 13. Platform facts this spec relies on

| Fact | Source (fetched 2026-10-03 unless stated; copies in `phase4/cfdocs/`) |
|---|---|
| Workflow instance id ≤ 100 chars, pattern `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`; step result and event payload ≤ 1 MiB; `step.sleep` ≤ 365 days; waiting instances do not count towards concurrency; completed-instance state kept 30 days on Workers Paid (shorter with `retention`) | `workflows_reference_limits.md:34-54, :207`; https://developers.cloudflare.com/workflows/reference/limits/ |
| Duplicate `create` id throws `instance.already_exists`; `waitForEvent` timeout throws and can be caught; events sent before the wait are buffered | probe 2026-10-03 #2-#4; `workflows_build_events-and-parameters.md` |
| KV: `cacheTtl` default 60 s, minimum 30 s; absent keys cached too; changes reach other locations in up to 60 s or more; 1 write per second per key | https://developers.cloudflare.com/kv/api/read-key-value-pairs/, https://developers.cloudflare.com/kv/concepts/how-kv-works/ ([data] §13) |
| Cron Triggers run in UTC; trigger changes take up to 15 min to propagate; a cron under 1 h gets 30 s CPU | `workers_configuration_cron-triggers.md`; https://developers.cloudflare.com/workers/platform/limits/ |
| Queue message ≤ 128 KB | `queues_platform_limits.md` |
| Email Service (Email Routing): inbound message ≤ 25 MiB; subdomains get literal rules only (catch-all on the apex only); local testing through `POST /cdn-cgi/local/email` (primary Worker only, probe 2026-10-04 T-3) | `email-service_platform_limits.md:71`; `email-service_configuration_subdomains.md`; `email-service_local-development_routing.md` |
| No local simulation for Workers AI, Vectorize, Browser Run | `workers_local-development.md` (via [agents] key facts) |
| Vectorize: ≤ 10 metadata indexes per index; vectors upserted before a metadata index exists are not in it | `vectorize_reference_metadata-filtering.md:23, :35` |
| Analytics Engine: ≤ 20 blobs, ≤ 20 doubles, 1 index (≤ 96 bytes) per data point; blobs ≤ 16 KB per point | `analytics_analytics-engine_limits.md:19-21` |
| AI Gateway: `getUrl('anthropic')` gives the provider-native base URL; authenticated gateways take `cf-aig-authorization`; with Authentication off requests without it succeed; stored provider keys (BYOK); `cf-aig-metadata`; `cf-aig-collect-log-payload` | `ai-gateway_usage_worker-binding-methods.md`, `ai-gateway_configuration_authentication.md`, `ai-gateway_configuration_bring-your-own-keys.md`, `ai-gateway_observability_custom-metadata.md`, `ai-gateway_observability_logging.md` |
| `@anthropic-ai/sdk` 0.131.0 omits `x-api-key` with `defaultHeaders: {'x-api-key': null}` | sdkprobe `package/client.js:316-340`; probe #11 |
| Workers AI `@cf/baai/bge-m3`: 1,024 dimensions | `workers-ai_models_bge-m3.md` |
| `McpAgent` is deprecated and feature-frozen; `createMcpHandler` is stateless | `agents_model-context-protocol_apis_handler-api.md:21-24` |
| Access Managed OAuth makes Access the OAuth server of an MCP server application and passes `Cf-Access-Jwt-Assertion` to the origin | `cloudflare-one_access-controls_applications_http-apps_managed-oauth.md` |
| Browser Run: identification headers cannot be removed; Paid limits 200 concurrent browsers, 3 new per second; 10 h and 10 concurrent browsers included | `browser-run_limits.md`, `browser-run_reference_automatic-request-headers.md`, `browser-run_pricing.md` |
| Workers: 6 simultaneous connections waiting for headers per invocation; script size limit 64 MiB uncompressed, no compressed limit | `phase2/cfdocs/workers_platform_limits.md:203-216, :264-282` (fetched 2026-10-02) |
| PostgREST: `PGRST205` and `42P01` map to HTTP 404 | `postgrest_errors.rst:96, :308-310` |
| Resend: idempotency keys ≤ 256 chars, kept 24 h; custom headers allowed; `GET /emails/{id}` returns `message_id` | `resend_idempotency-keys.md`, `resend_custom-headers.md`, `resend_retrieve-email.md` |
| `wrangler dev` loads only the `secrets.required` names from `.dev.vars` when that list is defined; additional keys are excluded | `phase2/cfdocs/workers_configuration_secrets.md:103` (fetched 2026-10-02) |
| With several `-c` configs the first Worker is the primary and the only one served over HTTP; the others are reachable through service bindings (and the Local Explorer) only | `phase2/cfdocs/workers_runtime-apis_bindings_service-bindings.md:163` (fetched 2026-10-02); probe 2026-10-04 T-1…T-6 |
| Local Explorer: `POST /cdn-cgi/local/explorer/api/local/email/routing/send?worker=<name>` composes a message from JSON and runs that Worker's `email()` (the runtime sets the `Message-ID`); `POST …/local/scheduled?worker=<name>` with `{cron}` runs `scheduled()`; both reach secondary Workers. The raw `POST /cdn-cgi/local/email` route delivers to the primary only | `phase4/probe/explorer-openapi.json` (wrangler 4.145.0); probe 2026-10-04 T-3…T-5 |
| `instance.restart({from: {name, count?, type?}})` reuses the cached results of earlier steps and re-runs the named step and later ones; it throws if no such step is in the history | `workflows_build_workers-api.md:942-990` |
| Workers memory: 128 MB per isolate, shared by concurrent invocations; exceeding it ends the isolate after in-flight requests | `phase2/cfdocs/workers_platform_limits.md:121-125` (fetched 2026-10-02) |
| Telegram Bot API: `callback_data` 1-64 bytes; `secret_token` 1-256 chars of `A-Za-z0-9_-`, sent as `X-Telegram-Bot-Api-Secret-Token`; `answerCallbackQuery` text ≤ 200 chars; non-2xx webhook answers are retried | `telegram_bots_api.html` |

---

## 14. Build risks

| # | Risk | Mitigation |
|---|---|---|
| BR-1 | Resend replaces our `Message-ID`; its own id is known only after `GET /emails/{id}` | both stored (DF-32); RFQ number in the subject as fallback rule; OW-10 |
| BR-2 | Model refusals or schema drift on unusual mails | server-side fallback, one re-ask, then a human card; eval gate before every prompt or model change |
| BR-3 | Single-worker unfold service and its network path | `CadRouter` concurrency 1; 300 s deadline; Container in Phase 5; Appendix P.3 |
| BR-4 | Mini-PostgREST diverges from PostgREST | contract tests on the `PostgrestDb` request shapes; DB-3 parity of the RPC vectors; T3 on the real project with test rows |
| BR-5 | Local Workflow emulation differs from production | T3 on the preview before P4-14 (OW-10) |
| BR-6 | Price drafts look authoritative while rules are incomplete | missing rule or price → "manual price"; approval mandatory in `assist` |
| BR-7 | Memory pressure on large attachments and CAD inputs (128 MB per isolate) | streamed multipart; ZIP entries streamed one at a time; inline CAD caps STEP 5 MB, DXF 3 MB, STL 0.75 MB and one inline job per isolate (§4.12, measured 2026-10-04); one PDF per call; CQ-1 memory case at twice each cap |
| BR-8 | The landed Phase 2 code differs from P2 §2, or a Phase 2 test pins a shape Phase 4 changes | builders adapt inside their own files and report the difference (R-2); re-checked 2026-10-04 against the working tree: the pinned shapes found are listed in R-10 and handled at the test extension points of §7.2 (`config.test.ts`, `rpc.test.ts`, `policy.test.ts`, `vitest.t2.config.ts`), by keeping `ScrapeMessage` and the site `Env` unchanged, by optional `OpsEnv` fields and by a zero-argument default `fetch`; K repeats the check against the Phase 2 closing commit in Wave 0 (K-0 runs every Phase 2 suite) |
| BR-9 | Access Managed OAuth does not interoperate with a Claude surface (PRM `resource` mismatch, RFC 8707) | OW-16 checks; `MCP_ROUTE` switch; fallback: Access for SaaS (OIDC) upstream + `@cloudflare/workers-oauth-provider` 1.2.1 with KV `MCP_OAUTH_KV` and secrets `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, `MCP_OAUTH_COOKIE_KEY` ([surfaces] BR-S1) |
| BR-10 | `agents` releases fast and pins exact MCP peers | exact pins; upgrade only with XZ-3 and XZ-5 green |
| BR-11 | Dashboard pages on Vercel before tables or Worker exist | §8 matrix; W-5 cases |
| BR-12 | Telegram webhook target unknown; updates rejected during rollout | OW-17 order (`setWebhook` with the secret before the check is deployed); contingency DF-67 |
| BR-13 | The new scraper module may serve no directory until permissions are recorded | by design; OW-24 decides; the module serves permitted sources |
| BR-14 | Ported MCP tools drift from the local server | XZ-3 parity in CI |
| BR-15 | `microns-ops` bundle growth (MCP + puppeteer ≈ +1.9 MiB) | K-3 prints the size; limit 64 MiB uncompressed |
| BR-16 | A Phase 4 rename breaks Phase 5 | §9 table; K reviews every rename against PHASE5_SPEC §3 |
| BR-17 | `node:sqlite` is experimental on Node 22 | used only in T1 fakes; DO behaviour re-checked in T2 (real workerd SQLite) |
| BR-18 | 24 % VAT in AM-4 differs from the intra-Community notice on the PDF | parity default with an explicit owner decision (DF-43) |
| BR-19 | The migration is tested on Postgres 18.3 and 16.4, live runs 15.8 | static review ([data] §7); dry run with `ROLLBACK` on live first (OW-6, DF-84) |
| BR-20 | T2 injects composed mail (runtime-generated `Message-ID`), not raw MIME | raw-MIME edge cases in T1 with postal-mime (IN-2); T2 reads `result.messageId` (IN-3); real Email Routing delivery in T3 |
| BR-21 | `instance.restart({from})` on an instance that has ended is documented but unprobed | K-5/IN-3 exercise it in workerd; if it fails, Retry falls back to `create` of a new instance id `<id>-r<n>` that reuses the run row (decision then recorded as a contract change through K) |

---

## 15. Traceability (PLAN task → unit → acceptance → exit gate)

| PLAN task (PLAN.md line) | Unit | Acceptance | Exit gate |
|---|---|---|---|
| P4-1 migration + types (:314) | DB (+ owner OW-6 with the 15.8 dry run) | DB-1, DB-2, DB-3, DB-5, DB-6, DB-7 | 4 |
| P4-2 flags + KV mirror (:315) | DB (+ W flag edits) | DB-4, W-3 | 3 |
| P4-3 AI Gateway (:316) | K (+ owner OW-2, OW-10) | K-2, K-4 | 2 |
| P4-4 Email Routing + `microns-mail` (:317) | IN (+ owner OW-9) | IN-1, IN-3, IN-4, IN-5 | 1 |
| P4-5 `rfq-intake` + `RfqThread` (:318) | IN | IN-2, IN-3 | 1, 4 |
| P4-6 `CadRouter` + `cad-jobs` (:319) | CQ (+ owner OW-11) | CQ-1 (incl. memory case), CQ-3, CQ-5 | 1, 2 |
| P4-7 `quote` Workflow (:320) | CQ | CQ-2, CQ-4, CQ-5, CQ-6 | 1 |
| P4-8 reply detection + Gmail poller (:321) | RP | RP-1, RP-3, RP-4 | 1 |
| P4-9 `post-order` + `MaterialStock` (:322) | RP | RP-2, RP-3 | 4 |
| P4-10 scrapers (:323) | XZ | XZ-1, XZ-4, XZ-5, XZ-6 | 3, 4 |
| P4-11 remote MCP (:324) | XZ (+ owner OW-15, OW-16) | XZ-2, XZ-3, XZ-5 | 4 |
| P4-12 dashboard + Telegram callbacks (:325) | W (+ owner OW-17) | W-1…W-11 | 1, 3, 5 |
| P4-13 cost measurement (:326) | K | K-2 (cost and data-point tests) | 2, 4 |
| P4-14 end to end (:327) | owner + Claude | OW-22, OW-23 | 1-5 |

---

## Appendix C — Critique log (2026-10-04)

Input: the critique of 2026-10-04 on the pre-critique file (`PHASE4_SPEC.pre-critique.md`): verdict "not ready for builders", 22 findings (7 high, 8 medium, 7 low; its summary paragraph lists seven of the medium ones). Every finding was re-verified before any change, against the Phase 2 working tree on top of `91f1376`, the live database (read-only, 2026-10-04), the fetched Cloudflare docs, or a probe of this pass (`phase4/topoprobe`, `phase4/memprobe`, `phase4/mcpprobe/vt`). All 22 findings are real; none was rejected as a whole. Parts of a proposed fix that were not taken are listed with the reason. This appendix follows the public wording rules; security detail stays in Appendix P.

| # | Sev. | Finding | Verified by | Resolution (where) | Not taken, and why |
|---|---|---|---|---|---|
| C-1 | high | Phase 2 `config.test.ts` pins routes, vars, queues, top-level keys, dependencies and `.dev.vars.example` names exactly, so every Phase 4 config change fails G4-1 | workers/ops/test/config.test.ts:60-65, :77-98, :114-128 | Test extension point "Phase 2 subset exact + Phase 4 additions present" (§7.2, K, Wave 0); R-10; K-0 runs every Phase 2 suite; G4-10 | — |
| C-2 | high | Required Phase 4 `OpsEnv` fields break the typecheck of Phase 2 test helpers | workers/ops/test/helpers/ops.ts:37-53; test/marketing-webhook.test.ts:54-66; test/google-auth.test.ts:22-35; workers/ops/tsconfig.json `include` | All Phase 4 fields optional, `need()` per use (§4.2, CR-40) | The alternative `AgentEnv extends OpsEnv`: Phase 5 passes `OpsEnv` to `readFlag`, `openRun` and `makePorts` (PHASE5_SPEC §5), which a required-field type would reject |
| C-3 | high | Widening `ScrapeMessage['kind']` breaks the frozen Phase 2 consumer's exhaustive Records and contradicts PHASE5 D-27 | workers/ops/src/queues/scrapes.ts:28-31, :36; PHASE5_SPEC D-27 | Separate `DirectoryScanMessage` envelope, `isDirectoryScanMessage`, `sendDirectoryScan`, routing in `index.ts` (§4.9, §3.2, §7.1, §7.2, §9) | — |
| C-4 | high | `EndpointId += 'agent'` breaks the exhaustive site tables owned by W, so K-0 cannot pass in Wave 0 | workers/site/src/api/router.ts:40-55; workers/site/src/api/resolve.ts:257-280 | K adds the two stub lines in Wave 0, then hands both files to W (§3.3, §3.2, §4.5, §7.2) | Moving the `EndpointId` edit to W: it would split `rpc.ts` between two units |
| C-5 | high | T2 never loads the Phase 4 secrets: only `secrets.required` names come from `.dev.vars` | `phase2/cfdocs/workers_configuration_secrets.md:103`; workers/ops/wrangler.jsonc:57; workers/site/test/integration/harness.mjs:100, :116 | Generated T2 configs append the Phase 4 names; start-up assertion on wrangler's per-Worker binding tables (CR-33, §4.1, §6.3, K-5) | — |
| C-6 | high | With mail as primary, neither the site nor the ops default `fetch` (MCP) is reachable in T2 | `phase2/cfdocs/workers_runtime-apis_bindings_service-bindings.md:163`; probe 2026-10-04 T-1…T-7 | Site primary; mail through the Local Explorer `email/routing/send?worker=microns-mail`; crons through `scheduled?worker=microns-ops`; MCP and scraper tests on a second instance with ops primary (§6.1, §6.3, §4.6, §4.18, IN-3, K-5, W-4, XZ-5, §13) | — (the probe also showed that the raw `/cdn-cgi/local/email` route ignores `worker=` and reaches the primary only, and that the Explorer replaces a custom `Message-ID`: IN-2, IN-3, BR-20) |
| C-7 | high | Failure cards with Retry/Dismiss are impossible: a token is allowed only on `waiting_human` rows, `failed` rows are finished, the claim matches `waiting_human` only; parked runs carry no token | agent_layer.sql:104-109, :652-664 | `failRun()`: `waiting_human` + `parked_reason = 'failed'` (AM-3), Retry = claim + `restart({from})`, Dismiss = claim + close `failed`; parked runs resumed only by the dispatcher; 14-day expiry (CR-37, F4-16, §4.4, §4.7, §4.10, §4.13, §4.14, §4.17, DB-3, K-2, IN-3, RP-2, DF-82, BR-21) | A child run carrying the token: a second row per failure, a subject link back to the failed run, and a second run row for exit gate 4 |
| C-8 | medium | `AgentKey` location, `readAgentFlag` claim and the gateway client signature disagree with the Phase 5 spec | PHASE5_SPEC at critique time (shared `agent-types.ts`); re-read 2026-10-04 09:05 UTC: §3.1/§3.2 now put `AgentKey` in `agents/runs.ts` (K5 adds eleven keys) and import `readFlag`; agents.md:476 (`async anthropicFor`) | `AgentKey` stays in `runs.ts` (CR-34); DF-79, CR-12 and §9 say Phase 5 imports `readFlag`; `anthropicFor` stated as asynchronous (§4.15, §9) | Moving `AgentKey` into `workers/shared`: the sibling spec has since been aligned to `runs.ts`, so a move would reopen the conflict. The Phase 5 call written without `await` (PHASE5_SPEC §5 `textLlm.anthropic` row) is handed to the Phase 5 spec owner |
| C-9 | medium | vitest in Node cannot import `agents/mcp` with the Phase 2 alias set-up | re-run of `mcpprobe/vt` 2026-10-04: fails with "Only URLs with a scheme in: file, data, and node are supported…"; passes with `server.deps.inline` for `agents`, a `cloudflare:email` alias and `RpcTarget`/`exports` in the workers stub | §6.2 vitest contract and helpers; K-2 smoke import; XZ-2 | — |
| C-10 | medium | T1 cannot load `.md` prompts or `.ttf` fonts that wrangler loads through `rules` | `mcpprobe/vt/probe2.test.ts` fails both cases; the 15-line plugin of `mcpprobe/vt/vitest.rules.config.mjs` passes both (2026-10-04) | `wrangler-rules` plugin in `vitest.config.ts` (§6.2, §4.1); K-2 loads one prompt and the font | — |
| C-11 | medium | The 40 MB inline CAD cap and inline concurrency 3 do not fit the 128 MB isolate | `phase2/cfdocs/workers_platform_limits.md:121-125`; memprobe 2026-10-04 under a 96 MB heap: STEP ok at 10 MB (15 MB out of memory), DXF ok at 6 MB (8 MB out of memory), STL ok at 1.5 MB (2 MB out of memory) | Caps STEP 5 MB, DXF 3 MB, STL 0.75 MB; one inline lease and a per-isolate mutex; larger files become manual-price lines; ZIP entries streamed via `BlobPort.getRange` (§4.12, §4.6, CR-39, DF-81, CQ-1 memory case, IN Builds, BR-7, P.5 P5-d) | One cap of "about 5-8 MB" for every kind: STL and DXF need lower caps than STEP. Routing larger non-sheet-metal STEP files to the unfold service: it unfolds sheet metal only (F4-11); they become manual-price lines until the Phase 5 Container |
| C-12 | medium | The Phase 2 ops T2 glob collects the Phase 4 T2 files; the default T1 run collects the opt-in parity and sample tests | workers/ops/vitest.t2.config.ts:10; workers/ops/vitest.config.ts `include` | `exclude: test/t2/**` in the Phase 2 T2 config (§7.2, K, Wave 0); `describe.skipIf` for `parity.test.ts` and `samples.test.ts` (CQ-2, XZ-2); G4-2, G4-3; Phase 5 now uses `test/t2-jobs/` with its own config (PHASE5_SPEC F5-25) | — |
| C-13 | medium | The Resend pattern of SCAN-SECRET matches `hardware_confidence` | src/pages/dashboard/FundedStartupsPage.tsx:179; mcp-server/src/index.ts:1349, :1386 | Anchored pattern (no output on `src/pages/dashboard mcp-server/src workers`, 2026-10-04); CHANGED path lists; W-10 scope (§5) | — |
| C-14 | medium | `workers/ops/scripts/check-bundle.mjs` already exists; G4-4 claims checks the site guard does not make | workers/ops/scripts/check-bundle.mjs:21-41; workers/ops/package.json `build:dry`; workers/site/scripts/check-bundle.mjs:32-34 | Ops guard is a K extension that keeps `bundleProblems()`; site guard is a W extension forbidding the agent packages and ops sources (§3.2, §7.2, K-3, W-11, G4-4) | Rewording G4-4 only: the site bundle would stay unguarded against agent code |
| C-15 | medium | Exit gate 4 query cannot detect a missing cost | agent_layer.sql:90 (`cost_cents NOT NULL DEFAULT 0`) | New query (`llm_calls > 0 and cost_cents = 0`, stuck `running`, `waiting_human` without card or park reason), run on PGlite 0.5.8 2026-10-04 (§10); `closeRun` rule and K-2 assertion (§4.7) | Counting every `waiting_human` run older than 1 h as stuck: approval waits last up to 7 + 7 days by design (§4.10) |
| C-16 | low | Flood control ends runs in `needs_review`, which is not a run status | agent_layer.sql:104, :417-418 | Close `skipped` with error `daily_cap`; intake mail `needs_review` (CR-38, §4.7 `dailyCapReached`, DF-80, P.5 P5-f, IN-2) | Adding `daily_cap` as a park reason: nothing would ever resume it automatically |
| C-17 | low | DB-6 and DB-7 commands cannot produce their pass values | `has_role: {` at table indentation under `Functions` (src/integrations/supabase/types.ts:1103, UTF-16LE today); agent_layer.sql:866 | DB-6 extracts and counts the 13 seed keys (run on the scratch SQL: 13 keys, once each); DB-7 counts only `public.Tables` entries with `awk` (§5.1) | — |
| C-18 | low | AM-4 must apply the portal's fallbacks for sparse parts; AM-5 needs `role::text` | live 2026-10-04 `information_schema.columns` (`order_items.product_name` NOT NULL without default; `quantity`, `unit_price`, `total_price` NOT NULL with defaults; `user_roles.role` = `app_role`); src/pages/customer/QuoteDetailPage.tsx:440-447 | AM-4 `coalesce` rules, AM-5 cast (§4.13); DB-3 sparse-part vector | — |
| C-19 | low | Some quotable rows described the current state of integrations instead of stating the rule the new code enforces (CANON.md §1 rule 2) | DF-66, DF-67, DF-68, DF-71, F4-17, OW-17, OW-24 of the pre-critique file; the same pass found the same pattern in the §4.12 unfold row, the §7.2 relay row, DC-12 and BR-13 | Rewritten as rules; the status quo stays in Appendix P (P3-f, P4-b, P10-a); SCAN-WORDING gains four phrases | — |
| C-20 | low | P4-3 deviations (translate route, gateway rate limits) not listed | PLAN.md:316, :635 | DC-18, DC-19, DF-83 | Adding a gateway rate limit to OW-2: a rate-limit 429 maps to `budget` and parks runs that then wait for a human |
| C-21 | low | XZ-3 leaves untracked build output in a frozen directory; `eval/recordings/` not ignored | `git check-ignore mcp-server/build/index.js` and `workers/ops/eval/recordings/x.json`: not ignored (2026-10-04) | New `mcp-server/.gitignore` (XZ); `eval/recordings/` in `workers/ops/.gitignore` (K); XZ-3 checks the ignore; §6.5 | Building into a scratch `--outDir`: the built server must resolve `mcp-server/node_modules` (its own MCP SDK 1.x), which a build outside that folder would not find |
| C-22 | low | The migration never runs on the live major version 15.8 | live 2026-10-04 `server_version` = 15.8; data.md:232 | Note in §4.13; dry run with `ROLLBACK` in OW-6; DF-84; BR-19 | — |

C-1…C-22 follow the order of the critique's findings list.

Additional findings of this pass (same verification standard):

| # | Finding | Evidence | Resolution |
|---|---|---|---|
| A-1 | The typecheck-only `rpc.test.ts` pins `EndpointId` and `Principal` with `toEqualTypeOf`, so K's Wave 0 `rpc.ts` change fails the shared typecheck | workers/shared/test/http/rpc.test.ts:6-22 | Test extension point (K, Wave 0) (§4.5, §7.2) |
| A-2 | `policy.test.ts` pins 34 action IDs, the machine-caller map and the access classes | workers/site/test/policy.test.ts:9-31 | Test extension point (W) (§7.2, W-2) |
| A-3 | `env-api.test.ts` counts the fields after the Phase 2 marker of the site `Env` and requires each to be configured | workers/site/test/env-api.test.ts:228-246 | Site `env.ts` unchanged; `AgentSiteEnv` in `agent-hmac.ts` (§4.2, §3.2, §7.1, §7.2) |
| A-4 | A Phase 2 test calls the ops default `fetch()` without arguments | workers/ops/test/ops-api.test.ts:46-50 | `fetch(req?, env?, ctx?)` (§4.18, §7.2, K-2) |
| A-5 | `resolve.test.ts` pins 13 catalogue paths | workers/site/test/resolve.test.ts:52 | `/api/agent/` prefix matched before the catalogue (§7.2, W Builds) |
| A-6 | `BlobPort` had no range read, so streamed ZIP handling had no port | agents.md:302-307 | `getRange()` (§4.6) |
| A-7 | No rule for runs waiting on a failure card in the dispatcher | §4.17 of the pre-critique file | never resumed; closed `failed` after 14 days (§4.17, RP-2) |
| A-8 | Restarting an ended Workflow instance is documented, not probed | `phase4/cfdocs/workflows_build_workers-api.md:942-963` | T2 case in IN-3; fallback in BR-21 |
| A-9 | §9 still said Phase 5 adds kinds inside `queues/scrapes.ts`; R-2 said `workers/ops/src` had no `index.ts` | PHASE5_SPEC D-27; working tree 2026-10-04 | §9 rows; R-2 |

Hand-off to the Phase 5 spec owner (PHASE5_SPEC.md was being edited by its own critique pass and is not changed here): the `textLlm.anthropic` row calls `anthropicFor(env, meta).messages.create(…)` without `await`; its `PHASE4_SPEC.md:<line>` citations point at the pre-critique numbering (section and row ids are stable).

---

