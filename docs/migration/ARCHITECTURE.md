# Microns Hub on Cloudflare: target architecture

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [README.md](README.md) · [PLAN.md](PLAN.md) · [INVENTORY.md](INVENTORY.md) · [inventory.csv](inventory.csv) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [SEO_PARITY.md](SEO_PARITY.md) · [AGENTS.md](AGENTS.md) · [RISKS.md](RISKS.md) · [COSTS.md](COSTS.md)

This file is brief §7 item 3: the target design (diagrams, Worker layout, bindings, R2 layout, Queues, Workflows, Durable Objects, AI Gateway routes, Access policies, hostnames, DNS/DNSSEC procedure). Tasks, gates and owners live in [PLAN.md](PLAN.md); agent behaviour in [AGENTS.md](AGENTS.md); the draft configuration in [wrangler.jsonc.draft](wrangler.jsonc.draft).

Evidence tags: `path:line` = this repository at commit `9afcba8`; "live 2026-09-30" = read-only re-capture of Supabase, Vercel and DNS; "CF docs (verified 2026-09-27)" = Cloudflare documentation checked during planning; "CF docs, re-check at execution" = not verified during planning; "list price, re-check at execution" = prices.

Security findings appear at summary level only. Details: private security note (delivered to the owner out of band, not in this public repo).

## 1. Decisions in one table

| # | Decision | Reason | Evidence |
|---|---|---|---|
| 1 | Three Workers (`microns-site`, `microns-ops`, `microns-mail`) and one Container app (`microns-cad`) | Blast radius, bundle size, deploy gating by the parity diff (§4) | H-18, H-27 |
| 2 | `microns-site` answers every request first (`run_worker_first: true`, `html_handling: "none"`) | Prerendered files must stay shadowed like on Vercel; no trailing-slash redirects | H-3, H-8; CF docs (verified 2026-09-27) |
| 3 | Shell via `env.ASSETS.fetch(new URL('/index.html', url))`, never a self-fetch | Workers refuse self-fetch; today middleware.ts:424 fetches its own origin | H-4 |
| 4 | Redirect table inside the Worker, not `_redirects` | 308 like Vercel, NFC-decoded matching, runs before the SEO handler | vercel.json:2-128; H-3, H-11 |
| 5 | `/api/*` split: browser-facing subset local, the rest over service binding `OPS` | Keeps `lib/inventory`, nesting, `@aws-sdk`-class code out of the SEO Worker | H-27 |
| 6 | Two R2 buckets, `microns-public` and `microns-private`; legacy S3 read-only | A public custom domain can never expose customer files; 755 persisted S3 image URLs | H-17; live 2026-09-30 |
| 7 | Workers Route (not Custom Domain) for `www` and `*.micronshub.eu` | Rollback is one record flip; Custom Domains do not support wildcards or existing CNAMEs | CF docs (verified 2026-09-27) |
| 8 | Supabase stays the system of record for Phases 0–6 | Brief §2 item 3; optional Phase 7 sketch in §22 | Owner decision 2026-09-30 |
| 9 | Agents are flag-gated Workflows and Durable Objects with Telegram and dashboard approval | Brief §4; every run is an `agent_runs` row | [AGENTS.md](AGENTS.md) |
| 10 | Every LLM call goes through AI Gateway `microns` with role-based routes | Cost per agent, rate limits, logs, BYOK | §13 |

## 2. Current state (live 2026-09-30)

```mermaid
flowchart LR
  U["Browsers, crawlers, e-mail clients"]
  subgraph PAPAKI["DNS at Papaki (dns1/dns2.papaki.gr, DNSSEC signed)"]
    DNS["micronshub.eu zone: apex A, www CNAME, wildcard CNAME, MX, TXT"]
  end
  subgraph VERCEL["Vercel project (Hobby)"]
    VMW["middleware.ts SEO engine"]
    VST["Static dist/ (SPA shell, 210 prerendered files)"]
    VAPI["12 Node functions api/*.js"]
  end
  subgraph SUPA["Supabase cfjrtmtaitwzggzpkhxi (eu-central-1)"]
    PG["Postgres + RLS, Auth, Realtime"]
    STO["Storage: 4 public buckets"]
    EF["40 deployed edge functions"]
    CRON["pg_cron: 10 jobs"]
  end
  VPS["VPS: sheet-metal-service (FastAPI + CadQuery)"]
  GHA["GitHub Actions: xometry-scan 7 runs per day, auto-merge-claude"]
  S3["AWS S3 eu-north-1: rfq and articles scopes"]
  RES["Resend (outbound mail)"]
  GWS["Google Workspace: apex MX, Gmail API senders"]
  TG["Telegram bots"]
  LLM["Anthropic and Gemini APIs"]
  U --> DNS
  DNS --> VERCEL
  DNS --> GWS
  VMW -->|"anon REST reads"| PG
  VMW -->|"fetch /index.html"| VST
  VAPI -->|"service-role writes"| PG
  VAPI -->|"presign"| S3
  VAPI --> RES
  VAPI --> TG
  VAPI -->|"sitemap blob"| STO
  CRON -->|"pg_net HTTP"| EF
  EF --> PG
  EF --> LLM
  EF --> RES
  EF --> TG
  EF -->|"UNFOLD_SERVICE_URL"| VPS
  VPS -->|"presigned GET"| S3
  GHA -->|"Postgres DSN upserts"| PG
  GHA -->|"push to main triggers deploy"| VERCEL
```

| Component | Where it runs today | Evidence |
|---|---|---|
| SPA, 210 prerendered files, SEO middleware, 12 API functions | Vercel project `prj_jsmi2AIFypu8dPv2AQBxyWyFhSKZ` (Hobby) | vite.config.ts:27-50; middleware.ts:682-687; live 2026-09-30 |
| Postgres, Auth, Realtime, Storage (4 public buckets), 40 edge functions, 10 pg_cron jobs | Supabase `cfjrtmtaitwzggzpkhxi`, eu-central-1 | live 2026-09-30 |
| `sheet-metal-service` (`/flat-pattern`, `/api/v1/unfold*`) | VPS, host not recorded in the repo (PLAN.md Q2) | sheet-metal-service/main.py:243, :445 |
| Xometry scanner | GitHub Actions, `0 6,8,10,12,14,16,18 * * *` | .github/workflows/xometry-scan.yml:21 |
| Files | AWS S3 eu-north-1 (`rfq`, `articles` scopes) + Supabase Storage | api/s3.js:33-65; live 2026-09-30 |
| LLM calls | Supabase edge functions direct to providers | supabase/functions/generate-daily-article/index.ts:184; supabase/functions/translate-article/index.ts:104 |

## 3. Target state (end of Phase 5)

```mermaid
flowchart TB
  U["Browsers, crawlers"]
  MAILIN["Inbound e-mail to rfq@ and replies@rfq.micronshub.eu"]
  CLAUDE["Claude clients (remote MCP)"]
  subgraph CF["Cloudflare account"]
    subgraph ZONE["Zone micronshub.eu"]
      RT["Workers Routes: www and wildcard"]
      RR["Single Redirect Rule: apex to www"]
      ER["Email Routing on rfq subdomain"]
      ACC["Access: preview, mcp, optional dashboard"]
    end
    SITE["microns-site: Static Assets, SEO handler, redirects, sitemaps, /api router"]
    OPS["microns-ops: Hono API, Cron Triggers, Queue consumers, Workflows, DOs, remote MCP, Browser Rendering, Analytics Engine"]
    MAIL["microns-mail: Email Worker"]
    CAD["microns-cad: Container app (CadContainer)"]
    KV["KV: SEO_CACHE, FLAGS"]
    R2P["R2 microns-public (files.micronshub.eu)"]
    R2X["R2 microns-private"]
    Q["Queues: cad-jobs, translations, outbound-mail, scrapes, agent-events (+ DLQs)"]
    WF["Workflows: rfq-intake, quote, post-order, content-daily, sitemap, ops-digest"]
    DO["Durable Objects: MaterialStock, RfqThread, SenderLimiter, CadRouter, MicronsMcp"]
    VEC["Vectorize quotes-v1"]
    AIG["AI Gateway microns (+ Workers AI)"]
  end
  SUPA["Supabase: Postgres, Auth, Storage, remaining edge functions"]
  RES["Resend"]
  GWS["Google Workspace: apex MX, Gmail API"]
  TG["Telegram bots"]
  LLM["Anthropic, Google AI Studio"]
  S3["AWS S3 legacy, read-only"]
  U --> RT
  U --> RR
  RT --> SITE
  CLAUDE --> ACC
  ACC -->|"mcp.micronshub.eu"| OPS
  MAILIN --> ER
  ER --> MAIL
  SITE -->|"service binding OPS"| OPS
  MAIL -->|"service binding OPS"| OPS
  SITE --> KV
  SITE -->|"PRIVATE_FILES"| R2X
  SITE -->|"anon REST reads"| SUPA
  SITE -->|"legacy reads"| S3
  MAIL --> R2X
  MAIL --> SUPA
  OPS --> KV
  OPS --> R2P
  OPS --> R2X
  OPS --> Q
  Q --> OPS
  OPS --> WF
  OPS --> DO
  DO -->|"CadRouter"| CAD
  CAD --> R2X
  OPS --> VEC
  OPS --> AIG
  AIG --> LLM
  OPS -->|"service-role"| SUPA
  OPS --> RES
  OPS --> GWS
  OPS --> TG
```

What stays outside Cloudflare: Supabase (system of record, Auth, the auth-bound edge functions listed in [PLAN.md](PLAN.md) §5.5), Resend, Google Workspace MX and Gmail API senders, Telegram bots, GA4/Google Ads tags in `index.html`, and the legacy S3 buckets (read-only).

## 4. Why three Workers and one Container app

| Option | Blast radius of an agent or API deploy | SEO Worker bundle | Deploy gating | CPU-heavy work | Verdict |
|---|---|---|---|---|---|
| One Worker (brief §3) | Any deploy can break SEO pages | ≈ 1.7 MB locale JSON + `@aws-sdk` + `pdf-lib` + nesting + agents | Every change needs the full parity run | Shares limits with page serving | Rejected |
| Site + one API Worker | API deploys isolated; agents still share the API Worker | Small | Parity only on site changes | Mixed with request handlers | Workable, but Cron/Queue/Workflow code would share the API deploy |
| **Three Workers + Container** | `microns-site` changes only for SEO/router/browser-API work; agents, crons and CAD deploy elsewhere | Small: SEO handler, redirects, sitemaps, thin local API | `microns-site` deploys only after parity = 0 unexplained diffs; `microns-ops`/`microns-mail`/`microns-cad` have their own tests | Container and DOs with raised `cpu_ms` | **Chosen** |

Rules that follow from the split:

| Rule | Detail |
|---|---|
| One repository, four folders | `workers/site`, `workers/ops`, `workers/mail`, `workers/cad`; one pinned `wrangler` version (H-23). Since Phase 2 also `workers/shared`: source-only code (the `@vercel/node` shim, HTTP helpers, auth and storage primitives) that both Workers import by relative path; each package keeps its own lockfile, the root lockfile is unchanged |
| Service binding, not public HTTP | `microns-site` and `microns-mail` call `microns-ops` through binding `OPS`; `microns-ops` has no public hostname except `mcp.micronshub.eu` |
| Contract between site and ops | RPC to the named entrypoint `OpsApi`: `handle(request, call)`. The request keeps method, path, query and body, without cookies, Access headers, `x-microns-*` and hop-by-hop headers; `call` carries the endpoint, action, function URL and the verified caller, and ops reads the caller only from `call`. The default `fetch` of `microns-ops` answers 404; ops never renders HTML |
| Independent rollback | `microns-site` rolls back by version (`wrangler rollback`) or record flip; agents by flag in KV `FLAGS`; ops by version |

## 5. Hostnames (canonical)

| Host | Today | Target (Phase 3) |
|---|---|---|
| `www.micronshub.eu` | Vercel (CNAME) | Workers Route `www.micronshub.eu/*` → `microns-site` on a proxied placeholder record (not a Custom Domain; rollback = record flip) |
| `micronshub.eu` (apex) | Vercel domain redirect to www (`redirectStatusCode: null` → status from baseline) | Single Redirect Rule → `https://www.micronshub.eu${path}${query}` with the status seen in the baseline |
| `*.micronshub.eu` | wildcard CNAME to Vercel (tenant subdomains) | proxied wildcard record + Workers Route `*.micronshub.eu/*` → `microns-site` (more specific routes win) |
| `files.micronshub.eu` | — | R2 custom domain for `microns-public` |
| `mcp.micronshub.eu` | — | Custom Domain → `microns-ops` (remote MCP), Access + OAuth |
| `api.micronshub.eu` | caught by wildcard CNAME | Machine-caller host for `tender-collector` and the local MCP server, served by `microns-site` behind Access application `microns-machine-api`; added to `API_MACHINE_HOSTS` by the Phase 3 runbook before the `www` flip ([PLAN.md](PLAN.md) §5.2 D-3) |
| `rfq.micronshub.eu` | caught by wildcard CNAME | Email Routing subdomain (MX/TXT added by CF); addresses `rfq@`, `replies@` → `microns-mail` |
| preview | — | `microns-site.<account>.workers.dev` + `wrangler versions upload --preview-alias staging`; Access (service token for CI tools); `X-Robots-Tag: noindex` on every non-production host |

| Hostname note | Detail | Evidence |
|---|---|---|
| Apex e-mail links | Sent e-mails embed apex URLs (`/api/marketing?action=track…`, `/logo.png`); the apex redirect must preserve path and query exactly | api/emails.js:165; supabase/functions/send-campaign/index.ts:8; H-24 |
| `rfq.` after Email Routing | Once MX/TXT exist at `rfq`, the wildcard CNAME no longer answers for that name; nothing browses `rfq.` today | live 2026-09-30 (wildcard answers `rfq.`) |
| `_vercel.` | Answered by the wildcard today; kept until Vercel is decommissioned (Phase 6) | live 2026-09-30 |
| Route precedence | Routes run in front of Custom Domains, so `*.micronshub.eu/*` would also catch `mcp.` and `files.`; at S11, routes `mcp.micronshub.eu/*` and `files.micronshub.eu/*` without a Worker are added (or the router passes those hosts through). `www.micronshub.eu/*` wins over the wildcard as the more specific pattern | CF docs (verified 2026-09-30, [wrangler.jsonc.draft](wrangler.jsonc.draft)) |
| `on-demand-craft-greece.vercel.app` | Duplicate host serving the same site; used only as the server-side target of the `/api` forward (var `API_FORWARD_ORIGIN` from Phase 2: the forward refuses its own host once `www` routes to the Worker), never linked | live 2026-09-30; [PLAN.md](PLAN.md) §5.2 |
| `api.` label | Reserved by the tenant resolver, so it never resolves to a tenant | src/utils/tenantApi.ts:29-51 (§15) |

## 6. `microns-site`

### 6.1 Static Assets configuration

| Setting | Value | Why | Evidence |
|---|---|---|---|
| `assets.directory` | `../../dist` (from `workers/site`) | Same Vite output as Vercel | vite.config.ts:27-50 |
| `assets.binding` | `ASSETS` | Shell and fallback fetches | H-4 |
| `html_handling` | `"none"` | Default `auto-trailing-slash` would 307 `/index.html` → `/` and `/en` → `/en/`; `none` serves exact file paths only | CF docs (verified 2026-09-27); H-10 |
| `not_found_handling` | `"single-page-application"` | Unknown paths get the shell with 200, as Vercel's `/(.*)` → `/index.html` rewrite | vercel.json:159-161; H-9 |
| `run_worker_first` | `true` | The Worker is the router for every path, as middleware + rewrites are on Vercel; can be narrowed to globs later for cost | CF docs (verified 2026-09-27); H-8 |
| `public/_redirects` | Deleted in Phase 1 | `/* /index.html 200` would be applied by the asset layer to every delegated request, including `/assets/*` | public/_redirects:1; H-3 |
| `compatibility_flags` | `["nodejs_compat"]`, `compatibility_date` `2026-09-01` (≥ 2025-04-01) | `Buffer`, `node:crypto`, `process.env` population for the shimmed handlers | H-20 |

### 6.2 Router order

| Step | Matches | Action | Why this position |
|---|---|---|---|
| 1 | Redirect table: 25 `vercel.json` sources + 3 client-only sources (src/components/SEORedirects.tsx:14-73), matched on the raw and the NFC-decoded pathname | 308 with the same `Location` as Vercel; the dead mojibake source (vercel.json:58-62) kept byte-identical; the 3 client-only entries become server 308s (documented parity deviation, [PLAN.md](PLAN.md) P1-5) | Some sources sit inside the language matcher (`/en/dawycena`, vercel.json:68-72); they must redirect before the SEO handler answers 200 |
| 2 | `/sitemap.xml`, `/sitemap-complete.xml`, `/sitemap-index.xml`, then `/sitemap-{lang}.xml`, and `/api/sitemap` | Port of `api/sitemap.js` (`type` = `main-index`, default, `index`, `lang`; api/sitemap.js:402-409); headers as api/sitemap.js:392-396; Cache API 1 h | Exact names are checked before the `{lang}` pattern because `index` and `complete` also match it (Vercel evaluates the rewrites in order, vercel.json:131-145); H-12 |
| 3 | `/api/*` | Local handler, `OPS` RPC, or Vercel forward when flag `api.forward_to_vercel` is on or the path is outside the `/api` catalogue (§6.4) | Independent of HTML rendering; `/api/track` and `/api/connector-status` aliases resolved here (vercel.json:151-157) |
| 4 | `/{lang}` and `/{lang}/*` for the 14 languages (middleware.ts:682-687) | SEO handler: copy of the `middleware.ts` orchestrator; `middleware/*` imported unchanged | H-8: the 210 prerendered files differ from the injected shell (Helmet head, `og:locale` `en`, no `#seo-content`) and must never be served for language routes; `src/main.tsx:7` renders without hydration |
| 5 | `/laserkritis/`, `/zohoverify/` (only if the P0-3 baseline shows Vercel serving the directory index; var `DIRECTORY_INDEX_EMULATION`, `"true"` in Phase 1) | `env.ASSETS.fetch` of `<path>index.html` | `html_handling: "none"` serves exact file paths only |
| 6 | Everything else | `env.ASSETS.fetch(request)`: asset, or SPA shell 200 | Same as Vercel's filesystem + `/(.*)` fallback; `/` and unprefixed legacy routes stay 200 shells (H-9) |

Router rules (as built in Phase 1: `workers/site/src/index.ts`, `src/sitemap.ts`, `src/compat/vercel-shim.ts`):

| Rule | Detail | Why |
|---|---|---|
| Error policy | A throw in any step answers `500` `text/plain` (`Internal Server Error`), logged with the step and the path. One exception: a throw in step 2 on `/api/sitemap` is logged and the request continues to step 3 (Phase 1: the forward to Vercel). A `null` from step 4 is not an error: it continues to steps 5–6 exactly where middleware.ts returns `undefined`, including after a logged shell failure | Vercel answers a crashing Function (the `/sitemap*.xml` rewrites) or Middleware with a 5xx (`FUNCTION_INVOCATION_FAILED`, `MIDDLEWARE_INVOCATION_FAILED`), never the shell or the prerendered file (H-8; a non-XML `/sitemap*.xml` answer is a rollback trigger, [SEO_PARITY.md](SEO_PARITY.md) §10.3) |
| HEAD on static files | Steps 5–6 fetch the asset as GET, count the bytes as they stream (not buffered) and set `Content-Length`; `finalise()` drops the body. An answer without a body, or one that already has `Content-Length`, passes unchanged. SEO documents (step 4) get no `Content-Length` on HEAD: it is not compared, and Vercel's value is unknown | Under `wrangler dev` 4.145.0 workerd sends no `Content-Length` on HEAD, not even for `env.ASSETS`' own HEAD answer; Vercel sends the file size and the parity tool compares it on G8 #10 (`/occt-import-js.wasm`, 7,604,031 B). Re-check on the preview |
| Sitemap query merge | The rewrite destination's query (with the raw `:lang` capture) is overridden key by key by the request's query; the function's `req.url` lists the request's keys first, then the rewrite-only keys; keys and values are percent-decoded and re-encoded with `encodeURIComponent` (so `/sitemap-d%65.xml` reaches the function as `lang=de`). Two deliberate differences: a malformed escape stays raw instead of throwing, and a value splits at the first `=` only | Follows Vercel's reference router (`vercel dev`, vercel CLI 62.0.0); production behaviour is confirmed with G5 probes that carry a query in the P0-3 baseline |
| Function deadline | `api/sitemap.js` runs unchanged through a `(req, res)` shim with one 30 s deadline per invocation; a handler that has not called `res.end()` by then gets `504` `text/plain`. Work that continues after `res.end()` is not awaited; a later rejection is only logged | Vercel answers `FUNCTION_INVOCATION_TIMEOUT`; vercel.json sets no `maxDuration`, so the project's real limit is confirmed in the baseline |
| Sitemap edge cache | Cache API, 1 h, status 200 only, GET and HEAD share one entry (HEAD runs the GET logic); other methods skip the cache. A no-op on `*.workers.dev` | Vercel's `s-maxage=3600` (api/sitemap.js:392-396) |

SEO handler rules (step 4):

| Rule | Detail | Evidence |
|---|---|---|
| Shell source | `env.ASSETS.fetch(new URL('/index.html', url))`; a non-2xx is logged as an error and alerted, never replaced silently by another document | H-4; today middleware.ts:424-428 returns `undefined` on failure |
| Output headers | `Content-Type: text/html; charset=utf-8`, `Cache-Control: public, max-age=0, must-revalidate`, `X-Seo-Source: db\|i18n\|none`, byte-identical | middleware.ts:670-677 |
| Injection | Head rewrite, canonical, 15 hreflang, robots meta, `og:locale`, JSON-LD, visible `<article id="seo-content">` right after `<body>` with the inline MutationObserver | middleware/inject.ts:72-116 |
| Canonical base | `SITE_BASE` = `https://www.micronshub.eu`, imported unchanged, on every host (parity with tenant hosts, H-13, PLAN.md Q9) | middleware/types.ts:64 |
| Normalisation | Trailing and double slash handled as today (200, canonical without slash) | middleware.ts:334-346; H-10 |
| Supabase config | `SUPABASE_URL` var and `SUPABASE_ANON_KEY` secret; a missing key is logged as an error on every request, never replaced by an empty string | today middleware.ts:43, :103-109 |
| Soft 404 | 200 for unknown slugs through cutover; `SEO_STRICT_404` / flag `seo.strict_404` later | H-9; PLAN.md Q5 |
| Preview | `X-Robots-Tag: noindex` on `*.workers.dev` and `PREVIEW_HOSTNAMES`; never on hosts in the zone | §5; brief §6 |
| HEAD | Same status and headers as GET, no body, no `Content-Length`; compared by the parity tool | H-28 |

### 6.3 Request sequence for `/{lang}/…`

```mermaid
sequenceDiagram
  autonumber
  participant C as Client or crawler
  participant R as Workers Route www.micronshub.eu/*
  participant S as microns-site router
  participant T as Redirect table
  participant X as Sitemap routes
  participant P as /api router
  participant O as microns-ops (OPS)
  participant H as SEO handler
  participant A as env.ASSETS
  participant M as Isolate Map cache
  participant K as KV SEO_CACHE
  participant D as Supabase REST (anon)
  participant Y as Cache API
  C->>R: GET /{lang}/... (run_worker_first = true)
  R->>S: fetch(request, env)
  S->>T: 1. match raw and NFC-decoded path
  alt redirect source matched
    T-->>C: 308 Location (as vercel.json)
  else sitemap path
    S->>X: 2. /sitemap.xml, -complete, -index, -{lang}
    X->>Y: match(request)
    alt cache miss
      X->>D: Storage blob or REST fallback
      X->>Y: put (max-age 3600)
    end
    X-->>C: 200 application/xml
  else path starts with /api/
    S->>P: 3. /api/* router (gate first)
    alt browser-facing subset
      P-->>C: served locally
    else ops route
      P->>O: OPS RPC handle(request, call)
      O-->>C: response
    end
  else /{lang} or /{lang}/*
    S->>H: 4. SEO handler (ported middleware.ts)
    H->>A: fetch /index.html (never self-fetch)
    A-->>H: 200 shell (non-2xx is logged as an error)
    H->>M: get row (1 h, no-row result 30 s)
    alt isolate miss
      H->>K: get row (positives only, 1 h, 500 ms read limit)
      alt KV miss
        H->>D: service_pages, content_pages (2.5 s timeout, KV read included), articles
        D-->>H: rows
        opt row found
          H->>K: put row (1 h)
        end
      end
      H->>M: set row, or the no-row result for 30 s
    end
    H-->>C: 200 HTML, Cache-Control max-age=0, X-Seo-Source
  else directory index path
    S->>A: 5. /laserkritis/ or /zohoverify/ to index.html (if baseline shows it)
    A-->>C: 200 file
  else anything else
    S->>A: 6. env.ASSETS.fetch(request)
    A-->>C: asset, or SPA shell 200 (not_found_handling)
  end
```

### 6.4 `/api/*` split (12 endpoints, paths and query shapes unchanged)

Execution classes: **Local** = handled in `microns-site`; **OPS** = sent over the service binding (RPC) and answered by `microns-ops` within the request; **Queue** = `microns-ops` enqueues and answers at once; **Workflow** = starts or signals a Workflow instance; **Container** = work ends in `microns-cad`. Gates (Turnstile, Supabase JWT, Access service token, Svix, rate limits) are assigned per route in the private gate matrix (PLAN.md P2-7) and run in the `microns-site` router for both Workers; only the Svix check and the Google OAuth `state` check run in `microns-ops`, where their secrets live. Rows below are as built in Phase 2 ([PLAN.md](PLAN.md) §5.2 lists the deviations DV-1…DV-19).

| # | Endpoint | Actions (evidence) | Target | Class | Bindings / secrets used |
|---|---|---|---|---|---|
| 1 | `/api/emails` | `contact`, `email` (default), `rfq`, `rfq-pdf` (api/emails.js:367-376) | `microns-site`; Turnstile token in request header `X-Turnstile-Token` | Local | `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `API_RATE_LIMIT`, `API_RATE_LIMIT_MAIL` |
| 2 | `/api/s3` | `presign-upload`, `presign-download`, `delete`, `delete-folder`, `list` (api/s3.js:148-227) | `microns-site` files API (`workers/site/src/api/files.ts`, same statuses and bodies as api/s3.js): `rfq` scope → new objects in `microns-private` under `rfq/` + today's key, reads fall back to legacy S3, deletes and lists cover both stores; `articles` scope → legacy S3 until `files.micronshub.eu` serves `microns-public` (P3-6, D-17) | Local | `PRIVATE_FILES`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `LEGACY_S3_REGION`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY`, `API_RATE_LIMIT_BULK` |
| 3 | `/api/marketing` | `track` (pixel, click, unsubscribe; also `/api/track`, vercel.json:151-153) | `microns-site`, `api/marketing.js` unchanged, byte-identical responses (H-14) | Local | `SUPABASE_SERVICE_ROLE_KEY` |
| 3 | `/api/marketing` | `webhook`, `google-auth` (`authorize`, `callback`, `refresh`), `apollo-enrich` (api/marketing.js:56-68) | `microns-ops`; explicit `GOOGLE_REDIRECT_URI` replaces `VERCEL_URL` (api/marketing.js:47); Svix verification on the raw bytes (H-15) | OPS | `RESEND_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `APOLLO_API_KEY` |
| 4 | `/api/notifications` | `partner` (default), `production-status` (api/notifications.js:253-272) | `microns-ops`: `api/notifications.js` imports nesting and inventory at module scope (api/notifications.js:9-11), so no action can run in the site without them (DV-1) | OPS | `RESEND_API_KEY` |
| 4 | `/api/notifications` | 19 `inv-*` actions (lib/inventory/index.js:480-530) | `microns-ops` (keeps `lib/inventory`, `qrcode`, `pdf-lib` out of the site bundle); `qrcode` aliased to its server build | OPS | `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| 4 | `/api/notifications` | `nest` (api/notifications.js:266-267) | `microns-ops`, synchronous, `limits.cpu_ms` 300,000 (DV-4): the 50 s budget (lib/nesting/nester.js:286) never trips when deployed, because `Date.now()` advances only on I/O; an RPC rejection answers 504 JSON `TIMEOUT`; Container only if a real order exceeds the limit (D-6) | OPS (Container fallback) | — (H-18) |
| 5 | `/api/gsc` | `search-analytics`, `inspect-url`, `bulk-inspect`, `submit-indexing`, `sitemaps`, `monitored-urls` (api/gsc.js:193-212) | `microns-ops`, synchronous in Phase 2 (its own admin check still runs); `bulk-inspect` and `submit-indexing` batches move to Queue `scrapes` in Phase 5 (DV-3) | OPS (+ Queue from Phase 5) | `SUPABASE_SERVICE_ROLE_KEY` (the GSC client reads its Google credentials from the database today, api/_lib/gsc-client.js:4) |
| 6 | `/api/tenders` | GET list/filter/stats/CSV export, `connectors=true` (alias `/api/connector-status`, vercel.json:155-157), PATCH (api/tenders.js:3-5, :32, :122) | `microns-ops` | OPS | `SUPABASE_SERVICE_ROLE_KEY` |
| 7 | `/api/tender-scan` | POST scan (api/tender-scan.js:78); called by `tender-collector` (supabase/functions/tender-collector/index.ts:68) | `microns-ops`: a machine caller's POST is validated as the handler validates it, enqueued on `scrapes` and answered 200 at once with every key of today's body at zero plus `queued` and `run_id`; staff and dashboard callers run synchronously (DV-3) | Queue (machine) / OPS | `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SCRAPES` |
| 8 | `/api/funded-startups` | GET list, `stats`, `feeds`, `export`; POST scan; PATCH (api/funded-startups.js:36-46) | `microns-ops`; POST scan synchronous in Phase 2 (the queue kind `funded-scan` is built, no producer yet; DV-3) | OPS | `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| 9 | `/api/scrape-website` | POST (api/scrape-website.js:15) | `microns-ops`, ≤ 6 concurrent outbound connections | OPS | — |
| 10 | `/api/scrape-company-profile` | POST (api/scrape-company-profile.js:321) | `microns-ops`, ≤ 6 concurrent outbound connections | OPS | — |
| 11 | `/api/scan-directory` | POST (api/scan-directory.js:349) | `microns-ops`; Europages/wlw via Browser Rendering later (P4-10) | OPS | `BROWSER` (Phase 4) |
| 12 | `/api/sitemap` (+ `/sitemap*.xml`) | `main-index`, default, `index`, `lang` (api/sitemap.js:402-409) | `microns-site` (router step 2) | Local | `SUPABASE_ANON_KEY`; from Phase 5 `PRIVATE_FILES` (`sitemaps/…`) |
| — | Any `/api/*` with flag `api.forward_to_vercel` on (all paths, a path list, or preview / production hosts only), and any `/api/*` path outside the catalogue | Proxied unchanged, ungated, to `API_FORWARD_ORIGIN` (the Vercel deployment host); `/api/sitemap` stays local (router step 2) | Vercel | Rollback | KV `FLAGS`, var `API_FORWARD_TO_VERCEL` (fallback) |
| — | `/api/agent/decision` (new in Phase 4) | POST approve / confirm / reject from `ApprovalsPage`, `RfqInboxPage` and the Telegram relay ([AGENTS.md](AGENTS.md) §2.4) | `microns-ops` | Workflow (`sendEvent` / `terminate`) | `SUPABASE_SERVICE_ROLE_KEY` |

`/api` router rules (as built in Phase 2: `workers/site/src/api/{forward,resolve,router,ops-client}.ts`; detail in workers/site/README.md):

| Rule | Detail | Why |
|---|---|---|
| Order | Flag `api.forward_to_vercel` → catalogue lookup on the canonical spelling of the path → body buffered once → endpoint and action resolved with each handler's own precedence → names of the dispatch target checked → answers the handler gives before any side effect (`OPTIONS`, wrong method, unknown action, invalid body) dispatched ungated → gate → dispatch (local, `OPS`, forward) → one log line | The rollback flag stays ungated; parity of the handlers' own `OPTIONS` and error answers |
| Shim | Handlers run unchanged through `workers/shared/src/compat/vercel-node.ts` (`@vercel/node` 17.0.0 helper semantics, not Express), loaded with a lazy `import()` per route, so a module-scope failure answers 500 on that route only. Deadline 30 s in the site, 300 s in ops; a handler that has not ended answers 504 `text/plain` | api/emails.js:12 creates its client at module scope |
| Config per request | Every Phase 2 binding, var and secret is optional in the site `Env`; each dispatch target and each gate decision checks only the names it needs and answers 500 `text/plain` (log `api config missing: <NAMES>`) on the requests that need a missing one | A missing mail key never breaks tracking links |
| Body size | Above 4,718,592 bytes (4.5 MiB) → 413 `{"error":"payload_too_large"}` before any handler | Vercel's function payload limit; exact cut-off re-checked at P2-12 |
| Gate answers | 401 `unauthorized`, 403 `forbidden` or `turnstile_failed`, 429 `rate_limited` with `Retry-After: 60`, 503 `auth_unavailable` or `turnstile_unavailable` (fail closed), 415 `unsupported_media_type` and 400 `invalid_field` (JSON-only bodies with string fields on the gated e-mail and inventory write paths), data-rule codes per the private matrix | One JSON shape `{"error": "<code>"}` for every answer the Worker produces itself |
| Gate modes | `API_GATES_MODE`: `report` (log `gate would deny`, then allow) or `enforce` per gate class; a class not named enforces | Rollout without a code change (D-16) |
| Errors after the gate | `OPS` RPC rejection → 500 `text/plain`, for `nest` 504 `{"success":false,"error":"Nesting exceeded the time limit","code":"TIMEOUT"}`; forward failure → 502 `{"error":"upstream"}` | — |
| CORS | Phase 1 `finalise()` sets the vercel.json headers on every `/api/*` answer, including those from `microns-ops`; the allow-list mode (`workers/shared/src/http/cors.ts`) is built and tested, and wired after the Phase 3 observation window (D-9) | `OPTIONS` parity is a Phase 2 gate item |
| Logs | `[microns-site] api endpoint=… action=… actionId=… target=… status=… ms=… principal=<class> requestId=…`; the same `requestId` in `microns-ops`; never a token, cookie, body or e-mail address | One request traceable across both Workers |

Callers outside `/api/*` that reach Cloudflare compute: `extract-flat-pattern` and `generate-manufacturing-pdf` call `UNFOLD_SERVICE_URL` (supabase/functions/generate-manufacturing-pdf/index.ts:55), repointed in Phase 5 to `microns-ops`, which runs the job through `CadRouter` → `CadContainer` (Container class, `/flat-pattern` byte-identical, sheet-metal-service/main.py:445). `lib/inventory/cron-batch.js:7` documents `inv-cron-batch` as a cron target, but nothing schedules it today (live `cron.job`, 2026-09-30); it stays an on-demand OPS action unless the owner wants a Cron Trigger.

## 7. Bindings per Worker (canonical)

### 7.1 `microns-site`

| Kind | Name | Target / value |
|---|---|---|
| Assets | `ASSETS` | `directory` = `../../dist`, `html_handling: "none"`, `not_found_handling: "single-page-application"`, `run_worker_first: true` |
| KV | `SEO_CACHE`, `FLAGS` | SEO row cache; flag mirror |
| Service binding | `OPS` | `microns-ops`, named entrypoint `OpsApi` (RPC `handle(request, call)`) |
| R2 | `PRIVATE_FILES` | bucket `microns-private`, `"jurisdiction": "eu"` (RFQ uploads/downloads for the `/api/s3` replacement; code constant `R2_JURISDICTION` kept equal by a config test; D-1) |
| Rate limiting | `API_RATE_LIMIT` (30/60 s, namespace `2001`), `API_RATE_LIMIT_MAIL` (5/60 s, `2002`), `API_RATE_LIMIT_BULK` (300/60 s, `2003`) | Workers Rate Limiting API; MAIL for mail keys, BULK for idempotent reads and upload presigns; both fall back to `API_RATE_LIMIT` when absent |
| Vars | `SUPABASE_URL`, `SITE_ORIGIN` (= `https://www.micronshub.eu`), `PREVIEW_HOSTNAMES`, `SEO_STRICT_404` (= `"false"`), `DIRECTORY_INDEX_EMULATION`, `API_FORWARD_ORIGIN` (= `https://on-demand-craft-greece.vercel.app` from Phase 2), `API_FORWARD_TO_VERCEL` (= `"false"`), `R2_ACCOUNT_ID`, `LEGACY_S3_REGION` (= `eu-north-1`), `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `API_GATES_MODE`, `API_MACHINE_HOSTS` (= `""` in Phase 2) | `SITE_ORIGIN` replaces hardcoded origins in ported handlers (api/sitemap.js:26); legacy bucket names are vars, not constants in code (DV-10) |
| Secrets (names only) | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY`, `ACCESS_MACHINE_CLIENT_IDS` | Set with `wrangler secret`; appended to the P0-2 consumer checklist the day they are created |
| Flags | `compatibility_flags: ["nodejs_compat"]`, `compatibility_date` `2026-09-01` | H-20 |

Why `PRIVATE_FILES` and R2 S3 API keys both: presigned URLs need S3 API credentials (`aws4fetch` against the R2 S3 endpoint, `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` with the `eu` jurisdiction); the binding serves `head`, `list` and `delete`. In Phase 2 the `articles` scope presigns against legacy S3 with the same `LEGACY_AWS_*` pair; from P3-6 article uploads presign into `microns-public` with S3 API credentials for that bucket (the Phase 2 R2 token covers `microns-private` only), so the site needs no `PUBLIC_FILES` binding.

### 7.2 `microns-ops`

| Kind | Name | Target / value |
|---|---|---|
| Entrypoint | `OpsApi` (named `WorkerEntrypoint`) | RPC `handle(request, call)` from `microns-site`: checks `call.v`, takes the caller only from `call`, runs the Hono app; the default `fetch` answers 404 (Phase 2) |
| R2 | `PRIVATE_FILES`, `PUBLIC_FILES` | `microns-private` (`"jurisdiction": "eu"`, as every binding of it), `microns-public` (Phase 4–5) |
| KV | `FLAGS`, `SEO_CACHE` | Phase 4–5; `SEO_CACHE` keys purged on content publish. The Phase 2 ops Worker reads no flag |
| Queues (producer + consumer) | `cad-jobs`, `translations`, `outbound-mail`, `scrapes`, `agent-events` | each with DLQ `<name>-dlq` (§9) |
| Workflows | `rfq-intake` (`RfqIntakeWorkflow`), `quote` (`QuoteWorkflow`), `post-order` (`PostOrderWorkflow`), `content-daily` (`ContentDailyWorkflow`), `sitemap` (`SitemapWorkflow`), `ops-digest` (`OpsDigestWorkflow`) | §10 |
| Durable Objects | `MaterialStock`, `RfqThread`, `SenderLimiter`, `CadRouter`, `MicronsMcp`, `CadContainer` | §11 |
| Vectorize | `QUOTES_INDEX` | index `quotes-v1` (bge-m3, 1024 dims, cosine) |
| Workers AI | `AI` | AI Gateway id `microns` |
| Browser Rendering | `BROWSER` | Scrapers (Phase 4) |
| Hyperdrive (optional) | `SUPABASE_DB` | Only for bulk upserts such as `xometry_offers` |
| Analytics Engine | `EVENTS` | dataset `microns_events` |
| Custom Domain | `mcp.micronshub.eu` | Remote MCP (`MicronsMcp`) |
| Vars | `SUPABASE_URL`, `SITE_ORIGIN` (= `https://www.micronshub.eu`), `AI_GATEWAY_ID` (= `microns`) | Needed by the ported code and the gateway client (added in [wrangler.jsonc.draft](wrangler.jsonc.draft)) |
| Secrets (names only) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` (or AI Gateway BYOK), `GEMINI_API_KEY` (or BYOK), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GSC_SERVICE_ACCOUNT_JSON`, `APOLLO_API_KEY`, `XOMETRY_TOKEN`, `CAD_SHARED_SECRET`, `INDEXNOW_KEY`, `MCP_OAUTH_*` | `GSC_SERVICE_ACCOUNT_JSON` is a reserved name: today the GSC client reads its Google credentials from the database (api/_lib/gsc-client.js:4), so the secret is only needed if they move to a Worker secret |
| Flags and limits | `nodejs_compat`, same compatibility date as the site; `limits.cpu_ms` 300,000 (DV-4; applies to RPC calls and queue consumers alike); `alias` `qrcode` → `qrcode/lib/server.js` | H-18, H-20 |
| Phase 2 subset | Entrypoint, `SCRAPES` producer and consumer, the two vars, the ten Phase 2 secrets, `limits`, `alias`; `workers_dev` and `preview_urls` off, no routes. Deployed with `wrangler deploy` before the site (a service binding reaches the current deployment only), from `.github/workflows/cf-ops.yml` (manual dispatch) | workers/ops/wrangler.jsonc |

Binding variable names for Queues, Workflows and Durable Objects (for example `CAD_JOBS`, `RFQ_INTAKE`, `RFQ_THREAD`) are set in [wrangler.jsonc.draft](wrangler.jsonc.draft). Cron Triggers on `microns-ops` (UTC; Phase 5 unless stated):

| Schedule | Job | Replaces (live 2026-09-30) |
|---|---|---|
| `0 7 * * *` | `content-daily` Workflow (generate → translate → fix links → sitemap → IndexNow) | `enqueue-daily-article` 07:00, `process-article-queue` */5, `auto-translate-daily-articles` 08:00, `auto-fix-article-links` 08:30, `auto-update-sitemap` 09:00 |
| `*/15 * * * *`, `*/30 * * * *`, `0 * * * *` | Reddit tier1, tier2, tier3; HN on `*/30` → Queue `scrapes` | `reddit-tier1`, `reddit-tier2`, `reddit-tier3`, `hn-collector` |
| `0 6 * * *` | Tender collector → Queue `scrapes` | `tender-scan-daily` |
| `0 6,8,10,12,14,16,18 * * *` | Xometry scan (7×/day, PLAN.md Q8) | .github/workflows/xometry-scan.yml:21 |
| `30 6 * * 1` | `ops-digest` Workflow | — (new) |
| `* * * * *` | `feature_flags` → KV `FLAGS` sync (Phase 4) | — (new) |
| `*/10 * * * *` | Gmail reply poller for the 2 Workspace sender accounts (Phase 4) | `check-replies` (in the repo, not deployed) |

One `scheduled()` handler dispatches on `controller.cron`; per-Worker and per-account Cron Trigger limits are CF docs, re-check at execution (if a per-Worker cap applies, the jobs are collapsed onto fewer expressions and dispatched by time).

### 7.3 `microns-mail`

| Kind | Name | Target / value |
|---|---|---|
| Email handler | `email(message, env, ctx)` | Email Routing rules for `rfq@rfq.micronshub.eu` and `replies@rfq.micronshub.eu` |
| R2 | `PRIVATE_FILES` | `microns-private` |
| Service binding | `OPS` | `microns-ops` (starts `rfq-intake`, routes replies) |
| Vars | `ALLOWED_RCPT`; `SUPABASE_URL` | `rfq@rfq.micronshub.eu,replies@rfq.micronshub.eu`; project URL for the `inbound_emails` insert (added in [wrangler.jsonc.draft](wrangler.jsonc.draft)) |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | `inbound_emails` insert |

### 7.4 `microns-cad` (Container app)

| Item | Value | Evidence |
|---|---|---|
| Image | Built from `sheet-metal-service/Dockerfile` (`python:3.11-slim`, uvicorn on port 8000) | sheet-metal-service/Dockerfile:7, :34, :40 |
| Class | `CadContainer` (container-enabled DO class, bound from `microns-ops`) | [PLAN.md](PLAN.md) P5-6 |
| Front | `CadRouter` DO in `microns-ops`; shared secret `CAD_SHARED_SECRET`; enforced wall-clock (`PROCESSING_TIMEOUT` = 120 s is declared but not enforced today) | sheet-metal-service/config.py:37 |
| Size and scale | `standard-1` (½ vCPU, 4 GiB; `standard-2` if memory requires); `max_instances` 3 in the draft (= `cad-jobs` concurrency); `sleepAfter` ≈ 10 min; keep-warm ping in business hours; cold start 10–30 s | CF docs (verified 2026-09-27); plan §6 item 3 |
| Interface | Job in (`cad-jobs`) → artefacts to R2 `cad/<job_id>/output/…` → `cad_jobs` row; the Mac mini Fusion 360 worker can serve the same interface later over Tunnel (PLAN.md Q22) | brief §2 item 5 |
| Endpoints kept | `/flat-pattern` byte-identical; `/api/v1/unfold`, `/api/v1/unfold/preview`, `/api/v1/unfold/info`, `/health` | sheet-metal-service/main.py:243, :337, :377, :445, :712 |

## 8. Storage: R2 layout

Refinement against plan.md (which proposed one bucket `microns-files`): two buckets, so that a public custom domain can never expose customer files. Access to `microns-public` is by URL through `files.micronshub.eu`; `microns-private` has no public access at all.

| Bucket | Prefix | Content | Written by | Read by | Phase |
|---|---|---|---|---|---|
| `microns-public` | `articles/<yyyy>/<mm>/<slug>.<ext>` | New article images | `/api/s3` `articles` scope (presigned PUT) | Public via `files.micronshub.eu` | 3 (P3-6) |
| `microns-public` | `tenants/<slug>/…` | Tenant logos and assets | `microns-ops` / dashboard | Public | 4–5 |
| `microns-private` | `rfq/<rfqNumber>/<partFolder>/<safeName>` (`rfq/` + the key api/s3.js returns today) | RFQ files uploaded through `/api/s3`; the browser keeps today's key and `publicUrl`/`url` keep the legacy string format (DV-5, D-2) | `/api/s3` `rfq` scope (presigned PUT, 300 s, `Content-Type` signed) | Presigned GET; `CadRouter` | 2 |
| `microns-private` | `rfq/<rfq_id>/<file_id>-<name>` | E-mail attachments linked to an RFQ | `rfq-intake` step `copy-files` | Presigned GET or Worker-streamed; `CadRouter` | 4 |
| `microns-private` | `upload-counters/<folder>/…` | Per-folder count of upload URLs issued by the files API (advanced with a conditional write) | `/api/s3` `presign-upload` | Files API only | 2 |
| `microns-private` | `email/<message_id_sha256>/raw.eml` | Raw inbound MIME | `microns-mail` | `rfq-intake` Workflow | 4 |
| `microns-private` | `email/<message_id_sha256>/att/<n>-<name>` | Inbound attachments (STEP, STL, DXF, PDF) | `rfq-intake` step `store-attachments` | Workflows, dashboard | 4 |
| `microns-private` | `cad/<job_id>/input/…`, `cad/<job_id>/output/…` | Input prefix reserved (`CadRouter` streams inputs from `rfq/…`); outputs: `result.json`, PDF, DXF, SVG, log | `CadRouter` | `quote` Workflow, dashboard | 4–5 |
| `microns-private` | `quotes/<rfq_id>/v<version>/quote.pdf` | Issued quote PDFs | `quote` Workflow | Resend attachment, dashboard | 4 |
| `microns-private` | `orders/<order_id>/traveler.pdf` | Job travellers | `post-order` Workflow | Partner portal (presigned) | 4 |
| `microns-private` | `sitemaps/…` | Generated sitemap files (Phase 5 only) | `sitemap` Workflow | `microns-site` at the identical sitemap URLs | 5 |

| Topic | Rule | Evidence |
|---|---|---|
| Key hygiene | `<message_id_sha256>` because RFC Message-IDs contain `<`, `>`, `@`; `<name>` is sanitised; SHA-256 and content type stored as object metadata and in `rfq_files.sha256`, `rfq_files.content_type`, `rfq_files.r2_key` | [PLAN.md](PLAN.md) P4-1 |
| Presigning | `aws4fetch` against the R2 S3 API (`allHeaders` so `Content-Type` is signed; signatures equal `@smithy/signature-v4` in golden tests); PUT 300 s, GET 3,600 s by default (at most 604,800 s); bucket CORS for browser PUT from `www` and the preview hosts from `workers/site/r2/cors.private.json` (P2-9) | brief §3; workers/shared/src/storage/s3-presign.ts |
| Legacy S3 | AWS S3 buckets (eu-north-1, `rfq` and `articles` scopes) keep the existing keys and the 755 `*.amazonaws.com` article image URLs: no new `rfq` uploads (reads, lists and deletes through the files API); article uploads stay there until P3-6 (D-17) | api/s3.js:33-65; live 2026-09-30; H-17; PLAN.md Q11 |
| Rollback copy | `scripts/r2-to-legacy-s3.mjs` (owner-run, dry run by default, `--since`, `--execute`) copies `rfq/<key>` from R2 to the legacy `rfq` bucket under `<key>` with the owner's own credentials | PLAN.md §5.2 rollback |
| Split brain today | RFQ uploads go to S3 but downloads read the public Supabase bucket `rfq-files`; the files API serves both during the overlap | src/components/rfq/RfqFileDownload.tsx:47, :100; sheet-metal-service/config.py:10 |
| Supabase Storage | `quote-files` (0 objects), `rfq-files` (3), `sitemaps` (17, 6.76 MB), `tenant-laserkritis` (0), all public; unchanged until Phase 5/6 | live 2026-09-30 |
| Retention and residency | Proposal: lifecycle rule deletes `email/` objects after 90 days (RFQ-linked files are copied to `rfq/…`); `microns-private` is created with jurisdiction `eu` at P2-9 (only possible at creation; every binding and the S3 endpoint carry it; D-1) | [AGENTS.md](AGENTS.md) §2.6 |
| Message size | Queue messages carry R2 keys, never file bodies | §9 |

## 9. Queues

All queues are produced and consumed by `microns-ops`; binding variable names and the exact consumer settings are in [wrangler.jsonc.draft](wrangler.jsonc.draft), message contracts in [AGENTS.md](AGENTS.md). Every message carries `run_id` (the `agent_runs` row) and an idempotency key; consumers are idempotent on it. Values are starting points, tuned when each consumer ships (queue defaults: batch 10, timeout 5 s, 3 retries; a consumer invocation keeps at most 6 connections open; CF docs, verified 2026-09-30 per [wrangler.jsonc.draft](wrangler.jsonc.draft)).

| Queue | Producers | Consumer | Message shape (sketch) | Batch size | Max retries | Concurrency | DLQ | Phase |
|---|---|---|---|---|---|---|---|---|
| `cad-jobs` | `rfq-intake`, `quote` Workflows; dashboard re-run | `CadRouter` → backend (existing unfold service until Phase 5, then `CadContainer`) | `{v, job_id, idempotency_key, job_type: "analyse" \| "drawing_pdf" \| "flat_dxf" \| "flat_svg", tenant_id, rfq_id, rfq_file_id, input: {r2_key, sha256}, params, backend: "auto", deadline_s, reply: {workflow, instance_id, event_type}, run_id}` | 1 | 2 | 3 (= `max_instances`) | `cad-jobs-dlq` | 4 |
| `translations` | `content-daily` Workflow (13 languages per article, plus backfill) | Translation via AI Gateway route `translate` | `{article_id, translation_id, target_lang, idempotency_key: "<translation_id>:<language>", run_id}` | 1 | 5 (retry delay 120 s) | 3 | `translations-dlq` | 5 |
| `outbound-mail` | `send-campaign` port (one message per campaign recipient) | `SenderLimiter.acquire` → Resend or Gmail API | `{campaign_id, recipient_id, sender_account_id, provider: "resend" \| "gmail", template_id, idempotency_key, run_id}` | 10 | 3 | 2 | `outbound-mail-dlq` | 5 |
| `scrapes` | Phase 2: `/api/tender-scan` POST from a machine caller only (answered 200 with `queued` and `run_id`; DV-3). Later: `/api/funded-startups` POST, `/api/gsc` bulk actions (Phase 5), collector Cron Triggers, directory scans | Scan and collector handlers, run unchanged through the shim (synthetic `POST /api/<function>`, deadline 840 s); status < 500 → ack, 5xx, timeout or throw → retry after 300 s | `{v: 1, kind: "tender-scan" \| "funded-scan" (built in Phase 2) \| "gsc-bulk-inspect" \| "gsc-submit-indexing" \| "reddit" \| "hn" \| "tenders" \| "directory", params, run_id, enqueued_at, requested_by}` (in Phase 2 `run_id` is a UUID, not yet an `agent_runs` row) | 1 | 3 (retry delay 300 s) | 2 | `scrapes-dlq` | 2 (machine tender scans); 4–5 (collectors, funded scan, GSC) |
| `agent-events` | `microns-ops` for `microns-mail` replies (`replies@`, via `OPS`), Workflows, Durable Objects | Reply attribution, Telegram cards, `EVENTS` data points | `{type: "inbound-reply" \| …, inbound_email_id?, rfq_id?, order_id?, payload, run_id}` | 25 (timeout 10 s) | 3 | default | `agent-events-dlq` | 4 |

DLQ handling: DLQs have no consumer; the weekly ops digest lists their backlog and re-drive is a manual task ([AGENTS.md](AGENTS.md) §2.5).

## 10. Workflows

Event `type` names use only letters, digits, `-` and `_` (CF docs, verified 2026-09-27); `waitForEvent` defaults to 24 h and allows up to 365 d; events sent before the step is reached are buffered. Human waits are 7 d, then a reminder with a new approval token, then 7 d more; afterwards the item is `needs_review` or `expired`. Instance ids are deterministic, so a repeated start is a no-op (length limit: CF docs, re-check at execution). Full step lists: [AGENTS.md](AGENTS.md) §3.

| Workflow (class) | Trigger | Instance id (idempotency) | Main steps | Events waited for | Flag | Phase |
|---|---|---|---|---|---|---|
| `rfq-intake` (`RfqIntakeWorkflow`) | `microns-mail` via `OPS`; dashboard re-run | `rfq-intake-<first 32 hex of message_id_sha256>` (SHA-256 of the RFC `Message-ID`, or of the raw MIME if missing) | load e-mail → store attachments → triage (`classify`) → thread check (`RfqThread`) → extract (`extract`) → classify CNC vs sheet metal (`classify`) → confirmation if confidence < 0.7 → create RFQ (`rfqs` with `parts_details`, `source`, `inbound_email_id`) → copy files to `rfq/…` + `rfq_files` → enqueue `cad-jobs` → start `quote` | `intake-confirmed` | `agent.rfq_intake` | 4 |
| `quote` (`QuoteWorkflow`) | End of `rfq-intake`; "Start quote" on the dashboard (web RFQs too) | `quote-<rfq_id>-v<quote_version>` | load → await CAD → drawing and flat jobs → similar quotes (`embed` + `quotes-v1`) → deterministic price from `pricing_rules` and material prices → price notes and cover e-mail (`extract`) → draft PDF → approval → send via Resend (`Reply-To: replies@rfq.micronshub.eu`) → follow-ups → classify reply (`classify`) → close | `cad-done` (2 h), `quote-approved`, `customer-reply` (3 d, 4 d, 7 d follow-up cadence), `reply-confirmed` | `agent.quote` | 4 |
| `post-order` (`PostOrderWorkflow`) | Order won in `quote`, portal acceptance, or "Start handoff" | `post-order-<order_id>` | load → traveller notes (`extract`) → traveller PDF to `orders/…` → `MaterialStock.reserve` → handoff approval → partner hand-off → reorder draft (`extract`) → reorder approval → close | `handoff-approved`, `reorder-approved` | `agent.post_order` | 4 |
| `content-daily` (`ContentDailyWorkflow`) | Cron `0 7 * * *`; manual "Run now" | `content-daily-<yyyy-mm-dd>` | pick title (logic of `enqueue_next_article()`) → generate English article (`extract`) → fan out 13 `translations` messages → wait → fix links → start `sitemap` → IndexNow → purge `SEO_CACHE` keys → close | `translations-done` (6 h; timeout continues with the languages present) | `agent.content_daily` | 5 |
| `sitemap` (`SitemapWorkflow`) | `content-daily` step; manual | `sitemap-<yyyy-mm-dd>` | build URL set from the database (port of `generate-sitemap`, with its regression guard) → write `sitemaps/…` to `microns-private` → upsert `gsc_monitored_urls` | — | (covered by `agent.content_daily`) | 5 |
| `ops-digest` (`OpsDigestWorkflow`) | Cron `30 6 * * 1`; manual "Send now" | `ops-digest-<yyyy>-W<ww>` | collect week figures → stuck items and DLQ backlog → narrative (`extract`) → send via Resend + Telegram line → optional Google Ads conversions (PLAN.md Q21) → monthly retention purge | — | `agent.ops_digest` | 5 |

Every Workflow writes its outcome to `agent_runs` (pg_cron outcomes are unobserved today because of the 5 s `pg_net` timeout, H-29). Step retries are set per step (LLM steps: 3 retries, exponential back-off); gateway-level retries stay off so that retries do not multiply.

## 11. Durable Object classes

| Class | Key (`idFromName`) | State | Methods | Why a Durable Object |
|---|---|---|---|---|
| `MaterialStock` | `<tenant_id>:<material_id>` (one per material / stock key) | Idempotency map and cache of holds; rebuilt from `stock_reservations` | `reserve(order_item_id, need)` (idempotent on `order_item_id`), `commit()`, `release()`, `check()`; daily alarm `expireHolds()`; writes `stock_reservations` and `stock_transactions` (`reserve`/`unreserve`) | Single writer per material prevents double booking; nothing reserves stock today. Supabase stays the record, the DO is the serialisation point ([AGENTS.md](AGENTS.md) §6) |
| `RfqThread` | `<rfq_id>` | Message-IDs of inbound and outbound mail, CAD job states, Workflow instance ids | Append mail and files; resolve replies; send `cad-done` when all CAD jobs of the RFQ are final | Serialises concurrent mails and job results on one RFQ; routes events to the right Workflow instance |
| `SenderLimiter` | `<sender_account_id>` | Token bucket, daily count, warm-up ramp, pause flag | `acquire(n)` → granted or retry-after; `report(result)`; `pause()`, `resume()` | One rate per sender across concurrent queue consumers (2 Workspace sender accounts, live 2026-09-30) |
| `CadRouter` | `global` | In-flight jobs, backend health, keep-warm schedule | `submit(job)`: reads the input from R2 and streams it to the backend, writes outputs to `cad/<job_id>/output/`, updates `cad_jobs`; alarms for wall-clock time-outs and keep-warm | Jobs are synchronous and single-worker, so concurrency = instances; one coordinator enforces the shared secret and hard time-outs ([AGENTS.md](AGENTS.md) §5) |
| `MicronsMcp` | Per MCP session (Agents SDK `McpAgent`) | Session, authorised identity and scopes | MCP tools: the 39 tools of the local server plus RFQ, quote, order, inventory and agent-run tools | The Agents SDK runs each MCP session in a Durable Object; P4-11 confirms `McpAgent` vs the stateless handler before the first deploy ([AGENTS.md](AGENTS.md) §3.7) |
| `CadContainer` | Instance slot (up to `max_instances` 3) | Container lifecycle (runtime-managed) | `fetch` proxied to port 8000 | Containers are addressed and lifecycle-managed through a container-enabled DO class |

## 12. RFQ intake and quote flow

```mermaid
sequenceDiagram
  autonumber
  participant E as Sender or Techpilot forward
  participant ER as Email Routing (rfq subdomain)
  participant ML as microns-mail
  participant R2 as R2 microns-private
  participant SB as Supabase (service role)
  participant OP as microns-ops (OPS)
  participant WI as rfq-intake Workflow
  participant TH as RfqThread DO
  participant AG as AI Gateway microns
  participant TG as Telegram bot
  participant Q as cad-jobs Queue
  participant CR as CadRouter DO
  participant CC as CadContainer
  participant WQ as quote Workflow
  participant VZ as Vectorize quotes-v1
  participant RS as Resend
  E->>ER: mail to rfq@rfq.micronshub.eu
  ER->>ML: email(message)
  ML->>R2: put email/{sha256}/raw.eml
  ML->>SB: insert inbound_emails (unique message_id_sha256)
  ML->>OP: start rfq-intake-{sha32}
  OP->>WI: create instance
  WI->>R2: put email/{sha256}/att/{n}-{name}
  WI->>AG: classify route (triage, language)
  WI->>TH: thread check (In-Reply-To, RFQ number)
  WI->>AG: extract route (fields, 14 languages)
  WI->>AG: classify route (CNC or sheet metal, confidence)
  alt confidence below 0.7
    WI->>TG: one-tap confirmation card
    TG-->>WI: event intake-confirmed (via /api/agent/decision)
  end
  WI->>SB: create RFQ (rfqs, rfq_files, source email)
  WI->>R2: copy files to rfq/{rfq_id}/{file_id}-{name}
  WI->>Q: one analyse job per CAD file
  WI->>OP: start quote-{rfq_id}-v1
  Q->>CR: consumer calls submit(job)
  CR->>R2: read input rfq/{rfq_id}/...
  CR->>CC: POST /api/v1/unfold/info (shared secret, wall-clock)
  CC-->>CR: geometry JSON
  CR->>R2: put cad/{job_id}/output/result.json
  CR->>SB: update cad_jobs
  CR->>TH: job final
  TH-->>WQ: event cad-done (all jobs final)
  WQ->>VZ: similar past quotes
  WQ->>AG: extract route (price notes, cover e-mail)
  WQ->>SB: update quote_workflows (awaiting_approval)
  WQ->>TG: approval card
  TG-->>WQ: event quote-approved (7 d, reminder, 7 d)
  WQ->>R2: put quotes/{rfq_id}/v{version}/quote.pdf
  WQ->>RS: send quote, Reply-To replies@rfq.micronshub.eu
  E->>ER: reply to replies@rfq.micronshub.eu
  ER->>ML: email(reply)
  ML->>OP: agent-events message inbound-reply
  OP->>TH: match In-Reply-To and References, append
  OP-->>WQ: event customer-reply
  WQ->>AG: classify route (won, lost, counter)
  WQ->>SB: update quote_workflows.status
```

Notes: approvals from Telegram and from the dashboard (`ApprovalsPage`, `RfqInboxPage`) reach `microns-ops` through `POST /api/agent/decision`; Telegram callbacks arrive at the existing `telegram-leads-bot` edge function, which relays them as a signed request ([AGENTS.md](AGENTS.md) §2.4, PLAN.md P4-12). Replies to Gmail-sent campaigns stay in the Workspace inboxes and are read by the `*/10` Gmail poller. Customer rows can also appear through the DB trigger `on_auth_user_created_customer` (supabase/migrations/20260806_phase2_rls_per_user.sql:415), so dedupe matches on e-mail.

## 13. AI Gateway

Gateway id `microns`. Routes are role-based placeholders; the concrete model is chosen at Phase 4/5 start (the repo's Gemini model IDs are retired, H-19).

| Route | Provider | Model class (example at time of writing) | Used by | Response caching |
|---|---|---|---|---|
| `extract` | Anthropic | Current Sonnet-class (e.g. `claude-sonnet-5-5`) | RFQ parsing, quote drafting (and article generation in `content-daily`) | Off |
| `classify` | Anthropic | Current Haiku-class (e.g. `claude-haiku-4-5`) | CNC vs sheet metal, spam triage, reply classification | Off |
| `translate` | Google AI Studio | Current Gemini Flash-class | Article translation (`translations` Queue) | Off |
| `embed` | Workers AI | `@cf/baai/bge-m3` (1024 dims, matches `quotes-v1`) | Vectorize RAG over past quotes | Optional (deterministic input → output) |

Every call carries `cf-aig-metadata: {"agent":…,"run_id":…,"tenant_id":…}`; [AGENTS.md](AGENTS.md) §2.2 adds `step` and `prompt` (the gateway allows at most five entries).

| Setting | Value | Why |
|---|---|---|
| Caching | Off for `extract`, `classify`, `translate` | Generation must not return a stale answer for a new RFQ or article; prompts contain customer data |
| Rate limiting | Gateway rate limit sized from PLAN.md Q20 (proposal: €50/month hard cap with alerts at 50 % and 80 %) | Protects the budget if a loop or a flood of e-mails starts runs; spend-cap mechanism is CF docs, re-check at execution |
| Logging | On, with `cf-aig-metadata`; retention set to the shortest period that still feeds the weekly digest | Cost per agent and per RFQ (Phase 4 gate); prompts include personal data (GDPR) |
| Keys and gateway authentication | BYOK: provider keys stored in AI Gateway where supported, otherwise Worker secrets `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`; gateway authentication on if available, its token added to the P0-2 checklist (CF docs, re-check at execution) | One place to rotate (P6-1); only `microns-ops` can use the gateway |
| Retries and fallbacks | Retries in Workflow steps, not in the gateway; no provider fallback at start | Avoid multiplied retries; add fallbacks per route once costs are measured |
| Implementation | Gateway dynamic routes named as above if available at Phase 4 start, else a role → provider/model map in `workers/ops/src/agents/` calling the gateway's provider endpoints | CF docs, re-check at execution |

## 14. Access policies

| Application | Hostname / path | Policies | Used by | Phase |
|---|---|---|---|---|
| `microns-site` preview | `microns-site.<account>.workers.dev` and its version preview URLs, including the `staging` alias (host format CF docs, re-check at execution) | Allow: owner identity; Service Auth: service token for CI tools (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) | `scripts/seo-parity.mjs`, `scripts/verify-ssr.sh`, Playwright, Lighthouse, the owner | 1 |
| `microns-site` preview, machine callers | Same application as above | Service Auth: `microns-machine-collector`, `microns-machine-mcp` (one token per consumer, each revocable alone) | `tender-collector`, the local MCP server (tests against the preview) | 2 |
| `microns-machine-api` | `api.micronshub.eu` (not a path on `www`: `/api/tender-scan` also has a browser caller, TenderMonitorPage.tsx:240; DV-7) | Service Auth: `microns-machine-collector`, `microns-machine-mcp`; Allow: owner | `tender-collector` (supabase/functions/tender-collector/index.ts:68), the local MCP server | 3 (runbook, before the `www` flip; D-3) |
| Remote MCP | `mcp.micronshub.eu` | Access + OAuth for MCP clients; Allow: owner identity | Claude on desktop and mobile | 4 (flag `mcp.remote`) |
| Dashboard (optional) | `www.micronshub.eu/dashboard*` | Allow: staff identities | Staff | 6 |
| `workers.dev` | `microns-ops`, `microns-mail`: `workers_dev` off; `microns-site` production URL off after Phase 3 or kept behind the preview application | — | — | 1–3 |

| Constraint | Consequence |
|---|---|
| An Access application protects a hostname and path; a request without an Access identity or service token never reaches the Worker | Paths also called by browsers without Access (forms, dashboard fetches, e-mail links) are not placed behind Access; they are gated in the Worker (Turnstile, Supabase JWT, rate limits) per the private gate matrix |
| Dashboard pages are client-routed | Access on `/dashboard*` gates full page loads only; in-app navigation and API calls rely on the Supabase JWT checks |
| Access pricing | Free up to 50 users (list price, re-check at execution) |
| Machine callers on dual-use paths (`tender-collector`, local MCP server) | Each consumer sends its own Access service token; the Worker verifies the Access assertion and maps the token to its consumer (`ACCESS_MACHINE_CLIENT_IDS`), and accepts a machine caller only on preview hosts and on hosts in `API_MACHINE_HOSTS` (empty in Phase 2, `api.micronshub.eu` from Phase 3; DV-19). The CI token passes the preview's Access application but is not an API credential (DV-16); final mapping in the private gate matrix (PLAN.md P2-7) |
| Access context across a service binding | Not propagated (CF docs, fetched 2026-10-02): the site verifies the caller and sends it to `microns-ops` inside the RPC call |

H-6: Most `/api/*` routes and the `leads-api` edge function do not authenticate callers, and several RLS policies are broader than intended. Phase 2 adds Supabase-JWT/Access gates, Turnstile and rate limits; Phase 6 remediates RLS. Details: private security note. Related hazards H-5, H-7, H-15 and H-30 are indexed in [README.md](README.md) and registered in [RISKS.md](RISKS.md). Until the Phase 6 RLS remediation, agents authorise staff actions through Access and staff checks, not tenant roles ([PLAN.md](PLAN.md) §5.4).

## 15. Tenant resolution

| Layer | Behaviour | Evidence |
|---|---|---|
| Resolution | Purely client-side from `window.location.hostname`: localhost/IP → default; host containing `micronshub.eu` with ≥ 3 labels → first label as tenant slug unless reserved (`www`, `api`, `admin`, `app`, `micronshub`, `localhost`); any other host → custom-domain lookup | src/utils/tenantApi.ts:22, :29-51 |
| Context | `TenantProvider` wraps the app; unknown custom domain falls back to the default tenant | src/App.tsx:157; src/contexts/TenantContext.tsx:34, :51-56 |
| Custom-domain lookup | `tenants.custom_domain` = host, active only | src/utils/tenantApi.ts:158-177 |
| Worker | No host logic except preview `noindex`; tenant hosts receive the Microns SEO body and `www` canonical, as today | H-13; PLAN.md Q9 |
| DNS + TLS on Cloudflare | Proxied wildcard `*` record + Universal SSL (covers first-level subdomains on a full setup) + Workers Route `*.micronshub.eu/*`; Custom Domains cannot be wildcards | CF docs (verified 2026-09-27); C8 |
| Route precedence | `www.micronshub.eu/*` beats the wildcard; `mcp.` and `files.` need their own Worker-less routes because Routes run in front of Custom Domains; `rfq.` carries only mail records | §5 |
| Preview hosts | `*.workers.dev` does not contain `micronshub.eu`, so the app treats it as a custom domain and falls back to the default tenant (same as `on-demand-craft-greece.vercel.app` today); tenant pages are first verified on the zone at runbook S14 | src/contexts/TenantContext.tsx:51-56 |
| Dashboard copy | `TenantEditPage` tells tenants to add the domain in Vercel and CNAME to `cname.vercel-dns.com`; rewritten in Phase 3 (P3-6); Cloudflare for SaaS custom hostnames only when a real custom domain appears | src/pages/dashboard/tenants/TenantEditPage.tsx:642, :667-678; PLAN.md Q17 |
| Substring match | `hostname.includes('micronshub.eu')` kept for parity; tightened in Phase 6 | src/utils/tenantApi.ts:38; H-21 |

## 16. Supabase access patterns

| Caller | Credential | Interface | Tables / objects | Notes |
|---|---|---|---|---|
| Browser SPA | Anon key + user session | supabase-js | As today (RLS) | Unchanged (src/integrations/supabase/client.ts:5-15) |
| `microns-site` SEO handler | `SUPABASE_ANON_KEY` | REST GET `/rest/v1/…` | `service_pages`, `content_pages`, `articles` (published rows) | 1–2 REST calls per uncached page on most page types (for example article + translation map, middleware.ts:122, :145); 2.5 s timeout on service and content page reads (middleware.ts:194); cached per §17 |
| `microns-site` sitemap routes | `SUPABASE_ANON_KEY` | Storage public object, REST fallback | `sitemaps` bucket, then R2 `sitemaps/…` from Phase 5 | api/sitemap.js:25, :236 |
| `microns-site` local API | `SUPABASE_SERVICE_ROLE_KEY` (server-side only) | REST | Marketing tracking tables (`track`); lookups the gates need | Service role never reaches the browser |
| `microns-site` gates | User JWT | `GET /auth/v1/user` after a local shape and expiry pre-check; roles read as an array from `user_roles` with the caller's own JWT | `user_roles` | Result cached per isolate for at most 60 s and never past the token's expiry; no JWT secret in any Worker; a JWKS path is built but dormant (the project's JWKS is empty, live 2026-10-02); Supabase Auth unreachable → 503 (fail closed) |
| `microns-ops` | `SUPABASE_SERVICE_ROLE_KEY` | supabase-js over REST | Ops, agent and inventory tables | Server-side only |
| `microns-ops` bulk upserts (optional) | Hyperdrive `SUPABASE_DB` (connection string stored in the Hyperdrive config, never in a file) | Postgres wire | `xometry_offers` upserts (the Python scanner uses psycopg today) | Session-mode pooling; CF docs, re-check at execution |
| `microns-mail` | `SUPABASE_SERVICE_ROLE_KEY` | REST | `inbound_emails` | Insert only |

| Consideration | Design response |
|---|---|
| More isolates than Vercel means more cold `Map` caches | KV `SEO_CACHE` in front of Supabase so that crawl bursts do not multiply REST calls (Supabase throughput depends on the plan tier, PLAN.md Q2) |
| Outgoing connections | 6 simultaneous per request (CF docs, verified 2026-09-27): the SEO handler needs 1–2; scrapers cap at 6 |
| Region | Supabase is in eu-central-1; `microns-ops` may use Smart Placement to run near the database (CF docs, re-check at execution); `microns-site` stays at the edge |
| Hardcoded project URL | Moves to var `SUPABASE_URL` (today middleware.ts:43, api/sitemap.js:24) |
| Credentials | Service credentials only in Worker secrets; each consumer on the P0-2 checklist; rotation P6-1 |

## 17. Caching model

| Layer | Content | TTL | Invalidation | Evidence |
|---|---|---|---|---|
| Isolate `Map` (7 caches) | SEO rows: article, translations, lists, service pages, content pages, alternates | 1 h; 30 s for misses ("no row", and a failed service page, service page list or content page lookup, which middleware.ts also caches 30 s; the Worker tags it failed so the strict-404 path never turns it into a 404). Other failed lookups are not cached, as in middleware.ts | Isolate recycling (as on Vercel). The Worker bounds each `Map` at 1,000 entries per kind (300 for articles): expired entries go first, then the oldest written; keys over 512 B are not cached | middleware.ts:44, :94-99, :193, :375; workers/site/src/seo/cache.ts |
| KV `SEO_CACHE` | Same rows, positives only, keyed `seo:v1:<kind>:<lang>:<slug>`; value `{data, expires, v}`, where `v` fingerprints the query and normalisation that produced `data` (another `v` is a miss; bumping `CACHE_SHAPE_VERSION` in `workers/site/src/seo/supabase.ts` flushes). "No row" results and failed lookups (non-2xx, network error, timeout, missing key) are never written to KV (where they are cached at all, it is in the isolate `Map`), so unknown URLs cost no KV write; KV is still read for them. A content-page row is written only under its own `slug` or `localized_slug`; found under any other URL segment it stays in the isolate `Map` for 1 h | 1 h (`expirationTtl` 3600; the `expires` field is the logical expiry). A read waits at most 500 ms, then counts as a miss; for service pages, the service page list and content pages it runs inside middleware.ts's single 2.5 s budget. Writes run through `ctx.waitUntil` | `microns-ops` deletes keys on content publish; KV propagation is eventually consistent | [PLAN.md](PLAN.md) P1-4; workers/site/src/seo/cache.ts, supabase.ts |
| Cache API | Sitemap responses | 1 h, matching `s-maxage=3600` today | Expiry; per data centre | api/sitemap.js:392-396; H-12 |
| HTML | Not cached at the edge | `Cache-Control: public, max-age=0, must-revalidate` | — (no Cache Rule; HTML, JSON and XML are not cached by default) | middleware.ts:674; CF docs (verified 2026-09-27) |
| Static assets | Served by Workers Static Assets; hashed `/assets/*` | Platform defaults; `_headers` only if the baseline needs immutable caching or the `Content-Type` values of vercel.json:173-184 | New version on deploy | H-28 |
| KV `FLAGS` | Flag values | Read with a short `cacheTtl` (60 s since Phase 1); synced every minute from `feature_flags`. The SEO handler waits at most 500 ms for `seo.strict_404`, then uses var `SEO_STRICT_404`; `api.forward_to_vercel` (Phase 2) falls back to var `API_FORWARD_TO_VERCEL` when the key is missing, malformed or KV fails | Sync job | PLAN.md P4-2; workers/site/src/flags.ts |

## 18. Observability

| Signal | Where | Content | Consumer |
|---|---|---|---|
| Workers Logs | All three Workers | Structured JSON per request: route step, `X-Seo-Source`, cache layer hit, Supabase latency, status; errors for shell failures (H-4). From Phase 2 one `api` line per `/api` request in `microns-site` and in `microns-ops` with a shared `requestId`, gate decisions in report mode, `scrapes` outcomes and `nest` CPU; never tokens, cookies, bodies or e-mail addresses | Phase 1–3 gates (zero 5xx), debugging |
| Analytics Engine `microns_events` (`EVENTS`) | `microns-ops` | One data point per agent step: agent, `run_id`, tokens, cost, outcome, latency | Ops digest, dashboards |
| `agent_runs` table | Supabase | One row per run: agent, trigger, `idempotency_key` UNIQUE, status, `cost_cents`, tokens, times, error, human action | Dashboard, ops digest, Phase 5 output parity (H-29) |
| AI Gateway logs | Gateway `microns` | Per call with `cf-aig-metadata` | Cost per agent and per RFQ (Phase 4 gate) |
| Queue DLQs | `<name>-dlq` | Failed messages | Telegram alert + `agent_runs` |
| Parity reports | `scripts/seo-parity.mjs` output | JSON + Markdown diff | Phase gates, deploy gating |

Web Analytics automatic setup stays off (it injects a script into HTML at the edge, a parity violation; CF docs, verified 2026-09-27). Tracking remains GA4 + Google Ads in `index.html` (C11).

## 19. Environments and CI/CD

| Environment | Host | Data | Deployed by | Protection |
|---|---|---|---|---|
| Local | `wrangler dev` | Production Supabase, anon reads only | Developer | — |
| Preview | `microns-site.<account>.workers.dev` + version preview URLs | Production Supabase (single project); write paths tested with dedicated test users and seeded test RFQs only, removed after each run; mail-sending tests opt-in (`E2E_SEND_MAIL=1`) to test sinks; preview uploads land in R2 while their `rfq_files` rows land in production, so non-test objects are copied back to legacy S3 before Phase 3 (P2-12) | `wrangler versions upload`; `microns-ops` with `wrangler deploy` | Access + `X-Robots-Tag: noindex` |
| Staging | Preview alias `staging` (`wrangler versions upload --preview-alias staging`) | As preview | Manual workflow | Access + `noindex` |
| Production | Routes on `micronshub.eu` from Phase 3 | Production | `wrangler versions deploy` of the version ID that passed the gates | Zone settings ([SEO_PARITY.md](SEO_PARITY.md)) |

| Stage | Pipeline | Gate |
|---|---|---|
| Phase 1–2 | `.github/workflows/cf-preview.yml`: manual dispatch only; pinned Node and package manager (P0-7); `vite build`; `wrangler versions upload --preview-alias staging`; secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (names only). Phase 2 adds: `workers/shared` install, secret `VITE_TURNSTILE_SITE_KEY` passed to `vite build` (the run stops early when it is empty), a prerender guard that fails when `dist/**/*.html` contains Turnstile markup, and the bundle guard after the dry run | Parity diff, `verify-ssr.sh`, Playwright, Lighthouse, size report (PLAN.md §5.1); Phase 2: T1/T2 suites, bundle guard, `tests/e2e/api.spec.ts` (PLAN.md §5.2) |
| Phase 2 (`microns-ops`) | `.github/workflows/cf-ops.yml`: manual dispatch only; install, typecheck, tests, dry run with metafile; `wrangler deploy` only when the input `deploy` is true (deployed, not version-uploaded, and before the site, because a service binding reaches the current deployment only) | T1 suite, `qrcode` server-build check, size report |
| From Phase 3 | Deploy job (added later, manual trigger): upload a version → parity diff preview vs production → promote the same version ID only if 0 unexplained differences; gradual percentage deploys where useful (CF docs, re-check at execution) | Parity = 0 for `microns-site`; unit and e2e tests for `microns-ops`, `microns-mail`, `microns-cad` |
| Branch safety | No Worker code is pushed before P0-1 gates `auto-merge-claude.yml` (.github/workflows/auto-merge-claude.yml:3-6, :26-30); Vercel keeps deploying `main` until Phase 6 | H-2 |

## 20. Platform limits that shape the design

| Limit | Value | Design consequence | Source |
|---|---|---|---|
| CPU per request | 30 s default, 5 min max (`limits.cpu_ms`); applies to queue consumers too; not enforced locally | `nest` on `microns-ops` with `cpu_ms` 300,000; CAD in the Container; CPU measured on the preview only | CF docs (verified 2026-09-27; re-read 2026-10-02); H-18 |
| Worker size | 64 MiB uncompressed on Free and Paid; no compressed size limit | Size is not the binding limit; startup is. Phase 2 dry runs: `microns-site` 3,366.23 KiB (gzip 728.01 KiB), `microns-ops` 3,743.75 KiB (gzip 725.78 KiB); a bundle guard keeps ops-only code out of the site | CF docs (fetched 2026-10-02) |
| Startup time | 1 s | SEO Worker kept small; size report gate; API handlers imported lazily per route | CF docs (verified 2026-09-27); H-27 |
| Service bindings (RPC) | Each call counts as a subrequest; at most 32 Worker invocations per request; serialised RPC payload 32 MiB (streams for more); the target must be deployed; Access context is not propagated | `microns-ops` deployed before the site; the caller travels in the RPC call | CF docs (fetched 2026-10-02) |
| Subrequests; simultaneous outgoing connections | 10,000 per request; 6 at a time | Fan-out goes through Queues and Workflows; scrapers cap concurrency at 6 | CF docs (verified 2026-09-27) |
| Memory | 128 MB per isolate | 6.2 MB sitemap streamed, not built in memory twice | CF docs (verified 2026-09-27); H-12 |
| Cron / Queue consumer wall time | 15 min | Long jobs become Workflows (steps have no wall-time limit) | CF docs (verified 2026-09-27) |
| `waitForEvent` | Default 24 h, max 365 d; event types: letters, digits, `-`, `_` | 7-day approval waits with a reminder step | CF docs (verified 2026-09-27) |
| Containers | `lite` 1/16 vCPU 256 MiB … `standard-4` 4 vCPU 12 GiB; included 25 GiB-h, 375 vCPU-min, 200 GB-h per month | `standard-1`/`standard-2`, `sleepAfter` ≈ 10 min | CF docs (verified 2026-09-27); list price, re-check at execution |
| `_redirects` | 2,000 static + 100 dynamic rules; not applied to Worker responses | In-Worker table instead | CF docs (verified 2026-09-27) |
| Custom Domains | No wildcards; not on a hostname with an existing CNAME | Routes for `www` and `*` | CF docs (verified 2026-09-27) |
| Email Routing | Subdomains supported, 30 per zone, catch-all only on the apex; inbound size example 25 MiB | Explicit `rfq@`/`replies@` addresses | CF docs (verified 2026-09-27) |
| Zone rate limiting | Free plan: 1 rule, 10 s window, IP | One rule on `/api/*` plus the three rate-limit bindings (`API_RATE_LIMIT`, `_MAIL`, `_BULK`) and Turnstile | CF docs (verified 2026-09-27) |
| Static Assets per-file size and file count | Not verified | `occt-import-js.wasm` (≈ 7.3 MB) and the 210 prerendered files must fit | CF docs, re-check at execution |

## 21. DNS and DNSSEC procedure

The full runbook with owners, pass criteria and rollback per step is [PLAN.md](PLAN.md) §6 (steps S1–S17). The order matters because a DS record exists at the `.eu` registry and Papaki signs the zone (live 2026-09-30).

```mermaid
sequenceDiagram
  autonumber
  participant D as Dimitris
  participant C as Claude (checks)
  participant PK as Papaki (registrar and DNS)
  participant EU as .eu registry
  participant CF as Cloudflare zone
  participant RS as Public resolvers
  participant V as Vercel
  participant W as microns-site
  Note over D,W: S1 to S5, T minus 10 to 6 days
  D->>CF: S1 add zone micronshub.eu (Free), note assigned NS
  D->>PK: S2 lower TTLs to 300 s
  D->>CF: S3 and S4 import Papaki zone, every record DNS only
  C->>RS: S5 dns-parity: Papaki vs Cloudflare answers, 0 differences
  Note over D,W: DNSSEC off before the NS move
  D->>PK: S6 disable DNSSEC (T minus 3 d)
  PK->>EU: remove DS record
  C->>RS: S7 DS absent for longer than its TTL, re-run S5
  D->>PK: S8 set NS to the Cloudflare pair (T)
  PK->>EU: publish new NS
  RS->>CF: queries now answered by Cloudflare
  C->>RS: S9 verify MX, SPF, DKIM, DMARC, GSC TXT, Resend, mail test
  D->>CF: S10 enable DNSSEC (T plus 2 d)
  D->>PK: add the DS shown by Cloudflare
  PK->>EU: publish DS
  C->>RS: chain validates (AD flag, DNSViz)
  Note over D,W: S11 readiness, then the site flip (C, at least T plus 3 d)
  D->>CF: S11 zone settings, Routes deployed (inert), certificates active
  D->>CF: S12 www: CNAME to Vercel replaced by proxied placeholder
  CF->>W: www.micronshub.eu/* now served by the Route
  D->>CF: S13 apex: proxied placeholder + Single Redirect Rule to www
  D->>CF: S14 wildcard: proxied placeholder + Route *.micronshub.eu/*
  C->>W: S15 and S16 bots, cache, parity, logs for 48 h
  alt rollback trigger
    D->>CF: restore DNS-only records pointing at Vercel
    CF->>V: traffic back on Vercel within TTL 300 s
  end
  D->>C: S17 gate sign-off
```

Records in scope and their state per step: [PLAN.md](PLAN.md) §6.1 (apex A `216.198.79.1`, `www` CNAME to Vercel, wildcard `*` CNAME `cname.vercel-dns.com`, 5 × Google Workspace MX, SPF, DKIM, DMARC, GSC TXT, DS at the registry; live 2026-09-30). Mail records are never changed (H-16 is a report only).

| DNSSEC rule | Reason |
|---|---|
| DS removed and expired before the NS move | A DS pointing at Papaki's keys would make Cloudflare's answers fail validation |
| Site rollback is always a record flip inside Cloudflare, never an NS change after S10 | With the Cloudflare DS published, reverting NS to Papaki makes the zone bogus for validating resolvers, including MX |
| S10 may wait until after S17 | Keeps the cheap NS rollback available during the flip |
| Vercel certificates must stay valid for rollback | Expiry dates recorded at S11 (renewals may stop once traffic leaves Vercel) |

## 22. Phase 7 sketch (optional, owner decision 2026-09-30)

Phases 0–6 are unchanged; Supabase stays the system of record through Phase 6. Precondition, workstreams P7-1…P7-8, gate and rollback are in [PLAN.md](PLAN.md) §5.7.

```mermaid
flowchart LR
  B["Browser SPA (typed data client)"]
  subgraph CF["Cloudflare"]
    SITE["microns-site: SEO handler reads DB"]
    OPS["microns-ops: /api/data/* data-access layer"]
    AUTH["Auth component (PLAN.md Q23)"]
    RH["RealtimeHub DO (WebSocket hibernation)"]
    D1["D1 microns-db (binding DB)"]
    FLG["KV FLAGS: data.backend"]
  end
  SUPA["Supabase: read-only 30 days, then decommissioned"]
  B -->|"/api/data/* via microns-site router"| SITE
  SITE -->|"service binding OPS"| OPS
  SITE -->|"DB (SEO reads)"| D1
  OPS --> AUTH
  OPS -->|"DB"| D1
  OPS --> RH
  B -->|"WebSocket"| RH
  OPS --> FLG
  OPS -.->|"rollback: data.backend = supabase"| SUPA
```

| Component | Phase 7 role |
|---|---|
| `/api/data/*` | Data API served by `microns-ops` through the `microns-site` router; one data-access layer enforces tenant, customer, partner and staff rules (D1 has no RLS) |
| D1 `microns-db`, binding `DB`; flag `data.backend` | `DB` on `microns-site` for SEO reads and on `microns-ops` for everything else; `data.backend` = `supabase` or `d1` (Phase 7 only) is the rollback switch |
| `RealtimeHub` DO | WebSocket hibernation for the two Realtime subscriptions (`marketing_campaigns` UPDATE, `user_emails`), or keep the polling fallback |
| Auth component | Per PLAN.md Q23: Workers-native library on D1, hosted IdP, or Access for staff plus one of those |
| SEO handler | Switches from Supabase REST to `DB`; the full SEO parity gate is re-run |

## 23. Items to confirm at execution

| Item | Where it matters | Owner |
|---|---|---|
| Apex redirect status, HTTP → HTTPS status, HSTS values | §5, runbook S11/S13 (baseline P0-3; H-11, H-24) | Both |
| Directory indexes for `/laserkritis/` and `/zohoverify/` (router step 5); `/sitemap-complete.xml` as a rewrite (vercel.json:135-136) vs the 301 described in the api/sitemap.js:5-6 comment (router step 2) | §6.2 | Claude (from the baseline) |
| KV minimum TTL, Queue limits, Workflow instance id limits, Cron Trigger limits, preview-alias host format, Static Assets file limits | §7, §9, §10, §14, §17, §20 | Claude |
| AI Gateway spend caps, authentication and dynamic routes; Supabase JWT verification method (`/auth/v1/user` built in Phase 2; JWKS path dormant until the project publishes keys) | §13, §16 | Claude |
| CPU limit of an RPC callee, the error on CPU exhaustion, version overrides on RPC calls; `nest` CPU per fixture on the preview | §6.4, §20 (PLAN.md §5.2 D-6, D-15) | Both |
| Vercel's request-body cut-off, its bytes for invalid JSON and default `Cache-Control` on `/api/*`, `maxDuration`; whether a handler-set CORS header or the platform header wins | §6.4 (PLAN.md §5.2 D-12, D-15; P0-3) | Both |
| Supabase plan tier and REST throughput | §16 (PLAN.md Q2) | Dimitris |
