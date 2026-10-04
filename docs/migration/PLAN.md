# Microns Hub to Cloudflare migration: plan

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [README.md](README.md) · [INVENTORY.md](INVENTORY.md) · [inventory.csv](inventory.csv) · [ARCHITECTURE.md](ARCHITECTURE.md) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [SEO_PARITY.md](SEO_PARITY.md) · [AGENTS.md](AGENTS.md) · [RISKS.md](RISKS.md) · [COSTS.md](COSTS.md)

This is the decision document the brief asks for (brief §7 item 2): phases with concrete tasks, a file-level change list per phase, exit gates, rollback, owner and estimated effort, followed by the numbered open questions (brief §0 item 5). Nothing in this file has been executed.

Conventions:

| Item | Meaning |
|---|---|
| Evidence tags | `path:line` = this repository at commit `9afcba8`; "live 2026-09-30" = read-only re-capture on that date; "CF docs (verified 2026-09-27)" = Cloudflare documentation checked during planning; "CF docs, re-check at execution" = platform behaviour not yet verified; "list price, re-check at execution" = prices |
| Owners | `Claude` (code, docs, scripts, verification) · `Dimitris` (dashboards, accounts, registrar, decisions) · `Both` |
| Effort | `d` = one focused working day; figures are estimates. Phase totals are compared with the approved plan of 2026-09-27 |
| IDs | Pre-flight `P0-n`; phase tasks `Pn-m`; hazards `H-1`…`H-30` (index in [README.md](README.md) §10, register in [RISKS.md](RISKS.md)); questions `Q1`…`Q24` (§9 of this file) |
| Security wording | Security findings appear at summary level only. Details: private security note (delivered to the owner out of band, not in this public repo) |

## 1. Summary of decisions

1. **Three Workers and one Container app**, not one Worker: `microns-site` (Static Assets, SEO handler, redirect table, sitemap routes, `/api/*` router), `microns-ops` (Hono: ops/admin API, Cron Triggers, Queues, Workflows, Durable Objects, AI Gateway, remote MCP), `microns-mail` (Email Worker) and `microns-cad` (Container from `sheet-metal-service/Dockerfile`). Repo layout `workers/site`, `workers/ops`, `workers/mail`, `workers/cad`. An agent deploy can never take the SEO path down.
2. **The Worker answers every request first**: `assets.html_handling = "none"`, `not_found_handling = "single-page-application"`, `run_worker_first = true` (CF docs, verified 2026-09-27). The shell comes from `env.ASSETS.fetch('/index.html')`, never a self-fetch (H-4; today middleware.ts:424). `public/_redirects` is deleted in Phase 1 (H-3; public/_redirects:1).
3. **SEO handler ported, not rewritten**: the ~280-line orchestrator of `middleware.ts` is copied into `workers/site`; `middleware/*` is imported unchanged; `Cache-Control` and `X-Seo-Source` stay byte-identical (middleware.ts:670-677).
4. **In-Worker redirect table instead of `_redirects`**: one table generated from the 25 `vercel.json` redirects (vercel.json:2-128) and the client map (src/components/SEORedirects.tsx:14-73), status 308 as on Vercel, matched on raw and NFC-decoded paths, dead mojibake source kept byte-identical.
5. **Soft-404 parity first, then a flag**: unknown slugs keep returning 200 through cutover (H-9); flag `seo.strict_404` (deploy default var `SEO_STRICT_404 = "false"`) returns 404 + shell for unknown-slug classes after 2 weeks of flat GSC coverage (Q5).
6. **`/api/*` split with a rollback flag**: the browser-facing subset runs in `microns-site`, the rest goes over service binding `OPS` to `microns-ops`, long jobs go to Queues, Workflows or the Container. Handlers are reused unchanged through a `@vercel/node`-compatible shim shared by both Workers (Hono routes it inside `microns-ops`). Flag `api.forward_to_vercel` sends all `/api/*` back to Vercel.
7. **Auth gates arrive with the port**: Phase 2 adds Supabase-JWT / Access gates, Turnstile and rate limits to all `/api/*` write paths (H-6); RLS remediation is Phase 6.
8. **Zone first, site second**: the zone moves from Papaki to Cloudflare with every record DNS-only; the DS record is removed at Papaki before the NS change and Cloudflare DNSSEC is enabled afterwards (C9; live 2026-09-30). The site flips later, record by record.
9. **Route, not Custom Domain, for `www`**: a Workers Route `www.micronshub.eu/*` on a proxied placeholder record keeps rollback a single record flip; the apex becomes a Single Redirect Rule with the status seen in the baseline; `*.micronshub.eu` gets a proxied wildcard record plus a Workers Route. Cloudflare for SaaS is deferred (no custom domains exist; live 2026-09-30).
10. **Two R2 buckets**: `microns-public` (custom domain `files.micronshub.eu`) and `microns-private` (no public access). Legacy AWS S3 stays read-only for existing objects, including the 755 article-image URLs (H-17). Supabase Storage is unchanged until Phase 5/6.
11. **Supabase stays the system of record for Phases 0–6** (brief §2 item 3). An optional Phase 7 outlines a later move to D1 (owner decision 2026-09-30).
12. **Pre-flight before any code**: gate `auto-merge-claude.yml` and protect `main` (H-2), capture the baseline from an allow-listed vantage point (H-1), re-dump live state, build the credential consumer inventory (P0-2). Credential rotation itself is P6-1 in Phase 6.
13. **Agents are flag-gated Workflows and Durable Objects with human approval**: Telegram one-tap approvals, AI Gateway `microns` with role-based routes (`extract`, `classify`, `translate`, `embed`), every agent behind a flag in table `feature_flags` mirrored to KV `FLAGS`, every run a row in `agent_runs`.
14. **Compute consolidation is measured on outputs**: Phase 5 ports schedulers job by job and compares outputs (articles, translations, sitemap, leads), not cron status, because `pg_net` timeouts hide outcomes today (H-29).
15. **Vercel stays deployable and DNS-switchable until Phase 6 sign-off** (brief §2 item 9); after decommission the Vercel project is paused, not deleted, for 30 days. Web Analytics, if wanted, uses the manual snippet only.

## 2. How approval works

| Rule | Detail |
|---|---|
| No code before approval | "Do not modify code until I approve `docs/migration/PLAN.md`" (brief, header). Approval of this file authorises the pre-flight items P0-1…P0-9; Phase 1 starts when the Phase 0 gate is signed |
| One phase at a time | A phase starts only after the owner has signed the previous phase's exit gate. Each gate below is a pass/fail list; Claude supplies the evidence, Dimitris signs |
| Branch safety | No code is pushed until P0-1 is done: `auto-merge-claude.yml` merges every push to `claude/**` into `main` (.github/workflows/auto-merge-claude.yml:3-6, :26-30), and Vercel deploys `main` (H-2) |
| Production changes | Every change that reaches production (DNS, zone settings, Worker production versions, Supabase migrations, secrets) is announced with its rollback before it is made and needs the owner's go |
| Plan changes | Anything learnt during execution that changes scope, a gate or a rollback is written into this file first and needs the owner's OK |
| Questions | Answers to §9 are recorded in this file with the date; a question marked "blocks" must be answered before the item it blocks starts |
| Secrets | Secret values go only into `wrangler secret`, the Cloudflare dashboard, Supabase secrets or GitHub secrets, never into files (brief §2 item 7; the repository is public, live 2026-09-30) |

Gate sign-off log (filled in during execution):

| Gate | Evidence (link or file) | Signed by | Date |
|---|---|---|---|
| PLAN.md approved | — | — | — |
| Phase 0 pre-flight | — | — | — |
| Phase 1 | — | — | — |
| Phase 2 | — | — | — |
| Phase 3 | — | — | — |
| Phase 4 | — | — | — |
| Phase 5 | — | — | — |
| Phase 6 | — | — | — |
| Phase 7 (optional) | — | — | — |

## 3. Phase overview

Effort figures are the task sums in §4 and §5; plan.md (2026-09-27) figures in brackets.

| Phase | Scope | Exit gate (summary) | Rollback | Effort | Owner |
|---|---|---|---|---|---|
| 0 Audit + pre-flight | Audit deliverables (this folder); P0-1…P0-9 | Deliverables merged; PLAN.md approved; P0-1…P0-9 done; baseline stored | — | Audit done; pre-flight ≈ 3.2 d [0.5 d] | Both |
| 1 Site + SEO Worker | `workers/site` on `*.workers.dev` only: Static Assets, SEO handler, redirect table, sitemap routes, preview noindex + Access, parity tool | Parity diff 0 unexplained; `dist/` list identical; `verify-ssr.sh` green on preview; Playwright `seo.spec` green; Lighthouse ≥ Vercel on 5 URLs; smoke green; bundle sizes within limits | Delete the Worker; revert commits (no production impact) | ≈ 3.7 d [3–4 d] | Claude (Dimitris: Access, auth test) |
| 2 API port | `workers/ops` + site `/api/*` router; `@vercel/node` shim; R2 for new objects; auth gates, Turnstile, rate limits; Svix webhook; callers repointed | All API e2e paths pass on preview; R2 round trip; webhook test; tracking URLs identical; forward flag proven both ways | Before cutover: none needed. After: `api.forward_to_vercel` on (≈ 1 min) | ≈ 7 d [5–7 d] | Claude (Dimitris: buckets, keys, secrets) |
| 3 Zone + cutover | Zone to Cloudflare (DS removal, NS move, DNSSEC); `www` Route flip, apex redirect rule, wildcard Route; bot/cache settings; 48 h observation | 48 h GSC coverage and crawl stats flat; `verify-ssr.sh` green on production; zero 5xx; mail test; Resend and GSC verified; DNSSEC validates | Record flips back to Vercel (≈ 10 min); NS rollback only per §6.3 | ≈ 3.25 d + DS wait + 48 h [2–3 d + 48 h] | Both |
| 4 Agent layer | Supabase additions; flags; AI Gateway; `microns-mail`; `rfq-intake`, `quote`, `post-order` Workflows; Vectorize; scrapers; remote MCP; dashboard pages | One real RFQ end to end with approval gate; cost per RFQ measured; every agent behind a flag; SEO parity unchanged | Per-agent flag off (≈ 1–2 min) | ≈ 14.5 d [2–3 weeks] | Claude (Dimitris: approvals, accounts) |
| 5 Consolidate compute | Article pipeline Workflow + translation Queue; collectors; marketing crons; Xometry scanner; CAD Container; dead edge functions removed; ported pg_cron jobs unscheduled | 7 days of output parity; old schedulers disabled, not deleted | Re-activate pg_cron jobs / GitHub Action / VPS URL (≈ 15 min) | ≈ 9 d + 7-day window [1–2 weeks] | Both |
| 6 Hardening + decommission | P6-1 credential rotation; RLS remediation; hardening; Vercel and VPS decommission; repo cleanup; cost report | Security checklist signed; P6-1 verified; 30-day cost ≤ target | Vercel project paused (not deleted) for 30 days | ≈ 5.25 d [1 week] | Both |
| 7 (optional) Supabase → D1 | D1 `microns-db`, authorisation layer, auth replacement, data API, data migration | E2e green on D1; row counts and checksums equal; SEO parity 0 diffs; 14 days normal logins; 14 days zero Supabase traffic | Flag `data.backend` back to `supabase` | 6–10 weeks (rough) | Both |

## 4. Phase 0: audit and pre-flight

The audit is complete ([README.md](README.md), [INVENTORY.md](INVENTORY.md)). The pre-flight items below make the later phases safe; none of them changes what production serves.

| ID | Item | Owner | Effort | Done when | Depends on | Refs |
|---|---|---|---|---|---|---|
| P0-1 | Gate `auto-merge-claude.yml` (branch allow-list) and enable branch protection on `main` | Dimitris (Claude drafts the workflow change) | 0.25 d | The workflow only runs for allow-listed branches; `main` requires a pull request; a test push to the migration branch does not reach `main` | Q10, Q12 | H-2 |
| P0-2 | Credential consumer inventory: confirm every consumer of each service credential and keep the checklist current as Workers gain secrets (checklist in the private note). Rotation itself is task P6-1 in Phase 6 | Both | 0.5 d | Private checklist lists every consumer per credential (hosting env, Supabase secrets, `cron.job`, VPS, GitHub secrets, MCP env, database-stored settings); rule recorded that each Worker secret created in Phases 1–5 is appended the day it is created | — | H-7, H-30 |
| P0-3 | Capture the HTTP/SEO baseline from an allow-listed vantage point (owner laptop or allow-listed runner): all parity URLs, HEAD + GET, apex/http variants, headers | Both (Claude supplies the capture script and URL list; Dimitris runs it) | 0.75 d | Snapshot of ≈ 2,610 public URLs plus redirect sources, soft-404 probes, special files, apex/`http://` variants (status, `Location`, headers incl. HSTS, body) stored outside git; the URL list becomes the input of the parity tool (P1-8); re-captured at S11 before the site flip | Q1 | H-1, H-11, H-24, H-28 |
| P0-4 | Re-dump live `cron.job`, `pg_policies`, the Papaki zone file, Vercel domain + project settings | Both | 0.5 d | Dated dumps stored privately (cron commands contain credential values); zone file incl. record TTLs, DS TTL at the `.eu` parent and parent NS TTL; Vercel: Attack Challenge Mode, Deployment Protection, Node version, build command, env-var names, domain redirect status | — | H-24, H-26 |
| P0-5 | Pull live source of all 40 deployed edge functions (reference only) | Claude | 0.4 d | 40 sources saved privately (not committed until Q6 is answered and each file is checked for secrets); diff report repo vs live for the 25 functions in both | — | H-26 |
| P0-6 | Add the Cloudflare preview host to Supabase Auth Site URL / redirect allowlist | Dimitris | 0.1 d | Redirect allowlist contains `https://microns-site.<account>.workers.dev` and the `staging` preview alias host; Site URL stays `https://www.micronshub.eu` | P0-8, Q16 | H-22 |
| P0-7 | Pin package manager + Node version; compare `dist/` file lists Vercel vs local build | Both | 0.4 d | `packageManager`/`engines` and `.nvmrc` committed (per Q15); local build lists the same `dist/` files as the Vercel production deployment; the 210 prerender files are present (vite.config.ts:27, :87-106) | Q15 | H-23 |
| P0-8 | Cloudflare account prerequisites: Workers Paid, R2 enabled, scoped API token for CI, Access team domain | Dimitris | 0.2 d | Workers Paid active; R2 enabled; API token limited to Workers scripts/routes, R2 and KV, stored as GitHub secret `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`; Access team domain chosen | — | — |
| P0-9 | Papaki: confirm account holder and DNSSEC disable lead time | Dimitris | 0.1 d | Written answer: who holds the account, how the DS is removed (panel or ticket), lead time, and confirmation that Papaki accepts a new DS for externally hosted DNS | Q7 | C9 |

Order: P0-1 first (before any code push), P0-8 and P0-9 early (lead times), P0-3 as soon as Q1 is answered, P0-6 after P0-8. Pre-flight total ≈ 3.2 d of effort over about one calendar week. plan.md estimated 0.5 d before P0-2…P0-9 were specified.

Phase 0 exit gate (pass/fail): (1) all ten deliverables in this folder merged; (2) PLAN.md approved; (3) P0-1…P0-9 done as above; (4) baseline snapshot stored outside git and its date recorded in the gate log (§2).

## 5. Phases 1–6 and optional Phase 7

### 5.1 Phase 1: site + SEO Worker (preview only)

Goal: `microns-site` on `*.workers.dev` serves every public URL exactly as Vercel does, proven by the parity diff. Nothing in production changes.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P1-1 | Scaffold `workers/site` from [wrangler.jsonc.draft](wrangler.jsonc.draft): `ASSETS` (`directory` `../../dist`), KV `SEO_CACHE` and `FLAGS`, vars (`SUPABASE_URL`, `SITE_ORIGIN`, `PREVIEW_HOSTNAMES`, `SEO_STRICT_404`), secret `SUPABASE_ANON_KEY`, `nodejs_compat`; add `wrangler`, `@cloudflare/workers-types`, `cf:*` scripts | Claude | 0.25 d | H-20 |
| P1-2 | Delete `public/_redirects` and `public/index.html`; record `/_redirects` as a documented parity deviation (it is a Worker-config file on Cloudflare) | Claude | 0.1 d | H-3, H-21 |
| P1-3 | Router `workers/site/src/index.ts` in this order: redirect table → sitemap routes → `/api/*` → SEO handler for `/{lang}` and `/{lang}/*` → directory-index emulation for `/laserkritis/` and `/zohoverify/` if the baseline shows it → `env.ASSETS.fetch(request)`. In Phase 1, `/api/*` is forwarded to Vercel production (flag `api.forward_to_vercel` on); parity runs exclude write actions. A throw in any step answers 500, except on `/api/sitemap`, which continues to the forward (error policy, HEAD `Content-Length` and sitemap rules: ARCHITECTURE.md §6.2) | Claude | 0.25 d | H-8, H-14 |
| P1-4 | SEO handler `workers/site/src/seo/handler.ts`: copy of the `middleware.ts` orchestrator; shell via `env.ASSETS.fetch`, non-2xx is a logged error (not a silent fall-through, cf. middleware.ts:424-428); anon key and Supabase URL from `env` with a loud failure (today middleware.ts:43, :102-108); per-isolate `Map` caches with the middleware.ts TTLs (1 h; 30 s for "no row") plus KV `SEO_CACHE` for positives only (1 h, 500 ms read limit; negatives and failed lookups never reach KV; ARCHITECTURE.md §17); trailing and double slash normalisation as in middleware.ts:334-346; `seo.strict_404` wired but off | Claude | 0.75 d | H-4, H-8, H-9, H-10, H-13 |
| P1-5 | Redirect table `workers/site/src/redirects.ts` generated from vercel.json:2-128 and src/components/SEORedirects.tsx:14-73; 308; raw + NFC-decoded match; the 3 client-only entries become server 308s (documented parity deviation); unit test per source | Claude | 0.25 d | H-11 |
| P1-6 | Sitemap routes `workers/site/src/sitemap.ts`: port of `api/sitemap.js` for `/sitemap.xml`, `/sitemap-complete.xml`, `/sitemap-index.xml`, `/sitemap-:lang.xml` and `/api/sitemap`; identical headers (api/sitemap.js:392-396); Cache API 1 h; stale blobs served as they are | Claude | 0.25 d | H-12 |
| P1-7 | Preview hardening: `X-Robots-Tag: noindex` on every non-production host (`workers/site/src/preview.ts`); Access application on the preview hosts with a service token for the parity tool, Playwright and Lighthouse | Both | 0.25 d | H-1 |
| P1-8 | Parity tool `scripts/seo-parity.mjs` per [SEO_PARITY.md](SEO_PARITY.md) (two hosts, Access headers, HEAD + GET, headers, JSON + Markdown report, allow-list of documented deviations); extend `scripts/verify-ssr.sh` (second host, Access headers; `HOST` default stays at scripts/verify-ssr.sh:22) | Claude | 0.75 d | H-28 |
| P1-9 | CI `.github/workflows/cf-preview.yml`: manual dispatch only; pinned toolchain (P0-7); `vite build` then `wrangler versions upload --preview-alias staging` | Claude | 0.25 d | H-2, H-23 |
| P1-10 | Run the gate suite: parity, `verify-ssr.sh`, Playwright `seo.spec`, Lighthouse on 5 URLs, `tests/middleware/smoke.mjs`, `wrangler deploy --dry-run --outdir` size report, `dist/` list compare | Both | 0.5 d | H-23, H-27 |
| P1-11 | Auth flows on the preview host: sign-up, login, password-reset e-mail link (P0-6) | Dimitris | 0.1 d | H-22 |

File-level change list:

| Change | Path | Note |
|---|---|---|
| New | `workers/site/wrangler.jsonc`, `workers/site/tsconfig.json` | From the draft; placeholders replaced by IDs, never by secret values |
| New | `workers/site/src/index.ts`, `workers/site/src/flags.ts`, `workers/site/src/api/forward.ts` | Router; KV `FLAGS` reader; Phase 1 forward of `/api/*` to Vercel |
| New | `workers/site/src/seo/handler.ts` | Imports `middleware/{slugs,inject,meta,schema,services,i18n,renderers/*}` unchanged |
| New | `workers/site/src/redirects.ts`, `workers/site/src/sitemap.ts`, `workers/site/src/preview.ts` | — |
| New | `scripts/seo-parity.mjs`, `scripts/seo-parity.allow.json`, `scripts/seo-parity/` (own package and lockfile) | Allow-list holds only documented deviations |
| New | `.github/workflows/cf-preview.yml` | Uses secret names `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Changed | `scripts/verify-ssr.sh` | Two hosts, Access headers; `grep -q` checks read pages through here-strings (SEO_PARITY.md §6) |
| Changed | `package.json` | `cf:*` scripts only. The root lockfile is unchanged: `wrangler`, `@cloudflare/workers-types` and the parity tool's dependencies live in `workers/site/package.json` and `scripts/seo-parity/package.json` with their own lockfiles; `cf:e2e` installs `@playwright/test` with `--no-save` |
| Unchanged | `tsconfig.middleware.json` | Planned change dropped: `workers/site/tsconfig.json` carries the Workers types |
| Changed | `playwright.config.ts`, `tests/e2e/seo.spec.ts`; new `tests/e2e/fixtures/access.ts` | Access headers from env when set, for the `BASE_URL` origin only; default `BASE_URL` unchanged (playwright.config.ts:8) |
| Changed | `tests/middleware/smoke.mjs` | Redirect table and route-decision checks (SEO_PARITY.md §6) |
| Changed | `.gitignore` | `.wrangler/` |
| Deleted | `public/_redirects`, `public/index.html` | H-3; the built `index.html` overwrites the public one today (H-21) |
| Untouched | `vercel.json`, `middleware.ts`, `middleware/*`, `api/*`, `index.html`, `src/*`, `vite.config.ts` | Vercel output must stay identical |
| Untouched | `public/cookie-consent.html`, `public/laserkritis/`, `public/zohoverify/` | Reachable static URLs today; removal only in Phase 6 after a log check |

Exit gate (all must pass; owner signs):

1. Parity diff preview vs Vercel production over the full URL set in [SEO_PARITY.md](SEO_PARITY.md): 0 differences outside the allow-list (bodies, headers, HEAD, `OPTIONS` on `/api/*`).
2. `dist/` file list of the Cloudflare build identical to the Vercel production build, except the two deleted files.
3. `HOST=<preview> scripts/verify-ssr.sh` exits 0.
4. Playwright `tests/e2e/seo.spec.ts` green against the preview.
5. Lighthouse performance on 5 sample URLs ≥ Vercel on each (median of 3 runs).
6. `tests/middleware/smoke.mjs` green.
7. Size report for `microns-site` within the Workers Paid limits; startup under 1 s (CF docs, verified 2026-09-27).
8. Preview hosts send `X-Robots-Tag: noindex` and refuse requests without Access.
9. The Vercel production build of the same commit succeeds.

Rollback: nothing in production uses the Worker. Delete the Worker (`wrangler delete`) and revert the Phase 1 commits; Vercel ignores `workers/`. Time: minutes.

Dependencies: Phase 0 gate; Q1 (baseline and forwarding), Q15, Q16.

Risk refs: H-1, H-2, H-3, H-4, H-8, H-9, H-10, H-11, H-12, H-13, H-20, H-21, H-22, H-23, H-24, H-27, H-28.

Effort total: ≈ 3.7 d (plan: 3–4 d).

### 5.2 Phase 2: API port

Goal: every `/api/*` path works on the preview through `microns-site` and `microns-ops`, with gates, Turnstile, rate limits and R2 for new objects, and with a one-switch rollback to Vercel.

Route split (paths and query shapes unchanged):

| Path | Actions | Target | Execution |
|---|---|---|---|
| `/api/emails` | `contact`, `email`, `rfq`, `rfq-pdf` (api/emails.js:370-376) | `microns-site` local | Request |
| `/api/s3` | `presign-upload`, `presign-download`, `delete`, `delete-folder`, `list` (api/s3.js:155-227) | `microns-site` local (files API re-implemented with `aws4fetch`; statuses and bodies of api/s3.js). `rfq` scope: new objects in R2 `microns-private` under `rfq/` + today's key (DV-5), reads fall back to legacy S3 (`LEGACY_S3_REGION` = `eu-north-1`, bucket vars `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`). `articles` scope: stays on legacy S3 until `files.micronshub.eu` serves `microns-public` (P3-6, D-17) | Request |
| `/api/marketing?action=track` and `/api/track` | Open pixel, click, unsubscribe (api/marketing.js:2-3; vercel.json:151-153) | `microns-site` local, byte-identical responses | Request |
| `/api/marketing` | `webhook`, `google-auth`, `apollo-enrich` (api/marketing.js:58-66) | `microns-ops` via `OPS` | Request |
| `/api/notifications` | `partner` (default), `production-status` (api/notifications.js:265-272) | `microns-ops` via `OPS`: api/notifications.js imports nesting and inventory at module scope (api/notifications.js:9-11), so every action runs in ops (DV-1) | Request |
| `/api/notifications` | 19 `inv-*` actions (lib/inventory/index.js:480-530) | `microns-ops` via `OPS`, keeping `lib/inventory` and `qrcode` out of the site bundle | Request |
| `/api/notifications?action=nest` | `nest` (api/notifications.js:266-267) | `microns-ops` with `limits.cpu_ms` 300,000 (DV-4): the 50 s budget (lib/nesting/nester.js:286) never trips when deployed, because `Date.now()` advances only on I/O, and local CPU passes 30 s near 700 part instances (probe 2026-10-02); an `OPS` rejection answers 504 JSON `TIMEOUT` | Request, CPU-bound |
| `/api/gsc` | All actions | `microns-ops`, synchronous in Phase 2; bulk inspection and indexing batches move to Queue `scrapes` in Phase 5 (DV-3) | Request |
| `/api/tenders`, `/api/connector-status` | CRUD, CSV, stats, connector status (vercel.json:155-157) | `microns-ops` | Request |
| `/api/tender-scan` | POST scan | `microns-ops`: a machine caller's POST is validated, enqueued on `scrapes` and answered 200 at once with every key `tender-collector` reads (supabase/functions/tender-collector/index.ts:75-80) at zero plus `queued` and `run_id`; staff and dashboard callers run synchronously (DV-3) | Queue (machine) / Request |
| `/api/funded-startups` | CRUD, POST scan | `microns-ops`; scan synchronous in Phase 2 (DV-3) | Request |
| `/api/scrape-website`, `/api/scrape-company-profile`, `/api/scan-directory` | Fetch and parse | `microns-ops`; at most 6 concurrent outbound connections (CF docs, verified 2026-09-27) | Request |
| `/api/sitemap`, `/sitemap*.xml` | Sitemaps | `microns-site` (Phase 1) | Request + Cache API |
| Any `/api/*` | — | Flag `api.forward_to_vercel` on (all paths, a path list, or preview / production hosts only), and any path outside the `/api` catalogue: proxied unchanged and ungated (method, path, query, body, headers) to var `API_FORWARD_ORIGIN` = `https://on-demand-craft-greece.vercel.app`, the Vercel production deployment host (live 2026-09-30; server-side origin only, never linked; P0-4 confirms it is not behind Deployment Protection). Not `www`: once `www` routes to the Worker the forward refuses its own host | Rollback |

`@vercel/node`-compatible shim (core `workers/shared/src/compat/vercel-node.ts`, used by both Workers; `workers/ops/src/compat/express-shim.ts` is its Hono adapter; DV-2):

| Vercel behaviour today | Shim behaviour |
|---|---|
| `req.query`, incl. params added by rewrites (`?action=`, `?type=`, `?lang=`, `?connectors=true`; vercel.json:129-157) | Built from the URL; the router merges the rewrite params before calling the handler (request keys win) |
| `req.body` parsed by `@vercel/node` 17.0.0 (JSON, text, form, octet-stream; invalid JSON throws on every read) | Same semantics by `Content-Type`; the raw body is kept for signature checks (H-15) |
| `req.headers`, `req.method` | Lower-cased header object and method from the `Request` |
| `res.status().json()/send()/end(Buffer)/redirect()/setHeader()` | Builds one `Response` with the `@vercel/node` defaults (type, charset, weak ETag); `Buffer` via `nodejs_compat` (H-20) |
| Module-scope `process.env` reads (api/s3.js:33-65 and others) | `nodejs_compat` with `process.env` populated from vars and secrets (compatibility date ≥ 2025-04-01; api-lib audit); handler modules imported lazily per route, so a module-scope failure answers 500 on that route only; proven by shim tests in P2-2 |
| Function payload limit 4.5 MB | 413 `{"error":"payload_too_large"}` above 4,718,592 bytes, before any handler; exact Vercel cut-off re-checked at P2-12 |
| Function duration (`maxDuration` to confirm in P0-3) | 30 s in the site, 300 s in ops; then 504 `text/plain` |
| Platform CORS on `/api/(.*)` (vercel.json:163-172) and per-function `OPTIONS` | Phase 1 `finalise()` sets the same headers on every `/api/*` answer; handlers answer their own `OPTIONS` (parity, H-28); allow-list mode built, switched on after the Phase 3 observation window (D-9; H-21) |
| `VERCEL_URL` for the Google OAuth redirect (api/marketing.js:46-47) | Explicit `GOOGLE_REDIRECT_URI` |

Gate classes (the per-route matrix is in the private note; gates run in the `microns-site` router for both Workers, report or enforce per class through var `API_GATES_MODE`):

| Caller | Gate added in Phase 2 |
|---|---|
| Public browser forms (`src/components/contact/ContactForm.tsx`, `src/components/quote-form/MultiStepQuoteForm.tsx`; DV-6) | Turnstile on `/api/emails`, token in request header `X-Turnstile-Token` (no site key → no widget; a form always submits and the server decides) + Workers Rate Limiting bindings `API_RATE_LIMIT` (30/60 s), `API_RATE_LIMIT_MAIL` (5/60 s), `API_RATE_LIMIT_BULK` (300/60 s); one zone rate-limiting rule on `/api/*` from Phase 3 (Free plan allows 1 rule; CF docs, verified 2026-09-27) |
| Signed-in customers, partners, staff | Supabase JWT verified in the Worker (`/auth/v1/user` after a local pre-check), roles read from `user_roles`, checked per route; the frontend sends the session token in `Authorization` |
| Machine callers (`tender-collector`, the local MCP server) | One Cloudflare Access service token per consumer (`microns-machine-collector`, `microns-machine-mcp`; `CF-Access-Client-Id` / `CF-Access-Client-Secret`), accepted only on preview hosts and on hosts in `API_MACHINE_HOSTS` (`api.micronshub.eu` from Phase 3, D-3; DV-7, DV-19). The CI token passes the preview's Access application but is not an API credential (DV-16) |
| Third-party webhooks (Resend) | Svix signature verification in `microns-ops` on the raw bytes (H-15) |
| Links inside sent e-mails (pixel, click, unsubscribe) | No login by design, because the URLs are already in sent e-mails (H-14); rate limit only; one edge case switchable (D-16) |

Details: private security note (delivered to the owner out of band, not in this public repo).

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P2-1 | Scaffold `workers/ops` (Hono inside the named entrypoint `OpsApi`) from the draft; service binding `OPS` on `microns-site` with `"entrypoint": "OpsApi"` (DV-8); source-only package `workers/shared` for code both Workers import | Claude | 0.25 d | — |
| P2-2 | `@vercel/node`-compatible shim (`workers/shared/src/compat/vercel-node.ts`) + Hono adapter (`workers/ops/src/compat/express-shim.ts`) + unit tests (every row of the table above; DV-2) | Claude | 0.75 d | H-20 |
| P2-3 | Site `/api/*` router: local vs `OPS` vs forward; CORS through Phase 1 `finalise()` (allow-list mode built, not wired); `api.forward_to_vercel` read from KV `FLAGS` with var `API_FORWARD_TO_VERCEL` as fallback (the `feature_flags` table arrives in Phase 4) | Claude | 0.5 d | H-28 |
| P2-4 | Site-local handlers: `emails` (Resend), `files` (R2 + legacy S3, same response shapes as api/s3.js), `track` (DV-1: no site-local `notifications`) | Claude | 1 d | H-14, H-17 |
| P2-5 | Ops routes through the shim: `gsc` (RSA-SHA256 signing via `node:crypto`), `tenders`, `connector-status`, scrape and scan routes, `funded-startups`, marketing `webhook`/`google-auth`/`apollo-enrich`, every `/api/notifications` action (`partner`, `production-status`, `inv-*`, `nest`) | Claude | 0.75 d | H-18, H-20 |
| P2-6 | Queue `scrapes` for tender scans a machine caller starts; the funded-startups scan and GSC bulk actions stay synchronous, their queue kinds follow in Phase 5 (DV-3); `nest` with `limits.cpu_ms` 300,000 (DV-4) | Claude | 0.5 d | H-18 |
| P2-7 | Gates: `workers/site/src/auth/{supabase-jwt,turnstile,rate-limit,access}.ts` plus `gate.ts` and `policy.ts`, over the primitives in `workers/shared/src/auth/`, applied per the private matrix; report or enforce per class (`API_GATES_MODE`) | Claude | 0.75 d | H-6 |
| P2-8 | Resend webhook verification to Resend's Svix scheme; explicit `GOOGLE_REDIRECT_URI`; Dimitris confirms the Resend webhook URL and the Google OAuth redirect list | Both | 0.35 d | H-15 |
| P2-9 | Accounts and secrets: create R2 buckets `microns-public` and `microns-private` (`-J eu`, D-1; bucket CORS from `workers/site/r2/cors.private.json`), R2 API token, legacy S3 key for the Worker, queue `scrapes`, Turnstile widget (Cloudflare test keys in Phase 2, real keys at S11), Access service tokens `microns-machine-collector` and `microns-machine-mcp`; set Worker secrets by the names in [wrangler.jsonc.draft](wrangler.jsonc.draft); deploy `microns-ops` before the site; append each consumer and the rate-limit namespaces to the P0-2 checklist the same day | Dimitris | 0.5 d | H-7 |
| P2-10 | Frontend: Turnstile widget in `src/components/contact/ContactForm.tsx` and `src/components/quote-form/MultiStepQuoteForm.tsx` (DV-6); `Authorization` with the session token on signed-in API calls (`src/utils/apiAuth.ts`); `src/components/rfq/RfqFileDownload.tsx` reads through the files API and keeps its current `rfq-files` path as fallback (C12; RfqFileDownload.tsx:47, :100). Every frontend change must work against both the Vercel API and the Worker API, because `main` deploys to Vercel production: changes add only request headers or optional body fields | Claude | 0.5 d | H-17 |
| P2-11 | Repoint callers: `mcp-server/src/index.ts` uses one `SITE_URL` instead of the apex defaults at :1288, :1327, :1550, sends its Access service-token headers only to a host behind Access, never follows redirects, and `export_tenders_csv` returns the CSV (DV-12); `tender-collector` sends its machine token (edge-function change built from the live source of P0-5; `SITE_URL` stays `https://www.micronshub.eu`, supabase/functions/tender-collector/index.ts:5, until `api.micronshub.eu` exists) | Both | 0.35 d | H-14, H-26 |
| P2-12 | Tests and gate run: T1 (vitest per package) and T2 (both Workers under local workerd with an upstream stub); `tests/e2e/api.spec.ts` (every endpoint and action in [INVENTORY.md](INVENTORY.md); modes `local`, `preview`, `compare`), R2 round trip, webhook test vector, `OPTIONS` parity, forward-flag test, size report and bundle guard for both Workers | Both | 0.75 d | H-27, H-28 |

File-level change list:

| Change | Path | Note |
|---|---|---|
| New | `workers/shared/**` (own `package.json` and lockfile, no build step) | `src/compat/{vercel-node,vercel-rewrite,etag,ambient.d}.ts`, `src/http/{rpc,json,log,env-check,cors}.ts`, `src/auth/{supabase-jwt,access-jwt,turnstile,svix,rate-limit}.ts`, `src/storage/{s3-presign,s3-xml}.ts`; imported by both Workers by relative path |
| New | `workers/ops/wrangler.jsonc`, `workers/ops/src/{index,app,env}.ts`, own `package.json` and lockfile (`hono`) | `OpsApi` entrypoint, Hono app, queue consumer |
| New | `workers/ops/src/compat/express-shim.ts`, `workers/ops/test/**` | Hono adapter over the shared shim |
| New | `workers/ops/src/routes/{gsc,tenders,tender-scan,scrape,scan-directory,funded-startups,marketing,notifications,marketing-webhook,google-auth}.ts` | Wrap `api/*.js`, `api/_lib/*`, `lib/*` through the shim (DV-11: `notifications.ts`, no `inventory.ts`) |
| New | `workers/ops/src/queues/{messages,scrapes}.ts`, `workers/ops/scripts/nest-fixture.mjs` | Producer and consumer for machine tender scans (kinds `tender-scan`, `funded-scan`); `nest` request bodies of 80 to 1,200 part instances |
| New | `workers/site/src/api/{resolve,router,emails,files,track,ops-client}.ts` | Catalogue and action resolver, router, site-local subset, `OPS` RPC client (DV-11: no site `notifications.ts`) |
| New | `workers/site/src/auth/{gate,policy,constraints,db,tracking,supabase-jwt,turnstile,rate-limit,access}.ts` | Gates |
| New | `workers/site/scripts/check-bundle.mjs`, `workers/site/vitest.t2.config.ts`, `workers/site/test/integration/**`, `workers/site/r2/cors.private.json`, `.dev.vars.example` in both Workers | Bundle guard, T2 harness, R2 bucket CORS for the owner |
| New | `tests/e2e/api.spec.ts`, `tests/e2e/api/**`, `tests/frontend-api/**` | e2e in modes `local`, `preview`, `compare` (refuses production hosts); per-call Access headers to the base origin only; tests of the new frontend helpers |
| New | `scripts/r2-to-legacy-s3.mjs`, `.github/workflows/cf-ops.yml` | Owner-run rollback copy (dry run by default); manual-dispatch CI and deploy for `microns-ops` |
| Changed | `workers/site/wrangler.jsonc` | `OPS` (entrypoint `OpsApi`), `PRIVATE_FILES` (jurisdiction `eu`), `API_RATE_LIMIT`, `API_RATE_LIMIT_MAIL`, `API_RATE_LIMIT_BULK`, vars `R2_ACCOUNT_ID`, `LEGACY_S3_REGION`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, `API_FORWARD_TO_VERCEL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `API_GATES_MODE`, `API_MACHINE_HOSTS`, `API_FORWARD_ORIGIN` value; Phase 2 secrets |
| Changed | `workers/site/src/{env,flags}.ts`, `workers/site/src/api/forward.ts`, `workers/site/src/compat/api-modules.d.ts`, `workers/site/package.json` (scripts) | Phase 2 `Env` fields (all optional), `getFlagValue`, flag check + dispatch; Phase 1 router, SEO, sitemap and preview files and tests unchanged |
| Changed | `package.json` (root) | Scripts only (`cf:install`, `cf:test:all`, `cf:typecheck:all`, `cf:t2`, `cf:dev:all`, `cf:dry:ops`, `cf:e2e:api`); the root lockfile is unchanged (DV-15) |
| Changed | `.github/workflows/cf-preview.yml` | `workers/shared` install, `VITE_TURNSTILE_SITE_KEY`, prerender guard, bundle guard |
| Changed | `src/components/contact/ContactForm.tsx`, `src/components/quote-form/MultiStepQuoteForm.tsx`, `src/utils/emailService.ts`; new `src/components/security/TurnstileWidget.tsx`, `src/utils/turnstile.ts` | Turnstile widget, loaded only after the visitor interacts with a form and never during the prerender (DV-6) |
| Changed | New `src/utils/apiAuth.ts`; `src/utils/{s3Api,awsS3Storage,inventoryApi,partnerNotificationUtils,rfqPdfEmailService}.ts` and the staff pages that call `/api/*` | `Authorization` header, optional `size` in the presign body, documents opened inside the click |
| Changed | `src/components/rfq/RfqFileDownload.tsx` | Files API with fallback |
| Unchanged | `src/utils/rfqFileStorage.ts`, `src/utils/articleImageStorage.ts` | No response shape changed |
| Changed | `mcp-server/src/index.ts`, `mcp-server/README.md` | `SITE_URL`, Access headers, CSV export |
| Changed | `supabase/functions/tender-collector/index.ts` | Built from the live source; Access headers and `queued`/`run_id` logging; deployed by Dimitris |
| Changed | `.env.example`, `docs/AWS_S3_VERCEL_GUIDE.md` | `VITE_AWS_*` names removed (already out of the bundle, vite.config.ts:67-72); Turnstile test site key in `.env.example` |
| Deleted | — | Nothing |
| Untouched | `vercel.json`, `middleware.ts`, `middleware/*`, `api/*` (incl. `api/marketing.js`), `index.html`, `vite.config.ts`, root lockfile | The Vercel copy stays the rollback target; the Resend webhook URL reaches the Worker handler from Phase 3 |
| Untouched | `lib/*` | Imported by `microns-ops` as is |

Exit gate:

1. `tests/e2e/api.spec.ts` green on the preview for every endpoint and action.
2. R2 round trip: presign-upload → PUT → presign-download → GET returns identical bytes (SHA-256); an existing legacy S3 object downloads through the same API.
3. A Svix-signed Resend test event is accepted; unsigned and wrongly signed events are rejected.
4. Tracking pixel, click and unsubscribe URLs (with test IDs, seeded separately per platform and per case) return the same status, headers and body as Vercel: on `www` in Phase 2 and through the apex redirect in Phase 3 (S13) (DV-13).
5. `OPTIONS` on every `/api/*` path matches Vercel.
6. Every write path answers requests without the required credential as the private gate matrix specifies; rate limits and Turnstile verified with test keys (on preview hosts only, where the Worker accepts the Cloudflare test secret; a test secret on any other host fails closed).
7. `api.forward_to_vercel` on: every routed `/api/*` request is served by Vercel through the Worker (proves H-1 does not block Worker egress); off: served locally. `/api/sitemap` stays local in both states, because router step 2 answers it before the `/api` router (DV-17).
8. The MCP server and a `tender-collector`-shaped request succeed against the preview with their credentials.
9. Size reports for `microns-site` and `microns-ops` within limits; `microns-site` bundle contains no `@aws-sdk`, `pdf-lib` or nesting code (H-27).
10. No `VITE_AWS_*` name remains in `.env.example`, docs or Worker config.

Rollback: before Phase 3 no production traffic reaches the Worker API; revert commits. Frontend changes reach Vercel production through `main` and are built to work against both APIs. After Phase 3, set `api.forward_to_vercel` on in KV `FLAGS` (≈ 1 min for KV propagation, CF docs, re-check at execution; var `API_FORWARD_TO_VERCEL` = `"true"` does the same while the KV key is absent); the forward goes to `API_FORWARD_ORIGIN` (the Vercel deployment host); full site rollback is the Phase 3 record flip. Objects written to R2 while the Worker served uploads must then be copied to the legacy S3 bucket under the same key, without the `rfq/` prefix: `scripts/r2-to-legacy-s3.mjs --since <ISO>` (dry run by default, `--execute` copies, owner's own credentials) (volume is small: 2 RFQs to date, live 2026-09-30).

Dependencies: Phase 1 gate; P0-2; P0-8; Q1, Q11, Q19; owner defaults D-1…D-17 below.

Risk refs: H-1, H-6, H-7, H-14, H-15, H-17, H-18, H-20, H-21, H-26, H-27, H-28.

Effort total: ≈ 7 d (plan: 5–7 d).

Build record (2026-10-04): the Phase 2 code is built and tested locally; nothing is deployed. This section was brought in line with the build on that date under the owner's delegation of doc approval (§2, "Plan changes"). Exit-gate status with local evidence: [workers/site/README.md](../../workers/site/README.md), "Phase 2 exit gate". Gates 9 and 10 pass locally; gates 1–8 have local evidence and need the preview run after the owner steps of P2-9.

Deviations from this section as first written (DV-1…DV-19; security changes at summary level, details in the private note):

| # | Planned | Built | Why |
|---|---|---|---|
| DV-1 | `partner`, `production-status` site-local (P2-4; ARCHITECTURE.md §6.4) | Every `/api/notifications` action in `microns-ops` | api/notifications.js imports nesting and inventory at module scope (api/notifications.js:9-11); the site would carry `pdf-lib`, `qrcode` and nesting (gate item 9) |
| DV-2 | Express-compatible shim at `workers/ops/src/compat/express-shim.ts`, also used by the site | Core `workers/shared/src/compat/vercel-node.ts` with `@vercel/node` 17.0.0 semantics; the PLAN path is its Hono adapter | Production runs `@vercel/node`, not Express; a file inside `workers/ops` cannot be a site dependency without coupling the two installs |
| DV-3 | P2-6: funded-startups scan and GSC bulk actions on Queue `scrapes`; every `tender-scan` answered at once | Queue only for tender scans a machine caller starts; everything else synchronous; GSC kinds in Phase 5 | Interactive callers print the counts; `tender-collector` aborts at 25 s (supabase/functions/tender-collector/index.ts:8, :75-80); GSC jobs need a path without a user token (api/gsc.js:190) |
| DV-4 | `limits.cpu_ms` 60,000 (wrangler.jsonc.draft; ARCHITECTURE.md §6.4, §7.2) | 300,000 | Local CPU passes 30 s near 700 part instances; the nester's 50 s budget never trips when deployed |
| DV-5 | R2 keys `rfq/<rfq_id>/<file_id>-<name>` for the `/api/s3` replacement | `rfq/` + today's key | The browser stores and passes back today's key (`<rfqNumber>/<partFolder>/<safeName>`); the planned layout stays for Phase 4 e-mail RFQs |
| DV-6 | P2-10: Turnstile in `src/pages/Contact.tsx`, `src/pages/QuoteRequestForm.tsx`, `src/components/quote-popup/QuotePopup.tsx` | `src/components/contact/ContactForm.tsx`, `src/components/quote-form/MultiStepQuoteForm.tsx`; `src/utils/s3Api.ts` and a shared auth-header helper added to the file list | The three planned files submit no routed form |
| DV-7 | ARCHITECTURE.md §14: Access application on `www.micronshub.eu/api/tender-scan` ("no browser caller") | Dropped; machine host `api.micronshub.eu` from Phase 3 | The dashboard calls that path too (src/pages/dashboard/TenderMonitorPage.tsx:240) |
| DV-8 | `OPS` binding without `entrypoint` (wrangler.jsonc.draft) | `"entrypoint": "OpsApi"` (RPC) | The verified caller travels in the RPC call, never in a header |
| DV-9 | Ops `secrets.required` with the Phase 5 names (wrangler.jsonc.draft) | Phase 2 names only | A listed secret that does not exist blocks every deploy |
| DV-10 | Forward target and legacy bucket names as constants in code (wrangler.jsonc.draft) | Vars `API_FORWARD_ORIGIN`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET` | Values come from P0-4; tests override them; not secret |
| DV-11 | Route file `routes/inventory.ts`; site `api/notifications.ts` | `routes/notifications.ts`, `routes/scrape.ts`; no site notifications module | DV-1 |
| DV-12 | P2-11: MCP `export_tenders_csv` returns a link | Fetches `/api/tenders?export=csv` and returns the CSV (cut at 200 KB with a note) | The old `/api/tenders-export` path no longer exists (api/tenders.js:50) |
| DV-13 | Exit gate 4 wording | Run on `www` in Phase 2 and through the apex redirect in Phase 3 (S13) | Sent e-mails carry apex links (ARCHITECTURE.md §5) |
| DV-14 | Gate-related behaviour | Documented changes: one tracking-link edge case (switchable, D-16), the Gmail-connect flow, recipient checks, upload constraints for callers other than staff, JSON-only bodies with string fields on some write paths, a Resend webhook retry of an event already recorded is acknowledged with 200 without re-processing, `delete-folder` matches whole folders only (prefix normalised to end in `/`) | Gates for H-6; every other existing behaviour is ported unchanged (D-7) |
| DV-15 | `hono`, `aws4fetch` in the root `package.json` and lockfile (file list) | Per-package dependencies (`workers/ops`, `workers/shared`); the root `package.json` gets scripts only | The root lockfile and the Vercel install stay unchanged |
| DV-16 | "CI tools" among the machine callers with an Access service token | The CI token passes the preview's Access application but is not an API credential; e2e writes use a test staff user's session | One credential per consumer, each revocable alone |
| DV-17 | Exit gate 7: "every `/api/*` request" served by Vercel with the flag on | `/api/sitemap` stays local; gate 7 checks the routed endpoints | Router step 2 answers it before the `/api` router (workers/site/src/index.ts:82-90) |
| DV-18 | "New uploads go to R2"; legacy S3 read-only | Article uploads stay on legacy S3 until P3-6, as the route table above says | `files.micronshub.eu` is connected in P3-6; the owner confirms or picks the alternative (D-17) |
| DV-19 | Access service token for machine callers, implicitly on `www` | Machine callers accepted only on preview hosts and on hosts in `API_MACHINE_HOSTS` (empty in Phase 2; `api.micronshub.eu` from Phase 3) | An Access application on `www` paths would also stop the dashboard callers; hosts of the zone are never preview hosts (workers/site/src/preview.ts:52-56) |
| Doc | workers/site/README.md "10 MB after compression … Free limit is 3 MB"; ARCHITECTURE.md §20 | 64 MiB uncompressed on both plans, no compressed limit; startup (1 s) is the binding limit | CF docs (fetched 2026-10-02); both files corrected |

Defaults chosen for the owner (D-1…D-17; each is built as stated and can be changed before the step named):

| # | Decision | Default built | Changed through | Decide before |
|---|---|---|---|---|
| D-1 | R2 jurisdiction of `microns-private` (only at bucket creation) | `eu` in every binding and in `R2_JURISDICTION` (a config test keeps them equal) | Bucket created without `-J eu`, both set to `''` | P2-9 bucket creation |
| D-2 | R2 key layout for `/api/s3` uploads | `rfq/` + today's key; `publicUrl`/`url` keep the legacy string format; `rfq/<rfq_id>/<file_id>-<name>` for Phase 4 e-mail RFQs (Q11) | Code (`workers/site/src/api/files.ts`) | P2-9 |
| D-3 | Machine credential | Cloudflare Access service tokens, one per consumer (`microns-machine-collector`, `microns-machine-mcp`): preview hosts now, `api.micronshub.eu` (Access application `microns-machine-api`) from Phase 3. Alternative: a Worker-checked shared secret on `www` | `API_MACHINE_HOSTS`; Access dashboard | Phase 3 runbook, before the `www` flip |
| D-4 | Queue scope | Only tender scans a machine caller starts; funded scan and GSC bulk synchronous | Code | Phase 5 |
| D-5 | `/api/notifications` placement | Every action in `microns-ops` | — | — |
| D-6 | `nest` CPU | `cpu_ms` 300,000 without an instance cap; Container only if a real order exceeds it | Measured CPU per fixture on the preview | P2-12 |
| D-7 | Existing defects | Ported unchanged, except the webhook retry acknowledgement and the `delete-folder` prefix | — | — |
| D-8 | Gate-specific settings (one check in report mode, upload limits, tenant-admin access, timing before the flip) | Defaults in the private security note | `API_GATES_MODE`; code | Phase 3 S11 |
| D-9 | Allow-list CORS | Built and tested, not wired; switched on after the Phase 3 observation window (not Phase 6) | Code and a var added with the switch | After the Phase 3 observation window |
| D-10 | New names | Used as proposed: host `api.micronshub.eu`; Access application `microns-machine-api`; tokens `microns-machine-collector`, `microns-machine-mcp`; vars `API_FORWARD_TO_VERCEL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `API_GATES_MODE`, `API_MACHINE_HOSTS`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`; bindings `API_RATE_LIMIT_MAIL` (namespace `2002`), `API_RATE_LIMIT_BULK` (`2003`); secret `ACCESS_MACHINE_CLIENT_IDS`; Supabase and MCP secrets `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`; build variable `VITE_TURNSTILE_SITE_KEY`; entrypoint `OpsApi`; `workers/shared/**`, `.github/workflows/cf-ops.yml`, `scripts/r2-to-legacy-s3.mjs` | Rename before the first deploy | P2-9 |
| D-11 | Unknown `/api/*` paths | Forwarded to Vercel until P0-3 shows Vercel's answer (expected: the SPA shell with 200), then served locally | Code | After P0-3 |
| D-12 | CORS header precedence when a handler sets the same header | Phase 1 behaviour: `finalise()` sets the vercel.json values | Code | After P0-3 |
| D-13 | FR tender connector reads a remote JSON file of unknown size | Measured on the preview; streamed or capped only if large | Code | P2-12 |
| D-14 | `marketing_settings.tracking_domain` → `https://www.micronshub.eu` | Not done by the build | Data change by the owner | Before the next campaign |
| D-15 | Re-checks: RPC callee `cpu_ms`, error on CPU exhaustion, version overrides on RPC, `@vercel/node` production bytes for invalid JSON and default `Cache-Control`, Vercel `maxDuration` | Measured on the preview and in the P0-3 capture | — | P2-12; P0-3 |
| D-16 | One tracking-link edge case from the `www` flip | Switchable (`API_GATES_MODE` token `redirect=report` or `redirect=enforce`): preview `enforce`; production `redirect=report` at S11 (today's behaviour, logged), because only today's behaviour guarantees that links in sent e-mails keep working byte-identically | `API_GATES_MODE` | Phase 3 S11 |
| D-17 | Article image uploads | Legacy S3 from the flip until P3-6 (route table above). Alternative: connect `files.micronshub.eu` to `microns-public` before S11 and switch article uploads at the flip | Code (files API) | Phase 3 S11 |

### 5.3 Phase 3: zone + cutover

Goal: `micronshub.eu` DNS runs on Cloudflare with identical records, then production traffic for `www`, the apex and tenant subdomains is served by `microns-site`, with a record-flip rollback at every step. The step-by-step runbook is §6.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P3-1 | Zone preparation (runbook S1–S5): Cloudflare zone (Free plan), TTL lowering, zone export, DNS-only import, `scripts/dns-parity.mjs` | Both | 0.75 d | C9 |
| P3-2 | DNSSEC and NS move (S6–S10) | Dimitris (Claude verifies) | 0.5 d | C9 |
| P3-3 | Pre-flip readiness (S11): zone settings per [SEO_PARITY.md](SEO_PARITY.md), Workers Routes, edge certificates, baseline refresh, GSC snapshot | Both | 0.5 d | H-1, H-24 |
| P3-4 | Site flip (S12–S15): `www` Route, apex Single Redirect Rule, wildcard Route, bot/cache verification | Both | 0.25 d | H-11, H-13, H-24 |
| P3-5 | 48 h observation and gate (S16–S17) | Both | 0.5 d | H-9, H-14 |
| P3-6 | Post-cutover: connect `files.micronshub.eu` to `microns-public` and switch article-image uploads to it (legacy S3 URLs unchanged); `TenantEditPage` DNS copy; README deployment section; re-submit the sitemap index in GSC once; deliverability report for `send.micronshub.eu`, SPF and DMARC with no change to the apex MX | Both | 0.5 d | H-16, H-17 |
| P3-7 | Follow-up, not part of the gate: after 2 weeks of flat GSC coverage and a yes to Q5, enable `seo.strict_404`; watch 404 counts for 7 days | Both | 0.25 d | H-9 |

File-level change list:

| Change | Path | Note |
|---|---|---|
| New | `scripts/dns-parity.mjs` | Name × type diff between two answer sources (authoritative server, DoH resolver or Cloudflare API export) |
| Changed | `workers/site/wrangler.jsonc` | Routes `www.micronshub.eu/*` and `*.micronshub.eu/*` |
| Changed | `src/pages/dashboard/tenants/TenantEditPage.tsx` | Replace the Vercel DNS instructions (TenantEditPage.tsx:642, :667-678) |
| Changed | `README.md` | Deployment section |
| Dashboard only | Cloudflare zone, DNS records, DNSSEC, Single Redirect Rule, rate-limiting rule, zone settings, R2 custom domain | Recorded in the runbook log |
| Untouched | `vercel.json`, `middleware.ts`, `api/*` | Vercel stays deployable (brief §2 item 9) |
| Untouched | `playwright.config.ts` default `BASE_URL` | Still `https://www.micronshub.eu` (playwright.config.ts:8) |

Exit gate:

1. 48 h after the flip: GSC coverage and crawl stats flat (indexed pages within −2 %, no 404 spike above 2×, 5xx below 0.1 %; thresholds from [SEO_PARITY.md](SEO_PARITY.md)).
2. `scripts/verify-ssr.sh` green against production.
3. Zero 5xx on SEO paths in Workers Logs over the 48 h.
4. Parity diff production (Cloudflare) vs the S11 baseline: 0 unexplained differences.
5. Mail: external → Workspace inbox received; Resend-sent mail passes DKIM; MX, SPF, DKIM, DMARC records unchanged.
6. Resend domain and the GSC domain property still verified.
7. DNSSEC chain validates.

Rollback: record flips per §6 (≈ 10 min each, TTL 300 s); NS rollback only per §6.3. Vercel keeps deploying `main` until Phase 6.

Dependencies: Phase 2 gate (the zone part S1–S10 may run in parallel with Phase 2 if the owner agrees; it changes no serving path); P0-9; Q7.

Risk refs: H-1, H-9, H-11, H-13, H-14, H-16, H-17, H-24, H-25.

Effort total: ≈ 3.25 d of work + DS wait + 48 h observation (plan: 2–3 d + 48 h).

### 5.4 Phase 4: agent layer

Goal: the seven agent designs of [AGENTS.md](AGENTS.md) run on Cloudflare behind flags and human approval, with one real RFQ processed end to end. Agents authorise staff actions through Access and staff checks, not tenant roles, until the Phase 6 RLS remediation closes H-5.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P4-1 | Migration `supabase/migrations/2026MMDD_agent_layer.sql`: tables `inbound_emails`, `quote_workflows`, `cad_jobs`, `stock_reservations`, `agent_runs`, `feature_flags`, `pricing_rules`; columns `rfqs.source`, `rfqs.inbound_email_id`, `rfq_files.source`, `rfq_files.r2_key`, `rfq_files.sha256`, `rfq_files.content_type`; RLS on, staff read, service-role writes; regenerate `src/integrations/supabase/types.ts` as UTF-8 | Claude (Dimitris applies) | 1 d | H-21 |
| P4-2 | Flags: `feature_flags` rows for every canonical flag, seeded from the current KV values so `api.forward_to_vercel` and `seo.strict_404` keep their state; Cron Trigger every minute mirrors the table to KV `FLAGS` | Claude | 0.5 d | — |
| P4-3 | AI Gateway `microns`: routes `extract`, `classify`, `translate`, `embed`; provider keys (BYOK); budget and rate limits per Q20; every call carries `cf-aig-metadata` | Both | 0.5 d | — |
| P4-4 | Email Routing on `rfq.micronshub.eu` (addresses `rfq@`, `replies@`; catch-all exists only on the apex, CF docs verified 2026-09-27) and `microns-mail`: raw MIME to `microns-private` `email/<message_id_sha256>/…`, `inbound_emails` row, start `rfq-intake` via `OPS` | Both | 1.25 d | — |
| P4-5 | `rfq-intake` Workflow (`RfqIntakeWorkflow`) + `RfqThread` DO: parse, classify CNC vs sheet metal, dedupe `customers` (rows also come from trigger `on_auth_user_created_customer`, supabase/migrations/20260806_phase2_rls_per_user.sql:415), create RFQ rows, enqueue `cad-jobs`, Telegram confirmation below 0.7 confidence; flag `agent.rfq_intake` | Claude | 2 d | H-28 |
| P4-6 | `CadRouter` DO and `cad-jobs` consumer with the existing unfold service as backend until Phase 5 (same interface later served by the Container); outputs to `cad/<job_id>/…` | Claude | 0.75 d | H-18 |
| P4-7 | `quote` Workflow (`QuoteWorkflow`): pricing draft from `pricing_rules` and material prices, RAG over Vectorize `quotes-v1`, `waitForEvent` type `quote-approved` (7 d, then a reminder step), PDF to `quotes/<rfq_id>/v<version>/quote.pdf`, Resend send with `Reply-To: replies@rfq.micronshub.eu`, follow-ups; flag `agent.quote` | Claude | 2.5 d | — |
| P4-8 | Reply detection: `replies@` threading by `In-Reply-To`/`References`; Gmail poller every 10 min for the 2 Workspace sender accounts (live 2026-09-30) | Claude | 1 d | — |
| P4-9 | `post-order` Workflow (`PostOrderWorkflow`) + `MaterialStock` DO: traveler to `orders/<order_id>/traveler.pdf`, stock reservation rows, supplier reorder draft with approval; flag `agent.post_order` | Claude | 1.25 d | — |
| P4-10 | Browser Rendering scrapers (Europages, wlw) behind `agent.growth.scrapers`; at most 6 concurrent connections | Claude | 0.75 d | — |
| P4-11 | Remote MCP: `MicronsMcp` (`McpAgent`) on Custom Domain `mcp.micronshub.eu` → `microns-ops`, Access + OAuth, tools mirror the local server plus RFQ/quote/order/inventory; audit in `agent_runs`; flag `mcp.remote` | Both | 1.25 d | — |
| P4-12 | Dashboard `RfqInboxPage` and `ApprovalsPage` (two routes under `/dashboard`); Telegram approval callbacks in `telegram-leads-bot` (from the live source of P0-5) | Claude | 1 d | H-26 |
| P4-13 | Cost measurement: AI Gateway logs, Analytics Engine `microns_events`, `agent_runs.cost_cents` | Claude | 0.25 d | — |
| P4-14 | One real RFQ end to end with the approval gate; gate review | Both | 0.5 d | — |

File-level change list:

| Change | Path | Note |
|---|---|---|
| New | `workers/mail/wrangler.jsonc`, `workers/mail/src/index.ts` | `ALLOWED_RCPT` = `rfq@rfq.micronshub.eu,replies@rfq.micronshub.eu` |
| New | `workers/ops/src/workflows/{rfq-intake,quote,post-order}.ts` | — |
| New | `workers/ops/src/do/{rfq-thread,material-stock,cad-router,microns-mcp}.ts` | — |
| New | `workers/ops/src/agents/*` | Prompts, AI Gateway client, classifiers |
| New | `workers/ops/src/queues/{cad-jobs,agent-events}.ts`, `workers/ops/src/cron/{flags-sync,gmail-poller}.ts`, `workers/ops/src/scrapers/*` | — |
| New | `supabase/migrations/2026MMDD_agent_layer.sql` | — |
| New | `src/pages/dashboard/RfqInboxPage.tsx`, `src/pages/dashboard/ApprovalsPage.tsx` | Under `/dashboard` (disallowed in `public/robots.txt`) |
| Changed | `workers/ops/wrangler.jsonc` | Workflows, DOs, Vectorize `QUOTES_INDEX`, `AI`, `BROWSER`, `EVENTS`, Custom Domain `mcp.micronshub.eu` |
| Changed | `src/App.tsx` | Two dashboard routes |
| Changed | `src/integrations/supabase/types.ts` | Regenerated, UTF-8 |
| Changed | `supabase/functions/telegram-leads-bot/index.ts` | Approval callbacks |
| Untouched | `workers/site/src/seo/*`, `middleware/*`, `workers/site/src/redirects.ts`, `workers/site/src/sitemap.ts` | Agent deploys never touch the SEO path |

Exit gate:

1. One real RFQ processed end to end (e-mail in → RFQ rows → CAD job → quote draft → approval → quote sent) with the approval gate exercised.
2. Cost per RFQ measured and recorded (AI Gateway + CAD minutes).
3. Every agent has a flag; switching it off stops new runs within 2 min (KV sync + propagation).
4. Every run has an `agent_runs` row with outcome and cost.
5. Parity diff on production unchanged (0 unexplained differences).

Rollback: per-agent flag off (≈ 1–2 min); disable the Email Routing rule for `rfq.micronshub.eu` and restore the previous RFQ mailbox routing (Q3); the migration is additive, so tables stay.

Dependencies: Phase 3 gate; Q3, Q20; Q21 only for the ops digest (Phase 5).

Risk refs: H-5, H-18, H-26, H-28.

Effort total: ≈ 14.5 d (plan: 2–3 weeks).

### 5.5 Phase 5: consolidate compute

Goal: schedulers and long-running jobs move from pg_cron, Supabase Edge Functions, GitHub Actions and the VPS to Cloudflare, job by job, with output parity and a re-activation rollback.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P5-1 | Reconcile edge functions (Q6): re-sync the repo from the live sources of P0-5; delete dead functions after a log check | Both | 0.5 d | H-26 |
| P5-2 | `content-daily` Workflow (`ContentDailyWorkflow`) at 07:00 UTC (replaces `enqueue-daily-article` 07:00, `process-article-queue` */5, `auto-translate-daily-articles` 08:00, `auto-fix-article-links` 08:30, `auto-update-sitemap` 09:00; live 2026-09-30) with Queue `translations` per language, fix-links step, `sitemap` Workflow (`SitemapWorkflow`) and IndexNow; sitemaps written to `microns-private` `sitemaps/…` and served by `microns-site` at identical URLs; flag `agent.content_daily` | Claude | 2 d | H-12, H-19 |
| P5-3 | Collectors as Cron Triggers + Queue `scrapes`: reddit tier1 */15, tier2 */30, tier3 hourly; hn */30; tenders 06:00; flags `agent.growth.reddit`, `agent.growth.hn`, `agent.growth.tenders` | Claude | 1 d | H-29 |
| P5-4 | Marketing: `send-campaign` → Queue `outbound-mail` with `SenderLimiter` DO; `process-followups` and `process-warmup` ported but left off (not live today, C5) | Claude | 1 d | — |
| P5-5 | Xometry scanner per Q8 (default: TypeScript port on a Cron Trigger at the current hours, .github/workflows/xometry-scan.yml:21; alert on HTTP 401 instead of silent failure; optional Hyperdrive `SUPABASE_DB` for the `xometry_offers` upserts); flag `agent.growth.xometry` | Claude | 1.25 d | — |
| P5-6 | `microns-cad` Container (`CadContainer`) from `sheet-metal-service/Dockerfile`; `CadRouter` switches from the VPS; shared secret `CAD_SHARED_SECRET` and an enforced wall-clock in `sheet-metal-service/main.py` (`PROCESSING_TIMEOUT` is declared at sheet-metal-service/config.py:37); `/flat-pattern` byte-identical (sheet-metal-service/main.py:445); repoint Supabase secret `UNFOLD_SERVICE_URL` (supabase/functions/generate-manufacturing-pdf/index.ts:55) | Both | 1.5 d | H-18 |
| P5-7 | `ops-digest` Workflow (`OpsDigestWorkflow`) Mondays 06:30 UTC; Google Ads offline conversions only if Q21 is yes; flag `agent.ops_digest` | Claude | 0.75 d | — |
| P5-8 | Switch-over, one job at a time: deactivate the pg_cron job (`active = false`), enable the Cloudflare job; GitHub Action schedule removed (manual dispatch kept); every ported job writes its outcome to `agent_runs` | Both | 0.5 d | H-29 |
| P5-9 | 7-day output parity and sign-off; afterwards unschedule the deactivated pg_cron jobs, which removes the embedded service credentials from `cron.job` | Both | 0.5 d | H-7 |

File-level change list:

| Change | Path | Note |
|---|---|---|
| New | `workers/ops/src/workflows/{content-daily,sitemap,ops-digest}.ts` | — |
| New | `workers/ops/src/cron/{collectors,marketing}.ts`, `workers/ops/src/queues/{translations,outbound-mail}.ts`, `workers/ops/src/do/sender-limiter.ts` | — |
| New | `workers/ops/src/xometry/*` | TypeScript port of `xometry-bot/xometry_bot/{partner_client,filters,pricing}.py`; the 95 test functions in `xometry-bot/tests/` become fixtures (if Q8 = TypeScript) |
| New | `workers/cad/*` | Container app definition (`CadContainer`, image from `sheet-metal-service/Dockerfile`), bound from `microns-ops` |
| New | `supabase/migrations/2026MMDD_deactivate_ported_crons.sql`, `supabase/migrations/2026MMDD_unschedule_ported_crons.sql` | The second runs only after the gate |
| Changed | `sheet-metal-service/main.py`, `sheet-metal-service/Dockerfile` | Shared secret, wall-clock; image build for Containers |
| Changed | `workers/site/src/sitemap.ts` | Reads sitemap blobs from R2 |
| Changed | `supabase/functions/*` | Re-synced from live (Q6) |
| Changed | `.github/workflows/xometry-scan.yml` | Schedule removed, `workflow_dispatch` kept |
| Deleted | Dead edge functions and their repo folders (Q6) | After a log check |
| Untouched | `supabase/functions/{create-partner-auth-user,update-partner-password,send-user-email,xometry-review,leads-api,post-to-social-media,telegram-leads-bot,telegram-tenders-bot,extract-flat-pattern,generate-manufacturing-pdf}` | Stay on Supabase (README §7 item 2) |

Exit gate (outputs, not cron status, because of H-29):

1. For 7 consecutive days: articles published per language per day ≥ the pre-switch 7-day baseline; translation lag for cs/da/fi/hu/nb/pl/sv/pt falls every day (19 days today, live 2026-09-30).
2. Sitemap regenerated daily; its URL set equals the published rows; headers unchanged.
3. Leads and tenders inserted per day within the normal range of the prior 7 days; Xometry offers upserted on schedule.
4. `/flat-pattern` returns byte-identical output for 5 reference STEP files; Container cold start measured.
5. Every ported run has an `agent_runs` row with outcome.
6. Old schedulers disabled, not deleted, for the whole window.

Rollback: re-activate the pg_cron job (`active = true`), re-enable the GitHub Action schedule, point `UNFOLD_SERVICE_URL` back to the VPS (kept until Phase 6), flag the Cloudflare job off. Time ≈ 15 min.

Dependencies: Phase 4 gate (`agent_runs`, `feature_flags`); P0-4, P0-5; Q2, Q6, Q8, Q21, Q22.

Risk refs: H-7, H-12, H-17, H-18, H-19, H-26, H-29.

Effort total: ≈ 9 d + the 7-day window (plan: 1–2 weeks).

### 5.6 Phase 6: hardening + decommission

Goal: rotate credentials, remediate RLS, remove Vercel and the VPS, and prove the cost target.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P6-1 | Rotate all service credentials (Supabase, Google OAuth grants, AWS, Resend, Telegram, GitHub/Postgres DSN, AI keys) and re-issue them to every consumer, including the Worker secrets created in Phases 1–5; checklist in the private note. If Phase 7 proceeds, the Supabase credentials are retired with the Supabase project instead | Dimitris (Claude prepares and verifies) | 1 d | H-7, H-30 |
| P6-2 | RLS remediation per [docs/security/rls-remediation-plan.md](../security/rls-remediation-plan.md) and the private note, incl. the tenant-role gap and the broader-than-intended policies; policy tests | Claude (Dimitris applies) | 1.5 d | H-5, H-6, H-30 |
| P6-3 | Supabase security advisor findings and credential-storage findings (private note) | Both | 0.25 d | H-21, H-30 |
| P6-4 | Application hardening: optional Access on `/dashboard*` (and `/customer*`, `/partner*`); CORS tightened; `/reset-password` route (src/contexts/AuthContext.tsx:220 links to it; no route in src/App.tsx:162-319); the Maps Embed key in `src/pages/Contact.tsx` referrer-restricted to production hosts; caller authentication for the `leads-api` edge function; parity re-run after each change | Claude | 1 d | H-6, H-21, H-22 |
| P6-5 | Decommission: Vercel project paused (not deleted) for 30 days; VPS off after the Container has run ≥ 7 days; GitHub Action removed | Both | 0.5 d | — |
| P6-6 | Repository cleanup (file list below); `README.md` rewrite; optional removal of the prerender plugin with a parity re-run | Claude | 0.5 d | H-8, H-23 |
| P6-7 | Security checklist (private) and 30-day cost report against the Q14 baseline ([COSTS.md](COSTS.md)) | Both | 0.5 d | — |

File-level change list:

| Change | Path | Note |
|---|---|---|
| New | `supabase/migrations/2026MMDD_rls_remediation.sql`, `src/pages/ResetPassword.tsx` | H-5, H-6, H-22 |
| Moved | `middleware/*` → `workers/site/src/seo/*` | The Worker is the only consumer |
| Moved | `api/*.js`, `api/_lib/*` → `workers/ops/src/legacy-api/*` | The shim-wrapped routes import them from there |
| Changed | `src/App.tsx`, `README.md`, `workers/site/src/api/router.ts` | Reset-password route; rewrite; CORS |
| Changed | `supabase/functions/leads-api/index.ts` | Caller authentication (H-6); deployed by Dimitris |
| Changed (optional) | `vite.config.ts`, `index.html` | Prerender plugin removal; `cdn.gpteng.co` script (index.html:89-90) removal is an owner decision |
| Deleted | `vercel.json`, `middleware.ts`, `scripts/dev-server.js`, `scripts/freecad-unfold/`, `.github/workflows/auto-merge-claude.yml`, `.github/workflows/xometry-scan.yml`, `docs/AWS_S3_VERCEL_GUIDE.md` | — |
| Deleted after a log check | `public/laserkritis/`, `public/cookie-consent.html` | Reachable static URLs today |
| Untouched | `lib/*`, `sheet-metal-service/`, remaining `supabase/functions/*` | — |

Exit gate:

1. Security checklist signed by the owner (private).
2. P6-1 complete: every consumer works with the new credentials (no auth errors in 24 h of logs) and the old ones are revoked.
3. 30-day cost ≤ target (baseline per Q14).
4. Parity diff after the cleanup: 0 unexplained differences.

Rollback: none for rotation. Vercel stays paused, not deleted, for 30 days: unpause and flip records (§6) if ever needed.

Dependencies: Phase 5 gate; Q14, Q18, Q19.

Risk refs: H-5, H-6, H-7, H-21, H-22, H-30.

Effort total: ≈ 5.25 d (plan: 1 week).

### 5.7 Phase 7 (optional): Supabase → D1 and auth replacement

Owner decision 2026-09-30. Phases 0–6 are unchanged: Supabase stays the system of record through Phase 6. Precondition: Phases 0–6 complete; ≥ 30 days stable after Phase 6 sign-off; Phase 5 has already moved schedulers and non-auth edge functions to Cloudflare.

Canonical names: D1 database `microns-db`, binding `DB` (on `microns-site` for SEO reads, on `microns-ops` for everything else); Durable Object `RealtimeHub` (WebSocket hibernation) for the two Realtime subscriptions (`marketing_campaigns` UPDATE, `user_emails`); data API `/api/data/*` served by `microns-ops` through the `microns-site` router; flag `data.backend` (`supabase` or `d1`, Phase 7 only); auth provider per Q23.

| ID | Workstream | Owner | Effort |
|---|---|---|---|
| P7-1 | Schema port: 72 public tables (live 2026-09-30) to the SQLite dialect (jsonb → TEXT JSON with `json_*` functions, uuid → TEXT, timestamptz → TEXT ISO-8601, arrays → JSON, enums → CHECK, sequences → INTEGER PRIMARY KEY or app-generated ids); functions and triggers (`is_staff()`, `my_customer_ids()`, `get_user_tenant_ids()`, `enqueue_next_article()`, `on_auth_user_created_customer`, SECURITY DEFINER helpers) → Worker code; `wrangler d1 migrations` | Claude | 0.75–1 week |
| P7-2 | Authorisation: one data-access layer in `microns-ops` enforces tenant, customer, partner and staff rules; every former RLS policy becomes a tested rule (policy-parity suite generated from `pg_policies`) | Claude | 1–1.5 weeks |
| P7-3 | Auth replacement (Q23): (a) Workers-native library on D1, (b) hosted IdP, or (c) Access for staff + (a) or (b); password hashes from `auth.users` verified with bcrypt on first login (CPU cost per login measured) or a forced reset e-mail; roles `customer`, `partner_seller`, `admin`, tenant roles | Both | 1–1.5 weeks |
| P7-4 | Realtime → `RealtimeHub`, or keep the existing polling fallback (src/components/dashboard/marketing/CampaignProgress.tsx:41) | Claude | 0.25–0.5 week |
| P7-5 | Storage: `rfq-files`, `quote-files`, `sitemaps`, `tenant-laserkritis` → `microns-private` / `microns-public` | Claude | 0.25–0.5 week |
| P7-6 | Remaining auth-bound edge functions (`create-partner-auth-user`, `update-partner-password`, `send-user-email`, `xometry-review`, Telegram bots, `post-to-social-media`, `extract-flat-pattern`, `generate-manufacturing-pdf`) → `microns-ops` | Claude | 0.5–1 week |
| P7-7 | Frontend data layer: replace direct supabase-js calls with a typed client for `/api/data/*`. Scope (grep over `src/**/*.ts(x)` at `9afcba8`): `.from('<name>')` 332 call sites in 68 files (tables and storage buckets; 62 written as `supabase.from(` in 21 files), `supabase.auth` 24 in 12 files, `supabase.storage` 25 in 5 files, `supabase.functions` 6 in 5 files, `.channel(` 2 in 2 files, `.rpc(` 2 in 2 files; 77 files in total; re-count at Phase 7 start | Claude | 1.5–2.5 weeks |
| P7-8 | Data migration and cutover: `pg_dump` → transform → `wrangler d1 import` or batched inserts; row counts and per-table checksums; short write freeze (small volumes: rfqs 2, orders 2, customers 21, leads 700, articles 2,344; live 2026-09-30); SEO handler switches from Supabase REST to `DB` → full SEO parity gate re-run; Supabase read-only for 30 days, then decommissioned after a final backup, which retires every Supabase credential | Both | 0.75–1.5 weeks |

File-level change list (outline): new `workers/ops/src/data/*` (data-access layer and `/api/data/*`), `workers/ops/src/do/realtime-hub.ts`, `workers/ops/migrations/*` (D1), `tests/policy-parity/*`, a typed data client under `src/`; changed: the 77 frontend files above, `workers/site/src/seo/*` (data source), both `wrangler.jsonc` files (`d1_databases`); deleted after the 30-day read-only period: `src/integrations/supabase/*` and the Supabase client set-up.

Exit gate: all e2e flows green on D1; row counts and checksums equal; SEO parity 0 diffs; login success rate normal for 14 days; zero Supabase API traffic for 14 days (logs).

Rollback: flag `data.backend` = `supabase`; Supabase stays writable until the exit gate; writes made on D1 during the window are replayed from an `outbox` table.

Risks (Phase 7 entries in [RISKS.md](RISKS.md)): authorisation bugs when RLS becomes application code (highest); auth migration (hash verification, session loss, partner accounts); D1 per-database size and write-throughput limits and SQL dialect gaps (verify current limits in CF docs at Phase 7 start); loss of PostgREST; backups (D1 Time Travel retention to verify); vendor concentration; SEO data-source switch. Costs: D1 pricing vs the removed Supabase plan (tier unknown, Q2) in [COSTS.md](COSTS.md).

Effort total: 6–10 weeks (rough, to refine); P7-7 and P7-2 dominate.

## 6. Phase 3 cutover runbook

Anchors: **T** = NS switch at Papaki; **C** = `www` flip (earliest T + 3 d). Owner of every "go" decision: Dimitris; Claude runs the checks and keeps the runbook log (time, action, result).

### 6.1 Records in scope (live 2026-09-30)

| Name | Type | Value today | During S1–S11 | After the flip |
|---|---|---|---|---|
| `micronshub.eu` | NS | `dns1.papaki.gr`, `dns2.papaki.gr` | Cloudflare pair from T | Cloudflare pair |
| `micronshub.eu` | A | `216.198.79.1` (Vercel) | Same, DNS only | Proxied placeholder + Single Redirect Rule |
| `www` | CNAME | `3096eb4eb748a48f.vercel-dns-017.com` | Same, DNS only | Proxied placeholder + Workers Route |
| `*` | CNAME | `cname.vercel-dns.com` (answers `laserkritis.`, `rfq.`, `_vercel.`, any label) | Same, DNS only | Proxied placeholder + Workers Route |
| `micronshub.eu` | MX | 5 × Google Workspace (`aspmx.l.google.com` + 4 alternates) | Same | Same (never touched) |
| `micronshub.eu` | TXT | SPF `include:_spf.google.com ~all`; `google-site-verification=…` | Same | Same |
| `_dmarc`, `resend._domainkey`, `google._domainkey` | TXT | DMARC `p=none`; Resend DKIM; Workspace DKIM | Same | Same |
| `send` | TXT | SPF `include:amazonses.com ~all` (no MX) | Same | Same (H-16: report only) |
| `micronshub.eu` | DS | Present at the `.eu` registry (Papaki signs the zone) | Removed at T − 3 d | Cloudflare DS from T + 2 d |
| `micronshub.eu` | CAA, AAAA | None | None | None |

### 6.2 Steps

| Step | When | Action | Owner | Pass criteria | Rollback (time) |
|---|---|---|---|---|---|
| S1 | T − 10 d | Go/no-go: Phase 2 gate signed (or owner approves the parallel zone move); P0-4 and P0-9 done. Add zone `micronshub.eu` on Cloudflare Free; note the two assigned nameservers | Dimitris | Zone "pending"; public answers unchanged (DoH) | Delete the pending zone (no effect) |
| S2 | T − 7 d | Lower TTLs at Papaki to 300 s for the apex A, `www`, `*`, MX and TXT records (where Papaki allows); record the old TTLs | Dimitris | DoH shows the new TTLs once the old TTLs have elapsed | Restore TTLs (no user effect) |
| S3 | T − 7 d | Export the Papaki zone (BIND file, or the panel list if no export exists); refresh of P0-4 | Dimitris (Claude reviews) | Every name in §6.1 plus any panel-only record is in the export | — |
| S4 | T − 6 d | Import into Cloudflare with proxying off: every record DNS only; TTL 300 s on apex, `www`, `*`; remove anything the Cloudflare scan added | Dimitris (Claude checks via API export) | Cloudflare export equals the Papaki export record for record (NS, SOA, DNSSEC records excepted) | Edit or delete records in the pending zone (no effect) |
| S5 | T − 6 d | `scripts/dns-parity.mjs`: every name × A, AAAA, CNAME, MX, TXT, CAA against `dns1.papaki.gr` and against the assigned Cloudflare nameservers (or the Cloudflare API export if they do not answer for a pending zone), including `laserkritis.`, `rfq.`, `_vercel.` and a random label | Claude | 0 differences | Fix records, re-run |
| S6 | T − 3 d (lead time per Q7) | Remove the DS at Papaki (disable DNSSEC for the domain) | Dimitris | DoH `DS micronshub.eu` returns no answer; names still resolve (zone now unsigned, not failing) | Re-enable DNSSEC at Papaki (registry turnaround, minutes to hours) |
| S7 | T − 3 d → T | Wait for the DS TTL (read in P0-4) + ≥ 24 h margin (if that exceeds 3 d, move T later); re-run S5 | Claude | DS absent at the parent for longer than its TTL; S5 = 0 differences | — |
| S8 | T (weekday morning) | Switch NS at Papaki to the two Cloudflare nameservers | Dimitris | Within 1 h the `.eu` parent lists the Cloudflare NS; zone "active"; answers equal S5 | Set NS back to `dns1/dns2.papaki.gr` (Papaki zone untouched); safe while no DS is published; effective as the parent NS TTL expires |
| S9 | T + 1 h and T + 24 h | Verify: S5 against public resolvers; MX ×5; SPF; DKIM (`resend._domainkey`, `google._domainkey`); DMARC; `google-site-verification` TXT and GSC domain property verified; Resend domain verified; `send.` SPF unchanged; `_vercel.` answers as before; Vercel shows the domains as correctly configured; mail test both ways (external → Workspace inbox; Resend-sent mail with DKIM pass) | Both | All green | S8 rollback |
| S10 | T + 2 d (≥ 24 h active, S9 green) | Enable DNSSEC in Cloudflare; add the DS Cloudflare shows at Papaki | Dimitris | DS at the parent matches Cloudflare; chain validates (validating DoH resolver sets `AD`; DNSViz clean) | Remove the DS at Papaki, wait the DS TTL, then disable DNSSEC in Cloudflare; see §6.3 |
| S11 | C − 1 d | Readiness: edge certificates active for apex, `www`, `*.micronshub.eu` (Universal SSL covers first-level subdomains, CF docs verified 2026-09-27); zone settings per §6.4 applied before any record is proxied; Workers Routes `www.micronshub.eu/*` and `*.micronshub.eu/*` → `microns-site` deployed (inert while records are DNS only); production version = the version ID that passed the Phase 1 and 2 gates; `SEO_STRICT_404` = `"false"`; `api.forward_to_vercel` off; baseline re-captured (P0-3 refresh); parity preview vs production 0 diffs; GSC snapshot (coverage, crawl stats, Core Web Vitals); Vercel certificate expiry for apex, `www`, wildcard recorded; `tender-collector` and MCP send their credentials | Both | Checklist complete | — |
| S12 | C (low-traffic hour) | Flip `www`: replace the DNS-only CNAME with a proxied placeholder record (for example `AAAA 100::`; CF docs, re-check at execution) | Dimitris flips, Claude verifies | Within 10 min: `verify-ssr.sh` green on `https://www.micronshub.eu`; 20-URL parity smoke vs baseline; `/sitemap.xml`, `/robots.txt`, `/indexnow_key.txt`, `/api/track` (test ID) correct; `X-Seo-Source` present; no `X-Robots-Tag` | Restore `www` CNAME `3096eb4eb748a48f.vercel-dns-017.com`, DNS only (≈ 5–10 min, TTL 300 s) |
| S13 | C + 15 min | Apex: replace A `216.198.79.1` with a proxied placeholder; enable the Single Redirect Rule `micronshub.eu` → `https://www.micronshub.eu${path}${query}` with the status seen in the baseline (HTTP → HTTPS is already configured at S11, §6.4) | Dimitris flips, Claude verifies | Apex and `http://` variants match the baseline (status, `Location`, HSTS), incl. apex `/api/marketing?action=track…` and `/logo.png`, which sent e-mails embed (api/emails.js:165; supabase/functions/send-campaign/index.ts:8) | Disable the rule; restore the A record, DNS only (≈ 5–10 min) |
| S14 | C + 30 min | Wildcard: `*` → proxied placeholder; Route `*.micronshub.eu/*` active | Dimitris flips, Claude verifies | `laserkritis.micronshub.eu/en` 200 with the tenant page and, for parity, the Microns SEO body and `www` canonical (H-13); valid certificate; a random label behaves as in the baseline | Restore `*` CNAME `cname.vercel-dns.com`, DNS only (≈ 5–10 min) |
| S15 | C + 1 h | Bot and cache verification per [SEO_PARITY.md](SEO_PARITY.md): no Cache Rule on HTML; Security Events show no challenge or block for verified bots; GSC URL Inspection live test succeeds on 5 URLs | Both | All green | Revert the setting; if verified bots were blocked, S12–S14 rollback |
| S16 | C + 1 h, + 6 h, + 24 h, + 48 h | Observation: Workers Logs 5xx; parity diff production vs S11 baseline (new articles allow-listed); GSC crawl stats and coverage; outputs of the 06:00 tender run and the 07:00–09:00 content jobs; IndexNow; mail test; Resend and GSC verified | Both | Exit-gate thresholds (§5.3) hold | Record-flip rollback on any trigger in §6.5 |
| S17 | C + 48 h | Gate review and sign-off; keep TTL 300 s and Vercel deployable until Phase 6; start P3-6 | Both | Owner signs | — |

### 6.3 DNSSEC rollback hazard

| Situation | Consequence | Rule |
|---|---|---|
| After S10, NS reverted to Papaki while the Cloudflare DS is still at the registry | Papaki signs with different keys, so validating resolvers treat the zone as bogus: every name fails to resolve, including MX (mail) and the site | Never roll the site back through NS. Site rollback is S12–S14 record flips inside Cloudflare |
| An NS rollback is really needed after S10 | — | Remove the Cloudflare DS at Papaki → wait DS TTL + margin → switch NS back → re-enable Papaki DNSSEC only after the NS change has propagated |
| Owner wants the cheapest NS rollback during the flip | — | S10 may be postponed until after S17; it is independent of the site flip |
| Vercel certificates | The record-flip rollback relies on Vercel still holding valid certificates for apex, `www` and `*.micronshub.eu`; renewals may fail once traffic no longer reaches Vercel (verify at execution) | Expiry dates recorded at S11; re-checked before any rollback after the Phase 3 gate |

### 6.4 Zone settings applied at S11 (full checklist in [SEO_PARITY.md](SEO_PARITY.md))

| Setting | Value | Why |
|---|---|---|
| Cache Rules | None for HTML; HTML, JSON and XML are not cached by default and `max-age=0` is honoured (CF docs, verified 2026-09-27) | The SEO `Cache-Control` already prevents edge caching; sitemaps use the Worker Cache API (H-12) |
| Rocket Loader, Auto Minify (if offered), Email Address Obfuscation, Mirage, script-injecting speed features, HTML-modifying Zaraz | Off | They rewrite HTML or inject scripts (brief §6) |
| Bot Fight Mode | Off; verified bots allowed | H-1 |
| Web Analytics automatic setup | Off (manual snippet only if wanted) | Edge injection is a parity violation (CF docs, verified 2026-09-27) |
| Rate limiting | One rule on `/api/*` (Free plan: 1 rule, 10 s window, IP) | H-6 |
| Always Use HTTPS / HSTS | HTTP → HTTPS status and HSTS values as in the baseline; if "Always Use HTTPS" emits a different status than the baseline, use a redirect rule with the baseline status instead (CF docs, re-check at execution) | H-24 |

### 6.5 Rollback triggers during S12–S17

| Trigger | Action | Decision |
|---|---|---|
| 5xx on SEO paths > 0.1 % over 15 min | S12–S14 rollback | Dimitris (Claude recommends) |
| Any unexplained parity difference on an SEO URL | Fix forward within 1 h, else rollback | Dimitris |
| Verified bots challenged or blocked | Revert setting; rollback if not fixed within 15 min | Dimitris |
| `/sitemap*.xml` not 200 `application/xml` | Rollback | Dimitris |
| GSC indexed pages −2 % or 404 spike > 2× | Rollback and investigate | Dimitris |
| Tracking, click or unsubscribe URLs failing | `api.forward_to_vercel` on, else rollback | Dimitris |

## 7. Deviations from the brief

| Brief says | This plan does | Why |
|---|---|---|
| §6: 404s must be real 404s; unknown `/{lang}/…` slug → 404 with the shell | Soft-404 parity (200) through cutover; flag `seo.strict_404` enables 404 + shell after 2 weeks of flat GSC coverage (Q5) | Changing status codes during the host move would mix two causes in GSC; parity first makes any regression attributable to one change (H-9) |
| §3/§5: `_redirects` + `_headers` in `dist/` | In-Worker redirect table; `_headers` not needed | `_redirects` runs in the asset layer before the Worker (H-3), cannot do NFC-decoded matching, and Vercel emits 308 not 301 (vercel.json:2-128) |
| §3: Hono in the same Worker (or a second `api` Worker) | Three Workers + one Container app | Blast radius: the SEO Worker stays small and parity-gated; agents, crons and CPU-heavy routes live elsewhere (H-18, H-27) |
| §5 Phase 3: flip `www`/apex to the Worker Custom Domain | Workers Route on a proxied placeholder for `www`; Single Redirect Rule for the apex; Route for `*.micronshub.eu` | A Custom Domain cannot be created on a hostname that has a CNAME and has no wildcard support (CF docs, verified 2026-09-27); a Route keeps rollback a record flip |
| §2 item 8, §3, §5: tenant hostnames via Cloudflare for SaaS | Deferred; wildcard record + Route + Universal SSL | No tenant has a custom domain (live 2026-09-30); `www.laserkritis.gr` is served by its own nginx host (H-25) |
| §3: migrate Vercel Analytics | Nothing to migrate; observability via Workers Logs + Analytics Engine `microns_events` | No Vercel Analytics exists; tracking is GA4 + Google Ads tags in `index.html` (C11) |
| §5 Phase 4: feature flags per agent in `app_settings` | Table `feature_flags` mirrored to KV `FLAGS` | Typed, auditable flags readable by Workers in one KV read; `app_settings` stays for its current keys |
| §5 Phase 6: secrets rotation | Rotation in Phase 6 (P6-1), unchanged from the brief; pre-flight P0-2 keeps the consumer inventory current | Every Worker secret created in Phases 1–5 is on the checklist before rotation |
| §3: R2 with Worker-issued presigned URLs | Two buckets, `microns-public` and `microns-private`; legacy S3 read-only | A public custom domain can never expose customer files; 755 article-image URLs point at S3 (H-17) |
| §1, §3: `check-replies` polls Gmail; keep it | `check-replies` is not live (C5); Phase 4 adds a Gmail poller for the 2 Workspace sender accounts and subdomain Email Routing | Nothing polls Gmail in production today |
| §3: Cloudflare Web Analytics as the replacement | Manual snippet only, and only if the owner wants it; automatic setup never enabled | Automatic setup injects the beacon into HTML at the edge (CF docs, verified 2026-09-27), a parity violation (§6.4) |
| §2 item 3: Supabase stays, no D1 | Owner decision 2026-09-30: Supabase stays for Phases 0–6; optional Phase 7 outlines a later move to D1 | Recorded in §5.7 |
| §5 Phase 0: exit gate = inventory | Adds pre-flight P0-1…P0-9 | Auto-merge to production (H-2), challenged baseline (H-1), live drift (H-26) |
| §5 Phase 3: move NS (Vercel stays as origin) | DS removal before the NS move, DNSSEC re-enabled afterwards | A DS record exists at the registry (live 2026-09-30); moving NS with it in place breaks resolution |
| §3: `xometry-scan` token refresh via Browser Rendering | Alert on HTTP 401; token stays a manual refresh | The token is MFA-gated (C19) |
| §3: R2 replaces S3 | New objects only; existing objects stay on S3 read-only (Q11) | Persisted `*.amazonaws.com` URLs (H-17) |
| §1: `VITE_AWS_*` shipped to the browser, must be fixed | Already out of the bundle (vite.config.ts:67-72); only env names and docs change (Phase 2) | C2 |

### 7b. Refinements against the approved plan of 2026-09-27

| plan.md said | This file | Why |
|---|---|---|
| Credential rotation in Phase 2 | P0-2 consumer inventory in pre-flight; rotation P6-1 | Owner decision 2026-09-30 |
| One R2 bucket `microns-files` | `microns-public` + `microns-private` | See §7 |
| Custom Domain for `www` (plan §8b, Phase 3) | Workers Route | Plan §8 table and CF docs |
| AI Gateway routes with fixed model IDs | Role-based routes; models chosen at Phase 4/5 start | Model IDs age quickly |
| `notifications` partner/inventory CRUD in `microns-site` | Every `/api/notifications` action in `microns-ops` (planned: `partner` and `production-status` local; changed in the Phase 2 build, §5.2 DV-1) | Keeps `lib/inventory`, `qrcode` and nesting out of the site bundle (H-27); api/notifications.js imports them at module scope |
| Delete `public/cookie-consent.html` in Phase 1 | Phase 6, after a log check | It is a reachable static URL; deleting it in Phase 1 would fail the parity gate |
| Close H-5 before the agent layer | Agents do not trust tenant roles; H-5 closed in the Phase 6 RLS remediation | RLS changes are scheduled in Phase 6 |
| 17 draft questions | 23 questions (Q4 answered) | Final list in §9 |
| No Phase 7 | Optional Phase 7 | Owner decision 2026-09-30 |

## 8. Calendar estimate

Assumes 5 working days a week, gate sign-off within 1–2 working days, and owner availability for the dashboard steps. Weeks count from PLAN.md approval.

| Window | Content | Parallel zone move (recommended) | Sequential |
|---|---|---|---|
| Pre-flight | P0-1…P0-9 (≈ 3.2 d) | W1 | W1 |
| Phase 1 | ≈ 3.7 d + gate | W2 | W2 |
| Phase 2 | ≈ 7 d + gate | W3–W4 | W3–W4 |
| Phase 3 zone move (S1–S10) | ≈ 12 calendar days incl. DS wait | W3–W4, alongside Phase 2 | W5–W6 |
| Phase 3 flip + 48 h (S11–S17) | ≈ 1.5 d + 48 h | W5 | W7 |
| Q5 window | 2 weeks of flat GSC coverage, then `seo.strict_404` (P3-7) | W6–W7, alongside Phase 4 | W8–W9 |
| Phase 4 | ≈ 14.5 d | W6–W8 | W8–W10 |
| Phase 5 | ≈ 9 d build | W9–W10 | W11–W12 |
| Phase 5 parity | 7-day output window | W11 | W13 |
| Phase 6 | ≈ 5.25 d | W12 | W14 |
| Cost gate | 30 days after decommission; Vercel paused 30 days | ≈ W16 | ≈ W18 |
| Phase 7 (optional) | Starts ≥ 30 days after Phase 6 sign-off; 6–10 weeks | ≈ W20 → W26–W30 | ≈ W22 → W28–W32 |

Total to the end of Phase 6 work: about 12 weeks (parallel zone move) or 14 weeks (sequential), plus the 30-day cost gate.

## 9. Open questions

Q1–Q22 are the final list agreed in planning; Q4 is answered; Q23 was added with the optional Phase 7; Q24 was added during Phase 1 (2026-10-03). Other documents cite them as "PLAN.md Q<n>". "Blocks" names the first item that cannot start without an answer; the recommended default is what Claude will assume if the owner agrees without further detail.

| # | Question | Recommended default | Blocks |
|---|---|---|---|
| Q1 | Is Vercel Attack Challenge Mode intentionally on? Can you run the baseline capture from your machine, or allow-list a runner IP? (H-1) | Run the capture from the owner's laptop; confirm the setting in the Vercel dashboard and make sure Worker egress is not challenged while `api.forward_to_vercel` is the Phase 2 rollback | P0-3; Phase 1 gate item 1; Phase 2 gate item 7 |
| Q2 | VPS provider/spec/monthly cost/hostname for `sheet-metal-service`; Supabase plan tier. | None (information only) | Cost gate (Phase 6); Container sizing (P5-6); Phase 7 cost comparison |
| Q3 | Techpilot: RFQs by e-mail, portal, or both? Which mailbox receives RFQs today? May I create `rfq.micronshub.eu` Email Routing records on Cloudflare? | Yes to `rfq.micronshub.eu`; Techpilot notifications forwarded to `rfq@rfq.micronshub.eu`; the current mailbox keeps a copy during Phase 4 | P4-4, P4-5 |
| Q4 | (answered 2026-09-30) Credential rotation timing: the owner schedules rotation at the end of the migration (Phase 6, P6-1). | — | — |
| Q5 | Keep soft 404s through cutover (parity) and enable `seo.strict_404` after 2 weeks of flat GSC coverage? | Yes | P3-7 |
| Q6 | The 15 out-of-repo edge functions: keep `gsc-*` and `resend-webhook`? Delete the `-v2`, `-no-jwt`, test and diag ones? Re-sync the repo from live before Phase 5? | Keep `gsc-*` if a caller exists; retire `resend-webhook` after a log check (the Phase 2 Worker handles Resend); delete `-v2`, `-no-jwt`, test, diag and `enqueue-translations`; yes, re-sync before Phase 5 | P5-1 |
| Q7 | Papaki: who holds the account, and can DNSSEC be disabled there ~3 days before the NS move? | Owner holds it; DS removed at T − 3 d | P0-9; runbook S6 |
| Q8 | Xometry scanner: Python unchanged in a Container on a cron (fastest), or the TypeScript port? Is Phase-2 Playwright pricing wanted? | TypeScript port on a Cron Trigger (no Container minutes; existing tests as fixtures); Playwright pricing not now | P5-5 |
| Q9 | Tenant hosts: keep the Microns SEO body + `www` canonical (current behaviour), or skip injection for non-www hosts? | Keep current behaviour through Phase 3 (parity, H-13); revisit afterwards | Nothing before Phase 3; any later change to the SEO handler |
| Q10 | Gate `auto-merge-claude.yml` with a branch allow-list, or move this migration to a non-`claude/**` branch? | Gate with a branch allow-list and branch protection | P0-1, hence all Phase 1 code |
| Q11 | Legacy S3 objects: keep the buckets read-only (recommended), or migrate and rewrite the DB rows? | Keep read-only | P2-4 design |
| Q12 | May branch protection be enabled on `main`? | Yes | P0-1 |
| Q13 | Is `microns-hub.com` (terms URL in PDFs) an owned domain? Is the Zoho verification still needed? | Keep `/zohoverify/*` served as today until answered; terms URL corrected in Phase 6 if the domain is not owned | P6-6 cleanup only |
| Q14 | Cost baseline for the cost gate: today's literal €0 Vercel Hobby + VPS, or Vercel Pro ($20/mo) + VPS? | Vercel Pro ($20/mo, list price, re-check at execution) + VPS, because commercial use is outside the Hobby plan | Phase 6 gate item 3 |
| Q15 | Which package manager does the Vercel build use (`bun.lockb` and `package-lock.json` are both committed), and does the production build actually run the jsdom prerender (build logs)? | Whatever the Vercel build log shows; if unclear, npm with `package-lock.json` and Node 22.x | P0-7 |
| Q16 | What is in the Supabase Auth URL configuration today (Site URL, redirect allowlist)? May I add the Cloudflare preview host in Phase 1? | Yes, add the preview hosts; keep the Site URL | P0-6; P1-11 |
| Q17 | Should `www.laserkritis.gr` (nginx on its own host today) move onto the tenant system, or stay separate? | Stay separate (out of scope; H-25) | Nothing in Phases 1–6; timing of Cloudflare for SaaS |
| Q18 | The repository is public. Keep migration security details out of the repo (current approach), and do you want the repository made private? | Keep details out of the repo; make the repository private unless it needs to be public | Nothing; affects where later docs live |
| Q19 | Are public customer sign-ups enabled in Supabase Auth, and should they stay open during the migration? | Keep today's setting unchanged during the migration | P2-7 gate matrix; P6-2 |
| Q20 | Monthly LLM budget cap for the agent layer (AI Gateway limits) and any provider preferences? | Proposal: €50/month hard cap in AI Gateway with alerts at 50 % and 80 %; providers as in the canonical routes | P4-3; P5-2 |
| Q21 | Google Ads offline conversions: do you have Ads API access (developer token, customer ID)? | Ship the ops digest without offline conversions; add them when access exists | The Ads part of P5-7 |
| Q22 | Mac mini Fusion 360 worker: expected timeline? Should Phase 5 target the Container only and add the Mac mini later behind the same interface? | Container only in Phase 5; Mac mini later behind the same Queue → R2 → Supabase-row interface | Nothing (P5-6 design) |
| Q23 | Phase 7 (optional D1 move): which auth approach replaces Supabase Auth for customers and partners (Workers-native library, hosted IdP, or Access for staff + one of those), and are the two Realtime features still needed? | Decide at Phase 7 start; leaning to Access for staff + a Workers-native library for customers and partners; keep the polling fallback instead of `RealtimeHub` if Realtime is not needed | P7-3, P7-4 |
| Q24 | Czech URLs for industries and our work: `content_pages.localized_slug` is `odvetvi` and `projekty` for `cs`, while the static routes, the prerender and the published sitemap use `prumysl` and `nase-prace` (middleware/slugs.ts:64, vite.config.ts:24); the other 13 languages match (Supabase, read 2026-10-03). All 9 published `cs` content rows link to `/cs/odvetvi` and `/cs/projekty`, which answer 200 with the database page and their own canonical, next to the static `/cs/prumysl` and `/cs/nase-prace`. Vercel serves the same today; the parity URL set covers both forms (G1 and G3). Which form should be canonical? | No change before Phase 3 sign-off (a content edit during the parity window changes both hosts and the baseline); then align the database rows with one form, decided with GSC data for both | Nothing in Phases 1–3 |
