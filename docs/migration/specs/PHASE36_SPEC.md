# Phase 3 + Phase 6 build spec: cutover code, hardening, decommission tooling (code parts only)

Status: build specification (design only) · 2026-10-04 · scratch (not in the repo) · nothing here is built, committed, deployed or applied · revised after the critique pass of 2026-10-04 (18 findings, all accepted after verification; log in Appendix C).

Scope: the CODE parts of PLAN.md §5.3 (docs/migration/PLAN.md:321-363) with runbook §6 (:538-609), and of PLAN.md §5.6 (:468-509). Phase 7 is out of scope. Every dashboard, account, DNS, deploy, apply and decommission step is the owner's and is listed in §9 for `docs/migration/MANUAL_STEPS.md`.

Sources (scratch `phase36/`, each cited to `path:line`, live queries and docs): `p3.md` (Phase 3 code design, drafts in `p3work/`), `p6-rls.md` (P6-2/P6-3 migration, tested in `pglite/`), `p6-app.md` (P6-4 and P6-6, build patch `p6work/p6-app.patch`). Sibling specs whose ownership this spec respects: `../phase2/PHASE2_SPEC.md` §2.1, `../phase4/PHASE4_SPEC.md` §3.2/§7, `../phase5/PHASE5_SPEC.md` §3.2/§4/§8. Canon: CANON.md (cd2d8729 scratchpad).

> **Handling.** §0-§11 follow the public-repo rules of CANON.md §1 (no secret values, security at summary level, no description of today's weaknesses) and may be quoted in repo docs, PRs or handed to any builder. **Appendix P is PRIVATE**: never copy it, or anything it says, into the repository, a commit message, a PR, a code comment or a log line (the GitHub repository is public). Builders of DB6, AS3, CO6, LA6, RS6, TH6, PC3 and CL6 read Appendix P (and Appendix C) together with `p6-rls.md` §11, `p6-app.md` PRIVATE and `p3.md` PRIVATE.

Evidence tags:

| Tag | Meaning |
|---|---|
| `path:line` | Repo branch `claude/microns-cloudflare-migration-j6ffpt`, HEAD `614847c` "phase2: API port built, reviewed and integrated" (2026-10-04, tree clean; the commit that closes the Phase 2 build). The annexes cite `9c3db83`; `3ee2396` then carried the Phase 2 repairs (among others `workers/site/src/api/{files,router,resolve,ops-client}.ts`, `workers/site/src/auth/{db,tracking}.ts`), and `614847c` changed only docs, READMEs, `workers/site/src/auth/constraints.ts` and tests (`git diff --name-only 3ee2396 614847c`). Code lines cited here were read at `3ee2396`/`614847c`; `p6work/p6-app.patch` still applies on `614847c` (`git apply --check`, exit 0); **PLAN.md lines moved** (§5.3 :264 → :321, §5.6 :411 → :468, §6 :481 → :538): this spec cites `614847c`, the annexes the old numbers |
| p3 §x / rls §x / app §x | `phase36/p3.md`, `phase36/p6-rls.md`, `phase36/p6-app.md` |
| P2 / P4 / P5 §x | the three sibling build specs |
| live 2026-10-04 | read-only Supabase MCP `execute_sql` (SELECT) on project `cfjrtmtaitwzggzpkhxi` |
| verify 2026-10-04 | runs made for this spec (results in `phase36/spec-verify/`, scratch clone branch `p6work/clone` `p36-verify`) |
| CF docs (fetched 2026-10-04) | copies in `p3work/cfdocs/`, `p6work/cfdocs/` |

Verification runs made for this spec (verify 2026-10-04):

| Run | Result |
|---|---|
| Combined site config: p3 `env.production` block + top-level vars `ARTICLES_STORE`, `PUBLIC_FILES_ORIGIN`, `API_CORS_MODE` + the p6 CORS wiring with `CorsModeEnv` in `preview.ts` (`src/env.ts` and `test/env-api.test.ts` untouched), on `9c3db83` + `p6-app.patch` | site T1 22 files / 1,125 tests passed (incl. 7 env-production, 13 CORS); site T2 5 files / 50 passed; `tsc --noEmit` clean; diff `spec-verify/site-combined.diff` |
| `wrangler deploy --dry-run --env=""` vs `--env production` (placeholder `dist/`) | `index.js` byte-identical (SHA-256 prefix `1a8b5659`); "Multiple environments" warning 0 with `--env=""`, 1 without `--env` |
| Phase 3 tools, network blocked (`HTTPS_PROXY=http://127.0.0.1:9 NODE_USE_ENV_PROXY=1`) | `node --test` dns-parity + redirect-rules: 32/32 |
| dns-parity CLI on fixtures | export vs import 0; drift fixture 1; unknown option 64 |
| `redirect-rules.mjs --default` | exit 0, payload as `p3work/drafts/docs/migration/phase3/redirect-rules.default.json` |
| RLS harness (`pglite/test.mjs`, PGlite 0.5.8 / Postgres 18.3) | 1,666 passed, 0 failed |
| Cleanup tests (`scripts/phase6/test/cleanup.test.mjs` in the clone) | 7/7 |
| `git apply --check p6work/p6-app.patch` on `3ee2396` + working tree and again on `614847c` | applies (exit 0) both times |
| Live 2026-10-04 | 72 public tables; 159 public + 11 Storage policies; 21 SECURITY DEFINER functions, all anon-executable; Storage bucket policies "create" (INSERT) and "list" (SELECT) granted to `public`; 4 buckets all public; `postgres` not a member of `supabase_storage_admin`; newest `schema_migrations` row `20260713092040` |
| wrangler 4.145.0 | `versions upload --tag` writes annotation `workers/tag` (node_modules/wrangler/wrangler-dist/cli.js:176360); `versions view <id> --json` prints the version with `annotations` and `resources.bindings` (`plain_text` → `{name, text}`) (cli.js:355440-355500, :177068); `secret put` refuses while the newest version is not deployed and points to `versions secret put` (cli.js:305362-305376); uploads keep every unchanged secret of the previous version (`keepSecrets: true`, cli.js:176352-176354) and `secrets.required` names become `inherit` bindings (cli.js:171317-171335), so preview and production versions share one set of Worker secrets; a route given by `zone_name` is resolved with `GET /zones?name=…` (cli.js:159276-159325, needs Zone Read) |
| KV-ID assertion of PC3 (§3.3 row 15), scratch clone `spec-verify/kvclone` at `614847c` (critique pass) | unchanged `test/env-api.test.ts` with well-formed IDs and filled vars: site T1 1,180/1,181 (only "Phase 1 entries are unchanged" fails); row-15 form: env-api 23/23 with placeholders and with real-looking IDs, an `id` of `not-an-id` fails, `npm run typecheck` clean; diff `spec-verify/envapi-kv.diff` (2 added, 1 deleted) |
| DBO-1 removal script (critique pass) | `create_public_rfq_fix_down.sql` (the live definition as `CREATE OR REPLACE`, from `spec-verify/critic_live_cprfq.sql`); `pglite/down_check.mjs`: fix then removal restores body, ACL and `search_path` exactly, with and without the access-model migration first: 8/8 on PGlite 0.5.8 and 8/8 on pglite16 |
| G36-k allow-list (critique pass) | `phase36/g36-allow.txt` written from §3.2: 48 sample paths of §3.2 pass, 13 frozen paths (`vercel.json`, `middleware.ts`, `api/s3.js`, `workers/site/src/{env,index}.ts`, `router.ts`, `policy.test.ts`, `docs/migration/PLAN.md`, the access-model migration, `supabase/tests/rls/`, `fileStorage.ts`, root `package.json`, `scripts/dev-server.js`) are flagged |
| Live 2026-10-04 (critique pass, SELECT only) | `user_roles`: admin 2, customer 16, partner_seller 1; `tenders` newest `updated_at` 2026-06-06, `tender_scan_logs` 0 rows, `funded_startups` newest `updated_at` 2026-03-25; `cron.job` 10 jobs, none calls `leads-api`; Edge Function targets of the jobs: `process-article-queue`, `auto-update-sitemap`, `auto-translate-articles`, `fix-article-links`, `reddit-collector` (3 jobs), `hn-collector`, `tender-collector` |

---

## 0. Ground rules for every builder

| # | Rule | Evidence |
|---|---|---|
| G36-1 | P2 G-1…G-9, P4 R-1…R-9 and P5 G5-1…G5-8 apply unchanged: one owner unit per file; never deploy, upload, `secret put`, create a Cloudflare resource or apply SQL; never call `www.micronshub.eu`, the apex or `*.vercel.app`; Supabase read-only (SELECT) and only where a unit says so; never print a key; toolchain pins (wrangler 4.145.0, vitest 5.0.3, TypeScript 7.0.2, workers-types 5.20260930.2, Node 22); British spelling; no emojis | P2 §0; P4 §0; P5 §0 |
| G36-2 | **Vercel stays deployable and is the rollback target until the Phase 3 gate (S17) and stays untouched until the owner's decommission.** No unit edits, moves or deletes `vercel.json`, `middleware.ts`, `middleware/**`, `api/**`, `lib/**`, `.github/workflows/auto-merge-claude.yml`, `scripts/dev-server.js`, `scripts/freecad-unfold/**`, `.github/workflows/xometry-scan.yml`, `docs/AWS_S3_VERCEL_GUIDE.md`, `public/laserkritis/**`, `public/cookie-consent.html`. Every such change exists only as an action of the owner-run `scripts/phase6/cleanup.sh` (CL6) plus prepared files under `docs/migration/phase6/` | PLAN.md:344, :357, :492-493 |
| G36-3 | Anything added to `workers/site/wrangler.jsonc` leaves a preview upload (`cf-preview.yml`, top level) unchanged in behaviour: routes only in the `env.production` block; new top-level vars only with values that select today's behaviour (`legacy`, `parity`); no new binding or secret | p3 §2.1, §2.8; verify 2026-10-04 (identical bundle, T1/T2 green) |
| G36-4 | Frontend changes reach Vercel production on merge (P2 G-6) and must be correct on both platforms at merge time and after a rollback to Vercel (§7) | PLAN.md:43; P4 §8; P5 §9 |
| G36-5 | Database changes are migration files only, never applied by a builder; each is tested on PGlite against definitions rebuilt from live (pattern `../phase4/pglite`, `../rlstest`, `phase36/pglite`). The P6-2 access-model migration is **not committed to the public repository before the owner has applied it** (F36-9); it ships to the owner privately | PLAN.md:44; CANON.md §1 |
| G36-6 | Public-repo wording: code comments, test names, READMEs, `MANUAL_STEPS.md` and commit messages state the rule a change enforces ("requests need a staff session"), never what is open today; no reference to Appendix P, `gates_PRIVATE.md`, `SECURITY_PRIVATE.md` or private finding IDs (`P-n`, `P6A-n`, `X-n`, `N-n`; write "private note"); secret-shaped test literals are built at runtime. §0-§11 of this spec follow the same rule | P2 G-5; P5 G5-7 |
| G36-7 | Work starts from the commit that closes the Phase 5 build (wave order of §3.4). Phase 4 §7.1 and Phase 5 §8 freeze files that this spec changes (`workers/site/src/preview.ts`, `workers/site/src/api/files.ts`, `workers/site/wrangler.jsonc`, `index.html`, `public/robots.txt`, `supabase/functions/leads-api/**`, `docs/migration/**`); landing a Phase 3/6 change earlier would fail their frozen-path checks (P4 G4-6). Only units Z3, RR3 and DB6's private part (§3.4 wave A) touch no frozen file and may start now that Phase 2 is closed (`614847c`). Never stage, revert or reformat another agent's changes | P4 §7.1; P5 §8; P2 G-4 |
| G36-8 | Log prefixes `[microns-site]` (site) and the edge-function convention of the file being changed; never log tokens, cookies, Access assertions, request bodies or e-mail addresses | P2 G-7 |

---

## 1. Fixed decisions (binding; each resolves a point between the annexes or a gap they left)

| ID | Decision | Reason | Source |
|---|---|---|---|
| F36-1 | Production config is an `env.production` block of `workers/site/wrangler.jsonc` with `"name": "microns-site"`; it holds the two Worker routes and full copies of every non-inherited key (`vars`, `secrets`, `kv_namespaces`, `services`, `r2_buckets`, `ratelimits`). Top-level `routes` stays `[]` | wrangler reads an env block only with `--env` (cli.js:20401-20448); vars and bindings are not inherited (cli.js:19995-20008); without its own name the env targets a second Worker `microns-site-production` (cli.js:21164-21172); test/env-api.test.ts:281 pins top-level `routes: []` | p3 D3-1, §2.1 |
| F36-2 | `workers/site/wrangler.jsonc` has **one** owner in this phase (PC3). PC3 writes every Phase 3/6 config entry: the env block and the top-level vars `ARTICLES_STORE: "legacy"`, `PUBLIC_FILES_ORIGIN: "https://files.micronshub.eu"`, `API_CORS_MODE: "parity"` (the same three in `env.production`). AS3 and CO6 only read them | One owner per file (P2 G-1); p3 and p6-app both edited the file (p3 §2.2; app §2.2) | this spec |
| F36-3 | The P6-4 CORS var is declared as `interface CorsModeEnv extends Env { API_CORS_MODE?: string }` in `workers/site/src/preview.ts`; `src/env.ts` stays unchanged and `test/env-api.test.ts` changes only at its KV-ID assertion (§3.3 row 15, F36-17) and by the owner-run E17 (deviation from the p6-app patch, which edited both for CORS) | Phases 4 and 5 keep `src/env.ts` unchanged and extend `Env` per module because env-api pins the Phase 2 block (P4 §3.2 row `src/env.ts`; P5 §5.1 `CadCompatEnv`); verify 2026-10-04: tsc clean, 1,125/1,125 | app D6-6, R6-5 |
| F36-4 | Production uploads are tagged `prod-<first 12 hex of the commit SHA>`; the production `deploy` action refuses any version whose tag is not of that form or whose `API_MACHINE_HOSTS` binding differs from `env.production` (checked on `wrangler versions view <id> --env production --json`) | Preview uploads and production versions belong to the same Worker; deploying a preview-config version would put preview vars on `www` | cli.js:176360, :355440-355500; p3 §2.4 (no such guard in the draft) |
| F36-5 | Changing a site secret from S11 on (including the S11 Turnstile secret itself) = `npx wrangler versions secret put <NAME> --env production` (new version, not deployed), then a production `upload` (inherits secrets from the previous version) and `deploy`; never `wrangler secret put` or a top-level `wrangler deploy` on `microns-site` after S11. Before S11 the same rule holds without `--env production` (the next preview upload inherits the secret). `MANUAL_STEPS.md` writes this procedure into every site-secret row (MS6-3) | `secret put` refuses while the newest version (often a preview upload) is not deployed (cli.js:305362-305376); uploads keep unchanged secrets (`keepSecrets: true`, cli.js:176352-176354); secrets belong to the Worker, so preview and production versions share them (cli.js:171317-171335) | this spec; critique C-3, C-16 |
| F36-6 | **Rule:** every proxied hostname of the zone that `microns-site` must not answer gets a scriptless (negating) route `<host>/*` before its record is proxied. At S11, **before** the `routes` action creates `*.micronshub.eu/*`: `files.micronshub.eu/*`, `mcp.micronshub.eu/*` and the CAD Tunnel host `cad-vps.micronshub.eu/*` (the name Phase 4 proposes for OW-11; a route on a host without a record is inert; if OW-11 picks another name or the HTTPS fallback, Claude changes the payload). Every later host (the Mac mini Tunnel host of Q22, any Tunnel- or Access-only host) gets its route before its record is proxied (OW3-13) | Routes act on proxied hostnames in front of the origin (CF docs (fetched 2026-10-04) workers/configuration/routing/routes, `p3work/cfdocs/workers_configuration_routing_routes.md:23`), so the wildcard matches every first-level host; a route without a Worker negates less specific patterns and a route on the same host runs before a Custom Domain (:27, :143-149); without it a Tunnel host would get the site (workers/site/src/preview.ts:56 treats every `*.micronshub.eu` host as production; unknown `/api/*` paths are forwarded, workers/site/src/api/router.ts:79-80); same-zone `fetch()` may skip routes (:27) but queue, workflow and cron invocations of `microns-ops` are not zone-bound (unverified, so the route is created either way); Phase 4 OW-5 asks Phase 3 to leave `mcp.` free (PHASE4_SPEC.md:1291), OW-11 picks the Tunnel path (PHASE4_SPEC.md:1297); Mac mini Tunnel: docs/migration/AGENTS.md:631 | p3 D3-7 (timing and scope changed); critique C-1 |
| F36-7 | Both redirect rules (HTTP → HTTPS, apex → www) are applied at S11 in one ruleset payload; each acts only on proxied hostnames, so the apex rule takes effect when the apex record is proxied at S13 (rollback: un-proxy the record) | No enable/disable toggle between S11 and S13; a DNS-only record never reaches Cloudflare's rules (verify at execution) | p3 §2.7; PLAN.md:572-573 |
| F36-8 | P3-6 article images: one branch at the top of `handleFiles` (after the scope is known) sends scope `articles` to `handleArticlesR2()` of the new `workers/site/src/api/articles-store.ts` when `ARTICLES_STORE` is `r2`; with any other value `files.ts` runs exactly the Phase 2 code | Smallest change to a Phase 2 file (pattern of P4 §7.2 `scan-directory.ts` row); `files.ts` was restructured by the Phase 2 repair (workers/site/src/api/files.ts:147-331), so the p3 multi-point integration list no longer fits | p3 D3-11, §5.2 |
| F36-9 | The P6-2/P6-3 access-model migration and its removal script are delivered to the owner privately and committed to the repository only after the owner has applied them (`supabase/migrations/<apply date>_rls_remediation.sql`, `supabase/rollback/<apply date>_rls_remediation_down.sql`, Phase 4's rollback folder). The full harness (pre-state dumps, before-assertions, mutants) stays private and travels in the owner's bundle; with the post-apply commit a rules-only copy built on the post-apply state is committed as `supabase/tests/rls/` (the PLAN P6-2 "policy tests", DV36-10) | Security detail stays private until applied (RISKS.md:66 keeps the details private; CANON.md §1); Phase 4 keeps its removal script outside `migrations/` (PHASE4_SPEC.md:148) and commits a sanitised harness copy while assertions that depend on live grants stay private (PHASE4_SPEC.md:149, :1449-1457); the scratchpad is session-specific, so the owner keeps the bundle (OW6-2) | rls §1, §10 (repo paths were an open question); critique C-9 |
| F36-10 | The `cdn.gpteng.co` script element (index.html:89-90) is removed by the build (unit RS6) in **its own commit** that touches only `index.html`, not by the cleanup; if the owner declines D6-14, that commit is reverted alone and the rest of RS6 stays | Platform-neutral (both platforms serve the same `index.html`); an unused third-party editor script leaves every page; one parity difference instead of the two-step cleanup procedure of app §5.5 | app D6-18 (option b made the default); private note; critique C-12 |
| F36-11 | Retiring the Vercel forward (P6-5) is a cleanup group: `API_FORWARD_ORIGIN` becomes `""` in both env blocks (edit E16) and the env-api expectation follows (E17); with an empty origin every forward answers 502 without an outbound request | workers/site/src/api/forward.ts:79-87 (`new URL(path, "")` throws → `upstreamError()`, :67, :86); unknown `/api/*` paths and the rollback flag use the forward (router.ts:79-80; forward.ts:120-135); the origin is a `*.vercel.app` host (wrangler.jsonc:90) | app R6-7; private note |
| F36-12 | Phase 3 payload files live under `scripts/phase3/payloads/` (`zone-routes.json`, `redirect-rules.default.json`), not under `docs/migration/phase3/` | Keeps RR3 free of frozen `docs/migration/**` (G36-7) | p3 §6 (paths changed) |
| F36-13 | The P3-6 README item is met by a Deployment section whose text is true before and after the flip ("production is served by Vercel until the Phase 3 cutover, then by the Cloudflare Worker `microns-site`; current state: docs/migration/PLAN.md §6"), merged with the build; the full rewrite stays the P6-6 cleanup move of `docs/migration/phase6/root-README.md` | No post-S17 commit needed; same rule as the TenantEditPage copy (true on both platforms) | p3 D3-15 (changed), app D6-21 |
| F36-14 | No root `package.json` change at build time; Phase 3/6 commands run as `node …`/`bash …` (the cleanup removes `dev:server` at owner time, E13) | Root `package.json` is a Phase 2 B file frozen by Phase 4 (PHASE4_SPEC.md:1048) | p3 §1.7 (scripts dropped) |
| F36-15 | Edge-function tests of LA6 stay in `tests/edge-functions/` with their own config; Phase 4's `tests/edge/` (unit W) is not reused | Phase 4's config would collect LA6 tests without the Deno stubs; files stay disjoint | app §3.3; PHASE4_SPEC.md:159 |
| F36-16 | Repointing the dashboard buttons that still call ported edge functions (P5 R5-9/D-20) is not part of this build; edge functions whose only caller was a removed cron job are deleted by the owner after a log check (OW6-17) and their repository folders by the opt-in cleanup group I | Phase 4/5 offer no manual-start contract for those jobs (`start` covers `quote`, `rfq_intake`, `test_card`, PHASE4_SPEC.md:678, :1213); the edge functions stay deployed and working (P5 D-20); cron-only targets (`process-article-queue`, `auto-update-sitemap`, `auto-translate-articles`, `tender-collector`) have no caller in `src`, `api`, `lib`, `mcp-server`, `workers` or another function (`git grep`, 2026-10-04) | follow-up FU-5 (§10.3); critique C-7 |
| F36-17 | `workers/site/test/env-api.test.ts` accepts a KV namespace ID that is either the `<KV_ID_…>` placeholder or 32 hex characters (§3.3 row 15, PC3); every other Phase 2 expectation stays as written | The test pinned the placeholders (env-api.test.ts:280) while `cf-preview.yml` refuses them (cf-preview.yml:93-98) and then runs `npm test` (:238-240), so committing real IDs (P2 O-10, OW3-4) would fail both workflows | critique C-2; verify 2026-10-04 |
| F36-18 | From S11 previews and production use the real Turnstile pair: the repository secret `VITE_TURNSTILE_SITE_KEY` becomes the real site key at the same moment as the Worker secret (P2 O-7 says "real site key in the GitHub secret"); the production `upload` refuses an empty or Cloudflare test site key (`check-production.mjs site-key`) | One Worker, one secret set (F36-5); a real secret fails test tokens on preview hosts too (workers/site/src/auth/turnstile.ts:42-50; workers/shared/src/auth/turnstile.ts:77-114) | P2 O-7 (PHASE2_SPEC.md:942); critique C-3 |
| F36-19 | The production workflow runs only from `main` (GitHub environment `production` with deployment branch `main`, plus a first step that refuses any other ref) and its token can read the zone (Zone Read) | `routes` use `zone_name`, which wrangler resolves with a zone lookup (cli.js:159276-159325) | critique C-4 |

---

## 2. Defaults chosen for the owner

Owner instruction: every open question takes the plan's (or the analysis's) recommended default, built as stated and listed here for review. **Owner-sensitive** rows change customer-visible behaviour, security posture or cost and deserve a deliberate yes.

### 2.1 Phase 3

| # | Question | Default built | One-line reason | Source |
|---|---|---|---|---|
| D3-1 | Where the routes live | `env.production` (F36-1) | Preview uploads never see routes | p3 D3-1 |
| D3-2 | Production deploy path | Manual workflow `.github/workflows/cf-site-production.yml`, actions `upload` / `deploy` / `routes`, GitHub environment `production` (owner = required reviewer) | The "Phase 3 production workflow" Phase 4 OW-8 deploys through (PHASE4_SPEC.md:1294) | p3 D3-2 |
| D3-3 | Route application | `wrangler triggers deploy --env production`; fallback `wrangler deploy --env production` | `triggers deploy` is experimental in 4.145.0 (dry run 2026-10-04) | p3 D3-3 |
| D3-4 | Apex and HTTP redirect status | 308 for both until the S11 baseline says otherwise; generator exits 1 on any contradiction | Vercel redirects are 308 (SEO_PARITY.md:150) | p3 D3-4 |
| D3-5 | HTTP → HTTPS mechanism | Redirect rule `(not ssl)`; Always Use HTTPS off | Its status code is undocumented (CF docs always-use-https) | p3 D3-5 |
| D3-6 | Redirect rules as code | Generated Rulesets payload, applied with one `curl` by the owner | Reviewable, repeatable | p3 D3-6 |
| D3-7 | Hosts the wildcard must not answer | Rule of F36-6: a scriptless route per non-site proxied host before its record is proxied; at S11 `files.`, `mcp.`, `cad-vps.`; later hosts (Mac mini, any Tunnel or Access-only host) per OW3-13 | Routes act on every proxied host and win over Custom Domains and Tunnel origins on the same host | p3 D3-7; critique C-1 |
| D3-8 | `api.micronshub.eu` | Wildcard route + proxied record + Access app (P2 D-3) | Most specific route wins; no own route needed | p3 D3-8 |
| D3-9 | Production vars | `API_GATES_MODE` `recipient=report,redirect=report`; `API_MACHINE_HOSTS` `api.micronshub.eu`; `ACCESS_AUD` = preview AUD + API AUD; `HSTS_VALUE` only when the baseline says "worker"; `ARTICLES_STORE` `legacy`; `API_CORS_MODE` `parity` | P2 D-16, D-3, A-11; workers/site/src/auth/access.ts:39 | p3 D3-9 **(owner-sensitive: report mode keeps today's link and recipient behaviour)** |
| D3-10 | TenantEditPage copy | Provider-neutral component, no DNS target named | True on Vercel and Cloudflare | p3 D3-10 |
| D3-11 | P3-6 switch | Var `ARTICLES_STORE` (`legacy` default, `r2`), S3 API with the R2 token extended to `microns-public` (optional `R2_PUBLIC_*` pair), no binding, branch per F36-8 | Merges before `files.micronshub.eu` exists | p3 D3-11 |
| D3-12 | R2 key layout | `articles/<browser key>` | Delete-by-URL-path and list-by-prefix keep working without a frontend change | p3 D3-12 |
| D3-13 | dns-parity TXT and TTL | TXT strings joined; TTL ignored unless `--ttl exact` or `--ttl max:<s>` | RFC 7208 §3.3; Cloudflare re-splits at 255 | p3 D3-13 |
| D3-14 | Wildcard at empty non-terminals | `EXPECTED_ENT`, not a failure | Papaki follows RFC 4592, Cloudflare does not (live DoH 2026-10-04) | p3 D3-14 |
| D3-15 | README timing | Section true on both platforms, merged with the build (F36-13) | No post-gate commit | p3 D3-15 changed |
| D3-16 | `cf-preview.yml` | `--env=""` on the dry run and the upload, nothing else | Explicit top level, no warning | p3 D3-16 |
| D3-17 | Article upload rules in `r2` mode | Image types only (`jpg`, `jpeg`, `png`, `webp`, `gif`, `avif`; Content-Type must match the extension), size required and ≤ 5 MiB (signed as Content-Length) for every principal; the browser sends `size` (one-line change, harmless on Vercel and in `legacy` mode) | The bucket is public on a site subdomain; 5 MB is the media library's own limit | p3 §5.2; private note **(owner-sensitive)** |
| D3-18 | Production version guard | F36-4 | Same Worker for preview and production | this spec |
| D3-19 | Slug blocklist (`www`, `api`, `files`, `mcp`, `rfq`, `send`) on tenant save | Not built (follow-up FU-1) | Optional in p3 §3; super-admin-only form | p3 §3 |
| D3-20 | Turnstile keys from S11 | Real pair for previews and production: Worker secret via F36-5 and the repository secret `VITE_TURNSTILE_SITE_KEY`, both at S11 (F36-18) | One Worker, one secret set | P2 O-7; critique C-3 |
| D3-21 | Production workflow access | GitHub environment `production`: required reviewer = owner, deployment branch `main`; token adds Zone Read (F36-19) | Routes by `zone_name` need a zone lookup; uploads only from reviewed code | critique C-4 |

### 2.2 Phase 6: database (P6-2, P6-3)

| # | Question | Default built | One-line reason | Source |
|---|---|---|---|---|
| D6-DB-1 | Who is staff in new policies | `public.is_staff()` | Matches the existing `*_staff_all` policies | rls D-1 |
| D6-DB-2 | Tenant-scoped rows | Members read, tenant admins write | Live has no `tenant_user` holder who would lose access | rls D-2 **(owner-sensitive)** |
| D6-DB-3 | Public reads to keep | Published articles, titles, generation logs, silo categories, catalogue, products; partner directory for signed-in users | Private-note default; narrowing = FU-6 | rls D-3 |
| D6-DB-4 | Server-only tables | No policy (`article_generation_queue`, `gsc_index_log`); advisor INFO 2 → 4 accepted | Service role only | rls D-4 |
| D6-DB-5 | `logs` | Staff read/write; authenticated insert kept | — | rls D-5 |
| D6-DB-6 | Storage | `rfq-files`, `quote-files` private; object reads follow `public.rfq_files` visibility; sitemaps public read, server writes; bucket listing staff, creation super admin (`tenant-*`) | Phase 5 keeps Storage as the sitemap source (PHASE5_SPEC.md:56) | rls D-6 **(owner-sensitive)** |
| D6-DB-7 | Tenant logo uploads | No object policy (FU-7) | Feature has no working policy today | rls D-7 |
| D6-DB-8 | `search_path` | `public, pg_temp` on the 20 flagged functions | Postgres docs | rls D-8 |
| D6-DB-9 | EXECUTE | anon: `create_public_rfq`; authenticated: 12 helpers + `next_po_number` + `create_public_rfq`; inventory RPCs and trigger functions: service role | Helpers must run as the querying role; Phase 2 calls `rpc/my_rfq_ids` (workers/site/src/auth/db.ts:86) | rls D-9 |
| D6-DB-10 | Drift | Strict `DROP POLICY` + post-condition block; any drift aborts | Fail closed | rls D-10 |
| D6-DB-11 | Token/secret storage moves | Owner + later code under P6-3/P6-1 | Coupled to code in three places | rls D-11 |
| D6-DB-12 | `pg_net` | Owner step after Phase 5 unschedules the HTTP cron jobs | Not relocatable | rls D-12 |
| D6-DB-13 | Apply timing | Any time after review; independent of the cutover and identical for both frontends | Database-only | rls D-13 |
| D6-DB-14 | Pre-apply test on live | Same file with final `COMMIT;` → `ROLLBACK;` | Single transaction + post-conditions | rls D-14 |
| D6-DB-15 | Anon table REVOKEs on staff tables | Not done (FU-8) | RLS is the boundary | rls D-15 |
| D6-DB-16 | Signed-in `create_public_rfq` error (DBO-1) | Separate migration plus removal script (`supabase/rollback/`), committed with the build, applied by the owner (any order) | Functional bug: signed-in quote submissions fail | rls D-16, O-1 (renamed DBO-1 here: P2 owns the IDs O-n) **(owner-sensitive: fixes a broken flow)** |
| D6-DB-17 | Repo paths and commit time | F36-9 | Public repo | rls open question |
| D6-DB-18 | Quote-form file references (DBO-2) | Not changed (FU-9) | Needs a server-side design (private note) | rls O-2 |
| D6-DB-19 | Server code with a key fallback (`api/tenders.js:22-25`, `api/tender-scan.js:31-34`, `api/funded-startups.js:23-26`, `mcp-server/src/index.ts:28`) | Not changed; rule: tenders, funded startups and the lead tables are staff-only after P6-2, so every server caller runs with the service key. OW6-2 first confirms the key name in the Vercel production env and in the local MCP configuration | The files are frozen until the cleanup; the Worker port holds the service key as a required secret (workers/ops/wrangler.jsonc:60) | rls F-6 (changed); critique C-5 |
| D6-DB-20 | Browser bucket helpers | Not deleted; `src/utils/fileStorage.ts` is imported by 4 live files (RFQPage, OrderDetailsPage, QuotesPage, PartFilesView; grep 2026-10-04); `mediaStorage.ts`, `RfqStorageDebug.tsx`, `MicronsMultiStepForm.tsx` have no importer (FU-10) | p6-rls F-7 called all of them dead; bucket creation follows D6-DB-6 after P6-2 | rls F-7 (corrected) |

### 2.3 Phase 6: application and cleanup (P6-4, P6-5, P6-6)

| # | Question | Default built | One-line reason | Source |
|---|---|---|---|---|
| D6-1 | Recovery flow | Implicit flow; page decides on the session | supabase-js 2.101.1 defaults (GoTrueClient.js:17-30); src/integrations/supabase/client.ts:15 | app D6-1 |
| D6-2 | Site-URL fallback | AuthContext forwards `PASSWORD_RECOVERY` to `/reset-password` | Redirect allow-list may lack the path | app D6-2 |
| D6-3 | Dead "Forgot password?" link | `<Link to="/reset-password" rel="nofollow">` | src/pages/Login.tsx:316-318 | app D6-3 |
| D6-4 | Indexing of `/reset-password` | robots.txt Disallow + `noindex, nofollow`; no language variant, sitemap or prerender | Like `/login` (public/robots.txt:29) | app D6-4 |
| D6-5 | Minimum password length | 6 | Same as registration (Login.tsx:94) | app D6-5 |
| D6-6 | CORS switch | Var `API_CORS_MODE` (`parity` default), applied in `finalise()`; `CorsModeEnv` (F36-3) | Every answer passes `finalise()` once (workers/site/src/index.ts:115) | app D6-6…D6-8 |
| D6-7 | CORS switch-on | After S17: preview first, then production | Observation window | app §2.4 **(owner-sensitive)** |
| D6-8 | `leads-api` credential | Staff Supabase session (`admin`, `sales_rep`, `production_manager`, `accountant`), fail closed 401/403/503, `OPTIONS` open, `verify_jwt` stays false | Only caller is a staff page | app D6-9…D6-12 |
| D6-9 | `leads-api` repo text | Live v7 byte for byte + one import + one marked block, proven by a hash test | Repo differs from live at line 263 today | app D6-11 |
| D6-10 | Access on `/dashboard*` | Prepared, off; `www.micronshub.eu/dashboard` only; `/customer*`, `/partner*`, `/api` not covered | External users have no Access identity | app D6-13 **(owner-sensitive)** |
| D6-11 | `middleware/`, `api/` moves | Not moved | 17 SEO imports and both Workers import them | app D6-14, D6-15 |
| D6-12 | `vercel.json`, `middleware.ts` | `git mv` to `reference/vercel/` (frozen parity reference), consumers repointed | Keeps the regression tests | app D6-16 |
| D6-13 | Cleanup mechanics | `scripts/phase6/cleanup.sh` (dry run default; `--apply --decommissioned`; refuses `main`/dirty; stages, never commits) | app §5.3 | app D6-17 |
| D6-14 | `cdn.gpteng.co` script | Removed by the build in its own `index.html`-only commit (F36-10); declined at OW6-1 → that commit is reverted alone, the reset flow and the rest of RS6 stay | Platform-neutral; the tag carries the editor's "do not remove" comment (index.html:89), so removal most likely ends the Lovable (GPT Engineer) editor's in-page features for this project; decline D6-14 if that editor is still used | app D6-18 changed **(owner-sensitive: PLAN.md:491 calls it an owner decision)** |
| D6-15 | Phase 5 hand-over deletions | `xometry-scan.yml`, `supabase/functions/{check-replies,process-followups,process-warmup,fix-broken-tables}` | PHASE5_SPEC.md:83, :653, :739 | app D6-19 |
| D6-16 | Static files | `--with-statics` opt-in after the log check | PLAN.md:493 | app D6-20 |
| D6-17 | `gsc-*` repo folders (Phase 5 OW5-20) | `--with-gsc-functions` opt-in, only after the owner confirmed no caller and deleted the functions | PHASE5_SPEC.md:928 | this spec |
| D6-18 | README | Prepared `docs/migration/phase6/root-README.md`, moved by the cleanup | app D6-21 | app D6-21 |
| D6-19 | Prerender plugin | Kept | Owner decision | app D6-22 |
| D6-20 | Vercel forward after decommission | Retired by the cleanup (F36-11); `--keep-forward` skips it | A deleted project's host could be claimed by someone else | app R6-7 |
| D6-21 | Dashboard buttons on old edge functions | Unchanged (F36-16) | No contract to call | P5 R5-9 |
| D6-22 | RFQ creation behind the site gate | Not built (FU-11) | The quote form must keep working on Vercel until decommission; needs a fallback design like P5 §9 | rls follow-up (private note) **(owner-sensitive)** |
| D6-23 | Edge functions without a caller after Phase 5 (`process-article-queue`, `auto-update-sitemap`, `auto-translate-articles`, `tender-collector`) | Owner deletes them after a 14-day log check (OW6-17); repository folders by the opt-in cleanup group I `--with-cron-functions` | No deployed function without a caller; their schedules end with P5 OW5-17 | P5 D-20; live cron 2026-10-04; critique C-7 |
| D6-24 | Tenant host matching; browser call to the Supabase admin API (P6-4 items of the private note) | Built (unit TH6): exact `micronshub.eu` suffix match; the back-fill block that calls the admin API is removed (it cannot succeed with the public key, so the customer list is unchanged); a staff back-fill route is FU-14 | Same result on both platforms; no behaviour change for any served host | private note; critique C-6 |
| D6-25 | Vercel deployment host after the flip | Owner option OW6-18 (recommended after S17): Vercel Firewall rule for the project's `*.vercel.app` hosts; removing the rule restores the `api.forward_to_vercel` rollback flag; DNS rollback is unaffected | Vercel stays paused-not-deleted for 30 days (PLAN.md:478) | private note; critique C-8 **(owner-sensitive)** |
| D6-26 | P6-2 policy tests in the repository | After the owner applied P6-2: `supabase/tests/rls/` with post-apply definitions and rule-worded after-state cases only (DV36-10); the full harness stays in the private bundle | PLAN.md:475 asks for policy tests; Phase 4 commits a sanitised copy the same way (PHASE4_SPEC.md:149) | critique C-9 |

---

## 3. Layout and file ownership

### 3.1 Units (one builder each; disjoint files; none overlaps a Phase 2/4/5 unit file except at the extension points of §3.3)

| Unit | Scope | PLAN tasks | Design source (read it; this spec wins where it differs) | Effort |
|---|---|---|---|---|
| **Z3** | DNS parity tool | P3-1 (S2-S10, S12-S16 checks) | p3 §1; prototype `p3work/proto/scripts/dns-parity*` | 0.25 d (copy + README) |
| **RR3** | Redirect-rule generator, payload files, owner command sheet | P3-3, P3-4 | p3 §2.6-§2.7; prototype `p3work/proto/scripts/phase3/` | 0.25 d |
| **PC3** | Production config: `env.production`, guard test, production workflow, preview workflow flag, production check script, the env-api KV-ID assertion (F36-17) | P3-3, P3-4 (+ the config entries of P3-6, P6-4, P6-5) | p3 §2.1-§2.5, §2.8; drafts `p3work/drafts/{workers/site,.github}`; `spec-verify/site-combined.diff` | 0.75 d |
| **AS3** | Article images in R2 behind `ARTICLES_STORE` | P3-6 (images) | p3 §5; draft `p3work/drafts/workers/site/src/api/articles-store.ts` | 0.75 d |
| **TD3** | Tenant domain copy, README Deployment section | P3-6 (copy, README) | p3 §3-§4; drafts `p3work/drafts/src/**`, `README-deployment-section.md` | 0.25 d |
| **DB6** | Access-model migration bundle (private, with the harness), removal script, DBO-1 fix and its removal script (repo), harness re-run; after the owner applied P6-2: the migration, its removal script and the public policy tests `supabase/tests/rls/` | P6-2 (incl. policy tests), P6-3 (database part) | rls §1-§10; `rls_remediation.sql`, `rls_remediation_down.sql`, `create_public_rfq_fix.sql`, `create_public_rfq_fix_down.sql`, `pglite/` | 0.5 d + 0.5 d after apply |
| **RS6** | `/reset-password`, AuthContext hand-over, Login link, robots line (commit 1); `cdn.gpteng.co` removal (commit 2, `index.html` only) | P6-4 (reset), P6-6 (index.html) | app §1; `p6-app.patch` hunks for these files | 0.5 d |
| **CO6** | CORS switch wiring | P6-4 (CORS) | app §2; patch hunks + F36-3; `spec-verify/site-combined.diff` | 0.25 d |
| **LA6** | `leads-api` caller authentication + LeadMonitorPage token | P6-4 (H-6) | app §3; patch hunks | 0.25 d |
| **TH6** | Exact tenant-host matching; remove the browser back-fill that calls the Supabase admin API | P6-4 (items of the private note, PLAN.md:477 "application hardening") | §4.12; private note | 0.25 d |
| **CL6** | Post-cutover cleanup tooling, prepared Phase 6 docs (README, reference note, Access config) | P6-5 (forward), P6-6, P6-4 (Access config) | app §4-§6; patch hunks for `scripts/phase6/**`, `docs/migration/phase6/**`; additions of §4.10 | 0.75 d |
| **MS6** | `docs/migration/MANUAL_STEPS.md` compiled from the owner rows of PLAN.md §5.0-§5.1 and the open questions, plus the four owner checklists | — | PLAN.md:82-94, :106-116, §8 questions; P2 §6, P4 §12, P5 §10, this spec §9 | 0.25 d |

### 3.2 Tree and owners (`+` new, `~` changed at an extension point, `=` unchanged; `(owner-run)` = changed only by `cleanup.sh`)

```
scripts/
  dns-parity.mjs                                   + Z3   CLI (§4.1)
  dns-parity/lib/{types,names,rdata,wire,zonefile,cfapi,zonesim,sources,compare,defaults,run,report}.mjs   + Z3
  dns-parity/test/{wire,zonefile,zonesim,run}.test.mjs   + Z3   27 cases, no network
  dns-parity/fixtures/{papaki.zone,cloudflare.json,cloudflare-drift.json,capture.txt,doh-micronshub-mx.bin}   + Z3   synthetic or public data only
  dns-parity/README.md                             + Z3   usage + the runbook command table (§4.1)
  phase3/redirect-rules.mjs                        + RR3
  phase3/test/redirect-rules.test.mjs              + RR3  5 cases + 1 payload-file case
  phase3/payloads/{redirect-rules.default.json,zone-routes.json}   + RR3  (F36-12)
  phase3/README.md                                 + RR3  owner command sheet: S11 order, curl lines with $ZONE_ID/$CLOUDFLARE_API_TOKEN placeholders
  phase6/{cleanup.sh,cleanup-edits.mjs}            + CL6
  phase6/test/cleanup.test.mjs                     + CL6
workers/site/
  wrangler.jsonc                                   ~ PC3  (§3.3 row 1); E16 (owner-run)
  scripts/check-production.mjs                     + PC3  (§4.3)
  test/env-production.test.ts                      + PC3
  test/check-production.test.ts                    + PC3
  src/api/articles-store.ts                        + AS3
  src/api/files.ts                                 ~ AS3  (§3.3 row 3)
  test/articles-store.test.ts                      + AS3  (not `files-*`: that name pattern is Phase 2 unit S's)
  r2/cors.public.json                              + AS3
  src/preview.ts                                   ~ CO6  (§3.3 row 5)
  test/cors-mode.test.ts                           + CO6
  src/env.ts                                       =      (F36-3)
  test/env-api.test.ts                             ~ PC3  (§3.3 row 15, KV-ID assertion only); E17 (owner-run)
.github/workflows/
  cf-site-production.yml                           + PC3
  cf-preview.yml                                   ~ PC3  (§3.3 row 2)
  auto-merge-claude.yml, xometry-scan.yml          =      deleted only by cleanup.sh (owner-run)
src/
  components/tenants/CustomDomainInstructions.tsx  + TD3
  pages/dashboard/tenants/TenantEditPage.tsx       ~ TD3
  utils/articleImageStorage.ts                     ~ AS3  (one property)
  pages/ResetPassword.tsx, utils/passwordRecovery.ts   + RS6
  App.tsx, contexts/AuthContext.tsx, pages/Login.tsx   ~ RS6
  pages/dashboard/LeadMonitorPage.tsx              ~ LA6
  utils/tenantApi.ts                               ~ TH6  (§3.3 row 16)
  pages/dashboard/CustomersPage.tsx                ~ TH6  (§3.3 row 17)
  pages/dashboard/XometryQueuePage.tsx             =      E14 (owner-run)
index.html                                         ~ RS6  (F36-10)
public/robots.txt                                  ~ RS6
README.md                                          ~ TD3  Deployment section (F36-13); replaced by cleanup.sh (owner-run)
tests/frontend-api/
  tenant-domain-copy.test.tsx                      + TD3
  article-image-upload.test.ts                     + AS3  (body carries `size`)
  reset-password.test.tsx                          + RS6
  leads-api-callers.test.ts                        + LA6
  tenant-host.test.ts, admin-api-usage.test.ts     + TH6
tests/edge-functions/{vitest.config.mjs,stubs/deno-serve.ts,stubs/supabase-js.ts,leads-api-auth.test.ts}   + LA6
supabase/
  functions/leads-api/index.ts                     ~ LA6  live v7 + marked block
  functions/leads-api/staff-auth.ts                + LA6
  migrations/<build date>_create_public_rfq_qualified_columns.sql   + DB6  (DBO-1; committed with the build)
  rollback/<build date>_create_public_rfq_qualified_columns_down.sql   + DB6  (previous definition; committed with the build)
  migrations/<apply date>_rls_remediation.sql      + DB6  committed only after the owner applied it (F36-9)
  rollback/<apply date>_rls_remediation_down.sql   + DB6  same
  tests/rls/{package.json,package-lock.json,schema_after.sql,fixtures.sql,test.mjs,README.md}   + DB6  same (rules-only copy on the post-apply state, §4.9)
docs/migration/
  phase6/{root-README.md,reference-vercel-README.md,access-dashboard.json,access-dashboard.md}   + CL6
  MANUAL_STEPS.md                                  + MS6
reference/vercel/{vercel.json,middleware.ts,README.md}   created only by cleanup.sh (owner-run)
```

Private (scratch, never in the repo): `phase36/release/` (DB6 bundle for the owner incl. a copy of the harness, §4.9), `phase36/pglite/` (harness), `phase36/live/` (dumps). The scratchpad is session-specific: the owner keeps the bundle attachments, and a later session re-creates the public test copy from them.

### 3.3 Extension points in files written before this phase (the only allowed edits; owner unit last)

| # | File (written by) | Exact change | Unit |
|---|---|---|---|
| 1 | `workers/site/wrangler.jsonc` (P1, P2 B) | (a) top-level `vars`: append `ARTICLES_STORE: "legacy"`, `PUBLIC_FILES_ORIGIN: "https://files.micronshub.eu"`, `API_CORS_MODE: "parity"`, each with a one-line rule comment; (b) the comment above top-level `routes` points to `env.production` (`routes` stays `[]`); (c) a new `env.production` block at the end (§4.2). Nothing else changes | PC3 |
| 2 | `.github/workflows/cf-preview.yml` (P1, P2 B) | `--env=""` on `npx wrangler deploy --dry-run` (cf-preview.yml:245) and on `npx wrangler versions upload` (:269); nothing else (the name guard at :107 reads the first `"name"`, still the top level) | PC3 |
| 3 | `workers/site/src/api/files.ts` (P2 S) | One import line `import { articlesStore, handleArticlesR2 } from './articles-store';` and, inside `handleFiles`'s `try` right after `const scope = …` (files.ts:309) and before `storesFor`, one statement: `if (scope === 'articles' && articlesStore(i.env) === 'r2') return await handleArticlesR2({ action: r.action, rawAction: r.rawAction, body, env: i.env, constraints: i.constraints, fetchImpl, respond: handlerJson });`. Nothing else; `git diff --stat` ≤ 3 added lines | AS3 |
| 4 | `src/utils/articleImageStorage.ts` (pre-migration) | `size: file.size,` added to the `presign-upload` body (articleImageStorage.ts:28-34) | AS3 |
| 5 | `workers/site/src/preview.ts` (P1) | import `applyAllowlistCors` from `../../shared/src/http/cors`; `export interface CorsModeEnv extends Env { API_CORS_MODE?: string }`; exported `corsMode(env: CorsModeEnv)`; `finalise(response, request, env: CorsModeEnv)`; one block after the existing header rules (§4.6). `src/index.ts` unchanged (it passes `Env`, assignable to `CorsModeEnv`) | CO6 |
| 6 | `src/App.tsx` (pre-migration; P4 W adds two routes) | one `lazy()` import of `./pages/ResetPassword`; one `<Route path="/reset-password" …>` next to the legacy `/login` route, before the `/:lang` routes | RS6 |
| 7 | `src/contexts/AuthContext.tsx` | in the existing `onAuthStateChange` callback: `PASSWORD_RECOVERY` outside `/reset-password` → `navigate('/reset-password', { replace: true })` | RS6 |
| 8 | `src/pages/Login.tsx` | the `href="#"` "Forgot password?" anchor (Login.tsx:316-318) → `<Link to="/reset-password" rel="nofollow">` | RS6 |
| 9 | `public/robots.txt` | `Disallow: /reset-password` after `Disallow: /login` (robots.txt:29) | RS6 |
| 10 | `index.html` | remove the `cdn.gpteng.co` comment and script element (index.html:89-90) | RS6 |
| 11 | `src/pages/dashboard/LeadMonitorPage.tsx` | module-level `leadsApiHeaders(extra)` = `{ apikey: <anon key>, ...await apiAuthHeaders(), ...extra }`; the three `leads-api` fetches (LeadMonitorPage.tsx:113-116, :187-197, :216-222) use it; the `reddit-collector` call stays | LA6 |
| 12 | `supabase/functions/leads-api/index.ts` | replaced by the live v7 source plus one import line and one block between `// P6-4 caller authentication: begin/end` markers after the `OPTIONS` answer | LA6 |
| 13 | `src/pages/dashboard/tenants/TenantEditPage.tsx` | import of `CustomDomainInstructions`; toast description = `DOMAIN_NOT_REACHABLE` (TenantEditPage.tsx:642); the instruction box (:661-684) → `<CustomDomainInstructions slug={form.slug} customDomain={form.custom_domain} />` | TD3 |
| 14 | `README.md` | new `## Deployment` section after `## Project Structure`, Tech Stack rows README.md:49-50 reworded true on both platforms (F36-13) | TD3 |
| 15 | `workers/site/test/env-api.test.ts` (P2 B) | in "Phase 1 entries are unchanged" the `kv_namespaces` entry of the `toMatchObject` (env-api.test.ts:280) is removed and two assertions follow the call: binding names equal `['SEO_CACHE', 'FLAGS']` in order; each `id` matches `^(<KV_ID_[A-Z_]+>\|[0-9a-f]{32})$`. Nothing else (exactly `spec-verify/envapi-kv.diff`) | PC3 |
| 16 | `src/utils/tenantApi.ts` (pre-migration) | `resolveTenantIdentifier(hostname: string = window.location.hostname)`; matching uses `host` = `hostname` lower-cased without one trailing dot; the subdomain branch only for `host === 'micronshub.eu' \|\| host.endsWith('.micronshub.eu')` (replaces `hostname.includes('micronshub.eu')`, tenantApi.ts:38) and splits `host`; the custom-domain branch returns `hostname` as today; `resolveSubdomain()` unchanged | TH6 |
| 17 | `src/pages/dashboard/CustomersPage.tsx` | remove the back-fill block in `fetchCustomers` (CustomersPage.tsx:99-153: `user_roles` read, `supabase.auth.admin.getUserById` loop, re-fetch); the base path from :155 stays. The browser client holds only the public key (src/integrations/supabase/client.ts:5-6, :15), so the admin call never succeeds and the list is unchanged | TH6 |

Owner-run edits (cleanup.sh, after decommission) are listed in §4.10 and are not build-time changes.

### 3.4 Waves

| Wave | Units | Starts | Gate to the next wave |
|---|---|---|---|
| A | Z3, RR3, DB6 (private bundle and harness only) | any time after `614847c`, the commit that closes Phase 2 (no frozen file touched) | each unit's acceptance (§5) |
| B | PC3, AS3, TD3, RS6, CO6, LA6, TH6, CL6, and DB6's two repo files (DBO-1 migration and removal script) | after the commit that closes the Phase 5 build (G36-7; Phase 4 G4-10 and Phase 5 Wave 3 freeze `workers/site/test`, which row 15 changes); merge order free (files disjoint) | each unit's acceptance |
| D (owner-gated) | DB6 post-apply commit: migration, removal script, `supabase/tests/rls/` | the owner's word "applied" (OW6-2) and the bundle attached back if this session ended | DB6-8…DB6-10 |
| C | MS6, then the cross-unit gate G36 (§5.12) | after B | G36 green |

Order inside wave B where two units touch related code: CO6 and AS3 read the vars PC3 writes; they test with env literals, so they do not wait for PC3, but G36 runs them together. RS6 rebases its `src/App.tsx` hunk on Phase 4 W's routes (`git apply --3way`).

---

## 4. Binding contracts (names, signatures, shapes; bodies per unit)

### 4.1 `scripts/dns-parity.mjs` (Z3)

Interface, sources, name list, normalisation and statuses exactly as p3 §1.1-§1.5 (prototype `p3work/proto/scripts/dns-parity.mjs` is the reference implementation; copy it, do not re-derive).

```
node scripts/dns-parity.mjs --zone micronshub.eu --a <source> --b <source> [options]
node scripts/dns-parity.mjs ds --zone micronshub.eu --via <doh:…|ns:…> --expect absent|present [--key-tag N]
node scripts/dns-parity.mjs names --zone micronshub.eu [--a …] [--b …] [--names file]
sources: ns:<host>[:port] | ns+tcp:<host> | doh:<url>|doh:cloudflare|doh:google|doh:quad9 | zone:<file> | zone+cf:<file> | cfapi:<file> | capture:<file>
exit: 0 equal · 1 DIFF/TTL_DIFF · 2 incomplete (ERROR, UNCOMPARABLE; wins over 1) · 64 usage
```

| Rule | Value |
|---|---|
| Statuses that never fail | `MATCH`, `EXPECTED_ENT`, `EXPECTED_PROXIED`, `ALLOWED`, `SKIPPED`, `FLATTENED_UNVERIFIED` |
| `ns:` answers | must carry AA, else `ERROR "not authoritative"` (this container's UDP/53 is answered by an intercepting resolver, p3 §1.2) |
| Dependencies | none; Node ≥ 20; DoH behind a proxy needs `NODE_USE_ENV_PROXY=1` |
| Extra name check (private note) | `--forbid-target <suffix or IP>` (repeatable): any answer whose RDATA equals or ends with a listed target is `DIFF` with reason `forbidden target`; used after the Vercel project is deleted (§9 OW6-11) |

The `--forbid-target` option is the only addition to the prototype; Z3 adds one `run.test.mjs` case for it (28 cases total).

### 4.2 `env.production` of `workers/site/wrangler.jsonc` (PC3)

| Key | Value |
|---|---|
| `name` | `"microns-site"` |
| `routes` | `[{ "pattern": "www.micronshub.eu/*", "zone_name": "micronshub.eu" }, { "pattern": "*.micronshub.eu/*", "zone_name": "micronshub.eu" }]`; no `custom_domain` |
| `kv_namespaces`, `services`, `r2_buckets`, `ratelimits`, `secrets.required` | identical to the top level (same IDs; same placeholders until S11) |
| `vars` | every top-level var with the same value, except the production values: `ACCESS_AUD` `"<ACCESS_AUD_PREVIEW>,<ACCESS_AUD_API>"`, `API_GATES_MODE` `"recipient=report,redirect=report"`, `API_MACHINE_HOSTS` `"api.micronshub.eu"`; `HSTS_VALUE` only after the S11 generator reports `worker` (never a placeholder) |
| Not repeated (inherited) | `main`, `compatibility_date`, `compatibility_flags`, `assets`, `workers_dev`, `preview_urls`, `observability`, `limits` |

Guard test `workers/site/test/env-production.test.ts` (resolves both environments with the pinned wrangler's `unstable_readConfig`; draft `p3work/envtest/test/env-production.test.ts`):

| Assertion | Detail |
|---|---|
| Same Worker | resolved `name` equal (`microns-site`) |
| Routes | top level `[]`; production exactly the two patterns of the table above |
| Only own keys in the env block | inherited keys come from the top level |
| Everything else equal | every resolved key except `routes` and `vars` deep-equal |
| Vars | equal except `MAY_DIFFER = ['ACCESS_AUD', 'API_GATES_MODE', 'API_MACHINE_HOSTS', 'HSTS_VALUE', 'ARTICLES_STORE', 'API_CORS_MODE']`; production values of D3-9; top level keeps `API_MACHINE_HOSTS: ""`, `ARTICLES_STORE: "legacy"`, `API_CORS_MODE` ∈ {`parity`, `allowlist`}, no `HSTS_VALUE` |

Effect on later phases (documented in the test header): a binding or var added to the site's top level only fails this test.

### 4.3 Production workflow and check script (PC3)

`.github/workflows/cf-site-production.yml`: `workflow_dispatch` only, inputs `action` (`upload` | `deploy` | `routes`), `version_id`, `confirm` (must equal `production`); job `environment: production` (GitHub environment with required reviewer = owner and deployment branch `main` only, OW3-2); first step refuses any `GITHUB_REF` other than `refs/heads/main` (F36-19); `concurrency: cf-site-production`; `permissions: contents: read`. Secrets: `CLOUDFLARE_API_TOKEN` from the environment (production token, OW3-2); `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY` from the repository secrets that `cf-preview.yml` uses. Draft `p3work/drafts/.github/workflows/cf-site-production.yml` plus:

| Action | Steps (binding additions in bold) | Traffic effect |
|---|---|---|
| `upload` | guards **`node workers/site/scripts/check-production.mjs site-key`** (F36-18) and `node workers/site/scripts/check-production.mjs config`; build and checks as cf-preview.yml (keep both in step); `node --test scripts/dns-parity/test/*.test.mjs scripts/phase3/test/*.test.mjs`; dry runs `--env=""` and `--env production`, `cmp` of `index.js`; bundle guard; `npx wrangler versions upload --env production` **`--tag "prod-${GITHUB_SHA::12}"`** `--message …` | none; prints version ID and version preview URL |
| `deploy` | **`npx wrangler versions view "$VERSION_ID" --env production --json > "$RUNNER_TEMP/version.json"` then `node workers/site/scripts/check-production.mjs version "$RUNNER_TEMP/version.json"`**; `npx wrangler versions deploy "$VERSION_ID@100%" --env production --yes --message …`; `wrangler deployments list --env production` to the summary | the version serves workers.dev, and the zone once routes and proxied records exist |
| `routes` | `npx wrangler triggers deploy --env production` (placeholder `dist/index.html` when no build exists, because the command validates the assets directory); listing the zone routes afterwards (5 expected: 2 Worker routes, 3 scriptless) is an owner step (§9 OW3-6), not a workflow step | creates the two Worker routes; inert while records are DNS only |

`workers/site/scripts/check-production.mjs` (Node, no dependency; JSONC comments and trailing commas stripped like test/env-api.test.ts:204):

```
node workers/site/scripts/check-production.mjs config [--config <path>]   # exit 0, or 1 listing every "<…>" placeholder left in env.production, or 64
node workers/site/scripts/check-production.mjs version <version.json> [--config <path>]
  # exit 0 when annotations["workers/tag"] matches ^prod-[0-9a-f]{12}$ AND the plain_text binding API_MACHINE_HOSTS
  # equals env.production.vars.API_MACHINE_HOSTS; else 1 with the reason; 64 on usage or unreadable input
node workers/site/scripts/check-production.mjs site-key
  # reads env VITE_TURNSTILE_SITE_KEY; exit 0 when set and not a Cloudflare test site key (^[123]x0{20}[A-F]{2}$,
  # CF docs turnstile/troubleshooting/testing); else 1; never prints the value
```

### 4.4 Redirect rules and zone routes (RR3)

| Item | Contract |
|---|---|
| CLI | `node scripts/phase3/redirect-rules.mjs --baseline <seo-parity snapshot dir> [--out <file>]` or `--default [--out <file>]`; exit 0 payload written (stdout without `--out`), 1 baseline contradicts an assumption, 64 usage (p3 §2.7) |
| Payload | `PUT /zones/<ZONE_ID>/rulesets/phases/http_request_dynamic_redirect/entrypoint` body with rules `microns_http_to_https` (`(not ssl)`) and `microns_apex_to_www` (`(http.host eq "micronshub.eu")`), targets built from `raw.http.request.uri.path`, `preserve_query_string: true`, status from the baseline (default 308) |
| HSTS advice | prints `HSTS: worker = <value>`, `HSTS: zone = <value>` or `HSTS: none` |
| `payloads/redirect-rules.default.json` | byte-equal to `--default` output (test) |
| `payloads/zone-routes.json` | `routes: [{pattern: "cad-vps.micronshub.eu/*"}, {pattern: "files.micronshub.eu/*"}, {pattern: "mcp.micronshub.eu/*"}]`, all "create at S11 before the `routes` action" (F36-6); no `script` field; a top-level `rule` string states the F36-6 rule for later hosts |

### 4.5 Article images (AS3)

```ts
// workers/site/src/api/articles-store.ts
export const PUBLIC_BUCKET = 'microns-public';
export const PUBLIC_JURISDICTION: 'eu' | '' = '';
export const ARTICLES_PREFIX = 'articles/';
export const ARTICLE_IMAGE_TYPES: Readonly<Record<string, string>>;   // jpg,jpeg→image/jpeg; png; webp; gif; avif
export const ARTICLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export interface ArticlesStoreEnv { ARTICLES_STORE?: string; PUBLIC_FILES_ORIGIN?: string; R2_PUBLIC_ACCESS_KEY_ID?: string; R2_PUBLIC_SECRET_ACCESS_KEY?: string }
export function articlesStore(env: ArticlesStoreEnv): 'legacy' | 'r2';           // 'r2' only for the exact trimmed value "r2"
export function handleArticlesR2(i: {
  action: string; rawAction: string; body: any;
  env: FilesEnv & ArticlesStoreEnv; constraints: FileConstraints; fetchImpl: typeof fetch;
  respond: (status: number, body: unknown) => Response;   // files.ts handlerJson, so framing (charset, weak ETag) is identical
}): Promise<Response>;
```

| Action (`r2` mode) | Behaviour | Answer shape (same keys and statuses as files.ts) |
|---|---|---|
| `presign-upload` | rules of D3-17 for every principal (400 `file_type_not_allowed`, `size_required`, `file_too_large`, `invalid_field` via `apiError`); presigned PUT to `microns-public` key `articles/<prefix>/<safe name>`, 300 s, Content-Type and Content-Length signed | `{uploadUrl, key, publicUrl}`; `key` = R2 key; `publicUrl` = `PUBLIC_FILES_ORIGIN/` + key (invalid or missing origin → thrown → files.ts 500 path) |
| `presign-download` | key starting `articles/` → R2; else legacy bucket as Phase 2 | `{url}` |
| `delete` | same split | `{success: true}` |
| `delete-folder` | prefix starting `articles/` → R2 only; else R2 `articles/<prefix>/` and legacy `<prefix>/` | `{success, deletedCount}` |
| `list` | same split; first pages merged in key order; each `url` from its own store | `{objects: [{key, url, lastModified}]}` |
| other | `400 {"error": "Unknown action: <rawAction>"}` | as files.ts |

Credentials: `R2_PUBLIC_ACCESS_KEY_ID`/`R2_PUBLIC_SECRET_ACCESS_KEY` when both are set, else `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`; endpoint `r2Target(R2_ACCOUNT_ID, '', 'microns-public', …)` (workers/shared/src/storage/s3-presign.ts:29). `workers/site/r2/cors.public.json`: origins and methods as `r2/cors.private.json`. No binding, no `wrangler.jsonc` change by AS3.

### 4.6 CORS switch (CO6)

```ts
// workers/site/src/preview.ts
export interface CorsModeEnv extends Env { API_CORS_MODE?: string }
export type CorsMode = 'parity' | 'allowlist';
export function corsMode(env: CorsModeEnv): CorsMode;   // "allowlist" after trim + lower-case; anything else "parity"; an unknown non-empty value is warned once per value
export function finalise(response: Response, request: Request, env: CorsModeEnv): Response;
// in finalise(), after the existing header rules:
//   if (/^\/api(\/|$)/.test(pathname) && corsMode(env) === 'allowlist')
//     applyAllowlistCors(out.headers, request.headers.get('Origin'),
//       { siteOrigin: env.SITE_ORIGIN, requestHost: normaliseHost(url.hostname), requestIsPreview: isPreviewHost(url.hostname, env) });
```

Status codes are never changed (handler status kept, incl. 204 on `/api/s3` preflight); `workers/shared/src/http/cors.ts` is used as built in Phase 2 (`applyAllowlistCors` :118, `isAllowedOrigin` :78). The config test reads `preview.ts` for `CorsModeEnv` and asserts `src/env.ts` has no `API_CORS_MODE` (verify 2026-10-04).

### 4.7 Reset password (RS6)

| Item | Contract |
|---|---|
| Route | `/reset-password`, no language prefix (already in `NON_LANGUAGE_ROUTES`, src/contexts/LanguageContext.tsx:33), lazy chunk |
| Modes | `checking` → `request` / `update` → `sent` / `done`; first mode from `getSession()`; `PASSWORD_RECOVERY` with a session → `update`; a link error read once from the URL (`otp_expired` → fixed text) beats an older session |
| Calls | request: `useAuth().resetPassword(email.trim())` (src/contexts/AuthContext.tsx:218-231, `redirectTo: origin + '/reset-password'`); update: `supabase.auth.updateUser({ password })`; success → `navigate(getDefaultRoute())` |
| Head | `<meta name="robots" content="noindex, nofollow">` via Helmet |
| Helpers | `src/utils/passwordRecovery.ts`: `MIN_PASSWORD_LENGTH = 6`, `recoveryLinkError(href)`, `passwordProblem(password, confirm)`, type `ResetMode` |

### 4.8 `leads-api` (LA6)

| Item | Contract |
|---|---|
| `staff-auth.ts` (no imports; Deno and Node) | `bearerToken(h)`, `looksLikeUserToken(t)`, `checkStaff(authorization, deps) → {ok: true, userId, roles} \| {ok: false, status: 401 \| 403 \| 503, error: 'unauthorized' \| 'forbidden' \| 'auth_unavailable'}`, `supabaseStaffDeps(client)` |
| Staff roles | `admin`, `sales_rep`, `production_manager`, `accountant` in `user_roles` (any row) |
| `index.ts` | SHA-256 of the file with the marked lines removed = SHA-256 of live v7 (`live-functions/leads-api/index.live-v7.ts`, prefix `9c4b076c`); check after `OPTIONS`, before routing; CORS headers unchanged |
| Frontend | every `leads-api` fetch sends `Authorization: Bearer <session access token>` and `apikey` |
| Deploy | owner, after the frontend serves (§9 OW6-6); `verify_jwt` stays false (supabase/config.toml:32-33) |

### 4.9 Database bundle (DB6)

| Item | Contract |
|---|---|
| Access-model migration | `rls_remediation.sql` unchanged in substance: one transaction, guard "already applied" → abort, drops 92 / adds 57 policies, 11 re-scopes, grants and function settings, Storage policy DDL and `UPDATE storage.buckets` only, post-conditions that abort on any difference (rls §1). Header comment updated to name `supabase/rollback/<apply date>_rls_remediation_down.sql` |
| Removal script | `rls_remediation_down.sql`; aborts unless the migration is applied; never restores the policy dropped on 2026-10-02 |
| DBO-1 fix (repo, with the build) | `supabase/migrations/<build date>_create_public_rfq_qualified_columns.sql` = `create_public_rfq_fix.sql` with comments stating only the rule ("column references are table-qualified"); body, owner, grants and `search_path` otherwise identical; its header names the removal script |
| DBO-1 removal script (repo, with the build) | `supabase/rollback/<build date>_create_public_rfq_qualified_columns_down.sql` = `create_public_rfq_fix_down.sql`: the live definition (`spec-verify/critic_live_cprfq.sql`, equal to 20260806_link_rfqs_to_customers.sql:42-178 except formatting) as `CREATE OR REPLACE` in one transaction, so grants stay; tested by `pglite/down_check.mjs` (body, ACL, `search_path` restored, with and without the access-model migration) |
| Private bundle | `phase36/release/{supabase/migrations/<apply date>_rls_remediation.sql, supabase/rollback/<apply date>_rls_remediation_down.sql, OWNER_APPLY.md, harness/}` (`harness/` = `pglite/` without `node_modules`); `OWNER_APPLY.md` = rls §8 steps 1-6 with the verify query and expected values, plus: (a) a pre-condition before applying while Vercel serves production: the Vercel production environment lists `SUPABASE_SERVICE_ROLE_KEY` (name only) and the local MCP server configuration sets `SUPABASE_SERVICE_KEY`, else set them first or apply after S17; (b) smoke additions `/dashboard/tenders` and `/dashboard/funded-startups` (list and one status change) and one MCP tool call that reads leads; (c) "keep these attachments: Claude needs them back to commit after apply". Handed to the owner as file attachments at the end of the build and kept in scratch |
| Harness | `phase36/pglite/test.mjs` gains `AGENT_FILE` (path of the Phase 4 migration as landed; default the scratch `../../phase4/agent_layer.sql`), so the "Phase 4 before/after" sections test the real file |
| Post-apply commit | on the owner's word "applied" (bundle attached back if this session ended): the two files from the bundle are committed under the apply date, together with the public policy tests below; no pre-state dump, no before-assertion, no mutant |
| Public policy tests (after apply) | `supabase/tests/rls/`: `schema_after.sql` = the objects the tests touch, rebuilt with `live/extract.py` → `build_live.py` from a read-only dump taken **after** the apply (no statement of a policy the migration drops; no assertion on platform grants, PHASE4_SPEC.md:1455 rule P1-c); `fixtures.sql` synthetic rows only (`@example.test`); `test.mjs` = the after-state cases of the harness with rule-worded names ("a customer reads only RFQ files of own RFQs", "anon cannot read leads"), the DBO-1 case and the advisor emulation; `package.json` pins `@electric-sql/pglite` 0.5.8 like `supabase/tests/agent_layer`; `README.md` states what is tested, not what was open |

### 4.10 Cleanup (CL6)

Script contract as app §5.3 (dry run default; `--apply` needs `--decommissioned`; refuses `main`/`master` without `--allow-main` and a dirty tree without `--allow-dirty`; every action TODO / DONE / BLOCKED; all-or-nothing preflight; unknown-consumer scan; stages, never commits; bash 3.2; exit 0 / 1 BLOCKED / 2 refusal), with these changes:

| Change | Detail |
|---|---|
| E15 removed from the script | `index.html` is changed by RS6 at build time (F36-10); `--keep-gpteng` is dropped; a leftover `cdn.gpteng.co` reference in a tracked file (also after the owner reverted the RS6 index.html commit) is reported (not edited, not BLOCKED) |
| New group G "forward retirement" (default on; `--keep-forward` skips) | E16 `workers/site/wrangler.jsonc`: `"API_FORWARD_ORIGIN": "https://on-demand-craft-greece.vercel.app"` → `"API_FORWARD_ORIGIN": ""`, exact count 2 (top level + `env.production`); E17 `workers/site/test/env-api.test.ts`: the expected `API_FORWARD_ORIGIN` value (env-api.test.ts:263) → `''` and the host comparison (:268) → `expect(site.vars.API_FORWARD_ORIGIN).toBe('')`; counts exact, drift → BLOCKED |
| New opt-in group H `--with-gsc-functions` | `git rm -r supabase/functions/{gsc-sitemap-sync,gsc-performance,gsc-index-url,gsc-inspect-url}`; BLOCKED when any other tracked file names one of them (scan), or when `supabase/config.toml` has a section for one of them |
| Edits E1-E14 | as app §5.2 (13 import rewrites in the moved `middleware.ts`, 9 consumer files, `package.json` `dev:server`, XometryQueuePage hint) |
| New opt-in group I `--with-cron-functions` | `git rm -r supabase/functions/{process-article-queue,auto-update-sitemap,auto-translate-articles,tender-collector}`; the dry run prints the precondition "OW6-17 done (functions deleted in Supabase)"; scanned like every deletion (next row) and BLOCKED when `supabase/config.toml` has a section for one of them |
| Deletion scan (every group) | the preflight scan covers every path the script deletes or moves, not only `vercel.json`/`middleware.ts`: a tracked file outside `docs/`, `reference/`, `*.md`, `scripts/phase6/`, `supabase/migrations/` and the deleted path itself that names the path (`scripts/dev-server.js`, `freecad-unfold`, `AWS_S3_VERCEL_GUIDE`, `auto-merge-claude.yml`, `xometry-scan.yml`, `functions/<name>` and `functions/v1/<name>` for each function folder, `laserkritis/`, `cookie-consent.html` with `--with-statics`) is BLOCKED unless the line is in `KNOWN_MENTIONS` (file + exact line text, enumerated by CL6 on the tree that closes Phase 5, e.g. a port's "ported from" comment) or is a known edit (E1-E17); one test case per group (C, G, H, I and statics) |
| Deletions | as app §5.1: `scripts/dev-server.js`, `scripts/freecad-unfold/`, `auto-merge-claude.yml`, `xometry-scan.yml`, `docs/AWS_S3_VERCEL_GUIDE.md`, the four never-deployed function folders; statics only with `--with-statics` |
| Moves | `vercel.json`, `middleware.ts` → `reference/vercel/` + `docs/migration/phase6/reference-vercel-README.md` → `reference/vercel/README.md`; `docs/migration/phase6/root-README.md` → `README.md` |
| Preconditions printed by the dry run | Phase 3 gate + 30 days; Vercel paused or disconnected from Git; Phase 5 gate signed; static-file log check done if `--with-statics`; OW6-13 done if `--with-gsc-functions`; OW6-17 done if `--with-cron-functions` |

### 4.11 Access application (CL6, config only)

`docs/migration/phase6/access-dashboard.json`: body for `POST /accounts/<account_id>/access/apps`, `type: "self_hosted"`, `name: "microns-dashboard"`, one destination `www.micronshub.eu/dashboard`, inline allow policy with `<STAFF_EMAIL_1>`, `<STAFF_EMAIL_2>`, `<DASHBOARD_EMAIL_3>` placeholders, `session_duration: "24h"`, `http_only_cookie_attribute: true`, `same_site_cookie_attribute: "lax"`, `app_launcher_visible: false` (app §4). `access-dashboard.md` states the allow-list rule: every person who opens `/dashboard` on `www` (staff, and also tenant admins and production partners, whose menus are built from the same layout, src/components/dashboard/PersistentDashboardLayout.tsx:51-53, :203; live 2026-10-04: one `partner_seller`, one tenant admin) must be listed, or the destinations are narrowed to staff-only subpaths; otherwise they are locked out.

### 4.12 Tenant host match and admin-API call (TH6)

| Item | Contract |
|---|---|
| `resolveTenantIdentifier(hostname?)` | row 16 of §3.3; results: `www.micronshub.eu`, `micronshub.eu`, `api.micronshub.eu` → `default`; `acme.micronshub.eu` and `acme.micronshub.eu.` → `subdomain` `acme`; `micronshub.eu.example.com`, `x-micronshub.eu.example.com`, `notmicronshub.eu` → `custom_domain`; `localhost`, `127.0.0.1` → `default`; a `*.workers.dev` preview host and the `*.vercel.app` host → `custom_domain` (as today) |
| `CustomersPage.tsx` | row 17 of §3.3; FU-14 offers a staff back-fill route if the owner wants customer rows created for role holders without one |
| Tests | `tests/frontend-api/tenant-host.test.ts` (the table above, "tenant hosts match only the exact micronshub.eu suffix"); `tests/frontend-api/admin-api-usage.test.ts` (scans `src/**/*.{ts,tsx}`: "browser code never calls the Supabase admin API", i.e. no `auth.admin`) |
| Both platforms | same frontend code; no served host changes classification (§7) |

---

## 5. Build units and acceptance (every command runs in this container from the repository root, without a Cloudflare account, network access to production hosts, or a Supabase write)

Common: `BASE` = the commit the wave starts from (§3.4); `T=$(mktemp -d)`; frontend suite runner `FE="workers/site/node_modules/.bin/vitest run -c tests/frontend-api/vitest.config.mjs"` (P2 §2.13: `globals: true`, no bare `vitest` import). Install order as P2 §2.2 (`npm ci`, then `npm run cf:install`).

### 5.1 Unit Z3: DNS parity tool (P3-1)

Build: copy `p3work/proto/scripts/dns-parity.mjs` and `p3work/proto/scripts/dns-parity/{lib,test,fixtures}` verbatim; add `--forbid-target` (§4.1) with one test case; write `scripts/dns-parity/README.md` (interface, sources, exit codes, the runbook table of p3 §1.6, the note that port 53 queries run from the owner's machine).

| # | Check | Command | Pass |
|---|---|---|---|
| Z3-1 | Tests offline | `HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 NODE_USE_ENV_PROXY=1 node --test scripts/dns-parity/test/*.test.mjs` | 28 pass, 0 fail |
| Z3-2 | Export vs import fixtures | `node scripts/dns-parity.mjs --zone micronshub.eu --a zone:scripts/dns-parity/fixtures/papaki.zone --b cfapi:scripts/dns-parity/fixtures/cloudflare.json --expect-dns-only; echo $?` | `0` |
| Z3-3 | Drift fixture | same with `cloudflare-drift.json` | `1`, report lists MX missing, SPF changed, `ftp` added, `www` proxied |
| Z3-4 | Usage | `node scripts/dns-parity.mjs --bogus; echo $?` | `64` |
| Z3-5 | No dependency | `grep -rhoE "from '[^.][^']*'" scripts/dns-parity.mjs scripts/dns-parity/lib \| sort -u` | only `node:` modules |

### 5.2 Unit RR3: redirect rules and payloads (P3-3, P3-4)

Build: copy `p3work/proto/scripts/phase3/{redirect-rules.mjs,test/}`; write `scripts/phase3/payloads/redirect-rules.default.json` (= `--default` output) and `zone-routes.json` (§4.4); add the payload-equality test; write `scripts/phase3/README.md` (S11 order of §9 OW3-6 with `curl` lines using `$ZONE_ID`, `$CLOUDFLARE_API_TOKEN` placeholders; the PUT-or-POST rule of p3 §2.7; the F36-6 rule for every later host with the `curl` that creates one scriptless route and the one that lists the zone routes).

| # | Check | Command | Pass |
|---|---|---|---|
| RR3-1 | Tests | `node --test scripts/phase3/test/*.test.mjs` | 6 pass |
| RR3-2 | Committed payload = generator | `node scripts/phase3/redirect-rules.mjs --default --out "$T/r.json" && cmp "$T/r.json" scripts/phase3/payloads/redirect-rules.default.json` | exit 0 |
| RR3-3 | Usage | `node scripts/phase3/redirect-rules.mjs; echo $?` | `64` |
| RR3-4 | Zone routes | `node -e "const r=JSON.parse(require('fs').readFileSync('scripts/phase3/payloads/zone-routes.json','utf8')).routes.map(x=>x.pattern).sort().join(); if(r!=='cad-vps.micronshub.eu/*,files.micronshub.eu/*,mcp.micronshub.eu/*')process.exit(1)"` | exit 0 |

### 5.3 Unit PC3: production config (P3-3, P3-4)

Build: the `wrangler.jsonc` edits of §3.3 row 1 and §4.2 (`spec-verify/site-combined.diff` shows the tested result on `9c3db83`; re-derive the env block from the then-current top level, including any key Phases 4/5 added); `test/env-production.test.ts` (draft `p3work/envtest/test/env-production.test.ts` + `API_CORS_MODE` in `MAY_DIFFER`); `scripts/check-production.mjs` + `test/check-production.test.ts` (fixtures built in the test: tagged/untagged version JSON, matching/mismatching `API_MACHINE_HOSTS`, config with and without placeholders, `site-key` with empty, test (`1x00000000000000000000AA` built at run time) and real-shaped keys); `cf-site-production.yml` (§4.3); `cf-preview.yml` row 2 of §3.3; `test/env-api.test.ts` row 15 of §3.3 (apply `spec-verify/envapi-kv.diff`).

| # | Check | Command | Pass |
|---|---|---|---|
| PC3-1 | Site T1 | `npm --prefix workers/site test` | every file green (env-production 7, check-production ≥ 9) |
| PC3-2 | Typecheck | `npm --prefix workers/site run typecheck` | clean |
| PC3-3 | Site T2 (wrangler dev ignores the env block) | `npm --prefix workers/site run test:integration` | green (50/50 on the verify run) |
| PC3-4 | Same script both envs; no warning at top level | `(cd workers/site && mkdir -p ../../dist && { [ -f ../../dist/index.html ] \|\| echo '<!doctype html>' > ../../dist/index.html; } && npx wrangler deploy --dry-run --env="" --outdir "$T/top" > "$T/top.log" 2>&1 && npx wrangler deploy --dry-run --env production --outdir "$T/prod" > "$T/prod.log" 2>&1 && cmp "$T/top/index.js" "$T/prod/index.js" && ! grep -q "Multiple environments" "$T/top.log")` | exit 0 |
| PC3-5 | Placeholders are reported until S11 | `node workers/site/scripts/check-production.mjs config; echo $?` | `1`, lists exactly the `<…>` names of the env block |
| PC3-6 | Workflows parse; preview flag | `python3 -c "import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/cf-site-production.yml .github/workflows/cf-preview.yml && test "$(grep -c -- '--env=""' .github/workflows/cf-preview.yml)" = 2` | exit 0 |
| PC3-7 | Production workflow wiring | `grep -n -e '--tag "prod-' -e 'versions view' -e 'check-production.mjs version' -e 'check-production.mjs site-key' -e 'environment: production' -e 'refs/heads/main' .github/workflows/cf-site-production.yml` | six matches |
| PC3-8 | Mutation | in a scratch copy, one at a time: delete `ratelimits` from `env.production`; delete its `name`; add a var at the top level only; change one KV id only in `env.production`; run `npx vitest run test/env-production.test.ts` | each run fails |
| PC3-9 | Preview path unchanged | `git diff $BASE -- .github/workflows/cf-preview.yml \| grep '^[-+][^-+]'` | only the two `--env=""` lines |
| PC3-10 | Real IDs pass (F36-17) | in a scratch clone (`git clone -q --local . "$T/k"`, `node_modules` symlinked as in CL6-4) replace every `<…>` placeholder of `workers/site/wrangler.jsonc` (top level and `env.production`) by a well-formed value (32 hex for KV and account IDs, `example.cloudflareaccess.com`, 64-hex AUDs, plausible bucket names); then `npm --prefix workers/site test` and `node workers/site/scripts/check-production.mjs config` | green; exit 0 (verify 2026-10-04: without row 15 one env-api test fails) |
| PC3-11 | Row 15 only | `git diff --numstat $BASE -- workers/site/test/env-api.test.ts` | `2	1	workers/site/test/env-api.test.ts` |

### 5.4 Unit AS3: article images (P3-6)

Build: `articles-store.ts` per §4.5 (start from the draft; implement `handleArticlesR2` with `presignPut`, `presignGet`, `signedDelete`, `listFirstPage`, `legacyTarget`, `legacyPublicUrl` of workers/shared/src/storage/s3-presign.ts); the two-line branch of §3.3 row 3; `r2/cors.public.json`; the `size` property (row 4); tests. Test cases (`test/articles-store.test.ts`): `ARTICLES_STORE` absent / `legacy` / unknown → `files.ts` path (spy proves `handleArticlesR2` not called); `r2`: upload URL host `<account>.r2.cloudflarestorage.com`, path `/microns-public/articles/featured/<id>/<file>`, signed Content-Type and Content-Length; refused types (`svg`, `html`, mismatching Content-Type), missing and oversize `size`, all for a staff principal too; `publicUrl`/`key`; download and delete routed by prefix; list and delete-folder union with stubbed ListObjectsV2 for both stores, key order; `R2_PUBLIC_*` override; missing or invalid `PUBLIC_FILES_ORIGIN` → 500 framing identical to files.ts; unknown action message; CORS file equals `cors.private.json` origins and methods.

| # | Check | Command | Pass |
|---|---|---|---|
| AS3-1 | Site T1 | `npm --prefix workers/site test` | green; every Phase 2 `test/files*.test.ts` case unchanged |
| AS3-2 | Size of the Phase 2 edit | `git diff --numstat $BASE -- workers/site/src/api/files.ts` | `≤3	0	…` (≤ 3 added, 0 deleted) |
| AS3-3 | Frontend body | `$FE tests/frontend-api/article-image-upload.test.ts` | green (presign body has `size: file.size`) |
| AS3-4 | No binding added | `git diff $BASE -- workers/site/wrangler.jsonc \| grep -c microns-public` | `0` |
| AS3-5 | Mutation | remove the branch; allow `svg`; drop the size rule (each in a scratch copy) | each fails ≥ 1 test |
| AS3-6 | Typecheck | `npm --prefix workers/site run typecheck` | clean |

### 5.5 Unit TD3: tenant domain copy and README (P3-6)

| # | Check | Command | Pass |
|---|---|---|---|
| TD3-1 | Copy test | `$FE tests/frontend-api/tenant-domain-copy.test.tsx` | 3/3; on `$BASE` the page case fails (proves the test bites) |
| TD3-2 | No provider named | `grep -n -i -E 'vercel\|cloudflare\|cname\.\|workers\.dev' src/pages/dashboard/tenants/TenantEditPage.tsx src/components/tenants/CustomDomainInstructions.tsx` | no output |
| TD3-3 | Build | `npx vite build` | succeeds |
| TD3-4 | README | `grep -n '^## Deployment' README.md && grep -n 'docs/migration/PLAN.md' README.md` | both match; the section names Vercel only as "until the Phase 3 cutover" |

### 5.6 Unit DB6: database bundle (P6-2, P6-3)

Build: copy the access-model SQL files and the harness (`pglite/` without `node_modules`) into `phase36/release/` (§4.9), update the migration header path; add `AGENT_FILE` to `pglite/test.mjs` and run `pglite/down_check.mjs` from it; write `OWNER_APPLY.md` (with the pre-condition, smoke additions and keep-the-bundle line of §4.9); commit only the DBO-1 migration and its removal script to the repo. Before handing over: re-dump live definitions read-only and confirm they still equal the 2026-10-04 snapshot. After the owner's "applied" (wave D): post-apply dump, public tests, commit (§4.9).

| # | Check | Command | Pass |
|---|---|---|---|
| DB6-1 | Harness, both engines | `cd <scratch>/phase36/pglite && node test.mjs && ENGINE=pglite16 node test.mjs` | `1666 passed, 0 failed` on each (higher when `AGENT_FILE` adds cases) |
| DB6-2 | Landed Phase 4 migration | `AGENT_FILE=<repo>/supabase/migrations/<date>_agent_layer.sql node test.mjs` (only once that file exists) | 0 failed |
| DB6-3 | Mutation | `python3 mutants.py` | 12/12 killed |
| DB6-4 | Live unchanged since the snapshot | Supabase MCP `execute_sql` SELECTs of `live/extract.py` → `python3 build_live.py` → `node fidelity.mjs` | equal (`pg_policies` 182 lines, function ACLs 36/36); otherwise stop and re-derive the migration |
| DB6-5 | Repo at build time: only the DBO-1 files | `git diff --name-only $BASE -- supabase` | exactly `supabase/migrations/<build date>_create_public_rfq_qualified_columns.sql` and `supabase/rollback/<build date>_create_public_rfq_qualified_columns_down.sql` |
| DB6-6 | DBO-1 wording | `grep -n -E '^\s*--' supabase/migrations/*_create_public_rfq_qualified_columns.sql supabase/rollback/*_create_public_rfq_qualified_columns_down.sql \| grep -i -E 'anon\|leak\|expos\|vulnerab\|attack\|finding'` | no output |
| DB6-7 | DBO-1 removal restores | `cd <scratch>/phase36/pglite && node down_check.mjs && ENGINE=pglite16 node down_check.mjs` (with the repo copies as `FIX_FILE`/`DOWN_FILE` once committed) | `8 passed, 0 failed` on each |
| DB6-8 | (wave D) Public policy tests | `npm --prefix supabase/tests/rls ci && npm --prefix supabase/tests/rls test` | 0 failed; every access-model row of rls §3 has ≥ 1 case |
| DB6-9 | (wave D) Public copy carries no pre-apply statement | `node -e` script in scratch (`phase36/rls-public-check.mjs`): reads the `DROP POLICY <name> ON <table>` pairs of the committed migration and fails if `supabase/tests/rls/` contains a `CREATE POLICY` of the same name on the same table, any `GRANT … TO PUBLIC`/`relacl` line, or a before-state assertion; plus G36-i over the commit | exit 0; no output |
| DB6-10 | (wave D) Live equals the tested after-state | post-apply SELECT dump → `build_live.py` → `node fidelity.mjs` against the harness's after-state | equal |

### 5.7 Unit RS6: reset password and `cdn.gpteng.co` (P6-4, P6-6)

Build: commit 1 = the RS6 hunks of `p6work/p6-app.patch` (`src/pages/ResetPassword.tsx`, `src/utils/passwordRecovery.ts`, `src/App.tsx`, `src/contexts/AuthContext.tsx`, `src/pages/Login.tsx`, `public/robots.txt`, `tests/frontend-api/reset-password.test.tsx`; apply with `git apply --3way --include=<path> …`); commit 2 = §3.3 row 10 only (`index.html`, message "remove unused third-party editor script"), so it can be reverted alone (D6-14).

| # | Check | Command | Pass |
|---|---|---|---|
| RS6-1 | Frontend suite | `$FE` | every file green (reset-password 14) |
| RS6-2 | App typecheck count unchanged | `npx tsc --noEmit -p tsconfig.app.json 2>&1 \| grep -c 'error TS'` on `$BASE` and after | equal (321 at `9c3db83`; pre-existing, outdated `types.ts`) |
| RS6-3 | Lint | `npx eslint src/pages/ResetPassword.tsx src/utils/passwordRecovery.ts src/App.tsx src/contexts/AuthContext.tsx src/pages/Login.tsx` vs the same on `$BASE` | no new error |
| RS6-4 | Build, no third-party script | `npx vite build && ! grep -rl 'gpteng' dist --include='*.html' && ! grep -q gpteng index.html` | exit 0 |
| RS6-5 | SEO path unaffected | `npm --prefix workers/site test -- test/seo-soft404.test.ts && node tests/middleware/smoke.mjs && npm --prefix scripts/seo-parity test` | green |
| RS6-6 | Mutation | original AuthContext; failed-link rule removed; robots meta removed; original robots.txt | each fails exactly 1 test (app §1.3) |
| RS6-7 | Revertable alone | `c=$(git log --format=%H $BASE.. -- index.html); test "$(echo "$c" \| wc -l)" = 1 && test "$(git show --name-only --format= $c)" = index.html && git revert --no-commit $c && $FE tests/frontend-api/reset-password.test.tsx; git revert --abort` (in a scratch clone) | one commit touching only `index.html`; the reset tests stay green with it reverted |

### 5.8 Unit CO6: CORS switch (P6-4)

| # | Check | Command | Pass |
|---|---|---|---|
| CO6-1 | Site T1 | `npm --prefix workers/site test` | green (cors-mode 13) |
| CO6-2 | Typecheck | `npm --prefix workers/site run typecheck` | clean |
| CO6-3 | Phase 2 env files untouched by CO6 | `git diff --quiet $BASE -- workers/site/src/env.ts workers/site/src/index.ts` (env-api.test.ts changes only by PC3 row 15, PC3-11) | exit 0 |
| CO6-4 | Mutation | remove the `finalise` block; apply it before the header rules | ≥ 1 cors-mode failure each (5 and 4 on the app run) |

### 5.9 Unit LA6: `leads-api` (P6-4)

| # | Check | Command | Pass |
|---|---|---|---|
| LA6-1 | Live source unchanged since 2026-10-04 | Supabase MCP `get_edge_function` `leads-api` (read-only) | version 7; else re-pull, rebuild `index.ts`, update the hash |
| LA6-2 | Edge tests | `workers/site/node_modules/.bin/vitest run -c tests/edge-functions/vitest.config.mjs` | 15/15, incl. the hash test |
| LA6-3 | Caller test | `$FE tests/frontend-api/leads-api-callers.test.ts` | 2/2 |
| LA6-4 | Config untouched | `git diff --quiet $BASE -- supabase/config.toml` | exit 0 |
| LA6-5 | Mutation | live file without the check; `customer` as staff; 5xx mapped to 401 | 6, 3, 2 failures (app §3.3) |

### 5.9a Unit TH6: tenant host match and admin-API call (P6-4)

Build: §3.3 rows 16-17 and the two tests of §4.12. Test names state rules only (G36-6).

| # | Check | Command | Pass |
|---|---|---|---|
| TH6-1 | Host table | `$FE tests/frontend-api/tenant-host.test.ts` | green (12 cases); with the test copied onto `$BASE` it fails (the parameter does not exist there) |
| TH6-2 | No admin API in browser code | `$FE tests/frontend-api/admin-api-usage.test.ts` and `! grep -rn 'auth\.admin' src` | green; no output; on `$BASE` the test fails on CustomersPage.tsx:112 |
| TH6-3 | Typecheck count | `npx tsc --noEmit -p tsconfig.app.json 2>&1 \| grep -c 'error TS'` on `$BASE` and after | equal or lower |
| TH6-4 | Build, other frontend suites | `npx vite build && $FE` | green |
| TH6-5 | Edit size | `git diff --numstat $BASE -- src/utils/tenantApi.ts src/pages/dashboard/CustomersPage.tsx` | tenantApi ≤ 8 added / ≤ 6 deleted; CustomersPage 0 added / ≤ 56 deleted |
| TH6-6 | Mutation | restore `includes('micronshub.eu')`; drop the trailing-dot rule | ≥ 2 and ≥ 1 failures |

### 5.10 Unit CL6: cleanup tooling and Phase 6 docs (P6-4 config, P6-5, P6-6)

Build: the CL6 hunks of the patch (`scripts/phase6/**`, `docs/migration/phase6/**`) with the §4.10 changes; tests for E16/E17 states (counts re-derived on the tree that contains PC3 row 15), the deletion scan of every group with `KNOWN_MENTIONS` (one BLOCKED case per group C, G, H, I, statics), group I, and the reported (not edited) `gpteng` reference; `access-dashboard.md` with the allow-list rule of §4.11. Re-read `root-README.md` against the landed Phase 4/5 state (CAD Container, agent layer) before committing.

| # | Check | Command | Pass |
|---|---|---|---|
| CL6-1 | Syntax and tests | `bash -n scripts/phase6/cleanup.sh && node --test scripts/phase6/test/*.test.mjs` | ≥ 16 pass |
| CL6-2 | Dry run changes nothing | `a=$(git status --porcelain); bash scripts/phase6/cleanup.sh; echo $?; b=$(git status --porcelain); [ "$a" = "$b" ]` | `0`, "0 BLOCKED", exit 0 |
| CL6-3 | Refusals | `bash scripts/phase6/cleanup.sh --apply; echo $?` | `2` |
| CL6-4 | Apply in a scratch clone | `git clone -q --local . "$T/c" && for d in . workers/site workers/shared workers/ops scripts/seo-parity; do ln -s "$PWD/$d/node_modules" "$T/c/$d/node_modules"; done && (cd "$T/c" && git checkout -q -b cleanup-test && bash scripts/phase6/cleanup.sh --apply --decommissioned)` then in `$T/c`: `npm --prefix workers/site test`, `npm --prefix workers/shared test`, `npm --prefix workers/ops test`, `$FE`, `node tests/middleware/smoke.mjs`, `npm --prefix scripts/seo-parity test`, `npx vite build` | apply exit 0; every suite green (a known 5 s timeout flake in workers/shared re-run alone, app §5.4); `grep -c '"API_FORWARD_ORIGIN": ""' workers/site/wrangler.jsonc` = 2 |
| CL6-5 | Idempotent | in `$T/c`: `bash scripts/phase6/cleanup.sh` | "0 to do" |
| CL6-6 | Drift blocks | in a fresh clone change one consumer line (e.g. `tests/middleware/smoke.mjs:196`) and run `--apply --decommissioned` | exit 1, nothing changed |
| CL6-7 | Access JSON | `node -e "JSON.parse(require('fs').readFileSync('docs/migration/phase6/access-dashboard.json','utf8'))"`, `grep -c -E '<(STAFF\|DASHBOARD)_EMAIL_' docs/migration/phase6/access-dashboard.json` and `grep -n -i 'tenant admin' docs/migration/phase6/access-dashboard.md` | parses; 3; ≥ 1 match |
| CL6-8 | New mention blocks | in a fresh scratch clone add `// see scripts/dev-server.js` to a tracked `.ts` file and run `bash scripts/phase6/cleanup.sh --apply --decommissioned` | exit 1, the line is listed, nothing changed |
| CL6-9 | Group I | in the CL6-4 clone: `bash scripts/phase6/cleanup.sh --apply --decommissioned --with-cron-functions` | exit 0; the four folders gone; `$FE`, `npm --prefix workers/ops test` green |

### 5.11 Unit MS6: `docs/migration/MANUAL_STEPS.md`

Content: one ordered table per phase (P0/P1 → P2 → P3 → P4 → P5 → P6), each row = owner ID, step, when, blocks, reference; taken from the owner rows of PLAN.md §5.0-§5.1 (owner Dimitris or Both: P0-1, P0-2, P0-3, P0-4, P0-6, P0-7, P0-8, P0-9, P1-7, P1-10, P1-11), the open questions of PLAN.md §8 with their defaults (Q1-Q24 except the answered Q4; Q23 marked Phase 7), and the public sections of P2 §6, P4 §12, P5 §10 and §9 here; references to private appendices become "private note"; the cross-phase order of §9.1 at the top. Annotations MS6 adds to rows copied from the sibling specs: (a) every row that sets a `microns-site` secret (P2 O-4, O-5, O-7, O-8, O-10; P4 OW-7 site part; P5 OW5-8 `CAD_COMPAT_TOKEN`; OW3-10 c; OW6-10) gets the F36-5 procedure (`npx wrangler versions secret put <NAME>`, with `--env production` from S11, then `upload` → `deploy`); (b) every row that proxies a new host (P4 OW-11 Tunnel host, Q22 Mac mini host) gets "first a scriptless route `<host>/*` (F36-6, OW3-13)"; (c) the RLS observations appear as DBO-1/DBO-2, never as O-n.

| # | Check | Command | Pass |
|---|---|---|---|
| MS6-1 | Coverage | `node <scratch>/phase36/ms6-check.mjs docs/migration/MANUAL_STEPS.md` (scratch script: collects `P0-n`/`P1-n` rows whose owner column names Dimitris or Both and the unanswered `Qn` of PLAN.md, plus `O-n`, `OW-n`, `OW5-n`, `OW3-n`, `OW6-n` from the four source tables, and greps each ID in the file) | every ID present exactly once as a row ID |
| MS6-2 | Public wording | `grep -n -i -E 'appendix p\|gates_private\|security_private\|P6A-\|\bP\.[0-9]+\b\|\b[PXN]-[0-9]+\b' docs/migration/MANUAL_STEPS.md` | no output |
| MS6-3 | Site-secret procedure | `ms6-check.mjs --secrets`: every row that names a `microns-site` secret (list from `workers/site/wrangler.jsonc` `secrets.required` plus `AGENT_APPROVAL_SECRET`, `CAD_COMPAT_TOKEN`, `R2_PUBLIC_*`, `TURNSTILE_SECRET_KEY`) contains `versions secret put` | every such row |
| MS6-4 | New-host rule | `ms6-check.mjs --hosts`: the OW-11 and Q22 rows and OW3-13 contain `scriptless route` | each |

### 5.12 Cross-unit gate G36 (after wave C; every unit fixes its own failures)

| # | Check | Command | Pass |
|---|---|---|---|
| G36-a | All Worker suites | `npm run cf:typecheck:all && npm run cf:test:all && npm run cf:t2` | green |
| G36-b | Phase 4/5 suites still green | the functional commands only: Phase 4 G4-1…G4-5 and G4-7 (PHASE4_SPEC.md:966-970, :972), Phase 5 Wave 3 without its `git diff` line (PHASE5_SPEC.md:821) and O5 (`npm --prefix supabase/tests/phase5 test`); their freeze diffs (G4-6, G4-8, G4-10, the Wave 3 diff) are replaced by G36-f and G36-k, because this phase changes exactly the extension points those diffs freeze | green |
| G36-c | Frontend, edge, build | `$FE && workers/site/node_modules/.bin/vitest run -c tests/edge-functions/vitest.config.mjs && npx vite build` | green |
| G36-d | Phase 1 tooling | `node tests/middleware/smoke.mjs && npm --prefix scripts/seo-parity test` | green |
| G36-e | Phase 3/6 tools | `node --test scripts/dns-parity/test/*.test.mjs scripts/phase3/test/*.test.mjs scripts/phase6/test/*.test.mjs` | green |
| G36-f | Vercel files untouched | `git diff --quiet $BASE -- vercel.json middleware.ts middleware api lib .github/workflows/auto-merge-claude.yml .github/workflows/xometry-scan.yml scripts/dev-server.js scripts/freecad-unfold docs/AWS_S3_VERCEL_GUIDE.md public/laserkritis public/cookie-consent.html` | exit 0 |
| G36-g | Access-model migration not in the repo | `git ls-files \| grep -c rls_remediation` | `0` |
| G36-h | Secret scan (patterns split so this line never matches itself) | `git diff $BASE \| grep -nE 'ey''J[A-Za-z0-9_-]{20,}\|re''_[A-Za-z0-9]{16,}\|whs''ec_\|AK''IA[0-9A-Z]{16}\|sb_''secret_'` | no output |
| G36-i | Wording scan | `git diff $BASE \| grep -n -i -E '^\+.*(appendix p\|gates_private\|security_private\|P6A-[0-9]\|\b[PXN]-[0-9]+\b\|wide open\|vulnerab)'` | no output |
| G36-j | Preview behaviour | `npm --prefix workers/site test -- test/cors-mode.test.ts test/articles-store.test.ts test/env-production.test.ts` with the committed config | parity CORS and legacy articles by default |
| G36-k | Only allowed paths changed | `git diff --name-only $BASE \| grep -v -E -f <scratch>/phase36/g36-allow.txt` (file exists, verify 2026-10-04; one extended regex per line, written from §3.2; table pipes shown escaped here: `^scripts/(dns-parity(\.mjs\|/)\|phase3/\|phase6/)`, `^workers/site/(wrangler\.jsonc\|scripts/check-production\.mjs\|r2/cors\.public\.json\|src/preview\.ts\|src/api/(articles-store\|files)\.ts\|test/(env-production\|check-production\|articles-store\|cors-mode\|env-api)\.test\.ts)$`, `^\.github/workflows/(cf-site-production\|cf-preview)\.yml$`, `^src/(App\.tsx\|contexts/AuthContext\.tsx\|components/tenants/CustomDomainInstructions\.tsx\|pages/(ResetPassword\|Login)\.tsx\|pages/dashboard/(LeadMonitorPage\|CustomersPage)\.tsx\|pages/dashboard/tenants/TenantEditPage\.tsx\|utils/(articleImageStorage\|passwordRecovery\|tenantApi)\.ts)$`, `^(index\.html\|public/robots\.txt\|README\.md)$`, `^tests/frontend-api/(tenant-domain-copy\|article-image-upload\|reset-password\|leads-api-callers\|tenant-host\|admin-api-usage)\.test\.tsx?$`, `^tests/edge-functions/`, `^supabase/functions/leads-api/(index\|staff-auth)\.ts$`, `^supabase/(migrations\|rollback)/[0-9]{8}_create_public_rfq_qualified_columns(_down)?\.sql$`, `^docs/migration/(phase6/\|MANUAL_STEPS\.md$)`) | no output |

---

## 6. What must not change (until the owner's decommission run)

| Area | Files / behaviour | Why |
|---|---|---|
| Vercel production | G36-2 list; `vite.config.ts`; the Vercel project settings | Rollback target until S17 and paused-not-deleted for 30 days (PLAN.md:478, :503) |
| Preview path | top-level resolution of `workers/site/wrangler.jsonc` except three inert vars; `cf-preview.yml` except `--env=""` | G36-3 |
| SEO path | `workers/site/src/{index,sitemap,redirects,static}.ts`, `src/seo/**`, every Phase 1 test and fixture, `scripts/seo-parity/**`, `tests/middleware/**`; `preview.ts` only at row 5 of §3.3 | Phase 1 parity gate; Phase 3 gate item 4 |
| Phase 2/4/5 code | every file not in §3.2 (G36-k); `workers/site/test/env-api.test.ts` only at row 15 of §3.3; in particular `workers/site/src/api/{router,resolve,forward,ops-client}.ts`, `workers/site/src/auth/**`, `workers/ops/**`, `workers/mail/**`, `workers/shared/**` | their gates stay valid |
| Database | no SQL applied by a builder; the access-model migration absent from the repo until applied | G36-5, F36-9 |
| Edge functions | only `leads-api` (live v7 + marked block); no deploy | PLAN.md:449; P5 §8 |
| Docs | `docs/migration/**` other than `phase6/**` and `MANUAL_STEPS.md` (corrections need the owner's OK, PLAN.md:45; proposals in §10.1) | PLAN.md:45 |

## 7. Frontend changes that reach Vercel production on merge

| Change | On Vercel (until decommission) | On the Worker | After a rollback to Vercel | Test |
|---|---|---|---|---|
| Tenant domain copy (TD3) | text names no provider; `verifyTenantDomain` unchanged (src/utils/tenantApi.ts:180-188) | same | same | TD3-1 |
| `size` in the article presign body (AS3) | `api/s3.js` reads only `fileName`, `contentType`, `prefix` (api/s3.js:156) | `legacy`: staff skip constraints, size unused (files.ts:226-243); `r2`: required | ignored | AS3-3 |
| `/reset-password` route, AuthContext hand-over, Login link (RS6) | SPA rewrite serves the shell (vercel.json:159-160; middleware matcher only language paths, middleware.ts:682-687) | SEO handler returns null for non-language paths, assets SPA fallback (workers/site/src/index.ts:96-105) | same | RS6-1, RS6-5 |
| `robots.txt` line (RS6) | served from `dist/` | same file | same | one explained parity difference on `/robots.txt` at the next parity run |
| `cdn.gpteng.co` removed from `index.html` (RS6) | every HTML document loses two lines | same | same | explained parity difference on HTML documents only when compared with a baseline captured before the merge; the S11 baseline is captured after it |
| LeadMonitorPage sends the session token (LA6) | harmless: the deployed function answers as before until OW6-6 | same | same | LA6-3 |
| Exact tenant-host match; admin-API back-fill removed (TH6) | `www`, apex, tenant subdomains, the `*.vercel.app` host keep their classification (§4.12); the customer list is unchanged | same; `*.workers.dev` previews keep `custom_domain` | same | TH6-1, TH6-2 |
| README (TD3) | not served | — | — | TD3-4 |

No new dependency; root `package.json` and lockfiles unchanged (F36-14).

## 8. Owner-run artefacts (what the owner runs, never a builder)

| Artefact | Run when | How | Rollback |
|---|---|---|---|
| `scripts/dns-parity.mjs` | S2-S10, S12-S16, after Vercel deletion | commands of `scripts/dns-parity/README.md` from the owner's machine | — |
| `scripts/phase3/payloads/zone-routes.json` | S11, before the `routes` action (three scriptless routes); later one route per new non-site host before its record is proxied (OW3-13) | one `POST …/zones/$ZONE_ID/workers/routes` per route (`scripts/phase3/README.md`) | delete the route |
| `scripts/phase3/redirect-rules.mjs` | S11 after the baseline | `--baseline <snapshot> --out redirect-rules.json`, then one `PUT` | `PUT` an empty rule list, or un-proxy the record |
| `cf-site-production.yml` | S11 onwards, every site production release (also Phase 4 OW-8, Phase 5 OW5-13) | GitHub Actions → dispatch `upload` → parity on the version preview URL → `deploy` with that version ID; `routes` once at S11 | `deploy` with the previous tagged version ID |
| Private DB bundle (`OWNER_APPLY.md`) | any time after review (§9 OW6-2) | SQL editor: dry run with `ROLLBACK;`, apply, verify | `<apply date>_rls_remediation_down.sql` |
| `supabase/migrations/<build date>_create_public_rfq_qualified_columns.sql` | any time | SQL editor, once | run `supabase/rollback/<build date>_create_public_rfq_qualified_columns_down.sql` (the previous definition; `CREATE OR REPLACE` keeps the grants; DB6-7) |
| `supabase functions deploy leads-api` | after the LeadMonitorPage change serves | `--project-ref cfjrtmtaitwzggzpkhxi --no-verify-jwt` | redeploy live v7 text (kept privately) |
| `scripts/phase6/cleanup.sh` | Phase 3 gate + 30 days, Vercel paused or disconnected, Phase 5 gate signed | dry run → `--apply --decommissioned` on a branch → tests → commit → PR → merge → preview upload → parity → production `upload`/`deploy` | revert the commit (Vercel stays paused, not deleted) |
| `docs/migration/phase6/access-dashboard.json` | optional, after S17 | Zero Trust API or dashboard with the allow list of §4.11 (everyone who opens `/dashboard` on `www`) | delete the application |

---

## 9. Owner checklist (items for `docs/migration/MANUAL_STEPS.md`; Dimitris unless marked Both)

Claude prepares commands and checks and commits non-secret IDs on request; the owner runs every account, dashboard, DNS, deploy, apply and decommission step. Every new credential, token, Access application or route is appended to the P0-2 consumer checklist on the day it is created (PLAN.md:85).

### 9.1 Cross-phase order

| Order | Block | Why |
|---|---|---|
| 0 | Phase 0/1 owner rows still open (P0-1, P0-2, P0-3, P0-4, P0-6, P0-7, P0-8, P0-9, P1-7, P1-10, P1-11) and the open questions (Q1-Q24 except Q4), Q7 and P0-9 first because of the DNSSEC lead time | PLAN.md:94 (P0 order), :359 (Phase 3 depends on P0-9 and Q7), :679 (Q7), :686 (Q14, cost gate) |
| 1 | Phase 2 owner steps (P2 §6), Phase 2 gate | PLAN.md:359 (Phase 3 depends on the Phase 2 gate; S1-S10 may run in parallel with the owner's OK) |
| 2 | Phase 3 OW3-1…OW3-9 (runbook S1-S17), gate | Phase 4 needs the zone and `www` on the Worker (PHASE4_SPEC.md:1283, OW-5, OW-17) |
| 3 | P3-6 items OW3-10…OW3-13 (any time after S17) | — |
| 4 | Phase 4 owner steps (P4 §12), gate | PLAN.md:49-61 |
| 5 | Phase 5 owner steps (P5 §10), gate | Phase 5 S9 compat path is `https://www.micronshub.eu/api/cad/…` (PHASE5_SPEC.md:87) |
| 6 | Phase 6 OW6-1…OW6-18 | OW6-2 (after its pre-condition), OW6-3, OW6-5, OW6-6, OW6-9 do not depend on the cutover and may be pulled forward; OW6-18 right after S17 |

### 9.2 Phase 3

| # | Step | When | Blocks | Reference |
|---|---|---|---|---|
| OW3-1 | Review §2.1 defaults (owner-sensitive D3-9, D3-17) and the new names: `ARTICLES_STORE`, `PUBLIC_FILES_ORIGIN`, `API_CORS_MODE`, `cf-site-production.yml`, GitHub environment `production`, version tag `prod-<sha>` | before merging the Phase 3/6 build | merge | §2.1 |
| OW3-2 | GitHub: environment `production` with required reviewer = owner and deployment branches limited to `main`; environment secret `CLOUDFLARE_API_TOKEN` = a production token with Workers Scripts Edit (account), Workers Routes Edit and Zone Read on `micronshub.eu`, Account Settings Read; the other build secrets (`CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`) come from the repository secrets that `cf-preview.yml` uses (no environment copies; the site key becomes the real one at OW3-6 c2) | before S11 | production workflow | §4.3; F36-18, F36-19 |
| OW3-3 | S1-S10: zone on Cloudflare Free, TTLs, export/import, DS removal, NS switch, DNSSEC; every check with `scripts/dns-parity.mjs` from your machine (port 53 to Papaki and Cloudflare): S2 `--a ns:dns1.papaki.gr --b ns:dns2.papaki.gr --ttl max:300 --no-default-names --names ttl-names.txt`; S4 `--a zone:papaki.zone --b cfapi:cf-records.json --expect-dns-only`; S5/S7 `--a ns:dns1.papaki.gr --b ns:<assigned>.ns.cloudflare.com` (if the pending zone answers REFUSED, the S4 command); S6/S7 `ds --via doh:google --expect absent`; S9 `--a zone:papaki.zone --b doh:google` and `--b doh:cloudflare`; S10 `ds --via doh:google --expect present --key-tag <tag>`. Pass = exit 0; only `_domainkey`, `x._domainkey` may show `EXPECTED_ENT` | T − 10 d … T + 2 d | S11 | PLAN.md:561-570; p3 §1.6 |
| OW3-4 | S11 values: put the IDs into `env.production` (KV IDs, account ID, legacy bucket names, Access team domain, preview AUD + API AUD), or send them to Claude to commit (IDs, not secrets; the site tests accept real IDs, F36-17); `node workers/site/scripts/check-production.mjs config` must exit 0 | C − 1 d | `upload` | §4.2 |
| OW3-5 | S11 machine host: create the Access app `microns-machine-api` for `api.micronshub.eu` (Service Auth for the two machine tokens, no human Allow, no Bypass) **first**, then the proxied `api` record | C − 1 d | M4 test, OW3-9 | P2 D-3; private note |
| OW3-6 | S11 order: (a) refresh the baseline (P0-3) from your machine; (b) `node scripts/phase3/redirect-rules.mjs --baseline <snapshot> --out redirect-rules.json`; exit 1 = stop and send Claude the report; if it prints `HSTS: worker = <value>`, Claude commits `HSTS_VALUE` in `env.production`; (c) zone settings per SEO_PARITY.md §8 / PLAN.md §6.4 incl. Always Use HTTPS **off**, URL normalisation "to origin" off, the one `/api/*` rate-limiting rule; (c2) Turnstile production pair at the same moment (P2 O-7, F36-18): `npx wrangler versions secret put TURNSTILE_SECRET_KEY --env production` in `workers/site` (F36-5) and the repository secret `VITE_TURNSTILE_SITE_KEY` = the real site key; from now on previews use the real pair too; (d) the three scriptless routes of `scripts/phase3/payloads/zone-routes.json`; (e) `PUT` the redirect payload; (f) `cf-site-production.yml` `upload` → parity of the printed version preview URL against the baseline → `deploy` with that version ID → `routes`; (g) list zone routes: 2 to `microns-site`, 3 without a Worker | C − 1 d | S12 | PLAN.md:571; §4.3-§4.4 |
| OW3-7 | S12-S14 flips per runbook; after each: `scripts/dns-parity.mjs --a zone:papaki.zone --b ns:<cloudflare ns> --expect-proxied www,@,*,api` exit 0 (MX, SPF, DKIM, DMARC, `send`, verification TXT unchanged) | C … C + 30 min | gate item 5 | PLAN.md:572-574 |
| OW3-8 | S15-S17 observation and gate sign-off; keep TTL 300 s; Vercel stays deployable | C + 1 h … C + 48 h | Phase 4 | PLAN.md:575-577 |
| OW3-9 | After the machine-host test (P2 M4): `SITE_URL=https://api.micronshub.eu` for `tender-collector` (Supabase function secret) and in the local MCP configuration | after S17 | — | P2 O-15, O-16 |
| OW3-10 | P3-6 article images: (a) R2 custom domain `files.micronshub.eu` → `microns-public` (the scriptless route exists since OW3-6); (b) `npx wrangler r2 bucket cors set microns-public --file workers/site/r2/cors.public.json`; (c) give the existing R2 token access to `microns-public` (jurisdiction default), or create a second token and set site secrets `R2_PUBLIC_ACCESS_KEY_ID`/`R2_PUBLIC_SECRET_ACCESS_KEY` via the F36-5 procedure; (d) confirm the legacy articles bucket has no `articles/` objects (`aws s3 ls s3://<bucket>/articles/ --max-items 1`); (e) Claude sets `ARTICLES_STORE: "r2"` in `env.production` → `upload`/`deploy`; (f) upload one image in the media library and open its URL; (g) later remove PutObject from the legacy articles key (P2 §P.7) | after S17 | — | §4.5 |
| OW3-11 | P3-6: re-submit the sitemap index in GSC once; (Both) deliverability report for `send.micronshub.eu`, SPF and DMARC with no change to the apex MX | after S17 | — | PLAN.md:332 |
| OW3-12 | P3-7: after 2 weeks of flat GSC coverage and a yes to Q5, enable `seo.strict_404`; watch 404 counts for 7 days | S17 + 2 weeks | — | PLAN.md:333 |
| OW3-13 | Standing rules from S11 on: every site production release through `cf-site-production.yml` (`upload` → `deploy`); a site secret changes per F36-5 (`versions secret put … --env production`, then `upload`, `deploy`); never `wrangler deploy` or `wrangler secret put` on `microns-site` without `--env production`; previews and production share the Worker's secrets, so the repository Turnstile site key stays the real one; **before any new hostname of the zone is proxied** (the CAD Tunnel host if renamed at P4 OW-11, the Mac mini host of Q22, any Tunnel- or Access-only host) create its scriptless route `<host>/*`, then list the zone routes; list zone routes also after every `routes` run or fallback `deploy --env production` | from S11 | — | F36-4, F36-5, F36-6, F36-18 |

### 9.3 Phase 6

| # | Step | When | Blocks | Reference |
|---|---|---|---|---|
| OW6-1 | Review §2.2-§2.3 defaults; decide the owner-sensitive rows (D6-DB-2, D6-DB-6, D6-DB-16, D6-7, D6-10, D6-14, D6-22, D6-25) and the follow-ups of §10.3; declining D6-14 = revert the RS6 `index.html` commit alone (the reset flow stays) | before merging the build | merge | §2 |
| OW6-2 | P6-2/P6-3 access model (private bundle, `OWNER_APPLY.md`; keep the attachments, Claude needs them back): **pre-condition while Vercel serves production**: the Vercel production environment lists `SUPABASE_SERVICE_ROLE_KEY` (name only, P0-2 read) and the local MCP server configuration sets `SUPABASE_SERVICE_KEY`, else set them first or apply after S17; then dry run (final `COMMIT;` → `ROLLBACK;`, expect no error), apply unchanged, run the verify query and the Security Advisor, run the smoke list (including `/dashboard/tenders`, `/dashboard/funded-startups` and one MCP tool call); reply "applied" so Claude commits the migration, removal script and public policy tests under the apply date; rollback = the removal script | any time after OW6-1 and its pre-condition | Phase 6 gate item 1 | rls §8; F36-9; D6-DB-19 |
| OW6-3 | Optional DBO-1 fix: run `supabase/migrations/<build date>_create_public_rfq_qualified_columns.sql` once (either order with OW6-2); test a signed-in quote submission; rollback = `supabase/rollback/<build date>_create_public_rfq_qualified_columns_down.sql` | any time | — | D6-DB-16 |
| OW6-4 | P6-3 settings: leaked-password protection (Pro plan and above; Q2); Postgres upgrade in a maintenance window after OW6-2 is stable; `pg_net` out of `public` after Phase 5 unscheduled the HTTP jobs (`select count(*) from cron.job where command ilike '%net.http%'` = 0); credential-storage moves with P6-1 | after OW6-2 | — | rls §8.2-§8.5 |
| OW6-5 | Supabase Auth: add `https://www.micronshub.eu/reset-password` (and the preview/tenant host forms if wanted) to the redirect URLs; confirm the "Reset password" template uses `{{ .ConfirmationURL }}`; test: request a reset, set a password, sign in; open a used link and see the expired message | after the build merges | P6-4 | app §1.4 |
| OW6-6 | `leads-api`: after the LeadMonitorPage change serves, `supabase functions deploy leads-api --project-ref cfjrtmtaitwzggzpkhxi --no-verify-jwt`; check `/dashboard/leads` as an admin and that the deployed function answers 401 to a request without a staff session | right after the build merges and the new bundle serves | P6-4 | app §3.4 |
| OW6-7 | CORS: after S17, Claude sets top-level `API_CORS_MODE: "allowlist"` → `cf-preview.yml` upload → curls of app §2.4 on the preview; then `env.production` → `upload`/`deploy` → same curls on `www`; approve the parity allow-list entries of that run | after S17 | P6-4 | app §2.4 |
| OW6-8 | Optional: Access application from `docs/migration/phase6/access-dashboard.json`; the allow list holds every person who opens `/dashboard` on `www` (staff, tenant admins, production partners), or the destinations are narrowed to staff-only subpaths; delete it to turn off | after S17 | — | §4.11 |
| OW6-9 | Google Cloud console: referrer-restrict the Maps Embed key used by `src/pages/Contact.tsx` to the production and preview hosts: `www.micronshub.eu/*`, `micronshub.eu/*`, `*.micronshub.eu/*` (tenant subdomains), the `microns-site` preview hosts (`*.<workers subdomain>.workers.dev/*`), and the Vercel hosts until decommission | any time | P6-4 | PLAN.md:477; private note |
| OW6-10 | P6-1 rotation per the private checklist, including every Worker secret created in Phases 1-5 (site secrets via F36-5) and the old values revoked; 24 h without auth errors | after Phase 5 gate | gate item 2 | PLAN.md:474 |
| OW6-11 | P6-5 decommission: pause the Vercel project (not delete) and disconnect it from Git; VPS off after the CAD Container has run ≥ 7 days; delete the Xometry Action's repository secrets; before deleting the Vercel project after 30 days, run `scripts/dns-parity.mjs … --forbid-target vercel-dns.com --forbid-target 216.198.79.1` (exit 0) | Phase 3 gate + 30 days | OW6-12 | PLAN.md:478; F36-11 |
| OW6-12 | Cleanup run on a branch: `bash scripts/phase6/cleanup.sh` (read the plan) → `bash scripts/phase6/cleanup.sh --apply --decommissioned` → the test commands it prints → commit → PR → merge → preview upload → parity preview vs production (expected: 0 differences, plus the explained 502 for unknown `/api/*` paths after E16) → production `upload`/`deploy` | after OW6-11 | gate item 4 | §4.10 |
| OW6-13 | Phase 5 OW5-20: if nothing outside the repo calls the four `gsc-*` functions, delete them in Supabase, then run the cleanup once more with `--with-gsc-functions` | after OW6-12 | — | D6-17 |
| OW6-14 | Log check of `/laserkritis/*` and `/cookie-consent.html` requests; if unused, `--with-statics` as its own commit (parity shows those URLs answering the SPA shell, explained) | after OW6-12 | — | PLAN.md:493 |
| OW6-15 | Delete the Vercel project after the 30-day pause, once OW6-11's DNS check passed and E16 is deployed | Phase 3 gate + 30 days | — | F36-11; OW6-11; private note |
| OW6-16 | (Both) P6-7 security checklist (private) and 30-day cost report against the Q14 baseline; sign the Phase 6 gate | end | Phase 6 gate | PLAN.md:480 |
| OW6-17 | After the Phase 5 gate and OW5-17: read 14 days of Edge Function logs for `process-article-queue`, `auto-update-sitemap`, `auto-translate-articles`, `tender-collector`; if nothing invoked them, delete the four functions (Dashboard → Edge Functions, or `supabase functions delete <name> --project-ref cfjrtmtaitwzggzpkhxi`); retire the service token `microns-machine-collector` if no other caller uses it (P2 O-8; its client ID leaves `ACCESS_MACHINE_CLIENT_IDS` via F36-5); then the cleanup once more with `--with-cron-functions` (own commit) | Phase 5 gate + 14 days | — | D6-23 |
| OW6-18 | Optional, recommended right after S17: Vercel Firewall custom rule for the project's `*.vercel.app` hosts per the private note (check at P0-4 that the plan offers custom rules); removing the rule restores the `api.forward_to_vercel` rollback flag; DNS rollback is unaffected | after S17 | — | D6-25; private note |

---

## 10. Deviations, follow-ups, risks

### 10.1 Deviations from the repo documents (proposed corrections; written into `docs/migration/**` only with the owner's OK, PLAN.md:45)

| # | Document says | Built | Reason |
|---|---|---|---|
| DV36-1 | `middleware/*` → `workers/site/src/seo/*`, `api/*` → `workers/ops/src/legacy-api/*` (PLAN.md:487-488) | Not moved | D6-11 |
| DV36-2 | `vercel.json`, `middleware.ts` deleted (PLAN.md:492) | Moved to `reference/vercel/` by the cleanup | D6-12 |
| DV36-3 | CORS in `workers/site/src/api/router.ts` (PLAN.md:489) | `preview.ts` `finalise()` | Every answer, incl. forwards, passes it once; router.ts is extended by Phases 4 and 5 |
| DV36-4 | `supabase/migrations/2026MMDD_rls_remediation.sql` (PLAN.md:486) | Same path, committed after the owner applied it; removal script in `supabase/rollback/` | F36-9 |
| DV36-5 | P6-4 Access also on `/customer*`, `/partner*` (PLAN.md:477) | `/dashboard` only, off | D6-10 |
| DV36-6 | `cdn.gpteng.co` removal is an owner decision at Phase 6 (PLAN.md:491) | Removed by the build | F36-10 |
| DV36-7 | Phase 3 file list (PLAN.md:337-345) | Adds `env.production`, `cf-site-production.yml`, `cf-preview.yml` flag, `scripts/phase3/**`, `articles-store.ts`, `files.ts` branch, `articleImageStorage.ts` `size`, `CustomDomainInstructions.tsx`, check script and tests | P3-3, P3-6 needed them |
| DV36-8 | P6-5 lists no forward retirement | E16/E17 in the cleanup | F36-11 |
| DV36-9 | Runbook S13 "enable the Single Redirect Rule" | Rules applied at S11, effective on proxying at S13 | F36-7 |
| DV36-10 | P6-2 "policy tests" (PLAN.md:475) | Rules-only tests on the post-apply state committed after the owner applied P6-2 (`supabase/tests/rls/`); the full harness (pre-state, before-assertions, mutants) stays in the private bundle | F36-9; D6-26 |
| DV36-11 | Runbook S11 "production version = the version ID that passed the Phase 1 and 2 gates" (PLAN.md:571) | A new production upload of the merged commit, tagged `prod-<sha>`, checked by parity on its version preview URL against the S11 baseline, then deployed | F36-4: preview-gate versions carry top-level vars; the production config (routes, gate modes, machine host) exists only in `env.production` |
| DV36-12 | Runbook S11 routes: two Worker routes (PLAN.md:571) | Plus three scriptless routes and a standing rule for later hosts | F36-6 |

### 10.2 Corrections to the analyses (verified for this spec)

| Analysis claim | Correction | Evidence |
|---|---|---|
| rls F-7: the browser bucket helpers are dead | `fileStorage.ts` is imported by RFQPage, OrderDetailsPage, QuotesPage, PartFilesView; only `mediaStorage.ts`, `RfqStorageDebug.tsx`, `MicronsMultiStepForm.tsx` have no importer | grep 2026-10-04 (src/pages/RFQPage.tsx:4, :33) |
| app §2.2: add `API_CORS_MODE?` to `src/env.ts` and bump the env-api count | `CorsModeEnv` in `preview.ts` | F36-3; verify 2026-10-04 |
| p3 §5.2 multi-point `files.ts` integration | one branch | F36-8; files.ts:147-331 restructured |
| p3 §6 / app §5.5: README after S17; gpteng via cleanup in two steps | F36-13; F36-10 | — |
| p3 §2.6 `mcp.` scriptless route at Phase 4 OW-8 | at S11, together with `files.` and `cad-vps.`; standing rule for later hosts | F36-6 |
| P2 B `env-api.test.ts` pins the KV placeholders | accepts placeholder or 32 hex (row 15) | F36-17; verify 2026-10-04 |
| P2 O-7 site key "in the GitHub secret" vs this spec's earlier OW3-2 (environment-only) | repository secret, as P2 O-7 says | F36-18 |
| rls §8 step 1.4 smoke list | adds tenders, funded startups and an MCP call; pre-condition on the service key | D6-DB-19 |

### 10.3 Follow-ups not built (each needs an owner yes)

| # | Item | Source |
|---|---|---|
| FU-1 | Refuse tenant slugs `www`, `api`, `files`, `mcp`, `rfq`, `send` | p3 §3 |
| FU-2 | `workers_dev: false` in `env.production` once previews use version URLs only | p3; private note |
| FU-3 | Remove the forward path code and the `api.forward_to_vercel` flag after E16 has run for 30 days | F36-11 |
| FU-4 | Consolidate the two shims (`workers/site/src/compat/vercel-shim.ts`, `workers/shared/src/compat/vercel-node.ts`) | P2 F-3 |
| FU-5 | Repoint dashboard buttons that call ported edge functions; then delete those functions | F36-16; P5 R5-9 |
| FU-6 | Re-decide the reads kept by D6-DB-3 (detail in the private note) | rls F-1, F-2 |
| FU-7 | Tenant logo upload policy on `tenant-*` buckets | rls F-3 |
| FU-8 | Table privileges per role on staff tables, as defence in depth next to RLS (private note) | rls F-4 |
| FU-9 | Quote-form file references (DBO-2; private note) | rls O-2 |
| FU-10 | Delete the three unimported Storage helper files | §10.2 |
| FU-11 | RFQ creation behind the site gate | D6-22 |
| FU-12 | Docs still describing the Xometry Action (`xometry-bot/README.md:49`, `xometry-bot/dashboard/README.md:21`) | app §5.6 |
| FU-13 | Sitemap reader switch to R2 | P5 D-1 |
| FU-14 | Staff route that creates customer rows for customer-role users without one (only if the owner wants what the removed back-fill attempted) | D6-24 |
| FU-15 | P6-3 credential-storage moves with P6-1: Telegram token and GSC credentials to Worker secrets, sender-account OAuth tokens to server-only storage with a connected flag for the dashboard, re-grant at Google | rls §8 step 5; private note |

### 10.4 Risks

| # | Risk | Handling |
|---|---|---|
| R36-1 | A later change adds a site binding or var only at the top level | `env-production.test.ts` fails (§4.2) |
| R36-2 | `triggers deploy` (experimental) fails at S11 | fallback `wrangler deploy --env production` from the owner's machine (same routes, a new version of the same commit) |
| R36-3 | A scriptless route disappears after a production deploy | owner lists routes after each `routes`/fallback run (OW3-13) |
| R36-12 | A new proxied host without a scriptless route is answered by `microns-site` | F36-6 rule; OW3-13; MS6 annotates P4 OW-11 and Q22 (MS6-4) |
| R36-13 | Preview forms fail after S11 if the repository site key stays the test key | OW3-6 (c2) switches both at once (F36-18) |
| R36-14 | P6-2 applied before the flip while a server caller lacks the service key | OW6-2 pre-condition; smoke list covers tenders, funded startups, MCP |
| R36-4 | Rulesets API refuses `raw.http.request.uri.path` in a target | generator option to use `http.request.uri.path`; check G9 #17 at S13 (p3 §2.7) |
| R36-5 | Cloudflare applies the wildcard at `_domainkey` | `EXPECTED_ENT`; no DKIM key lives there |
| R36-6 | A preview-config version deployed to production | F36-4 guard; rollback = previous tagged version |
| R36-7 | Live policies drift before OW6-2 | strict drops + post-conditions abort with nothing changed; DB6-4 re-checks at build time |
| R36-8 | The cleanup meets consumers added after this spec | preflight scan and exact-count edits block the run |
| R36-9 | Article images in R2 drop out of the media library after a site rollback to Vercel | images stay reachable; listed again when the site returns to Cloudflare |
| R36-10 | Unknown `/api/*` paths answer 502 instead of Vercel's answer after E16 | explained parity difference at OW6-12; no caller uses an unknown path (P2 callers.md) |
| R36-11 | One R2 token cannot cover the `eu` and default jurisdictions | optional `R2_PUBLIC_*` pair (OW3-10 c) |
| R36-15 | A later mention of a deleted path blocks the cleanup | intended (fail closed); Claude adds the line to `KNOWN_MENTIONS` or edits it |

---

## 11. Traceability (PLAN task → unit → acceptance → gate)

| PLAN task | Units | Acceptance | Gate item |
|---|---|---|---|
| P3-1 | Z3 | Z3-1…Z3-5 | Phase 3 gate 5, 7 (via OW3-3, OW3-7) |
| P3-2 | Z3 (`ds`) | Z3-1 | Phase 3 gate 7 |
| P3-3 | PC3, RR3 | PC3-1…PC3-11, RR3-1…RR3-4 | Phase 3 gate 2-4 (OW3-6) |
| P3-4 | PC3, RR3 | as P3-3 | Phase 3 gate 1-4 |
| P3-5 | — (owner) | — | Phase 3 gate 1-7 |
| P3-6 | AS3, TD3 | AS3-1…AS3-6, TD3-1…TD3-4 | — (post-gate) |
| P3-7 | — (owner, flag) | — | — |
| P6-1 | — (owner; private checklist) | — | Phase 6 gate 2 |
| P6-2, P6-3 | DB6 | DB6-1…DB6-7 (build), DB6-8…DB6-10 (after apply) | Phase 6 gate 1 |
| P6-4 | RS6, CO6, LA6, TH6, CL6 (Access config); owner OW6-9 (Maps key) | RS6-*, CO6-*, LA6-*, TH6-*, CL6-7 | Phase 6 gate 1, 4 |
| P6-5 | CL6 (E16/E17), Z3 (`--forbid-target`); owner OW6-17, OW6-18 | CL6-4 | Phase 6 gate 1 |
| P6-6 | CL6, RS6 (index.html) | CL6-1…CL6-6, CL6-8, CL6-9, RS6-4, RS6-7 | Phase 6 gate 4 |
| P6-7 | — (owner) | — | Phase 6 gate 1, 3 |
| MANUAL_STEPS.md | MS6 | MS6-1…MS6-4 | — |

---

