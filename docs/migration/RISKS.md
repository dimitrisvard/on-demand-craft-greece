# Microns Hub to Cloudflare migration: risk register

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [README.md](README.md) · [PLAN.md](PLAN.md) · [INVENTORY.md](INVENTORY.md) · [inventory.csv](inventory.csv) · [ARCHITECTURE.md](ARCHITECTURE.md) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [SEO_PARITY.md](SEO_PARITY.md) · [AGENTS.md](AGENTS.md) · [COSTS.md](COSTS.md)

This is the risk register the brief asks for (brief §7 item 7): every known risk of the migration and of the agent layer, with likelihood, impact, score, mitigation, owner, early-warning indicator and status. It covers the brief's named areas (SEO, e-mail deliverability, CAD compute limits, Supabase rate limits from the edge, Workers CPU limits, cost) and every hazard H-1…H-30 (index in [README.md](README.md) §10; mapping in §12 of this file). Task IDs (`P0-n`, `Pn-m`), runbook steps (`S1`…`S17`) and questions (`Q1`…`Q23`) refer to [PLAN.md](PLAN.md).

## 1. How to read the register

| Item | Meaning |
|---|---|
| Evidence | `path:line` = this repository at commit `9afcba8`; "live 2026-09-30" = read-only re-capture on that date; "CF docs (verified 2026-09-27)" = Cloudflare documentation checked during planning; "CF docs, re-check at execution" = platform behaviour not yet verified; "list price — re-check at execution" = prices |
| Likelihood | Judged on 2026-09-30, before the listed mitigation is carried out (nothing is deployed). **High**: the cause exists today and the risk materialises unless the mitigation is done. **Medium**: plausible; depends on configuration or behaviour not yet verified. **Low**: needs an unusual combination of events |
| Impact | **Critical**: organic traffic or indexing lost across many URLs, a site-wide or mail-wide outage, customer data exposed or lost. **High**: a URL family, a revenue process (RFQ, quote, order) or a security control broken for hours, or a phase gate failed. **Medium**: degraded behaviour with a workaround, or a delay of days. **Low**: cosmetic, internal, or a small cost |
| Score | Likelihood (Low 1, Medium 2, High 3) × impact (Low 1, Medium 2, High 3, Critical 4) = 1…12. Bands: 9–12 top, 6–8 high, 3–4 medium, 1–2 low |
| Owner | `Claude` (code, docs, scripts, verification) · `Dimitris` (dashboards, accounts, registrar, decisions) · `Both` |
| Status | `Open` = mitigation defined, not started; `Open — <task, question or phase>` = mitigation waits for that item or is scheduled in that phase; `Mitigated` = mitigation done and proven at a gate (none yet); `Closed` = the cause no longer exists |
| Security rows | Summary level only, in the canonical wording. Details: private security note (delivered to the owner out of band, not in this public repo) |
| Phase 7 rows | R-64…R-70 apply only if the optional Phase 7 ([PLAN.md](PLAN.md) §5.7) proceeds; they are scored but kept out of the top 10 |

Columns of every table in §2: ID · category · risk · cause / evidence · likelihood · impact · score · mitigation (with phase) · owner · early-warning indicator · status.

## 2. Register

### 2.1 SEO

Organic search is the main acquisition channel and SEO parity is a release gate (brief, header and §2 item 2), so SEO rows come first.

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | SEO | Crawlers or SEO tools are challenged or blocked: before cutover no trustworthy baseline can be captured; after it Cloudflare security features challenge verified bots | H-1; every probe from the audit container received 429 + `x-vercel-mitigated: challenge` (live 2026-09-30); Browser Integrity Check is on by default and Bot Fight Mode cannot be skipped by WAF rules (SEO_PARITY.md §8 rows 16, 19) | High | Critical | 12 | Phase 0: P0-3 baseline from an allow-listed vantage point (Q1). Phase 3: SEO_PARITY.md §8 rows 16–21 applied at S11 (Bot Fight Mode and Browser Integrity Check off, WAF skip rule for `cf.client.bot`, "I'm Under Attack" never on); S15 URL Inspection live test on 5 URLs; rollback trigger in PLAN.md §6.5 | Both | Security Events show a challenge or block for a verified bot; GSC crawl requests −20 % day over day; parity runs receive 403 or 429 | Open — Q1 |
| R-02 | SEO | `public/_redirects` (`/* /index.html 200`) is honoured by Workers Static Assets, so every request the Worker hands to the asset layer (JS, CSS, `robots.txt`, `indexnow_key.txt`, images) returns the shell | H-3; public/_redirects:1; `_redirects` rules are always followed for asset requests and not applied to Worker-built responses (CF docs, verified 2026-09-27) | High | Critical | 12 | Phase 1: P1-2 deletes the file before the first deploy; the build fails if `dist/_redirects` exists; special files (group G8) byte-equal in every parity run | Claude | `dist/_redirects` present in a build; any asset answered with `Content-Type: text/html` | Open — P1-2 |
| R-03 | SEO | The ported SEO handler silently serves the un-injected shell: the self-fetch of its own origin fails on Workers (error 1042), or the anon key is missing and every database read returns empty | H-4; middleware.ts:424-427 (self-fetch; `return undefined` on non-2xx); middleware.ts:103-108 (`getAnonKey` returns `''` without an error); middleware.ts:43 (hardcoded project URL) | High | Critical | 12 | Phase 1: P1-4 shell via `env.ASSETS.fetch`; a non-2xx shell and a missing key are logged errors, not fall-throughs; `SUPABASE_URL` var and `SUPABASE_ANON_KEY` secret; `#seo-content` and `X-Seo-Source` compared on every parity URL | Claude | Share of `X-Seo-Source: none` or `i18n` on database-backed URLs in Workers Logs; shell-fetch errors | Open — P1-4 |
| R-04 | SEO | Prerendered HTML or asset-layer redirects answer language URLs instead of the SEO handler (Helmet head, `og:locale` en, no `#seo-content`; 307 trailing-slash hops) | H-8, H-10; vite.config.ts:27 (210 prerender routes); src/main.tsx:7 (`createRoot().render`, no hydration); middleware.ts:334-346 (slash handling); the default `html_handling` redirects `/en` to `/en/` with 307 (CF docs, verified 2026-09-27) | Medium | Critical | 8 | Phase 1: `run_worker_first: true` and `html_handling: "none"` ([wrangler.jsonc.draft](wrangler.jsonc.draft)); host and path variants (G9: `/en/`, `/en//services`, `/EN`) in the parity set; `run_worker_first` never narrowed without a full parity run. Phase 6: P6-6 may drop the prerender plugin | Claude | Parity diff on `og:locale`, canonical or `#seo-content`; any 307 on a language URL | Open — P1-1 |
| R-05 | SEO | Soft-404 behaviour changes by accident during the host move, or `seo.strict_404` later returns 404 for valid URLs (localised slugs, new articles) | H-9; middleware.ts:591, :599, :663 (unknown slugs return `undefined`, so the 200 shell is served); SEO_PARITY.md §7 | Medium | High | 6 | Phase 1: 200s replicated; soft-404 probes (G7) in every parity run. Phase 3: `would_404` logging; the flag is enabled only after 2 weeks of flat GSC coverage and a yes to Q5 (P3-7), followed by a 7-day watch | Both | `would_404` hits on URLs listed in `sitemap-complete.xml`; GSC "Not found (404)" above 1.5× the baseline | Open — Q5 |
| R-06 | SEO | Redirects differ from Vercel: 301 instead of 308, a guessed apex status, the dead mojibake source altered, client-only entries mishandled | H-11; vercel.json:2-128 (25 `permanent: true`, emitted as 308); src/components/SEORedirects.tsx:14-73 (client map and 2 regex patterns); apex domain redirect with `redirectStatusCode: null` (live 2026-09-30) | Medium | High | 6 | Phase 1: P1-5 generated table, 308, raw and NFC-decoded match, unit test per source; the 3 client-only entries become documented, allow-listed deviations. Phase 3: apex Single Redirect Rule with the baseline status (S13) | Claude | Redirect group (G6) diffs; GSC "Page with redirect" count moves after the flip | Open — P1-5 |
| R-07 | SEO | Domain-level and header behaviour is not reproduced: HTTP to HTTPS status, HSTS, default Vercel headers, HEAD and `OPTIONS` answers, `Content-Type`, `Cache-Control`, `X-Seo-Source` | H-24, H-28; middleware.ts:670-677 (SEO response headers); vercel.json:163-184 (CORS, asset content types); apex, HTTPS and HSTS settings live in the Vercel dashboard, not in the repo (live 2026-09-30) | Medium | High | 6 | Phase 0: P0-3 baseline with HEAD, headers, apex and `http://` variants. Phases 1–2: parity compares HEAD, headers and `OPTIONS` on `/api/*` (G10). Phase 3: HSTS and Always Use HTTPS per the baseline (SEO_PARITY.md §8 rows 22–23), checked at S13 | Both | Header diffs in parity reports; HSTS or `Location` mismatch in the S13 checks; CORS preflight failures in browser tests | Open — P0-3 |
| R-08 | SEO | Cloudflare zone features rewrite HTML or headers (Email Address Obfuscation, Rocket Loader, Speed Brain, Automatic HTTPS Rewrites, Cloudflare Fonts, Web Analytics automatic setup, Zaraz, Managed Transforms) | Brief §6; several are on by default for proxied zones (SEO_PARITY.md §8 rows 2–12 and 26–28; CF docs, verified 2026-09-30) | High | High | 9 | Phase 3: SEO_PARITY.md §8 applied at S11 by Dimitris before any record is proxied, verified by Claude with the zone-settings export as evidence; production parity at S12 and daily during S16. Phases 3–6: any zone change is followed by a parity run | Dimitris | `email-decode.min.js`, an analytics beacon or a `Speculation-Rules` header in production responses; body or header diffs after a dashboard change | Open — S11 |
| R-09 | SEO | `robots.txt` is altered at the edge (managed robots.txt, AI-crawler blocking), or its known gaps are "fixed" during the move | H-28; public/robots.txt:20-36 (Disallow list without `/customer`, `/partner`, `/reset-password`, `/rfq-details`, `/impressum`; `Sitemap:` line); brief §6 (keep `robots.txt` static and identical); SEO_PARITY.md §8 rows 13–14 | Medium | High | 6 | Phase 3: managed robots.txt and AI Labyrinth off at S11; byte-equal with HEAD (G8) at every gate and in the S12 smoke. After Phase 3: gaps changed only as a separate SEO decision | Both | `robots.txt` hash differs from the S11 baseline; GSC host status shows a robots.txt fetch warning | Open — S11 |
| R-10 | SEO | Sitemaps are served with different bytes, headers or generations (Cache API is per data centre; 6.2 MB body; stale per-language blobs "repaired"; request-dated `lastmod` in `/sitemap.xml`) | H-12; api/sitemap.js:392-396 (headers); `sitemap-complete.xml` 6,273,304 B with 2,596 `<loc>`, per-language blobs stale since 2025-12-30 (live 2026-09-30); `.xml` is not edge-cached by default (CF docs, verified 2026-09-27) | Medium | High | 6 | Phase 1: P1-6 port with identical headers, streamed body, Cache API 1 h, stale blobs served as they are; sitemaps (G5) compared in the 10:05 UTC window (SEO_PARITY.md §2.4). Phase 5: the R2 source switch keeps identical URLs and bytes (P5-2) | Claude | GSC Sitemaps report warning; any `/sitemap*.xml` response that is not 200 `application/xml` (rollback trigger) | Open — P1-6 |
| R-11 | SEO | Tenant hosts keep the Microns SEO body and `www` canonical (pre-existing), or the port changes this behaviour by accident | H-13; middleware.ts:334 (routing on the path only; the hostname is never read); 2 tenants, no custom domains (live 2026-09-30) | Low | Medium | 2 | Phases 1–3: kept for parity; `laserkritis.micronshub.eu/en` in G9. After Phase 3: any change is a separate decision (Q9) | Both | Tenant-host parity diff; GSC "Google chose different canonical" rises for tenant hosts | Open — Q9 |
| R-12 | SEO | Shell drift: the `dist/index.html` the Worker injects into differs from the one Vercel serves (other commit, other build, other asset hashes, prerender skipped), so identical handler code produces different pages | H-23; middleware.ts:424 (every SEO response starts from the shell); vite.config.ts:87-106 (prerender loaded only when available, skipped with a warning) | Medium | High | 6 | Phase 1: the Worker version is built from the same commit as the Vercel production deployment; `dist/` file lists compared (Phase 1 gate item 2). Phase 3: S11 pins the version ID that passed the gates | Claude | Shell hash or `<script>` references differ between the hosts; build log contains "Prerendering skipped" | Open — P0-7 |
| R-13 | SEO | Preview or duplicate hosts get indexed (`*.workers.dev`, the `staging` alias; `on-demand-craft-greece.vercel.app` already serves the site) | Vercel project domains (live 2026-09-30); brief §6 (`X-Robots-Tag: noindex` on the preview) | Medium | Medium | 4 | Phase 1: P1-7 `X-Robots-Tag: noindex` on every non-production host plus Access on preview hosts (gate item 8); the `vercel.app` host is never linked. Phase 6: Vercel project paused | Claude | Preview URLs in GSC or in `site:` results; a preview response without `X-Robots-Tag` | Open — P1-7 |
| R-14 | SEO | URLs outside our control stop working: S3 image URLs in `og:image` and article bodies, tracking and unsubscribe links in sent e-mails, `/indexnow_key.txt`, apex `/logo.png` | H-14, H-17; middleware.ts:603 (`og:image` from `featured_image`); 755 `featured_image` rows on `*.amazonaws.com` (live 2026-09-30); api/emails.js:165 and supabase/functions/send-campaign/index.ts:8 (apex URLs in e-mails) | Medium | High | 6 | Phase 2: legacy S3 read-only (Q11); `/api/marketing?action=track` and `/api/track` byte-identical (gate item 4). Phase 3: apex paths checked at S13; `/indexnow_key.txt` in G8 | Both | HEAD failures on a sample of S3 image URLs; tracking pixel error rate; IndexNow submission errors | Open — Q11 |
| R-15 | SEO | Translation lag leaves hreflang clusters incomplete, and a pipeline port could widen the gap | H-19; cs/da/fi/hu/nb/pl/sv newest article 2026-09-11 (19 days behind), pt 2026-09-22 (live 2026-09-30); supabase/functions/translate-article/index.ts:63-71 (retired Gemini model IDs in the repo; live v81 may differ) | High | Medium | 6 | Phase 0: P0-5 pulls the live source. Phase 5: `content-daily` Workflow with Queue `translations` and backfill (P5-2); gate item 1 requires the lag to fall every day | Claude | Newest article date per language in the ops digest; `translations-dlq` backlog | Open — P5-2 |

### 2.2 Delivery

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-16 | Delivery | Any push to a `claude/**` branch reaches production: the workflow merges it into `main` (fast-forward, else `-X theirs`) and Vercel deploys `main` | H-2; .github/workflows/auto-merge-claude.yml:3-6 (trigger), :26-30 (merge and push to `main`) | High | Critical | 12 | Phase 0: P0-1 branch allow-list and branch protection on `main` before any code push (Q10, Q12). Phase 6: the workflow is deleted (PLAN.md §5.6 file list) | Dimitris | A run of the workflow on the migration branch; a commit on `main` without a pull request | Open — P0-1 |
| R-17 | Delivery | Parallel-run drift in Phases 1–3: `main` keeps deploying to Vercel while the Worker is built separately, so a change to `middleware/*`, `vercel.json`, `index.html`, locales or `api/*` makes the two hosts diverge and the rollback target stops matching | Brief §2 item 9 (Vercel deployable until Phase 6); PLAN.md §5.1 ("Untouched" rows: Vercel output must stay identical); Vercel deploys every push to `main` (H-2) | High | High | 9 | Phases 1–6: `middleware/*` imported unchanged (one source); a change to any file on the PLAN.md §5.1 "Untouched" list needs a parity report on both hosts before merge; weekly parity run production vs Vercel until Phase 6 | Claude | A merged commit touching `middleware/`, `vercel.json`, `index.html`, `src/locales/` or `api/` without a parity report | Open |
| R-18 | Delivery | Builds are not reproducible: two lockfiles, no pinned Node version, silent prerender skip | H-23; `bun.lockb` and `package-lock.json` both committed, no `engines`, `packageManager` or `.nvmrc` (repository root at `9afcba8`); vite.config.ts:106 | Medium | Medium | 4 | Phase 0: P0-7 pins the package manager and Node per Q15. Phase 1: CI with the pinned toolchain (P1-9); `dist/` lists compared | Both | CI and Vercel build logs disagree on package manager or Node version | Open — Q15 |
| R-19 | Delivery | Phase 2 changes break existing callers: gates reject machine callers (`tender-collector`, the local MCP server) or e-mail links, and frontend changes made for the Worker API break the Vercel-hosted production | H-6, H-14; supabase/functions/tender-collector/index.ts:5 (`SITE_URL`); mcp-server/src/index.ts:1288, :1327 (apex defaults); PLAN.md §5.2 (gate classes, P2-10) | Medium | High | 6 | Phase 2: gate matrix by caller class; P2-11 repoints callers with credentials before gates are enforced; e-mail links rate-limited only; frontend changes tested against both APIs; gate items 4, 7, 8 | Claude | 401/403 per caller in Workers Logs; tenders or leads inserted per day drop; tracking errors | Open — P2-11 |
| R-20 | Delivery | Preview testing of sign-up and password reset fails: the Supabase Auth redirect allowlist lacks the preview hosts and `/reset-password` has no route | H-22; src/contexts/AuthContext.tsx:218-220 (`redirectTo` ends in `/reset-password`); no such route in src/App.tsx:162-319 | High | Medium | 6 | Phase 0: P0-6 adds the preview hosts (Q16). Phase 1: P1-11 auth-flow test. Phase 6: P6-4 adds the route | Dimitris | Auth e-mails sent from the preview link to `www`; blank page after a reset link | Open — P0-6 |
| R-21 | Delivery | Rollback paths decay: Vercel may fail to renew certificates for the apex, `www` and the wildcard once traffic no longer reaches it; an NS rollback after DNSSEC is re-enabled breaks resolution | PLAN.md §6.3; the wildcard `*` CNAME answers every label, including `_vercel.` (live 2026-09-30) | Medium | High | 6 | Phase 3: Vercel certificate expiry recorded at S11 and re-checked before any rollback after the gate; names Vercel needs for renewal kept as DNS-only records (verify at execution); site rollback by record flips only (S12–S14), never by NS after S10 | Both | Vercel dashboard domain or certificate warnings; a certificate expiring within 30 days | Open — S11 |

### 2.3 Security

Risk wording in this section is the canonical sanitised wording. Details: private security note (delivered to the owner out of band, not in this public repo).

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-22 | Security | An authorisation gap in tenant-role assignment must be closed before the agent layer trusts tenant roles. Details: private security note. | H-5; live 2026-09-30 (private note) | Medium | Critical | 8 | Phase 4: agents authorise staff through Access and `user_roles` staff roles, never through tenant roles (PLAN.md §5.4; AGENTS.md §1.3). Phase 6: P6-2 RLS remediation with policy tests | Both | Monitoring query listed in the private note | Mitigated 2026-10-02: `supabase/migrations/20261002_fix_tenant_role_self_assignment.sql` applied by the owner; P6-2 remediation still scheduled |
| R-23 | Security | Most `/api/*` routes and the `leads-api` edge function do not authenticate callers, and several RLS policies are broader than intended. Phase 2 adds Supabase-JWT/Access gates, Turnstile and rate limits; Phase 6 remediates RLS. Details: private security note. | H-6; private note (per-route gate matrix) | High | Critical | 12 | Phase 2: P2-7 gates per the private matrix, binding `API_RATE_LIMIT`, Turnstile (gate item 6). Phase 3: zone rate-limiting rule (S11). Phase 6: P6-2 RLS remediation; P6-4 caller authentication for `leads-api` | Both | Rate-limit hits and write volumes per route (signals listed in the private note) | Open — mitigation scheduled in Phase 2 (P2-7) and Phase 6 (P6-2, P6-4) |
| R-24 | Security | Supabase service credentials are embedded in pg_cron job commands and many env reads; they are removed from `cron.job` when jobs move in Phase 5 and rotated in Phase 6 (P6-1). Details: private security note. | H-7; 10 live pg_cron jobs, 9 of them HTTP jobs (live 2026-09-30) | Medium | Critical | 8 | Phase 0: P0-2 consumer inventory, kept current as Workers gain secrets. Phase 5: P5-9 unschedules the ported jobs. Phase 6: P6-1 rotation and re-issue to every consumer (PLAN.md Q4, answered 2026-09-30) | Both | A Worker secret created without a P0-2 checklist entry | Open — mitigation scheduled in Phase 6 (P6-1) |
| R-25 | Security | Some integration credentials are stored in database tables whose read access is broader than intended. Details: private security note. | H-30; private note | Medium | High | 6 | Phase 0: P0-2 records the credential source for every consumer. Phase 6: P6-1 rotation; P6-2 and P6-3 | Both | Signals listed in the private note | Open — mitigation scheduled in Phase 6 (P6-1) |
| R-26 | Security | Resend webhook signature verification must be reimplemented to Resend's Svix scheme. Details: private security note. | H-15; api/marketing.js:61 (`webhook` action); live-only edge function `resend-webhook` (live 2026-09-30) | High | Medium | 6 | Phase 2: P2-8 Svix verification with test vectors (gate item 3); the live-only `resend-webhook` retired after a log check (Q6) | Claude | Resend dashboard webhook failure rate; bounce and unsubscribe events stop arriving | Open — mitigation scheduled in Phase 2 (P2-8) |
| R-27 | Security | Hardening debt. Supabase security advisor findings and credential-storage findings: private security note. A Maps Embed key in `src/pages/Contact.tsx` must be referrer-restricted and gain the preview hostnames. CORS `*` with credentials on `/api/*`; substring hostname match; a third-party script on every page | H-21; vercel.json:165-171; src/utils/tenantApi.ts:38; index.html:90 (`cdn.gpteng.co/gptengineer.js`) | Medium | Medium | 4 | Phase 1: preview hostnames added to the Maps key restriction. Phase 6: P6-3 advisors; P6-4 CORS tightened (with a parity re-run) and the Maps key restricted to production hosts; script removal is an owner decision (PLAN.md §5.6) | Both | Supabase advisor count; Maps embed errors on the preview | Open — mitigation scheduled in Phase 6 (P6-3, P6-4) |
| R-28 | Security | A secret value is committed to the public repository during the migration (Worker config, test fixtures, live edge-function sources from P0-5, baseline captures, `cron.job` dumps) | H-7; the repository is public (live 2026-09-30; Q18); P0-4 and P0-5 outputs contain credential values and are stored privately (PLAN.md §4) | Medium | Critical | 8 | Phases 0–6: secret values only in `wrangler secret`, dashboards, Supabase or GitHub secrets; placeholders in [wrangler.jsonc.draft](wrangler.jsonc.draft); secret-pattern scan of every diff before push; dumps kept outside git; GitHub secret scanning enabled; Q18 (make the repository private) | Both | Secret-scanning alert; key-shaped strings in a diff | Open — Q18 |
| R-29 | Security | New agent-layer inputs and write paths are abused: prompt injection in inbound e-mail, attachments or scraped pages; spoofed approvals; the remote MCP server reached by an unintended identity | H-5 (agents never trust tenant roles, AGENTS.md §1.3); AGENTS.md §2.4, §2.7, §3.7 | Medium | High | 6 | Phase 4: new endpoints authenticated from their first deploy (Supabase JWT, Access or a signed call) and rate-limited; LLM output schema-bound, no tools on untrusted text; single-use approval tokens; `mcp.remote` read-only first; Access + OAuth on `mcp.micronshub.eu` | Claude | `injection_suspected` flags; approvals from an unexpected actor; Access denials on `mcp.micronshub.eu` | Open — mitigation scheduled in Phase 4 |
| R-30 | Security | Preview hosts are reachable without Access, or the CI API token is broader than needed | PLAN.md P0-8 (scoped token), P1-7 (Access on preview hosts) | Low | High | 3 | Phase 0: token limited to Workers scripts and routes, R2 and KV (P0-8). Phase 1: Access on preview and version URLs; gate item 8 tests a request without Access | Dimitris | The gate test reaches a preview host without Access headers | Open — P0-8 |

### 2.4 Email

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-31 | Email | Apex MX, SPF or DKIM records are lost or altered on zone import or NS move, stopping Workspace mail or failing DKIM (the Workspace DKIM key is 2048-bit, so its TXT value spans more than one 255-byte string) | C9, C10; MX ×5 with priorities 1, 5, 5, 10, 10, SPF, `google._domainkey`, `resend._domainkey` (live 2026-09-30) | Medium | Critical | 8 | Phase 3: TTL 300 s before T (S2); export and import (S3–S4); `scripts/dns-parity.mjs` compares concatenated TXT values (S5); S9 mail test both ways with DKIM pass at T + 1 h and T + 24 h; NS rollback (S8) is safe while no DS is published | Both | DoH answer differs from the Papaki export; external test mail not received; DMARC aggregate reports show DKIM failures | Open — S5 |
| R-32 | Email | The Workspace MX on the apex is replaced: Email Routing enabled for the apex instead of `rfq.micronshub.eu`, or the stale e-mail setup document followed | Brief §2 item 4; docs/operations/EMAIL_SETUP.md:32-36 documents an Amazon SES MX on `@`, which is not what is live (C10); Email Routing works on subdomains (CF docs, verified 2026-09-27) | Low | Critical | 4 | Phase 4: P4-4 configures only the `rfq.` subdomain with explicit addresses; apex MX re-checked after P4-4; any prompt to change apex records is declined. Phase 6: stale e-mail docs removed or corrected (P6-6) | Dimitris | Apex MX answer is not the 5 Google hosts | Open — P4-4 |
| R-33 | Email | Resend deliverability or domain verification degrades: return-path `send.micronshub.eu` has SPF but no MX; the apex SPF has no Resend include; DMARC is `p=none` | H-16; `send` TXT `v=spf1 include:amazonses.com ~all` with no MX, `_dmarc` `p=none` (live 2026-09-30) | Medium | High | 6 | Phase 3: S9 checks the Resend domain status; P3-6 deliverability report with no apex MX change; records Resend asks for are added on `send.` only; DMARC tightened only after reviewing aggregate reports (owner decision) | Both | Resend bounce or complaint rate; Resend domain status not "verified"; DMARC reports | Open — P3-6 |
| R-34 | Email | Domain verifications are lost (the `google-site-verification` TXT of the GSC domain property, or Resend's records), leaving no GSC data during the 14-day watch | Apex TXT `google-site-verification=…` (live 2026-09-30); domain property `sc-domain:micronshub.eu` (SEO_PARITY.md §10); HTML meta verification at index.html:12 | Low | High | 3 | Phase 3: S4–S5 import check; S9 confirms GSC and Resend verification; the HTML meta tag stays as a fallback for a URL-prefix property | Both | GSC verification-failure notice; Resend domain status change | Open — S9 |
| R-35 | Email | Sending from the 2 Workspace sender accounts misbehaves after the port (duplicate sends under at-least-once delivery, Gmail API quota, broken threading) and harms the reputation of the domain that also sends transactional mail | 2 active `google_workspace` sender accounts (live 2026-09-30); supabase/functions/send-campaign/index.ts:159 (Gmail API send); no `In-Reply-To` or `References` in supabase/functions/process-followups/index.ts; `check-replies` not deployed (C5) | Medium | High | 6 | Phase 4: the Gmail poller only reads (P4-8). Phase 5: `SenderLimiter` DO per account; `outbound-mail` idempotency keys; `process-followups` and `process-warmup` ported but off (P5-4); follow-ups gain threading headers | Claude | Gmail API 429 or quota errors; bounce rate per sender; more than one send per recipient and step | Open — P5-4 |

### 2.5 Compute

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-36 | Compute | Nesting exceeds the Worker CPU limit (50 s budget against a 30 s default) | H-18; lib/nesting/nester.js:286 (`timeLimitMs = 50000`); CPU 30 s default, 5 min maximum (CF docs, verified 2026-09-27); `limits.cpu_ms` 60000 on `microns-ops` ([wrangler.jsonc.draft](wrangler.jsonc.draft)) | High | Medium | 6 | Phase 2: `nest` runs in `microns-ops` with raised `limits.cpu_ms` (P2-5, P2-6); Container fallback if measured CPU exceeds the limit; `api.forward_to_vercel` as rollback | Claude | CPU-limit errors on `/api/notifications?action=nest` | Open — P2-6 |
| R-37 | Compute | Other Workers limits are hit: 6 simultaneous outgoing connections (scrapers, tender connectors), 10,000 subrequests, 128 MB memory (6.2 MB sitemap), 15 min Cron/Queue consumer wall time for long scans | H-12 (6.2 MB sitemap body); CF docs (verified 2026-09-27); 26 seeded tender connectors (AGENTS.md §3.4); api/scan-directory.js (directory scraper) | Medium | Medium | 4 | Phase 2: scans and GSC bulk actions on Queue `scrapes`, at most 6 connections per invocation; sitemap streamed. Phases 4–5: long jobs as Workflows (no overall wall-time limit, CF docs verified 2026-09-27) | Claude | `scrapes` retries and `scrapes-dlq` backlog; subrequest or memory errors in Workers Logs | Open — P2-6 |
| R-38 | Compute | Worker bundle size or startup time exceeds the limits (startup 1 s; the site Worker carries the locale JSON) | H-27; middleware/i18n.ts:2-15 (14 locale JSON imports; 1,732,299 B on disk in `src/locales/*/translation.json`); startup 1 s (CF docs, verified 2026-09-27) | Medium | High | 6 | Phases 1–2: three Workers, so `@aws-sdk`, `pdf-lib`, `lib/inventory` and nesting stay out of `microns-site`; `wrangler deploy --dry-run --outdir` size report at every gate (P1-10, P2-12); lazy locale loading if the report demands it | Claude | Size report trend per commit; deploy rejected; startup warnings | Open — P1-10 |
| R-39 | Compute | Node-only behaviour in the ported code fails at runtime or silently (Buffer, `crypto.createSign`, `createHmac`, `@aws-sdk`, `resend`, module-scope `process.env`, env-name aliases) | H-20; api/_lib/gsc-client.js:18 (`import crypto`); api/sitemap.js:179, :199 (anon key read without the `VITE_` alias); api/s3.js:33-65 (module-scope env reads) | Medium | Medium | 4 | Phases 1–2: `nodejs_compat`, `compatibility_date` `2026-09-01`; Express shim unit tests (P2-2); secret names per [wrangler.jsonc.draft](wrangler.jsonc.draft) with aliases collapsed; e2e test per action (P2-12) | Claude | Worker exceptions per route; `[sitemap] SUPABASE_ANON_KEY not set` warnings | Open — P2-2 |
| R-40 | Compute | Container cold start (10–30 s, planning estimate) and capacity (one synchronous worker per instance, `max_instances` 3) delay quotes or time out synchronous callers of the unfold service | ARCHITECTURE.md §7.4 (estimate); sheet-metal-service/config.py:37 (`PROCESSING_TIMEOUT` declared, not enforced); supabase/functions/generate-manufacturing-pdf/index.ts:55 (`UNFOLD_SERVICE_URL`) | Medium | Medium | 4 | Phase 4: `CadRouter` queues jobs and enforces a wall clock. Phase 5: keep-warm ping in business hours; cold start measured at the gate (item 4); the VPS stays as fallback until Phase 6 (P5-6, P6-5) | Both | `cad_jobs` p95 duration and `timed_out` count; edge-function timeouts in Supabase logs | Open — P5-6 |
| R-41 | Compute | At-least-once delivery in Queues and step retries in Workflows repeat side effects: a second RFQ, a second quote e-mail, double stock holds, duplicate Telegram cards | AGENTS.md §2.1, §2.5; delivery guarantees: CF docs, re-check at execution | High | High | 9 | Phases 4–5: `agent_runs` unique on (`agent`, `idempotency_key`); unique `message_id_sha256`; deterministic Workflow instance IDs; Resend `Idempotency-Key`; `ON CONFLICT` inserts; side effects only inside `step.do` | Claude | Unique-key conflicts in logs; more than one outbound `Message-ID` per quote version and step | Open — Phase 4 |

### 2.6 Data

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-42 | Data | Supabase from the edge: each uncached SEO request makes 1–2 anon REST reads to eu-central-1, isolate caches are colder and more numerous than on Vercel, and crawl bursts meet unknown plan limits (Data API throughput, connections, row cap), so pages slow down or fall back to i18n content | middleware.ts:122, :145 (REST reads), :194 (2.5 s timeout), :44 and :193 (1 h and 30 s isolate caches); api/sitemap.js:186 (dynamic fallback reads all published articles in one request without paging; Data API row cap: Supabase docs, re-check at execution); plan tier unknown (Q2) | Medium | High | 6 | Phase 1: KV `SEO_CACHE` in front of Supabase, positives only (1 h; reads limited to 500 ms, inside the 2.5 s budget where middleware.ts has one), while 30 s negatives stay in the isolate as on Vercel, so unknown URLs cause no KV writes (P1-4, ARCHITECTURE.md §17); timeouts kept; Supabase latency and cache layer logged per request; load test at 2× the peak crawl rate seen in the baseline; `microns-site` stays at the edge, `microns-ops` may use Smart Placement (ARCHITECTURE.md §16). Phase 3: daily `X-Seo-Source` mix during S16 | Claude | Share of `X-Seo-Source: i18n` on database-backed URLs; Supabase REST p95 latency; 429 or 5xx from Supabase | Open — Q2 |
| R-43 | Data | Hyperdrive bulk upserts exhaust Supabase connection slots shared with the Data API, Auth and Realtime | Hyperdrive `SUPABASE_DB` is optional and only for `xometry_offers` (ARCHITECTURE.md §16; session-mode pooling, CF docs, re-check at execution); connection limits depend on the compute size (Q2) | Low | Medium | 2 | Phase 5: Hyperdrive only if the Q8 choice needs it; pointed at the pooler; low connection cap; 7 runs per day (P5-5) | Claude | Supabase "too many connections" errors; Hyperdrive errors | Open — P5-5 |
| R-44 | Data | Customer files are lost or unreadable across S3, R2 and the public Supabase bucket (split brain), including objects written to R2 before a Phase 2 rollback | H-17, C12; api/s3.js:124 (absolute S3 URLs returned); src/components/rfq/RfqFileDownload.tsx:47, :100 (downloads read `rfq-files`); `rfq-files` holds 3 objects (live 2026-09-30); PLAN.md §5.2 rollback | Medium | High | 6 | Phase 2: S3 stays read-only and is never emptied (Q11); the files API reads R2, then S3, then the Supabase path; R2 round trip with SHA-256 (gate item 2); rollback copies R2 objects to S3 under the same keys | Both | 404 rate in the files API; R2 objects without an `rfq_files.r2_key` row | Open — P2-4 |
| R-45 | Data | No independent backup of R2 objects (e-mails, CAD files, quotes, travellers): a deletion or a wrong lifecycle rule is permanent | ARCHITECTURE.md §8 (bucket layout); AGENTS.md §2.6 (90-day lifecycle rule on `email/`); R2 versioning and restore options: CF docs, re-check at execution | Low | High | 3 | Phase 4 (proposal, not yet a PLAN.md task): scheduled copy of `rfq/`, `quotes/` and `orders/` to a separate bucket or external store with a quarterly restore test; lifecycle rules only on `email/`, reviewed in a pull request | Both | Backup run failures in `agent_runs`; object counts differ between source and copy | Open — proposal |
| R-46 | Data | Porting from repo source reproduces behaviour that is not what runs, because edge functions are deployed without CI | H-26; 40 deployed functions, 15 live-only, 5 in the repo but not deployed; `translate-article` live v81; live fix-links cron body `{"fix_all": true}` against `{}` in the repo migration (live 2026-09-30) | High | High | 9 | Phase 0: P0-4 and P0-5 pull live `cron.job` and all 40 sources. Phase 5: P5-1 re-syncs the repo from live (Q6); output parity at the gate | Both | Repo vs live diff report not empty; a function version changes in Supabase without a matching commit | Open — P0-5 |
| R-47 | Data | The RFQ intake agent mis-deduplicates customers (rows also come from an auth trigger), creating duplicates or attaching an RFQ to the wrong customer | H-28; supabase/migrations/20260806_phase2_rls_per_user.sql:414-416 (`on_auth_user_created_customer`); AGENTS.md §3.1 step 7 | Medium | Medium | 4 | Phase 4: match by lower-cased e-mail as `create_public_rfq` does; domain and VAT matches only suggested; `assist` mode with approval cards (P4-5) | Claude | Owner corrections on intake cards; two customers with one domain created within a week | Open — P4-5 |
| R-48 | Data | `MaterialStock` holds drift from manual stock changes during the post-order rollout (no reservation exists today) | AGENTS.md §6; supabase/migrations/20260401_create_inventory_system.sql:24-26 (`reserve` and `unreserve` types, unused by code) | Low | Medium | 2 | Phase 4: the DO re-reads stock on every call; daily "held ≤ remaining" check; `assist` mode (P4-9) | Claude | "held > remaining" card | Open — P4-9 |

### 2.7 Ops

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-49 | Ops | DNSSEC mismatch during the NS move: the DS is still at the registry (or a wrong DS is published) when NS changes, so validating resolvers return SERVFAIL for the site and for mail | C9; DS at the `.eu` registry and Papaki signs the zone (live 2026-09-30); PLAN.md §6.2 S6–S10, §6.3 | Medium | Critical | 8 | Phase 0: P0-9 confirms Papaki's procedure and lead time (Q7). Phase 3: DS removed at T − 3 d, DS TTL + 24 h wait, DS absence verified before S8; Cloudflare DNSSEC only after 24 h active (S10); no NS rollback after S10 without removing the DS first; Claude verifies each step with DoH | Dimitris | Validating resolver without `AD` or with SERVFAIL; DNSViz errors; DoH still shows a `DS` answer at T | Open — P0-9 |
| R-50 | Ops | Zone import artefacts: the wildcard answers every label, so an automatic record scan can create explicit records that later bypass the wildcard Route; panel-only records can be missed | `*` CNAME answers `laserkritis.`, `rfq.`, `_vercel.` and a random label (live 2026-09-30); PLAN.md §6.2 S3–S5 | Medium | Medium | 4 | Phase 3: import from the Papaki export and delete scan additions (S4); `dns-parity.mjs` over every name × type, including a random label (S5) | Both | Records in the Cloudflare export that are not in the Papaki export | Open — S4 |
| R-51 | Ops | Scheduled jobs report success while their outcome is unknown, so regressions before or after the Phase 5 port go unnoticed | H-29; 39 of 128 recent `pg_net` calls ended "Timeout of 5000 ms reached" while `cron.job_run_details` shows "succeeded" (live 2026-09-30) | High | Medium | 6 | Phase 5: the gate measures outputs (articles per language, sitemap, leads); every ported job writes `agent_runs` (P5-8); the ops digest lists failures (P5-7) | Claude | Rows written per job per day against the 7-day baseline; failed `agent_runs` count | Open — P5-8 |
| R-52 | Ops | Key-person dependence: one owner holds every account and signs every gate, and one AI-assisted developer writes the code; absence or lost access stalls a gate or a rollback | PLAN.md §2 (the owner signs each gate); P0-9 (registrar account holder not yet confirmed); owners in PLAN.md §4–§5 | Medium | High | 6 | Phase 0: private account and recovery inventory; a second admin or recovery method on Cloudflare, Papaki, Google Workspace and Supabase. Phase 3: no step from S6 to S17 without the owner reachable; runbook log kept by Claude | Dimitris | A blocking question open for more than 5 working days; gate sign-off overdue | Open |
| R-53 | Ops | Flag and config changes propagate slowly (KV is eventually consistent), so a rollback flag or an agent switch-off lags | AGENTS.md §2.3 (≈ 1 min sync + ≈ 1 min propagation); PLAN.md Phase 4 gate item 3 | Low | Medium | 2 | Phases 2–4: running Workflows re-check the flag before each side effect; switch-off time measured at the Phase 4 gate; record flips remain the site rollback | Claude | Measured switch-off time above 2 min | Open — P4-2 |
| R-54 | Ops | Carried-over debt causes confusion or silent regressions: stale `public/index.html`, `tests/nest.test.js` never runs, UTF-16 `types.ts` covering 25 of 72 tables, relative `/functions/v1/…` calls broken today, `www.laserkritis.gr` on its own host | H-21, H-25; src/utils/partnerAuthUtils.ts:26, :59; 72 public tables and `www.laserkritis.gr` served by nginx on a separate host (live 2026-09-30) | Medium | Low | 2 | Phase 1: `public/index.html` deleted (P1-2). Phase 4: `types.ts` regenerated as UTF-8 (P4-1). Relative calls left as they are for parity; `www.laserkritis.gr` out of scope (Q17) | Claude | — | Open |

### 2.8 Cost

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-55 | Cost | Containers left running: one always-on `standard-1` instance costs about $52 per 30-day month; `max_instances` or keep-warm set too generously | ½ vCPU × $0.000020 per vCPU-s + 4 GiB × $0.0000025 per GiB-s = $0.00002 per second (CF docs, verified 2026-09-27; list price — re-check at execution) | Medium | Medium | 4 | Phase 5: `sleepAfter` ≈ 10 min, keep-warm only in business hours, `max_instances` 3 (P5-6); monthly usage review; Cloudflare billing notification | Both | Container GiB-hours above the included 25 GiB-h per month | Open — P5-6 |
| R-56 | Cost | LLM spend overruns (agent loops, retries, translation backfill, longer prompts) | ≈ $32 per month at the planning load and ≈ $10 at today's volume (AGENTS.md §8; list price — re-check at execution); proposed cap €50 per month (Q20) | Medium | Medium | 4 | Phase 4: AI Gateway budget and rate limits (P4-3); `max_runs_per_day` per flag; `cost_cents` per run; cost per agent in the digest | Both | Gateway spend above 50 % of the cap before mid-month | Open — Q20 |
| R-57 | Cost | Browser Rendering hours or Workers requests exceed included usage (the Worker runs first for every request; scrapers) | `run_worker_first: true` ([wrangler.jsonc.draft](wrangler.jsonc.draft)); Browser Rendering inside the included allowance at the planned volume (AGENTS.md §2.10; list price — re-check at execution) | Low | Low | 1 | Phases 4–5: scraper caps; monthly usage review; `run_worker_first` narrowed only with a full parity run | Claude | Usage above 70 % of an included allowance | Open |
| R-58 | Cost | The cost gate cannot be met or is ambiguous: target estimate against today's €0 Vercel Hobby plus a VPS of unknown cost | Approved plan of 2026-09-27, §11 ($8–15 per month all-in; list price — re-check at execution); [COSTS.md](COSTS.md); Q2, Q14 | Medium | Low | 2 | Phase 0: Q2 and Q14 answered (recommended baseline Vercel Pro at $20 per month, list price — re-check at execution). Phase 6: 30-day cost report (P6-7) | Dimitris | — | Open — Q14 |

### 2.9 Vendor

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-59 | Vendor | Lock-in to Cloudflare-specific primitives (Workflows, Durable Objects, Queues, KV, Email Workers, Containers) raises the cost of leaving | Brief §0 item 3 (Cloudflare-native by design); [ARCHITECTURE.md](ARCHITECTURE.md) §3 | High | Medium | 6 | Phases 1–5: business logic in plain TypeScript modules behind thin binding adapters; Hono and the Express shim are portable; Supabase stays the system of record for Phases 0–6; CAD stays a standard container image | Claude | Share of modules importing `cloudflare:*` outside adapter folders | Open |
| R-60 | Vendor | Platform features or limits change during the migration (feature freezes, deprecations, price changes) | `McpAgent` marked feature-frozen (AGENTS.md §3.7, CF docs verified 2026-09-30); Auto Minify and Mirage deprecated (SEO_PARITY.md §8 rows 3, 5) | Medium | Medium | 4 | Every phase: "re-check at execution" items re-verified at phase start; `compatibility_date` pinned; P4-11 decides between `McpAgent` and `createMcpHandler` | Claude | Cloudflare changelog entries on bindings used in [wrangler.jsonc.draft](wrangler.jsonc.draft) | Open |
| R-61 | Vendor | Third-party changes break jobs: model retirements, expiry of MFA-gated or short-lived tokens, source API changes, portals blocking shared egress IPs | H-19; supabase/functions/translate-article/index.ts:63-71; C19 (Xometry token); .github/workflows/xometry-scan.yml:21; docs/operations/SOCIAL_MEDIA_SETUP_CHECKLIST.md:193-195 (60-day tokens); docs/gsc-manual-setup-runbook.md:113-114 (7-day refresh token in Testing mode) | Medium | Medium | 4 | Phases 4–5: role-based AI Gateway routes, models chosen at phase start; alert on Xometry HTTP 401; token owners and expiry dates on the P0-2 checklist; per-source failure counts in the digest; Browser Rendering or Container egress for portals that block Workers | Claude | 3 consecutive zero-result runs for a source; Xometry 401; token expiry within 14 days | Open |

### 2.10 Legal

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-62 | Legal | Personal data moves to new processors and locations (e-mails, CAD files and quotes in R2; LLM providers; AI Gateway logs; Telegram cards) without matching GDPR records, retention rules and contracts | Supabase in eu-central-1 (live 2026-09-30); R2 jurisdiction `eu` can only be chosen when a bucket is created (AGENTS.md §2.6, CF docs verified 2026-09-30) | Medium | High | 6 | Phase 2: `microns-private` created with jurisdiction `eu` (P2-9). Phase 4: retention per AGENTS.md §2.6; minimised Telegram cards; gateway body logging off for e-mail content where the gateway allows it; the owner confirms processor terms with Q20 and updates the privacy notice | Both | A bucket without a jurisdiction; gateway logs containing e-mail bodies | Open — P2-9 |
| R-63 | Legal | Pre-existing compliance gaps are carried over by parity: analytics and Ads tags load without a consent gate; a terms URL on a domain that may not be owned; commercial use of the Vercel Hobby plan until decommission | index.html:61-84 (gtag loader); src/pages/RfqDetails.tsx:1097 (`microns-hub.com`, Q13); Q14 (Hobby plan terms) | Medium | Medium | 4 | Phases 1–3: recorded, unchanged for parity. After Phase 3: consent gate as an owner decision; Q13. Phase 6: decommission ends the Hobby-plan use | Dimitris | — | Open — Q13 |

### 2.11 Optional Phase 7 (Supabase to D1)

Owner decision 2026-09-30: Supabase stays the system of record for Phases 0–6; Phase 7 is an optional later move ([PLAN.md](PLAN.md) §5.7).

| ID | Category | Risk | Cause / evidence | Likelihood | Impact | Score | Mitigation (phase) | Owner | Early-warning indicator | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R-64 | Security | Authorisation bugs when RLS becomes application code in the D1 data-access layer (the highest Phase 7 risk) | PLAN.md P7-2; RLS enabled on all 72 public tables (live 2026-09-30) | High | Critical | 12 | Phase 7: one data-access layer, deny by default; policy-parity suite generated from `pg_policies`; exit gate | Claude | Policy-parity test failures; unexpected allow or deny counts | Open — Phase 7 not started |
| R-65 | Security | The auth migration fails users: password-hash verification, lost sessions, locked-out partner accounts | PLAN.md P7-3; Q23 | Medium | High | 6 | Phase 7: bcrypt verification on first login (CPU cost measured) or a forced reset e-mail; staged rollout; login success rate normal for 14 days (exit gate) | Both | Login failure rate above the pre-switch baseline | Open — Q23 |
| R-66 | Data | D1 limits and dialect gaps: per-database size, single-writer throughput, jsonb, arrays, enums, functions and triggers | PLAN.md P7-1; D1 limits: CF docs, re-check at Phase 7 start | Medium | High | 6 | Phase 7: limits verified before start; schema-port tests; small volumes (rfqs 2, orders 2, customers 21, leads 700, articles 2,344; live 2026-09-30) | Claude | Query errors or write latency in the data layer | Open — Phase 7 not started |
| R-67 | Data | Loss of PostgREST forces a frontend data-layer rewrite whose size invites regressions | PLAN.md P7-7 (332 `.from(` call sites in 68 files; 77 files in total) | High | Medium | 6 | Phase 7: typed client for `/api/data/*`; e2e test per page; flag `data.backend` rollback | Claude | e2e failures per page | Open — Phase 7 not started |
| R-68 | Data | Backups weaken: D1 Time Travel retention is unverified and the Supabase project, the fallback, is decommissioned | PLAN.md P7-8; Time Travel retention: CF docs, re-check at Phase 7 start | Low | Critical | 4 | Phase 7: final Supabase backup kept; Time Travel retention verified; scheduled D1 exports to external storage | Both | Export job failures | Open — Phase 7 not started |
| R-69 | SEO | The SEO handler's data source switches from Supabase REST to D1 and SEO output changes | PLAN.md P7-8 | Medium | Critical | 8 | Phase 7: full SEO parity gate re-run (0 differences); flag `data.backend` rollback | Claude | Parity diffs; `X-Seo-Source` mix changes | Open — Phase 7 not started |
| R-70 | Vendor | Vendor concentration: compute, data, auth and files all on Cloudflare | Owner decision 2026-09-30 (PLAN.md §5.7) | High | Medium | 6 | Phase 7: scheduled exports of D1 and R2 to external storage; Supabase read-only for 30 days; exit notes kept current | Dimitris | — | Open — Phase 7 not started |

## 3. Heat map

Cells list risk IDs by likelihood (rows) and impact (columns); the score is in brackets. Phase 7 rows (R-64…R-70) are included and marked `P7`.

| Likelihood (rows) / impact (columns) | Low (1) | Medium (2) | High (3) | Critical (4) |
|---|---|---|---|---|
| **High (3)** | [3] — | [6] R-15, R-20, R-26, R-36, R-51, R-59, R-67 P7, R-70 P7 | [9] R-08, R-17, R-41, R-46 | [12] R-01, R-02, R-03, R-16, R-23, R-64 P7 |
| **Medium (2)** | [2] R-54, R-58 | [4] R-13, R-18, R-27, R-37, R-39, R-40, R-47, R-50, R-55, R-56, R-60, R-61, R-63 | [6] R-05, R-06, R-07, R-09, R-10, R-12, R-14, R-19, R-21, R-25, R-29, R-33, R-35, R-38, R-42, R-44, R-52, R-62, R-65 P7, R-66 P7 | [8] R-04, R-22, R-24, R-28, R-31, R-49, R-69 P7 |
| **Low (1)** | [1] R-57 | [2] R-11, R-43, R-48, R-53 | [3] R-30, R-34, R-45 | [4] R-32, R-68 P7 |

Distribution (Phases 0–6, 63 risks): 9 top (score 9–12), 30 high (6–8), 17 medium (3–4), 7 low (1–2).

## 4. Top 10 (Phases 0–6)

Ranked by score, then impact, then likelihood, then register order (the register lists SEO first because organic search is the main acquisition channel).

| Rank | ID | Score | Risk (short) | Decisive mitigation | Gate that proves it |
|---|---|---|---|---|---|
| 1 | R-01 | 12 | Crawlers challenged; no trustworthy baseline | P0-3 from an allow-listed vantage point; zone bot settings at S11 | Phase 0 (baseline stored); S15 |
| 2 | R-02 | 12 | `_redirects` catch-all hijacks asset requests | P1-2 deletion; build check | Phase 1 gate item 1 (G8) |
| 3 | R-03 | 12 | Silent fall-through to the un-injected shell | P1-4 `env.ASSETS.fetch`, loud failures | Phase 1 gate items 1, 3 |
| 4 | R-16 | 12 | Auto-merge puts any `claude/**` push on production | P0-1 allow-list + branch protection | Phase 0 gate item 3 |
| 5 | R-23 | 12 | Most `/api/*` routes do not authenticate callers; some RLS broader than intended (H-6; details private) | P2-7 gates; P6-2 RLS | Phase 2 gate item 6; Phase 6 gate item 1 |
| 6 | R-08 | 9 | Zone features rewrite HTML or headers | SEO_PARITY.md §8 at S11 | S12 smoke; Phase 3 gate item 4 |
| 7 | R-17 | 9 | Vercel and Worker drift apart during the parallel run | Parity report for every change to shared files | Every gate until Phase 6 |
| 8 | R-41 | 9 | Duplicate side effects from at-least-once delivery | Idempotency keys on every side effect | Phase 4 gate items 1, 4 |
| 9 | R-46 | 9 | Ports built from repo source, not live source | P0-4, P0-5, P5-1 | Phase 5 gate (output parity) |
| 10 | R-04 | 8 | Prerendered files or 307 hops answer language URLs | `run_worker_first: true`, `html_handling: "none"` | Phase 1 gate item 1 (G1, G9) |

Next in line (score 8, Critical impact): R-22, R-24, R-28, R-31, R-49. Phase 7 (optional): R-64 (12) and R-69 (8) lead the Phase 7 list.

## 5. Exposure by phase

Production exposure grows with the phases: until the Phase 3 flip nothing the public sees runs on Cloudflare, except what reaches production through `main` (R-16, R-17, R-19).

| Phase | Production exposure | Risks that can materialise in this phase | Rollback if one does ([PLAN.md](PLAN.md)) |
|---|---|---|---|
| 0 Audit + pre-flight | None (docs, dashboards, dumps) | R-01 (no baseline), R-16, R-24, R-28, R-46, R-52 | Not applicable |
| 1 Site + SEO Worker | None: preview hosts only | R-02, R-03, R-04, R-05, R-06, R-07, R-10, R-11, R-12, R-13, R-17, R-18, R-20, R-38, R-42 | Delete the Worker; revert commits (minutes) |
| 2 API port | Frontend changes reach Vercel production through `main` | R-14, R-19, R-23, R-26, R-36, R-37, R-39, R-44, R-62 | Revert commits; after Phase 3 `api.forward_to_vercel` on (≈ 1 min) |
| 3 Zone + cutover | Full: DNS, then `www`, apex and tenant hosts | R-01, R-05, R-07, R-08, R-09, R-10, R-21, R-31, R-33, R-34, R-42, R-49, R-50 | Record flips (≈ 10 min each); NS only per PLAN.md §6.3 |
| 4 Agent layer | New hostnames `rfq.` and `mcp.`; customer-facing sends behind approval | R-22, R-29, R-32, R-35, R-41, R-45, R-47, R-48, R-53, R-56, R-57, R-62 | Per-agent flag off (≈ 1–2 min) |
| 5 Consolidate compute | Scheduled content, collectors, CAD | R-15, R-35, R-40, R-43, R-46, R-51, R-55, R-61 | Re-activate pg_cron jobs, GitHub Action, VPS URL (≈ 15 min) |
| 6 Hardening + decommission | Rotation, RLS changes, Vercel and VPS off | R-21, R-22…R-27, R-54, R-58, R-59, R-63 | Vercel paused, not deleted, for 30 days |
| 7 (optional) | System of record and auth move | R-64…R-70 | Flag `data.backend` = `supabase` |

## 6. Owner decisions and actions that retire the most risk

| Action | Owner | Risks reduced | Needed before |
|---|---|---|---|
| P0-1: gate `auto-merge-claude.yml`, protect `main` (Q10, Q12) | Dimitris | R-16, R-17 | Any code push |
| Answer Q1 and run the P0-3 capture from an allow-listed machine (Claude supplies the script) | Both | R-01, R-06, R-07 | Phase 1 gate |
| Answer Q18 (repository visibility) and enable GitHub secret scanning | Dimitris | R-28 | P0-4, P0-5 |
| P0-9 / Q7: Papaki account holder, DS removal procedure and lead time | Dimitris | R-49, R-52 | Runbook S6 |
| P0-4, P0-5: live `cron.job`, policies, zone file and edge-function sources | Both | R-24, R-46, R-50 | Phase 2 (P2-11), Phase 5 |
| Q15 / P0-7: package manager and Node version | Both | R-12, R-18 | Phase 1 |
| Q16 / P0-6: preview hosts in the Supabase Auth allowlist | Dimitris | R-20 | P1-11 |
| Q2: Supabase plan tier and VPS cost | Dimitris | R-42, R-43, R-58 | Phase 1 load test; cost gate |
| Q11: keep legacy S3 read-only | Dimitris | R-14, R-44 | P2-4 |
| Q5: soft-404 policy | Dimitris | R-05 | P3-7 |
| Q3: current RFQ mailbox and `rfq.micronshub.eu` records | Dimitris | R-32 | P4-4 |
| Q20: LLM budget cap and provider terms | Dimitris | R-56, R-62 | P4-3 |
| Account and recovery inventory with a second admin (private) | Dimitris | R-52 | Runbook S1 |

## 7. Early-warning sources

| Source | Signals | Risks watched | When | Watcher |
|---|---|---|---|---|
| Parity reports (`scripts/seo-parity.mjs`, SEO_PARITY.md §5) | Body, header, status, HEAD and `OPTIONS` differences | R-02…R-12, R-14, R-17, R-69 | Every `microns-site` version; every gate; daily during S16 | Claude |
| Workers Logs (`microns-site`, `microns-ops`) | 5xx, `X-Seo-Source` mix, shell-fetch errors, CPU-limit errors, 401/403 per caller, Supabase latency | R-03, R-19, R-36…R-39, R-42 | Daily in Phases 1–3; weekly afterwards | Claude |
| Cloudflare Security Events | Challenges or blocks for verified bots | R-01, R-08 | S15; daily for 14 days after the flip | Both |
| Google Search Console (UI, `/api/gsc`, local MCP) | Crawl stats, page indexing, host status, sitemaps, URL Inspection | R-01, R-05, R-06, R-09, R-10, R-13, R-34 | S11 snapshot; daily C + 1 … C + 14 (SEO_PARITY.md §10) | Both (Dimitris the UI, Claude the API) |
| DoH checks and `scripts/dns-parity.mjs` | Record differences, DS presence, `AD` flag | R-31, R-49, R-50 | S5, S7, S9, S10; after P4-4 | Claude |
| Mail tests, Resend dashboard, DMARC aggregate reports | Delivery, DKIM results, domain status, bounces | R-31…R-35 | S9; P3-6; weekly from Phase 4 | Dimitris |
| Supabase logs, dashboard and advisors | REST latency, 429, connections, function versions, advisor count | R-27, R-42, R-43, R-46 | Weekly; at every gate | Both |
| `agent_runs`, DLQs, ops digest | Failed runs, unique-key conflicts, backlogs, cost per agent, translation lag | R-15, R-35, R-41, R-51, R-56 | Daily from Phase 4; weekly digest from Phase 5 | Claude |
| AI Gateway analytics and Cloudflare billing | Spend against the cap, Container hours, included-usage share | R-55, R-56, R-57 | Weekly | Dimitris |
| GitHub (Actions runs, secret scanning, branch rules) | Workflow runs on `claude/**`, secret alerts, unprotected pushes | R-16, R-28 | Every push | Both |
| Vercel dashboard | Certificate expiry, domain status | R-21 | S11; monthly until Phase 6 | Dimitris |

## 8. Review cadence

The register is reviewed at every phase gate, before the owner signs it ([PLAN.md](PLAN.md) §2 gate log). At each review Claude re-scores the listed rows with the gate evidence, sets `Mitigated` where the gate proves the mitigation, adds new risks and records the change in §11; Dimitris confirms.

| Moment | Rows re-scored | Extra input |
|---|---|---|
| PLAN.md approval and Phase 0 gate | All rows; in particular R-01, R-16, R-18, R-20, R-24, R-28, R-46, R-52 | Answers to Q1…Q23; P0-1…P0-9 results; baseline snapshot |
| Phase 1 gate | R-01…R-13, R-17, R-18, R-38, R-42 | Parity report, size report, `dist/` comparison, Lighthouse |
| Phase 2 gate | R-14, R-19, R-23, R-26, R-36, R-37, R-39, R-44, R-62 | API e2e, R2 round trip, webhook test, gate-matrix results (private) |
| Phase 3 go/no-go (S1 and S11) and gate (S17) | R-01, R-07…R-10, R-21, R-31…R-34, R-49, R-50 | Runbook log; DNS parity; zone-settings export; daily S16 table |
| Daily C + 1 … C + 14 | R-01, R-05, R-08, R-10, R-42 | SEO_PARITY.md §10.2 daily table; rollback triggers of PLAN.md §6.5 |
| Phase 4 gate | R-22, R-29, R-35, R-41, R-45, R-47, R-48, R-53, R-56, R-62 | One real RFQ end to end; cost per RFQ; flag switch-off test |
| Phase 5 gate | R-15, R-40, R-43, R-46, R-51, R-55, R-61 | 7-day output parity; Container cold-start measurement |
| Phase 6 gate | R-22…R-28 (P6-1…P6-4), R-54, R-58, R-59, R-63; register closed out for Phases 0–6 | Private security checklist; 30-day cost report |
| Phase 7 start (if chosen) | R-64…R-70 | Verified D1 limits; Q23 answer |
| Ad hoc, within 1 working day | Affected rows | Any rollback trigger (PLAN.md §6.5), incident, new hazard, answered question, or Cloudflare / Supabase plan change |

Rules: IDs are never reused; closed rows stay in the register with status `Closed`; a new hazard gets the next H-number in [README.md](README.md) §10 and at least one new R-row here.

## 9. Raw-audit findings folded into register rows

The six-reader audit produced 93 raw hazards ([README.md](README.md) §12). Those not named in H-1…H-30 are covered by the rows below; security findings of all readers are covered by R-22…R-27 and detailed in the private security note.

| Raw finding (reader) | Evidence | Covered by |
|---|---|---|
| Long scans exceed request lifetimes; Vercel function duration limit unknown (api-lib) | api/tender-scan.js; [README.md](README.md) §7 answer 5 | R-37 |
| Edge functions and the MCP server call back into the Vercel host (edge-functions, python-bots-mcp-ci) | supabase/functions/tender-collector/index.ts:5; mcp-server/src/index.ts:1288, :1327 | R-19 |
| Google OAuth redirect derived from `VERCEL_URL` (docs-secrets-services) | api/marketing.js:46-47 | R-19 (explicit `GOOGLE_REDIRECT_URI`, P2-8) |
| Functions without a scheduler, dead senders still deployed, cron state not reproducible from migrations, load-bearing live-only objects (edge-functions, data-layer) | live 2026-09-30 (40 deployed, 15 live-only) | R-46 |
| `send-campaign` sends in one sequential loop inside one invocation (edge-functions) | supabase/functions/send-campaign/index.ts:293 (one loop over all recipients), :119 (`sendViaGoogle`, Gmail API call at :159) | R-35 (Queue `outbound-mail`, one message per recipient) |
| Duplicate env-name aliases must be collapsed when secrets are re-created (docs-secrets-services) | api/s3.js:33-65; api/sitemap.js:179 | R-39 |
| Expiring third-party tokens stored as static secrets (docs-secrets-services) | docs/operations/SOCIAL_MEDIA_SETUP_CHECKLIST.md:193-195; docs/gsc-manual-setup-runbook.md:113-114 | R-61 |
| E-mail DNS documentation contradicts the Workspace set-up (docs-secrets-services) | docs/operations/EMAIL_SETUP.md:32-36 | R-32 |
| Analytics and Ads tags without consent; terms URL on another domain (docs-secrets-services) | index.html:61-84; src/pages/RfqDetails.tsx:1097 | R-63 |
| Duplicate head tags after hydration (frontend-routing-seo) | middleware/inject.ts:57-70; src/components/SEOMeta.tsx:117-153 | R-12 (parity compares server responses; pre-existing, unchanged) |
| Default tenant load costs 4 Supabase queries per browser page load (frontend-routing-seo) | src/utils/tenantApi.ts:65-82 | R-42 (browser traffic, unchanged by the migration) |
| No catch-all route: unknown non-language paths render a blank 200 page (frontend-routing-seo) | src/App.tsx:162-319 | R-05 |
| 1.73 MB of locale JSON in the edge bundle (frontend-routing-seo) | middleware/i18n.ts:2-15 | R-38 |
| Preview hosts treated as tenant custom domains; substring hostname test (frontend-routing-seo) | src/utils/tenantApi.ts:29-51 | R-27 |
| Presigned S3 URL lifetime does not suit an async job interface (python-bots-mcp-ci) | AGENTS.md §5 (`CadRouter` streams inputs from R2) | R-40 |
| Legacy `scripts/freecad-unfold` tree and stale deploy docs (python-bots-mcp-ci) | PLAN.md §5.6 file list | R-54 |
| No stock reservation exists today (data-layer) | supabase/migrations/20260401_create_inventory_system.sql:24-26 | R-48 |
| Stale UTF-16 `types.ts` (data-layer) | src/integrations/supabase/types.ts | R-54 |

## 10. Items to verify at execution

| Item | Rows | Verified when |
|---|---|---|
| Delivery guarantees and retry semantics of Queues and Workflows | R-41 | Phase 4 start |
| Supabase Data API row cap and throughput for the project's tier | R-42 | Phase 1 (with Q2) |
| Hyperdrive pooling mode against Supabase | R-43 | P5-5 |
| R2 versioning, bucket locks and restore options | R-45 | Phase 4 start |
| Vercel certificate renewal once traffic no longer reaches Vercel | R-21 | S11 |
| Records Resend requires on `send.micronshub.eu` | R-33 | P3-6 |
| KV propagation time for `FLAGS` | R-53 | P4-2 |
| Container cold start (planning estimate 10–30 s) | R-40 | Phase 5 gate item 4 |
| Static Assets per-file size and file count (`public/occt-import-js.wasm` is 7,604,031 B) | R-38 | Phase 1 |
| Container, Browser Rendering and LLM prices | R-55, R-56, R-57 | Each phase start (list price — re-check at execution) |
| D1 limits and Time Travel retention | R-66, R-68 | Phase 7 start |

## 11. Change log

| Date | Change |
|---|---|
| 2026-09-30 | First version: R-01…R-70 from hazards H-1…H-30, the raw audit (93 raw hazards, [README.md](README.md) §12), the live re-capture of 2026-09-30 and the owner decisions of 2026-09-30 (credential rotation in Phase 6 as P6-1; optional Phase 7) |
| 2026-10-03 | R-42 mitigation updated to the Phase 1 build: KV `SEO_CACHE` holds positives only |
| 2026-10-03 | R-22 status: role-assignment migration applied on 2026-10-02 |

## 12. Hazard to risk mapping

Every hazard of [README.md](README.md) §10 maps to at least one register row.

| Hazard | Short name | Risk rows |
|---|---|---|
| H-1 | Production challenges non-browser clients; bot posture | R-01 |
| H-2 | Auto-merge of `claude/**` into `main` | R-16, R-17 |
| H-3 | `public/_redirects` catch-all | R-02 |
| H-4 | No self-fetch of the shell; loud failure | R-03 |
| H-5 | Tenant-role authorisation gap (details private) | R-22, R-29 |
| H-6 | Caller authentication on `/api/*` and `leads-api`; RLS broader than intended (details private) | R-23, R-19 |
| H-7 | Service credentials in pg_cron and env reads (details private) | R-24, R-28 |
| H-8 | Prerendered files shadowed | R-04 |
| H-9 | Soft 404s | R-05 |
| H-10 | Trailing and double slashes | R-04 |
| H-11 | 308 redirects; apex status from the baseline | R-06 |
| H-12 | Sitemap chain, headers, Cache API | R-10, R-37 |
| H-13 | Hostname ignored by the SEO handler | R-11 |
| H-14 | URLs embedded in e-mails and callers at identical paths | R-14, R-19 |
| H-15 | Resend webhook verification (details private) | R-26 |
| H-16 | `send.` without MX, SPF, DMARC `p=none` | R-33 |
| H-17 | Legacy S3 URLs persisted | R-14, R-44 |
| H-18 | Nesting CPU | R-36 |
| H-19 | Translation lag; retired models | R-15, R-61 |
| H-20 | `nodejs_compat`, module-scope `process.env` | R-39 |
| H-21 | Miscellaneous debt; advisor and credential-storage findings (details private) | R-27, R-54 |
| H-22 | `/reset-password` and the Auth redirect allowlist | R-20 |
| H-23 | Build reproducibility | R-18, R-12 |
| H-24 | Domain-level behaviour in the Vercel dashboard | R-07 |
| H-25 | `www.laserkritis.gr` on its own host | R-54 |
| H-26 | Edge-function repo/live drift | R-46 |
| H-27 | Worker bundle size | R-38 |
| H-28 | HEAD, headers, `OPTIONS`; `robots.txt` gaps; customer trigger | R-07, R-09, R-47 |
| H-29 | `pg_net` timeouts hide job outcomes | R-51 |
| H-30 | Credentials in broadly readable tables (details private) | R-25 |
