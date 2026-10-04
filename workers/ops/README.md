# microns-ops

Cloudflare Worker for the API handlers that do not run in `microns-site`, and the consumer of the queue `scrapes`. Phase 2 of the Cloudflare migration (docs/migration/PLAN.md §5.2). The handlers in `api/*.js` and `lib/*` are unchanged; they run through the shared `@vercel/node` shim (`workers/shared/src/compat/vercel-node.ts`).

## How requests reach it

| Entry | Who calls it | Rule |
|---|---|---|
| `OpsApi.handle(request, call)` (named entrypoint, RPC) | `microns-site` through the service binding `OPS` | The site resolves the endpoint and action, runs the gate and sends the verified principal and the function URL in `call` (`OpsCall`, `workers/shared/src/http/rpc.ts`). Ops reads the principal from `call` only, never from a header |
| default `fetch` | nobody (`workers_dev` and `preview_urls` are off, no routes) | 404 |
| default `queue` | queue `scrapes` | One scan per message (below) |

| Check in `OpsApi.handle` / the app | Answer |
|---|---|
| `call.v` is not `1`, the function URL is not a path, or the principal class is unknown | 500 `text/plain` |
| A request reaches the app without a registered call | 500 `text/plain` |
| No route for the function path | 404 `text/plain` |
| A handler throws before it answers (not an `ApiError`) | 500 `text/plain` "Internal Server Error" |
| A handler does not answer within 300 s | 504 `text/plain` "Gateway Timeout" |

A breaking change of `OpsCall` adds a new version number, and ops accepts both versions for one release (deploy ops first).

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
