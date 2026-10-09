# Microns Hub to Cloudflare migration: inventory

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [README.md](README.md) · [PLAN.md](PLAN.md) · [inventory.csv](inventory.csv) · [ARCHITECTURE.md](ARCHITECTURE.md) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [SEO_PARITY.md](SEO_PARITY.md) · [AGENTS.md](AGENTS.md) · [RISKS.md](RISKS.md) · [COSTS.md](COSTS.md)

This is Phase 0 deliverable 1 (brief §7 item 1): every route family, redirect, API endpoint and action, edge function (repo and live), cron job, secret or environment name, external API, special static file, storage bucket, database table group, DNS record, domain, CI workflow, service and configuration rule, with where it runs today and where it goes. [inventory.csv](inventory.csv) is the complete record (386 rows × 16 columns); the tables below show the key columns of every row.

Evidence tags: `path:line` = this repository at commit `9afcba8`; "live 2026-09-30" = read-only capture on that date (Supabase SQL `SELECT`s, edge-function list, Vercel project domains, DNS over HTTPS); `audit:<reader>#<n>` = item `n` of a Phase 0 audit reader's inventory (raw audit kept outside the repo); "CF docs (verified 2026-09-27)" = Cloudflare documentation checked during planning; "plan §n" and `C1`…`C20` = the approved Phase 0 proposal of 2026-09-27 and its corrections, summarised in [README.md](README.md); `P0-1`…`P0-9` and `Q1`…`Q22` = pre-flight items and open questions in [PLAN.md](PLAN.md); `DV-n` and `D-n` = deviations and owner defaults of the Phase 2 build, recorded in [PLAN.md](PLAN.md) §5.2 (rows updated to the build on 2026-10-04); `DC-n`, `DF-n` and `OW-n` = deviations, defaults and owner steps of the Phase 4 build, recorded in [PLAN.md](PLAN.md) §5.4 (rows updated on 2026-10-07); `DV5-n`, `BA5-n`, `OW5-n` and the switch-over steps `S1`…`S9` of the Phase 5 build, recorded in [PLAN.md](PLAN.md) §5.5 (rows updated on 2026-10-09; Phase 5 defaults such as `D-26` are named there too).

Security wording: this repository is public. Security findings appear only as a hazard reference and the phrase "auth gap - see private note". Details: private security note (delivered to the owner out of band, not in this public repo). No secret value appears in this file or the CSV; names only.

## 1. How to read this inventory

### 1.1 Sources

| Source | What it contributed |
|---|---|
| Six audit readers (api-lib, edge-functions-cron, frontend-routing-seo, python-bots-mcp-ci, data-layer, docs-secrets-services) | 280 raw inventory items; duplicates merged (one row per thing, richest notes kept), wording rewritten to the canonical names and the security rule above |
| Repo parse | `vercel.json` (25 redirects, 8 rewrites, 3 header rules), `src/components/SEORedirects.tsx`, `public/`, `.github/workflows/*`, `api/*.js`, `lib/inventory/index.js` (action switch), `supabase/functions/*` (env names via `Deno.env.get`), `supabase/config.toml`, env names via grep of `process.env`, `import.meta.env`, `Deno.env.get`, `os.getenv`, and `.env.example` |
| Live, 2026-09-30 | 41 deployed edge functions (slug, version, `verify_jwt`), 10 `cron.job` rows (command parsed without reading the credential), run statistics, 72 public tables, 4 storage buckets and the 17 sitemap objects, content counts, tenants, `app_settings` keys (values not read), Vercel project domains, DNS |

A row describes something that exists today (in the repo or live). Names that only the target introduces (new secrets, R2 buckets, hostnames) are listed separately in §10.2 and §17.2 and are not CSV rows.

### 1.2 Column dictionary

| Column | Meaning | Values |
|---|---|---|
| `id` | Stable, kind-prefixed identifier (see 1.3). Never reused. | e.g. `EF-translate-article`, `CRON-15`, `RD-01` |
| `kind` | What the row is. | one of the 18 kinds in 1.3 |
| `name` | The thing itself: path, slug, env name, record. Redirect sources are byte-exact copies of `vercel.json`. | free text |
| `location` | Where it is defined today: `path:line` in this repo, a live object (cron job id, bucket, DNS zone) or a dashboard. | free text |
| `runs_on_today` | Hosting or storage today. | e.g. Vercel Node function, Supabase Edge Functions, pg_cron, VPS, GitHub Actions |
| `trigger` | What starts it. | HTTP method, schedule (UTC), webhook, build |
| `callers` | Who calls or reads it (files, services, people). | free text |
| `external_apis` | Outbound hosts or APIs it depends on. | free text |
| `secrets_env_names` | Secret or environment variable NAMES it reads (never values). For `secret-env` rows: the name and its aliases. | names only |
| `live_status` | State observed live on 2026-09-30 (or the repo state when there is no live object). | `deployed-vN`, `live-only deployed-vN`, `not-deployed`, `active`, `dropped`, `live 2026-09-30`, … |
| `proposed_target` | What it becomes, in words. | free text |
| `target_component` | Where it ends up. | see 1.4 |
| `migration_phase` | Phase in which the change happens. | `0`–`6`, `stays` (no move), `delete` (nothing to migrate) |
| `parity_notes` | Behaviour that must be preserved, drift found, or caveats. | free text |
| `risk_refs` | Hazard IDs from [README.md](README.md) §10 / [RISKS.md](RISKS.md). | `H-1` … `H-30`, `;`-separated |
| `source` | Evidence: audit reader and item number, repo path, or live capture. | e.g. `audit:api-lib#5; live 2026-09-30` |

CSV format: RFC 4180, UTF-8 without BOM, LF line endings, one header row, 16 columns on every row. Multi-value cells use `; ` as the separator.

### 1.3 ID prefixes and kinds

| Prefix | kind | Rows | Meaning |
|---|---|---|---|
| `RF-` | `route-family` | 18 | Public or app URL families and their server-side behaviour |
| `RD-` | `redirect` | 30 | `RD-01`…`RD-25` = `vercel.json` in file order; `RD-26`…`RD-28` = client-only map entries; `RD-P1`/`RD-P2` = client regex patterns |
| `RW-` | `rewrite` | 8 | `vercel.json` rewrites in file order |
| `HR-` | `header-rule` | 3 | `vercel.json` header rules in file order |
| `API-` | `api-endpoint` | 14 | HTTP endpoints (Vercel `api/*.js` and the CAD service) |
| `ACT-` | `api-action` | 50 | One row per action of a multiplexed endpoint (`?action=`, method or `type`) |
| `EF-` | `edge-function` | 46 | Supabase Edge Functions: union of the repo and the live project |
| `CRON-` | `cron` | 12 | `CRON-<jobid>` = live pg_cron job; `CRON-H<n>` = historical repo-only job |
| `ENV-` | `secret-env` | 64 | Secret or environment NAME (never a value), including secrets kept in DB tables |
| `EXT-` | `external-api` | 27 | Third-party APIs and outbound hosts |
| `STA-` | `static-file` | 21 | Special files served from `public/` or the build output |
| `BKT-` | `storage-bucket` | 7 | Supabase Storage (`sb`) and AWS S3 (`s3`) buckets |
| `DB-` | `db-table-group` | 13 | Groups covering all 72 live public tables |
| `DNS-` | `dns-record` | 26 | One row per live DNS record (plus the absent CAA) |
| `DOM-` | `domain` | 8 | Hostnames in use today |
| `CI-` | `ci-workflow` | 2 | GitHub Actions workflows |
| `SVC-` | `service` | 20 | Running services, shared libraries, local tools |
| `CFG-` | `config-rule` | 17 | Configuration that lives in build files or dashboards |

### 1.4 target_component values

| Value | Meaning | Rows |
|---|---|---|
| `microns-site` | Worker + Static Assets: SEO handler, redirect table, sitemap routes, browser-facing `/api/*`, tenant hosts | 117 |
| `microns-ops` | Worker (Hono): ops/admin API, Cron Triggers, Queues, Workflows, Durable Objects, AI Gateway, remote MCP | 107 |
| `microns-mail` | Email Worker on `rfq.micronshub.eu` | 1 |
| `microns-cad` | Container app built from `sheet-metal-service/Dockerfile`, fronted by the `CadRouter` DO | 4 |
| `supabase-stays` | Stays on Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron) | 46 |
| `cloudflare-zone` | Zone-level Cloudflare setting (Redirect Rule, HTTPS, HSTS, bot and cache settings) | 3 |
| `cloudflare-dns` | DNS record in the Cloudflare zone | 22 |
| `r2` | R2 bucket `microns-public` or `microns-private` | 7 |
| `delete` | Removed; nothing to migrate | 38 |
| `owner-decision` | Needs an answer from the owner (PLAN.md question cited in the row) | 7 |
| `unchanged` | Outside the migration; stays where it is | 34 |

Phases: 0 Audit + pre-flight · 1 Site + SEO Worker (preview only) · 2 API port · 3 Zone + cutover · 4 Agent layer · 5 Consolidate compute · 6 Hardening + decommission ([PLAN.md](PLAN.md)).

## 2. Counts (computed from inventory.csv)

Total rows: **386**.

### 2.1 By kind

| kind | Rows |
|---|---|
| `route-family` | 18 |
| `redirect` | 30 |
| `rewrite` | 8 |
| `header-rule` | 3 |
| `api-endpoint` | 14 |
| `api-action` | 50 |
| `edge-function` | 46 |
| `cron` | 12 |
| `secret-env` | 64 |
| `external-api` | 27 |
| `static-file` | 21 |
| `storage-bucket` | 7 |
| `db-table-group` | 13 |
| `dns-record` | 26 |
| `domain` | 8 |
| `ci-workflow` | 2 |
| `service` | 20 |
| `config-rule` | 17 |
| **total** | **386** |

### 2.2 By target component

| target_component | Rows |
|---|---|
| `microns-site` | 117 |
| `microns-ops` | 107 |
| `microns-mail` | 1 |
| `microns-cad` | 4 |
| `supabase-stays` | 46 |
| `cloudflare-zone` | 3 |
| `cloudflare-dns` | 22 |
| `r2` | 7 |
| `delete` | 38 |
| `owner-decision` | 7 |
| `unchanged` | 34 |
| **total** | **386** |

### 2.3 By migration phase

| migration_phase | Rows |
|---|---|
| `0` | 5 |
| `1` | 93 |
| `2` | 92 |
| `3` | 32 |
| `4` | 3 |
| `5` | 71 |
| `6` | 17 |
| `stays` | 71 |
| `delete` | 2 |
| **total** | **386** |

### 2.4 Kind by phase

| kind | 0 | 1 | 2 | 3 | 4 | 5 | 6 | stays | delete | total |
|---|---|---|---|---|---|---|---|---|---|---|
| `route-family` | · | 16 | · | 1 | · | · | 1 | · | · | 18 |
| `redirect` | · | 30 | · | · | · | · | · | · | · | 30 |
| `rewrite` | · | 6 | 2 | · | · | · | · | · | · | 8 |
| `header-rule` | · | 2 | 1 | · | · | · | · | · | · | 3 |
| `api-endpoint` | · | 1 | 11 | · | · | 2 | · | · | · | 14 |
| `api-action` | · | 4 | 46 | · | · | · | · | · | · | 50 |
| `edge-function` | · | · | · | · | 1 | 33 | 1 | 11 | · | 46 |
| `cron` | · | · | · | · | · | 10 | · | · | 2 | 12 |
| `secret-env` | 2 | 5 | 14 | · | · | 14 | 6 | 23 | · | 64 |
| `external-api` | · | 2 | 8 | 1 | · | 7 | 1 | 8 | · | 27 |
| `static-file` | · | 20 | · | · | · | · | 1 | · | · | 21 |
| `storage-bucket` | · | · | 2 | 1 | · | 2 | 2 | · | · | 7 |
| `db-table-group` | · | · | · | · | · | · | · | 13 | · | 13 |
| `dns-record` | · | · | · | 22 | · | · | · | 4 | · | 26 |
| `domain` | · | · | · | 4 | 1 | · | 1 | 2 | · | 8 |
| `ci-workflow` | 1 | · | · | · | · | 1 | · | · | · | 2 |
| `service` | 1 | 2 | 5 | · | 1 | 1 | 3 | 7 | · | 20 |
| `config-rule` | 1 | 5 | 3 | 3 | · | 1 | 1 | 3 | · | 17 |

## 3. Route families

The SEO handler rows replace `middleware.ts`; everything else falls through to Static Assets with SPA fallback. Soft-404 behaviour is replicated in Phase 1 (H-9, PLAN.md Q5).

| ID | Family | Today | Target | Phase | Parity notes | Risks |
|---|---|---|---|---|---|---|
| `RF-root` | / (root) | Vercel static /index.html via SPA rewrite (middleware matcher does not cover /); 200 shell, client navigate() to /{saved language or en} | SPA fallback via ASSETS (200 shell, client redirect unchanged); a server redirect at / is an owner decision, not a side effect | `1` | No Accept-Language, no cookie, no server redirect today; shell has og:url = homepage, no canonical (index.html:17) | H-9; H-28 |
| `RF-lang-home` | /{lang} homepage (14 URLs) | Vercel Routing Middleware rewrites the /index.html shell with content_pages 'home' (db) or i18n; prerendered dist/{lang}/index.html is shadowed | SEO handler in microns-site (run_worker_first: true; shell via env.ASSETS.fetch) | `1` | Tenant hosts also receive the Microns Hub SEO body and www canonical (middleware ignores hostname) | H-4; H-8; H-13 |
| `RF-services-index` | /{lang}/{services} services index (14 URLs + English alias /{lang}/services) | Middleware + service_pages index row (db) else i18n; prerendered file shadowed | SEO handler in microns-site | `1` | X-Seo-Source db or i18n | H-8 |
| `RF-service-detail` | /{lang}/{services}/{service} service detail (84 URLs = 6 x 14, + English-id aliases) | Middleware + service_pages row (db) else i18n fallback; prerendered file shadowed | SEO handler in microns-site | `1` | Unknown service slug under a known services segment returns the SPA shell with 200 (soft 404) | H-8; H-9 |
| `RF-content-pages` | /{lang}/{industries\|about\|contact\|our-work} (56 URLs + English aliases) | Middleware content-page arm: content_pages row (db) else legacy renderer; prerendered file shadowed | SEO handler in microns-site | `1` | Two Supabase queries per cache miss; DB localized_slug may override SLUGS for canonical/hreflang | H-8 |
| `RF-content-db-only` | /{lang}/{education\|legal-notice\|privacy-policy} and DB-localised slugs (42 URLs) | Middleware content-page arm when a content_pages row exists, else SPA shell; not prerendered | SEO handler in microns-site | `1` | Localised slugs resolved only through content_pages.localized_slug | H-9 |
| `RF-blog-index` | /{lang}/{blog} blog index (14 URLs; blog\|blogg\|blogi) | Middleware + articles list (500 ms race); prerendered file shadowed | SEO handler in microns-site | `1` |  | H-8 |
| `RF-blog-article` | /{lang}/{blog}/{slug} article (2,344 published, live 2026-09-30) | Middleware + articles row with translation_id hreflang cluster; never prerendered | SEO handler in microns-site | `1` | Unknown slug: 200 shell then client redirect to blog index; og:image = articles.featured_image (755 rows point at \*.amazonaws.com) | H-9; H-17; H-19 |
| `RF-quote` | /{lang}/{quote} and /{lang}/quote-request (28 URLs) | Middleware type 'quote' for both; canonical always /{lang}/{quote}; both prerendered files shadowed | SEO handler in microns-site | `1` | /{lang}/quote-request canonicalises to /{lang}/{quote}; both listed in sitemap-complete.xml | H-8 |
| `RF-subpaths` | /{lang}/quote/success, /{lang}/contact/success, /{lang}/{known-slug}/{anything} | Middleware returns the parent page type and canonical: 200 with parent SEO body | SEO handler in microns-site (replicate; strict 404 behind flag seo.strict_404 later) | `1` | Soft-404 class: /en/about/x gets the About body and canonical /en/about | H-9 |
| `RF-lang-login` | /{lang}/login | Middleware treats 'login' as an unknown content slug: DB miss then SPA shell | SEO handler in microns-site (parity); optional skip of the DB lookup | `1` | Costs two Supabase queries per negative-cache window per isolate | H-9 |
| `RF-legacy-unprefixed` | Unprefixed legacy routes (/services, /services/{6}, /about, /contact, /quote, /quote-request, /industries, /our-work, /education, /legal-notice, /privacy-policy, /impressum, /cookie-policy, /login, ...) | SPA shell 200 (middleware not matched); client navigate() to /{saved or en}{path} | SPA fallback via ASSETS (parity); server 308s would be a behaviour change | `1` | No noindex, no server canonical | H-9 |
| `RF-app-private` | Authenticated app: /customer/\*, /partner/\*, /dashboard/\*\* (incl. /dashboard/xometry, /dashboard/inventory/\*), /customers, /partners, /calendar, /products, /rfq\*, /orders\* | SPA shell 200; robots.txt disallows most | SPA fallback via ASSETS; optional X-Robots-Tag noindex; optional Access on /dashboard\* (Phase 6) | `1` | Unknown non-language paths render an empty &lt;Routes&gt;; no &lt;Route path='\*'&gt; | H-28 |
| `RF-tenant-hosts` | Tenant hosts {slug}.micronshub.eu/\* (live tenants: micronshub, laserkritis; no custom domains) | Same Vercel deployment via \*.micronshub.eu wildcard domain; tenant resolved client-side from window.location.hostname | Workers Route \*.micronshub.eu/\* on a proxied wildcard record; Cloudflare for SaaS deferred until a real custom domain exists | `3` | Middleware injects Microns SEO body and www canonical on tenant hosts (PLAN.md Q9) | H-13; H-25 |
| `RF-sitemaps` | /sitemap.xml, /sitemap-complete.xml, /sitemap-index.xml, /sitemap-{lang}.xml (17 URLs) | Vercel rewrites to the Node function api/sitemap.js (Supabase Storage first) | microns-site sitemap routes before the asset fallback; Cache API 1 h; identical headers | `1` | Content-Type application/xml; charset=utf-8; Cache-Control public, max-age=3600, s-maxage=3600; Vary Accept-Encoding; /sitemap-index.xml and /sitemap-{lang}.xml serve stale 2025-12-30 blobs | H-12 |
| `RF-soft404` | Unknown paths: /{lang}/unknown, /{lang}/a/b/c, /EN (uppercase), \*.html suffix | 200 with SPA shell (NotFound rendered client-side); 3+ segments render a blank page | Replicate 200s in Phase 1; SEO_STRICT_404 / seo.strict_404 returns 404 + shell later (PLAN.md Q5) | `1` | Parity probes: 11 soft-404 classes x 2 languages (SEO_PARITY.md) | H-9 |
| `RF-path-variants` | Trailing and double slash variants (/en/, /en//services) | Middleware normalises: 200, canonical without slash; Vercel-level normalisation unverified | SEO handler with html_handling 'none' (the default auto-trailing-slash would add 307 redirects: CF docs, verified 2026-09-27) | `1` | Baseline must record Vercel behaviour before cutover | H-10 |
| `RF-reset-password` | /reset-password | No route or page: password-reset e-mails land on a blank shell | SPA fallback (parity); add the route as Phase 6 debt; Supabase Auth redirect allowlist gains the preview host (P0-6) | `6` | Auth flows on the preview host fail unless Supabase Auth URL configuration is updated | H-22 |

## 4. Redirects

25 server redirects in `vercel.json` (all `permanent: true`, which Vercel serves as **308**, not 301), 3 client-only map entries and 2 client regex patterns (`src/components/SEORedirects.tsx:14-77`). The CSV keeps every source byte-exact; in this table the invisible C1 control character of the mojibake source is shown as `[U+0084]`. Target for all: the in-Worker redirect table in `microns-site`, evaluated before the SEO handler (plan §7 router step 1), Phase 1.

| ID | Source | Location | Today | Status | Notes |
|---|---|---|---|---|---|
| `RD-01` | `/nl/blog/knoedelen-ontwerpen-voor-diamant-vs-rechte-patronen` | vercel.json:3-7 | Vercel edge redirect to /nl/blog/kartelen-ontwerpen-voor-diamant-vs-rechte-patronen (308) | active (308); status to confirm in baseline P0-3 | destination /nl/blog/kartelen-ontwerpen-voor-diamant-vs-rechte-patronen; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:16 |
| `RD-02` | `/sv/spjutsgjutning` | vercel.json:8-12 | Vercel edge redirect to /sv/tjanster/formsprutning (308) | active (308); status to confirm in baseline P0-3 | destination /sv/tjanster/formsprutning; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:19 |
| `RD-03` | `/sv/sprutgjutning` | vercel.json:13-17 | Vercel edge redirect to /sv/tjanster/formsprutning (308) | active (308); status to confirm in baseline P0-3 | destination /sv/tjanster/formsprutning; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:21 |
| `RD-04` | `/sv/platarbe` | vercel.json:18-22 | Vercel edge redirect to /sv/tjanster/platbearbetning (308) | active (308); status to confirm in baseline P0-3 | destination /sv/tjanster/platbearbetning; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:20 |
| `RD-05` | `/sv/blog/krapplingsoperationer-design-for-diamant-vs-raka-monster` | vercel.json:23-27 | Vercel edge redirect to /sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster (308) | active (308); status to confirm in baseline P0-3 | destination /sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:24 |
| `RD-06` | `/sv/blogg/krapplingsoperationer-design-for-diamant-vs-raka-monster` | vercel.json:28-32 | Vercel edge redirect to /sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster (308) | active (308); status to confirm in baseline P0-3 | destination /sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:25 |
| `RD-07` | `/da/spjutsgodsning` | vercel.json:33-37 | Vercel edge redirect to /da/tjenester/sprojtestobning (308) | active (308); status to confirm in baseline P0-3 | destination /da/tjenester/sprojtestobning; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:28 |
| `RD-08` | `/da/sproejtestoebning` | vercel.json:38-42 | Vercel edge redirect to /da/tjenester/sprojtestobning (308) | active (308); status to confirm in baseline P0-3 | destination /da/tjenester/sprojtestobning; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:29 |
| `RD-09` | `/nb/spjutsgjetting` | vercel.json:43-47 | Vercel edge redirect to /nb/tjenester/sproytestoping (308) | active (308); status to confirm in baseline P0-3 | destination /nb/tjenester/sproytestoping; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:32 |
| `RD-10` | `/nb/sproyetestoping` | vercel.json:48-52 | Vercel edge redirect to /nb/tjenester/sproytestoping (308) | active (308); status to confirm in baseline P0-3 | destination /nb/tjenester/sproytestoping; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:33 |
| `RD-11` | `/it/blog/minimizzare-chiacchiericcio-fresatura-cavita-profonde` | vercel.json:53-57 | Vercel edge redirect to /it/blog/minimizzare-vibrazioni-fresatura-cavita-profonde (308) | active (308); status to confirm in baseline P0-3 | destination /it/blog/minimizzare-vibrazioni-fresatura-cavita-profonde; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:36 |
| `RD-12` | `/pl/wykoÅ[U+0084]czenie-powierzchni` | vercel.json:58-62 | Vercel edge redirect to /pl/uslugi/wykonczenie-powierzchni (308) | active config, never matches (dead source); status to confirm in baseline P0-3 | destination /pl/uslugi/wykonczenie-powierzchni; status 308 (permanent: true); source bytes after /pl/wyko are C3 85 C2 84 (double-encoded n-acute); no real request matches it, so it is dead today; keep this entry byte-identical; the real URL /pl/wyko%C5%84czenie-powierzchni is handled by RD-28 |
| `RD-13` | `/dawycena` | vercel.json:63-67 | Vercel edge redirect to /pl/wycena (308) | active (308); status to confirm in baseline P0-3 | destination /pl/wycena; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:44 |
| `RD-14` | `/en/dawycena` | vercel.json:68-72 | Vercel edge redirect to /pl/wycena (308) | active (308); status to confirm in baseline P0-3 | destination /pl/wycena; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:45; source sits inside the /{lang}/\* matcher, so the table must run before the SEO handler |
| `RD-15` | `/danotre-travail` | vercel.json:73-77 | Vercel edge redirect to /fr/notre-travail (308) | active (308); status to confirm in baseline P0-3 | destination /fr/notre-travail; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:46 |
| `RD-16` | `/csservicos/usinagem-cnc` | vercel.json:78-82 | Vercel edge redirect to /pt/servicos/usinagem-cnc (308) | active (308); status to confirm in baseline P0-3 | destination /pt/servicos/usinagem-cnc; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:47 |
| `RD-17` | `/daservices/sheet-metal` | vercel.json:83-87 | Vercel edge redirect to /da/tjenester/pladearbejde (308) | active (308); status to confirm in baseline P0-3 | destination /da/tjenester/pladearbejde; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:48 |
| `RD-18` | `/deservicos/prototipagem-rapida` | vercel.json:88-92 | Vercel edge redirect to /pt/servicos/prototipagem-rapida (308) | active (308); status to confirm in baseline P0-3 | destination /pt/servicos/prototipagem-rapida; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:49 |
| `RD-19` | `/daservices/impression-3d` | vercel.json:93-97 | Vercel edge redirect to /fr/services/impression-3d (308) | active (308); status to confirm in baseline P0-3 | destination /fr/services/impression-3d; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:50 |
| `RD-20` | `/nbservicos/prototipagem-rapida` | vercel.json:98-102 | Vercel edge redirect to /pt/servicos/prototipagem-rapida (308) | active (308); status to confirm in baseline P0-3 | destination /pt/servicos/prototipagem-rapida; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:51 |
| `RD-21` | `/svorcamento` | vercel.json:103-107 | Vercel edge redirect to /sv/offert (308) | active (308); status to confirm in baseline P0-3 | destination /sv/offert; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:52 |
| `RD-22` | `/huorcamento` | vercel.json:108-112 | Vercel edge redirect to /hu/ajanlat (308) | active (308); status to confirm in baseline P0-3 | destination /hu/ajanlat; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:53 |
| `RD-23` | `/itorcamento` | vercel.json:113-117 | Vercel edge redirect to /it/preventivo (308) | active (308); status to confirm in baseline P0-3 | destination /it/preventivo; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:54 |
| `RD-24` | `/daorcamento` | vercel.json:118-122 | Vercel edge redirect to /da/tilbud (308) | active (308); status to confirm in baseline P0-3 | destination /da/tilbud; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:55 |
| `RD-25` | `/deorcamento` | vercel.json:123-127 | Vercel edge redirect to /de/angebot (308) | active (308); status to confirm in baseline P0-3 | destination /de/angebot; status 308 (permanent: true); also in client map src/components/SEORedirects.tsx:56 |
| `RD-26` | `/csoffert` | src/components/SEORedirects.tsx:43 | client-only: 200 SPA shell, then navigate(replace) to /cs/nabidka (src/components/SEORedirects.tsx:188) | client-only (HTTP 200 today) | destination /cs/nabidka; deliberate change 200 → 308, record in the SEO_PARITY allow-list; client map stays as fallback |
| `RD-27` | `/enoffert` | src/components/SEORedirects.tsx:57 | client-only: 200 SPA shell, then navigate(replace) to /en/quote (src/components/SEORedirects.tsx:188) | client-only (HTTP 200 today) | destination /en/quote; deliberate change 200 → 308, record in the SEO_PARITY allow-list; client map stays as fallback |
| `RD-28` | `/pl/wykończenie-powierzchni (and /pl/wyko%C5%84czenie-powierzchni)` | src/components/SEORedirects.tsx:39-40; src/components/TranslatedRouteMatcher.tsx:90 | client-only: 200 SPA shell, then navigate(replace) to /pl/uslugi/wykonczenie-powierzchni (src/components/SEORedirects.tsx:188) | client-only (HTTP 200 today) | destination /pl/uslugi/wykonczenie-powierzchni; deliberate change 200 → 308, record in the SEO_PARITY allow-list; client map stays as fallback |
| `RD-P1` | `Pattern ^/(lang)(quote\|offert\|nabidka\|wycena\|tilbud\|devis\|ajanlat\|preventivo\|orcamento)$ (case-insensitive)` | src/components/SEORedirects.tsx:66 | client-only regex: 200 shell, then navigate(replace) to /{lang}/{translated quote slug} | client-only (HTTP 200 today) | Destination slug comes from i18n translateUrlPath; server port needs the same slug table |
| `RD-P2` | `Pattern ^/(lang)/(otherlang)(wycena\|offert\|nabidka\|tilbud\|devis\|ajanlat\|preventivo\|orcamento\|quote)$ (case-insensitive)` | src/components/SEORedirects.tsx:73 | client-only regex: 200 shell (SEO handler body), then navigate(replace) to /{otherlang}/{quote slug} | client-only (HTTP 200 today) | Path sits inside the /{lang}/\* matcher, so today it receives an SEO body first |

## 5. Rewrites and header rules

| ID | Rewrite | Location | Target | Component | Phase | Notes |
|---|---|---|---|---|---|---|
| `RW-01` | `/sitemap.xml -> /api/sitemap?type=main-index` | vercel.json:130-133 | microns-site sitemap route (type=main-index: tiny sitemapindex pointing to /sitemap-complete.xml); Cache API 1 h | `microns-site` | `1` | api/sitemap.js:377-389 builds the index |
| `RW-02` | `/sitemap-complete.xml -> /api/sitemap` | vercel.json:134-137 | microns-site sitemap route (full urlset, Storage-first, dynamic fallback); Cache API 1 h | `microns-site` | `1` | 6,273,304-byte blob regenerated daily 09:00 (live 2026-09-30) |
| `RW-03` | `/sitemap-index.xml -> /api/sitemap?type=index` | vercel.json:138-141 | microns-site sitemap route (legacy Storage blob) | `microns-site` | `1` | serves a stale 2025-12-30 blob; order: must precede /sitemap-:lang.xml |
| `RW-04` | `/sitemap-:lang.xml -> /api/sitemap?type=lang&lang=:lang` | vercel.json:142-145 | microns-site sitemap route /sitemap-{lang}.xml | `microns-site` | `1` | 14 stale 2025-12-30 blobs; path parameter rewrite |
| `RW-05` | `/robots.txt -> /robots.txt` | vercel.json:146-149 | Drop (no-op); robots.txt served as a static asset | `microns-site` | `1` | no-op today: the static file wins |
| `RW-06` | `/api/track -> /api/marketing?action=track` | vercel.json:150-153 | microns-site alias route /api/track → marketing track handler (identical path) | `microns-site` | `2` | URL may be embedded in already-sent e-mails |
| `RW-07` | `/api/connector-status -> /api/tenders?connectors=true` | vercel.json:154-157 | Alias route kept at the identical path; microns-site router forwards to microns-ops over the OPS binding | `microns-ops` | `2` | added to stay under the 12-function Hobby limit |
| `RW-08` | `/(.*) -> /index.html` | vercel.json:158-161 | ASSETS not_found_handling 'single-page-application' (never a \_redirects rule) | `microns-site` | `1` | every non-file path returns the shell with 200 today |

| ID | Rule | Location | Headers and notes | Target | Phase |
|---|---|---|---|---|---|
| `HR-01` | `/api/(.*) headers` | vercel.json:164-171 | Access-Control-Allow-Credentials: true; Access-Control-Allow-Origin: \*; Access-Control-Allow-Methods: GET,OPTIONS,PATCH,DELETE,POST,PUT; Access-Control-Allow-Headers: X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version. Allow-Credentials true with Origin \* is rejected by browsers for credentialed requests (pre-existing); Allow-Headers omits Authorization (api/\_lib/admin-auth.js:58-66 sets its own list) | Phase 1 finalise() in microns-site sets the four headers on every /api/\* answer, including those from microns-ops; handlers answer their own OPTIONS; allow-list mode built (workers/shared/src/http/cors.ts) and wired after the Phase 3 observation window (D-9) | `2` |
| `HR-02` | `/assets/(.*\.js) headers` | vercel.json:173-177 | Content-Type: application/javascript; charset=utf-8. Compare Content-Type byte-for-byte in the parity diff | Static Assets MIME inference, or an optional \_headers rule if the charset parameter must match | `1` |
| `HR-03` | `/assets/(.*\.css) headers` | vercel.json:179-183 | Content-Type: text/css; charset=utf-8. Compare Content-Type byte-for-byte in the parity diff | Static Assets MIME inference, or an optional \_headers rule if the charset parameter must match | `1` |

## 6. API endpoints

Split as built in Phase 2 ([PLAN.md](PLAN.md) §5.2): `emails`, `s3`, marketing `track` and `/api/track`, and the sitemaps run in `microns-site`; every `/api/notifications` action (DV-1) and every other endpoint runs in `microns-ops`, reached over the `OPS` service binding (RPC to the entrypoint `OpsApi`). The gates run in the `microns-site` router for both Workers; Phase 2 adds Supabase-JWT/Access gates, Turnstile and rate limits to all `/api/*` write paths (H-6).

| ID | Endpoint | Location | Secrets (names) | Target | Component | Phase | Risks |
|---|---|---|---|---|---|---|---|
| `API-emails` | POST /api/emails | api/emails.js | RESEND_API_KEY | microns-site /api/emails (local, browser-facing): api/emails.js unchanged through the shared @vercel/node shim, loaded on first use; Turnstile (header X-Turnstile-Token) + rate limit + auth gates | `microns-site` | `2` | H-6; H-20 |
| `API-s3` | POST /api/s3?action=…&scope=rfq\|articles | api/s3.js | AWS_\* (see ENV rows) | microns-site files API (workers/site/src/api/files.ts, aws4fetch): rfq scope writes new objects to R2 PRIVATE_FILES under rfq/ + today's key and falls back to legacy S3 for reads (LEGACY_AWS_\*); articles scope stays on legacy S3 until P3-6 (PLAN.md §5.2 D-17); same response shapes {uploadUrl,key,publicUrl}/{url}/{objects} | `microns-site` | `2` | H-6; H-17 |
| `API-marketing` | /api/marketing?action=track\|webhook\|google-auth\|apollo-enrich (+ alias /api/track) | api/marketing.js | SUPABASE_URL; SUPABASE_SERVICE_ROLE_KEY; RESEND_WEBHOOK_SECRET; GOOGLE_CLIENT_ID; GOOGLE_CLIENT_SECRET; GOOGLE_REDIRECT_URI; VERCEL_URL; APOLLO_API_KEY | microns-site router: track local; webhook, google-auth and apollo-enrich forwarded to microns-ops | `microns-site` | `2` | H-6; H-14; H-15; H-20 |
| `API-notifications` | /api/notifications (action: partner \| production-status \| nest \| inv-\*) | api/notifications.js (+ lib/nesting/\*, lib/inventory/\*) | RESEND_API_KEY; SUPABASE_URL; SUPABASE_SERVICE_ROLE_KEY | microns-ops over OPS for every action (partner, production-status, nest, inv-\*), because api/notifications.js imports nesting and inventory at module scope (PLAN.md §5.2 DV-1); nest with limits.cpu_ms 300,000 | `microns-ops` | `2` | H-6; H-18; H-20 |
| `API-gsc` | /api/gsc?action=… (6 actions) | api/gsc.js (+ api/\_lib/admin-auth.js, api/\_lib/gsc-client.js) | SUPABASE_URL; SUPABASE_ANON_KEY; SUPABASE_SERVICE_ROLE_KEY (alias SUPABASE_SERVICE_KEY); Google credentials in gsc_config row | microns-ops route; the handler's own admin check still runs behind the site gate; node:crypto through nodejs_compat; bulk actions synchronous (their queue kinds, planned for Phase 5 in DV-3, were not built: PLAN.md §5.5 BA5-10) | `microns-ops` | `2` | H-20 |
| `API-tenders` | /api/tenders (GET list/filter/export; PATCH) + alias /api/connector-status | api/tenders.js | SUPABASE_URL; SUPABASE_SERVICE_ROLE_KEY (anon fallback) | microns-ops Hono route + alias | `microns-ops` | `2` | H-6 |
| `API-tender-scan` | POST /api/tender-scan {country_code} | api/tender-scan.js (+ lib/connectors/\*, lib/scoring.js, lib/keywords.js, lib/cpv-codes.js, lib/utils.js) | SUPABASE_URL; SUPABASE_SERVICE_ROLE_KEY; TELEGRAM_BOT_TOKEN; TELEGRAM_CHAT_ID | microns-ops: a MACHINE caller's POST is validated, enqueued on the scrapes Queue and answered 200 at once (queued, run_id, counts at zero); staff callers run synchronously; the consumer runs the connectors (DV-3) | `microns-ops` | `2` | H-6; H-14 |
| `API-funded-startups` | /api/funded-startups (GET; POST scan; PATCH) | api/funded-startups.js | SUPABASE_URL; SUPABASE_SERVICE_ROLE_KEY (anon fallback); TELEGRAM_BOT_TOKEN; TELEGRAM_CHAT_ID | microns-ops: GET/PATCH routes; POST scan synchronous in Phase 2 (DV-3; queue kind funded-scan built, no producer yet) | `microns-ops` | `2` | H-6 |
| `API-scan-directory` | POST /api/scan-directory {url, source?} | api/scan-directory.js | none | microns-ops route (Phase 2, unchanged while agent.growth.scrapers is off); Phase 4 flag-on branch: scrapers module with the robots.txt gate and owner-recorded host permissions, Browser Rendering only for client-rendered pages of permitted hosts | `microns-ops` | `2` | H-6 |
| `API-scrape-company-profile` | POST /api/scrape-company-profile {url, source} | api/scrape-company-profile.js | none | microns-ops route; Phase 4 flag-on branch to the scrapers module, as API-scan-directory | `microns-ops` | `2` | H-6 |
| `API-scrape-website` | POST /api/scrape-website {urls[&lt;=25]} | api/scrape-website.js | none | microns-ops Hono route; cap outbound concurrency at 6 (6 simultaneous outgoing connections per request: CF docs, verified 2026-09-27) | `microns-ops` | `2` | H-6 |
| `API-sitemap` | /api/sitemap (?type=main-index \| none \| index \| lang) | api/sitemap.js | SUPABASE_ANON_KEY (no VITE_ fallback); project URL hard-coded (api/sitemap.js:24) | microns-site sitemap routes (Phase 1), unchanged in Phase 5: sitemap-complete.xml stays in Supabase Storage, written by the sitemap Workflow from S4 with a shadow copy in R2 (PLAN.md §5.5 DV5-1); the reader switch moves to P7-5 or Phase 6 | `microns-site` | `1` | H-12 |
| `API-flat-pattern` | POST /flat-pattern (sheet-metal-service) | sheet-metal-service/main.py:445 | API_KEY (not applied to this route) | microns-cad Container behind the CadRouter DO in microns-ops (built in Phase 5): the two CAD edge functions reach it through the site path /api/cad/&lt;token&gt;/flat-pattern (gate CD-1, DV5-18); key required on every non-health route and a 120 s wall clock (CAD_SHARED_SECRET); output equal after masking the values the service randomises (DV5-17) | `microns-cad` | `5` |  |
| `API-cad-v1` | sheet-metal-service /api/v1/unfold, /api/v1/unfold/preview, /api/v1/unfold/info, /api/v1/health, /health | sheet-metal-service/main.py:243,337,377,690,712 | none | Carried unchanged inside the microns-cad image; from Phase 4 the cad-jobs consumer of microns-ops calls /api/v1/unfold (DXF output) and /api/v1/health on the existing service for STEP sheet metal; Phase 5 (built): the same calls on the Container once CAD_BACKEND_DEFAULT is container (S9), with the key required on every non-health route | `microns-cad` | `5` |  |

## 7. API actions

50 actions across 8 multiplexed endpoints; each is an end-to-end test case for the Phase 2 exit gate. `/api/notifications` dispatches 22 actions in code (partner, production-status, nest and 19 `inv-*`).

| ID | Dispatch location | Target | Component | Phase | Notes |
|---|---|---|---|---|---|
| `ACT-emails-contact` | api/emails.js:370 | microns-site /api/emails, same action dispatch; Turnstile on contact/quote forms | `microns-site` | `2` | Resend send from info@micronshub.eu |
| `ACT-emails-rfq` | api/emails.js:372 | microns-site /api/emails, same action dispatch; Turnstile on contact/quote forms | `microns-site` | `2` | Resend send from info@micronshub.eu |
| `ACT-emails-rfq-pdf` | api/emails.js:374 | microns-site /api/emails, same action dispatch; Turnstile on contact/quote forms | `microns-site` | `2` | base64 PDF attachment |
| `ACT-emails-email` | api/emails.js:376 | microns-site /api/emails, same action dispatch; Turnstile on contact/quote forms | `microns-site` | `2` | default action; Resend send from info@micronshub.eu |
| `ACT-notifications-partner` | api/notifications.js:270 | microns-ops /api/notifications over OPS (partner e-mails via Resend; DV-1) | `microns-ops` | `2` | default action; POST only |
| `ACT-notifications-production-status` | api/notifications.js:268 | microns-ops /api/notifications over OPS (partner e-mails via Resend; DV-1) | `microns-ops` | `2` | POST only |
| `ACT-notifications-nest` | api/notifications.js:266 | microns-ops request handler with limits.cpu_ms 300,000 (DV-4); an OPS RPC rejection answers 504 JSON TIMEOUT; Container only if a real order exceeds the limit (D-6) | `microns-ops` | `2` | CPU-bound nesting (lib/nesting, 50 s budget, ClipperLib); NestingError TIMEOUT returns 504; deployed, Date.now() advances only on I/O, so the 50 s budget never trips |
| `ACT-notifications-inv-materials` | lib/inventory/index.js:480 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-stock` | lib/inventory/index.js:484 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-stock-receive` | lib/inventory/index.js:486 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-stock-adjust` | lib/inventory/index.js:488 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-stock-summary` | lib/inventory/index.js:490 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-stock-remnants` | lib/inventory/index.js:492 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-stock-scan` | lib/inventory/index.js:494 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-sessions` | lib/inventory/index.js:498 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-session-add-jobs` | lib/inventory/index.js:500 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-session-remove-job` | lib/inventory/index.js:502 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-session-start` | lib/inventory/index.js:504 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-session-complete` | lib/inventory/index.js:506 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-session-select-stock` | lib/inventory/index.js:508 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-alerts` | lib/inventory/index.js:512 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-alert-resolve` | lib/inventory/index.js:514 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-label` | lib/inventory/index.js:518 | microns-ops over OPS; qrcode aliased to its server build (workers/ops/wrangler.jsonc); the PDF answer is checked in T2 | `microns-ops` | `2` | PDF label via pdf-lib; QRCode.toBuffer returns a Node Buffer |
| `ACT-notifications-inv-settings` | lib/inventory/index.js:522 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-transactions` | lib/inventory/index.js:526 | microns-ops /api/notifications inventory CRUD over OPS (GET/POST/PUT; DV-1) | `microns-ops` | `2` | Inventory CRUD; auth gap - see private note |
| `ACT-notifications-inv-cron-batch` | lib/inventory/index.js:530 | microns-ops on-demand action behind the site gate in Phase 2; a Cron Trigger calling runAutoBatch() only if the owner wants one | `microns-ops` | `2` | Not scheduled anywhere today (no Vercel cron, pg_cron or caller); lib/inventory/cron-batch.js |
| `ACT-marketing-track` | api/marketing.js:59 | microns-site (identical path and alias /api/track, both hosts www and apex) | `microns-site` | `2` | type=open (1x1 pixel, no-store) \| click (302) \| unsubscribe (HTML); URLs baked into sent e-mails |
| `ACT-marketing-webhook` | api/marketing.js:61 | microns-ops; Resend's Svix signature checked on the raw bytes before the unchanged handler; a retry of an event already recorded is acknowledged with 200 (DV-14) | `microns-ops` | `2` | Resend events delivered/bounced/complained/opened/clicked correlate by marketing_events.resend_email_id |
| `ACT-marketing-google-auth` | api/marketing.js:63 | microns-ops; GOOGLE_REDIRECT_URI set explicitly (VERCEL_URL does not exist on Cloudflare) | `microns-ops` | `2` | steps authorize \| callback \| refresh (api/marketing.js:401-548); auth gap - see private note |
| `ACT-marketing-apollo-enrich` | api/marketing.js:65 | microns-ops (I/O bound; Workflow only for large lists) | `microns-ops` | `2` | 1.5 s sleep per 3 companies; key from app_settings.apollo_api_key then APOLLO_API_KEY |
| `ACT-gsc-search-analytics` | api/gsc.js:197 | microns-ops | `microns-ops` | `2` | staff role required (admin-auth) |
| `ACT-gsc-inspect-url` | api/gsc.js:199 | microns-ops | `microns-ops` | `2` | staff role required (admin-auth) |
| `ACT-gsc-bulk-inspect` | api/gsc.js:201 | microns-ops; optional Workflow for long batches | `microns-ops` | `2` | up to 50 x 1 s inspections |
| `ACT-gsc-submit-indexing` | api/gsc.js:203 | microns-ops; optional Workflow for long batches | `microns-ops` | `2` | up to 200 sequential submissions |
| `ACT-gsc-sitemaps` | api/gsc.js:205 | microns-ops | `microns-ops` | `2` | staff role required (admin-auth) |
| `ACT-gsc-monitored-urls` | api/gsc.js:207 | microns-ops | `microns-ops` | `2` | staff role required (admin-auth) |
| `ACT-s3-presign-upload` | api/s3.js:155 | microns-site files API: presigned PUT to R2 under rfq/ + today's key (300 s, Content-Type signed); articles scope on legacy S3 until P3-6 | `microns-site` | `2` | returns {uploadUrl,key,publicUrl}; auth gap - see private note |
| `ACT-s3-presign-download` | api/s3.js:169 | microns-site files API: R2 when the key exists there, else legacy S3 | `microns-site` | `2` | auth gap - see private note |
| `ACT-s3-delete` | api/s3.js:179 | microns-site files API: deletes the key on R2 and on legacy S3 | `microns-site` | `2` | auth gap - see private note |
| `ACT-s3-delete-folder` | api/s3.js:188 | microns-site files API: first list page of each store under the prefix, normalised to end in / (DV-14); deletes on both stores | `microns-site` | `2` | auth gap - see private note |
| `ACT-s3-list` | api/s3.js:209 | microns-site files API: first list page of each store, merged (R2 wins on duplicate keys) | `microns-site` | `2` | auth gap - see private note |
| `ACT-sitemap-main-index` | api/sitemap.js:407 | microns-site sitemap route with Cache API (s-maxage 3600 honoured only via Cache API) | `microns-site` | `1` | /sitemap.xml |
| `ACT-sitemap-complete` | api/sitemap.js:234 | microns-site sitemap route with Cache API (s-maxage 3600 honoured only via Cache API) | `microns-site` | `1` | /sitemap-complete.xml (no type param) |
| `ACT-sitemap-index` | api/sitemap.js:408 | microns-site sitemap route with Cache API (s-maxage 3600 honoured only via Cache API) | `microns-site` | `1` | /sitemap-index.xml (stale blob) |
| `ACT-sitemap-lang` | api/sitemap.js:409 | microns-site sitemap route with Cache API (s-maxage 3600 honoured only via Cache API) | `microns-site` | `1` | /sitemap-{lang}.xml (stale blobs) |
| `ACT-tenders-GET` | api/tenders.js:32 | microns-ops (list, ?id, ?stats_only, ?export=csv, ?connectors=true) | `microns-ops` | `2` | alias /api/connector-status = ?connectors=true |
| `ACT-tenders-PATCH` | api/tenders.js:122 | microns-ops with a staff JWT gate | `microns-ops` | `2` | auth gap - see private note |
| `ACT-funded-startups-GET` | api/funded-startups.js:36 | microns-ops (list, stats, feeds, export CSV, ?id) | `microns-ops` | `2` |  |
| `ACT-funded-startups-POST-scan` | api/funded-startups.js:45 | microns-ops, synchronous in Phase 2 (DV-3); queue kind funded-scan built for a later producer; Cron Trigger optional | `microns-ops` | `2` | runs for minutes today; auth gap - see private note |
| `ACT-funded-startups-PATCH` | api/funded-startups.js:46 | microns-ops with a staff JWT gate | `microns-ops` | `2` | auth gap - see private note |

## 8. Edge functions: repo vs live reconciliation

| Class | Count |
|---|---|
| In repo & deployed | 25 |
| Live-only (deployed, no repo source) | 16 |
| Repo-only (not deployed) | 5 |
| **Deployed (live 2026-09-30)** | **41** |
| **In repo** | **30** |
| **Unique functions (CSV rows)** | **46** |

**Count note.** README.md, PLAN.md (Q6) and the approved plan (C4) state 40 deployed / 15 live-only. The live function list read on 2026-09-30 returns **41** slugs, **16** of them without repo source; the plan's own C4 list already names these 16 functions (`resend-webhook`, 4 × `gsc-*`, `enqueue-translations`, `process-translation-queue`, `diag-gemini-models`, `resend-email`, 2 × `-v2`, 2 × `-no-jwt`, `test-email-function`, `debug-test`, `simple-test`). The table below lists all of them; the other documents should read 41 / 16.

Phase 5 verdicts (plan §6 answer 2): **port** 14, **stays** 11, **delete** 15, **owner-decision** 6. `port` means the scheduler or long-runner moves to `microns-ops` (Workflows, Queues, Cron Triggers); `stays` means invoked with a user JWT, uses the Auth admin API, or is a webhook target; `delete` means dead, test or diagnostic; `owner-decision` is PLAN.md Q6.

| Function | Class | Live ver | verify_jwt live | config.toml | Verdict | Target | Component | Phase |
|---|---|---|---|---|---|---|---|---|
| `auto-translate-articles` | in repo & deployed | 17 | false | not listed (default true) (drift) | **port** | Port (Phase 5, built): content-daily fan-out step, one message per language on the translations Queue, plus a backfill of at most 5 per language and day | `microns-ops` | `5` |
| `auto-update-sitemap` | in repo & deployed | 11 | false | not listed (default true) (drift) | **port** | Port (Phase 5, built): sitemap Workflow, started by content-daily, or alone at 09:00 in switch-over stage S4 | `microns-ops` | `5` |
| `create-partner-auth-user` | in repo & deployed | 12 | true | not listed (default true) | **stays** | Stays on Supabase (Auth admin API, user JWT); needs fixing (plan §6 answer 2) | `supabase-stays` | `stays` |
| `extract-flat-pattern` | in repo & deployed | 10 | true | false (drift) | **stays** | Stays on Supabase and is not redeployed in Phase 5 (D-26): only the secret UNFOLD_SERVICE_URL is replaced at S9 with the site path /api/cad/&lt;token&gt;/flat-pattern (DV5-18) | `supabase-stays` | `stays` |
| `fix-article-links` | in repo & deployed | 15 | true | not listed (default true) | **port** | Port (Phase 5, built): content-daily step per language, a full paged pass (the live fix_all); stays deployed for BlogEditor | `microns-ops` | `5` |
| `generate-daily-article` | in repo & deployed | 36 | false | false | **port** | Port (Phase 5, built): repo copy re-synced from live v36; content-daily Workflow generate step through AI Gateway microns (Anthropic, live prompt and parser); stays deployed for the dashboard button until Phase 6 | `microns-ops` | `5` |
| `generate-manufacturing-pdf` | in repo & deployed | 28 | true | false (drift) | **stays** | Stays on Supabase and is not redeployed in Phase 5: it reads the same UNFOLD_SERVICE_URL, replaced at S9 (DV5-18) | `supabase-stays` | `stays` |
| `generate-sitemap` | in repo & deployed | 19 | false | not listed (default true) (drift) | **port** | Port (Phase 5, built): the sitemap Workflow reproduces the output of deployed v19 and writes the same Supabase Storage object the site serves, plus a shadow copy in R2 (PLAN.md §5.5 DV5-1); the repo variant is kept, not overwritten | `microns-ops` | `5` |
| `hn-collector` | in repo & deployed | 7 | false | false | **port** | Port (Phase 5, built): repo copy re-synced from live v7; schedule table \*/30 and one scrapes message per tick; stays deployed for leads-api /collect | `microns-ops` | `5` |
| `leads-api` | in repo & deployed | 7 | false | false | **stays** | Stays on Supabase; needs an auth gate (plan §6 answer 2) | `supabase-stays` | `stays` |
| `post-to-social-media` | in repo & deployed | 14 | true | not listed (default true) | **stays** | Stays on Supabase (user-initiated); Gemini call may route through AI Gateway later | `supabase-stays` | `stays` |
| `process-article-queue` | in repo & deployed | 10 | false | not listed (default true) (drift) | **port** | Port (Phase 5, built): absorbed by the content-daily Workflow (07:00 on the schedule table of the every-minute tick); the article-queue RPCs are kept and called | `microns-ops` | `5` |
| `reddit-collector` | in repo & deployed | 15 | false | false | **port** | Port (Phase 5, built): schedule table \*/15, \*/30, hourly on the every-minute tick; one scrapes message per tier tick (at most 40 due subreddits); stays deployed for the two manual callers | `microns-ops` | `5` |
| `send-campaign` | in repo & deployed | 14 | true | not listed (default true) | **port** | Port (Phase 5, built): /api/marketing?action=send-campaign (gate MK-8) in microns-ops queues one outbound-mail message per recipient, paced by the SenderLimiter DO; the dashboard falls back to this function only while the route is absent or paused; the repo version is kept and never deployed | `microns-ops` | `5` |
| `send-confirmation-email` | in repo & deployed | 12 | false | false | **delete** | Delete (Phase 5): dead transactional sender superseded by /api/emails; the owner deletes it after the log check (OW5-14), then a later commit removes the repo folder and its config.toml section (PLAN.md §5.5 DV5-22) | `delete` | `5` |
| `send-internal-rfq-notification-email` | in repo & deployed | 15 | true | false (drift) | **delete** | Delete (Phase 5): dead transactional sender; the owner deletes it after the log check (OW5-14), then a later commit removes the repo folder and its config.toml section (PLAN.md §5.5 DV5-22) | `delete` | `5` |
| `send-notification-email` | in repo & deployed | 12 | false | false | **delete** | Delete (Phase 5): dead transactional sender; the owner deletes it after the log check (OW5-14), then a later commit removes the repo folder and its config.toml section (PLAN.md §5.5 DV5-22) | `delete` | `5` |
| `send-rfq-confirmation-email` | in repo & deployed | 15 | true | false (drift) | **delete** | Delete (Phase 5): dead transactional sender; the owner deletes it after the log check (OW5-14), then a later commit removes the repo folder and its config.toml section (PLAN.md §5.5 DV5-22) | `delete` | `5` |
| `send-user-email` | in repo & deployed | 12 | true | not listed (default true) | **stays** | Stays on Supabase (user JWT context) | `supabase-stays` | `stays` |
| `telegram-leads-bot` | in repo & deployed | 6 | false | false | **stays** | Stays on Supabase (webhook URL unchanged); Phase 4 (built): live v6 source plus approval callbacks (agent-callback.ts) relayed to /api/agent/decision as a signed request; updates need the webhook secret-token header, set with setWebhook before the deploy (OW-17) | `supabase-stays` | `stays` |
| `telegram-tenders-bot` | in repo & deployed | 6 | false | not listed (default true) (drift) | **stays** | Stays on Supabase (webhook URL unchanged) | `supabase-stays` | `stays` |
| `tender-collector` | in repo & deployed | 11 | false | not listed (default true) (drift) | **port** | Phase 2: repo source rebuilt from the live source plus Access service-token headers and queued/run_id logging (deployed by the owner); port (Phase 5, built): schedule table 06:00, one scrapes message per due connector, each running api/tender-scan.js unchanged | `microns-ops` | `5` |
| `translate-article` | in repo & deployed | 81 | true | not listed (default true) | **port** | Port (Phase 5, built): repo copy re-synced from live v81; translations Queue consumer with the live Gemini chain through AI Gateway; IndexNow per new translation in the consumer; stays deployed for the dashboard buttons until Phase 6 | `microns-ops` | `5` |
| `update-partner-password` | in repo & deployed | 12 | true | not listed (default true) | **stays** | Stays on Supabase (Auth admin API); needs fixing (plan §6 answer 2) | `supabase-stays` | `stays` |
| `xometry-review` | in repo & deployed | 3 | true | not listed (default true) | **stays** | Stays on Supabase unchanged (admin gate, atomic claim) | `supabase-stays` | `stays` |
| `debug-test` | live-only | 12 | true | false (drift) | **delete** | Delete (Phase 5): test function; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `diag-gemini-models` | live-only | 2 | false | not listed (default true) | **delete** | Delete (Phase 5): diagnostic function; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `enqueue-translations` | live-only | 3 | true | not listed (default true) | **delete** | Delete (Phase 5): dead; the translation queue was created and dropped on 2026-04-15; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `gsc-index-url` | live-only | 2 | true | not listed (default true) | **owner-decision** | Kept (Q6 default, Phase 5): source added to the repository from live v2; deleted in P6-6 unless the owner confirms a caller (OW5-20); overlaps /api/gsc | `owner-decision` | `5` |
| `gsc-inspect-url` | live-only | 2 | true | not listed (default true) | **owner-decision** | Kept (Q6 default, Phase 5): source added to the repository from live v2; deleted in P6-6 unless the owner confirms a caller (OW5-20); overlaps /api/gsc | `owner-decision` | `5` |
| `gsc-performance` | live-only | 2 | true | not listed (default true) | **owner-decision** | Kept (Q6 default, Phase 5): source added to the repository from live v2; deleted in P6-6 unless the owner confirms a caller (OW5-20); overlaps /api/gsc | `owner-decision` | `5` |
| `gsc-sitemap-sync` | live-only | 2 | true | not listed (default true) | **owner-decision** | Kept (Q6 default, Phase 5): source added to the repository from live v2; deleted in P6-6 unless the owner confirms a caller (OW5-20); overlaps /api/gsc | `owner-decision` | `5` |
| `process-translation-queue` | live-only | 3 | true | not listed (default true) | **delete** | Delete (Phase 5): unscheduled since supabase/migrations/20260415_drop_translation_queue.sql:23; replaced by the translations Queue; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `resend-email` | live-only | 13 | true | not listed (default true) | **owner-decision** | Owner decision (PLAN.md Q6): no repo source or caller; likely an early transactional sender - delete after a log check; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `owner-decision` | `5` |
| `resend-webhook` | live-only | 12 | true | not listed (default true) | **owner-decision** | Owner decision (PLAN.md Q6): keep or delete; Resend events are handled by /api/marketing?action=webhook; Phase 5 default: kept until the Phase 2 webhook is proven, then deleted after a log check (OW5-14) | `owner-decision` | `5` |
| `send-internal-rfq-notification-email-no-jwt` | live-only | 12 | true | false (drift) | **delete** | Delete (Phase 5, confirm PLAN.md Q6): variant of a dead transactional sender; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `send-internal-rfq-notification-email-v2` | live-only | 12 | true | not listed (default true) | **delete** | Delete (Phase 5, confirm PLAN.md Q6): variant of a dead transactional sender; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `send-rfq-confirmation-email-no-jwt` | live-only | 12 | true | false (drift) | **delete** | Delete (Phase 5, confirm PLAN.md Q6): variant of a dead transactional sender; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `send-rfq-confirmation-email-v2` | live-only | 12 | true | not listed (default true) | **delete** | Delete (Phase 5, confirm PLAN.md Q6): variant of a dead transactional sender; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `simple-test` | live-only | 12 | true | not listed (default true) | **delete** | Delete (Phase 5): test function; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `test-email-function` | live-only | 13 | true | not listed (default true) | **delete** | Delete (Phase 5): test function; deletion after the log check is owner step OW5-14 (PLAN.md §5.5) | `delete` | `5` |
| `admin-update-partner-password` | repo-only | – | n/a | not listed (default true) | **stays** | Stays on Supabase (Auth admin API); needs fixing: replace the shared-secret design with a JWT + staff-role gate before deployment | `supabase-stays` | `stays` |
| `check-replies` | repo-only | – | n/a | not listed (default true) | **port** | Ported (Phase 4, built): read-only Gmail poller in the \*/10 dispatcher of microns-ops (workers/ops/src/cron/gmail-poller.ts) for the 2 Workspace sender accounts; replies to Resend mail arrive via microns-mail | `microns-ops` | `4` |
| `fix-broken-tables` | repo-only | – | n/a | not listed (default true) | **delete** | Delete from the repo in Phase 6 (one-off content repair, never deployed); confirm with the owner | `delete` | `6` |
| `process-followups` | repo-only | – | n/a | not listed (default true) | **port** | Port (Phase 5, built, off): schedule table at minute 5 of every hour behind the var MARKETING_FOLLOWUPS_ENABLED, sent through the outbound-mail Queue (no threading headers, as the repo function); repo folder deleted in P6-6 | `microns-ops` | `5` |
| `process-warmup` | repo-only | – | n/a | not listed (default true) | **port** | Port (Phase 5, built, off): schedule table 00:05 behind the var MARKETING_WARMUP_ENABLED; repo folder deleted in P6-6 | `microns-ops` | `5` |

`config.toml` column: the repo's `supabase/config.toml` value (absent = Supabase default `true`). "(drift)" marks a live setting that differs from the repo, a symptom of dashboard or local-CLI deploys (H-26); the live source of all deployed functions is pulled before any port (P0-5). Callers, triggers and secret names per function are in the CSV.

## 9. Cron jobs and the daily content chain

### 9.1 Live pg_cron jobs (2026-09-30)

Nine HTTP jobs call edge functions through `net.http_post`; the `Authorization` header of each holds a service credential (value not recorded here; rotation is pre-flight P0-2, removal from `cron.job` happens when the jobs move in Phase 5, H-7). One job is pure SQL.

| jobid | Name | Schedule (UTC) | Target | Body | pg_net timeout | Runs 7d | Non-success 7d | Last run | Target (Phase 5, microns-ops) |
|---|---|---|---|---|---|---|---|---|---|
| `15` | `process-article-queue` | `*/5 * * * *` | fn process-article-queue | `{}` | 300000 ms | 2016 | 0 | 2026-09-30 14:15 | content-daily Workflow (07:00, schedule table of microns-ops) generate step; deactivated at S5 by the reviewed SQL file (kept for rollback), unscheduled after the signed gate (P5-9) |
| `17` | `enqueue-daily-article` | `0 7 * * *` | SQL SELECT enqueue_next_article() | `-` | - | 7 | 0 | 2026-09-30 07:00 | content-daily Workflow started at 07:00 UTC by the schedule table on the every-minute tick of microns-ops (no Cron Trigger of its own, PLAN.md §5.5 DV5-2); deactivated at S5 |
| `19` | `auto-update-sitemap` | `0 9 * * *` | fn auto-update-sitemap | `{}` | default (5000 ms) | 7 | 0 | 2026-09-30 09:00 | sitemap Workflow (final step of content-daily; alone at 09:00 in stage S4); outputs compared, not cron status; deactivated at S4 |
| `21` | `auto-fix-article-links` | `30 8 * * *` | fn fix-article-links | `{"fix_all": true}` | default (5000 ms) | 7 | 0 | 2026-09-30 08:30 | content-daily Workflow step (fix links, full pass per language) after the translation fan-out; deactivated at S5 |
| `22` | `auto-translate-daily-articles` | `0 8 * * *` | fn auto-translate-articles | `{}` | 600000 ms | 7 | 0 | 2026-09-30 08:00 | content-daily Workflow translation fan-out (translations Queue, one message per language, plus backfill); deactivated at S5 |
| `23` | `reddit-tier1` | `*/15 * * * *` | fn reddit-collector?tier=1 | `{}` | default (5000 ms) | 672 | 0 | 2026-09-30 14:15 | Schedule table \*/15 in microns-ops (no Cron Trigger of its own, DV5-2) + one scrapes message per tick; deactivated at S2 |
| `24` | `reddit-tier2` | `*/30 * * * *` | fn reddit-collector?tier=2 | `{}` | default (5000 ms) | 336 | 0 | 2026-09-30 14:00 | Schedule table \*/30 in microns-ops + one scrapes message per tick; deactivated at S2 |
| `25` | `hn-collector` | `*/30 * * * *` | fn hn-collector | `{}` | default (5000 ms) | 336 | 0 | 2026-09-30 14:00 | Schedule table \*/30 in microns-ops + one scrapes message per tick; deactivated at S1 |
| `28` | `tender-scan-daily` | `0 6 * * *` | fn tender-collector | `{}` | default (5000 ms) | 7 | 0 | 2026-09-30 06:00 | Schedule table 06:00 in microns-ops + one scrapes message per due connector; deactivated at S3 |
| `29` | `reddit-tier3` | `0 * * * *` | fn reddit-collector?tier=3 | `{}` | default (5000 ms) | 168 | 0 | 2026-09-30 14:00 | Schedule table hourly in microns-ops + one scrapes message per tick; deactivated at S2 |

H-29 (medium, observability): `cron.job_run_details` reports "succeeded" for every run, but that only means the request was queued. `net._http_response` (about 6 h retention) showed 39 of 128 recent calls ending with "Timeout of 5000 ms reached" — the jobs without `timeout_milliseconds` (sitemap, fix-links, reddit × 3, hn, tender). Function outcomes are unobserved; Phase 5 parity compares outputs, and ported jobs record outcomes in `agent_runs`.

Historical jobs that exist only in repo migrations (not live):

| ID | Job | Repo location | Live status |
|---|---|---|---|
| `CRON-H1` | generate-daily-article (direct HTTP job, historical) | supabase/migrations/20250121_create_daily_article_cron_job.sql:18; unscheduled at supabase/migrations/20250103_update_cron_jobs_for_queue.sql:5 | dropped (not in live cron.job) |
| `CRON-H2` | process-translation-queue (\*/1, historical) | supabase/migrations/20260415_schedule_translation_queue.sql:25; dropped at supabase/migrations/20260415_drop_translation_queue.sql:23 | dropped (not in live cron.job); target function still deployed (EF-process-translation-queue) |

Other schedulers: GitHub Actions `xometry-scan` (7×/day, `CI-xometry-scan`); `lib/inventory/cron-batch.js` is reachable over HTTP but never scheduled (`ACT-notifications-inv-cron-batch`); `check-replies`, `process-followups`, `process-warmup` and the Telegram digests have no scheduler; `vercel.json` has no `crons` block.

### 9.2 Dependency chain 06:00–09:00 UTC

| Time (UTC) | Job | What happens | Depends on | Failure is visible? |
|---|---|---|---|---|
| 06:00 | `CRON-28` tender-scan-daily | `tender-collector` posts to `${SITE_URL}/api/tender-scan` on Vercel for due connectors (25 s abort per scan) | Vercel `/api/tender-scan` (EXT-site-self) | No (5 s pg_net timeout, H-29) |
| 07:00 | `CRON-17` enqueue-daily-article | SQL `enqueue_next_article()` inserts the next title into `article_generation_queue` | `article_titles` | Yes (SQL result) |
| 07:00 or 07:05, then every 5 min | `CRON-15` process-article-queue | Takes one queued job and calls `generate-daily-article` (Claude), which publishes the English article | 07:00 queue row | Partly (300 s timeout) |
| 08:00 | `CRON-22` auto-translate-daily-articles | `auto-translate-articles` calls `translate-article` once per language (13 targets) within its time budget, then `fix-article-links {fix_all:true}`; `translate-article` submits IndexNow | English article published before 08:00 | Partly (600 s timeout); 7 languages 19 days behind (H-19) |
| 08:30 | `CRON-21` auto-fix-article-links | `fix-article-links {"fix_all": true}` rewrites links in all translated articles | 08:00 translations | No (5 s timeout) |
| 09:00 | `CRON-19` auto-update-sitemap | `auto-update-sitemap` calls `generate-sitemap?type=complete`, which writes `sitemaps/sitemap-complete.xml` and upserts `gsc_monitored_urls`; `/sitemap-complete.xml` serves the blob | all of the above | No (5 s timeout) |

Target: one `content-daily` Workflow started at 07:00 by a Cron Trigger in `microns-ops` runs generate → translation fan-out on the `translations` Queue → wait-all → fix links → sitemap → IndexNow in order ([PLAN.md](PLAN.md) Phase 5, [ARCHITECTURE.md](ARCHITECTURE.md)). Collectors: reddit tier 1 `*/15`, tier 2 `*/30`, tier 3 hourly, hn `*/30`, tenders 06:00 as Cron Triggers + `scrapes` Queue. Old jobs are disabled, not deleted, until 7 days of output parity (Phase 5 exit gate). As built (2026-10-09, [PLAN.md](PLAN.md) §5.5): the times are rows of a schedule table read by the existing every-minute trigger (no Cron Trigger per job, DV5-2); IndexNow runs per translation in the queue consumer; the sitemap is written to the same Supabase Storage object the site serves (DV5-1). The ten jobs are deactivated step by step (S1 HN, S2 reddit, S3 tenders, S4 sitemap, S5 the content chain) by `supabase/migrations/20261008_deactivate_ported_crons.sql` with session settings, and unscheduled by `20261008_unschedule_ported_crons.sql` only after the signed gate; the GitHub Action is skipped through the repository variable `XOMETRY_SCAN_SCHEDULE` at S8.

## 10. Secrets and environment names

### 10.1 Matrix (names only)

Stored-today values come from code and live metadata; the actual Vercel environment variable list could not be read (Vercel API 403), so Vercel entries are inferred from code (§21).

| Name | Aliases | Consumers | Stored today | Target | Component | Phase | Risks |
|---|---|---|---|---|---|---|---|
| `SUPABASE_URL` | VITE_SUPABASE_URL (client build + fallback); NEXT_PUBLIC_SUPABASE_URL (xometry-bot/dashboard reference); DATABASE_URL (mcp-server alias) | api/\*; lib/inventory/\*; 24 edge functions; sheet-metal-service; mcp-server; SPA build | Vercel env; Supabase (auto-injected); VPS .env (sheet-metal-service); local (mcp-server); hard-coded in middleware.ts:43, api/sitemap.js:24, index.html:45 | var SUPABASE_URL on microns-site, microns-ops and microns-mail; VITE_SUPABASE_URL stays a build variable for the SPA; auto in Supabase | `microns-site` | `1` | H-20 |
| `SUPABASE_ANON_KEY` | VITE_SUPABASE_ANON_KEY | middleware.ts:105 (fallback); api/sitemap.js:179,199 (no VITE_ fallback); api/\_lib/admin-auth.js; xometry-review; SPA build | Vercel env (build + runtime); Supabase (auto-injected); local (mcp-server fallback) | wrangler secret SUPABASE_ANON_KEY on microns-site and microns-ops; VITE_SUPABASE_ANON_KEY stays a build variable | `microns-site` | `1` | H-4 |
| `SUPABASE_SERVICE_ROLE_KEY` | SUPABASE_SERVICE_KEY (api/\_lib, mcp-server, scripts) | api/\* (8 files); lib/inventory/\*; 24 edge functions; sheet-metal-service; mcp-server; scripts/seed-gsc-monitored-urls.ts | Vercel env; Supabase (auto-injected); VPS .env (sheet-metal-service); local (mcp-server, scripts); pg_cron literal in 9 cron.job commands | Rotate in pre-flight P0-2 and re-issue to every consumer; wrangler secret on microns-site, microns-ops, microns-mail; auto in Supabase; removed from cron.job when the ported jobs are unscheduled after the signed Phase 5 gate (P5-9) | `microns-ops` | `0` | H-7 |
| `SUPABASE_ACCESS_TOKEN` | – | Supabase MCP dev server | .env.example:19; .mcp.json (local shell) | Stays local; never deployed | `unchanged` | `stays` |  |
| `RESEND_API_KEY` | – | api/emails.js; api/notifications.js; send-campaign; process-followups; send-user-email; 4 dead send-\* functions | Vercel env; Supabase secrets | wrangler secret on microns-site (emails) and microns-ops (notifications from Phase 2, campaigns from Phase 5); stays in Supabase for send-user-email | `microns-site` | `2` |  |
| `RESEND_WEBHOOK_SECRET` | – | api/marketing.js webhook | Vercel env (whether set is unknown: Vercel env API returned 403) | wrangler secret on microns-ops; Svix verification | `microns-ops` | `2` | H-15 |
| `GOOGLE_CLIENT_ID` | – | api/marketing.js google-auth; send-campaign; check-replies | Vercel env; Supabase secrets; local (scripts/get-google-refresh-token.ts) | wrangler secret on microns-ops; stays in Supabase until send-campaign is ported | `microns-ops` | `2` |  |
| `GOOGLE_CLIENT_SECRET` | – | api/marketing.js; send-campaign; check-replies | Vercel env; Supabase secrets; local | wrangler secret on microns-ops; stays in Supabase until send-campaign is ported | `microns-ops` | `2` |  |
| `GOOGLE_REDIRECT_URI` | – | api/marketing.js google-auth | Vercel env (optional; default derived from VERCEL_URL) | wrangler secret on microns-ops set explicitly to https://www.micronshub.eu/api/marketing?action=google-auth&step=callback and registered in Google Cloud Console | `microns-ops` | `2` |  |
| `VERCEL_URL` | – | api/marketing.js (OAuth redirect default) | Vercel-injected | Retire (no Cloudflare equivalent); replaced by GOOGLE_REDIRECT_URI / SITE_ORIGIN | `delete` | `2` |  |
| `APOLLO_API_KEY` | app_settings.apollo_api_key (primary) | api/marketing.js apollo-enrich | app_settings table (primary); Vercel env (fallback) | wrangler secret on microns-ops (or keep the DB row only) | `microns-ops` | `2` |  |
| `TELEGRAM_BOT_TOKEN` | app_settings.telegram_bot_token; per-tenant inventory_settings.telegram_bot_token | api/tender-scan.js; api/funded-startups.js; hn-collector; reddit-collector; telegram-leads-bot; telegram-tenders-bot | Vercel env; Supabase secrets; app_settings table | wrangler secret on microns-ops (collectors, alerts); stays in Supabase for the bots | `microns-ops` | `2` |  |
| `TELEGRAM_CHAT_ID` | app_settings.telegram_chat_id | same consumers as TELEGRAM_BOT_TOKEN | Vercel env; Supabase secrets; app_settings table | wrangler secret on microns-ops; stays in Supabase for the bots | `microns-ops` | `2` |  |
| `AWS_ACCESS_KEY_ID` | VITE_AWS_ACCESS_KEY_ID (legacy name, server fallback only) | api/s3.js (rfq scope) | Vercel env (AWS_\* or VITE_AWS_\* names) | wrangler secret LEGACY_AWS_ACCESS_KEY_ID on microns-site (legacy S3: rfq reads and deletes, articles scope until P3-6); VITE_ name removed from .env.example and docs | `microns-site` | `2` | H-17 |
| `AWS_SECRET_ACCESS_KEY` | VITE_AWS_SECRET_ACCESS_KEY | api/s3.js (rfq scope) | Vercel env | wrangler secret LEGACY_AWS_SECRET_ACCESS_KEY on microns-site (as above) | `microns-site` | `2` | H-17 |
| `AWS_ARTICLES_ACCESS_KEY_ID` | VITE_AWS_ARTICLES_ACCESS_KEY_ID | api/s3.js (articles scope) | Vercel env | Retire after P3-6: article uploads stay on legacy S3 until then (D-17), and the site Worker uses the LEGACY_AWS_\* pair for both scopes; legacy article images are public URLs that need no key | `delete` | `6` | H-17 |
| `AWS_ARTICLES_SECRET_ACCESS_KEY` | VITE_AWS_ARTICLES_SECRET_ACCESS_KEY | api/s3.js (articles scope) | Vercel env | Retire after P3-6 (as above) | `delete` | `6` | H-17 |
| `AWS_REGION` | VITE_AWS_REGION | api/s3.js | Vercel env; .env.example:26 (us-east-1, stale) | var LEGACY_S3_REGION = eu-north-1 on microns-site | `microns-site` | `2` |  |
| `AWS_S3_BUCKET` | AWS_BUCKET_NAME; VITE_AWS_BUCKET_NAME | api/s3.js (rfq scope) | Vercel env; .env.example:27 | var LEGACY_S3_RFQ_BUCKET on microns-site (value from P0-4) | `microns-site` | `2` | H-17 |
| `AWS_ARTICLES_BUCKET` | VITE_AWS_ARTICLES_BUCKET_NAME (default 'articles') | api/s3.js (articles scope) | Vercel env | var LEGACY_S3_ARTICLES_BUCKET on microns-site until P3-6, then retired (legacy article image URLs stay public on S3) | `delete` | `6` | H-17 |
| `VITE_SITE_URL` | – | SocialPostDialog.tsx; BlogList.tsx | Vercel env (optional; default https://www.micronshub.eu) | Build variable in the Cloudflare build | `microns-site` | `1` |  |
| `VITE_GOOGLE_ADS_CONVERSION_LABEL` | – | src/utils/analytics.ts | Vercel env (optional; literal fallback in src/utils/analytics.ts:15) | Build variable in the Cloudflare build | `microns-site` | `1` |  |
| `VITE_APP_ENV` | – | none | .env.example:32 only | Retire | `delete` | `6` |  |
| `VITE_APP_NAME` | – | none | .env.example:33 only | Retire | `delete` | `6` |  |
| `NODE_ENV` | – | vite.config.ts:85; src/pages/OrderDetailsPage.tsx | build / local | Unchanged (set by the build) | `unchanged` | `stays` |  |
| `BASE_URL` | – | playwright.config.ts:8 | local / CI (Playwright) | CI variable pointing the parity and e2e tests at the preview host | `unchanged` | `1` |  |
| `ANTHROPIC_API_KEY` | – | generate-daily-article | Supabase secrets | Not a Worker secret: AI Gateway BYOK (key stored in the gateway, Phase 4), also for article generation (Phase 5, built); stays in Supabase for the manual generate-daily-article button until Phase 6 | `microns-ops` | `5` |  |
| `GEMINI_API_KEY` | – | translate-article; post-to-social-media | Supabase secrets | Not a Worker secret (Phase 5, built, D-7): the Google AI Studio key is stored in AI Gateway microns for route translate; stays in Supabase for translate-article and post-to-social-media | `microns-ops` | `5` |  |
| `SITE_URL` | app_settings.site_url (= https://www.micronshub.eu) | generate-daily-article; generate-sitemap; post-to-social-media; tender-collector; translate-article; mcp-server | Supabase secrets (optional); local (mcp-server); app_settings table | Stays in Supabase with the same value; Workers use var SITE_ORIGIN | `supabase-stays` | `stays` | H-14 |
| `TRACKING_DOMAIN` | marketing_settings.tracking_domain (overrides; default https://micronshub.eu) | send-campaign; process-followups | Supabase secrets (optional); marketing_settings table | Var TRACKING_DOMAIN on microns-ops with the same value (Phase 5, built); stays in Supabase for the edge functions | `supabase-stays` | `5` | H-14; H-24 |
| `UNFOLD_SERVICE_URL` | – | extract-flat-pattern; generate-manufacturing-pdf | Supabase secrets (points at the VPS FastAPI service) | Stays in Supabase; its value is replaced at S9 with the site path /api/cad/&lt;CAD_COMPAT_TOKEN&gt; on www (DV5-18), never unset; both functions are not redeployed; the old value is kept for rollback | `supabase-stays` | `5` |  |
| `INDEXNOW_KEY` | – | translate-article | Supabase secrets; must equal public/indexnow_key.txt | Optional secret on microns-ops (Phase 5, built; without it a translation records indexnow not_configured); stays in Supabase until Phase 6 | `microns-ops` | `5` | H-14 |
| `FACEBOOK_PAGE_ID` | – | post-to-social-media | Supabase secrets | Stays in Supabase | `supabase-stays` | `stays` |  |
| `FACEBOOK_ACCESS_TOKEN` | – | post-to-social-media | Supabase secrets | Stays in Supabase | `supabase-stays` | `stays` |  |
| `LINKEDIN_ORG_ID` | – | post-to-social-media | Supabase secrets | Stays in Supabase | `supabase-stays` | `stays` |  |
| `LINKEDIN_ACCESS_TOKEN` | – | post-to-social-media | Supabase secrets | Stays in Supabase | `supabase-stays` | `stays` |  |
| `XOMETRY_PARTNER_AUTH_TOKEN` | XB_PARTNER_AUTH_TOKEN (GitHub secret for the scanner) | xometry-review; xometry-scan workflow | Supabase secrets; GitHub Actions secrets (same token in two stores) | Stays in Supabase for xometry-review; the scanner moved (Q8 default) and reads the same value as the optional secret XOMETRY_TOKEN on microns-ops (Phase 5, built) | `microns-ops` | `5` |  |
| `XOMETRY_PARTNER_COOKIE` | XB_PARTNER_COOKIE | xometry-review; xometry-scan workflow | Supabase secrets; GitHub Actions secrets (optional) | As XOMETRY_PARTNER_AUTH_TOKEN; optional secret XOMETRY_COOKIE on microns-ops (Phase 5, built) | `microns-ops` | `5` |  |
| `XOMETRY_COUNTEROFFER_MUTATION` | – | xometry-review | Supabase secrets | Stays in Supabase | `supabase-stays` | `stays` |  |
| `XOMETRY_COUNTEROFFER_OPERATION_NAME` | – | xometry-review | Supabase secrets | Stays in Supabase | `supabase-stays` | `stays` |  |
| `XOMETRY_REVIEW_API_URL` | – | xometry-review (box proxy path) | Supabase secrets (optional); xometry-bot/dashboard reference | Stays in Supabase; only relevant if the review box exists | `supabase-stays` | `stays` |  |
| `XOMETRY_REVIEW_API_TOKEN` | XB_REVIEW_API_TOKEN (box side) | xometry-review; xometry-bot review_api.py | Supabase secrets (optional); VPS .env (box) | Stays in Supabase; retire both if the review box is not used | `supabase-stays` | `stays` |  |
| `ADMIN_PASSWORD_UPDATE_SECRET` | VITE_ADMIN_PASSWORD_UPDATE_SECRET (client mirror, denylisted at vite.config.ts:72) | admin-update-partner-password (not deployed); src/pages/PartnerManagement.tsx:62 | Supabase secrets; Vercel env (never reaches the bundle) | Retire; replace with a JWT + staff-role gate (Phase 6) | `delete` | `6` | H-21 |
| `XB_DB_DSN` | – | xometry-scan workflow (psycopg upsert) | GitHub Actions secret (Postgres connection string) | Not needed by the Worker (PostgREST with the service credential, no Hyperdrive, PLAN.md §5.5 DV5-15); kept for the Action rollback and deleted after the signed gate (OW5-17) | `delete` | `5` | H-7 |
| `XB_BORDERLINE_EXCLUDE` | – | xometry-scan workflow | GitHub repository variable | Flag value borderline_exclude of agent.growth.xometry on microns-ops (Phase 5, built); the repository variable stays for the Action until P6-6 | `microns-ops` | `5` |  |
| `XB_ENABLE_BUYER_PRICING` | – | xometry-bot pipeline | workflow literal "0" (xometry-scan.yml:66); VPS .env | Unchanged; Phase-2 Playwright pricing is PLAN.md Q8 | `unchanged` | `stays` |  |
| `XB_DOWNLOAD_FILES` | – | xometry-bot pipeline | workflow literal "0" (xometry-scan.yml:67); VPS .env | Unchanged | `unchanged` | `stays` |  |
| `XB_HEADLESS` | – | xometry-bot Playwright phases (not deployed) | VPS .env (optional) | Not migrated | `unchanged` | `stays` |  |
| `XB_DATA_DIR` | – | xometry-bot | VPS .env (optional) | Not migrated | `unchanged` | `stays` |  |
| `XB_BUYER_PROFILE_DIR` | – | xometry-bot buyer_pricer (not deployed) | VPS .env (optional) | Not migrated | `unchanged` | `stays` |  |
| `XB_PARTNER_PROFILE_DIR` | – | xometry-bot partner_form (not deployed) | VPS .env (optional) | Not migrated | `unchanged` | `stays` |  |
| `XB_BUYER_SELECTORS_CONFIRMED` | – | xometry-bot buyer_pricer (not deployed) | VPS .env (optional) | Not migrated | `unchanged` | `stays` |  |
| `GITHUB_TOKEN` | – | auto-merge-claude.yml | GitHub Actions (automatic) | Unchanged; the workflow is gated in P0-1 | `unchanged` | `0` | H-2 |
| `SUPABASE_S3_ACCESS_KEY` | – | sheet-metal-service (unused storage_path mode) | VPS .env (sheet-metal-service) | Retire when the service moves to microns-cad | `delete` | `5` |  |
| `SUPABASE_S3_SECRET_KEY` | – | sheet-metal-service (unused storage_path mode) | VPS .env (sheet-metal-service) | Retire when the service moves to microns-cad | `delete` | `5` |  |
| `S3_BUCKET` | – | sheet-metal-service/config.py:10 | VPS .env (default rfq-files) | Retire when the service moves | `delete` | `5` |  |
| `S3_REGION` | – | sheet-metal-service/config.py:11 | VPS .env (default us-east-1) | Retire when the service moves | `delete` | `5` |  |
| `API_KEY` | – | sheet-metal-service main.py (not applied to /flat-pattern) | VPS .env (sheet-metal-service; presumably empty) | Set to the CAD_SHARED_SECRET value by the owner (OW-11): Phase 4 agent CAD jobs send it as X-API-Key; as built in Phase 5 the Container receives it with REQUIRE_API_KEY=1 and requires it on every non-health route | `microns-cad` | `5` |  |
| `app_settings.reddit_client_id` | – | src/pages/dashboard/SettingsPage.tsx (edit form only) | app_settings table | Stays in Supabase or remove: no collector reads it (reddit-collector uses pullpush without credentials) | `supabase-stays` | `stays` |  |
| `app_settings.reddit_client_secret` | – | src/pages/dashboard/SettingsPage.tsx (edit form only) | app_settings table | As above | `supabase-stays` | `stays` |  |
| `gsc_config (OAuth client and token fields)` | GSC_SERVICE_ACCOUNT_JSON (planned microns-ops secret name; not an env name today) | api/\_lib/gsc-client.js:51-52; mcp-server/src/gsc-client.ts | gsc_config table (single row id=1) | microns-ops keeps reading the row with the service credential (decided in Phase 2: GSC_SERVICE_ACCOUNT_JSON is not set) | `microns-ops` | `2` |  |
| `marketing_sender_accounts (per-sender OAuth credentials)` | – | api/marketing.js google-auth; send-campaign; check-replies | marketing_sender_accounts table (2 google_workspace accounts, live 2026-09-30) | Stays in Supabase | `supabase-stays` | `stays` |  |
| `inventory_settings.telegram_bot_token` | – | lib/inventory/stock-check.js; lib/inventory/cron-batch.js | inventory_settings table (per tenant) | Stays in Supabase | `supabase-stays` | `stays` |  |
| `tender_connectors.auth_config` | – | lib/connectors/\* via api/tender-scan.js | tender_connectors table (26 connectors) | Stays in Supabase | `supabase-stays` | `stays` |  |

### 10.2 Names introduced by the target (from [ARCHITECTURE.md](ARCHITECTURE.md) and [wrangler.jsonc.draft](wrangler.jsonc.draft); not CSV rows)

| Name | Type | Where |
|---|---|---|
| `SITE_ORIGIN`, `PREVIEW_HOSTNAMES`, `SEO_STRICT_404`, `R2_ACCOUNT_ID`, `LEGACY_S3_REGION` | vars | microns-site |
| `API_FORWARD_ORIGIN` (= `https://on-demand-craft-greece.vercel.app` from Phase 2), `API_FORWARD_TO_VERCEL`, `API_GATES_MODE`, `API_MACHINE_HOSTS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET` | vars (Phase 2) | microns-site; the bucket vars replace `AWS_S3_BUCKET` and `AWS_ARTICLES_BUCKET` |
| `OPS` (entrypoint `OpsApi`), `PRIVATE_FILES` (jurisdiction `eu`), `API_RATE_LIMIT`, `API_RATE_LIMIT_MAIL`, `API_RATE_LIMIT_BULK` | bindings (Phase 2) | microns-site; rate-limit namespaces `2001`, `2002`, `2003` |
| `TURNSTILE_SECRET_KEY` | secret | microns-site |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secrets | microns-site (R2 S3 API presign) |
| `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY` | secrets | microns-site (replace `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; one pair for both legacy scopes) |
| `ACCESS_MACHINE_CLIENT_IDS` | secret (Phase 2) | microns-site: maps each machine service token to its consumer |
| `SCRAPES` | queue producer (Phase 2) | microns-ops (queue `scrapes`, DLQ `scrapes-dlq`) |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | secrets | CI and e2e (preview Access token, Phase 1); `tender-collector` (Supabase function secrets) and the local MCP server (its env) for their machine tokens (Phase 2) |
| `VITE_TURNSTILE_SITE_KEY` | public build variable (Phase 2) | GitHub secret for the Worker build (`cf-preview.yml`); Cloudflare test site key in Phase 2, real key from Phase 3 S11; not set in the Vercel env |
| `GSC_SERVICE_ACCOUNT_JSON` | secret (optional) | microns-ops; today the service account is a column of the `gsc_config` row, not an env name |
| `XOMETRY_TOKEN`, `XOMETRY_COOKIE` | secrets (Phase 5, optional, built) | microns-ops: the ported scanner (Q8 default); same values as the Supabase and GitHub secrets of today |
| `CAD_SHARED_SECRET` | secret (Phase 4, optional) | microns-ops (sent as `X-API-Key` to the unfold service, whose `API_KEY` gets the same value at OW-11); from Phase 5 also the Container's `API_KEY` |
| `ALLOWED_RCPT`, `AGENT_TENANT_ID` | vars (Phase 4) | microns-mail |
| `AI_GATEWAY_ID`, `AGENT_TENANT_ID`, `QUOTE_FROM`, `QUOTE_REPLY_TO`, `MESSAGE_ID_DOMAIN`, `CAD_BACKEND_DEFAULT`, `MCP_HOSTNAME`, `MCP_ROUTE`, `ACCESS_TEAM_DOMAIN`, `MCP_ACCESS_AUD`, `SCRAPER_USER_AGENT`, `SCRAPER_PERMITTED_HOSTS` | vars (Phase 4) | microns-ops |
| `FLAGS`, `PRIVATE_FILES`, `CAD_JOBS`, `AGENT_EVENTS`, `RFQ_INTAKE`, `QUOTE`, `POST_ORDER`, `RFQ_THREAD`, `MATERIAL_STOCK`, `CAD_ROUTER`, `QUOTES_INDEX`, `AI`, `BROWSER`, `EVENTS`, `MCP_RATE_LIMIT` (namespace `2004`) | bindings (Phase 4) | microns-ops; named entrypoint `MailIngest` |
| `AI_GATEWAY_TOKEN`, `CAD_UNFOLD_URL`, `CAD_ACCESS_CLIENT_ID`, `CAD_ACCESS_CLIENT_SECRET` | secrets (Phase 4, optional) | microns-ops; the CAD Access pair only with the network path chosen at OW-11 |
| `AGENT_APPROVAL_SECRET` | secret (Phase 4, optional) | microns-site, microns-ops and the Supabase function `telegram-leads-bot` (one value) |
| `MAIL_COPY_TO`, `MAIL_FALLBACK_TO` | secrets (Phase 4, optional) | microns-mail (verified destination addresses) |
| `TELEGRAM_WEBHOOK_SECRET`, `AGENT_DECISION_URL` | Supabase function secrets (Phase 4) | `telegram-leads-bot` |
| `TRACKING_DOMAIN`, `DIGEST_FROM`, `MARKETING_FOLLOWUPS_ENABLED`, `MARKETING_WARMUP_ENABLED`, `OUTBOUND_MAIL_PAUSED`, `OUTBOUND_MAIL_STOPPED`, `CAD_SLOTS`, `CAD_INPUT_HOSTS`, `CAD_PROCESSING_TIMEOUT_S`, `CAD_KEEP_WARM` | vars (Phase 5) | microns-ops; T2-only overrides (`*_API_BASE`, `AGENT_GEMINI_BASE_URL`, `CAD_CONTAINER_BASE_URL`, `CONTENT_WAIT_TIMEOUT_S`) never in a production config |
| `SEO_CACHE`, `TRANSLATIONS`, `OUTBOUND_MAIL`, `CONTENT_DAILY`, `SITEMAP`, `OPS_DIGEST`, `SENDER_LIMITER`, `CAD_CONTAINER`; container `microns-cad` | bindings (Phase 5) | microns-ops; queues `translations`, `outbound-mail` (+ DLQs); DO migration tag `v2` |
| `CAD_COMPAT_TOKEN` | secret (Phase 5, optional) | microns-site: path token of `/api/cad/<token>/flat-pattern`; it travels inside the Supabase secret `UNFOLD_SERVICE_URL` |
| `XOMETRY_SCAN_SCHEDULE`, `cad-release` | GitHub repository variable and environment (Phase 5) | `xometry-scan.yml` skips scheduled runs while the variable is `off`; `cad-image.yml` pushes the image only through the environment, whose secrets are `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |

Unchanged names reused by the Workers: `SUPABASE_URL` (var), `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` (not set while the gateway holds the key, BYOK), `GEMINI_API_KEY` (not set on a Worker either: from Phase 5 the gateway holds the Google key), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `APOLLO_API_KEY`, `INDEXNOW_KEY`. The planned `MCP_OAUTH_*` secrets are not created: the remote MCP uses Access Managed OAuth (PLAN.md §5.4 DC-1).

## 11. External APIs

Not present (checked so they are not missed): no payment provider (no Stripe, PayPal, Viva, Mollie or Braintree reference in the repo) and no Vercel Analytics (correction C11; the only analytics are the GA4 and Google Ads tags).

| ID | API | Hosts | Used by | Target | Component | Phase |
|---|---|---|---|---|---|---|
| `EXT-anthropic` | Anthropic Messages API | api.anthropic.com/v1/messages | generate-daily-article | AI Gateway microns (Anthropic, provider-native endpoint, keys stored in the gateway) from microns-ops; Phase 4 agents use claude-sonnet-5-5 (extract) and claude-haiku-4-5 (classify); article generation (Phase 5, built) uses claude-sonnet-5 or value.model with the live request body | `microns-ops` | `5` |
| `EXT-gemini` | Google Gemini (Generative Language API) | generativelanguage.googleapis.com (v1, v1beta) | translate-article; post-to-social-media | AI Gateway route translate (Google AI Studio) from microns-ops; as built in Phase 5 the live chain from gemini-2.5-flash-lite to gemini-flash-latest with the key stored in the gateway; post-to-social-media stays | `microns-ops` | `5` |
| `EXT-gmail` | Gmail API | gmail.googleapis.com | send-campaign; check-replies | microns-ops (outbound-mail consumer behind the send-campaign route, built in Phase 5; read-only Gmail poller in the \*/10 dispatcher, built in Phase 4) | `microns-ops` | `5` |
| `EXT-google-oauth` | Google OAuth 2.0 (authorize, token, userinfo) | accounts.google.com/o/oauth2/v2/auth; oauth2.googleapis.com/token; www.googleapis.com/oauth2/v2/userinfo | api/marketing.js; send-campaign; check-replies | microns-ops; redirect URI registered explicitly (CFG-google-oauth-redirect) | `microns-ops` | `2` |
| `EXT-gsc` | Google Search Console API + Indexing API | searchconsole.googleapis.com/v1; www.googleapis.com/webmasters/v3; indexing.googleapis.com/v3; oauth2.googleapis.com | api/gsc.js; mcp-server | microns-ops (/api/gsc); GSC tools of the remote MCP ported in Phase 4 with a parity test | `microns-ops` | `2` |
| `EXT-telegram` | Telegram Bot API | api.telegram.org/bot…/sendMessage; inbound webhooks to Supabase function URLs | collectors; scanners; bots; inventory alerts | Alerts from microns-ops; bots stay on Supabase; Phase 4 (built): approval cards sent by microns-ops, callbacks through telegram-leads-bot | `microns-ops` | `2` |
| `EXT-facebook` | Facebook Graph API | graph.facebook.com/v21.0/{page}/feed | post-to-social-media | Stays (post-to-social-media stays on Supabase) | `supabase-stays` | `stays` |
| `EXT-linkedin` | LinkedIn Posts API | api.linkedin.com/rest/posts (LinkedIn-Version 202401) | post-to-social-media | Stays; bump the API version | `supabase-stays` | `stays` |
| `EXT-indexnow` | IndexNow (Bing) | www.bing.com/indexnow | translate-article; dashboard | translations consumer in microns-ops (Phase 5, built): one submission per new translation, as live; key file stays at /indexnow_key.txt | `microns-ops` | `5` |
| `EXT-hn-algolia` | Hacker News Algolia search | hn.algolia.com/api/v1/search_by_date | hn-collector | scrapes consumer in microns-ops (Phase 5, built), started by the schedule table every 30 min | `microns-ops` | `5` |
| `EXT-pullpush` | Reddit via pullpush | api.pullpush.io/reddit/search/submission | reddit-collector | scrapes consumer in microns-ops (Phase 5, built), one message per tier tick | `microns-ops` | `5` |
| `EXT-xometry` | Xometry partner GraphQL and portals | api.xometry.eu/partners/graphql; partner.xometry.eu (manual MFA token capture); get.xometry.eu (Playwright, not deployed) | xometry-scan; xometry-review | Scanner in microns-ops (Phase 5, built: TypeScript port on the schedule table, Q8 default); submit stays on Supabase | `microns-ops` | `5` |
| `EXT-resend` | Resend (API + webhooks) | api.resend.com (SDK); webhook to /api/marketing?action=webhook | api/emails.js; api/notifications.js; send-campaign; process-followups; send-user-email | Resend stays; called from microns-site and microns-ops; Phase 4 (built): quote mail from microns-ops with Reply-To replies@rfq.micronshub.eu, our Message-ID and an Idempotency-Key | `microns-site` | `2` |
| `EXT-site-self` | Site self-callbacks on www and apex | https://www.micronshub.eu and https://micronshub.eu: /api/tender-scan, /api/marketing?action=track, /api/track, /indexnow_key.txt, /logo.png, /dashboard/\*, /api/scan-directory, /api/scrape-website, /api/funded-startups | tender-collector; send-campaign; process-followups; translate-article; e-mails; mcp-server | microns-site serves every path at the identical URL on www, and the apex redirect preserves path and query, before DNS moves | `microns-site` | `3` |
| `EXT-supabase` | Supabase project cfjrtmtaitwzggzpkhxi (REST, Auth, Storage, Functions, Postgres) | https://cfjrtmtaitwzggzpkhxi.supabase.co; Postgres pooler (GitHub Actions) | everything | Stays (system of record); Workers use SUPABASE_\* bindings; optional Hyperdrive for bulk upserts | `supabase-stays` | `stays` |
| `EXT-module-cdns` | deno.land/std and esm.sh module CDNs | deno.land/std@0.190.0; esm.sh (@supabase/supabase-js, resend, pdf-lib) | edge functions | Unchanged for functions that stay; ported code bundles npm packages | `unchanged` | `stays` |
| `EXT-ga4-ads` | Google Analytics 4 + Google Ads tags | www.googletagmanager.com/gtag/js (AW-17760727501, G-G6T5PMFLRH) | every page | Unchanged (same index.html); no Web Analytics automatic setup or HTML-rewriting features | `unchanged` | `1` |
| `EXT-maps-embed` | Google Maps Embed API | www.google.com/maps/embed/v1/place | Contact page | Unchanged; the Maps Embed key must be referrer-restricted and gain the preview hostnames | `unchanged` | `1` |
| `EXT-google-fonts` | Google Fonts | fonts.googleapis.com; fonts.gstatic.com | every page | Unchanged | `unchanged` | `stays` |
| `EXT-tender-portals` | TED and \~50 national procurement portals | api.ted.europa.eu/v3; ted.europa.eu; tenderned.nl; etenders.gov.ie; boamp.fr; contrataciondelestado.es; service.bund.de; evergabe-online.de; and others (lib/connectors/generic.js:16-271) | api/tender-scan.js | microns-ops: scrapes Queue consumer for scans a machine caller starts, synchronous for staff; test reachability from Cloudflare egress | `microns-ops` | `2` |
| `EXT-europages-wlw` | Europages / wlw directory pages | www.europages.\* ; www.wlw.\* | CompanyScannerPage; mcp-server | microns-ops fetch (Phase 2 handlers unchanged); Phase 4 scrapers module behind agent.growth.scrapers (off): robots.txt gate that fails closed, owner-recorded host permissions, browser only for client-rendered pages of permitted hosts | `microns-ops` | `2` |
| `EXT-funding-rss` | Funding news RSS feeds (funding_feeds table) | techcrunch.com; sifted.eu; eu-startups.com; tech.eu; and others stored in the DB | api/funded-startups.js | microns-ops (scan synchronous in Phase 2); scrapes Queue + Cron Trigger later | `microns-ops` | `2` |
| `EXT-apollo` | Apollo.io people search | api.apollo.io/v1/mixed_people/search | ApolloEnrichment.tsx | microns-ops | `microns-ops` | `2` |
| `EXT-gpteng` | Lovable / GPT Engineer script | cdn.gpteng.co/gptengineer.js | every page | Unchanged for parity; removal is a separate decision after cutover | `unchanged` | `6` |
| `EXT-unsplash` | Unsplash hot-linked images | images.unsplash.com | React pages (not SSR bodies) | Unchanged | `unchanged` | `stays` |
| `EXT-laserkritis-static` | LaserKritis static asset host | static.laserkritis.gr | public/laserkritis/index.html | Unchanged | `unchanged` | `stays` |
| `EXT-google-translate` | Google Translate endpoint (local scripts only) | translate.googleapis.com | developer | Unchanged (not deployed) | `unchanged` | `stays` |

## 12. Special static files

All paths stay identical. `public/_redirects` must be deleted before any Cloudflare deploy (H-3).

| ID | Path | Location | Status | Target | Phase | Notes |
|---|---|---|---|---|---|---|
| `STA-robots-txt` | /robots.txt | public/robots.txt | served | Static asset, byte-identical | `1` | 573 B; Sitemap line public/robots.txt:36; Disallow list omits /customer, /partner, /reset-password, /rfq-details, /impressum (pre-existing) |
| `STA-robots-ai-txt` | /robots-ai.txt | public/robots-ai.txt | served (not referenced) | Static asset, byte-identical | `1` | Contains a placeholder Sitemap line (public/robots-ai.txt:99): debt, not fixed during parity |
| `STA-indexnow-key` | /indexnow_key.txt | public/indexnow_key.txt | served | Static asset at the identical path | `1` | 34 B; must equal INDEXNOW_KEY; referenced as keyLocation by translate-article |
| `STA-zoho-index` | /zohoverify/index.html (and /zohoverify/) | public/zohoverify/index.html | served | Static asset; directory-index emulation for /zohoverify/ if the baseline shows Vercel serving it (plan §7 router step 5) | `1` | Meta refresh to verifyforzoho.html (public/zohoverify/index.html:7); purpose undocumented (PLAN.md Q13) |
| `STA-zoho-html` | /zohoverify/verifyforzoho.html | public/zohoverify/verifyforzoho.html | served | Static asset at the identical path | `1` | 134 B |
| `STA-zoho-txt` | /zohoverify/verifyforzoho.txt | public/zohoverify/verifyforzoho.txt | served | Static asset at the identical path | `1` | 9 B |
| `STA-laserkritis` | /laserkritis/index.html (and /laserkritis/) | public/laserkritis/index.html | served | Static asset until Phase 6, then delete (superseded by src/pages/tenants/laserkritis) | `6` | 49,636 B standalone Greek landing page; directory-index emulation if the baseline shows /laserkritis/ served |
| `STA-cookie-consent` | /cookie-consent.html | public/cookie-consent.html | served (unused fragment) | Delete in Phase 1 (plan §8b) | `1` | The live banner is src/components/CookieConsentBanner.tsx |
| `STA-occt-wasm` | /occt-import-js.wasm | public/occt-import-js.wasm | served | Static asset; Content-Type application/wasm; confirm the file is within the Static Assets per-file size limit at build | `1` | 7,604,031 B; HEAD in the parity set |
| `STA-occt-js` | /occt-import-js.js | public/occt-import-js.js | served | Static asset | `1` | 96,852 B |
| `STA-redirects-file` | public/\_redirects ('/\* /index.html 200') | public/\_redirects:1 | copied to dist/, inert on Vercel | DELETE in Phase 1 before any Cloudflare deploy (Static Assets honour \_redirects: CF docs, verified 2026-09-27) | `1` | Netlify syntax; on Workers Static Assets it would rewrite every language URL to the un-injected shell |
| `STA-public-index-html` | public/index.html (stale Lovable shell) | public/index.html | never served (overwritten by the built index.html) | Delete in Phase 1 | `1` | 6,073 B; stale tracking IDs and inline cookie banner |
| `STA-shell` | /index.html (built shell) and SPA fallback document | index.html → dist/index.html | served; fetched by the middleware on every SEO request | Static asset; the Worker reads it with env.ASSETS.fetch(new URL('/index.html', url)) and fails loudly on non-2xx | `1` | GSC HTML meta verification at index.html:12; Supabase preconnect index.html:45; GA/Ads tags index.html:59-84 |
| `STA-assets` | /assets/\* (hashed JS/CSS bundles) | dist/assets/ | served | Static assets; optional \_headers immutable caching | `1` | Content-Type overrides in vercel.json (HR-02, HR-03); compare dist/ file lists Vercel vs Cloudflare build (P0-7) |
| `STA-prerendered` | Prerendered dist/{lang}/\*\*/index.html (210 files) | vite.config.ts:27-50 | built but shadowed by the middleware (never served) | Keep built but unserved (run_worker_first: true); consider dropping the prerender in Phase 6 | `1` | Serving them would change head, og:locale and remove #seo-content |
| `STA-lovable-uploads` | /lovable-uploads/\* (259 files, 56 MB) | public/lovable-uploads/ | served | Static assets at identical paths (R2 later is optional) | `1` | Default og:image (middleware/types.ts:65) and hero preload (index.html:53-57) |
| `STA-logo-png` | /logo.png | public/logo.png | served | Static asset; must also resolve on the apex (e-mails embed https://micronshub.eu/logo.png) | `1` | 45,889 B |
| `STA-logo2-png` | /logo2.png | public/logo2.png | served | Static asset | `1` | 80,740 B |
| `STA-favicon` | /favicon.ico | public/favicon.ico | served | Static asset | `1` |  |
| `STA-favicon2` | /favicon2.ico | public/favicon2.ico | served | Static asset | `1` |  |
| `STA-placeholder-svg` | /placeholder.svg | public/placeholder.svg | served | Static asset | `1` |  |

## 13. Storage buckets

Live Supabase Storage has 4 buckets, all public (2026-09-30). Target R2 buckets ([ARCHITECTURE.md](ARCHITECTURE.md)): `microns-public` (custom domain `files.micronshub.eu`; `articles/<yyyy>/<mm>/<slug>.<ext>`, `tenants/<slug>/…`) and `microns-private` (no public access, jurisdiction `eu`; `rfq/…`, `email/…`, `cad/…`, `quotes/…`, `orders/…`, `sitemaps/…`; as built in Phase 5 `sitemaps/sitemap-complete.xml` is a shadow copy and `phase5-shadow/…` holds the outputs of shadow runs, DV5-1). Phase 2 stores `/api/s3` uploads as `rfq/` + today's key (`<rfqNumber>/<partFolder>/<safeName>`, DV-5) and keeps the files API's per-folder upload counters under `upload-counters/`.

| ID | Bucket | Live | Today | Target | Component | Phase |
|---|---|---|---|---|---|---|
| `BKT-sb-rfq-files` | Supabase Storage rfq-files (public) | live: 3 objects, 109,470 B, public | RFQ downloads read here while uploads go to S3 (split brain, C12); client code creates the bucket | Phase 2 closes the split brain: RfqFileDownload looks the file up through /api/s3 list (R2, then legacy S3) and falls back to this bucket; retire reads, then remove the bucket in Phase 6 | `r2` | `2` |
| `BKT-sb-quote-files` | Supabase Storage quote-files (public) | live: 0 objects, public | Legacy, empty | Delete in Phase 6 | `delete` | `6` |
| `BKT-sb-sitemaps` | Supabase Storage sitemaps (public) | live: 17 objects, 6.76 MB; sitemap-complete.xml updated 2026-09-30; sitemap.xml, sitemap-index.xml and 14 sitemap-{lang}.xml last updated 2025-12-30 | Written daily by generate-sitemap; read by api/sitemap.js | Stays the served source in Phase 5 (DV5-1): sitemap-complete.xml written daily by the sitemap Workflow from S4, with a shadow copy in R2 microns-private sitemaps/; the move to R2 is P7-5 or Phase 6 | `r2` | `5` |
| `BKT-sb-tenant-laserkritis` | Supabase Storage tenant-laserkritis (public) | live: 0 objects, public | Tenant assets bucket per slug | R2 microns-public tenants/&lt;slug&gt;/… later (not built in Phase 5: no consumer yet); Supabase bucket unchanged until then | `r2` | `5` |
| `BKT-sb-documents` | Supabase Storage documents (code reference only) | not present live (2026-09-30) | material_documents.file_url would point here; material_documents has 0 rows | Create in R2 microns-private when the catalogue documents feature is used, or remove the reference (Phase 6) | `r2` | `6` |
| `BKT-s3-rfq` | AWS S3 RFQ bucket (scope rfq, eu-north-1) | live (not listed; AWS console not read) | RFQ CAD uploads via presigned PUT; rfq_files.file_path stores the key; sheet-metal-service downloads by presigned GET | Legacy for existing keys: read and delete through the files API, no new uploads (PLAN.md Q11); new uploads to R2 microns-private under rfq/ + today's key (D-2) | `r2` | `2` |
| `BKT-s3-articles` | AWS S3 articles bucket (scope articles) | live: 755 articles.featured_image URLs point at \*.amazonaws.com (2026-09-30) | Blog images; absolute URLs persisted in articles and emitted as og:image | Legacy: article uploads stay here until P3-6 connects files.micronshub.eu (D-17), then new images go to R2 microns-public articles/&lt;yyyy&gt;/&lt;mm&gt;/&lt;slug&gt;.&lt;ext&gt;; existing URLs keep resolving | `r2` | `3` |

## 14. Database table groups

Supabase stays the system of record. The 13 groups cover all 72 live public tables (RLS enabled on all 72, live 2026-09-30). RLS remediation is Phase 6 (docs/security/rls-remediation-plan.md and the private note); Phase 4 adds `inbound_emails`, `quote_workflows`, `cad_jobs`, `stock_reservations`, `agent_runs`, `feature_flags`, `pricing_rules` (migration `supabase/migrations/20261005_agent_layer.sql`, built and tested; applied by the owner at OW-6, so the live counts below are unchanged until then). Phase 5 adds no table and changes no schema; its jobs read and write the content, lead, scanner, marketing and Xometry groups below ([PLAN.md](PLAN.md) §5.5).

| ID | Group | Tables | Table names | Notes | Risks |
|---|---|---|---|---|---|
| `DB-tenancy` | Multi-tenant | 7 | tenants, capabilities_registry, tenant_capabilities, quote_fields_registry, tenant_quote_fields, user_tenant_roles, tenant_pages | 2 tenants, no custom domains (live) | H-5 |
| `DB-auth-roles` | Auth and roles | 2 | user_roles, customer_profiles | customer rows are created by the DB trigger on_auth_user_created_customer (20260806_phase2_rls_per_user.sql:415) | H-6 |
| `DB-rfq-crm` | RFQ and CRM | 8 | rfqs, rfq_items, rfq_parts, rfq_part_files, rfq_files, quote_files, customers, customer_contacts | rfqs 2, customers 21 (live) | H-6 |
| `DB-orders` | Orders and partners | 5 | orders, order_items, products, production_partners, partner_ratings | orders 2 (live) | H-6 |
| `DB-inventory` | Inventory and nesting | 8 | materials, stock_items, nesting_sessions, nesting_session_jobs, nesting_session_sheets, stock_transactions, low_stock_alerts, inventory_settings | all empty today (live); live materials lacks the supplier, SKU, reorder-quantity, lead-time and kerf columns that supabase/migrations/20260401_create_inventory_system.sql declares, and stock_transactions has no order_id (live 2026-10-03; PLAN.md §5.4 DC-5, DC-8) | H-6 |
| `DB-catalogue` | Material catalogue | 4 | material_categories, catalog_materials, material_documents, catalog_stock_log | second material model parallel to inventory.materials | H-6 |
| `DB-content` | SEO content and article pipeline | 7 | articles, article_titles, article_generation_queue, article_generation_logs, silo_categories, content_pages, service_pages | articles 2,344; service_pages 98; content_pages 126 (live) | H-6; H-19 |
| `DB-marketing` | E-mail marketing and inbox | 9 | marketing_subscribers, marketing_campaigns, marketing_analytics, marketing_events, marketing_settings, marketing_sender_accounts, marketing_campaign_recipients, marketing_templates, user_emails | 2 google_workspace sender accounts (live) | H-14 |
| `DB-leads` | Lead monitor | 5 | leads, monitored_subreddits, lead_keywords, lead_notifications, lead_activity | leads 700 (live) | H-6 |
| `DB-scanners` | Company, funding and tender scanners | 9 | company_leads, saved_searches, scan_logs, funded_startups, funding_feeds, funding_scan_logs, tenders, tender_connectors, tender_scan_logs | 26 tender connectors seeded | H-6 |
| `DB-gsc` | Google Search Console dashboard | 5 | gsc_config, gsc_indexing_log, gsc_inspection_cache, gsc_monitored_urls, gsc_index_log | gsc_monitored_urls 2,456 (live); gsc_index_log exists live with no repo reference |  |
| `DB-settings` | Settings and logs | 2 | app_settings, logs | impressum_settings (20260311 migration, used by src/pages/ImpressumPage.tsx) is NOT present live |  |
| `DB-xometry` | Xometry offer queue | 1 | xometry_offers | 0 rows (live) |  |

## 15. Public URL surface

Method: count the URLs the site publishes in `/sitemap-complete.xml`, built by `supabase/functions/generate-sitemap/index.ts` from 11 static page types × 14 languages (`index.ts:87-99`), published `content_pages` except `home` and `blog` (`index.ts:250-258`) and published `articles`; then cross-check against the live database and the live blob.

| Component | Per language | Languages | URLs | Source (live 2026-09-30) |
|---|---|---|---|---|
| Published articles `/{lang}/{blog}/{slug}` | cs 159, da 158, de 178, en 180, es 178, fi 160, fr 178, hu 159, it 178, nb 158, nl 175, pl 158, pt 166, sv 159 | 14 | 2,344 | `articles` where status = published |
| Service pages (`index` + 6 services) | 7 | 14 | 98 | `service_pages` (7 slugs) |
| Content pages (home, blog index, about, contact, industries, our-work, education, legal-notice, privacy-policy) | 9 | 14 | 126 | `content_pages` (9 slugs) |
| Static types not stored in the DB: `/{lang}/{quote}`, `/{lang}/quote-request` | 2 | 14 | 28 | `generate-sitemap` STATIC_PAGES |
| **Total (sitemap URLs)** |  |  | **2,596** | live `sitemap-complete.xml` has exactly 2,596 `<loc>` entries, 2,344 of them articles |

Of the 2,596, the 14 `/{lang}/quote-request` URLs canonicalise to `/{lang}/{quote}` (RF-quote), so the site has **2,582 distinct canonical URLs**. The README.md figure "≈ 2,610" (2,344 + 98 + 126 + 14 × 3) counted 3 static types per language; the code shows 2, because the homepage and blog index are `content_pages` rows. The difference is 14 URLs.

Public URLs outside the sitemap that the parity set must still cover: `/` (200 shell), 17 sitemap URLs, 25 + 3 redirect sources and 2 patterns, special files (§12), soft-404 and path-variant probes (RF-soft404, RF-path-variants), apex and HTTP variants, and tenant hosts such as `laserkritis.micronshub.eu/{lang}` ([SEO_PARITY.md](SEO_PARITY.md)).

## 16. DNS records and the Phase 3 action

Zone `micronshub.eu` is hosted at Papaki (not Vercel DNS) and is DNSSEC-signed with a DS at the registry (live 2026-09-30). Sequence (PLAN.md Phase 3): remove the DS at Papaki, wait the DS TTL, import the zone into Cloudflare with every record DNS-only, move the nameservers, verify mail and verification records, re-enable DNSSEC with the Cloudflare DS; only then move `www`, the apex and the wildcard to Cloudflare. Key material and verification tokens are abbreviated (`…`); full values are in the live zone.

| ID | Record (live 2026-09-30) | Phase 3 action | Component | Phase | Notes |
|---|---|---|---|---|---|
| `DNS-NS-1` | micronshub.eu NS dns1.papaki.gr | Change at the registry to the Cloudflare-assigned nameservers (after DS removal and DS TTL wait) | `cloudflare-dns` | `3` | Correction C9: the zone is at Papaki, not Vercel DNS; the import must preserve every record below |
| `DNS-NS-2` | micronshub.eu NS dns2.papaki.gr | As DNS-NS-1 | `cloudflare-dns` | `3` |  |
| `DNS-SOA` | micronshub.eu SOA dns1.papaki.gr support.papaki.gr serial 2026040806 (10800 3600 1209600 3600) | Replaced by the Cloudflare SOA | `cloudflare-dns` | `3` | Re-dump the Papaki zone file before the move (P0-4) |
| `DNS-A-apex` | micronshub.eu A 216.198.79.1 (Vercel); no AAAA | Import DNS-only; at cutover proxied + Single Redirect Rule to https://www.micronshub.eu${path}${query} with the baseline status | `cloudflare-dns` | `3` | Rollback: record flip back to Vercel (TTL 300 s during the window) |
| `DNS-CNAME-www` | www CNAME 3096eb4eb748a48f.vercel-dns-017.com (A 64.29.17.65, 216.198.79.65) | Import DNS-only; at cutover a proxied placeholder record + Workers Route www.micronshub.eu/\* to microns-site (not a Custom Domain) | `cloudflare-dns` | `3` | Rollback = record flip |
| `DNS-CNAME-wildcard` | \* CNAME cname.vercel-dns.com (answers laserkritis., rfq., \_vercel. and any unassigned label) | Import DNS-only; at cutover proxied wildcard + Workers Route \*.micronshub.eu/\* (Universal SSL covers first-level subdomains: CF docs, verified 2026-09-27) | `cloudflare-dns` | `3` | rfq. stops matching the wildcard once Email Routing adds explicit records (Phase 4) |
| `DNS-MX-1` | micronshub.eu MX 1 aspmx.l.google.com | Copy as-is, DNS-only; never touched | `cloudflare-dns` | `3` | Google Workspace inbound; docs/operations/EMAIL_SETUP.md documents a different (Resend/SES) MX that is not live |
| `DNS-MX-2` | micronshub.eu MX 5 alt1.aspmx.l.google.com | Copy as-is | `cloudflare-dns` | `3` |  |
| `DNS-MX-3` | micronshub.eu MX 5 alt2.aspmx.l.google.com | Copy as-is | `cloudflare-dns` | `3` |  |
| `DNS-MX-4` | micronshub.eu MX 10 alt3.aspmx.l.google.com | Copy as-is | `cloudflare-dns` | `3` |  |
| `DNS-MX-5` | micronshub.eu MX 10 alt4.aspmx.l.google.com | Copy as-is | `cloudflare-dns` | `3` |  |
| `DNS-TXT-spf` | micronshub.eu TXT v=spf1 include:\_spf.google.com \~all | Copy as-is; deliverability review (no Resend include) is a separate decision | `cloudflare-dns` | `3` |  |
| `DNS-TXT-gsc` | micronshub.eu TXT google-site-verification=… (GSC domain property) | Copy as-is before the NS move; verify GSC still verified after | `cloudflare-dns` | `3` | Value in the zone file; also HTML meta at index.html:12 |
| `DNS-TXT-dmarc` | \_dmarc TXT v=DMARC1; p=none; rua=mailto:info@micronshub.eu | Copy as-is | `cloudflare-dns` | `3` |  |
| `DNS-TXT-dkim-resend` | resend.\_domainkey TXT p=… (Resend DKIM public key) | Copy as-is; verify Resend domain status after the move | `cloudflare-dns` | `3` | Live is a TXT record (docs say CNAME) |
| `DNS-TXT-dkim-google` | google.\_domainkey TXT v=DKIM1; k=rsa; p=… (Workspace DKIM) | Copy as-is | `cloudflare-dns` | `3` |  |
| `DNS-TXT-send-spf` | send.micronshub.eu TXT v=spf1 include:amazonses.com \~all (no MX answer) | Copy as-is; check the Resend return-path MX in Resend's dashboard during Phase 3 | `cloudflare-dns` | `3` | Resend return path normally also needs an MX record |
| `DNS-DS` | micronshub.eu DS 14800 8 2 8fdb7923…1bce (at the .eu registry) | Remove at Papaki about 3 days before the NS move; re-add the Cloudflare DS after the zone is active | `cloudflare-dns` | `3` | Correction C9; PLAN.md Q7; pre-flight P0-9 |
| `DNS-DNSKEY-1` | micronshub.eu DNSKEY 256 3 8 AwEAAZwO… (ZSK, Papaki-signed) | Disappears with the Papaki zone; Cloudflare signs after DNSSEC is re-enabled | `cloudflare-dns` | `3` |  |
| `DNS-DNSKEY-2` | micronshub.eu DNSKEY 256 3 8 AwEAAbVO… (ZSK, Papaki-signed) | As DNS-DNSKEY-1 | `cloudflare-dns` | `3` |  |
| `DNS-DNSKEY-3` | micronshub.eu DNSKEY 257 3 8 AwEAAad2… (KSK, Papaki-signed) | As DNS-DNSKEY-1 | `cloudflare-dns` | `3` |  |
| `DNS-CAA` | micronshub.eu CAA (none) | Keep none, or add CAA records that allow the certificate authorities Cloudflare uses; decide in Phase 3 | `cloudflare-dns` | `3` | No CAA today, so certificate issuance is unrestricted |
| `DNS-LKGR-CNAME` | www.laserkritis.gr CNAME laserkritis.gr (other zone) | Unchanged (not in this zone) | `unchanged` | `stays` | Context only: tenant website on its own host |
| `DNS-LKGR-A` | laserkritis.gr A 46.4.122.205 (other zone) | Unchanged | `unchanged` | `stays` |  |
| `DNS-LKGR-NS-1` | laserkritis.gr NS ns365.grserver.gr (other zone) | Unchanged | `unchanged` | `stays` |  |
| `DNS-LKGR-NS-2` | laserkritis.gr NS ns366.grserver.gr (other zone) | Unchanged | `unchanged` | `stays` |  |

## 17. Domains and hostnames

### 17.1 In use today

| ID | Host | Today | Target | Component | Phase |
|---|---|---|---|---|---|
| `DOM-www` | `www.micronshub.eu` | Vercel project domain (primary) | Workers Route www.micronshub.eu/\* to microns-site on a proxied placeholder record; rollback = record flip | `microns-site` | `3` |
| `DOM-apex` | `micronshub.eu` | Vercel domain redirect to www (redirectStatusCode null: status to be read from the baseline) | Single Redirect Rule to https://www.micronshub.eu${path}${query} with the status seen in the baseline | `cloudflare-zone` | `3` |
| `DOM-wildcard` | `*.micronshub.eu` | Vercel project wildcard domain (verified, added 2026-04-08) + wildcard certificate | Proxied wildcard record + Workers Route \*.micronshub.eu/\* to microns-site; more specific routes win (Workers Custom Domains do not support wildcards: CF docs, verified 2026-09-27) | `microns-site` | `3` |
| `DOM-laserkritis-sub` | `laserkritis.micronshub.eu` | Vercel via the wildcard (valid wildcard certificate) | Wildcard route on microns-site | `microns-site` | `3` |
| `DOM-vercel-app` | `on-demand-craft-greece.vercel.app` | Vercel project default domain (serves the same site) | Server-side target of the /api forward (var API_FORWARD_ORIGIN) until Phase 6; must not be linked; removed with the Vercel project in Phase 6 | `delete` | `6` |
| `DOM-rfq` | `rfq.micronshub.eu` | caught by the wildcard CNAME (Vercel) | Email Routing subdomain (MX/TXT added by Cloudflare) with addresses rfq@ and replies@ to microns-mail (Worker built in Phase 4; routing rules set by the owner at OW-9) | `microns-mail` | `4` |
| `DOM-laserkritis-gr` | `www.laserkritis.gr` | nginx on its own host (46.4.122.205), not Vercel | Unchanged; moving it onto the tenant system is PLAN.md Q17 | `unchanged` | `stays` |
| `DOM-microns-hub-com` | `microns-hub.com` | referenced as terms URL in generated PDFs | Owner decision (PLAN.md Q13) | `owner-decision` | `stays` |

### 17.2 Hostnames introduced by the target (from [ARCHITECTURE.md](ARCHITECTURE.md); not CSV rows)

| Host | Target |
|---|---|
| `files.micronshub.eu` | R2 custom domain for `microns-public` |
| `mcp.micronshub.eu` | Custom Domain → `microns-ops` (remote MCP at `/mcp`, built in Phase 4), Access MCP server application `microns-mcp` with Managed OAuth |
| `microns-site.<account>.workers.dev` + preview alias `staging` | Preview (Phase 1–2), Access with a service token, `X-Robots-Tag: noindex`; in Phase 2 also the only host that accepts the machine tokens |
| `api.micronshub.eu` | Machine-caller host for `tender-collector` and the local MCP server from Phase 3 (D-3): Access application `microns-machine-api` with service tokens `microns-machine-collector` and `microns-machine-mcp`, served by `microns-site`, listed in `API_MACHINE_HOSTS` by the Phase 3 runbook before the `www` flip |

## 18. CI workflows

| ID | Workflow | Trigger | Target | Component | Phase | Risks |
|---|---|---|---|---|---|---|
| `CI-auto-merge-claude` | .github/workflows/auto-merge-claude.yml | push to claude/\*\* (auto-merge-claude.yml:4-6) | Gate in pre-flight P0-1 (branch allow-list) with branch protection on main; delete in Phase 6 | `delete` | `0` | H-2 |
| `CI-xometry-scan` | .github/workflows/xometry-scan.yml | cron 0 6,8,10,12,14,16,18 \* \* \* (UTC, xometry-scan.yml:21) + workflow_dispatch | Scan on the schedule table of microns-ops at the same 7 hours (Phase 5, built: TypeScript port, Q8 default); the workflow keeps workflow_dispatch and skips scheduled runs while the repository variable XOMETRY_SCAN_SCHEDULE is off (S8); deleted in P6-6 | `microns-ops` | `5` |  |

Workflows added by the migration (not CSV rows): `.github/workflows/cf-preview.yml` (Phase 1, manual dispatch; Phase 2 adds the `workers/shared` install, the `VITE_TURNSTILE_SITE_KEY` check, the prerender guard against Turnstile markup in `dist/**/*.html` and the bundle guard) and `.github/workflows/cf-ops.yml` (Phase 2, manual dispatch only: typecheck, tests and dry run; `wrangler deploy` of `microns-ops` only with the input `deploy` set to true; Phase 4 changes its header comment only), and `.github/workflows/cf-mail.yml` (Phase 4, manual dispatch only: typecheck, tests and dry run of `microns-mail`; deploy only with `deploy` set to true, after `microns-ops`), and `.github/workflows/cad-image.yml` (Phase 5: pull requests on `sheet-metal-service/**` or `workers/cad/**` and manual dispatch; builds and tests the CAD image; pushes it only on dispatch with `push: true` through the `cad-release` environment). Phase 5 also adds a job-level `if:` to `xometry-scan.yml` (row `CI-xometry-scan`).

## 19. Services, libraries and tools

| ID | Service | Today | Target | Component | Phase | Risks |
|---|---|---|---|---|---|---|
| `SVC-vercel-project` | Vercel project (team dimitrisvards-projects, Hobby plan) | Vercel | Kept deployable and DNS-switchable until Phase 6; then paused for 30 days and decommissioned | `delete` | `6` | H-1; H-24 |
| `SVC-middleware` | SEO engine: middleware.ts + middleware/\* (i18n, inject, meta, schema, services, slugs, types, renderers/\*) | Vercel Routing Middleware | Ported to the microns-site SEO handler; middleware/\* modules imported unchanged, orchestrator copied; caches: in-isolate Map + KV SEO_CACHE 1 h / 30 s negative | `microns-site` | `1` | H-4; H-8; H-9; H-10; H-13; H-20; H-27 |
| `SVC-admin-auth` | api/\_lib/admin-auth.js (Supabase JWT + staff-role check) | Vercel (imported by api/gsc.js) | Same trust model in the Worker gates (workers/shared/src/auth/supabase-jwt.ts: /auth/v1/user, roles from user_roles); api/gsc.js keeps its own check in microns-ops | `microns-ops` | `2` | H-6 |
| `SVC-gsc-client` | api/\_lib/gsc-client.js (Google OAuth + service-account signing) | Vercel (imported by api/gsc.js) | microns-ops; replace crypto.createSign with WebCrypto RSASSA-PKCS1-v1_5 or rely on nodejs_compat | `microns-ops` | `2` | H-20 |
| `SVC-lib-nesting` | lib/nesting/\* (2D nesting engine) | Vercel (imported by api/notifications.js action=nest) | microns-ops request handler with limits.cpu_ms 300,000 (decided in Phase 2, DV-4); Container only if a real order exceeds it (D-6) | `microns-ops` | `2` | H-18 |
| `SVC-lib-inventory` | lib/inventory/\* (inventory, sessions, QR labels, cron batch) | Vercel (imported by api/notifications.js inv-\*) | microns-ops (every /api/notifications action, DV-1); qrcode aliased to its server build | `microns-ops` | `2` | H-20 |
| `SVC-lib-connectors` | lib/connectors/\*, lib/scoring.js, lib/keywords.js, lib/cpv-codes.js, lib/utils.js | Vercel (imported only by api/tender-scan.js) | Bundled unchanged into the microns-ops scrapes Queue consumer | `microns-ops` | `2` |  |
| `SVC-dev-server` | scripts/dev-server.js (Express + Vite dev shim) | local dev only | Replaced by wrangler dev; deleted in Phase 6 | `delete` | `6` |  |
| `SVC-sheet-metal-service` | sheet-metal-service (FastAPI + CadQuery/OCP) | Docker on a VPS (host, spec and cost not recorded; PLAN.md Q2) | microns-cad Container behind the CadRouter DO in microns-ops (Phase 5, built: class in microns-ops, image prebuilt by cad-image.yml, key on every non-health route and a 120 s wall clock); the VPS keeps its current image until Phase 6; async Queue → R2 → Supabase interface later | `microns-cad` | `5` |  |
| `SVC-freecad-unfold` | scripts/freecad-unfold (legacy FreeCAD + Xvfb service) | not deployed | Delete in Phase 6 | `delete` | `6` |  |
| `SVC-xometry-review-box` | xometry-bot review API + Playwright phases (buyer_pricer, partner_form) | not deployed (binds 127.0.0.1:8077 when run) | Keep undeployed; not portable to Browser Rendering (persistent headed MFA login); Phase-2 pricing is PLAN.md Q8 | `unchanged` | `stays` |  |
| `SVC-xometry-dashboard` | xometry-bot/dashboard (portable Next.js variant) | not deployed (kept for reference; the SPA page /dashboard/xometry is live) | Unchanged (reference only) | `unchanged` | `stays` |  |
| `SVC-mcp-server` | mcp-server (micronshub-leads, stdio; 39 tools, 3 resources, 2 prompts) | local laptop under Claude Desktop | Stays local; Phase 2: one SITE_URL for every /api call, Access service-token headers only to a host behind Access, redirects not followed, export_tenders_csv returns the CSV; Phase 4 (built): remote MCP on mcp.micronshub.eu, a stateless handler in microns-ops behind an Access MCP application with Managed OAuth, the 39 tools ported with a parity test; mcp-server/src unchanged | `microns-ops` | `4` | H-14 |
| `SVC-supabase-auth` | Supabase Auth (Site URL, redirect allowlist, e-mail templates) | Supabase | Stays; add the Cloudflare preview host to the redirect allowlist and keep https://www.micronshub.eu (P0-6) | `supabase-stays` | `0` | H-22 |
| `SVC-supabase-realtime` | Supabase Realtime (marketing_campaigns UPDATE, user_emails) | Supabase | Stays | `supabase-stays` | `stays` |  |
| `SVC-google-workspace` | Google Workspace (apex MX, 2 sender accounts) | Google | Unchanged; apex MX never touched; read-only Gmail reply poller for the 2 sender accounts (built in Phase 4) | `unchanged` | `stays` | H-16 |
| `SVC-seo-tests` | SEO test harness: scripts/verify-ssr.sh, tests/middleware/smoke.mjs, tests/e2e/\*.spec.ts, scripts/verify-en-services.sh | local / manual against production | Extended in Phase 1: two hosts, Access service-token headers; new file scripts/seo-parity.mjs | `microns-site` | `1` | H-28 |
| `SVC-script-offer-pdf` | scripts/generate_offer_pdf.py | local one-off | Unchanged (reference) | `unchanged` | `stays` |  |
| `SVC-script-google-token` | scripts/get-google-refresh-token.ts | local one-off | Unchanged | `unchanged` | `stays` |  |
| `SVC-script-seed-gsc` | scripts/seed-gsc-monitored-urls.ts | local one-off | Unchanged | `unchanged` | `stays` | H-7 |

## 20. Configuration rules

| ID | Rule | Location | Target | Component | Phase | Notes |
|---|---|---|---|---|---|---|
| `CFG-middleware-matcher` | Middleware matcher /(14 langs) and /(14 langs)/(.\*) | middleware.ts:682-687 | ASSETS run_worker_first: true (the Worker routes every request, like Vercel) | `microns-site` | `1` | Worker must answer before the prerendered files |
| `CFG-vite-denylist` | Vite CLIENT_SECRET_DENYLIST and client env filter | vite.config.ts:67-85 | Keep verbatim in the Cloudflare build (Workers Builds or CI) with the same VITE_ variables | `microns-site` | `1` | Denylists 4 AWS key names and VITE_ADMIN_PASSWORD_UPDATE_SECRET (C2) |
| `CFG-vite-prerender` | Prerender plugin (210 routes, jsdom, renderAfterTime 5000, production only, skipped silently on failure) | vite.config.ts:27-50, 86-108 | Keep for now (output never served); consider dropping in Phase 6 | `microns-site` | `6` | PLAN.md Q15 asks whether the production build runs it |
| `CFG-build-toolchain` | Package manager and Node version (bun.lockb and package-lock.json both committed; no engines/.nvmrc; Vercel Node 22.x) | package.json; bun.lockb; package-lock.json | Pin package manager and Node (P0-7); compare dist/ file lists Vercel vs Cloudflare build | `microns-site` | `0` | PLAN.md Q15 |
| `CFG-tsconfig-middleware` | tsconfig.middleware.json (type-check only) | tsconfig.middleware.json:1-19 | Reuse for Worker source; add @cloudflare/workers-types | `microns-site` | `1` |  |
| `CFG-supabase-config-toml` | supabase/config.toml verify_jwt entries (14; 3 for functions with no repo source) | supabase/config.toml:2-42 | Re-sync repo from live before Phase 5 (PLAN.md Q6); Phase 5: the sections of the deleted functions, and three sections without a function, are removed by a later commit after OW5-14 | `supabase-stays` | `5` | 10 repo-and-deployed functions have a live verify_jwt that differs from the repo config; the 3 entries for functions without repo source differ too |
| `CFG-supabase-ref` | Hard-coded Supabase project ref cfjrtmtaitwzggzpkhxi in runtime code | middleware.ts:43; api/sitemap.js:24; index.html:45 | Worker var SUPABASE_URL; keep the index.html preconnect (Supabase stays) | `microns-site` | `1` | Only these three are runtime paths |
| `CFG-client-redirect-maps` | Client redirect maps (REDIRECT_MAP 28 entries + 2 patterns; OLD_SLUG_REDIRECTS; OLD_BLOG_SLUG_REDIRECTS) | src/components/SEORedirects.tsx:14-77; src/components/TranslatedRouteMatcher.tsx:71-108 | Unchanged (client fallback); source for the generated microns-site redirect table | `unchanged` | `1` | See RD-01..RD-28, RD-P1, RD-P2 |
| `CFG-google-oauth-redirect` | Google Cloud OAuth redirect URI for the Gmail connect flow | api/marketing.js:46-47 (default https://${VERCEL_URL}/…) | Register https://www.micronshub.eu/api/marketing?action=google-auth&step=callback and set GOOGLE_REDIRECT_URI | `microns-ops` | `2` | Dashboard task for the owner |
| `CFG-resend-webhook-url` | Resend webhook destination URL | api/marketing.js:61,233 (handler); Resend dashboard (URL) | Phase 3 S11: create or repoint the Resend endpoint at https://www.micronshub.eu/api/marketing?action=webhook with its signing secret (microns-ops RESEND_WEBHOOK_SECRET); read the configured host (www or apex) first | `microns-ops` | `2` |  |
| `CFG-s3-cors` | AWS S3 bucket CORS AllowedOrigins (localhost, production, \*.vercel.app) | docs/AWS_S3_VERCEL_GUIDE.md:36-41 | Legacy rfq bucket: no new uploads, so no upload CORS needed; legacy articles bucket keeps its CORS until P3-6; R2 bucket CORS for www and the preview hosts from workers/site/r2/cors.private.json (P2-9) | `r2` | `2` |  |
| `CFG-telegram-webhooks` | Telegram setWebhook targets for the two bots | outside the repo (Telegram) | Unchanged (bots stay on Supabase) | `unchanged` | `stays` |  |
| `CFG-vercel-domain-settings` | Vercel domain-level behaviour: apex redirect status, HTTP→HTTPS, HSTS, default headers, Deployment Protection | Vercel dashboard (not in repo) | Captured in the baseline (P0-3) and reproduced: Redirect Rule status, Always Use HTTPS, HSTS | `cloudflare-zone` | `3` |  |
| `CFG-vercel-firewall` | Vercel firewall / Attack Challenge Mode (non-browser clients get 429 + x-vercel-mitigated: challenge) | Vercel dashboard (setting unread) | Cloudflare bot posture explicitly permissive for verified bots; Bot Fight Mode off; one WAF rate-limit rule on /api/\* | `cloudflare-zone` | `3` | PLAN.md Q1 |
| `CFG-tenant-dns-copy` | Tenant DNS instructions hard-code cname.vercel-dns.com | src/pages/dashboard/tenants/TenantEditPage.tsx:667-678 | Rewrite the copy in Phase 3 | `microns-site` | `3` |  |
| `CFG-mcp-json` | .mcp.json (Supabase MCP dev server) | .mcp.json | Unchanged | `unchanged` | `stays` | Uses SUPABASE_ACCESS_TOKEN |
| `CFG-cursor-plans` | .cursor/plans/email_marketing_hub_implementation_plan_0ac1433b.plan.md | .cursor/plans/ | Unchanged | `unchanged` | `stays` |  |

## 21. Known gaps and discrepancies

### 21.1 Could not be read (owner or pre-flight)

| Gap | Why | Resolution |
|---|---|---|
| Vercel environment variable names | Vercel API returned 403 for the env listing; names in §10 are inferred from code | Owner exports the name list from the Vercel dashboard (names only) before Phase 2 |
| VPS host, spec and monthly cost for `sheet-metal-service` | Not recorded in the repo | PLAN.md Q2 |
| Supabase plan tier | Not visible to the audit | PLAN.md Q2 (affects the cost gate and edge-function time limits) |
| Vercel Attack Challenge Mode / firewall setting | Every probe from the audit container got 429 + `x-vercel-mitigated: challenge` | PLAN.md Q1; baseline from an allow-listed vantage point (P0-3) |
| Supabase Auth URL configuration (Site URL, redirect allowlist, templates) | Dashboard-only | PLAN.md Q16; P0-6 |
| Apex → www redirect status, HTTPS and HSTS behaviour | Vercel domain setting `redirectStatusCode: null`; HTTP probes blocked | Baseline capture (P0-3); CFG-vercel-domain-settings |
| Live source of the 16 live-only edge functions | Not pulled during Phase 0 | P0-5 |
| AWS S3 bucket inventory and CORS | AWS console not read | Phase 2 prerequisite |
| Resend webhook destination host | Resend dashboard not read | CFG-resend-webhook-url |

### 21.2 Discrepancies found while building this inventory

| Item | Stated elsewhere | Found (evidence) |
|---|---|---|
| Deployed edge functions | 40 deployed, 15 live-only (README.md, PLAN.md Q6, plan C4) | 41 deployed, 16 live-only; unique total 46 (live list_edge_functions 2026-09-30; §8) |
| `/api/notifications` actions | 21 actions incl. 18 `inv-*` (plan C14) | 22 actions incl. 19 `inv-*` (`lib/inventory/index.js` switch; `api/notifications.js:266-270`) |
| Public URL count | ≈ 2,610 (14 × 3 static) | 2,596 sitemap URLs; 2,582 distinct canonical (§15) |
| `impressum_settings` table | Created by `supabase/migrations/20260311_create_impressum_settings.sql`, read by `src/pages/ImpressumPage.tsx` | Not present in the live database (2026-09-30) |
| `gsc_index_log` table | No repo reference | Present live (0 rows) alongside `gsc_indexing_log` |
| `documents` storage bucket | Used by `src/utils/catalogApi.ts:232-237` | Not present live |
| `GSC_SERVICE_ACCOUNT_JSON` | Planned microns-ops secret, described as the name used in api/_lib/gsc-client.js | Not an env name today: GSC credentials come from the `gsc_config` row (`api/_lib/gsc-client.js:51-52`) |
| `verify_jwt` settings | `supabase/config.toml` | 10 repo-and-deployed functions differ live, plus 3 config entries for functions without repo source (§8) |
| Resend DKIM | `docs/operations/EMAIL_SETUP.md` documents a CNAME and Resend/SES MX on the apex | Live: `resend._domainkey` TXT; apex MX is Google Workspace only |
| `materials` columns | `supabase/migrations/20260401_create_inventory_system.sql:33-69` declares `supplier`, `supplier_sku`, `lead_time_days`, `reorder_quantity`, `kerf_scrap_factor`, `min_remnant_area_mm2` | Not present live: the live table was created from another definition (`CREATE TABLE IF NOT EXISTS` was a no-op); supplier and SKU exist in `catalog_materials` (live 2026-10-03; PLAN.md §5.4 DC-5, DC-8; schema-drift note for P0-4 / Phase 6) |
| `stock_transactions.order_id` | AGENTS.md §6 (planning version) | No such column live; links use `reference_type` / `reference_id` (live 2026-10-03; DC-5) |

## 22. How this inventory was produced and checked

| Check | Result |
|---|---|
| Generator | A Python script kept outside the repo merges the audit items, parses the repo files listed in §1.1 and embeds the live 2026-09-30 captures; this file and the CSV are generated together, so counts match |
| CSV parse | `python3 -c "import csv;list(csv.reader(open('docs/migration/inventory.csv')))"` parses; 386 data rows + header; 16 columns on every row |
| Secret scan | Every cell scanned for JWT, Google API key, Resend key, AWS key, `sk-` key, bot-token, DSN-with-password and PEM patterns before writing; hits replaced with `<redacted>` (0 hits) |
| Security wording | Every cell scanned for exploit-level wording forbidden in this public repo; none present |
| Byte-exact redirect sources | `RD-01`…`RD-25` names are copied from the parsed `vercel.json`, including the mojibake source of `RD-12` |
| Live cross-checks | Edge-function list, `cron.job`, public tables, storage objects and content counts re-read on 2026-09-30; sitemap blob `<loc>` count = 2,596 |
| Phase 2 update (2026-10-04) | 57 rows brought in line with the Phase 2 build (targets, components and phases of the `/api` endpoints and actions, legacy S3 names, buckets, callers). A script edits only those CSV cells, rewrites the same cells in this file and recomputes §1.4 and §2; the CSV parse check above passes again (386 data rows, 16 columns), and the secret and wording scans were re-run on the new cells (0 hits) |
| Phase 4 update (2026-10-07) | 19 rows brought in line with the Phase 4 build (20 cells: targets of the relay, Gmail poller, LLM, Gmail, GSC, Telegram, Resend and directory rows, the scraper and CAD endpoints, the RFQ, order, inventory and settings table groups, `rfq.micronshub.eu`, the MCP server, Google Workspace and the unfold key; one inventory note). Components and phases are unchanged, so §1.4 and §2 stand; the same script method, CSV parse check (386 data rows, 16 columns) and scans (0 hits); §10.2, §14, §17.2, §18 and §21.2 updated by hand |
| Phase 5 update (2026-10-09) | 75 rows brought in line with the Phase 5 build (75 `proposed_target` cells: 35 edge functions, the 10 ported pg_cron jobs, 11 secret and env rows, 7 external APIs, the sitemap, GSC, flat-pattern and unfold endpoints, 2 buckets, 3 table groups, the Xometry workflow, the unfold service and `config.toml`). Components and phases are unchanged, so §1.4 and §2 stand (the sitemap bucket keeps phase 5 although its move is now P7-5 or Phase 6, DV5-1); the same script method and CSV parse check (386 data rows, 16 columns); §9.2, §10.2, §13, §14 and §18 updated by hand; secret-pattern scan of the changed files: 0 hits |
