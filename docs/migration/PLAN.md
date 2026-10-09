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

1. **Three Workers and one Container app**, not one Worker: `microns-site` (Static Assets, SEO handler, redirect table, sitemap routes, `/api/*` router), `microns-ops` (Hono: ops/admin API, Cron Triggers, Queues, Workflows, Durable Objects, AI Gateway, remote MCP), `microns-mail` (Email Worker) and `microns-cad` (Container from `sheet-metal-service/Dockerfile`; as built its class lives in `microns-ops` and the image is prebuilt in CI, §5.5 DV5-14, DV5-21). Repo layout `workers/site`, `workers/ops`, `workers/mail`, `workers/cad`. An agent deploy can never take the SEO path down.
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
13. **Agents are flag-gated Workflows and Durable Objects with human approval**: Telegram one-tap approvals, AI Gateway `microns` with role-based routes (`extract`, `classify`, `embed` from Phase 4; `translate` from Phase 5), every agent behind a flag in table `feature_flags` mirrored to KV `FLAGS`, every run a row in `agent_runs`.
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

Owner checklist (added 2026-10-09): every owner step of every phase, in working order, is in [MANUAL_STEPS.md](MANUAL_STEPS.md); the owner step IDs in the build records of §5.2–§5.6 (`O-n`, `OW-n`, `OW3-n`, `OW5-n`, `OW6-n`) are its row IDs.

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
| 5 Consolidate compute | Article pipeline Workflow + translation Queue; collectors; marketing crons; Xometry scanner; CAD Container; dead edge functions removed; ported pg_cron jobs unscheduled | 7 days of output parity; old schedulers disabled, not deleted | Flag off + re-activate pg_cron jobs / repository variable for the GitHub Action / VPS URL (≈ 5–15 min per step) | ≈ 9 d + 7-day window [1–2 weeks] | Both |
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
| P0-5 | Pull live source of all 40 deployed edge functions (reference only; the live list holds 41, §5.5 DV5-8) | Claude | 0.4 d | 40 sources saved privately (not committed until Q6 is answered and each file is checked for secrets); diff report repo vs live for the 25 functions in both | — | H-26 |
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
| P3-1 | Zone preparation (runbook S1–S5): Cloudflare zone (Free plan), TTL lowering, zone export, DNS-only import, `scripts/dns-parity.mjs` (built 2026-10-09: name × type comparison of two answer sources, subcommands `ds` and `names`, no dependency; one command per runbook step in [scripts/dns-parity/README.md](../../scripts/dns-parity/README.md)) | Both | 0.75 d | C9 |
| P3-2 | DNSSEC and NS move (S6–S10) | Dimitris (Claude verifies) | 0.5 d | C9 |
| P3-3 | Pre-flip readiness (S11): zone settings per [SEO_PARITY.md](SEO_PARITY.md), Workers Routes, edge certificates, baseline refresh, GSC snapshot. As built: routes and production values live in `env.production` of `workers/site/wrangler.jsonc` and reach production only through the manual workflow `cf-site-production.yml` (upload, parity on the version preview URL, deploy, routes; DV36-11); three routes without a Worker come first (DV36-12); the redirect rules are generated from the refreshed baseline by `scripts/phase3/redirect-rules.mjs` | Both | 0.5 d | H-1, H-24 |
| P3-4 | Site flip (S12–S15): `www` Route, apex Single Redirect Rule, wildcard Route, bot/cache verification. As built the apex rule is applied at S11 and acts once the apex record is proxied at S13 (DV36-9) | Both | 0.25 d | H-11, H-13, H-24 |
| P3-5 | 48 h observation and gate (S16–S17) | Both | 0.5 d | H-9, H-14 |
| P3-6 | Post-cutover: connect `files.micronshub.eu` to `microns-public` and switch article-image uploads to it (legacy S3 URLs unchanged); `TenantEditPage` DNS copy; README deployment section; re-submit the sitemap index in GSC once; deliverability report for `send.micronshub.eu`, SPF and DMARC with no change to the apex MX. Built 2026-10-09: article images in `microns-public` behind the var `ARTICLES_STORE` (`legacy` until owner step OW3-10), provider-neutral DNS copy, a README section true before and after the flip; the R2, GSC and deliverability steps are owner steps (OW3-10, OW3-11) | Both | 0.5 d | H-16, H-17 |
| P3-7 | Follow-up, not part of the gate: after 2 weeks of flat GSC coverage and a yes to Q5, enable `seo.strict_404`; watch 404 counts for 7 days | Both | 0.25 d | H-9 |

File-level change list (as built):

| Change | Path | Note |
|---|---|---|
| New | `scripts/dns-parity.mjs`, `scripts/dns-parity/{lib,test,fixtures}/**`, `scripts/dns-parity/README.md` | Name × type diff between two answer sources (authoritative server, DoH resolver, zone file or Cloudflare API export); `ds` check for S6, S7 and S10; `--forbid-target` for the check before the Vercel project is deleted; synthetic or public fixtures only; tests run without network |
| New | `scripts/phase3/redirect-rules.mjs`, `scripts/phase3/test/redirect-rules.test.mjs`, `scripts/phase3/payloads/{redirect-rules.default.json,zone-routes.json}`, `scripts/phase3/README.md` | Ruleset payload (HTTP → HTTPS, apex → `www`) from the S11 baseline, exit 1 when the baseline contradicts an assumption; the three routes without a Worker; owner command sheet with `$ZONE_ID` and `$CLOUDFLARE_API_TOKEN` placeholders |
| Changed | `workers/site/wrangler.jsonc` | New block `env.production` (name `microns-site`, routes `www.micronshub.eu/*` and `*.micronshub.eu/*`, full copies of every non-inherited key, the production values of D3-9); top-level `routes` stays `[]`; three top-level vars that select today's behaviour (`ARTICLES_STORE`, `PUBLIC_FILES_ORIGIN`, `API_CORS_MODE`) |
| New | `workers/site/scripts/check-production.mjs`, `workers/site/test/{env-production,check-production}.test.ts` | Both environments resolved with wrangler's own reader; placeholder check (`config`), version guard (`version`: tag `prod-<12 hex>` and the production `API_MACHINE_HOSTS`), Turnstile site-key check (`site-key`) |
| New | `.github/workflows/cf-site-production.yml` | Manual `upload`, `deploy`, `routes`; GitHub environment `production`, `main` only |
| Changed | `.github/workflows/cf-preview.yml` | `--env=""` on the dry run and the upload, nothing else |
| Changed | `workers/site/test/env-api.test.ts` | KV IDs may be the placeholder or 32 hex characters, so real IDs can be committed (2 lines added, 1 removed) |
| New | `workers/site/src/api/articles-store.ts`, `workers/site/test/articles-store.test.ts`, `workers/site/r2/cors.public.json`, `tests/frontend-api/article-image-upload.test.ts` | Article images in `microns-public` behind `ARTICLES_STORE`; no binding |
| Changed | `workers/site/src/api/files.ts`, `src/utils/articleImageStorage.ts` | One import and one branch (2 lines); `size` in the presign body |
| New | `src/components/tenants/CustomDomainInstructions.tsx`, `tests/frontend-api/tenant-domain-copy.test.tsx` | DNS copy that names no provider |
| Changed | `src/pages/dashboard/tenants/TenantEditPage.tsx` | Replace the Vercel DNS instructions (TenantEditPage.tsx:642, :667-678) with the component |
| Changed | `README.md` | Deployment section, true before and after the flip; full rewrite at P6-6 |
| Dashboard only | Cloudflare zone, DNS records, DNSSEC, redirect ruleset, routes without a Worker, rate-limiting rule, zone settings, R2 custom domain, GitHub environment `production` | Recorded in the runbook log; owner steps OW3-2…OW3-13 |
| Untouched | `vercel.json`, `middleware.ts`, `middleware/*`, `api/*`, `lib/*`, `vite.config.ts`, root `package.json` and lockfiles | Vercel stays deployable (brief §2 item 9) |
| Untouched | `workers/site/src/{env,index,sitemap,redirects,static}.ts`, `workers/site/src/seo/**` | SEO path and the Phase 2 environment type unchanged |
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

Effort total: ≈ 3.25 d of work + DS wait + 48 h observation (plan: 2–3 d + 48 h); the code parts were built together with the Phase 6 code from one specification.

Build record (2026-10-09): the Phase 3 code is built and tested locally on top of the commit that closes the Phase 5 build (`b694d06`); nothing is deployed, uploaded or applied, the build created no zone, record, route, rule or secret, and no production site host was called. The build followed [specs/PHASE36_SPEC.md](specs/PHASE36_SPEC.md) (public sections; fixed decisions §1, defaults §2, owner checklist §9, deviations §10.1). This section was brought in line with the build on that date; the owner confirms the deviations and defaults below before the merge (OW3-1 and OW6-1 of [MANUAL_STEPS.md](MANUAL_STEPS.md), the single owner checklist for every phase). "Local" means T1 (vitest in Node), T2 (`wrangler dev --local` in front of stubs) and `node --test` for the Phase 3 tools on offline fixtures; no Cloudflare account was used.

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | 48 h GSC coverage and crawl stats flat | **blocked** | Needs S1–S17 (OW3-3…OW3-8) and the 48 h window. Locally the SEO path is unchanged: `workers/site/src/{index,sitemap,redirects,static}.ts` and `src/seo/**` untouched; `node tests/middleware/smoke.mjs` green |
| 2 | `scripts/verify-ssr.sh` green against production | **blocked** | Owner run from the owner's machine after S12 (production challenges the build container, Q1); the seven pre-existing content checks are confirmed at OW1-2 |
| 3 | Zero 5xx on SEO paths over 48 h | **blocked** | Workers Logs during S16 |
| 4 | Parity production vs the S11 baseline: 0 unexplained differences | **blocked** (local part passes) | The production upload is checked on its version preview URL against the S11 baseline before it is deployed (OW3-6 f); `deploy` refuses a version without the tag `prod-<12 hex>` or with another `API_MACHINE_HOSTS` (`check-production.mjs version`); the dry runs of the top level and of `env.production` produce the same `index.js`; parity tool tests 94/94. Expected explained differences: `/robots.txt` (the `/reset-password` line, P6-4) and, against a baseline captured before the merge, HTML documents without the third-party editor script (DV36-6) |
| 5 | Mail records unchanged; mail tests | **blocked** (local part passes) | `scripts/dns-parity.mjs` compares every name × type of two sources (TXT strings joined, TTL ignored unless asked): export vs import fixtures 0 differences; a drift fixture (MX missing, SPF changed, record added, `www` proxied) exits 1; 28 tests without network. Owner runs per step (OW3-3, OW3-7); mail tests at S9 |
| 6 | Resend domain and GSC domain property verified | **blocked** | S9 checks (owner); the verification TXT records are part of every DNS comparison |
| 7 | DNSSEC chain validates | **blocked** (local part passes) | `scripts/dns-parity.mjs ds` with `--expect absent` and with `--expect present --key-tag N` tested offline; owner runs at S6, S7 and S10 |

Other checks of the same run (2026-10-09; one gate run covers Phase 3 and Phase 6, rows G36-a…G36-k of the specification):

| Check | Result |
|---|---|
| T1 | shared 402, site 1,434, ops 2,041 (19 opt-in tests skipped), mail 25; frontend helpers 184 (13 files); edge-function tests 15; typecheck clean in shared, site and ops |
| T2 | Phase 2 profile `api`: site 52, ops 4; Phase 4 profile `agents`: 11 files, 46 tests; Phase 5 profile `jobs`: 7 files, 27 tests; all as at the Phase 5 close |
| SQL | `supabase/tests/agent_layer`: 572; `supabase/tests/phase5`: 123 and 138 assertions; the Phase 6 database checks are listed in §5.6 |
| Phase 3/6 tools | `node --test`: dns-parity 28, phase3 6, phase6 22; Phase 1 smoke and parity tool tests 94/94 |
| Preview unchanged | Top-level config resolves as before (three new vars that select today's behaviour; no route, binding or secret added); `cf-preview.yml` differs only by `--env=""` on two lines; parity CORS and legacy article images by default |
| Bundles | `microns-site` 3,398.22 KiB with no forbidden input; `microns-ops` upload 10,072.48 KiB; `microns-mail` 17.15 KiB |
| Vercel side | `vercel.json`, `middleware*`, `api`, `lib`, `vite.config.ts`, root `package.json` and lockfiles, `auto-merge-claude.yml`, `xometry-scan.yml`, `scripts/dev-server.js`, `scripts/freecad-unfold`, `docs/AWS_S3_VERCEL_GUIDE.md`, `public/laserkritis`, `public/cookie-consent.html` unchanged; `npx vite build` succeeds |
| Scans | Secret-pattern and public-wording scans over every added or changed path: no hit; the code build changed only the paths the specification allows (this docs update follows the gate) |
| Owner checklist | [MANUAL_STEPS.md](MANUAL_STEPS.md): each owner ID of the sources once (140 IDs); every row that sets a `microns-site` secret carries the site-secret procedure; every row that proxies a new host carries the route-without-a-Worker rule |
| Not run here | Every step that needs a Cloudflare account, the zone's name servers, a Supabase write or a production host |

Deviations from this section and from the runbook (§6) as first written (DV36-n = [specs/PHASE36_SPEC.md](specs/PHASE36_SPEC.md) §10.1; the runbook rows S11, S13 and §6.4 are marked "as built" on the same date):

| # | Planned | Built | Why |
|---|---|---|---|
| DV36-7 | File list: `scripts/dns-parity.mjs`, routes in `wrangler.jsonc`, `TenantEditPage`, README | Plus `env.production`, `cf-site-production.yml`, the `cf-preview.yml` flag, `scripts/phase3/**`, `articles-store.ts`, the `files.ts` branch, `size` in the article presign body, `CustomDomainInstructions.tsx`, `check-production.mjs` and tests | P3-3 and P3-6 needed them |
| DV36-9 | S13 "enable the Single Redirect Rule" | Both redirect rules applied at S11 in one ruleset; the apex rule acts once the apex record is proxied (S13); rollback = the record back to DNS only | No switch between S11 and S13; a DNS-only record never reaches the rules (verify at execution) |
| DV36-11 | S11 "production version = the version ID that passed the Phase 1 and 2 gates" | A new production upload of the merged commit, tagged `prod-<sha>`, checked by parity on its version preview URL against the S11 baseline, then deployed | Preview versions carry the top-level vars; routes, gate modes and the machine host exist only in `env.production` |
| DV36-12 | S11: two Worker routes | Plus three routes without a Worker (`files.`, `mcp.`, `cad-vps.micronshub.eu`) created first, and a standing rule: every later proxied host that the site must not answer gets such a route before its record is proxied | The wildcard route answers every proxied first-level host |

Build amendments (BA36-n: changes made during the build, its reviews and the gate, beyond the specification text):

| # | Amendment | Where |
|---|---|---|
| BA36-1 | `redirect-rules.mjs` runs its command line also when started through a symlinked path, so a contradicting baseline still exits 1 (the stop rule of OW3-6 b); a test case starts it through a symlinked directory | `scripts/phase3/redirect-rules.mjs` and its test |
| BA36-2 | The S12–S14 check of OW3-7 lists only the names proxied at that step (S12 `www,api`; S13 `www,@,api`; S14–S16 `www,@,*,api`) and runs once per assigned Cloudflare name server; the specification's single list would fail before S14 | [MANUAL_STEPS.md](MANUAL_STEPS.md) OW3-7; [scripts/dns-parity/README.md](../../scripts/dns-parity/README.md) |

Defaults chosen for the owner ([specs/PHASE36_SPEC.md](specs/PHASE36_SPEC.md) §2.1; each can be changed before the step named). Owner-sensitive:

| # | Decision | Default built | Decide before |
|---|---|---|---|
| D3-9 | Production vars | `API_GATES_MODE` `recipient=report,redirect=report` (today's link and recipient behaviour, logged); `API_MACHINE_HOSTS` `api.micronshub.eu`; `ACCESS_AUD` = preview AUD + API AUD; `HSTS_VALUE` only when the S11 generator reports that the Worker must send it; `ARTICLES_STORE` `legacy`; `API_CORS_MODE` `parity` | S11 (OW3-1, O-23) |
| D3-17 | Article uploads in `r2` mode | Image types only (`jpg`, `jpeg`, `png`, `webp`, `gif`, `avif`; Content-Type must match the extension), size required and at most 5 MiB (signed as Content-Length), for every principal | OW3-10 (e) |

| Area | Defaults | Built as |
|---|---|---|
| Release path | D3-1, D3-2, D3-3, D3-16, D3-18, D3-20, D3-21 | Routes only in `env.production`; manual workflow `cf-site-production.yml` (`upload`, `deploy`, `routes`) in the GitHub environment `production` (owner as required reviewer, `main` only, token with Zone Read); routes by `wrangler triggers deploy --env production`, fallback `wrangler deploy --env production`; `--env=""` in `cf-preview.yml`; `deploy` refuses an untagged or preview-config version; the real Turnstile pair for previews and production from S11 |
| Redirects and hosts | D3-4…D3-8 | 308 for apex and HTTP until the baseline says otherwise (the generator stops on a contradiction); HTTP → HTTPS by a redirect rule `(not ssl)` with Always Use HTTPS off; one ruleset payload applied with one `curl`; routes without a Worker for `files.`, `mcp.` and `cad-vps.` at S11 and for every later non-site host; `api.` through the wildcard route, a proxied record and its Access application |
| DNS tool | D3-13, D3-14 | TXT strings joined; TTL ignored unless `--ttl exact` or `--ttl max:<s>`; a wildcard at an empty non-terminal is `EXPECTED_ENT`, not a failure |
| Copy and README | D3-10, D3-15 | Tenant DNS copy names no provider; README section true on both platforms, merged with the build |
| Article images | D3-11, D3-12 | Var `ARTICLES_STORE` (`legacy` default, `r2`), S3 API against `microns-public` with the R2 token or an optional `R2_PUBLIC_*` pair, no binding; keys `articles/<browser key>` |
| Not built | D3-19 | Slug blocklist on tenant save (FU-1, §5.6) |

New names (built as proposed; renamed only before the first production upload): site vars `ARTICLES_STORE`, `PUBLIC_FILES_ORIGIN`, `API_CORS_MODE`; optional site secrets `R2_PUBLIC_ACCESS_KEY_ID`, `R2_PUBLIC_SECRET_ACCESS_KEY`; config block `env.production`; workflow `cf-site-production.yml` with the GitHub environment `production`; version tag `prod-<first 12 hex of the commit>`; redirect rules `microns_http_to_https`, `microns_apex_to_www`; scripts `scripts/dns-parity.mjs`, `scripts/phase3/redirect-rules.mjs`, `workers/site/scripts/check-production.mjs`.

Owner steps: Phase 3 table of [MANUAL_STEPS.md](MANUAL_STEPS.md) (OW3-1…OW3-13, after the Phase 2 gate; commands in [scripts/phase3/README.md](../../scripts/phase3/README.md) and [scripts/dns-parity/README.md](../../scripts/dns-parity/README.md)). In short: OW3-1 review before the merge; OW3-2 GitHub environment and production token; OW3-3 zone move S1–S10 with a DNS check per step; OW3-4…OW3-6 S11 values, machine host, baseline, redirect payload, zone settings, Turnstile pair, routes without a Worker, production upload and deploy; OW3-7, OW3-8 flips and observation; OW3-9…OW3-12 after S17; OW3-13 standing rules from S11.

Open items after the build (2026-10-09):

| Item | Detail | Who |
|---|---|---|
| S11 values | `env.production` holds placeholders until OW3-4; `check-production.mjs config` lists them and exits 1 until then | Both |
| Site Worker README | `workers/site/README.md` does not yet describe `env.production`, `check-production.mjs` or `ARTICLES_STORE`; the owner commands are in `scripts/phase3/README.md` and [MANUAL_STEPS.md](MANUAL_STEPS.md) | Claude |
| Dry-run warning | `npm --prefix workers/site run build:dry` still prints wrangler's "Multiple environments" warning (cosmetic); the fix is `--env ""` in that script and in `workers/site/scripts/check-bundle.mjs` | Claude |
| Rollback tag | `vercel-stable-2026-10-02` (commit `9afcba8`) is not on GitHub yet (OW0-1) | Owner |

### 5.4 Phase 4: agent layer

Goal: the seven agent designs of [AGENTS.md](AGENTS.md) run on Cloudflare behind flags and human approval, with one real RFQ processed end to end. Agents authorise staff actions through Access and staff checks, not tenant roles, until the Phase 6 RLS remediation closes H-5. Phase 4 builds agents 1–3 and 7 and the scrapers of agent 4; the other growth jobs, the content pipeline and the ops digest follow in Phase 5.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P4-1 | Migration `supabase/migrations/20261005_agent_layer.sql` (one transaction with preconditions; removal script `supabase/rollback/20261005_agent_layer_down.sql`): tables `inbound_emails`, `quote_workflows`, `cad_jobs`, `stock_reservations`, `agent_runs`, `feature_flags`, `pricing_rules`; columns `rfqs.source`, `rfqs.inbound_email_id`, `rfq_files.source`, `rfq_files.r2_key`, `rfq_files.sha256`, `rfq_files.content_type`; RLS on, staff read through `has_staff_role()` (the four `user_roles` staff roles), service-role writes, guard trigger `agent_columns_guard` on `rfqs` and `rfq_files`; service-role RPCs; 13 flag rows seeded off; tests in `supabase/tests/agent_layer` (PGlite, Postgres 18.3 and 16.4); regenerate `src/integrations/supabase/types.ts` as UTF-8 after the owner applies the file (separate commit) | Claude (Dimitris applies) | 1 d | H-21 |
| P4-2 | Flags: `feature_flags` rows for the 13 canonical keys; the first every-minute tick imports the values set by hand in KV, so `api.forward_to_vercel` and `seo.strict_404` keep their state; then the table is mirrored to KV `FLAGS` by revision, with write-through on dashboard edits; `microns-ops` reads agent flags with `cacheTtl` 30 s and fails closed | Claude | 0.5 d | — |
| P4-3 | AI Gateway `microns`: routes `extract` (`claude-sonnet-5-5`, server-side refusal fallback), `classify` (`claude-haiku-4-5`) and `embed` (`@cf/baai/bge-m3`); `translate` is created in Phase 5 with its first caller (DC-18). Anthropic through the provider-native endpoint with `@anthropic-ai/sdk`, keys stored in the gateway (BYOK), authenticated gateway (`AI_GATEWAY_TOKEN`); spend limit with alerts per Q20, no gateway rate limit (DC-19); every call carries `cf-aig-metadata` (5 keys) with payload logging off | Both | 0.5 d | — |
| P4-4 | Email Routing on `rfq.micronshub.eu` (addresses `rfq@`, `replies@`; catch-all exists only on the apex, CF docs verified 2026-09-27) and `microns-mail`: raw MIME to `microns-private` `email/<message_id_sha256>/raw.eml`, `inbound_emails` row written by the mail Worker, hand-over to `microns-ops` through `OPS` with the named entrypoint `MailIngest` (`startIntake`, `ingestReply`); rows left `received` are restarted by the `*/10` dispatcher | Both | 1.25 d | — |
| P4-5 | `rfq-intake` Workflow (`RfqIntakeWorkflow`) + `RfqThread` DO: parse (quote stripping, type sniffing, ZIP entries streamed one at a time), triage, extract, classify CNC vs sheet metal, dedupe `customers` by e-mail (rows also come from trigger `on_auth_user_created_customer`, supabase/migrations/20260806_phase2_rls_per_user.sql:415), create the RFQ through `create_email_rfq`, copy files to `rfq/<rfq_id>/<file_id>-<name>`, enqueue `cad-jobs`, Telegram confirmation below 0.7 confidence; flag `agent.rfq_intake` | Claude | 2 d | H-28 |
| P4-6 | `CadRouter` DO (leases and backend health) and `cad-jobs` consumer (runs the job): STEP sheet metal through the existing unfold service (`POST /api/v1/unfold`, DXF output) until Phase 5, when the Container serves the same interface; DXF, STL and CNC STEP on an inline TypeScript backend ported from the edge-function parsers, with per-kind input caps (STEP 5 MB, DXF 3 MB, STL 0.75 MB) and one inline job per isolate; outputs to `cad/<job_id>/output/…` | Claude | 0.75 d | H-18 |
| P4-7 | `quote` Workflow (`QuoteWorkflow`): deterministic price draft from `pricing_rules` and material prices (a missing rate or price becomes a manual line), RAG over Vectorize `quotes-v1`, `waitForEvent` type `quote-approved` (7 d, reminder, 7 d), PDF (`pdf-lib`, Liberation Sans) to `quotes/<rfq_id>/v<version>/quote.pdf`, Resend send with `Reply-To: replies@rfq.micronshub.eu` and our own `Message-ID`, follow-ups, reply classification; "won" creates the order through `create_order_from_quote` (the rows the portal's Accept Quote writes); flag `agent.quote` | Claude | 2.5 d | — |
| P4-8 | Reply detection: `replies@` threading by `In-Reply-To`/`References` and the other rules of [AGENTS.md](AGENTS.md) §4 in the `agent-events` consumer; read-only Gmail poller for the 2 Workspace sender accounts (live 2026-09-30) inside the `*/10` dispatcher | Claude | 1 d | — |
| P4-9 | `post-order` Workflow (`PostOrderWorkflow`) + `MaterialStock` DO: traveller to `orders/<order_id>/traveler.pdf`, stock holds through the RPCs `stock_hold`, `stock_commit`, `stock_release` (truth in `stock_reservations`), supplier reorder draft with approval; flag `agent.post_order` | Claude | 1.25 d | — |
| P4-10 | Scrapers module (Europages, wlw) behind `agent.growth.scrapers` (off): robots.txt gate that fails closed, owner-recorded host permissions (`SCRAPER_PERMITTED_HOSTS`), Browser Rendering only for client-rendered pages of permitted hosts; parsers ported from `api/*` (unchanged) with a byte-equality test; with the flag off the Phase 2 handlers answer byte-identically; at most 6 concurrent connections | Claude | 0.75 d | — |
| P4-11 | Remote MCP: stateless `createMcpHandler` (Agents SDK, no Durable Object) in `microns-ops` on Custom Domain `mcp.micronshub.eu`; Cloudflare Access MCP server application with Managed OAuth, the Worker checks the Access assertion and maps the e-mail to a `user_roles` staff role; the 39 tools of the local server ported with a parity test, plus RFQ, quote, order, inventory, approval and agent-run tools; stages by flag `mcp.remote`; audit in `agent_runs` | Both | 1.25 d | — |
| P4-12 | Dashboard `RfqInboxPage` and `ApprovalsPage` (two lazy routes under `/dashboard`, staff-only nav entries, "not installed" state until P4-1 is applied); site endpoint `/api/agent/*` (`decision`, `status`, `flag`, `start`, `file`; never forwarded to Vercel); Telegram approval callbacks in `telegram-leads-bot` (from the live source of P0-5, plus `agent-callback.ts`) | Claude | 1 d | H-26 |
| P4-13 | Cost measurement: `agent_runs.cost_cents` from each response's `usage` and a versioned price table, Analytics Engine `microns_events`, AI Gateway logs filtered by `run_id` | Claude | 0.25 d | — |
| P4-14 | One real RFQ end to end with the approval gate; gate review | Both | 0.5 d | — |

File-level change list (as built):

| Change | Path | Note |
|---|---|---|
| New | `workers/mail/**` (`wrangler.jsonc`, `src/{index,headers,store,db,ingest}.ts`, tests, bundle check), `.github/workflows/cf-mail.yml` | `ALLOWED_RCPT` = `rfq@rfq.micronshub.eu,replies@rfq.micronshub.eu`; workflow on manual dispatch only |
| New | `workers/ops/src/{agents,workflows,do,cad,pricing,pdf,mail-in,mail-out,replies,mcp,scrapers,ports,cron,entrypoints}/**`, `workers/ops/src/db/**`, `workers/ops/src/queues/{cad-jobs,agent-events,directory-scan}.ts`, `workers/ops/src/routes/{agent,agent-admin}.ts` | Prompts (`src/agents/prompts/<agent>/<step>.v<N>.md` + schema, frozen by `LOCK.json`), PDF fonts (SIL OFL 1.1) |
| New | `workers/ops/eval/**`, `workers/ops/vitest.t2.agents.config.ts`, `scripts/eval/README.md` | Offline evaluation (`eval:synthetic`), T2 profile `agents` |
| New | `workers/shared/src/{agent-types,agent-api,limit}.ts`, `workers/shared/src/auth/scrape-rules.ts`, `workers/site/src/auth/agent-hmac.ts` | Cross-Worker contracts; relay signature check |
| New | `supabase/migrations/20261005_agent_layer.sql`, `supabase/rollback/20261005_agent_layer_down.sql`, `supabase/tests/agent_layer/**`, `.gitattributes` | — |
| New | `src/pages/dashboard/{RfqInboxPage,ApprovalsPage}.tsx`, `src/pages/dashboard/agent/*`, `src/utils/agentApi.ts`, `src/lib/agentDb.ts`, `src/types/agent.ts` | Under `/dashboard` (disallowed in `public/robots.txt`) |
| New | `supabase/functions/telegram-leads-bot/agent-callback.ts`, `tests/edge/**`, `tests/frontend-api/agent{Api,Db}.test.ts`, `tests/e2e/agent-dashboard.spec.ts`, `mcp-server/.gitignore` | — |
| Changed | `workers/ops/{wrangler.jsonc,package.json,src/index.ts,src/env.ts,src/app.ts,src/queues/messages.ts,scripts/check-bundle.mjs,README.md}`, `.github/workflows/cf-ops.yml` (header comment) | Workflows, DOs (tag `v1`), queues `cad-jobs` and `agent-events`, Vectorize `QUOTES_INDEX`, `AI`, `BROWSER`, `EVENTS`, `MCP_RATE_LIMIT`, Custom Domain `mcp.micronshub.eu`, two crons; every Phase 4 env field optional; `secrets.required` unchanged |
| Changed | `workers/shared/src/http/rpc.ts`; `workers/site/src/api/{resolve,router,forward}.ts`, `workers/site/src/auth/{gate,policy}.ts`, `workers/site/scripts/check-bundle.mjs` | Endpoint `agent`, machine principal `telegram`, action IDs AG-1…AG-7; site `Env` and `wrangler.jsonc` unchanged |
| Changed | `workers/ops/src/routes/{scan-directory,scrape}.ts` | One flag-on branch at the top; the Phase 2 code below unchanged |
| Changed | `src/App.tsx`, `src/components/dashboard/PersistentDashboardLayout.tsx` | Two lazy routes; two staff-only nav entries |
| Changed | `supabase/functions/telegram-leads-bot/index.ts` | Live v6 source plus one callback branch and the webhook secret-token rule |
| Changed | `mcp-server/README.md` | "Remote MCP" section; `mcp-server/src` unchanged |
| Changed | 8 Phase 2 test files (the extension points of [specs/PHASE4_SPEC.md](specs/PHASE4_SPEC.md) §7.2) | Phase 4 expectations added; every Phase 2 expectation as written |
| Changed (separate commit, after OW-6) | `src/integrations/supabase/types.ts` | Regenerated, UTF-8 |
| Untouched | `workers/site/src/seo/*`, `middleware/*`, `workers/site/src/redirects.ts`, `workers/site/src/sitemap.ts`, `api/*`, `lib/*`, `vercel.json`, root `package.json` and lockfile | Agent deploys never touch the SEO path; `api/*` moves only in Phase 6 |

Exit gate:

1. One real RFQ processed end to end (e-mail in → RFQ rows → CAD job → quote draft → approval → quote sent) with the approval gate exercised.
2. Cost per RFQ measured and recorded (AI Gateway + CAD minutes).
3. Every agent has a flag; switching it off stops new runs within 2 min (KV sync + propagation).
4. Every run has an `agent_runs` row with outcome and cost.
5. Parity diff on production unchanged (0 unexplained differences).

Rollback: per-agent flag off (≈ 1–2 min); disable the Email Routing rules for `rfq.micronshub.eu` and restore the previous RFQ mailbox routing (Q3); the migration is additive, so tables stay; the site's `/api/agent/*` rows stay inert without the ops routes.

Dependencies: Phase 3 gate for the deploys (the code was built right after the Phase 2 code; deploys and the Phase 3 gate are owner steps); Q3, Q20 (defaults DF-1, DF-2 below); Q21 only for the ops digest (Phase 5).

Risk refs: H-5, H-18, H-26, H-28.

Effort total: ≈ 14.5 d (plan: 2–3 weeks); the build specification estimates ≈ 15.75 d plus P4-14 (ports and decision core, inline CAD ports, local test infrastructure, Phase 2 test-pin extensions).

Build record (2026-10-07): the Phase 4 code is built and tested locally on top of the Phase 2 code; nothing is deployed, applied or uploaded. The build followed [specs/PHASE4_SPEC.md](specs/PHASE4_SPEC.md) (public sections; defaults §11, owner checklist §12). This section was brought in line with the build on that date under the owner's delegation of doc approval (§2, "Plan changes"). "Local" means T1 (vitest in Node) and T2 (`wrangler dev --local` with `microns-site`, `microns-ops` and `microns-mail` in front of provider stubs and a mini-PostgREST, profile `agents`); no Cloudflare account and no real provider was used.

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | One real RFQ end to end with the approval gate | **blocked** (local part passes) | Needs OW-1…OW-21, then P4-14. `npm --prefix workers/ops run test:integration:agents`: 11 files, 46 tests, green twice in a row; against stubs: mail → `inbound_emails` → intake card → confirmation → RFQ with file → CAD job → quote draft → approval → one mail with PDF, `Reply-To` and `Message-ID`; approvals by a relay-signed Telegram code and by the dashboard; a failure card's Retry restarts the run from the failed step |
| 2 | Cost per RFQ measured | **blocked** (local part passes) | Needs the gateway (OW-2, OW-10). `closeRun` writes `cost_cents` > 0 whenever a call returned usage (kernel tests); `npm --prefix workers/ops run eval:synthetic`: 37 recorded cases through the production adapter, ok 97.3 %, cost per prompt printed |
| 3 | Every agent has a flag; off stops new runs within 2 min | **partial (local)** | 13 canonical flags seeded off; flag reads fail closed with `cacheTtl` 30 s; mirror tick and write-through tested in T2; with the flag off a mail stays `received` and no instance starts. The 120 s check on production is OW-23 |
| 4 | Every run has an `agent_runs` row with outcome and cost | **partial (local)** | Every Workflow, consumer, cron unit and MCP call opens and closes a run (unit suites, T2 row checks); the exit-gate query of the build specification §10 runs on the final schema (SQL tests). Production check after P4-14 |
| 5 | Parity diff on production unchanged | **blocked** (local part passes) | Production answers 429 here (Q1); owner run OW-23. SEO path files unchanged since the Phase 2 close; `node tests/middleware/smoke.mjs`: 323 route decisions equal; parity tool tests 94/94; site bundle guard finds no agent package or ops source |

Other checks of the same run (2026-10-07):

| Check | Result |
|---|---|
| T1 | shared 402, site 1,322, ops 1,159 (19 opt-in tests skipped), mail 25; agent frontend helpers 35, Telegram relay 21; typecheck clean in all four packages |
| SQL | `supabase/tests/agent_layer`: 572 assertions on Postgres 18.3 and on 16.4 (PGlite); RPC parity with the in-memory RPCs 95/95 |
| Phase 2 unchanged | T2 profile `api`: site 52, ops 4, as at the Phase 2 close; Phase 2 test files changed only at the 8 extension points |
| Bundles | `microns-site` 3,383.82 KiB (gzip 732.56 KiB), no agent input; `microns-ops` upload 9,657.36 KiB (gzip 2,307.86 KiB), one copy each of `pdf-lib`, `@supabase/supabase-js` and `zod`; `microns-mail` 17.15 KiB (gzip 5.63 KiB), no npm package; limit 64 MiB uncompressed |
| Remote MCP | `mcp-server` builds; parity of the ported tools 3/3 |
| Vercel side | `vercel.json`, `middleware*`, `api`, `lib`, `index.html`, `vite.config.ts`, root `package.json` and lockfile unchanged; `npx vite build` keeps the same 215 HTML files and adds only the lazy chunks of the two pages |
| Scans | Secret-pattern and public-wording scans over the 474 added or changed files: no hit |

Deviations from this section and from [AGENTS.md](AGENTS.md) as first written (DC-n = [specs/PHASE4_SPEC.md](specs/PHASE4_SPEC.md) §11.3; AGENTS.md, ARCHITECTURE.md and [wrangler.jsonc.draft](wrangler.jsonc.draft) are corrected on the same date):

| # | Planned | Built | Why |
|---|---|---|---|
| DC-1 | P4-11 `MicronsMcp` (`McpAgent`) Durable Object with binding `MCP_OBJECT` in tag `v1`; secrets `MCP_OAUTH_*` | Stateless `createMcpHandler`, no DO; Access Managed OAuth, no OAuth secrets in the Worker | `McpAgent` is deprecated and feature-frozen (CF docs, fetched 2026-10-03) |
| DC-2 | `microns-mail` `OPS` binding without entrypoint | `"entrypoint": "MailIngest"` (`startIntake`, `ingestReply` only) | The mail Worker can never present a caller to the `/api` path |
| DC-3 | `analyse` = `POST /api/v1/unfold/info`; `CadRouter.submit` runs jobs; the quote waits for drawing jobs | `POST /api/v1/unfold` with DXF output; the router grants leases and the consumer runs the job; drawings not awaited | Keeps CPU out of the single-threaded DO; the flat DXF comes from `analyse` |
| DC-4 | Drawing PDFs attached to the quote mail | Not attached by default (`value.attach_drawings` false) | Smaller mails; the AGENTS.md wording was ambiguous |
| DC-5 | `materials` supplier, lead-time and kerf columns; `stock_transactions.order_id` | Supplier from `catalog_materials`; kerf factor as a pricing rule; `stock_transactions.reference_type` / `reference_id` | The live columns differ from the inventory migration (live 2026-10-03) |
| DC-6 | Event list; LLM step timeout 2 min; poller runs under `quote` | + event `agent-resumed`; 3 min for `extract`; agent key `quote.reply_poller` | Parked runs; document input; separate run rows |
| DC-7 | Schema sketch (AGENTS.md §7): raw approval token, `_synced_at` KV cursor, `idempotency_key` unique | Reconciled DDL in the migration: token hashes only, revision columns, unique per (`agent`, `idempotency_key`) | A table read cannot forge a decision; exact mirroring |
| DC-8 | `supabase/migrations/20260401_create_inventory_system.sql` describes the live `materials` table | Schema-drift note for P0-4 / Phase 6 | The live table was created from another definition |
| DC-9 | Decision body `{token, verb, …}` for both channels | Dashboard `{v, run_id, token_sha256, verb, edits?, note?}` under a staff JWT; relay `{v, token, code, tg}` with signed headers | The database stores only hashes |
| DC-10 | MCP write idempotency `mcp:<session>:<request>`; remote tool list | Arguments digest + 10-minute bucket; + `list_inbound_emails`, `list_pending_approvals`, `start_quote`, `mcp_status` | Stateless transport; dashboard parity |
| DC-11 | P4-12 file list: two pages and `App.tsx` | + nav layout, `src/utils/agentApi.ts`, `src/lib/agentDb.ts`, `src/types/agent.ts`, `src/pages/dashboard/agent/*`, `agent-callback.ts` | Reachable navigation; testable helpers and relay |
| DC-12 | `scan_directory` / `run_saved_search` use Browser Rendering on Europages and wlw | New fetch paths follow the robots gate and owner-recorded permissions (OW-24) | Third-party terms decide |
| DC-13 | Endpoint actions `decision` and `file` | + `status`, `flag`, `start` | Dashboard parity with Telegram; the SPA probes the Worker API first |
| DC-14 | "Two bots" (INVENTORY.md) | One token for both functions, one webhook | Live configuration |
| DC-15 | Product names "Email Routing", "Browser Rendering" | Cloudflare now titles them Email Service and Browser Run; the names stay in these docs | Behaviour unchanged |
| DC-17 | `api.forward_to_vercel` forwards every `/api/*` path | `/api/agent/*` is never forwarded | Vercel has no such route |
| DC-18 | P4-3 creates the `translate` route | `translate` is created in Phase 5 (P5-2) | Its first caller is built there |
| DC-19 | P4-3 "budget and rate limits per Q20" | Spend limit with alerts; no gateway rate limit; per-agent daily cap instead (DF-80, DF-83) | A rate-limit 429 would park runs that need no human |

DC-16 concerns a working note of the build, not a repository document.

Defaults chosen for the owner (DF-1…DF-84, built as listed in [specs/PHASE4_SPEC.md](specs/PHASE4_SPEC.md) §11.1; each can be changed before the step named there). Owner-sensitive (customer-visible or money):

| # | Decision | Default built | Decide before |
|---|---|---|---|
| DF-42 | VAT on quote drafts | Shown as "to be confirmed", manual line; the quote PDF keeps today's intra-Community notice | `agent.quote` on (OW-18) |
| DF-43 | Order total on "won" | The portal's Accept Quote formula: (Σ part totals + shipping) × 1.24, currency from the RFQ (EUR default) set explicitly | `agent.quote` on |
| DF-81 | Inline CAD limits | STEP ≤ 5 MB, DXF ≤ 3 MB, STL ≤ 0.75 MB, one inline job per isolate; larger non-sheet-metal files become manual-price lines; STEP sheet metal up to 50 MB goes to the unfold service | First agent CAD job (OW-11) |

| Area | Defaults | Built as |
|---|---|---|
| Plan questions | DF-1 (Q3), DF-2 (Q20), DF-3 (Q22), DF-4 (Q11), DF-5 (Q18) | `rfq.micronshub.eu` with a shadow copy to today's mailbox (`MAIL_COPY_TO`); €50/month gateway spend limit, alerts at 50 % and 80 %; no Mac mini backend (`mac_mini` kept as a backend name); agents read inputs from R2 only; security detail outside the repository |
| Data layer | DF-6…DF-22, DF-34, DF-73, DF-84 | `has_staff_role()` (`is_staff()` unchanged); token hashes only; per-row revision mirror; seeding rules; flags never deleted; run rows only on change or failure; `cacheTtl` 30 s; seeds all off (intake `shadow`, quote and post-order `assist`); `pricing_rules` uniqueness with kerf as a rule key; full unique constraints; guard trigger; `create_email_rfq` as invoker; `stock_*` RPCs; `body_excerpt` ≤ 4,000 chars; retention by `agent_retention_purge()`; file name with the build day; `types.ts` gate; backend value `inline`; agent file paths `<rfq_id>/<file_id>-<name>`; dry run with `ROLLBACK` first |
| Mail and LLM | DF-23…DF-32, DF-41 | Mail Worker writes the row; DO `migrations` tag `v1`; BYOK; provider-native endpoint; `claude-sonnet-5-5` / `claude-haiku-4-5` / bge-m3; refusal fallback; payload logging off; `extract` 3 min, `classify` 1 min; sender `MicronsHub Quotations <info@micronshub.eu>`; both Message-IDs stored; no cache marker on Haiku prompts |
| CAD, quote, PDF | DF-33, DF-35, DF-36, DF-40, DF-44…DF-46 | Inline backend for DXF, STL, CNC; drawings not attached; follow-ups approved once with the cover mail; one vector per quote line; Liberation Sans; approved prices written back to the RFQ; rates only from owner-entered rows |
| Replies, post-order | DF-37…DF-39, DF-47 | No Gmail token write-back; no `inv-*` through `MaterialStock`; signed partner links ≤ 7 days; shadow copy of every accepted mail |
| Remote MCP | DF-48…DF-56 | Stateless handler; exact package pins; Access Managed OAuth + `agent_staff_for_email`; `https://mcp.micronshub.eu/mcp`; stages off → read → writes → named opt-ins; long jobs on `scrapes`; ported tools with a parity test; no `api_base_url` arguments; one audit row per call, e-mails masked in list tools |
| Dashboard and relay | DF-57…DF-67, DF-74 | Hash under a staff JWT on the dashboard; status probe before any action; `status`, `flag`, `start`, `file` actions; never forwarded; untyped accessor until `types.ts` is regenerated; polling 30 s / 60 s; live v6 relay base; `ap:<token>:<code>`; ops edits every card; approval callbacks only from the owner; webhook secret token before the relay deploy; no `edit` verb, actors `user:<uuid>` / `telegram:<id>` |
| Scrapers | DF-68…DF-71 | robots.txt enforced, fail closed; browser only for client-rendered pages of permitted hosts; parsers ported; envelope `DirectoryScanMessage` on `scrapes` |
| Runtime and tooling | DF-72, DF-75…DF-80, DF-82, DF-83 | Phase 4 secrets optional at deploy; `pdf-lib` and supabase-js from the root install (one copy); sanitised SQL harness; vitest runners for eval and parity; tenant var `AGENT_TENANT_ID`; Phase 5 names kept (`readFlag`, `AgentKey` in `agents/runs.ts`, asynchronous `anthropicFor`); daily cap 200 runs per agent; failed Workflow runs wait on a failure card (closed after 14 days); no gateway rate limit |

New names (built as proposed; renamed only before the first deploy): entrypoint `MailIngest`; ops vars `AGENT_TENANT_ID`, `QUOTE_FROM`, `QUOTE_REPLY_TO`, `MESSAGE_ID_DOMAIN`, `CAD_BACKEND_DEFAULT`, `MCP_HOSTNAME`, `MCP_ROUTE`, `MCP_ACCESS_AUD`, `SCRAPER_USER_AGENT`, `SCRAPER_PERMITTED_HOSTS` (test-only vars never in a production config); mail var `AGENT_TENANT_ID`; secrets `AI_GATEWAY_TOKEN`, `CAD_UNFOLD_URL`, optional `CAD_ACCESS_CLIENT_ID` / `CAD_ACCESS_CLIENT_SECRET` (ops), `MAIL_COPY_TO`, `MAIL_FALLBACK_TO` (mail), `AGENT_APPROVAL_SECRET` (site, ops, Supabase function), `TELEGRAM_WEBHOOK_SECRET`, `AGENT_DECISION_URL` (Supabase function); binding `MCP_RATE_LIMIT` (namespace `2004`); database functions `has_staff_role`, `create_email_rfq`, `agent_run_begin`, `agent_run_claim_approval`, `stock_hold`, `stock_commit`, `stock_release`, `agent_retention_purge`, `feature_flags_*` (5), `create_order_from_quote`, `agent_staff_for_email`, trigger `agent_columns_guard`, columns `quote_workflows.drafts`, `quote_workflows.pdf_sha256`, `agent_runs.parked_reason`; agent keys `quote.reply_poller`, `cad`, `eval`, `mcp`, `flags`, `growth.scrapers`; Workflow event `agent-resumed`; queue envelope `DirectoryScanMessage`; run errors `daily_cap`, `restart_failed`, `config_missing`; CAD warning `inline_too_large`; R2 prefix `eval/golden/`; Access application `microns-mcp` (and, only with the network path chosen at OW-11, a CAD application with service token `microns-machine-cad`).

Owner steps (OW-1…OW-26 of [specs/PHASE4_SPEC.md](specs/PHASE4_SPEC.md) §12, after the merge and the Phase 3 gate; Claude prepares commands and checks, every new credential goes onto the P0-2 checklist the day it is created):

| Order | Steps | Detail |
|---|---|---|
| 1 | OW-1 | Review the defaults (DF-42, DF-43, DF-81 above), approve the names; confirm that no Supabase Git integration applies `supabase/migrations/*` on merge |
| 2 | OW-2…OW-5 | AI Gateway `microns` (authentication on before a provider key is stored, Run token as `AI_GATEWAY_TOKEN`, BYOK, logs with payload logging off, spend limit); queues `cad-jobs`, `agent-events`; Vectorize `quotes-v1` with its metadata indexes before any insert; KV id and Access team domain in `workers/ops/wrangler.jsonc`; zone ready for `mcp.micronshub.eu` |
| 3 | OW-6 | Migration on live Postgres 15.8: dry run with `ROLLBACK`, then the file; post-apply checks; Claude regenerates `types.ts` |
| 4 | OW-7, OW-8 | Secrets for ops, mail and site; deploy `microns-ops`, then `microns-mail`, then the site; CI token permissions for Vectorize and Custom Domains |
| 5 | OW-9, OW-12 | Email Routing on `rfq.` (verified destinations, rules `rfq@` and `replies@`, one test mail, then the trusted `authserv-id` is pinned in code); R2 lifecycle rule on `email/` (90 days) |
| 6 | OW-10, OW-11 | Preview checks of the gateway and of one test quote mail; unfold service key and network path before the first agent CAD job |
| 7 | OW-13, OW-14 | Pricing rows and material prices; review of the sample PDFs and the font licence, before `agent.quote` is enabled |
| 8 | OW-15…OW-17, OW-20 | Access MCP application and connector checks (stage 1, writes after 2 weeks); Telegram webhook secret, function secrets, relay deploy and a test card |
| 9 | OW-18, OW-19, OW-21, OW-24, OW-25 | Flags stage by stage (`auto` never for prices or partner sends); golden set and one live evaluation before `assist`; monthly retention purge until Phase 5; directory permissions before any scraper flag; Gmail reconnect when a card asks |
| 10 | OW-22, OW-23, OW-26 | P4-14, exit gates 3 and 5 on production, gate sign-off |

### 5.5 Phase 5: consolidate compute

Goal: schedulers and long-running jobs move from pg_cron, Supabase Edge Functions, GitHub Actions and the VPS to Cloudflare, job by job, with output parity and a re-activation rollback.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P5-1 | Reconcile edge functions (Q6): re-sync the repo from the live sources where live is ahead (built: `generate-daily-article`, `translate-article`, `hn-collector`; `telegram-leads-bot` was re-synced in P4-12) and add the four live-only `gsc-*` functions (DV5-20); delete dead functions after a log check (OW5-14), then remove the four dead sender folders and their `config.toml` sections in a later commit (DV5-22). Count corrected to 41 deployed / 16 live-only (DV5-8) | Both | 0.5 d | H-26 |
| P5-2 | `content-daily` Workflow (`ContentDailyWorkflow`) at 07:00 UTC (replaces `enqueue-daily-article` 07:00, `process-article-queue` */5, `auto-translate-daily-articles` 08:00, `auto-fix-article-links` 08:30, `auto-update-sitemap` 09:00; live 2026-09-30) with Queue `translations` per language (plus a backfill of at most 5 per language and day, D-10), a full fix-links pass (DV5-5), `sitemap` Workflow (`SitemapWorkflow`) and IndexNow per new translation (DV5-4). As built the sitemap Workflow writes the same Supabase Storage object the site serves, with a shadow copy in R2, and `workers/site/src/sitemap.ts` is unchanged (DV5-1); article model and prompt as live (D-6); translations through the live Gemini chain on AI Gateway route `translate` (D-7); flag `agent.content_daily` | Claude | 2 d | H-12, H-19 |
| P5-3 | Collectors on the schedule table of the every-minute tick (DV5-2) + Queue `scrapes` (own Phase 5 envelope, D-27): reddit tier1 */15, tier2 */30, tier3 hourly; hn */30; tenders 06:00 (one message per due connector, `api/tender-scan.js` run unchanged); flags `agent.growth.reddit`, `agent.growth.hn`, `agent.growth.tenders` | Claude | 1 d | H-29 |
| P5-4 | Marketing: new `/api/marketing` action `send-campaign` (gate MK-8, STAFF; DV5-9) → Queue `outbound-mail` with `SenderLimiter` DO; the dashboard calls it first and falls back to the edge function only on an answer that proves the route is absent or paused (§9 of the build specification); `process-followups` and `process-warmup` ported but off (vars, DV5-11; not live today, C5) | Claude | 1 d | — |
| P5-5 | Xometry scanner per Q8 (default built: TypeScript port on the schedule table at the current UTC hours, .github/workflows/xometry-scan.yml:21; HTTP 401/403 → alert, scans pause until the token changes, daily reminder; persistence through PostgREST, no Hyperdrive, DV5-15); flag `agent.growth.xometry` | Claude | 1.25 d | — |
| P5-6 | `microns-cad` Container (`CadContainer`, exported by `microns-ops`, DV5-21) from `sheet-metal-service/Dockerfile`, prebuilt and pushed by `cad-image.yml` (DV5-14); `CadRouter` gains container slots and priorities and switches from the VPS at S9; shared secret `CAD_SHARED_SECRET` required on every non-health route and an enforced wall clock in `sheet-metal-service/main.py` (`PROCESSING_TIMEOUT` 120 s, sheet-metal-service/config.py:37); `/flat-pattern` equal after masking the values the service randomises (DV5-17); Supabase secret `UNFOLD_SERVICE_URL` repointed to the site path `/api/cad/<token>/flat-pattern` (DV5-18); keep-warm off (DV5-16) | Both | 1.5 d | H-18 |
| P5-7 | `ops-digest` Workflow (`OpsDigestWorkflow`) Mondays 06:30 UTC; Google Ads offline conversions not built (Q21 default); queue health from failed `agent_runs` rows (DV5-7); flag `agent.ops_digest` | Claude | 0.75 d | — |
| P5-8 | Switch-over, one job at a time (S1–S9, at least 24 h apart): the step's flag value set and its pg_cron jobs deactivated (`active = false`) in the order the runbook gives, by the reviewed SQL file with session settings; the GitHub Action schedule is skipped through the repository variable `XOMETRY_SCAN_SCHEDULE` (manual dispatch kept, DV5-13); every ported job writes its outcome to `agent_runs` | Both | 0.5 d | H-29 |
| P5-9 | 7-day output parity and sign-off; afterwards unschedule the deactivated pg_cron jobs, which removes the embedded service credentials from `cron.job` | Both | 0.5 d | H-7 |

File-level change list (as built):

| Change | Path | Note |
|---|---|---|
| New | `workers/ops/src/cron/{schedule,run-schedule}.ts`, `workers/ops/src/queues/{scrapes-p5,translations,outbound-mail}.ts`, `workers/ops/src/ports/p5.ts`, `workers/ops/src/ports/p5-stub/*`, `workers/ops/vitest.t2.jobs.config.ts` | Schedule table on the existing every-minute tick (DV5-3); Phase 5 ports with T1 fakes; T2 profile `jobs` |
| New | `workers/ops/src/workflows/{content-daily,sitemap,ops-digest}.ts`, `workers/ops/src/{content,collectors,xometry,marketing,digest,cad-container}/**`, `workers/ops/src/do/sender-limiter.ts`, `workers/ops/src/routes/{marketing-send,cad-compat}.ts` | Content prompts frozen in `src/content/prompts/` with their own `LOCK.json`; the digest prompt follows the Phase 4 convention (`src/agents/prompts/ops_digest/`) |
| New | `workers/ops/scripts/xometry-golden/gen_golden.py`, `workers/ops/test/{p5,t2-jobs,oracles}/**`, `workers/ops/test/fixtures/{collectors,xometry}/**` | Xometry: 72 of the 95 Python test functions ported, 23 recorded as not applicable; 388 golden assertion units generated by the Python code |
| New | `workers/cad/{README.md,parity/**}` | README and parity tool only; no npm package (DV5-21) |
| New | `workers/site/src/auth/cad-compat.ts`, `src/utils/campaignSend.ts`, `tests/frontend-api/campaignSend.test.ts` | Compat token check; campaign send with fallback |
| New | `sheet-metal-service/{requirements.lock.txt,tests/test_p5_service.py}`, `.github/workflows/cad-image.yml` | Lock file provisional until the VPS freeze (OW5-11) |
| New | `supabase/migrations/20261008_{deactivate,unschedule}_ported_crons.sql`, `supabase/tests/phase5/**`, `scripts/phase5/{parity.sql,flag-values.sql,compare-sitemap.mjs,README.md}` | Both SQL files change nothing without their session settings; the second runs only after the signed gate |
| New | `supabase/functions/gsc-{sitemap-sync,performance,index-url,inspect-url}/index.ts` | Copied from live (Q6, DV5-20) |
| Changed | `workers/ops/{wrangler.jsonc,package.json,package-lock.json,README.md}`, `workers/ops/src/{index,env,app}.ts`, `workers/ops/src/queues/messages.ts`, `workers/ops/src/agents/{runs,prices}.ts`, `workers/ops/src/agents/prompts/registry.ts`, `workers/ops/scripts/check-bundle.mjs` | Queues `translations`, `outbound-mail`; three Workflows; DOs `SenderLimiter`, `CadContainer` (tag `v2`); container `microns-cad`; KV `SEO_CACHE`; ten vars; `@cloudflare/containers` 0.3.7; crons unchanged; every Phase 5 env field optional; `secrets.required` unchanged |
| Changed | `workers/ops/src/cad/{types,registry}.ts`, `workers/ops/src/cad/backends/{http-unfold,container}.ts`, `workers/ops/src/do/cad-router.ts`, `workers/ops/src/queues/cad-jobs.ts` | Container slots, priorities and recycle; outcome mapping of the service answers |
| Changed | `workers/shared/src/http/rpc.ts`; `workers/site/src/api/{resolve,router,forward}.ts`, `workers/site/src/auth/{gate,policy}.ts`; `workers/ops/src/routes/marketing.ts` | Endpoint and machine `cad-compat`; action IDs MK-8, CD-1; `/api/cad/*` never forwarded; one dispatch branch; site `env.ts` and `wrangler.jsonc` unchanged |
| Changed | `src/components/dashboard/marketing/{CampaignWizard,CampaignsTable}.tsx` | The two edge-function calls become `startCampaignSend(id)` |
| Changed | `sheet-metal-service/{main.py,config.py,Dockerfile}` | Key on every non-health route, fork-per-request wall clock; amd64 base pinned by digest, lock file, `PYTHONHASHSEED=0`; endpoint bodies unchanged |
| Changed | `supabase/functions/{generate-daily-article,translate-article,hn-collector}/index.ts` | Re-synced from live (Q6) |
| Changed | `.github/workflows/xometry-scan.yml` | Job-level `if:` on the repository variable; schedule and `workflow_dispatch` kept (DV5-13) |
| Changed | 9 Phase 2 and Phase 4 test and harness files (the extension points of [specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) §3.2) | Phase 5 expectations added; every earlier expectation as written |
| Deleted (later commit, after OW5-14) | `supabase/functions/{send-confirmation-email,send-notification-email,send-rfq-confirmation-email,send-internal-rfq-notification-email}/`, their `supabase/config.toml` sections and three sections without a function | After the owner has deleted the deployed functions (DV5-22) |
| Untouched | `workers/site/src/sitemap.ts`, `api/sitemap.js` (DV5-1); `supabase/functions/{create-partner-auth-user,update-partner-password,send-user-email,xometry-review,leads-api,post-to-social-media,telegram-leads-bot,telegram-tenders-bot,extract-flat-pattern,generate-manufacturing-pdf}`; `xometry-bot/**`; `vercel.json`, `middleware*`, `api/*`, `lib/*` | Stay on Supabase (README §7 item 2); the two CAD edge functions are not redeployed, only their secret changes at S9 (D-26); the Python bot stays the rollback path |

Exit gate (outputs, not cron status, because of H-29; pass rules and queries in `scripts/phase5/parity.sql`, mapping in [specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) §12):

1. For 7 consecutive days: articles published per language per day ≥ the pre-switch 7-day baseline; translation lag for cs/da/fi/hu/nb/pl/sv/pt falls every day (19 days today, live 2026-09-30). As built the check is that missing translations fall every day to 0 and every new article has its 13 translations within 24 h (Q1–Q3, Q10), because the baseline of the lagging languages is 0.
2. Sitemap regenerated daily; its URL set equals the published rows; headers unchanged (Q4; SEO parity probes of the served files).
3. Leads and tenders inserted per day within the normal range of the prior 7 days; Xometry offers upserted on schedule. As built (DV5-12): HN at least the prior-week minimum; tenders scanned on schedule, or within the prior 7-day range when the S3 re-measurement finds tenders already flowing; reddit 0 accepted; every Xometry slot has a run with an outcome (Q5–Q7, Q13).
4. `/flat-pattern` returns the same output as the VPS for 5 reference STEP files after masking the values the service randomises itself (DV5-17); Container cold start measured.
5. Every ported run has an `agent_runs` row with outcome; none stays `running` beyond its agent's limit (Q8).
6. Old schedulers disabled, not deleted, for the whole window (Q9; repository variable with the workflow file present; VPS on its old image with the old `UNFOLD_SERVICE_URL` value kept).

Rollback (per step, ≈ 5–15 min; last column of the runbook below): flag off and the step's SQL with `reactivate` (pg_cron jobs active again); repository variable `XOMETRY_SCAN_SCHEDULE` deleted; `UNFOLD_SERVICE_URL` back to its old value and `CAD_BACKEND_DEFAULT = "vps"`; marketing `OUTBOUND_MAIL_PAUSED = "true"` (the dashboard falls back to the edge function) or `OUTBOUND_MAIL_STOPPED = "true"` (no campaign mail at all). After P5-9 a pg_cron rollback needs a new `cron.schedule(…)` per job with a credential issued at P6-1, which is why unscheduling waits for the signed gate.

Dependencies: Phase 4 gate (`agent_runs`, `feature_flags`); P0-4, P0-5; Q2, Q6, Q8, Q21, Q22 (defaults below).

Risk refs: H-7, H-12, H-17, H-18, H-19, H-26, H-29.

Effort total: ≈ 9 d + the 7-day window (plan: 1–2 weeks); built as seven units in parallel on one kernel.

Build record (2026-10-09): the Phase 5 code is built and tested locally on top of the Phase 4 close (commit 9c49e92); nothing is deployed, applied, uploaded or switched, and no flag or secret is set. The build followed [specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) (public sections; defaults §1, owner checklist and runbook §10, deviations §11.1). This section was brought in line with the build on that date under the owner's delegation of doc approval (§2, "Plan changes"). "Local" means T1 (vitest in Node) and T2 (`wrangler dev --local` with `microns-site` and `microns-ops` in front of provider and source stubs and a mini-PostgREST, profile `jobs`; the container is replaced by a stub); no Cloudflare account, no Docker and no real provider was used.

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | Articles and translation lag | **blocked** (local part passes) | Needs OW5-1…OW5-14, S5 and 7 days. T1: sitemap and link rewrites equal to the live builders, prompts byte-equal to the live templates (lock test), live parser on recorded answers, Gemini chain fall-through, consumer idempotency, backfill planning; T2 `p5-content`: one full day with backfill, and the 6 h wait-timeout path in its own harness (BA5-2) |
| 2 | Sitemap | **blocked** (local part passes) | S4 shadow day with `scripts/phase5/compare-sitemap.mjs`. XML byte-equal to the live v19 builder for a 300-article fixture; regression guard and the one-time drop acceptance tested (BA5-3); served path unchanged (`workers/site/src/sitemap.ts`, `api/sitemap.js`); parity tool tests 94/94 |
| 3 | Leads, tenders, Xometry | **blocked** (local part passes) | S1–S3, S8. Scoring tables equal to the live rules; alert bytes equal to the live texts; no alert for an existing row; one tender child run per connector; the 72 ported Xometry tests and 388 golden units; T2: a 401 page alerts and records `auth: 'rejected'`, the next slot with the same token is `skipped` without a call |
| 4 | `/flat-pattern` and cold start | **blocked** | Needs the image push (OW5-10), the VPS freeze (OW5-11) and the gate procedure at S9 ([workers/cad/README.md](../../workers/cad/README.md)). Local: key matrix, 504 at the wall clock, the 5 references equal to the provisional golden manifest after masking, the comparator reports `DIFFERS` for a 0.01 mm change; three wiring tests against the real `@cloudflare/containers` 0.3.7 |
| 5 | Run rows | **partial (local)** | Every scheduled or queued unit writes one `agent_runs` row with an outcome (dispatcher over a simulated week of 10,080 minute ticks; consumer and Workflow suites); Q8 with the per-agent limits runs on PGlite. Production check during the window |
| 6 | Old schedulers disabled, not deleted | **blocked** (local part passes) | Deactivation and unschedule SQL tested on PGlite (Postgres 18 and 16) against a pg_cron stand-in: no settings → no change, per-step deactivate and reactivate, target-path check, unschedule only with the signed gate; `xometry-scan.yml` keeps manual dispatch |

Other checks of the same run (2026-10-09):

| Check | Result |
|---|---|
| T1 | shared 402, site 1,351, ops 2,038 (19 opt-in tests skipped); frontend helpers 147; typecheck clean in shared, ops and site |
| T2 | profile `jobs`: 7 files, 27 tests; Phase 2 profile `api`: site 52, ops 4 (unchanged); Phase 4 profile `agents`: 11 files, 46 tests (unchanged) |
| SQL | `supabase/tests/phase5`: 138 assertions on PGlite 18.3 and 16.4; `supabase/tests/agent_layer`: 572 |
| Phase 2 and 4 unchanged | Earlier test files changed only at the 9 extension points, none deleted; Phase 1 smoke and `eval:synthetic` pass |
| Bundles | `microns-site` 3,387.53 KiB (gzip 733.54 KiB); `microns-ops` upload 10,073.45 KiB (gzip 2,420.78 KiB), one copy of `@cloudflare/containers`, no T2-only var in the production config; the dry run builds with the `containers` stanza without Docker |
| Vercel side | `vercel.json`, `middleware*`, `api`, `lib`, `index.html`, `vite.config.ts`, root `package.json` and lockfile, `public/robots.txt` unchanged; `npx vite build` keeps the 213 `index.html` files (210 prerender routes) |
| Scans | Secret-pattern scan (positive self-test first) over every added or changed file: one hit, reviewed: the PEM header pattern in `supabase/functions/gsc-index-url/index.ts`, a copy of the live function that strips the header line from a key it reads at runtime; it holds no key material |
| Not run here | The Docker image build (CI only, `cad-image.yml`); the root `npm test` (jest not installed, as at the Phase 4 gate) |
| Frontend types | `CampaignWizard.tsx` keeps the 14 type errors it had before Phase 5 (the generated Supabase types lack `marketing_sender_accounts`); Phase 5 adds none; they are expected to clear when the types are regenerated |

Deviations from this section and from [AGENTS.md](AGENTS.md) as first written (DV5-n = [specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) §11.1; AGENTS.md, ARCHITECTURE.md and [wrangler.jsonc.draft](wrangler.jsonc.draft) are corrected on the same date):

| # | Planned | Built | Why |
|---|---|---|---|
| DV5-1 | Sitemaps written to `microns-private` and served from R2; `workers/site/src/sitemap.ts` changed | Supabase Storage stays the served source; R2 shadow copy; `sitemap.ts` unchanged; the reader switch moves to P7-5 or Phase 6 | The served bytes keep the Phase 1 path under the SEO parity gate; rollback is one pg_cron job |
| DV5-2 | One Cron Trigger per schedule, uncommented one at a time | A schedule table evaluated by the existing every-minute tick; each job gated by its flag and idempotent per slot; crons unchanged | Works under both readings of the Cron Trigger limits; switch-over and rollback are flag flips (≤ 2 min) instead of deploys |
| DV5-3 | `workers/ops/src/cron/{collectors,marketing}.ts` | `cron/{schedule,run-schedule}.ts`, `collectors/*`, `marketing/*`, `queues/scrapes-p5.ts` | One owner per file |
| DV5-4 | IndexNow in one `content-daily` step | One submission per new translation in the consumer | As live |
| DV5-5 | Fix-links for the day's `translation_id` only | Full pass over every non-English article, paged, one step per language | The live job runs `fix_all` daily |
| DV5-6 | Generation failure → no fan-out; a language failing 5 times → card with Retry | A failed generation still fans out the backfill; a final language failure → one plain-text alert, and the next daily backfill queues it again | D-10, D-28 |
| DV5-7 | DLQ depth read from the Cloudflare API for the digest | Final failures recorded in `agent_runs`; no Cloudflare API token | No new credential |
| DV5-8 | 40 deployed edge functions, 15 out of the repo (§9 Q6, P0-5) | 41 deployed, 16 live-only | Live list (INVENTORY.md §5 count note) |
| DV5-9 | P5-4 names only the queue and the DO | New action `send-campaign` (MK-8) and a frontend change with fallback | The buttons call the edge function directly today |
| DV5-10 | `content-daily` "replaces" `enqueue-daily-article` | The jobs are replaced; the database functions and `article_generation_queue` are kept and called | Same title choice and queue history as live (D-21) |
| DV5-11 | A flag for every job | Follow-ups, warm-up, pause and stop are vars | No marketing flag exists in the canonical list |
| DV5-12 | Gate item 3 as first written | Tenders: connectors scanned on schedule, or the prior range when S3 finds tenders flowing; reddit 0 accepted; Xometry: one outcome per slot | The prior ranges are 0 (F5-9, F5-13) |
| DV5-13 | Xometry Action schedule removed | Schedule kept behind the repository variable `XOMETRY_SCAN_SCHEDULE` until P6-6 | Merging changes nothing; rollback is a variable flip |
| DV5-14 | Container image from the Dockerfile path | Prebuilt image referenced by registry tag; new workflow `cad-image.yml` | Ops deploys need no Docker; the tested image is the deployed one |
| DV5-15 | Optional Hyperdrive `SUPABASE_DB` for Xometry | Not created; three PostgREST requests per offer | No database password outside Supabase |
| DV5-16 | Keep-warm ping in business hours; cold start 10–30 s | Keep-warm off (`CAD_KEEP_WARM = "off"`), no active container probe; cold start measured at the gate | A probe would wake and bill a sleeping instance; COSTS.md §5 |
| DV5-17 | `/flat-pattern` "byte-identical" | Equal after masking only the values the service randomises itself (DXF dates, GUIDs, marker, `CLASSES` order; PDF dates, `/ID`, drawing date) | Two calls on one machine already differ in exactly these fields |
| DV5-18 | `UNFOLD_SERVICE_URL` repointed to the Container | Repointed to the site path `/api/cad/<token>/flat-pattern`, which reaches the Container through `microns-ops` (CD-1, secret `CAD_COMPAT_TOKEN`) | The two edge functions stay untouched; the path supplies the authentication |
| DV5-19 | Names not in the canonical lists | Proposed names below; listed in a canonical addendum once approved | — |
| DV5-20 | Q6 "keep `gsc-*` if a caller exists" | Kept and added to the repository until the owner confirms a caller (OW5-20) | No caller in the repository |
| DV5-21 | `workers/cad/*` holds the Container app definition | `CadContainer`, input proxy and slots in `workers/ops/src/cad-container/`; `workers/cad/` holds the README and the parity tool; image still from `sheet-metal-service/Dockerfile` | One copy of `@cloudflare/containers` in the ops bundle |
| DV5-22 | "Deleted: dead edge functions and their repo folders" | Deployed functions deleted by the owner (OW5-14); the four repo folders removed by a later commit after that | Owner deploys; order of deletion |

Build amendments (BA5-n: changes made during the build and its reviews, beyond the specification text; each has a test that fails without it):

| # | Amendment | Where |
|---|---|---|
| BA5-1 | A text-model call that was answered but still failed (Anthropic `max_tokens`, refusal or no text; a Gemini answer without text) returns its billed usage with the failure; the translations consumer and `content-daily` add it to the run, and `generate-en` stores the usage of each failed attempt on the run row and reads it back afterwards (new step `generate-en-usage` after the last attempt), so `llm_calls` and `cost_cents` count every answered call | `workers/ops/src/ports/p5.ts`, `src/workflows/content-daily.ts`, `src/queues/translations.ts` |
| BA5-2 | T2-only var `CONTENT_WAIT_TIMEOUT_S` (1–21,600 s; else the 6 h wait) so the wait-timeout path runs in T2; refused while `AI` is bound and by the bundle check, set only by its own T2 harness | `workers/ops/src/env.ts`, `scripts/check-bundle.mjs` |
| BA5-3 | Sitemap guard: an intended drop of published articles is accepted once through the flag value `sitemap_accept_drop_on` (a UTC day; template in `scripts/phase5/flag-values.sql`); the run output records `drop_accepted` and becomes the next reference | `src/workflows/sitemap.ts`, `src/content/flag.ts` |
| BA5-4 | A translation whose slug belongs to another article of the language closes `failed` with `slug_conflict` and one alert; the backfill holds such a pair for 7 days and plans other recently failed pairs after the rest | `src/queues/translations.ts`, `src/content/backfill.ts` |
| BA5-5 | Collectors: `leads_new` counts only rows actually inserted; reddit re-reads each subreddit row before its fetch and skips it when no longer due; 30 s source timeout; a reddit tier message stops after 10 min of wall time and closes `succeeded` with `partial: true` (the rest stays due) | `src/collectors/*` |
| BA5-6 | Xometry tick: step 0 checks that the run exists, is `running`, belongs to `growth.xometry` and carries the slot's key, then claims it with one conditional update, so a redelivered message never scans twice; a claim older than 15 min is closed `failed` with reason `interrupted` | `src/xometry/tick.ts` |
| BA5-7 | CAD: at most one plain-text alert per kind, backend, hour and isolate for a refused or missing shared key; a 401 also recycles the slot; `CadRouter.recycle` is a Durable Object method without an HTTP route | `src/cad-container/alerts.ts`, `src/cad/backends/http-unfold.ts`, `src/do/cad-router.ts` |
| BA5-8 | Marketing consumer: the subscriber is re-read at send time (no longer active → final non-send, recipient `skipped`); a re-queue leaves out recipients with a final event or an event in flight (15 min); spintax is drawn from a per-message seed, so a redelivery carries the same text | `src/queues/outbound-mail.ts`, `src/routes/marketing-send.ts`, `src/marketing/*` |
| BA5-9 | T2 profile `jobs` seeds only tender codes that `api/tender-scan.js` refuses before any network call (the handler has no base URL a stub can replace); a T1 test checks every `test/t2-jobs/*.jobs.ts` file | `workers/ops/test/t2-jobs/*`, `test/p5/kernel/harness-jobs.test.ts` |
| BA5-10 | The queue kinds for the funded-startups scan and the GSC bulk actions, deferred to Phase 5 by the Phase 2 build (§5.2 DV-3, D-4), were not part of the Phase 5 specification and are not built: both stay synchronous | Open item below |

Defaults chosen for the owner ([specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) §1; each can be changed before the step named). Owner-sensitive:

| # | Decision | Default built | Decide before |
|---|---|---|---|
| D-6 | Article model | The value of the Supabase function secret `ANTHROPIC_MODEL` in `agent.content_daily` `value.model`, else `claude-sonnet-5` (live fallback); live prompt and parser through AI Gateway | S5 (OW5-5) |
| D-13 | Tender restart | 24 h canary on `["NL","DE"]`, then all 26 connectors; skipped when the S3 re-measurement shows tenders already flowing | S3 |
| D-15, D-24 | Campaign sending | Repo `send-campaign` semantics (multi-sender, warm-up caps, tracking, CSV recipients); all senders at their cap → wait for the next UTC day; a campaign without sender accounts sends from the default Resend identity with a cap of 500 a day | S6 |
| D-16 | Pause and stop | `OUTBOUND_MAIL_PAUSED` = rollback to the edge path (route 503, dashboard falls back); `OUTBOUND_MAIL_STOPPED` = no campaign mail (route 423, never falls back; queued mail held) | S6 |
| D-17 | Sender pacing | Cap = warm-up limit or daily limit of the sender row; spacing = the dashboard's `delay_between_emails_seconds` or 30 s; sending window and active days unenforced, as today | S6 |
| X-3 | Xometry alerts | Failures only; new-offer summary off (`value.notify_new`) | S8 |

| Area | Defaults | Built as |
|---|---|---|
| Plan questions | Q2, Q6, Q8, Q20, Q21, Q22 | Container `standard-1`, `max_instances` 3; Q6 applied per function (re-sync where live is ahead, `gsc-*` kept, dead functions deleted after a log check, count 41 / 16); TypeScript Xometry port without Playwright pricing; the €50/month gateway cap covers the new `translate` route; no Google Ads upload; Container only (`mac_mini` slot unbuilt) |
| Scheduling | D-3, D-4, D-5, D-12, D-19 | Schedule table on the every-minute tick; scans run in consumers and Workflow steps; catch-up within 60 min for jobs with an interval of 2 h or more; one queue message per live HTTP call; switch-over order S1 HN → S9 CAD, at least 24 h apart |
| Content | D-1, D-2, D-7…D-11, D-21, D-22, D-30, D-31 | Storage stays the served source; live v19 sitemap output; live Gemini chain with the key stored in the gateway; IndexNow per translation; full fix-links pass; backfill ≤ 5 per language and day; best-effort KV purge; database functions kept; 3 generation attempts 5 min apart; run keys with a suffix for re-runnable units; frozen content prompts in `src/content/prompts/` |
| Collectors, Xometry | D-14, D-27, D-28, X-1, X-2, X-4, X-5 | Alerts only for inserted rows; own queue envelope on `scrapes`; plain-text Telegram; PostgREST persistence; 401/403 → alert, pause, daily reminder, expiry hint; golden vectors from the Python code; Action schedule behind a repository variable |
| Marketing | D-15…D-17, D-24, D-25 | As above; the dashboard falls back only on the answers that prove the route did nothing |
| Runs and modes | D-18, D-20, D-23, D-29 | Final failures in `agent_runs`; ported functions stay deployed until Phase 6; `shadow` writes nothing but `agent_runs` and R2 `phase5-shadow/…`; Anthropic body exactly as live, no server-side fallback |
| CAD | C-1…C-9, D-26 | Class in `microns-ops`, one package copy; prebuilt image; key on every non-health route and a 120 s wall clock; compat path with an input host allow-list; masked parity; 5 reference STEP files; lock file from the measured resolution, replaced by the VPS freeze; slots `cad-0…cad-2`, batch ≤ 2; no jurisdiction set; CAD edge functions not redeployed |
| Configuration | M-1…M-3 | Migration tag `v2` = `SenderLimiter`, `CadContainer` in one deploy after the image push; re-sync of three functions here; no `PUBLIC_FILES` and no Hyperdrive on ops |

New names (built as proposed; renamed only before the first deploy): ops vars `TRACKING_DOMAIN`, `DIGEST_FROM`, `MARKETING_FOLLOWUPS_ENABLED`, `MARKETING_WARMUP_ENABLED`, `OUTBOUND_MAIL_PAUSED`, `OUTBOUND_MAIL_STOPPED`, `CAD_SLOTS`, `CAD_INPUT_HOSTS`, `CAD_PROCESSING_TIMEOUT_S`, `CAD_KEEP_WARM`; T2-only vars `PULLPUSH_API_BASE`, `HN_API_BASE`, `XOMETRY_API_BASE`, `INDEXNOW_API_BASE`, `AGENT_GEMINI_BASE_URL`, `CAD_CONTAINER_BASE_URL`, `CONTENT_WAIT_TIMEOUT_S` (never in a production config); secrets `INDEXNOW_KEY`, `XOMETRY_TOKEN`, optional `XOMETRY_COOKIE` (ops, all optional), `CAD_COMPAT_TOKEN` (site, optional); endpoint and machine principal `cad-compat`; action IDs MK-8, CD-1; agent keys `content_daily`, `content_daily.translate`, `content_daily.sitemap`, `growth.reddit`, `growth.hn`, `growth.tenders`, `growth.xometry`, `marketing.send`, `marketing.followups`, `marketing.warmup`, `ops_digest`; queue envelope `P5ScrapeMessage` (kinds `reddit-tier`, `hn-scan`, `tender-scheduled`, `xometry-scan`), messages `TranslationMessageV1`, `OutboundMailV1`; prompt `ops_digest.narrative@v1`; flag value fields of [specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) §5.6 plus `sitemap_accept_drop_on`; R2 prefix `phase5-shadow/`; internal host `cad-input.internal`; Analytics Engine events `cad_compat`, `xometry_tick`; run errors `enqueue_failed`, `enqueue_partial`, `generate_failed`, `slug_conflict`, `interrupted`; GitHub workflow `cad-image.yml`, environment `cad-release`, repository variable `XOMETRY_SCAN_SCHEDULE`.

Owner steps (OW5-1…OW5-22 of [specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) §10, after the merge and the Phase 4 gate; every new credential goes onto the P0-2 checklist the day it is created):

| Order | Steps | Detail |
|---|---|---|
| 1 | OW5-1…OW5-4 | Sign the Phase 4 gate; review the defaults above and the proposed names; run `agent_retention_purge()` once by hand; two owner items that do not depend on Phase 5 |
| 2 | OW5-5…OW5-9 | Article model into `agent.content_daily`; Google AI Studio key stored in AI Gateway `microns` with one preview call; queues `translations`, `outbound-mail` and their DLQs, `SEO_CACHE` id in `workers/ops/wrangler.jsonc`; secrets `INDEXNOW_KEY`, `XOMETRY_TOKEN` (optional `XOMETRY_COOKIE`) on ops and `CAD_COMPAT_TOKEN` on the site; `CAD_INPUT_HOSTS`; at least 30 new article titles |
| 3 | OW5-10…OW5-13 | GitHub environment `cad-release`, image build and push, image reference in `containers[0].image`; the VPS library freeze (Claude replaces the lock file); the failure reason of the Xometry Action; deploy `microns-ops` with every Phase 5 flag off, `CAD_BACKEND_DEFAULT = "vps"` and tag `v2`, then the site |
| 4 | OW5-14 | Log check, then delete the dead functions; then merge the later commit that removes their repo folders |
| 5 | S1…S9 | Switch-over runbook below, one step at a time |
| 6 | OW5-15…OW5-17 | Daily `parity.sql` for 7 days after S5 (Q13 after S8); sign the gate; `SET microns.p5_gate = 'signed';` and the unschedule file; delete the Action's repository secrets |
| 7 | OW5-18…OW5-22 | Keep the VPS and the Python Action until Phase 6; decide the 25 pending CSV recipients (before S6), the `gsc-*` callers, the reddit source and the partner-password caller |

Switch-over runbook (summary of [specs/PHASE5_SPEC.md](specs/PHASE5_SPEC.md) §10.2; commands and templates in [scripts/phase5/README.md](../../scripts/phase5/README.md); at least 24 h between steps; each step's first Worker run time is recorded for `parity.sql`):

| Step | Old scheduler | New job | Rollback |
|---|---|---|---|
| S1 | pg_cron `hn-collector` | `hn` (flag `assist`, then the old job deactivated) | Flag off; SQL `S1` reactivate |
| S2 | `reddit-tier1/2/3` | `reddit-t1…t3` | As S1 |
| S3 | `tender-scan-daily` | `tenders` (baseline re-measured the day before; canary unless tenders already flow) | As S1 |
| S4 | `auto-update-sitemap` | `sitemap` (one shadow day compared with the served object first) | As S1 |
| S5 | `enqueue-daily-article`, `process-article-queue`, `auto-translate-daily-articles`, `auto-fix-article-links` | `content-daily` (old jobs off after 09:05 on day D, flag on the same evening, first run D+1 07:00; never both chains on one day) | Before 06:55: flag off; SQL `S5` reactivate |
| S6 | — | Marketing route (owner test campaign to two owner-controlled addresses) | `OUTBOUND_MAIL_PAUSED`; incident stop `OUTBOUND_MAIL_STOPPED` |
| S7 | — | `ops-digest` (flag with the recipient) | Flag off |
| S8 | GitHub Action schedule | `xometry` (one shadow day, then `assist` and the repository variable) | Flag off; variable deleted |
| S9 | VPS for the edge functions and agent jobs | CAD Container (gate procedure and preview checks, then `UNFOLD_SERVICE_URL`, then `CAD_BACKEND_DEFAULT = "container"`) | Old secret value; `CAD_BACKEND_DEFAULT = "vps"` |

Open items after the build (2026-10-09):

| Item | Detail | Who |
|---|---|---|
| Image and lock file | The image is built only in CI (`cad-image.yml`); the lock file and the golden parity manifest are provisional until the VPS freeze (OW5-11) and the VPS capture at S9 | Both |
| Preview checks at S9 | Outbound interception of the input host in the real runtime, cold start and the 110 s abort (risk R-40) | Both |
| Phase 4 follow-ups | Add the event name `xometry_tick` to the Analytics Engine event list and widen the CAD router client type with priority, recycle and slot (Phase 5 uses a cast and passes the values structurally, because both files belong to Phase 4) | Claude (follow-up commit to the Phase 4 files) |
| CAD recycle route | `CadRouter.recycle` has no HTTP caller; the cold-start measurement uses idle time or a Durable Object call; an admin route is a later decision | Owner |
| Frontend types | Regenerate `src/integrations/supabase/types.ts` to clear the 14 pre-existing errors in `CampaignWizard.tsx` | Claude, after the next schema change |
| Queue kinds of Phase 2 DV-3 | Funded-startups scan and GSC bulk actions stay synchronous (BA5-10); decide whether they still need a queue | Owner |
| T2 egress | A T2 harness that refuses outbound network calls by default is not built yet; today each T2 file points every source at the stub | Claude |
| Root test runner | The root `npm test` (jest) is not installed, as at the Phase 4 gate | Claude |

### 5.6 Phase 6: hardening + decommission

Goal: rotate credentials, remediate RLS, remove Vercel and the VPS, and prove the cost target.

| ID | Task | Owner | Effort | Refs |
|---|---|---|---|---|
| P6-1 | Rotate all service credentials (Supabase, Google OAuth grants, AWS, Resend, Telegram, GitHub/Postgres DSN, AI keys) and re-issue them to every consumer, including the Worker secrets created in Phases 1–5; checklist in the private note. If Phase 7 proceeds, the Supabase credentials are retired with the Supabase project instead | Dimitris (Claude prepares and verifies) | 1 d | H-7, H-30 |
| P6-2 | RLS remediation per [docs/security/rls-remediation-plan.md](../security/rls-remediation-plan.md) and the private note, incl. the tenant-role gap and the broader-than-intended policies; policy tests. Built 2026-10-09: the access-model migration and its removal script are delivered to the owner privately with their test harness and are committed, with rules-only policy tests, after the owner has applied them (DV36-4, DV36-10); a separate fix for signed-in quote submissions (DBO-1) is committed with the build | Claude (Dimitris applies) | 1.5 d | H-5, H-6, H-30 |
| P6-3 | Supabase security advisor findings and credential-storage findings (private note). The database part travels with P6-2; the settings and the credential-storage moves are owner steps (OW6-4, FU-15) | Both | 0.25 d | H-21, H-30 |
| P6-4 | Application hardening: optional Access on `/dashboard*` (and `/customer*`, `/partner*`); CORS tightened; `/reset-password` route (src/contexts/AuthContext.tsx:220 links to it; no route in src/App.tsx:162-319); the Maps Embed key in `src/pages/Contact.tsx` referrer-restricted to production hosts; caller authentication for the `leads-api` edge function; parity re-run after each change. Built 2026-10-09: `/reset-password` with the recovery hand-over; CORS switch `API_CORS_MODE` (`parity` until the owner switches it after S17); `leads-api` requires a staff session (deployed by the owner); tenant hosts match only the exact `micronshub.eu` suffix; no browser call to the Supabase admin API; the Access application for `/dashboard` prepared, off (DV36-5); the Maps key is owner step OW6-9 | Claude | 1 d | H-6, H-21, H-22 |
| P6-5 | Decommission: Vercel project paused (not deleted) for 30 days; VPS off after the Container has run ≥ 7 days; GitHub Action removed. Built: the cleanup retires the Vercel forward (DV36-8) and removes the Action's workflow file; the decommission itself is owner steps OW6-11, OW6-15 | Both | 0.5 d | — |
| P6-6 | Repository cleanup (file list below); `README.md` rewrite; optional removal of the prerender plugin with a parity re-run. Built: the owner-run `scripts/phase6/cleanup.sh` with the prepared README and reference notes; the prerender plugin stays (D6-19); the `cdn.gpteng.co` script is removed by the build (DV36-6) | Claude | 0.5 d | H-8, H-23 |
| P6-7 | Security checklist (private) and 30-day cost report against the Q14 baseline ([COSTS.md](COSTS.md)) | Both | 0.5 d | — |

File-level change list (as built; "owner-run" = changed only when the owner runs `scripts/phase6/cleanup.sh` after the decommission):

| Change | Path | Note |
|---|---|---|
| New | `src/pages/ResetPassword.tsx`, `src/utils/passwordRecovery.ts`, `tests/frontend-api/reset-password.test.tsx` | H-22; no language prefix, `noindex, nofollow` |
| Changed | `src/App.tsx`, `src/contexts/AuthContext.tsx`, `src/pages/Login.tsx`, `public/robots.txt` | Lazy route; recovery events outside the page forward to it; "Forgot password?" links to it; `Disallow: /reset-password` |
| Changed | `index.html` | `cdn.gpteng.co` script (index.html:89-90) removed in a commit of its own, so it can be reverted alone (DV36-6, D6-14) |
| Changed | `workers/site/src/preview.ts`; new `workers/site/test/cors-mode.test.ts` | CORS switch in `finalise()` (DV36-3); `workers/site/src/{env,index}.ts` unchanged |
| Changed | `supabase/functions/leads-api/index.ts`, `src/pages/dashboard/LeadMonitorPage.tsx` | Deployed v7 source plus one import and one marked block that requires a staff session (H-6); the page sends the session token; the function is deployed by Dimitris |
| New | `supabase/functions/leads-api/staff-auth.ts`, `tests/edge-functions/**`, `tests/frontend-api/leads-api-callers.test.ts` | Edge tests with their own config, including a hash test of the committed function against the deployed source |
| Changed | `src/utils/tenantApi.ts`, `src/pages/dashboard/CustomersPage.tsx`; new `tests/frontend-api/{tenant-host,admin-api-usage}.test.ts` | Exact `micronshub.eu` suffix match; the back-fill block that called the Supabase admin API removed (the customer list is unchanged) |
| New | `supabase/migrations/20261009_create_public_rfq_qualified_columns.sql`, `supabase/rollback/20261009_create_public_rfq_qualified_columns_down.sql` | DBO-1: column references table-qualified; applied by the owner (OW6-3) |
| New after the owner's apply | `supabase/migrations/<apply date>_rls_remediation.sql`, `supabase/rollback/<apply date>_rls_remediation_down.sql`, `supabase/tests/rls/**` | Delivered privately until applied (DV36-4, DV36-10) |
| New | `scripts/phase6/{cleanup.sh,cleanup-edits.mjs}`, `scripts/phase6/test/cleanup.test.mjs` | Owner-run cleanup: dry run by default, `--apply --decommissioned`, stages and never commits |
| New | `docs/migration/phase6/{root-README.md,reference-vercel-README.md,reference-edge-functions-README.md,access-dashboard.json,access-dashboard.md}`, `docs/migration/MANUAL_STEPS.md` | Prepared files the cleanup moves; optional Access configuration; the owner checklist |
| Not moved | `middleware/*`, `api/*.js`, `api/_lib/*` | DV36-1 |
| Moved (owner-run) | `vercel.json`, `middleware.ts` → `reference/vercel/`; `supabase/functions/{process-followups,process-warmup}` → `reference/edge-functions/`; `docs/migration/phase6/root-README.md` → `README.md` | DV36-2, BA36-3 |
| Changed (owner-run) | The moved `middleware.ts` and 9 test and tool files that read the Vercel config or middleware (repointed to `reference/vercel/`); root `package.json` (`dev:server` removed); the `XometryQueuePage.tsx` hint; the Phase 5 port-map test and marketing parity oracle; `workers/site/wrangler.jsonc` and `workers/site/test/env-api.test.ts` (`API_FORWARD_ORIGIN` = `""` in both env blocks) | Edits E1…E20 of `scripts/phase6/cleanup-edits.mjs` (DV36-8, BA36-4) |
| Deleted (owner-run) | `scripts/dev-server.js`, `scripts/freecad-unfold/`, `.github/workflows/auto-merge-claude.yml`, `.github/workflows/xometry-scan.yml`, `docs/AWS_S3_VERCEL_GUIDE.md`, `supabase/functions/{check-replies,fix-broken-tables}` | — |
| Deleted (owner-run, opt-in) | `public/laserkritis/`, `public/cookie-consent.html` (after a log check); the four `gsc-*` folders (OW6-13); `supabase/functions/{process-article-queue,auto-update-sitemap,auto-translate-articles,tender-collector}` (OW6-17) | Reachable static URLs today; functions only after they are deleted in Supabase |
| Untouched | `lib/*`, `sheet-metal-service/`, `vite.config.ts` (prerender plugin kept, D6-19), remaining `supabase/functions/*`, `supabase/config.toml` | — |

Exit gate:

1. Security checklist signed by the owner (private).
2. P6-1 complete: every consumer works with the new credentials (no auth errors in 24 h of logs) and the old ones are revoked.
3. 30-day cost ≤ target (baseline per Q14).
4. Parity diff after the cleanup: 0 unexplained differences.

Rollback: none for rotation. Vercel stays paused, not deleted, for 30 days: unpause and flip records (§6) if ever needed.

Dependencies: Phase 5 gate; Q14, Q18, Q19.

Risk refs: H-5, H-6, H-7, H-21, H-22, H-30.

Effort total: ≈ 5.25 d (plan: 1 week); the code parts were built together with the Phase 3 code from one specification.

Build record (2026-10-09): the Phase 6 code is built and tested locally on top of the commit that closes the Phase 5 build (`b694d06`), in the same run as the Phase 3 code (§5.3); nothing is deployed or applied, no credential was created or rotated, and the cleanup has not been run on the repository. The access-model migration of P6-2 is not in the repository: it goes to the owner privately with its test harness and apply instructions, and is committed with the public policy tests after the owner has applied it. Defaults, deviations and follow-ups below follow [specs/PHASE36_SPEC.md](specs/PHASE36_SPEC.md) §2.2, §2.3, §10.1 and §10.3; the owner confirms them before the merge (OW6-1 of [MANUAL_STEPS.md](MANUAL_STEPS.md)). Checks shared with Phase 3 are listed in §5.3.

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | Security checklist signed (private) | **blocked** (local part passes) | Needs OW6-1…OW6-9 and OW6-16. Access-model migration and removal script: private harness on Postgres 18.3 and 16.4 (PGlite), 1,666 assertions each, 12 of 12 seeded faults caught; live definitions re-read with SELECTs only on 2026-10-09, equal to the tested snapshot. `leads-api`: 15 edge tests, including a hash test that the committed function is the deployed v7 source plus one import and one marked block; the LeadMonitorPage sends the session token. `/reset-password`: 14 tests; CORS switch, exact tenant-host match and "no admin API in browser code" each have tests that fail without the change |
| 2 | P6-1 complete, old credentials revoked | **blocked** | Owner step OW6-10 (private checklist; site secrets by the site-secret procedure) |
| 3 | 30-day cost ≤ target | **blocked** | OW6-16 against the Q14 baseline |
| 4 | Parity diff after the cleanup: 0 unexplained differences | **blocked** (local part passes) | Owner run OW6-12. In a scratch clone of the built tree: dry run "35 to do, 0 blocked" with the tree unchanged; `--apply` without `--decommissioned` refused (exit 2); `--apply --decommissioned` exit 0, then site 1,434, shared 402, ops 2,039 (+19 opt-in skips; two checks of the deleted Xometry workflow go with it, BA36-4), frontend 184, edge 15, smoke, parity tool 94/94, `vite build` and the tool tests green; a second dry run "0 to do, 35 already done" |

Phase 6 checks of the same run (2026-10-09):

| Check | Result |
|---|---|
| DBO-1 fix | PGlite check of the fix and its removal script (part of the private harness), run with the repository copies: 14 assertions on each engine (the fix qualifies every column reference; the removal restores the previous text and keeps grants and `search_path`); the access-model harness also passes with the committed Phase 4 migration in place |
| `index.html` commit | In a scratch clone committed like the build (the `index.html` change alone in a commit of its own), reverting that commit keeps the reset tests at 14/14 (D6-14) |
| Repository | No access-model migration file is tracked or present in the working tree; under `supabase/migrations` and `supabase/rollback` only the two DBO-1 files are new |
| Owner bundle | Migration, removal script, apply instructions, build-time check record and harness prepared as private attachments for the owner (handed over at the end of the build, never pushed); the packed copy equals the loose files |

Deviations from this section as first written (DV36-n = [specs/PHASE36_SPEC.md](specs/PHASE36_SPEC.md) §10.1):

| # | Planned | Built | Why |
|---|---|---|---|
| DV36-1 | `middleware/*` → `workers/site/src/seo/*`, `api/*` → `workers/ops/src/legacy-api/*` | Not moved | The SEO handler imports 17 `middleware/` modules and both Workers import `api/` through the shim (D6-11) |
| DV36-2 | `vercel.json`, `middleware.ts` deleted | Moved to `reference/vercel/` by the cleanup, with a README | They stay the frozen parity reference of the redirect, CORS and SEO tests (D6-12) |
| DV36-3 | CORS in `workers/site/src/api/router.ts` | In `finalise()` of `workers/site/src/preview.ts`, behind `API_CORS_MODE` | Every answer, forwards included, passes `finalise()` once; `router.ts` is extended by Phases 4 and 5 |
| DV36-4 | `supabase/migrations/2026MMDD_rls_remediation.sql` | Same path under the apply date, committed after the owner has applied it; removal script in `supabase/rollback/` | Security detail stays private until applied (F36-9) |
| DV36-5 | P6-4 Access also on `/customer*`, `/partner*` | `www.micronshub.eu/dashboard` only, prepared and off | External users have no Access identity (D6-10) |
| DV36-6 | `cdn.gpteng.co` removal is an owner decision at Phase 6 | Removed by the build in a commit of its own; declining = reverting that commit alone | Platform-neutral; one explained parity difference instead of a two-step cleanup (F36-10) |
| DV36-8 | P6-5 lists no forward retirement | The cleanup sets `API_FORWARD_ORIGIN` to `""` (E16, E17); every forward then answers 502 without an outbound request; `--keep-forward` skips it | A deleted Vercel project's host must never receive forwarded requests (F36-11) |
| DV36-10 | P6-2 "policy tests" | Rules-only tests on the post-apply state in `supabase/tests/rls/`, committed after the owner has applied P6-2; the full harness stays in the private bundle | F36-9, D6-26 |

Build amendments (continuing §5.3):

| # | Amendment | Where |
|---|---|---|
| BA36-3 | The cleanup keeps the never-deployed `process-followups` and `process-warmup` as frozen copies in `reference/edge-functions/` instead of deleting them, because the Phase 5 parity oracle of the marketing port reads them; edit E20 points the oracle there; `check-replies` and `fix-broken-tables` are deleted as planned | `scripts/phase6/cleanup-edits.mjs`; `docs/migration/phase6/reference-edge-functions-README.md` |
| BA36-4 | Edits E18 and E19 remove the checks of `xometry-scan.yml` from the Phase 5 port-map test together with the workflow; E17c renames the forward-origin test with E16 | `scripts/phase6/cleanup-edits.mjs` |
| BA36-5 | The DBO-1 removal script restores the previous definition of `create_public_rfq` with LF line endings (the deployed text has CRLF): the same text, other bytes; a later digest comparison removes CR first; its check holds 14 assertions per engine (the specification said 8) | `supabase/rollback/20261009_create_public_rfq_qualified_columns_down.sql`; [MANUAL_STEPS.md](MANUAL_STEPS.md) OW6-3 |
| BA36-6 | The DNS check before the Vercel project is deleted (OW6-11) also forbids the `www` CNAME target `vercel-dns-017.com`, which `--forbid-target vercel-dns.com` does not match | [MANUAL_STEPS.md](MANUAL_STEPS.md) OW6-11; [scripts/dns-parity/README.md](../../scripts/dns-parity/README.md) |

The public copy of the build specification keeps its build-time text for OW3-7, OW6-11 and DB6-7; for those rows BA36-2, BA36-5, BA36-6 and [MANUAL_STEPS.md](MANUAL_STEPS.md) are current.

Defaults chosen for the owner ([specs/PHASE36_SPEC.md](specs/PHASE36_SPEC.md) §2.2–§2.3; each can be changed before the step named). Owner-sensitive:

| # | Decision | Default built | Decide before |
|---|---|---|---|
| D6-DB-2 | Tenant-scoped rows | Members read, tenant admins write | OW6-2 |
| D6-DB-6 | Storage | RFQ and quote buckets private, object reads follow `public.rfq_files` visibility; sitemaps public read, server writes; bucket listing staff only, bucket creation super admin (`tenant-*`) | OW6-2 |
| D6-DB-16 | Signed-in quote submissions (DBO-1) | Separate migration with a removal script, committed with the build, applied by the owner in either order with P6-2 | OW6-3 |
| D6-7 | CORS switch-on | After S17: preview first, then production | OW6-7 |
| D6-10 | Access on `/dashboard*` | Prepared, off; `www.micronshub.eu/dashboard` only; the allow list must hold everyone who opens the dashboard (staff, tenant admins, production partners) | OW6-8 |
| D6-14 | `cdn.gpteng.co` script | Removed by the build in a commit of its own; it most likely ends the in-page features of the editor that added it; declining = revert that commit alone (the reset flow stays) | OW6-1, before the merge |
| D6-22 | RFQ creation behind the site gate | Not built (FU-11): the quote form must keep working on Vercel until the decommission | OW6-1 |
| D6-25 | Vercel deployment host after the flip | Optional Vercel Firewall rule for the project's `*.vercel.app` hosts (OW6-18), recommended right after S17; removing it restores the forward rollback flag; the DNS rollback is unaffected | OW6-18 |

| Area | Defaults | Built as |
|---|---|---|
| Access model (P6-2, P6-3) | D6-DB-1, D6-DB-3…D6-DB-5, D6-DB-7…D6-DB-15, D6-DB-17…D6-DB-20 | Staff = `public.is_staff()`; the public reads of the specification kept (re-decided at FU-6); server-only tables without policies; `logs` staff read and write, authenticated insert kept; a fixed `search_path` (`public, pg_temp`) and EXECUTE per role on the functions the migration covers; strict drops with post-conditions that abort on any drift; dry run with `ROLLBACK;` first; applied any time after review, independent of the cutover; table privileges per role, tenant logo uploads and quote-form file references left for FU-8, FU-7 and FU-9; credential-storage moves with P6-1 (FU-15); `pg_net` moved after Phase 5; server callers use the service key (OW6-2 pre-condition); browser bucket helpers kept |
| Reset password | D6-1…D6-5 | Implicit recovery flow; a recovery event outside the page forwards to `/reset-password`; "Forgot password?" links there (`rel="nofollow"`); `noindex, nofollow` and `Disallow` in `robots.txt`, no language variant, sitemap entry or prerender; minimum length 6 |
| CORS, `leads-api`, tenant hosts | D6-6, D6-8, D6-9, D6-24 | `API_CORS_MODE` in `finalise()` (`parity` default); `leads-api` requires a staff session (`admin`, `sales_rep`, `production_manager`, `accountant`), fails closed (401, 403, 503), `OPTIONS` open, `verify_jwt` stays false; repository text = deployed v7 + one import + one marked block; exact `micronshub.eu` suffix; no admin-API call in browser code (a staff back-fill route is FU-14) |
| Cleanup and decommission | D6-11…D6-13, D6-15…D6-21, D6-23 | `middleware/` and `api/` stay; `vercel.json` and `middleware.ts` frozen in `reference/vercel/`; `cleanup.sh` refuses `main` and a dirty tree, stages and never commits; Phase 5 hand-over deletions (BA36-3); statics, `gsc-*` and the cron-only functions opt-in after their checks; README from the prepared file; prerender plugin kept; forward retired (`--keep-forward` skips); dashboard buttons on old edge functions unchanged (FU-5) |
| Policy tests | D6-26 | After the owner has applied P6-2: `supabase/tests/rls/` on the post-apply state, rule-worded cases only (DV36-10) |

New names (built as proposed): route `/reset-password`; site var `API_CORS_MODE` (`parity`, `allowlist`) and type `CorsModeEnv` in `workers/site/src/preview.ts`; `supabase/functions/leads-api/staff-auth.ts`; Access application `microns-dashboard` (prepared, not created); folders `reference/vercel/` and `reference/edge-functions/` (created by the cleanup); cleanup options `--apply`, `--decommissioned`, `--with-statics`, `--with-gsc-functions`, `--with-cron-functions`, `--keep-forward`, `--allow-main`, `--allow-dirty`; database observations DBO-1 (fixed by the migration above) and DBO-2 (FU-9).

Owner steps: Phase 6 table of [MANUAL_STEPS.md](MANUAL_STEPS.md) (OW6-1…OW6-18). OW6-1 (review, before the merge), OW6-2 (access model, after its pre-condition), OW6-3 (DBO-1), OW6-5 (Auth redirect URL), OW6-6 (`leads-api` deploy once the new page serves) and OW6-9 (Maps key) do not depend on the cutover; OW6-7, OW6-8 and OW6-18 follow S17; OW6-10…OW6-17 close the phase.

Follow-ups not built (each needs an owner yes; [specs/PHASE36_SPEC.md](specs/PHASE36_SPEC.md) §10.3):

| # | Item |
|---|---|
| FU-1 | Refuse the tenant slugs `www`, `api`, `files`, `mcp`, `rfq`, `send` on save |
| FU-2 | `workers_dev: false` in `env.production` once previews use version URLs only |
| FU-3 | Remove the forward code and the `api.forward_to_vercel` flag after E16 has run for 30 days |
| FU-4 | Consolidate the two shims (`workers/site/src/compat/vercel-shim.ts`, `workers/shared/src/compat/vercel-node.ts`) |
| FU-5 | Repoint the dashboard buttons that call ported edge functions; then delete those functions |
| FU-6 | Re-decide the public reads kept by D6-DB-3 (private note) |
| FU-7 | Upload policy for tenant logos on `tenant-*` buckets |
| FU-8 | Table privileges per role on staff tables, as defence in depth next to RLS (private note) |
| FU-9 | Quote-form file references (DBO-2; private note) |
| FU-10 | Delete the three Storage helper files nothing imports (`mediaStorage.ts`, `RfqStorageDebug.tsx`, `MicronsMultiStepForm.tsx`) |
| FU-11 | RFQ creation behind the site gate |
| FU-12 | Docs that still describe the Xometry Action (`xometry-bot/README.md`, `xometry-bot/dashboard/README.md`) |
| FU-13 | Sitemap reader switch to R2 (§5.5 DV5-1) |
| FU-14 | Staff route that creates customer rows for customer-role users without one |
| FU-15 | Credential-storage moves with P6-1: Telegram token and GSC credentials to Worker secrets, sender-account OAuth tokens to server-only storage with a connected flag for the dashboard, re-grant at Google |

Open items after the build (2026-10-09):

| Item | Detail | Who |
|---|---|---|
| Post-apply commit | On the owner's "applied" (OW6-2, with the bundle attached again if the session has ended): commit the migration and removal script under the apply date with `supabase/tests/rls/`; then check that the public tests pass, that the public copy holds no pre-apply statement, and that live equals the tested after-state | Both |
| Shared CORS comment | `workers/shared/src/http/cors.ts` still says the allow-list is not wired into any Worker; it is, through `API_CORS_MODE` | Claude |
| Phase 2 test timing | `workers/site/test/files.test.ts` "delete-folder > first list page…" can reach its 5 s timeout under heavy load; it passed in all four site runs of the gate | Claude (Phase 2 file) |
| Fixture note | The cleanup dry run prints a NOTE for the frozen Phase 1 fixture `workers/site/test/fixtures/seo/shell.html`, which still names the removed editor script; reported, not edited, by design | — |
| Helper entry checks | `workers/ops/scripts/nest-fixture.mjs`, `scripts/phase5/compare-sitemap.mjs` and `scripts/phase6/cleanup-edits.mjs` skip their command line when started directly through a symlinked path; no owner step starts them that way (`cleanup.sh` calls the helper by its real path) | Claude |
| Owner-gated | Every Cloudflare, DNS, Supabase and deploy step of Phases 2–6: [MANUAL_STEPS.md](MANUAL_STEPS.md) | Owner |

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
| S11 | C − 1 d | Readiness: edge certificates active for apex, `www`, `*.micronshub.eu` (Universal SSL covers first-level subdomains, CF docs verified 2026-09-27); zone settings per §6.4 applied before any record is proxied; Workers Routes `www.micronshub.eu/*` and `*.micronshub.eu/*` → `microns-site` deployed (inert while records are DNS only); production version = the version ID that passed the Phase 1 and 2 gates. As built (2026-10-09, §5.3; order and commands in [MANUAL_STEPS.md](MANUAL_STEPS.md) OW3-6): the redirect ruleset (HTTP → HTTPS, apex → `www`) generated from the refreshed baseline and applied, each rule acting only on proxied records (DV36-9); routes without a Worker for `files.`, `mcp.` and `cad-vps.micronshub.eu` created before the Workers Routes, which come from `cf-site-production.yml` `routes` (DV36-12); the production version is a new upload of the merged commit through `cf-site-production.yml` (tag `prod-<sha>`), checked by parity on its version preview URL against the refreshed baseline, then deployed (DV36-11); the real Turnstile pair set for previews and production at the same moment; `SEO_STRICT_404` = `"false"`; `api.forward_to_vercel` off; baseline re-captured (P0-3 refresh); parity preview vs production 0 diffs; GSC snapshot (coverage, crawl stats, Core Web Vitals); Vercel certificate expiry for apex, `www`, wildcard recorded; `tender-collector` and MCP send their credentials | Both | Checklist complete | — |
| S12 | C (low-traffic hour) | Flip `www`: replace the DNS-only CNAME with a proxied placeholder record (for example `AAAA 100::`; CF docs, re-check at execution) | Dimitris flips, Claude verifies | Within 10 min: `verify-ssr.sh` green on `https://www.micronshub.eu`; 20-URL parity smoke vs baseline; `/sitemap.xml`, `/robots.txt`, `/indexnow_key.txt`, `/api/track` (test ID) correct; `X-Seo-Source` present; no `X-Robots-Tag` | Restore `www` CNAME `3096eb4eb748a48f.vercel-dns-017.com`, DNS only (≈ 5–10 min, TTL 300 s) |
| S13 | C + 15 min | Apex: replace A `216.198.79.1` with a proxied placeholder; enable the Single Redirect Rule `micronshub.eu` → `https://www.micronshub.eu${path}${query}` with the status seen in the baseline (HTTP → HTTPS is already configured at S11, §6.4). As built the rule was applied at S11 and acts from the moment the record is proxied; nothing is switched on here (DV36-9) | Dimitris flips, Claude verifies | Apex and `http://` variants match the baseline (status, `Location`, HSTS), incl. apex `/api/marketing?action=track…` and `/logo.png`, which sent e-mails embed (api/emails.js:165; supabase/functions/send-campaign/index.ts:8) | Restore the A record, DNS only; the rule then no longer acts on it (≈ 5–10 min) |
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
| Always Use HTTPS / HSTS | HTTP → HTTPS status and HSTS values as in the baseline; if "Always Use HTTPS" emits a different status than the baseline, use a redirect rule with the baseline status instead (CF docs, re-check at execution). As built (2026-10-09, §5.3 D3-5): Always Use HTTPS off; HTTP → HTTPS by the redirect rule `microns_http_to_https` with the baseline status (default 308); HSTS sent by the zone or by the Worker (`HSTS_VALUE` in `env.production`) as `scripts/phase3/redirect-rules.mjs` reports for the baseline | H-24 |

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
| Q6 | The 16 out-of-repo edge functions (41 deployed; corrected 2026-10-09, §5.5 DV5-8): keep `gsc-*` and `resend-webhook`? Delete the `-v2`, `-no-jwt`, test and diag ones? Re-sync the repo from live before Phase 5? | Keep `gsc-*` if a caller exists; retire `resend-webhook` after a log check (the Phase 2 Worker handles Resend); delete `-v2`, `-no-jwt`, test, diag and `enqueue-translations`; yes, re-sync before Phase 5. Applied in the Phase 5 build (2026-10-09, §5.5 P5-1): three functions re-synced, `gsc-*` kept and added to the repository until a caller is confirmed (OW5-20); deletions after the log check are OW5-14 | P5-1 |
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
