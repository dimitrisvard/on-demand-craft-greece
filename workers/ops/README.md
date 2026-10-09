# microns-ops

Cloudflare Worker for the API handlers that do not run in `microns-site`, and the consumer of the queue `scrapes`. Phase 2 of the Cloudflare migration (docs/migration/PLAN.md §5.2; ARCHITECTURE.md §6.4, §7.2, §9). The handlers in `api/*.js` and `lib/*` are unchanged; they run through the shared `@vercel/node` shim (`workers/shared/src/compat/vercel-node.ts`). Every `/api/notifications` action runs here, because `api/notifications.js` imports nesting and inventory at module scope (PLAN.md §5.2 DV-1). Phase 4 (PLAN.md §5.4) adds the agent layer: section "Phase 4: agent layer" below.

## How requests reach it

| Entry | Who calls it | Rule |
|---|---|---|
| `OpsApi.handle(request, call)` (named entrypoint, RPC) | `microns-site` through the service binding `OPS` | The site resolves the endpoint and action, runs the gate and sends the verified principal and the function URL in `call` (`OpsCall`, `workers/shared/src/http/rpc.ts`). Ops reads the principal from `call` only, never from a header |
| `MailIngest.startIntake`, `MailIngest.ingestReply` (named entrypoint, RPC; Phase 4) | `microns-mail` through its service binding `OPS` | Ids only (`v`, inbound e-mail id, message hash, tenant); the row is read from the database here |
| default `fetch` | MCP clients on the Custom Domain `mcp.micronshub.eu` (Phase 4); nobody else (`workers_dev` and `preview_urls` are off) | Host `MCP_HOSTNAME` → remote MCP (`src/mcp/`); every other host 404 with no body |
| default `queue` | queues `scrapes`, `cad-jobs`, `agent-events` | By `batch.queue`; on `scrapes` a `directory-scan` envelope goes to the scrapers module, every other message to the Phase 2 consumer (below) |
| default `scheduled` (Phase 4) | crons `* * * * *` and `*/10 * * * *` | Flag mirror tick; dispatcher (Gmail poller, orphan inbound rows, portal orders, parked runs, old failure cards, stuck CAD jobs) |

| Check in `OpsApi.handle` / the app | Answer |
|---|---|
| `call.v` is not `1`, the function URL is not a path, or the principal class is unknown | 500 `text/plain` |
| A request reaches the app without a registered call | 500 `text/plain` |
| No route for the function path | 404 `text/plain` |
| A handler throws before it answers (not an `ApiError`) | 500 `text/plain` "Internal Server Error" |
| A handler does not answer within 300 s | 504 `text/plain` "Gateway Timeout" |

A breaking change of `OpsCall` adds a new version number, and ops accepts both versions for one release (deploy ops first).

| Log line | Fields |
|---|---|
| `[microns-ops] api …` (one per call) | `endpoint`, `action`, `status`, `ms`, `principal` (class only), `requestId`; never a query string, header, body or e-mail address |
| `[microns-ops] handler failed …` | `endpoint`, `action`, `requestId`, then the error |
| `action` in both | A sentinel (`#…`) or a value of at most 40 characters from `[a-z0-9-]`; anything else is written as `invalid` (the same rule as the site's log lines) |

## Routes

Every route is `app.all(<function path>)`, so `OPTIONS` and every method reach the handler, as on Vercel. Modules load lazily on the first request of their route, so a module-scope failure answers 500 on that route only.

| Function path | Module | Notes |
|---|---|---|
| `/api/marketing` | `api/marketing.js` | `call.action` `webhook` → `src/routes/marketing-webhook.ts` (signature checked on the raw bytes first); `google-auth` → `src/routes/google-auth.ts`; anything else (`apollo-enrich`, sentinels) → the handler |
| `/api/notifications` | `api/notifications.js` | `partner`, `production-status`, `nest`, every `inv-*`; `qrcode` resolves to its server build through the wrangler `alias` |
| `/api/gsc` | `api/gsc.js` | The handler's own admin check still runs |
| `/api/tenders` | `api/tenders.js` | `/api/connector-status` arrives as `/api/tenders?…connectors=true` |
| `/api/tender-scan` | `api/tender-scan.js` | MACHINE principal + POST → queued answer (below); every other caller synchronous |
| `/api/funded-startups` | `api/funded-startups.js` | Synchronous for every caller |
| `/api/scrape-website`, `/api/scrape-company-profile` | as named | — |
| `/api/scan-directory` | `api/scan-directory.js` | — |

## Queue `scrapes`

| Item | Rule |
|---|---|
| Producer | `/api/tender-scan` for a MACHINE principal with POST. The request is validated as the handler validates it (missing `country_code` → 400, unknown code → 400 with the handler's bodies; other malformed bodies run the handler synchronously); only valid jobs are queued |
| Immediate answer | 200 with the handler's CORS headers: `{"success":true,"country_code":"<CC>","tenders_found":0,"tenders_new":0,"tenders_relevant":0,"errors":[],"duration_ms":0,"queued":true,"run_id":"<uuid>"}` |
| Message | `{v: 1, kind, params, run_id, enqueued_at, requested_by}` (`src/queues/messages.ts`), JSON, under 128 KB |
| Kinds | `tender-scan` → `api/tender-scan.js`, `funded-scan` → `api/funded-startups.js` (no producer yet) |
| Consumer | Synthetic `POST /api/<function>` with the params as JSON through the same handler, deadline 840 s |
| Outcome | Status below 500 → ack; 5xx, timeout (504) or a throw → retry after 300 s; after 3 retries → `scrapes-dlq`. An invalid message runs nothing and is retried the same way, so it ends in `scrapes-dlq` |
| Log | `[microns-ops] scrapes <kind> country_code=… status=… found=… new=… relevant=… run_id=… attempts=… outcome=…` |

## Configuration (`wrangler.jsonc`)

| Name | Kind | Value / source |
|---|---|---|
| `SUPABASE_URL`, `SITE_ORIGIN` | var | in `wrangler.jsonc` |
| `SCRAPES` | queue producer | queue `scrapes` (consumer: batch 1, concurrency 2, 3 retries, 300 s delay, DLQ `scrapes-dlq`) |
| `limits.cpu_ms` | limit | 300,000 (requests and consumer; `nest` on large orders needs more than the default) |
| Phase 4 bindings and vars | see `wrangler.jsonc` and "Phase 4: agent layer" below | KV `FLAGS`, R2 `PRIVATE_FILES`, queues `cad-jobs` and `agent-events`, three Workflows, three Durable Objects (tag `v1`), Vectorize `QUOTES_INDEX`, `AI`, `BROWSER`, `EVENTS`, `MCP_RATE_LIMIT`, the `mcp.micronshub.eu` Custom Domain, twelve vars; every one optional in `OpsEnv` and checked where used |
| `AI_GATEWAY_TOKEN`, `CAD_UNFOLD_URL`, `CAD_SHARED_SECRET`, `AGENT_APPROVAL_SECRET`, `CAD_ACCESS_CLIENT_ID`, `CAD_ACCESS_CLIENT_SECRET` | secret (Phase 4, optional, not in `secrets.required`) | `npx wrangler secret put <NAME>`; a missing one fails only the step that needs it (`config_missing`) |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `APOLLO_API_KEY` | secret (`secrets.required`) | `npx wrangler secret put <NAME>` in this folder; locally `.dev.vars` (template `.dev.vars.example`, dummy values) |

The repository is public: secret values never go into a file of this folder.

## Run

From the repository root, after `npm ci`:

| Task | Command (in `workers/ops`) |
|---|---|
| Install | `npm --prefix ../shared ci && npm ci` |
| Typecheck | `npm run typecheck` |
| Unit tests (T1, Node) | `npm test` |
| Bundle check (dry run, metafile, `qrcode` check, size) | `npm run build:dry` |
| Local run alone | `cp .dev.vars.example .dev.vars && npm run dev` (port 8788; RPC only, so normally run with the site: `npm --prefix ../site run dev:all`) |
| Integration tests (T2, workerd, both Workers) | `npm run test:integration` (uses the harness of `workers/site/test/integration`) |
| Nest fixture | `node scripts/nest-fixture.mjs <80\|400\|800\|1200> [balanced\|best] > nest.json` (request body for `/api/notifications`) |

## Deploy

| Step | Rule |
|---|---|
| Order | Ops first, then the site (the site's binding targets the ops deployment) |
| Command | `wrangler deploy` (workflow `.github/workflows/cf-ops.yml` with `deploy: true`), not `wrangler versions upload`: a service binding reaches the current deployment only |
| Before the first deploy | `npx wrangler queues create scrapes`; every name of `secrets.required` set with `npx wrangler secret put` (the first `put` creates the Worker) |
| CI | `cf-ops.yml` runs on manual dispatch only: install, typecheck, tests, dry run; deploy only when the input `deploy` is true |

## Status (2026-10-04, local)

Nothing is deployed. Phase 2 exit gate as a whole: `workers/site/README.md`, "Phase 2 exit gate".

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`) | exit 0 |
| T1 (`npm test`) | 10 files, 171 tests green |
| T2 (`npm run test:integration`) | 4 green: `inv-label` returns a PDF, `nest` with the 80-instance fixture returns `groups`, a machine `tender-scan` gets the queued answer, site → ops RPC with a STAFF caller |
| Dry run (`npm run build:dry`) | 3,743.75 KiB, gzip 725.78 KiB; `qrcode` resolves to `lib/server.js` |
| `cf-ops.yml` | The only trigger is `workflow_dispatch` (YAML check) |

## Owner items (Phase 2)

| Item | Detail |
|---|---|
| Queue | `npx wrangler queues create scrapes` before the first deploy (`scrapes-dlq` is created automatically) |
| Secrets | Every name of `secrets.required` with `npx wrangler secret put`; `RESEND_WEBHOOK_SECRET` is a test signing secret in Phase 2 (the real Resend endpoint is pointed at `www` at Phase 3 S11); `GOOGLE_REDIRECT_URI` = `https://www.micronshub.eu/api/marketing?action=google-auth&step=callback`, registered in Google Cloud |
| Deploy | `cf-ops.yml` with `deploy: true` (or `npx wrangler deploy` here), before the site preview |
| `nest` CPU | Run the fixtures (80, 400, 800, 1,200 part instances) through the preview and read the CPU per invocation from the Workers Logs of `microns-ops`; decide whether a Container is needed (PLAN.md §5.2 D-6). CPU limits are not enforced locally |
| Re-checks | Whether the callee's own `cpu_ms` governs an RPC call, the error on CPU exhaustion, version overrides on RPC (PLAN.md §5.2 D-15) |

## Phase 4: agent layer

The agent layer adds three Workflows (`RfqIntakeWorkflow`, `QuoteWorkflow`, `PostOrderWorkflow`), three Durable
Objects (`RfqThread`, `MaterialStock`, `CadRouter`, migration tag `v1`), the named entrypoint `MailIngest` (RPC
target of `microns-mail`), the queues `cad-jobs` and `agent-events`, the crons `* * * * *` (flag mirror) and
`*/10 * * * *` (dispatcher), the routes `/api/agent/*` and the remote MCP host `mcp.micronshub.eu`. Nothing of it
runs until its flag is on (`public.feature_flags`, mirrored to KV `FLAGS`; every flag is off at first).

### Rules

| Rule | Where |
|---|---|
| Every Phase 4 binding, var and secret is optional in `OpsEnv` and checked where it is used (`need()`): a missing name fails that step with `config_missing`, never an unrelated request or deploy | `src/env.ts`, `src/agents/config.ts` |
| Every external effect (LLM, embeddings, Vectorize, CAD, browser, Resend, Telegram, Gmail, Supabase, R2, Analytics Engine, clock) goes through a port; `makePorts(env)` builds the production adapters, or the stub adapters named in `AGENT_STUBS` (generated test configs only), and refuses `AGENT_STUBS` while `AI` or `QUOTES_INDEX` is bound | `src/ports/` |
| Agent flags are read from KV with `cacheTtl` 30 s and fail closed (missing, malformed or unreadable = off) | `src/agents/flags.ts` |
| Every run has one `agent_runs` row (`rpc/agent_run_begin`), closed with status, usage and `cost_cents` (> 0 whenever an LLM call was made); a failed Workflow run waits on a failure card (Retry restarts from the failed step, Dismiss closes it) | `src/agents/runs.ts` |
| LLM calls: Anthropic Messages API through the AI Gateway (provider-native endpoint, keys stored in the gateway, `cf-aig-authorization`, five metadata keys, payload logging off); `extract` = Sonnet 5.5 with server-side refusal fallback, `classify` = Haiku 4.5; structured outputs only | `src/agents/gateway.ts`, `src/ports/llm.ts`, `src/agents/prices.ts` |
| Approvals: single-use tokens, only their SHA-256 stored; one decision path `decide()` for the dashboard (hash under a staff JWT), the Telegram relay (raw token, signed request) and MCP | `src/agents/approval.ts`, `src/agents/decision.ts`, `src/routes/agent.ts` |
| Prompts: files `src/agents/prompts/<agent>/<step>.v<N>.md` + `.schema.json`, released files frozen by `LOCK.json`; the module that runs a prompt registers its two files with `registerPromptSource()` | `src/agents/prompts/registry.ts` |

### Run and test

| Task | Command (in `workers/ops`) |
|---|---|
| Unit tests (T1) including the agent layer | `npm test` (kernel: `npx vitest run test/kernel`) |
| Integration tests, profile `agents` (site primary, ops and mail as secondary Workers, provider stubs, mini-PostgREST) | `npm run test:integration:agents` |
| Offline evaluation of the prompts (replay, no network) | `npm run eval:synthetic` (details: `eval/README.md`) |
| Live evaluation (owner only, real gateway, private golden set) | `npm run eval:live` (`eval/README.md`, `scripts/eval/README.md`) |
| Bundle check with the Phase 4 rules | `npm run build:dry` (`CHECK_BUNDLE_PHASE=2 node scripts/check-bundle.mjs` runs the Phase 2 rules only) |
| Quote PDF samples, MCP parity (opt-in) | `npm run pdf:samples`, `npm run mcp:parity` |

### Owner order (after the Phase 4 code is merged)

Resources before the first ops deploy with this `wrangler.jsonc`: queues `cad-jobs` and `agent-events`; Vectorize
index `quotes-v1` (1,024 dimensions, cosine) with its metadata indexes created before any insert; the `FLAGS` KV
namespace id of microns-site in place of `<KV_ID_FLAGS>`; the zone for the `mcp.micronshub.eu` Custom Domain; the
AI Gateway `microns` with authentication on before a provider key is stored. Then the migration
(`supabase/migrations/*_agent_layer.sql`, dry run with `ROLLBACK` first), the optional secrets
(`AI_GATEWAY_TOKEN`, `CAD_UNFOLD_URL`, `CAD_SHARED_SECRET`, `AGENT_APPROVAL_SECRET`), the deploy (ops, then mail,
then the site) and the flags stage by stage. The full list with commands is the owner checklist of the Phase 4
build specification (summary: docs/migration/PLAN.md §5.4, "Owner steps").

### Status (2026-10-07, local)

Nothing is deployed. Phase 4 exit gate as a whole: docs/migration/PLAN.md §5.4, build record.

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`) | exit 0 |
| T1 (`npm test`) | 73 files, 1,159 tests green; 2 opt-in files (19 tests) skipped unless `PDF_SAMPLES=1` or `MCP_PARITY=1`; kernel suite 187/187 |
| T2, profile `api` (`npm run test:integration`) | 4 green, as at the Phase 2 close |
| T2, profile `agents` (`npm run test:integration:agents`) | 11 files, 46 tests green on two runs in a row (≈ 114 s each): kernel, flags, mail, intake, CAD, quote, replies, post-order, web, MCP, scrapers |
| Offline evaluation (`npm run eval:synthetic`) | 37 recorded cases, ok 97.3 %, field accuracy 97.6 %; the intake, quote and post-order prompts 100 %; the misses are the two sample cases built to show a misread field and a truncated answer (`eval/samples/`) |
| MCP parity (`npm run mcp:parity`, after `npm --prefix ../../mcp-server ci && npm --prefix ../../mcp-server run build`) | 3/3 |
| Dry run (`npm run build:dry`) | `index.js` 8,789.41 KiB (gzip 1,857.46 KiB), upload 9,657.36 KiB (gzip 2,307.86 KiB); one copy each of `pdf-lib`, `@supabase/supabase-js`, `zod`; Phase 2 and Phase 4 bundle rules pass |

Dependency rule: `npm audit` output for the pinned packages is reviewed before each deploy; the pins of `agents`, its MCP peers and `@cloudflare/puppeteer` move only by owner decision and with the parity and T2 suites green (PLAN.md §5.4 DF-49). The bundle holds two copies of `postal-mime` 2.7.4 (one through `resend` for the Phase 2 handlers, one for the agent mail parser); the bundle check allows it.

## Phase 5: consolidated compute

Phase 5 moves the scheduled Supabase and GitHub jobs into this Worker: the daily article, its translations, the
link fixes and the sitemap (`ContentDailyWorkflow`, `SitemapWorkflow`, queue `translations`), the Reddit, Hacker
News and tender collectors and the Xometry scan (queue `scrapes`, Phase 5 envelope), the campaign mail (queue
`outbound-mail`, Durable Object `SenderLimiter`, action `send-campaign` of `/api/marketing`), the weekly ops digest
(`OpsDigestWorkflow`) and the unfold service as a Container (`CadContainer`, migration tag `v2`). No new Cron Trigger:
a schedule table runs on the Phase 4 `* * * * *` tick. Every job stays off until its flag (or var) is switched on at
its switch-over step, so merging and deploying change nothing on their own.

### Rules

| Rule | Where |
|---|---|
| Every Phase 5 binding, var and secret is optional in `OpsEnv` and checked where it is used (`need()`); `secrets.required` is unchanged | `src/env.ts` |
| The schedule table: UTC 5-field expressions read by an own matcher (`*`, `*/n`, `a,b`, `a-b`; day of week 0 = Sunday); a slot `YYYY-MM-DDTHH:MMZ` is part of every run key and instance id; entries with an interval of at least 2 h also fire on a tick up to 60 min after a missed slot | `src/cron/schedule.ts` |
| The dispatcher reads the gate first (flag, or the var string `"true"`): a closed gate writes nothing; then it opens the run (`openRun`, trigger `cron`) or creates the Workflow instance, and sends the queue message; an existing run or instance is skipped; a failed send closes the run `failed` with `enqueue_failed`; it never throws | `src/cron/run-schedule.ts` |
| Scheduled collectors use their own envelope on `scrapes` (`P5ScrapeMessage`, kinds `reddit-tier`, `hn-scan`, `tender-scheduled`, `xometry-scan`), routed by kind in `src/index.ts` before the Phase 4 and Phase 2 consumers; `ScrapeMessage` and `src/queues/scrapes.ts` are unchanged | `src/queues/messages.ts`, `src/queues/scrapes-p5.ts` |
| Every external effect the Phase 4 ports do not cover goes through `P5Ports` (text LLM calls to Anthropic and Gemini through the AI Gateway, the collector sources, the Storage upload, the Gmail send, the Container, plain Telegram text); T2 points them at the stub with the `*_API_BASE`, `AGENT_GEMINI_BASE_URL` and `CAD_CONTAINER_BASE_URL` vars, and `makeP5Ports` refuses those vars while `AI` is bound | `src/ports/p5.ts` |
| T1 fakes of the Phase 5 ports and the test database with the Phase 5 tables and article-queue RPCs; nothing in the production code imports them | `src/ports/p5-stub/` |
| Bundle: none of the Phase 5 T2-only vars in the production `vars`; `@cloudflare/containers` bundled from exactly one copy (`workers/ops/node_modules/@cloudflare/containers/`, `dist/lib/container.js` once) | `scripts/check-bundle.mjs` |

### Run and test

| Task | Command (in `workers/ops`) |
|---|---|
| Unit tests (T1) of the Phase 5 kernel | `npx vitest run test/p5/kernel test/config.test.ts`; one unit: `npm test -- test/p5/<area>` |
| Integration tests, profile `jobs` (site primary and ops, the consumers `scrapes`, `translations`, `outbound-mail`, `cad-jobs`, every provider and source on the local stub, mini-PostgREST with the Phase 5 tables) | `npm run test:integration:jobs` (files `test/t2-jobs/p5-<area>.jobs.ts`) |
| Run the harness for manual checks | `node ../site/test/integration/harness.mjs up --profile jobs`; crons: `POST <url>/cdn-cgi/local/explorer/api/local/scheduled?worker=microns-ops` with `{"cron": "* * * * *", "scheduled_time": <epoch ms>}` |
| Bundle check with the Phase 2, 4 and 5 rules | `npm run build:dry` |

### Owner order

Before the first deploy with the Phase 5 configuration: the queues `translations`, `translations-dlq`,
`outbound-mail` and `outbound-mail-dlq`; the `SEO_CACHE` namespace id of microns-site in place of
`<KV_ID_SEO_CACHE>`; the Google AI Studio key stored in the AI Gateway; the Container image pushed and its reference
in `containers[0].image`; the optional secrets `INDEXNOW_KEY` and `XOMETRY_TOKEN`; the `CAD_INPUT_HOSTS` placeholder.
The switch-over runs one job at a time, at least 24 h apart, by flag values and the deactivation SQL; the full
checklist and runbook are the owner sections of the Phase 5 build specification (docs/migration/specs/PHASE5_SPEC.md,
§10).

### Status (2026-10-08, local; kernel only, the job units are still being built)

Nothing is deployed and no flag is set.

| Check | Result |
|---|---|
| T1 kernel (`npx vitest run test/p5/kernel test/config.test.ts`) | 11 files, 187 tests green, including a simulated week of minute ticks through the dispatcher |
| T2, profile `jobs`, kernel file (`npm run test:integration:jobs -- test/t2-jobs/p5-kernel.jobs.ts`) | 4 tests green: one run per due job from a fixed `scheduled_time`, the tender fan-out, the ops-digest instance, no second run for the same tick |
| T2, profiles `api` and `agents` with the Phase 5 configuration | green (4 and 46 tests) |
| Dry run (`npm run build:dry`) | builds with the `containers` stanza (no Docker needed); one copy of `@cloudflare/containers`; Phase 2, 4 and 5 bundle rules pass |
