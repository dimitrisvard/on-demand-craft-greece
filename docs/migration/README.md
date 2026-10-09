# Microns Hub to Cloudflare migration: index and Phase 0 audit

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [PLAN.md](PLAN.md) · [INVENTORY.md](INVENTORY.md) · [inventory.csv](inventory.csv) · [ARCHITECTURE.md](ARCHITECTURE.md) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [SEO_PARITY.md](SEO_PARITY.md) · [AGENTS.md](AGENTS.md) · [RISKS.md](RISKS.md) · [COSTS.md](COSTS.md)

Evidence tags used below: `path:line` = this repository at commit `9afcba8` (branch `claude/microns-cloudflare-migration-j6ffpt`); "live 2026-09-30" = read-only re-capture on that date; "live 2026-09-27" = the original audit; "CF docs (verified 2026-09-27)" = Cloudflare documentation checked during planning; "list price — re-check at execution" = prices. "Brief" means the owner's migration brief; "plan" means the approved Phase 0 proposal of 2026-09-27.

## 1. What is in this folder

| File | Purpose |
|---|---|
| [README.md](README.md) | This index and the Phase 0 audit report: method, verified facts, corrections C1–C20, answers to brief §8, live refresh, hazard index, verification record |
| [INVENTORY.md](INVENTORY.md) | Every route family, redirect, API endpoint, edge function (repo and live), cron job (live), secret/env name, external API, special static file, storage bucket, table group, DNS record, domain, CI workflow and service: today's location → target and phase |
| [inventory.csv](inventory.csv) | The same inventory, one machine-readable row per item |
| [PLAN.md](PLAN.md) | The decision document: Phases 0–6 with tasks, file-level change list, exit gates, rollback, owner and effort; pre-flight P0-1…P0-9; cutover runbook; deviations from the brief; the final open questions Q1–Q22 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Target design: Mermaid diagrams, Worker layout, bindings, R2 layout, Queues/Workflows/Durable Objects, AI Gateway routes, Access policies, DNS/DNSSEC procedure, hostnames |
| [wrangler.jsonc.draft](wrangler.jsonc.draft) | Draft configs for `microns-site`, `microns-ops`, `microns-mail` and the `microns-cad` Container; placeholders only; deliberately not named `wrangler.jsonc` |
| [SEO_PARITY.md](SEO_PARITY.md) | Parity diff tool design, URL sources, pass/fail rules, baseline capture, Cloudflare settings checklist, GSC monitoring |
| [AGENTS.md](AGENTS.md) | The seven agent designs of brief §4: inputs, outputs, failure modes, idempotency key, cost per run, human view, schema additions |
| [RISKS.md](RISKS.md) | Risk register: likelihood, impact, mitigation and owner, covering H-1…H-30 |
| [COSTS.md](COSTS.md) | Today vs target monthly cost, assumptions and the cost gate |
| [MANUAL_STEPS.md](MANUAL_STEPS.md) | Added 2026-10-09: the single owner checklist for every phase, in working order (accounts, dashboards, DNS, deploys, database applies, decommission) |
| [specs/](specs/README.md) | Added 2026-10-04: public sections of the Phase 2–6 build specifications |
| [phase6/](phase6/) | Added 2026-10-09: files prepared for the owner-run Phase 6 cleanup and the optional dashboard Access application |

The GitHub repository is public (live 2026-09-30). Security findings therefore appear in these files at summary level only, each ending "Details: private security note". The full security detail was delivered to the owner out of band and is not in this repository (PLAN.md Q18 asks whether to keep this approach and whether to make the repository private).

## 2. Status and approval flow

| Step | State |
|---|---|
| Brief | "Do not modify code until I approve `docs/migration/PLAN.md`" (brief, header) |
| Phase 0 proposal (2026-09-27) | Approved. It authorised these planning files only: no source edits, no `wrangler deploy`, no DNS changes, no secrets in files |
| [PLAN.md](PLAN.md) | The decision document. Awaiting owner approval and answers to Q1–Q22 |
| Phase 1 code | Starts only after PLAN.md is approved and P0-1 is done: `auto-merge-claude.yml` merges every push to `claude/**` into `main` (.github/workflows/auto-merge-claude.yml:5-6, :29) and this branch matches the glob (H-2). Docs-only pushes cause no runtime change |
| Code status (2026-10-09) | The code of Phases 1, 2, 4 and 5 and the code parts of Phases 3 and 6 are built and tested locally; nothing is deployed, applied or switched, and no phase gate is signed. Build records: [PLAN.md](PLAN.md) §5.2–§5.6 (Phase 1: `workers/site/README.md`). The Phase 6 access-model migration is delivered to the owner privately and committed after the owner has applied it. Every owner step: [MANUAL_STEPS.md](MANUAL_STEPS.md) |

Phases (fixed numbering): 0 Audit + pre-flight · 1 Site + SEO Worker (preview only) · 2 API port · 3 Zone + cutover · 4 Agent layer · 5 Consolidate compute · 6 Hardening + decommission.

Phase 0 pre-flight (full wording, exit criteria and order in [PLAN.md](PLAN.md)):

| ID | Item | Links | Owner |
|---|---|---|---|
| P0-1 | Gate `auto-merge-claude.yml` with a branch allow-list and enable branch protection on `main` | H-2; Q10, Q12 | Dimitris |
| P0-2 | Rotate Supabase service credentials and re-issue them to every consumer; moved from Phase 2 to pre-flight because credentials will be re-issued before any new consumer is created (details private) | H-7; Q4 | Dimitris (Claude prepares the checklist) |
| P0-3 | Capture the HTTP/SEO baseline from an allow-listed vantage point: all parity URLs, HEAD + GET, apex/http variants, headers | H-1, H-24, H-28; Q1 | Both |
| P0-4 | Re-dump live `cron.job`, `pg_policies`, the Papaki zone file, Vercel domain and project settings | H-24, H-26 | Both |
| P0-5 | Pull the live source of all 40 deployed edge functions (reference only) | H-26; Q6 | Claude |
| P0-6 | Add the Cloudflare preview host to the Supabase Auth Site URL / redirect allowlist | H-22; Q16 | Dimitris |
| P0-7 | Pin package manager and Node version; compare `dist/` file lists, Vercel vs local build | H-23; Q15 | Both |
| P0-8 | Cloudflare account prerequisites: Workers Paid, R2 enabled, scoped API token for CI, Access team domain | — | Dimitris |
| P0-9 | Papaki: confirm the account holder and the DNSSEC-disable lead time | C9; Q7 | Dimitris |

## 3. Scope

micronshub.eu is a live, revenue-generating B2B manufacturing marketplace in 14 languages whose main acquisition channel is organic search. Today the Vite SPA, the SEO-injection middleware (`middleware.ts`) and 12 Node API functions run on Vercel's Hobby plan (api/gsc.js:4-5); 40 deployed Deno edge functions (30 in the repo), 10 pg_cron jobs, Postgres, Auth and Storage run on Supabase project `cfjrtmtaitwzggzpkhxi` (eu-central-1); a FastAPI/CadQuery service (`sheet-metal-service`) runs on a VPS whose host is not recorded in the repo; a Python Xometry scanner runs on GitHub Actions 7×/day (.github/workflows/xometry-scan.yml:21) (live 2026-09-30). The migration moves everything on Vercel, the VPS and the GitHub Actions compute to Cloudflare Workers primitives, adds an AI-agent layer, and must change no public URL and cause no SEO regression. Supabase stays the system of record; Resend and the Google Workspace MX stay. Volumes are small: 2,344 published articles, 98 service pages, 126 content pages, ≈ 2,610 public URLs (2,344 + 98 + 126 + 14 × 3 static; [INVENTORY.md](INVENTORY.md) recomputes from sources), 700 leads, 2 RFQs, 2 orders, 21 customers, 2 tenants (live 2026-09-30). The agent layer must therefore be cheap per run rather than high-throughput.

## 4. Audit method and sources

| Source | What was read | When |
|---|---|---|
| Direct repo reads | `package.json`, `vite.config.ts`, `vercel.json`, `middleware.ts` + `middleware/*`, `index.html`, `public/*`, `.env.example`, `.github/workflows/*`, `supabase/config.toml`, `src/App.tsx`, `TenantContext.tsx`, `src/utils/tenantApi.ts`, `src/components/SEORedirects.tsx`, `api/sitemap.js`, `api/s3.js`, `mcp-server/src/index.ts`, `scripts/verify-ssr.sh`, `tests/*` | 2026-09-27 |
| Six-reader audit workflow (read-only) | api/lib · edge functions + pg_cron · frontend routing/SEO · Python/bots/MCP/CI · data layer · docs/secrets/services; each returned claims, inventory, hazards, answers and open questions | 2026-09-27 |
| Adversarial verification | Every correction checked by two independent lenses (a refuter told to defend the brief's original claim, and a precision checker) | 2026-09-27 |
| Completeness critic | Missing items, contradictions and parity risks across all readers | 2026-09-27 |
| Live, read-only | Vercel project, domains and deployments; DNS over DoH; TLS certificate of a tenant subdomain; Supabase: deployed edge functions, `cron.job` + run history, `pg_tables`/`pg_policies`, storage buckets/objects, tenants, content counts, `app_settings` key names, security advisors, article freshness per language, `amazonaws.com` URL counts, sender accounts | 2026-09-27 |
| Live refresh, read-only | See below | 2026-09-30 |

Not possible from the audit container: HTTP probes of production. Every request returns `429` with `x-vercel-mitigated: challenge`, so the SEO baseline must come from an allow-listed vantage point (H-1, P0-3). Still true on 2026-09-30.

Re-read on 2026-09-30 (values in [§9](#9-live-refresh-delta-2026-09-27--2026-09-30)): the 40 deployed edge functions (slug, version, JWT setting, repo presence); all 10 `cron.job` rows with 7-day run history and the retained `net._http_response` rows; storage buckets with object counts and sizes; tenants; row counts (`service_pages`, `content_pages`, `articles`, `leads`, `rfqs`, `orders`, `customers`, `gsc_monitored_urls`, `xometry_offers`, public tables); articles per language; `app_settings` key names (values not read except `site_url`); the Realtime publication; sender accounts; selected RLS policies; Vercel project domains; DNS (NS, A/AAAA, CNAME incl. wildcard probes, MX, TXT, DMARC, DKIM, DS/DNSKEY, CAA, SOA, and `www.laserkritis.gr`).

## 5. Verified as stated

| Brief §1 statement | Evidence |
|---|---|
| React 18 + Vite 5 SPA, React Router v6, i18next (14 languages), Tailwind + shadcn/ui, TanStack Query, Three.js viewer, `occt-import-js` in the browser, client-side PDF | package.json:84 (`react ^18.3.1`), :126 (`vite ^5.4.1`), :93 (`react-router-dom ^6.26.2`), :70 (`i18next`), :99 (`three`), :79 (`occt-import-js`; wasm in `public/occt-import-js.wasm`), :72, :69, :81 (`jspdf`, `html2pdf.js`, `pdf-lib`) |
| Prerender of 210 routes with `@prerenderer/rollup-plugin` + jsdom | vite.config.ts:27-45 (14 languages × 15 page types); production builds only, `renderAfterTime: 5000` (vite.config.ts:87-99); skipped with only a console warning if the plugin fails to load (vite.config.ts:106) |
| `middleware.ts` is the SEO engine, Web-standard, no UA sniffing, `X-Seo-Source`, 1 h `Map` caches | Matcher `/(14 langs)` and `/(14 langs)/(.*)` (middleware.ts:683-686); shell fetched from its own origin (middleware.ts:421); anon key from env (middleware.ts:105); injects canonical, hreflang incl. `x-default` (middleware.ts:370, :637), robots meta, `og:locale`, JSON-LD and `<article id="seo-content">` for every request (middleware/inject.ts:57-116); TTL 1 h, negative 30 s, fetch timeout 2.5 s (middleware.ts:44, :193, :194); `Cache-Control: public, max-age=0, must-revalidate` and `X-Seo-Source` (middleware.ts:674-675); hardcoded Supabase URL (middleware.ts:43) |
| `vercel.json`: 25 permanent redirects, sitemap rewrites, `/api/track`, `/api/connector-status`, SPA fallback, CORS on `/api/*`, content-type on `/assets/*` | vercel.json:2-128 (redirects), :129-162 (rewrites, incl. a no-op `/robots.txt` rewrite at :147), :163-185 (headers) |
| Routing families, `TranslatedRouteMatcher`, tenant pages | src/App.tsx:14, :222; `laserkritis` custom page via src/pages/tenants/customPageRegistry.ts:9 |
| SEO tests exist | `scripts/verify-ssr.sh` is the real gate; tests/e2e/seo.spec.ts has 7 shallow checks (lines 4-44); `tests/middleware/smoke.mjs` |
| Supabase: 52 migrations, RLS with `tenant_id`, Auth roles, Realtime, Storage; inventory tables; `app_settings`; `xometry_offers` | 52 files in `supabase/migrations/`; RLS enabled on all 72 public tables and `xometry_offers` = 0 rows (live 2026-09-30); inventory tables empty (live 2026-09-27) |
| `sheet-metal-service` FastAPI + CadQuery with Dockerfile; `xometry-bot` on GitHub Actions 7×/day; `auto-merge-claude.yml` + `xometry-scan.yml` | `sheet-metal-service/Dockerfile`; .github/workflows/xometry-scan.yml:21 (`0 6,8,10,12,14,16,18 * * *`); .github/workflows/auto-merge-claude.yml |
| `lib/nesting` and `lib/inventory` are imported from `api/` | Only by api/notifications.js:10-11 |

## 6. Corrections C1–C20

Each row was confirmed by both verification lenses (see [§12](#12-verification-record)); the last column gives the raw audit correction IDs. Numbers are live 2026-09-30 where they changed.

| # | Brief §1 said | What the code / live state says | Audit ref |
|---|---|---|---|
| C1 | `api/` = 14 serverless functions | 12 deployed functions plus 2 `api/_lib` helpers that are not deployed. The 12 is the Vercel Hobby cap (api/gsc.js:4-5; commit `7a6081e`) | api-lib#1 |
| C2 | `VITE_AWS_*` secrets are shipped to the browser | No longer true: `src/` has no `VITE_AWS` reference; vite.config.ts:67-78 denylists the four AWS key variables and `VITE_ADMIN_PASSWORD_UPDATE_SECRET`; `api/s3.js` reads the keys server-side, `AWS_*` first with `VITE_AWS_*` fallback (api/s3.js:13-42). Remaining debt: misleading env names on Vercel, stale .env.example:22-25 and `docs/AWS_S3_VERCEL_GUIDE.md` | frontend-routing-seo#16, docs-secrets-services#32 |
| C3 | Injects a **hidden** `<article id="seo-content">` sibling of `#root` | Not `hidden`: middleware/inject.ts:74-116 avoids the attribute and hides the block with an inline MutationObserver once React renders; the block is inserted right after `<body>`, before `#root`. Seven `Map` caches (middleware.ts:94-99, :375). Port byte-for-byte | frontend-routing-seo#13 |
| C4 | 30 edge functions, 25 use the service-role key | 30 in the repo, 24 reference `SERVICE_ROLE`. Live: 40 deployed = 25 repo-and-deployed + 15 live-only (`resend-webhook`, `gsc-sitemap-sync`, `gsc-performance`, `gsc-index-url`, `gsc-inspect-url`, `enqueue-translations`, `process-translation-queue`, `diag-gemini-models`, `resend-email`, 2 × `-v2`, 2 × `-no-jwt`, `test-email-function`, `debug-test`, `simple-test`); 5 repo functions not deployed (`check-replies`, `process-followups`, `process-warmup`, `admin-update-partner-password`, `fix-broken-tables`). supabase/config.toml:14-20 lists three functions that do not exist in the repo (live 2026-09-30) | edge-functions-cron#6, #10 |
| C5 | `check-replies` polls Gmail via OAuth | The code exists but the function is not deployed and nothing schedules it; same for `process-followups` and `process-warmup`. Nothing polls Gmail in production (live 2026-09-30) | edge-functions-cron#9 |
| C6 | pg_cron 07:00 article → 08:00 translate → 08:30 fix links → 09:00 sitemap, plus a translation queue | 10 live jobs, all active: `process-article-queue` (*/5, 300 s), `enqueue-daily-article` (07:00, SQL only; the */5 worker generates the article), `auto-translate-daily-articles` (08:00, 600 s), `auto-fix-article-links` (08:30, live body `{"fix_all": true}`; the repo migration's `{}` is stale), `auto-update-sitemap` (09:00), `reddit-tier1` (*/15), `reddit-tier2` (*/30), `reddit-tier3` (hourly), `hn-collector` (*/30), `tender-scan-daily` (06:00). The translation queue was created and dropped on 2026-04-15; `process-translation-queue` is deployed but unscheduled. The 9 HTTP jobs embed a service credential in `cron.job.command` (H-7); 7 of them run on the 5 s pg_net default timeout (H-29) (live 2026-09-30) | edge-functions-cron#11 |
| C7 | `mcp-server` = local stdio MCP server (GSC client) | A 1,947-line "Lead Monitor" server: 39 tools (leads 10, companies 6, tenders 8, funded startups 5, GSC 10), 3 resources, 2 prompts; stdio only, `--http` exits (mcp-server/src/index.ts:1933-1938). It calls Vercel `/api/scan-directory` and `/api/scrape-website` on www (mcp-server/src/index.ts:523-541, :678-683) and `/api/tender-scan`, `/api/funded-startups` on the apex (:1288-1290, :1550-1552): a hidden dependency to re-point in Phase 2 | python-bots-mcp-ci#21, #22 |
| C8 | Tenant custom domains ("laserkritis etc.") | Live `tenants` = `micronshub` + `laserkritis`, both `custom_domain` NULL (live 2026-09-30). Only subdomains are used, via Vercel's `*.micronshub.eu` wildcard domain and certificate. Cloudflare for SaaS is not needed for Phase 3; a proxied wildcard record + Universal SSL covers `*.micronshub.eu` | live |
| C9 | "Move nameservers to Cloudflare (Vercel stays as origin)" | The zone is on Papaki, not Vercel DNS: NS `dns1/dns2.papaki.gr`; `www` CNAME → `3096eb4eb748a48f.vercel-dns-017.com`; apex A `216.198.79.1`; wildcard `*` CNAME → `cname.vercel-dns.com`, which answers for `rfq.`, `_vercel.` and any unassigned label. A DNSSEC DS record exists at the registry (`14800 8 2 …`), so DS removal at Papaki must precede the NS move (live 2026-09-30) | live |
| C10 | Google Workspace MX on the apex; Resend for outbound | MX confirmed (5 × Google). SPF `v=spf1 include:_spf.google.com ~all` has no Resend include; Resend DKIM present; `send.micronshub.eu` has SPF but no MX; DMARC `p=none` (live 2026-09-30). `docs/operations/EMAIL_SETUP.md` documents Resend/SES MX on the apex, which is not what is live. Campaigns are sent through the Gmail API for the 2 live `google_workspace` sender accounts; Resend is only the default provider | docs-secrets-services#30, #31 |
| C11 | Vercel Analytics | None: no `@vercel/analytics` in `package.json`; tracking is GA4 `G-G6T5PMFLRH` + Google Ads `AW-17760727501` (index.html:70-73) + `usePageTracking` | frontend-routing-seo#17, docs-secrets-services#33 |
| C12 | Files: AWS S3 (presigned) + Supabase Storage | Both, with a split: RFQ uploads go to S3 (`rfq` scope, eu-north-1; api/s3.js:32-71) but src/components/rfq/RfqFileDownload.tsx:47, :100 and `sheet-metal-service` defaults read the Supabase bucket `rfq-files`; article images are on S3 (`articles` scope) and 755 `articles.featured_image` rows point at `*.amazonaws.com`. Live buckets, all public: `rfq-files` 3 objects, `quote-files` 0, `sitemaps` 17 objects / 6.76 MB, `tenant-laserkritis` 0 (live 2026-09-30) | live + audit |
| C13 | `tenders` + `tender-scan` use `lib/connectors` + `lib/scoring` | Only api/tender-scan.js:14-21 imports them; `api/tenders.js` is CRUD/CSV/stats only | api-lib#3 |
| C14 | `emails` = contact / rfq / rfq-pdf | Four actions: `contact`, `email` (default), `rfq`, `rfq-pdf` (api/emails.js:3-7). `notifications` multiplexes 22 actions: `nest`, `production-status`, `partner` (default) and 19 `inv-*` inventory actions (api/notifications.js:256-272; lib/inventory/index.js:480-530) | api-lib#2 |
| C15 | `/inventory/*` route family | No bare `/inventory/*`; inventory lives under `/dashboard/inventory/*` (src/App.tsx:303-309). Other unprefixed dashboard routes exist (`/customers`, `/partners`, `/rfq`, `/orders`; src/App.tsx:266-276). No `<Route path="*">` | frontend-routing-seo#15 |
| C16 | 25 redirects, "several with mojibake" | Exactly one mojibake source (bytes `C3 85 C2 84`, vercel.json:59) and it never matches a real request; the real URL `/pl/wyko%C5%84czenie-powierzchni` is handled only client-side after a 200. `permanent: true` emits **308**, not 301. The client map has 28 entries (3 not on the server) + 2 regex patterns (src/components/SEORedirects.tsx:14-73) | frontend-routing-seo#14 |
| C17 | `sheet-metal-service` … S3 storage | Download-only (sheet-metal-service/storage/s3_client.py:1-12); outputs are returned inline (base64 DXF/SVG/JSON), nothing is written to S3 or Storage. Single synchronous uvicorn worker; `PROCESSING_TIMEOUT = 120` is declared (sheet-metal-service/config.py:37) but not enforced. Phase 5 adds `CAD_SHARED_SECRET` and a wall-clock limit (details: private security note). VPS host not recorded in the repo (PLAN.md Q2); `scripts/freecad-unfold` is legacy | python-bots-mcp-ci#18, #19, #23, #24 |
| C18 | `generate-sitemap` / `auto-update-sitemap` "+ IndexNow" | IndexNow is submitted only by `translate-article` (supabase/functions/translate-article/index.ts), not by the sitemap functions; the key file must stay at `/indexnow_key.txt` (`public/indexnow_key.txt`) | edge-functions-cron#8 |
| C19 | `xometry-bot` scans `partner.xometry.eu` | GraphQL endpoint is `api.xometry.eu/partners/graphql` (xometry-bot/xometry_bot/config.py:17); the portal is only used for the manual MFA token capture | python-bots-mcp-ci#20 |
| C20 | Realtime | Only two subscriptions: `marketing_campaigns` UPDATE with a polling fallback (src/components/dashboard/marketing/CampaignProgress.tsx:41) and `user_emails` (src/pages/dashboard/EmailInbox.tsx:76); publication `supabase_realtime` contains exactly these two tables and is managed in the dashboard (live 2026-09-30) | data-layer#29 |

## 7. Answers to the brief §8 questions

| # | Question | Answer (condensed) | Detail |
|---|---|---|---|
| 1 | One Worker or several? | Three Workers + one Container app. `microns-site` (Static Assets, SEO handler, redirect table, sitemap routes, `/api/*` router serving the browser-facing subset: `emails`, `s3` replacement, `marketing?action=track` and `/api/track`, `notifications` partner/inventory CRUD; the rest over service binding `OPS`). `microns-ops` (Hono: `gsc`, `tenders`, `tender-scan`, `scrape-*`, `scan-directory`, `funded-startups`, marketing webhook/OAuth/Apollo; Cron Triggers, Queue consumers, Workflows, Durable Objects, Vectorize, AI Gateway, Browser Rendering, remote MCP). `microns-mail` (Email Worker). `microns-cad` (Container). An agent deploy can never take the SEO path down; the site Worker stays small and its deploys are gated by the parity diff. One repo: `workers/site`, `workers/ops`, `workers/mail`, `workers/cad` | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 2 | Which edge functions to port in Phase 5, which stay? | **Port** where Cloudflare adds retries, fan-out or unbounded runtime: the article pipeline (`enqueue-daily-article`, `process-article-queue`, `generate-daily-article`, `auto-translate-articles`, `translate-article`, `fix-article-links`, `auto-update-sitemap`, `generate-sitemap`, IndexNow) as the `content-daily` Workflow with a per-language Queue; collectors (`reddit-collector`, `hn-collector`, `tender-collector`) as Cron Triggers + Queue; marketing (`send-campaign` enqueue + per-recipient consumer with the `SenderLimiter` Durable Object, `process-followups`, `process-warmup`, `check-replies`). **Stay on Supabase**: anything invoked with a user JWT or the Auth admin API (`create-partner-auth-user`, `update-partner-password`, `admin-update-partner-password`, `send-user-email`, `xometry-review`), `leads-api` (gated per H-6), `post-to-social-media`, `telegram-*-bot` (webhook URLs), `extract-flat-pattern` / `generate-manufacturing-pdf` (repoint `UNFOLD_SERVICE_URL` when the CAD service moves). **Delete** after a log check: `enqueue-translations`, the 4 uncalled transactional `send-*`, test/diag functions (PLAN.md Q6) | [PLAN.md](PLAN.md) Phase 5 |
| 3 | Container vs Mac mini for `sheet-metal-service`? | Cloudflare Container `standard-1` (½ vCPU, 4 GiB, 8 GB disk) or `standard-2` (1 vCPU, 6 GiB, 12 GB), `max_instances` 2–3, `sleepAfter` ≈ 10 min, keep-warm ping in business hours; image ≈ 0.7–1 GB; cold start 10–30 s; the pipeline is synchronous and single-worker, so concurrency = instances. Fronted by the `CadRouter` Durable Object with a shared secret and an enforced wall-clock. Mac mini via Tunnel only for Fusion 360 jobs, same Queue → R2 → Supabase-row interface (PLAN.md Q22) | [ARCHITECTURE.md](ARCHITECTURE.md), [COSTS.md](COSTS.md) |
| 4 | Where does `TenantContext` resolve subdomains; any Vercel dependency? | src/utils/tenantApi.ts:29-51, purely client-side from `window.location.hostname`; nothing reads Vercel env. It needs only wildcard DNS + wildcard TLS: proxied `*` record + Universal SSL + Workers Route `*.micronshub.eu/*` (Workers Custom Domains do not support wildcards). src/pages/dashboard/tenants/TenantEditPage.tsx:667-678 hardcodes Vercel DNS instructions: rewrite in Phase 3 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 5 | Vercel-only behaviours in `api/` | Automatic JSON body parsing (`req.body`, string fallback in `s3.js`); `req.query` from rewrites (`?action=`, `?type=`, `?lang=`, `?connectors=true`); `res.status().json()/send()/end(Buffer)/redirect()/setHeader()`; per-function `OPTIONS`; module-scope `process.env`; `VERCEL_URL` for the Google OAuth redirect (api/marketing.js:47); Node built-ins (H-20); no streaming; Hobby duration limits; 4.5 MB body cap. `tender-scan`, the funded-startups scan, `gsc` bulk actions and `nest` exceed a request lifetime → Queues/Workflows/Container. Port with a thin Express-compatible shim over Hono, then refactor per route | [PLAN.md](PLAN.md) Phase 2 |
| 6 | Which routes return 200 for unknown slugs? Fix during the port? | See H-9. Replicate the 200s in Phase 1 (parity gate); add `SEO_STRICT_404` / flag `seo.strict_404` returning 404 + shell for unknown-slug classes; enable after 2 weeks of flat GSC coverage post-cutover (PLAN.md Q5) | [SEO_PARITY.md](SEO_PARITY.md) |
| 7 | Techpilot: e-mail, portal, or both? | Owner to answer: PLAN.md Q3 | [PLAN.md](PLAN.md) |
| 8 | What in `check-replies` / `process-followups` / `process-warmup` can move to Email Workers? | None of them is live (C5). Apex MX untouched. Email Routing on the subdomain `rfq.micronshub.eu` with explicit addresses `rfq@` and `replies@` → `microns-mail` (catch-all rules exist only on the apex). Resend-sent mail uses `Reply-To: replies@rfq.micronshub.eu`; replies are attributed by `In-Reply-To`/`References` against stored `Message-ID`s. Gmail-sent campaigns keep their Workspace inbox, so a Cron-Trigger Gmail poller (*/10, Phase 4) covers the 2 Workspace sender accounts. Follow-ups gain `In-Reply-To`/`References` headers | [AGENTS.md](AGENTS.md) |

## 8. Verdict on the brief §3 target mapping

| Today | Brief's target | Verdict | What changes |
|---|---|---|---|
| Vite `dist/` + SPA fallback | Workers Static Assets, `single-page-application` | Accept with changes | `html_handling: "none"`, `run_worker_first: true`; delete `public/_redirects` (H-3) and `public/index.html`; keep the prerender output for now (Vercel's failure-path behaviour) |
| `middleware.ts` | Worker `fetch` handler, worker-first for `/{lang}` | Accept | Shell via `env.ASSETS.fetch` (H-4); anon key from `env` with loud failure; per-isolate `Map` caches + KV `SEO_CACHE` 1 h / 30 s negative; `X-Seo-Source` and `Cache-Control` byte-identical; `middleware/*` modules imported unchanged |
| `vercel.json` → `_redirects` + `_headers` | File-based | **Challenge → in-Worker redirect table** | `_redirects` runs in the asset layer (H-3), cannot do NFC-decoded matching, and Vercel emits 308. One table generated from `vercel.json` + `SEORedirects.tsx`; `_headers` optional, only for `/assets/*` |
| `api/*.js` → Hono in the same Worker | One Worker | **Challenge → split** | Browser-facing subset in `microns-site`, the rest in `microns-ops` via service binding `OPS`; long/CPU-heavy routes → Queues/Workflows/Container; Express shim first; auth gates, Turnstile and rate limits added (H-6) |
| AWS S3 + `VITE_AWS_*` | R2 + Worker presign | Accept for new objects only | Two buckets: `microns-public` (custom domain `files.micronshub.eu`) and `microns-private` (no public access; presigned via `aws4fetch` against the R2 S3 API, or Worker-streamed). Legacy S3 stays read-only (H-17, PLAN.md Q11). `VITE_AWS_*` already out of the bundle (C2): rename the env vars. Fix the `rfq-files` split (C12) |
| Edge functions + pg_cron stay until Phase 5 | Stay | Accept | Reconcile repo vs live first (P0-5; 15 live-only, 5 undeployed); delete dead functions |
| `xometry-scan` → Cron Trigger or Container | Either | Accept; runtime is PLAN.md Q8 | Browser Rendering cannot refresh the MFA token; alert on 401 instead of failing silently; keep the current 7×/day hours |
| `sheet-metal-service` → Containers or Mac mini | Either | Accept Containers | `microns-cad` (`CadContainer`) fronted by `CadRouter` in `microns-ops`; `/flat-pattern` byte-identical; shared secret + wall-clock; Mac mini later behind the same interface |
| `check-replies` + Email Worker on `rfq.micronshub.eu` | Keep + add | Accept with correction | `check-replies` is not live (C5); subdomain Email Routing + `Reply-To` attribution; Gmail poller for the 2 Workspace accounts |
| `mcp-server` → remote MCP | Remote | Accept | `MicronsMcp` (`McpAgent`) in `microns-ops` on `mcp.micronshub.eu` with Access + OAuth; stdio server stays for Claude Desktop; its Vercel API calls move to `microns-ops` (C7) |
| Claude/Gemini via AI Gateway | Gateway | Accept | Gateway `microns` with role-based routes `extract` (Sonnet-class), `classify` (Haiku-class), `translate` (Gemini Flash-class), `embed` (`@cf/baai/bge-m3`); concrete models chosen at Phase 4/5 start (repo Gemini model IDs are retired); every call carries `cf-aig-metadata` |
| Vercel Analytics → Web Analytics + Logs | Replace | **Nothing to migrate** | No Vercel Analytics exists (C11). Web Analytics automatic setup stays off (edge script injection breaks parity); Workers Logs + Analytics Engine `microns_events` |
| Tenant `custom_domain` → Cloudflare for SaaS | SaaS | **Defer** | No custom domain exists (C8); subdomains via wildcard record + Workers Route + Universal SSL; SaaS when the first real custom domain appears |

Related correction to brief §5 Phase 3 ("flip `www`/apex to the Worker custom domain"): `www` moves to a Workers Route `www.micronshub.eu/*` on a proxied placeholder record (a Custom Domain cannot be created while the `www` CNAME exists, and a Route keeps rollback a single record flip); the apex becomes a Single Redirect Rule to `https://www.micronshub.eu${path}${query}` with the status seen in the baseline; DS removal at Papaki precedes the NS move (C9). Runbook in [PLAN.md](PLAN.md).

## 9. Live refresh delta 2026-09-27 → 2026-09-30

| Item | 2026-09-27 | 2026-09-30 | Consequence |
|---|---|---|---|
| Published articles | 2,326 | 2,344 | Public URL estimate ≈ 2,580 → ≈ 2,610 |
| `leads` | 692 | 700 | None |
| `gsc_monitored_urls` | 2,438 | 2,456 | None |
| Newest article, en/de/es/fr/it/nl | 2026-09-27 | 2026-09-30 | Daily generation is running |
| Newest article, cs/da/fi/hu/nb/pl/sv | 2026-09-11 (16 days behind) | 2026-09-11 (19 days behind) | Translation lag growing (H-19) |
| Newest article, pt | 2026-09-22 | 2026-09-22 (8 days behind) | Same |
| pg_cron outcome | Cron status only | `net._http_response`: 89 × HTTP 200, 39 × 5 s timeout out of 128 retained calls | New H-29 |
| Credentials stored in tables | Part of H-21 | Separated and re-assessed | New H-30 |
| `resend-webhook` (live-only) | Assumed reachable | Deployed with JWT verification on, so Resend deliveries cannot succeed; treated as unused pending a log check | PLAN.md Q6 |
| Vercel project domains | Apex, www, wildcard | Also `on-demand-craft-greece.vercel.app` (duplicate host; must not be linked); apex redirect status unset in the API (`redirectStatusCode: null`), read it from the baseline | H-11, H-24 |
| Repository visibility | Not considered | Public | Security detail moved to the private note; P0-2 moved to pre-flight; PLAN.md Q18 |
| Unchanged | — | 98 `service_pages`, 126 `content_pages`, 755 S3 image URLs, 2 RFQs, 2 orders, 21 customers, 72 public tables, 40 edge functions, 10 cron jobs, 2 tenants, 4 buckets, 2 sender accounts, DNS records (SOA serial 2026040806, no CAA, no AAAA, DS present) | — |

Refinements applied to the approved plan (all docs in this folder follow them):

| Plan (2026-09-27) | Now | Why |
|---|---|---|
| One R2 bucket `microns-files` | `microns-public` + `microns-private` | A public custom domain can never expose customer files |
| AI Gateway routes with fixed model IDs | Role-based routes `extract`, `classify`, `translate`, `embed` | Pick current models at Phase 4/5 start |
| Credential rotation in Phase 2 | Pre-flight P0-2 | Credentials are re-issued before any new consumer is created (details private) |
| 17 draft questions | 22 final questions in PLAN.md | Q18–Q22 added (repository visibility, sign-ups, LLM budget, Google Ads API, Mac mini timeline) |
| H-1…H-28 | H-1…H-30; H-5, H-6, H-7, H-15, H-21 reworded for a public repository | Live refresh and public-repository handling |

## 10. Hazard index H-1…H-30

Severity follows the plan and its canonical refinements. Where the plan gave none (marked *), the severity is this README's assessment; [RISKS.md](RISKS.md) is authoritative for likelihood and impact. "Owning doc" is where the mitigation is specified; every hazard also appears in RISKS.md.

| ID | Severity · area | Summary | Owning doc |
|---|---|---|---|
| H-1 | critical · SEO | Production challenges non-browser clients (429 + `x-vercel-mitigated: challenge`); baseline must come from an allow-listed vantage point; Cloudflare bot posture must allow verified bots (Q1) | [SEO_PARITY.md](SEO_PARITY.md), P0-3 |
| H-2 | critical · delivery | `auto-merge-claude.yml` merges every `claude/**` push into `main`, which Vercel deploys; gate before Phase 1 code | [PLAN.md](PLAN.md) P0-1 |
| H-3 | critical · SEO | `public/_redirects` (`/* /index.html 200`) would hijack any path the Worker delegates to assets; delete in Phase 1 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| H-4 | critical · SEO | The Worker must not fetch its own origin for the shell; use `env.ASSETS.fetch` and fail loudly on non-2xx | [ARCHITECTURE.md](ARCHITECTURE.md) |
| H-5 | critical · security | An authorisation gap in tenant-role assignment must be closed before the agent layer trusts tenant roles. Details: private security note. | [RISKS.md](RISKS.md) |
| H-6 | critical · security | Most `/api/*` routes and the `leads-api` edge function do not authenticate callers, and several RLS policies are broader than intended. Phase 2 adds Supabase-JWT/Access gates, Turnstile and rate limits; Phase 6 remediates RLS. Details: private security note. | [RISKS.md](RISKS.md), [PLAN.md](PLAN.md) Phases 2, 6 |
| H-7 | high · security | Supabase service credentials are embedded in pg_cron job commands and many env reads; they are rotated in pre-flight P0-2 and removed from `cron.job` when jobs move in Phase 5. Details: private security note. | [PLAN.md](PLAN.md) P0-2 |
| H-8 | high* · parity | All 210 prerendered files are shadowed in production (middleware serves the un-prerendered shell; `createRoot().render`, src/main.tsx:7); the Worker must be first for every language route | [SEO_PARITY.md](SEO_PARITY.md) |
| H-9 | high* · parity | Soft 404s: unknown slugs, `/EN`, `.html` suffix and known-slug + extra segment return 200; replicate, then `seo.strict_404` (Q5) | [SEO_PARITY.md](SEO_PARITY.md) |
| H-10 | medium* · parity | Trailing and double slashes are normalised by the middleware; Vercel-level behaviour needs the baseline | [SEO_PARITY.md](SEO_PARITY.md) |
| H-11 | medium* · parity | Vercel redirects are 308; the apex → www status must be read from the baseline | [SEO_PARITY.md](SEO_PARITY.md) |
| H-12 | high* · parity | Sitemap index → 6.2 MB `sitemap-complete.xml` from Storage; `sitemap-index.xml` / `sitemap-{lang}.xml` serve stale Dec-2025 blobs; headers must match (api/sitemap.js:392-393); Worker uses the Cache API | [SEO_PARITY.md](SEO_PARITY.md) |
| H-13 | low* · parity | Middleware ignores the hostname: tenant hosts get the Microns SEO body and `www` canonical; keep for parity (Q9) | [SEO_PARITY.md](SEO_PARITY.md) |
| H-14 | high* · parity | Tracking/unsubscribe URLs in sent e-mails, `tender-collector`'s `/api/tender-scan` and `/indexnow_key.txt` must exist at identical paths before DNS moves | [INVENTORY.md](INVENTORY.md) |
| H-15 | medium · security | Resend webhook signature verification must be reimplemented to Resend's Svix scheme. Details: private security note. | [RISKS.md](RISKS.md) |
| H-16 | medium* · deliverability | `send.micronshub.eu` SPF without MX; apex SPF lacks Resend; DMARC `p=none`; check in Phase 3 without touching apex MX | [RISKS.md](RISKS.md) |
| H-17 | high* · data | 755 article images and RFQ files are on S3 with persisted `*.amazonaws.com` URLs; keep S3 read-only (Q11) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| H-18 | medium* · compute | Nesting engine (`lib/nesting`, 50 s CPU budget) exceeds Worker CPU limits → Container or Durable Object | [ARCHITECTURE.md](ARCHITECTURE.md) |
| H-19 | medium* · content/SEO | Translation lag: 7 languages 19 days behind (live 2026-09-30); repo Gemini models retired; fixed by the `content-daily` Workflow + `translations` Queue | [AGENTS.md](AGENTS.md) |
| H-20 | medium* · port | Repo middleware/API need `nodejs_compat` (Buffer, `crypto.createSign`, `createHmac`, `@aws-sdk`, `resend`) and handle module-scope `process.env` | [wrangler.jsonc.draft](wrangler.jsonc.draft) |
| H-21 | low–medium · mixed | Stale `public/index.html`; `cdn.gpteng.co/gptengineer.js` on every page (index.html:90); a Maps Embed key in `src/pages/Contact.tsx` must be referrer-restricted and gain the preview hostnames; CORS `*` with credentials on `/api/*` (vercel.json:165-172); `hostname.includes('micronshub.eu')` substring match (src/utils/tenantApi.ts:38); relative `/functions/v1/…` calls, broken today (src/utils/partnerAuthUtils.ts:26, :59; leave as is for parity); `tests/nest.test.js` never runs; `src/integrations/supabase/types.ts` is UTF-16 and covers 25 of the 72 live tables. Supabase security advisor findings and credential-storage findings: private security note. | [RISKS.md](RISKS.md) |
| H-22 | high · preview | `/reset-password` has no route (src/contexts/AuthContext.tsx:220); the Supabase Auth Site URL / redirect allowlist must include the preview host | [PLAN.md](PLAN.md) P0-6 |
| H-23 | medium · build | Both `bun.lockb` and `package-lock.json`, no `engines`/`.nvmrc`; prerender skips silently; pin and compare `dist/` | [PLAN.md](PLAN.md) P0-7 |
| H-24 | high · parity | Apex → www, HTTP → HTTPS, HSTS and default headers live in the Vercel dashboard; capture and reproduce | [SEO_PARITY.md](SEO_PARITY.md) |
| H-25 | low · scope | `www.laserkritis.gr` is served by nginx on its own host, not Vercel; confirms C8 (Q17) | [INVENTORY.md](INVENTORY.md) |
| H-26 | high · Phase 5 correctness | Edge functions are deployed without CI, so repo source ≠ live source; pull live source and `cron.job` before porting | [PLAN.md](PLAN.md) P0-4, P0-5 |
| H-27 | medium · ops | Worker bundle sizes must be measured (`wrangler deploy --dry-run --outdir`) at the Phase 1 exit gate | [PLAN.md](PLAN.md) Phase 1 |
| H-28 | low · parity | Parity diff must compare HEAD, headers and `OPTIONS` on `/api/*`; `robots.txt` gaps are byte-served as is; `customers` rows come from trigger `on_auth_user_created_customer` (supabase/migrations/20260806_phase2_rls_per_user.sql:415) | [SEO_PARITY.md](SEO_PARITY.md) |
| H-29 | medium · observability | pg_net default 5 s timeout: `cron.job_run_details` shows "succeeded" for every run, but `net._http_response` (≈ 6 h retention) shows 39 of 128 recent calls ended with "Timeout of 5000 ms reached" (jobs without `timeout_milliseconds`: sitemap, fix-links, reddit ×3, hn, tender). Function outcomes are unobserved. Phase 5 parity must compare outputs, and ported jobs record outcomes in `agent_runs` | [PLAN.md](PLAN.md) Phase 5, [AGENTS.md](AGENTS.md) |
| H-30 | high · security | Some integration credentials are stored in database tables whose read access is broader than intended. Details: private security note. | [RISKS.md](RISKS.md) |

## 11. Platform facts verified against Cloudflare docs

All rows: CF docs (verified 2026-09-27). Prices: list price — re-check at execution.

| Topic | Fact | Used for |
|---|---|---|
| `_redirects` in Workers Static Assets | Supported (2,000 static + 100 dynamic rules, default status 302, 200 proxy rules); not applied to responses served by Worker code | H-3: delete `public/_redirects`; in-Worker redirect table |
| `html_handling` | Default `auto-trailing-slash` 307-redirects `/index.html` → `/` and `/folder` → `/folder/`; `none` serves exact file paths and hands the rest to `not_found_handling` | `html_handling: "none"` |
| `run_worker_first` | `true` or an array of glob patterns; the default serves matching assets first | `run_worker_first: true` |
| Workers Paid limits | CPU 30 s default / 5 min max per request; startup 1 s; 10,000 subrequests; 6 simultaneous outgoing connections; 128 MB memory; Cron/Queue consumer wall time 15 min; Workflow steps unlimited wall time | Scrapers cap concurrency at 6; long jobs → Workflows/Container |
| Containers | `lite` 1/16 vCPU 256 MiB · `basic` ¼ vCPU 1 GiB · `standard-1` ½ vCPU 4 GiB · `standard-2` 1 vCPU 6 GiB · `standard-3` 2 vCPU 8 GiB · `standard-4` 4 vCPU 12 GiB; $0.0000025/GiB-s, $0.000020/vCPU-s, $0.00000007/GB-s disk, $0.025/GB egress (EU); included 25 GiB-h, 375 vCPU-min, 200 GB-h, 1 TB egress per month (list price — re-check at execution) | `microns-cad` sizing, [COSTS.md](COSTS.md) |
| Custom Domains | No wildcard records; cannot be created on a hostname that already has a CNAME; the DNS record is created automatically | Workers Routes for `www` and `*.micronshub.eu` |
| Universal SSL | Covers the apex and first-level subdomains on a full setup; all plans | `laserkritis.micronshub.eu` without Cloudflare for SaaS |
| Web Analytics | Automatic setup injects the beacon at the edge for proxied zones; the manual snippet is the only parity-safe option | Automatic setup off |
| Email Routing | Works on zone subdomains (records added automatically, up to 30 domains per zone); catch-all only on the apex; Email Workers get `message.raw` and headers and can `forward`, `reply`, `setReject`; inbound size limit example 25 MiB | `rfq.micronshub.eu`, `microns-mail` |
| Workflows | `step.waitForEvent` default timeout 24 h, max 365 d; event `type` allows letters, digits, `-`, `_` only; events sent early are buffered | `quote` Workflow approval step |
| Access | Service tokens via `CF-Access-Client-Id` / `CF-Access-Client-Secret` with a Service Auth policy; can protect Worker version/preview URLs and production; `wrangler versions upload --preview-alias staging` gives a stable preview URL | Preview gating, parity tool |
| Rate limiting rules | Free 1 rule (10 s window, IP), Pro 2, Business 5; path matching on Free | One `/api/*` rule + Workers Rate Limiting binding `API_RATE_LIMIT` |
| Default cache | HTML, JSON and XML are not cached by default; `max-age=0`, `private`, `no-store` prevent caching; caching HTML needs an explicit Cache Rule (none planned) | Middleware `Cache-Control` already prevents edge caching; sitemaps use the Cache API (H-12) |

## 12. Verification record

| Stage | Result |
|---|---|
| Run 1: audit workflow `wf_df2a0182-e6c` (2026-09-27) | 6 readers completed. 24 of 33 corrections received two verdicts, all confirmed by both lenses. The last two verification batches and the completeness critic did not run (session limit); those 9 corrections were cross-checked against live state instead (Workspace MX via DoH, `VITE_AWS_*` grep + `vite.config.ts`, Vercel Analytics grep, Realtime usage, Gmail-API sending, migrations vs live schema, tenant/RLS policies) |
| Run 2: same workflow resumed after the usage-limit reset (run id not recorded in the saved output) | 19 agents (6 readers, 12 verifiers in 6 batches × 2 lenses, 1 completeness critic), 0 errors; 15 agents reused from run 1, 4 executed fresh; 445,416 tokens, 95 tool calls |
| Corrections | **33/33 confirmed by both lenses**, 0 contested, 0 rejected. Reader verdicts on the brief's claims: 21 partially correct, 9 corrected, 3 unverifiable (VPS host, Xometry scan runtime, Google MX in repo docs). Consolidated into C1–C20 and §5 |
| Raw audit volume | 280 inventory rows (63 secret/env names, 55 config rules, 46 external APIs, 33 edge-function rows, 17 route families, 16 table groups, 15 API endpoints, 13 static files, 11 crons, 10 services, 1 CI workflow); 93 raw hazards (8 critical, 24 high, 39 medium, 22 low) deduplicated into H-1…H-21 and RISKS.md; 68 claims; 67 open questions |
| Completeness critic | 14 missing items, 8 contradictions, 14 parity risks. 9 were already in the plan; the rest became H-22…H-28 and questions now PLAN.md Q15–Q17. Contradictions resolved with live data (live `cron.job` dump, live fix-links body, live edge-function list) or recorded as decisions (CORS handling on every `/api` route; `/` stays a 200 shell) |
| Manual items from live state | DNSSEC DS record; wildcard CNAME catching `rfq.` and `_vercel.`; `send.micronshub.eu` SPF without MX; the 755 `amazonaws.com` image URLs; per-language translation lag; the tenant-role policy finding (H-5); the 15 live-only edge functions |
| Live refresh (2026-09-30) | Added H-29 and H-30; updated counts (§9); confirmed DNS, tenants, buckets and edge-function/cron inventory unchanged |
| This README (2026-09-30) | Every `path:line` re-read against the repository. One raw count corrected: `notifications` has 19 `inv-*` actions (22 actions in total), not 18 (lib/inventory/index.js:480-530) |

Remaining gaps (each owned by a pre-flight item or a PLAN.md question):

| Gap | Owner item |
|---|---|
| HTTP/SEO baseline of production (blocked by the Vercel challenge) | P0-3, Q1 |
| Attack Challenge Mode setting | Q1 |
| Exact Vercel env-var names (API returned 403) | P0-4 |
| VPS host, spec and cost; Supabase plan tier | Q2 |
| Live source of the 40 deployed edge functions | P0-5, Q6 |
| Supabase Auth URL configuration | P0-6, Q16 |
| Package manager and prerender behaviour of the Vercel build | P0-7, Q15 |
| Papaki account holder and DNSSEC lead time | P0-9, Q7 |
