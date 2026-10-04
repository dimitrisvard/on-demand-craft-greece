# Phase 2 build spec: API port (`microns-site` /api router, `microns-ops`, gates, R2)

Status: Phase 2 build specification · 2026-10-02, revised 2026-10-03 after review (Appendix C; private rows in Appendix P.9) · scratch (not in the repo) · nothing here is deployed, committed or applied.

Related (repo): docs/migration/PLAN.md §5.2 (authoritative: PLAN.md:157-261) · docs/migration/ARCHITECTURE.md §6.4, §7, §9, §14, §20 · docs/migration/wrangler.jsonc.draft · docs/migration/INVENTORY.md + inventory.csv:61-72. Related (scratch, this folder): `contracts.md` (per-action contracts, probes), `callers.md` (who calls what), `infra.md` (layout, platform facts, probes), `gates_PRIVATE.md` (gate matrix, PRIVATE). Canon: CANON.md + CANON_ADDENDUM.md (cd2d8729 scratchpad).

> **Handling.** §0–§9 and Appendix C follow the public-repo rules of CANON.md §1 (no secret values, security at summary level, no description of today's weaknesses) and may be quoted in repo docs or handed to any builder. **Appendix P at the end is PRIVATE** (including P.8, the unit E compatibility evidence, and P.9, the private review rows): it must never be copied into the repository, a commit message, a PR, a code comment or a log line (the GitHub repo is public). Builders of units G, S, E and F read Appendix P together with `gates_PRIVATE.md`; the others do not need it.

Evidence tags:

| Tag | Meaning |
|---|---|
| `path:line` | Repo at branch `claude/microns-cloudflare-migration-j6ffpt`, HEAD `ca87d83` (2026-10-03; tree clean when the citations were checked, then another session began uncommitted edits in `scripts/seo-parity/lib/{cli,compare,evidence,extract,volatile}.mjs`, none of which this spec cites; written against `3b88e74`, citations re-checked: `ca87d83` changed only `package.json`, `scripts/seo-parity/**`, `tests/e2e/fixtures/{access.ts,access-errors.spec.ts}`, `workers/site/src/seo/{cache,supabase}.ts`, `workers/site/test/seo-cache.test.ts`) |
| `contracts.md §x`, `callers.md §x`, `infra.md §x`, `gates_PRIVATE.md §x` | The Phase 2 analyses in this folder (each is itself cited to `path:line`, probes and CF docs) |
| CF docs (fetched 2026-10-02) | Copies in `phase2/cfdocs/`, quoted through infra.md §1.1 |
| probe | Local workerd / Node runs of 2026-10-02 (contracts.md §2, infra.md §1.2); this pass also read the `@vercel/node@17.0.0` tarball (`package/dist/dev-server.mjs:907-1120`) |

---

## 0. Ground rules for every builder

| # | Rule | Evidence |
|---|---|---|
| G-1 | Every file has exactly one owner unit (§3). Change only files your unit owns; read anything. A cross-unit need is solved through the contracts of §2, never by editing another unit's file | — |
| G-2 | Never deploy or upload (`wrangler deploy`, `versions upload`, `secret put`, `queues create`, `r2 bucket …`), never call `www.micronshub.eu`, the apex or `*.vercel.app` (this runner gets HTTP 429 challenge pages, callers.md §4), never call Supabase with a real key from a test. Read-only Supabase MCP only where unit F says so; never print a key | PLAN.md:44, :47 |
| G-3 | Untouched in Phase 2: `vercel.json`, `middleware.ts`, `middleware/*`, `api/*`, `lib/*`, `index.html`, `vite.config.ts`; in `workers/site`: `src/index.ts`, `src/sitemap.ts`, `src/seo/**`, `src/redirects.ts`, `src/static.ts`, `src/preview.ts`, `src/compat/vercel-shim.ts`, `vitest.config.ts`, `tsconfig.json` and every Phase 1 test file (`test/*.test.ts`, `test/helpers/**`, `test/fixtures/**`); `scripts/seo-parity/**`, `scripts/verify-ssr.sh`, `tests/middleware/**`, `tests/e2e/{seo,homepage,navigation}.spec.ts`, `tests/e2e/fixtures/**`, `playwright.config.ts`; `docs/migration/**` (corrections need the owner's OK, §8) | PLAN.md:134, :239-240; infra.md §3.1 R-1/R-2, §15 |
| G-4 | Phase 1 is not closed yet: HEAD `ca87d83` is a "wip(phase1): wrap-up fixes before review repair" commit (`git log -1`, 2026-10-03), and Phase 1 repair is still editing `scripts/seo-parity/**` in the working tree (`git status`, 2026-10-03). Phase 2 starts from the commit that closes Phase 1, or with the owner's explicit OK on the preview-only branch. Never stage, revert or reformat another agent's changes | PLAN.md:42 ("one phase at a time") |
| G-5 | Public repo: no secret values and no secret-looking literals (`re_…`, `whsec_…`, `eyJ…`, `AKIA…`); tests build fake keys at runtime (e.g. `'whsec_' + btoa('microns-svix-test-key-NOT-A-SECRET')`). Code comments state the rule a gate enforces, never a weakness of the Vercel copy; no reference to Appendix P, `gates_PRIVATE.md` or finding IDs in code, comments, commits or PRs. The same applies to §0–§9 of this spec and to every README a unit writes: they state the new rule ("requests need X"), never what today's handlers do not check | CANON.md §1 rules 1-2; infra.md §10.3 |
| G-6 | Pushes only after P0-1 (auto-merge of `claude/**` into `main` is gated): any push reaches `main`, and `main` deploys to Vercel production. Unit E's changes reach production on merge and must be proven harmless against the Vercel API (§3 unit E) | PLAN.md:43, :84, :215 |
| G-7 | Log lines start with `[microns-site]` or `[microns-ops]` (workers/site/src/env.ts:19); never log tokens, cookies, signatures, Access assertions, request bodies or e-mail addresses | workers/site/src/index.ts:36-38 |
| G-8 | Toolchain pins as Phase 1: wrangler 4.145.0, vitest 5.0.3, typescript 7.0.2, @cloudflare/workers-types 5.20260930.2; `compatibility_date` 2026-09-01, `nodejs_compat`; Node 22 | workers/site/package.json:13-16; workers/site/wrangler.jsonc:15-16; .github/workflows/cf-preview.yml:142 |
| G-9 | British spelling in docs and comments; tables over prose in READMEs; no emojis | CANON.md §1 rule 4 |

---

## 1. Fixed decisions

| ID | Decision | Reason (one line) | Source |
|---|---|---|---|
| F-1 | Three packages: `workers/shared` (new, source-only, no build step), `workers/site` (Phase 1, extended), `workers/ops` (new). Workers import shared code by relative path (`../../shared/src/...`) | Same mechanism as Phase 1's `import sitemapHandler from '../../../api/sitemap.js'`; no workspace symlinks | infra.md I-1, §2.2; workers/site/src/sitemap.ts:33 |
| F-2 | No npm workspaces: each package keeps its own `package.json` + lockfile; the root `package.json` gets scripts only (`hono` and `aws4fetch` go into `workers/ops` and `workers/shared`, not the root lockfile PLAN.md:231 names; DV-15) | Root lockfile and the Vercel install stay unchanged | infra.md §2.2; package.json:15-25 |
| F-3 | One shim core `workers/shared/src/compat/vercel-node.ts` reproducing the `@vercel/node` 17.0.0 helpers (not Express). Phase 1's `workers/site/src/compat/vercel-shim.ts` is **not** touched in Phase 2 | Phase 1 tests pin its strict behaviour (workers/site/test/sitemap.test.ts:470-477) and Phase 1 is still being finalised; consolidation is a Phase 6 clean-up | infra.md I-2, §3.4; contracts.md §1 |
| F-4 | Every `api/*.js` module is loaded with a literal lazy `import()` inside its route, in both Workers | A missing secret at module scope (`new Resend(undefined)`, api/emails.js:12) otherwise stops the whole Worker; probe shows the lazy form fails only that route | infra.md I-3, §3.6; contracts.md §2 |
| F-5 | Hono 4.13.12 inside `microns-ops` only; `microns-site` keeps its plain step router | Site router order is part of SEO parity (workers/site/src/index.ts:1-24) | infra.md I-4, §5.1 |
| F-6 | Service binding `OPS` = RPC to the named entrypoint `OpsApi`, method `handle(request, call)`; the verified principal and function URL travel in `call`, never in headers; ops default `fetch` answers 404 | A client cannot inject a principal; probe verified the RPC shape | infra.md I-5, §5.2; gates_PRIVATE.md §0 D1 |
| F-7 | `/api/*` order in the site: flag `api.forward_to_vercel` → resolve endpoint/action → handler-owned `OPTIONS`/method rejections (no gate) → gate → dispatch (`local` / `ops` / `forward`); unknown `/api/*` paths are forwarded until P0-3 shows Vercel's answer | Exit gate 7 says "every `/api/*` request" (PLAN.md:250); rollback flag must stay ungated | infra.md I-6, §4.1; gates_PRIVATE.md §0 D11 |
| F-8 | `handleApi` stays exported from `workers/site/src/api/forward.ts` (now flag check + dispatch); `src/index.ts` is unchanged | `workers/site/test/router.test.ts:7-9` mocks that module and asserts dispatch (:159-163) | infra.md §4.1 |
| F-9 | All `/api/notifications` actions go to `OPS` (no site-local `partner`/`production-status`) | `api/notifications.js` statically imports nesting and inventory (api/notifications.js:9-11), 3.2 MiB with `pdf-lib`; exit gate 9 (PLAN.md:252) | infra.md I-8; contracts.md §8 D2 |
| F-10 | Files API is a re-implementation (`workers/site/src/api/files.ts`) with `aws4fetch` (`allHeaders: true` on presigned PUT); R2 key = `rfq/` + today's contract key; reads fall back to legacy S3 eu-north-1; response shapes of api/s3.js unchanged; `articles` scope stays on legacy S3 | api/s3.js needs `@aws-sdk` and reads `VITE_AWS_*` names (api/s3.js:33-65); aws4fetch does not sign `Content-Type` by default (probe) | infra.md I-9, §6; contracts.md §3.2, §8 D3; PLAN.md:166 |
| F-11 | Queue `scrapes` in Phase 2 only for `tender-scan` from MACHINE principals (immediate 200 with every key of today's body at zero, plus `queued` and `run_id`); browser/staff `tender-scan`, funded-startups scan and GSC bulk actions stay synchronous. Consumer kinds built: `tender-scan`, `funded-scan`. GSC kinds are deferred to Phase 5 | Interactive callers print the counts; `tender-collector` aborts at 25 s; GSC jobs need a non-handler path (api/gsc.js:190 requires a user token) | infra.md I-10, §7; contracts.md §8 D1; supabase/functions/tender-collector/index.ts:8, :75-80 |
| F-12 | `nest` runs synchronously on `microns-ops` with `limits.cpu_ms` = 300,000; no Durable Object or Container in Phase 2; an `OPS` RPC rejection on `nest` maps to 504 JSON `TIMEOUT` | Measured CPU exceeds 30 s near 700 part instances; the nester's 50 s guard never trips deployed (`Date.now()` frozen during CPU) | infra.md I-11, §8; contracts.md §6; api/notifications.js:150-153 |
| F-13 | Supabase JWT verified with `GET {SUPABASE_URL}/auth/v1/user` after a local pre-check; roles read as an array from `user_roles` with the caller's JWT; ≤ 60 s per-isolate cache; no JWT secret in any Worker; JWKS path built but dormant | The project's JWKS is empty (live 2026-10-02); same trust model as api/_lib/admin-auth.js:31-35 | infra.md I-12, §9.3; gates_PRIVATE.md §2.1 |
| F-14 | Gates run in `microns-site` (P2-7 modules). Two checks run in `microns-ops` because their secrets live there: the Resend Svix verification and the Google OAuth `state` | One gate placement; secrets stay single-homed | gates_PRIVATE.md §0 D1, §2.5-§2.6; infra.md Appendix P P-1 |
| F-15 | Machine callers use Cloudflare Access service tokens, one per consumer: `microns-machine-collector` (`tender-collector`) and `microns-machine-mcp` (local MCP server). Principal `MACHINE:<name>` is accepted only on preview hosts (`isPreviewHost`) or on a host listed in the new var `API_MACHINE_HOSTS` (comma list, exact host match; `""` in Phase 2, `api.micronshub.eu` set by the Phase 3 runbook). The var is needed because `isPreviewHost` refuses every host of the production zone (workers/site/src/preview.ts:52-56) | One credential per consumer keeps each revocable alone; an Access app on the `www` path would block the dashboard caller (TenderMonitorPage.tsx:240) | gates_PRIVATE.md §0 D5, §4; callers.md §10 |
| F-16 | Turnstile only on `/api/emails`; token in request header `X-Turnstile-Token`; widget in `src/components/contact/ContactForm.tsx` and `src/components/quote-form/MultiStepQuoteForm.tsx`; no new npm dependency in the frontend (script loader of our own). No site key → no widget (no hard-coded fallback key); a form always submits, with or without a token, and the server decides | The PLAN's three files submit no routed form (callers.md §9); a new dependency would change both root lockfiles (PLAN.md Q15); a missing key in a Worker build is caught by the CI check of unit B | gates_PRIVATE.md §0 D6, §2.2; callers.md §10 |
| F-17 | CORS: exact Vercel parity in Phase 2 through Phase 1's `finalise()` (workers/site/src/preview.ts:76-79), unchanged. The allow-list mode is built as a pure function in `workers/shared/src/http/cors.ts` with tests; wiring it (and its var) waits for the switch after the Phase 3 observation window | Exit gate 5 (PLAN.md:248); keeps `preview.ts` untouched | gates_PRIVATE.md §0 D10, §8 |
| F-18 | Tests in three tiers: T1 vitest 5 in Node per package; T2 workerd via `wrangler dev` with both configs and a local upstream stub; T3 Playwright `tests/e2e/api.spec.ts` on the preview. `@cloudflare/vitest-plugin` is not used | Plugin requires `vitest ^4.1.0`, Phase 1 pins 5.0.3 | infra.md I-13, §10 |
| F-19 | Bundle guard: `wrangler deploy --dry-run --metafile` + `workers/site/scripts/check-bundle.mjs` failing on forbidden inputs | Exit gate 9 (PLAN.md:252); probe measured 0 forbidden inputs for the site API subset | infra.md I-14, §11 |
| F-20 | R2 bucket `microns-private` with jurisdiction `eu` (binding `"jurisdiction": "eu"`; S3 endpoint `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`); code constant `R2_JURISDICTION = 'eu'` with a config test | Only choosable at creation; holds customer files (AGENTS.md §2.6). Owner may decline (§7 D-1), then both flip to `''` | infra.md §6.1 |
| F-21 | Legacy bucket names become vars `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET` (proposed names; values from P0-4) instead of code constants | Values unknown at build time; tests override them; not secret (they appear in every returned `publicUrl`, api/s3.js:122-125) | wrangler.jsonc.draft:186-187; contracts.md §4 |
| F-22 | Every Phase 2 field of the site `Env` interface is optional. There is no global config check: each dispatch target (§2.4 table "Names per target") and each gate check declares the names it needs and checks them after resolution with the shared `missingNames()`; a missing name answers 500 only on the requests that need it (a missing `RESEND_API_KEY` never breaks tracking links) | `test/helpers/seo-harness.ts:232-245` returns an un-cast `Env` literal; required fields would break the Phase 1 typecheck; F-4 (a missing secret fails only its route) | workers/site/test/helpers/seo-harness.ts:232-245; api/marketing.js:11-21 (track needs only the Supabase names) |
| F-23 | Existing defects are ported unchanged (tracking first-hit headers, `inv-*` method mismatches, `?action=feeds` 500, failing scan-log inserts), with two exceptions: (1) a Resend webhook retry of an event already recorded is acknowledged with 200 without re-processing; (2) `delete-folder` normalises its prefix to end in `/` before listing on either store, so `RFQ-…-1` no longer also deletes `RFQ-…-10/` … `RFQ-…-19/` (response shape unchanged) | Parity first (contracts.md §8 D9); (1) once Svix verification works, the post-write 500 of `email.bounced` (api/marketing.js:305-316) would otherwise repeat writes on every Resend retry; (2) callers pass the bare RFQ number (src/pages/RfqDetails.tsx:865, src/pages/OrderDetailsPage.tsx:448 via src/utils/awsS3Storage.ts:94-100), api/s3.js:188-195 lists by that raw prefix, and every upload key is `<prefix>/<name>` (api/s3.js:159) | contracts.md §3.4, §8 D9 |
| F-24 | Three Rate Limiting bindings: `API_RATE_LIMIT` (30/60 s, `namespace_id` `"2001"`), `API_RATE_LIMIT_MAIL` (5/60 s, `"2002"`) and `API_RATE_LIMIT_BULK` (300/60 s, `"2003"`) (the last two are proposed names). BULK serves the per-user keys of idempotent reads and the upload-presign keys; code falls back to `API_RATE_LIMIT` when MAIL or BULK is absent | One binding has one limit; mail keys need a tighter one; pages presign every 3D file of an RFQ in parallel (src/pages/RfqDetails.tsx:307-313, src/pages/customer/QuoteDetailPage.tsx:129-134, src/pages/customer/PartConfigurationPage.tsx:159-166) and the quote form uploads every file in one loop (src/components/quote-form/MultiStepQuoteForm.tsx:481-488), which 30/60 s would cut off | gates_PRIVATE.md §2.3, §12; infra.md §9.1 |
| F-25 | `API_FORWARD_ORIGIN` = `https://on-demand-craft-greece.vercel.app` in Phase 2 (was `https://www.micronshub.eu`) | The forward refuses its own host once `www` routes to the Worker (workers/site/src/api/forward.ts:61-65); PLAN.md:178 names this host | infra.md §4.4 |
| F-26 | Request bodies above 4,718,592 bytes (4.5 MiB) answer 413 `{"error":"payload_too_large"}` before any handler; exact Vercel cut-off re-checked in P2-12 | Vercel's documented 4.5 MB function payload limit (contracts.md §1) | contracts.md §1 |
| F-27 | No new `feature_flags` keys in Phase 2. New runtime switches are vars: `API_FORWARD_TO_VERCEL` (fallback of the flag), `API_GATES_MODE` (report mode per gate class) | CANON flag list is fixed (CANON.md §7) | infra.md §4.4; gates_PRIVATE.md §2.8 |
| F-28 | e2e write tests use dedicated test users and seeded rows that the owner creates and removes; any test that sends real e-mail is opt-in (`E2E_SEND_MAIL=1`) and sends only to Resend test sinks or the owner's own addresses. Uploads through the preview land in R2 while their `rfq_files` rows land in the production database, so only seeded test RFQs are used on the preview (O-22) | The preview Worker uses the production Supabase and Resend; production staff on Vercel presign against legacy S3 until Phase 3 (src/utils/rfqFileStorage.ts:28-49 stores the returned key) | PLAN.md:217, :244 |
| F-29 | Gated write paths whose gate rewrites or checks body fields (`/api/emails` `email`/`contact`/`rfq`; `/api/notifications` `inv-*`) accept a non-empty body only as `application/json` (415 `{"error":"unsupported_media_type"}` otherwise), and the e-mail paths accept only string (or `null`) top-level values (400 `{"error":"invalid_field"}` otherwise) | A rewrite must see the same object the handler sees; every caller sends JSON strings (src/components/contact/ContactForm.tsx:98-108, src/utils/emailService.ts:22-42, src/utils/inventoryApi.ts:26-33) | dev-server.mjs:926-945 (`@vercel/node` also parses form bodies) |
| F-30 | Turnstile test-key mode: when `TURNSTILE_SECRET_KEY` is one of Cloudflare's documented test secrets (`1x…AA`, `2x…AA`, `3x…AA`), the gate checks only `success` and logs `turnstile test-key mode` once per isolate, and only on preview hosts; a test secret on any other host answers 503 `turnstile_unavailable` with an error log (fail closed). A real secret always gets the full checks (action, hostname, age) | The test secret's siteverify answer is fixed (`action` `test`, `hostname` `localhost`, `challenge_ts` 2022), so the full checks can never pass with test keys (phase2/cfdocs/turnstile_testing.md:113-136); the preview uses test keys in Phase 2 (O-7) | gates_PRIVATE.md §2.2 |

---

## 2. Contracts every unit relies on

### 2.1 Tree and owners (`+` new, `~` changed, `=` unchanged; unit letters of §3)

```
workers/
  shared/                                  + A (package skeleton, lockfile, configs, README)
    package.json, package-lock.json        + A   (full dependency list of §2.2; nobody else edits them)
    tsconfig.json, vitest.config.ts, .gitignore, README.md   + A
    src/compat/vercel-node.ts              + A   shim core (profile "vercel" only)
    src/compat/ambient.d.ts                + A   minimal module declarations: content-type, node:querystring, node:buffer, node:crypto
    src/http/env-check.ts                  + A   missingNames(), configError() (F-22)
    src/compat/vercel-rewrite.ts           + A   vercel.json rewrite merge for /api aliases
    src/compat/etag.ts                     + A
    src/http/rpc.ts                        + A   EndpointId, Principal, OpsCall, OpsApiRpc
    src/http/json.ts, src/http/log.ts      + A
    src/http/cors.ts                       + A   parity constants + allow-list function (unwired, F-17)
    src/auth/supabase-jwt.ts               + G
    src/auth/access-jwt.ts                 + G
    src/auth/turnstile.ts                  + G
    src/auth/svix.ts                       + G
    src/auth/rate-limit.ts                 + G
    src/storage/s3-presign.ts              + S   aws4fetch wrappers (R2 S3 API + legacy S3)
    src/storage/s3-xml.ts                  + S   ListObjectsV2 XML parsing
    test/compat/**, test/http/**           + A
    test/auth/**, test/helpers/jwt.ts      + G   jwt.ts: jose-based minting helpers, also imported by site tests (jose resolves from workers/shared/node_modules)
    test/storage/**, test/helpers/fake-s3.ts   + S
  site/
    src/index.ts, src/sitemap.ts, src/seo/**, src/redirects.ts, src/static.ts, src/preview.ts   =
    src/compat/vercel-shim.ts              =
    src/compat/api-modules.d.ts            ~ B   add */api/emails.js, */api/marketing.js
    src/env.ts                             ~ B   Phase 2 optional fields (written by A in Wave 0, §2.14; B owns afterwards)
    src/flags.ts                           ~ B   add getFlagValue()
    src/api/forward.ts                     ~ B   handleApi = flag + dispatch; Phase 1 body -> forwardToVercel(request, env, body?)
    src/api/resolve.ts                     + B   endpoint catalogue (endpointOfPath) + action resolver (§2.8)
    src/api/router.ts                      + B   routeApi(): path, buffer, resolve, names, gate, dispatch, error mapping
    src/api/emails.ts, src/api/track.ts    + B   lazy api/emails.js, api/marketing.js through the shim
    src/api/ops-client.ts                  + B   builds the OPS Request + OpsCall, maps RPC failures
    src/api/files.ts                       + S   /api/s3 re-implementation
    src/auth/gate.ts, src/auth/policy.ts   + G   applyGate(), action IDs, per-ID rules
    src/auth/constraints.ts                + G   FileConstraints type (Appendix P.2)
    src/auth/db.ts                         + G   PostgREST helper for gate lookups
    src/auth/tracking.ts                   + G   tracking-link rules (Appendix P.3)
    src/auth/{supabase-jwt,turnstile,rate-limit,access}.ts   + G   env adapters over shared/auth (PLAN.md:212, :228)
    scripts/check-bundle.mjs               + B
    r2/cors.private.json                   + S   bucket CORS for the owner (infra.md §6.5)
    vitest.t2.config.ts                    + B
    test/{resolve,router-api,forward-flag,rewrite-crosscheck,emails-local,track-local,env-api}.test.ts   + B
    test/{gates,gate-*,policy}.test.ts     + G
    test/{files,files-*}.test.ts           + S
    test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs,stub-client.ts}   + B
    test/integration/{api-router,track,startup}.t2.ts   + B
    test/integration/gates.t2.ts           + G
    test/integration/files.t2.ts           + S
    wrangler.jsonc                         ~ B
    package.json                           ~ B   scripts only (no new dependency)
    .dev.vars.example                      + B
    README.md                              ~ B   Phase 2 section; size-limit line (README.md:187)
  ops/                                     + C (everything below unless marked G)
    package.json, package-lock.json, tsconfig.json, vitest.config.ts, vitest.t2.config.ts, .gitignore, .dev.vars.example, README.md
    wrangler.jsonc
    src/index.ts                           OpsApi entrypoint, default export {fetch 404, queue}
    src/app.ts, src/env.ts
    src/compat/express-shim.ts, src/compat/api-modules.d.ts
    src/routes/{gsc,tenders,tender-scan,scrape,scan-directory,funded-startups,marketing,notifications}.ts
    src/routes/marketing-webhook.ts        + G
    src/routes/google-auth.ts              + G
    src/queues/messages.ts, src/queues/scrapes.ts
    scripts/nest-fixture.mjs
    test/**                                (G owns test/marketing-webhook.test.ts, test/google-auth.test.ts)
src/**                                     ~ E   frontend files of §3 unit E
tests/frontend-api/**                      + E   vitest tests of the new frontend helpers
mcp-server/src/index.ts, mcp-server/README.md   ~ F
supabase/functions/tender-collector/index.ts    ~ F   built from the LIVE source; not deployed
tests/e2e/api.spec.ts, tests/e2e/api/**    + F
.env.example, docs/AWS_S3_VERCEL_GUIDE.md  ~ F
scripts/r2-to-legacy-s3.mjs                + S   owner-run rollback copy helper
package.json (root)                        ~ B   scripts only
.github/workflows/cf-preview.yml           ~ B
.github/workflows/cf-ops.yml               + C   manual dispatch only
```

### 2.2 Dependencies (exact pins; A writes all of `workers/shared/package.json` in Wave 0)

| Package | Where | Kind | Version | Used by | Evidence |
|---|---|---|---|---|---|
| `aws4fetch` | shared | dependency | 1.0.20 | S | infra.md §1.2, §6.4 |
| `jose` | shared | dependency | 6.2.12 | G (Access JWT, dormant JWKS) | infra.md §9.3-§9.4 |
| `content-type` | shared | dependency | 1.0.5 | A (`@vercel/node` parses and re-formats `Content-Type` with it, dev-server.mjs:919-925, :969-974) | root node_modules/content-type 1.0.5 |
| `svix` | shared | devDependency (oracle) | 1.88.0 | G tests | contracts.md §3.1 (resend dep) |
| `@smithy/signature-v4`, `@aws-crypto/sha256-js` | shared | devDependency (oracle) | 5.3.13, 5.2.0 | S tests | root node_modules versions; infra.md §10.3 |
| `etag` | shared | devDependency (oracle) | 1.8.1 | A tests | root node_modules/etag 1.8.1 |
| `@cloudflare/workers-types`, `typescript`, `vitest` | shared, ops | devDependency | 5.20260930.2, 7.0.2, 5.0.3 | all | G-8 |
| `hono` | ops | dependency | 4.13.12 | C | infra.md §5.1 |
| `wrangler` | ops | devDependency | 4.145.0 | C | G-8 |
| `api/*.js`, `lib/*` deps (`resend`, `@supabase/supabase-js`, `qrcode`, `pdf-lib`, `makerjs`, …) | root | unchanged | root lockfile | both Workers | Resolved from the root `node_modules` so the Workers run the Vercel versions (infra.md §2.2) |

Install order for every local run: `npm ci` (root) → `npm --prefix workers/shared ci` → `npm --prefix workers/site ci` → `npm --prefix workers/ops ci` (root script `cf:install`, §3 unit B).

### 2.3 Shared modules (signatures are binding; bodies per unit)

```ts
// ===== workers/shared/src/http/rpc.ts (A) =====
export type EndpointId =
  | 'emails' | 's3' | 'marketing' | 'notifications' | 'gsc' | 'tenders' | 'tender-scan'
  | 'funded-startups' | 'scrape-website' | 'scrape-company-profile' | 'scan-directory';
export type PrincipalClass = 'ANON' | 'CUSTOMER' | 'PARTNER' | 'STAFF' | 'ADMIN' | 'MACHINE';
export interface Principal {
  class: PrincipalClass;      // highest class: ADMIN > STAFF > PARTNER > CUSTOMER; ADMIN implies STAFF
  uid?: string;               // Supabase user id
  email?: string;             // Supabase user e-mail (never logged)
  roles?: string[];           // user_roles.role values as read (array)
  machine?: 'collector' | 'mcp';  // MACHINE only
}
export interface OpsCall {
  v: 1;
  requestId: string;          // crypto.randomUUID(), logged by both Workers
  endpoint: EndpointId;
  action: string;             // normalised action of §2.8; may be a sentinel ('#options', '#method', …): those requests are dispatched ungated and the handler answers them
  functionUrl: string;        // path + query the handler sees (rewrite merged)
  principal: Principal;
  openerOrigin?: string;      // marketing google-auth authorize only: origin of the request URL, validated by the site gate (Appendix P.5)
}
export interface OpsApiRpc { handle(request: Request, call: OpsCall): Promise<Response>; }

// ===== workers/shared/src/compat/ambient.d.ts (A) =====
// Minimal `declare module` blocks for 'content-type' (parse, format), 'node:querystring' (parse),
// 'node:buffer' (Buffer: from, isBuffer, concat, byteLength) and 'node:crypto' (createHash) so that every
// program that imports the shim type-checks under a tsconfig with types ['@cloudflare/workers-types'] only
// (workers/site/tsconfig.json is frozen, G-3; content-type@1.0.5 ships no .d.ts). vercel-node.ts and etag.ts
// start with `/// <reference path="./ambient.d.ts" />`, so importing programs pick it up without a tsconfig change.

// ===== workers/shared/src/http/env-check.ts (A) =====
export function missingNames(env: object, names: readonly string[]): string[];   // names whose value is undefined, null or ''
export function configError(prefix: string, missing: readonly string[]): Response;  // logs `${prefix} api config missing: <NAMES>`; 500 text/plain "Internal Server Error"

// ===== workers/shared/src/compat/vercel-node.ts (A) =====
export type VercelHandler = (req: any, res: any) => unknown;
export class ApiError extends Error { readonly statusCode: number; constructor(statusCode: number, message: string); }
export const MAX_FUNCTION_BODY_BYTES = 4_718_592;     // F-26
export const DEFAULT_TIMEOUT_MS = 30_000;
export const RAW_BODY: unique symbol;                 // req[RAW_BODY]: Uint8Array (also exposed as req.rawBody)
export type BodyView = { ok: true; value: unknown } | { ok: false; error: ApiError | Error };
/** Exact @vercel/node getBodyParser semantics (dev-server.mjs:919-945, :1108-1120), evaluated once. */
export function parseVercelBody(contentType: string | null, bytes: Uint8Array): BodyView;
/** Node querystring-style parse over URLSearchParams (repeated key -> array), as Phase 1 (vercel-shim.ts:80-90). */
export function parseQuery(search: string): Record<string, string | string[]>;
export interface NodeHandlerInit {
  request: Request;           // method and headers only; the body is NOT read from it
  functionUrl: string;        // becomes req.url
  body: Uint8Array | null;    // raw bytes (null for GET/HEAD); req.body is parsed lazily from these
  ctx?: { waitUntil(p: Promise<unknown>): void };
  timeoutMs?: number;         // default DEFAULT_TIMEOUT_MS
  logPrefix: string;          // '[microns-site]' | '[microns-ops]'
}
/** Runs a Vercel (req, res) handler; resolves at res.end(); see §2.3.1. */
export function runNodeHandler(handler: VercelHandler, init: NodeHandlerInit): Promise<Response>;

// ===== workers/shared/src/compat/vercel-rewrite.ts (A) =====
export interface ApiRewrite { source: string; destinationPath: string; destinationSearch: string; }
export const API_REWRITES: ReadonlyArray<ApiRewrite>;  // '/api/track' -> '/api/marketing?action=track'; '/api/connector-status' -> '/api/tenders?connectors=true' (vercel.json:150-157)
/** Algorithm of workers/site/src/sitemap.ts:59-103 (request keys override destination keys; request keys first; re-encoded). */
export function mergeRewriteQuery(destinationSearch: string, requestSearch: string): string;   // '' or '?…'
/** Rewritten paths: destinationPath + merged query. Any other path: url.pathname + url.search, raw. */
export function functionUrlFor(url: URL): { functionUrl: string; functionPath: string; rewritten: boolean };

// ===== workers/shared/src/compat/etag.ts (A) =====
export function weakEtag(body: Uint8Array | string): string;   // == require('etag')(body, { weak: true })

// ===== workers/shared/src/http/json.ts (A) =====
export function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response;  // application/json; charset=utf-8
export function textResponse(status: number, text: string, headers?: HeadersInit): Response;   // text/plain; charset=utf-8
export function apiError(status: number, code: string, headers?: HeadersInit): Response;       // {"error": code}

// ===== workers/shared/src/http/log.ts (A) =====
export function logLine(prefix: string, event: string, fields?: Record<string, string | number | boolean | undefined>): void;

// ===== workers/shared/src/http/cors.ts (A) =====
export const VERCEL_API_CORS_HEADERS: ReadonlyArray<readonly [string, string]>;  // byte copy of workers/site/src/preview.ts:18-23
export interface AllowlistConfig { siteOrigin: string; requestHost: string; requestIsPreview: boolean; workersSubdomain?: string; }
export function isAllowedOrigin(origin: string, cfg: AllowlistConfig): boolean;   // allow-list of §2.11 (exact host match)
export function applyAllowlistCors(headers: Headers, origin: string | null, cfg: AllowlistConfig): void;

// ===== workers/shared/src/auth/supabase-jwt.ts (G) =====
export const STAFF_ROLES: readonly ['admin', 'sales_rep', 'production_manager', 'accountant'];  // api/_lib/admin-auth.js:16
export interface SupabaseAuthConfig { supabaseUrl: string; anonKey: string; fetchImpl?: typeof fetch; nowMs?: () => number; }
export interface VerifiedUser { uid: string; email: string | null; roles: string[]; }
export type JwtResult = { ok: true; user: VerifiedUser } | { ok: false; status: 401 | 503; code: 'unauthorized' | 'auth_unavailable' };
export function bearerToken(headers: Headers): string | null;
export function precheckSupabaseJwt(token: string, nowSec: number): { ok: true; sub: string; exp: number } | { ok: false };
export function verifySupabaseJwt(token: string, cfg: SupabaseAuthConfig): Promise<JwtResult>;
export function classOfRoles(roles: string[]): 'ADMIN' | 'STAFF' | 'PARTNER' | 'CUSTOMER';

// ===== workers/shared/src/auth/access-jwt.ts (G) =====
export interface AccessConfig { teamDomain: string; audiences: string[]; fetchImpl?: typeof fetch; nowSec?: () => number; }
// teamDomain "x.cloudflareaccess.com" -> https://x.cloudflareaccess.com/cdn-cgi/access/certs; a value starting with "http://" or "https://" is used as the origin (T2 stub only)
export type AccessResult = { ok: true; commonName: string | null; email: string | null } | { ok: false; reason: string };
export function verifyAccessAssertion(headers: Headers, cfg: AccessConfig): Promise<AccessResult>;  // header Cf-Access-Jwt-Assertion
export function parseMachineMap(value: string | undefined): Map<string, 'collector' | 'mcp'>;       // "<client-id>=<name>,<client-id>=<name>"

// ===== workers/shared/src/auth/turnstile.ts (G) =====
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_TEST_SECRETS: readonly string[];   // CF documented test secrets 1x/2x/3x…AA (public values, phase2/cfdocs/turnstile_testing.md)
export function isTurnstileTestSecret(secret: string): boolean;   // exact match only
export interface TurnstileInput {
  token: string | null; secret: string; remoteIp: string | null;
  expectedActions: readonly string[]; hostnameAllowed: (hostname: string) => boolean;
  allowTestSecret: boolean;   // site adapter: isPreviewHost(request host); F-30
  fetchImpl?: typeof fetch; nowMs?: () => number;
}
// Real secret: success && action ∈ expectedActions && hostnameAllowed(hostname) && challenge_ts ≤ 300 s old.
// Test secret + allowTestSecret: success only (one 'turnstile test-key mode' log line per isolate).
// Test secret + !allowTestSecret: no siteverify call; 503 turnstile_unavailable + error log.
export type TurnstileResult = { ok: true; testMode: boolean } | { ok: false; status: 403 | 503; code: 'turnstile_failed' | 'turnstile_unavailable' };
export function verifyTurnstile(input: TurnstileInput): Promise<TurnstileResult>;

// ===== workers/shared/src/auth/svix.ts (G) =====
export interface SvixInput { secret: string; headers: Headers; rawBody: Uint8Array; nowSec?: () => number; toleranceSec?: number; }  // tolerance default 300
export type SvixResult = { ok: true; id: string; timestamp: number }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'bad_timestamp' | 'bad_signature' };
export function verifySvix(input: SvixInput): Promise<SvixResult>;

// ===== workers/shared/src/auth/rate-limit.ts (G) =====
export interface RateLimiter { limit(options: { key: string }): Promise<{ success: boolean }>; }
export type RateKind = 'form' | 'rcpt' | 'upl' | 'u' | 'm' | 'trk' | 'oauth';
export function rateKey(kind: RateKind, ...parts: string[]): string;     // e.g. 'u:<uid>:nest', 'u:<uid>:s3:r' (idempotent read), 'u:<uid>:s3:up'
export type RateBinding = 'default' | 'mail' | 'bulk';
export function bindingFor(key: string): RateBinding;   // 'form:'/'rcpt:' -> mail; 'upl:' and keys ending ':r' or ':up' -> bulk; else default (A-14)
export function allow(limiter: RateLimiter, key: string): Promise<boolean>;

// ===== workers/shared/src/storage/s3-presign.ts (S) =====
export interface S3Target { endpoint: string; bucket: string; region: string; style: 'path' | 'virtual'; accessKeyId: string; secretAccessKey: string; }
export function r2Target(accountId: string, jurisdiction: 'eu' | '', bucket: string, accessKeyId: string, secretAccessKey: string): S3Target;
export function legacyTarget(bucket: string, region: string, accessKeyId: string, secretAccessKey: string): S3Target;
export function legacyPublicUrl(bucket: string, region: string, key: string): string;   // `https://${bucket}.s3.${region}.amazonaws.com/${key}` (api/s3.js:122-125), raw key
export function presignPut(t: S3Target, key: string, contentType: string, expiresSec: number, o?: { contentLength?: number; datetime?: string }): Promise<string>;
export function presignGet(t: S3Target, key: string, expiresSec: number, o?: { datetime?: string }): Promise<string>;
export function signedDelete(t: S3Target, key: string, fetchImpl?: typeof fetch): Promise<void>;
export function headObject(t: S3Target, key: string, fetchImpl?: typeof fetch): Promise<boolean>;
export function listFirstPage(t: S3Target, prefix: string, fetchImpl?: typeof fetch): Promise<Array<{ key: string; lastModified: string }>>;  // ListObjectsV2, ≤ 1,000 keys
```

#### 2.3.1 Shim behaviour (`runNodeHandler`, unit A; one T1 test per row)

| `@vercel/node` behaviour (evidence) | Shim |
|---|---|
| `req.query`: URL keys, repeated key → array (dev-server.mjs:947-960) | `parseQuery(functionUrl)`, lazy and settable |
| `req.url` = function path + query; `req.method`; `req.headers` lower-case object, repeated values joined | As Phase 1 (workers/site/src/compat/vercel-shim.ts:92-107) |
| `req.body`: no `Content-Type` header → `''`; `application/json` → object, empty → `{}`, invalid → `ApiError(400,'Invalid JSON')` thrown on **every** access (getter not memoised on throw); `text/plain` → string; `application/x-www-form-urlencoded` → `querystring.parse`; `application/octet-stream` → Buffer; other types → `undefined`; a malformed `Content-Type` makes the getter throw the parser's `TypeError` (dev-server.mjs:919-945, :994-1008, :1108-1120) | Same, with `content-type@1.0.5` and `node:querystring` (typed through `ambient.d.ts`); settable (`req.body = …` replaces it) |
| `res.status`, `setHeader` (values stringified, arrays kept), `getHeader`, `hasHeader`, `removeHeader`, `getHeaders`, `statusCode`, `headersSent`, `writableEnded` | Same |
| `res.json(x)`: `JSON.stringify`, `content-type: application/json; charset=utf-8` if unset, then `send` (dev-server.mjs:1013-1019) | Same |
| `res.send(string)`: `text/html` if unset; any existing type re-formatted with `charset=utf-8` (`text/csv` → `text/csv; charset=utf-8`); weak ETag unless set; 204/304 strip `Content-Type`/`Content-Length` and body; HEAD sends no body (dev-server.mjs:1020-1086) | Same; ETag via `weakEtag`; `Content-Length` left to the runtime |
| `res.send(Buffer)` → `application/octet-stream` if unset; `send(object\|number\|boolean)` → `json`; `send(null)` → `''` | Same (`inv-label` sends a Buffer, lib/inventory/index.js:407-409) |
| `res.end(string\|Buffer)`: body as given, no type/charset/ETag | Same (tracking bytes depend on it, api/marketing.js:74-229) |
| `res.redirect([status,] url)` → `writeHead(status, {Location}).end()`, default 307, no body, relative URLs allowed; invalid arguments throw (dev-server.mjs:981-993) | Headers built by hand, never `Response.redirect()` |
| `res.writeHead(status, headers)`, `res.write(chunk)` | Buffered; one `Response` at `end()` (no handler streams) |
| Response flushed at `end()`; later work not awaited | `ctx.waitUntil(run)` after `end()`; a late rejection is logged (lib/inventory/consume-session.js:76, :93) |
| Throw/rejection before `end()` | An `ApiError` (or any error with numeric `statusCode` 400-599) → that status, `text/plain; charset=utf-8`, body = message; anything else propagates (the caller answers 500 text/plain, workers/site/src/index.ts:40-45). Exact Vercel bytes are a P0-3 capture item (infra.md X-4) |
| No `end()` within `timeoutMs` | 504 `text/plain` "Gateway Timeout" (Phase 1 convention, vercel-shim.ts:192-197) |
| Module-scope `process.env` | Not handled by the shim: populated by `nodejs_compat` (infra.md §1.1) |

### 2.4 Site modules (`workers/site/src`)

```ts
// ===== env.ts (B) — Phase 1 fields unchanged (env.ts:4-16); every Phase 2 field optional (F-22) =====
export interface Env {
  /* Phase 1 fields … */
  OPS?: Fetcher & OpsApiRpc;  PRIVATE_FILES?: R2Bucket;  API_RATE_LIMIT?: RateLimit;  API_RATE_LIMIT_MAIL?: RateLimit;
  R2_ACCOUNT_ID?: string;  LEGACY_S3_REGION?: string;  LEGACY_S3_RFQ_BUCKET?: string;  LEGACY_S3_ARTICLES_BUCKET?: string;
  API_FORWARD_TO_VERCEL?: string;  ACCESS_TEAM_DOMAIN?: string;  ACCESS_AUD?: string;  API_GATES_MODE?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;  RESEND_API_KEY?: string;  TURNSTILE_SECRET_KEY?: string;
  R2_ACCESS_KEY_ID?: string;  R2_SECRET_ACCESS_KEY?: string;  LEGACY_AWS_ACCESS_KEY_ID?: string;  LEGACY_AWS_SECRET_ACCESS_KEY?: string;
  ACCESS_MACHINE_CLIENT_IDS?: string;  API_RATE_LIMIT_BULK?: RateLimit;  API_MACHINE_HOSTS?: string;
}
// No ApiEnv / requireApiEnv (F-22): names are checked per target (router.ts) and per gate check (auth/gate.ts)
// with missingNames() from workers/shared/src/http/env-check.ts.

// ===== flags.ts (B) — getFlag unchanged (flags.ts:12-23) =====
export interface FlagValue { enabled: boolean; value?: { paths?: string[]; hosts?: Array<'preview' | 'production'> } }
export function getFlagValue(env: Env, key: string): Promise<FlagValue | null>;     // null: missing, malformed or KV error (logged)

// ===== api/forward.ts (B) =====
export function forwardHeaders(incoming: Headers, clientHost: string): Headers;     // unchanged (forward.ts:28-43)
export const HOP_BY_HOP: ReadonlySet<string>;                                        // now exported (forward.ts:16-26), reused by callOps
/** The Phase 1 body of handleApi (forward.ts:52-80) with one change: when `body` is passed (bytes already
 *  buffered by routeApi) it is sent as is and the request body is never read; otherwise it reads
 *  request.arrayBuffer() exactly as Phase 1 (forward.ts:67-72). A body stream can be read only once. */
export function forwardToVercel(request: Request, env: Env, body?: Uint8Array | null): Promise<Response>;
export function shouldForward(env: Env, url: URL): Promise<boolean>;                 // §2.7
export function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;  // shouldForward ? forwardToVercel : routeApi

// ===== api/resolve.ts (B) — semantics in §2.8 =====
export type Sentinel = '#options' | '#method' | '#unknown' | '#unknown-step' | '#throws';
export interface ResolvedApi {
  endpoint: EndpointId;
  publicPath: string;                  // url.pathname as requested
  functionUrl: string;                 // functionUrlFor(url).functionUrl
  method: string;                      // upper case
  query: Record<string, string | string[]>;  // parseQuery of functionUrl
  body: BodyView;                      // parseVercelBody(Content-Type, bodyBytes)
  bodyBytes: Uint8Array;               // empty for GET/HEAD
  action: string | Sentinel;           // normalised, §2.8
  rawAction: unknown;                  // the value the handler switches on
  scope?: 'rfq' | 'articles';          // s3 only
  step?: string;                       // marketing google-auth: 'error' | 'authorize' | 'callback' | 'refresh'
}
export function endpointOfPath(pathname: string): EndpointId | null;   // catalogue lookup by path only (incl. /api/track, /api/connector-status); null -> forward unbuffered
export function resolveApi(request: Request, bodyBytes: Uint8Array): ResolvedApi;   // called only when endpointOfPath() is not null
export function isSentinel(action: string): action is Sentinel;

// ===== api/router.ts (B) =====
export type Target = 'local' | 'ops' | 'forward';
export function targetOf(r: ResolvedApi): Target;     // §2.8 table; marketing 'track' -> local, other marketing -> ops
export function routeApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;

// ===== api/emails.ts, api/track.ts (B) =====
export interface LocalInput { request: Request; env: Env; ctx: ExecutionContext; functionUrl: string; body: Uint8Array | null; principal: Principal; }
export function handleEmails(i: LocalInput): Promise<Response>;   // lazy import('../../../../api/emails.js'), runNodeHandler, 30 s
export function handleTrack(i: LocalInput): Promise<Response>;    // lazy import('../../../../api/marketing.js'), runNodeHandler, 30 s

// ===== api/ops-client.ts (B) =====
export function callOps(env: Env & { OPS: Fetcher & OpsApiRpc }, request: Request, r: ResolvedApi, o: { functionUrl: string; body: Uint8Array | null; principal: Principal; requestId: string; openerOrigin?: string }): Promise<Response>;

// ===== api/files.ts (S) =====
export interface FilesEnv {
  PRIVATE_FILES: R2Bucket; R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string;
  LEGACY_S3_REGION: string; LEGACY_S3_RFQ_BUCKET: string; LEGACY_S3_ARTICLES_BUCKET: string;
  LEGACY_AWS_ACCESS_KEY_ID: string; LEGACY_AWS_SECRET_ACCESS_KEY: string;
}
export const R2_JURISDICTION: 'eu' | '';      // F-20
export function handleFiles(i: { resolved: ResolvedApi; principal: Principal; constraints: FileConstraints; env: FilesEnv; ctx: ExecutionContext; fetchImpl?: typeof fetch }): Promise<Response>;

// ===== auth/gate.ts (G) =====
export type ActionId = 'EM-1' | 'EM-2' | 'EM-3' | 'EM-4' | 'S3-1' | 'S3-2' | 'S3-3' | 'S3-4' | 'S3-5' | 'S3-6'
  | 'MK-1' | 'MK-2' | 'MK-3' | 'MK-4' | 'MK-5' | 'MK-6' | 'MK-7' | 'NT-1' | 'NT-2' | 'NT-3' | 'NT-4' | 'NT-5' | 'NT-6' | 'NT-7'
  | 'GS-1' | 'TD-1' | 'TD-2' | 'TS-1' | 'FS-1' | 'FS-2' | 'FS-3' | 'SC-1' | 'SC-2' | 'SC-3';
// applyGate takes the site Env (Phase 2 fields optional) and checks, per decision, only the names that decision
// needs (missingNames; missing -> configError, 500): a Supabase JWT check needs the Phase 1 SUPABASE_URL and
// SUPABASE_ANON_KEY only; a service-role lookup needs SUPABASE_SERVICE_ROLE_KEY; Turnstile needs
// TURNSTILE_SECRET_KEY; a rate limit needs API_RATE_LIMIT (MAIL/BULK fall back to it); a MACHINE check (only when
// a Cf-Access-Jwt-Assertion header is present on an allowed host) needs ACCESS_TEAM_DOMAIN, ACCESS_AUD,
// ACCESS_MACHINE_CLIENT_IDS. API_GATES_MODE and API_MACHINE_HOSTS are optional (absent: `recipient=report`; '').
export type GateOutcome =
  | { kind: 'allow'; actionId: ActionId; principal: Principal; functionUrl?: string; body?: Uint8Array; constraints?: FileConstraints; openerOrigin?: string }
  | { kind: 'respond'; actionId: ActionId; response: Response }    // gate answers on the handler's behalf (Appendix P.3)
  | { kind: 'deny'; actionId: ActionId; response: Response };
export function actionIdOf(r: ResolvedApi): ActionId | null;        // null only for sentinels
export function applyGate(r: ResolvedApi, request: Request, env: Env, ctx: ExecutionContext): Promise<GateOutcome>;

// ===== auth/constraints.ts (G) — fields in Appendix P.2 =====
export interface FileConstraints { /* Appendix P.2 */ }
export const NO_FILE_CONSTRAINTS: FileConstraints;
```

`routeApi` flow (B), binding on every unit:

| # | Step | Detail |
|---|---|---|
| 1 | Path | `endpointOfPath(url.pathname)`; `null` → `forwardToVercel(request, env)` with the body **unread** (no size check: Vercel answers oversize bodies itself) |
| 2 | Body | Non-GET/HEAD: buffer `request.arrayBuffer()` once; > `MAX_FUNCTION_BODY_BYTES` → 413 `{"error":"payload_too_large"}`. From here on `request.body` is never read again: every consumer gets the buffered bytes |
| 3 | Resolve | `resolveApi(request, bytes)` |
| 4 | Names | `targetOf(r)`; `missingNames(env, NAMES_BY_TARGET[target])` (table below); missing → `configError('[microns-site]', missing)` (500 `text/plain` + log `api config missing: <NAMES>`) for this request only |
| 5 | Sentinel | `isSentinel(action)` → dispatch with `principal = {class:'ANON'}`, no gate (the handler answers OPTIONS / 405 / 400 / 500 itself, with no side effect) |
| 6 | Gate | `applyGate()` (checks the names of each decision it takes, F-22); `deny`/`respond` → that response; `allow` → apply `functionUrl`/`body` overrides and pass `openerOrigin` on to `callOps` |
| 7 | Dispatch | `local`: `emails` → `handleEmails`, `s3` → `handleFiles`, marketing `track` → `handleTrack`; `ops`: `callOps`; `forward` (an endpoint whose port is not done yet, infra.md §4.2): `forwardToVercel(request, env, bytes)` with the buffered (possibly overridden) bytes |
| 8 | Log | `logLine('[microns-site]', 'api', {endpoint, action, actionId, target, status, ms, principal: class, requestId})` |
| 9 | Return | Response goes back to `index.ts` → `finalise()` (CORS, noindex, HEAD) unchanged (workers/site/src/index.ts:112-117) |

Names per target (`NAMES_BY_TARGET`, router.ts, B; gate names are G's, see `applyGate` above):

| Target | Names checked at step 4 | Why |
|---|---|---|
| `local` emails | `RESEND_API_KEY` | api/emails.js:12 reads it at module scope; checked here for a clear log line |
| `local` track | `SUPABASE_SERVICE_ROLE_KEY` (plus the Phase 1 `SUPABASE_URL`, `SITE_ORIGIN`) | api/marketing.js:11-21 creates its client at module scope; nothing else |
| `local` files | `PRIVATE_FILES`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `LEGACY_S3_REGION`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY` | `FilesEnv` (below); after the check the router narrows `env` to `FilesEnv` |
| `ops` | `OPS` | `callOps` |
| `forward` | none beyond Phase 1 (`API_FORWARD_ORIGIN`) | forward.ts:56-60 already answers 502 on a bad value |

`callOps` request rules (B): URL = `new URL(functionUrl, request.url)` (keeps the host the client asked for); method as received; headers = request headers minus `host`, `content-length`, every name in `HOP_BY_HOP` (forward.ts:16-26) and every name listed in `Connection` (the same stripping as forward.ts:28-38, because the body may be rewritten by the gate), minus `cookie`, `cf-access-client-id`, `cf-access-client-secret`, `cf-access-jwt-assertion` and every `x-microns-*`; body = the (possibly overridden) bytes, `null` for GET/HEAD. RPC rejection → 500 `text/plain` "Internal Server Error", except `action === 'nest'` → 504 `{"success":false,"error":"Nesting exceeded the time limit","code":"TIMEOUT"}` (F-12; infra.md §4.3).

### 2.5 Ops modules (`workers/ops/src`)

```ts
// ===== env.ts (C) =====
export interface OpsEnv {
  SUPABASE_URL: string; SITE_ORIGIN: string;
  SUPABASE_SERVICE_ROLE_KEY: string; SUPABASE_ANON_KEY: string; RESEND_API_KEY: string; RESEND_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string; TELEGRAM_CHAT_ID: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string; APOLLO_API_KEY: string;
  SCRAPES: Queue<ScrapeMessage>;
}
export type OpsHono = { Bindings: OpsEnv; Variables: { call: OpsCall } };
export const LOG_PREFIX = '[microns-ops]';

// ===== index.ts (C) =====
export class OpsApi extends WorkerEntrypoint<OpsEnv> implements OpsApiRpc {
  fetch(): Promise<Response>;                                   // 404
  handle(request: Request, call: OpsCall): Promise<Response>;   // checks call.v === 1, registers call for the Hono middleware, app.fetch()
}
export default { fetch: () => new Response(null, { status: 404 }), queue: scrapesConsumer } satisfies ExportedHandler<OpsEnv>;

// ===== app.ts (C) =====
export const app: Hono<OpsHono>;   // middleware: rejects a request without a registered OpsCall (500), sets c.var.call, one error boundary (500 text/plain)

// ===== compat/express-shim.ts (C) — keeps the PLAN.md:180/:224 path =====
export function vercelRoute(load: () => Promise<{ default: VercelHandler }>, o?: { timeoutMs?: number }): (c: Context<OpsHono>) => Promise<Response>;  // default 300_000 ms
export function runVercel(c: Context<OpsHono>, handler: VercelHandler, o?: { functionUrl?: string; body?: Uint8Array | null; timeoutMs?: number }): Promise<Response>;

// ===== routes/*.ts (C) — one register() per file =====
export function register(app: Hono<OpsHono>): void;
// routes/marketing.ts dispatches on call.action: 'webhook' -> handleResendWebhook, 'google-auth' -> handleGoogleAuth, anything else -> vercelRoute(api/marketing.js)

// ===== routes/marketing-webhook.ts, routes/google-auth.ts (G) =====
export function handleResendWebhook(c: Context<OpsHono>): Promise<Response>;   // Svix on raw bytes, then the unchanged handler (Appendix P.4)
export function handleGoogleAuth(c: Context<OpsHono>): Promise<Response>;      // Appendix P.5

// ===== queues/messages.ts (C) =====
export interface ScrapeMessage { v: 1; kind: 'tender-scan' | 'funded-scan'; params: Record<string, unknown>; run_id: string; enqueued_at: string; requested_by: string; }
export function enqueueScrape(env: OpsEnv, kind: ScrapeMessage['kind'], params: Record<string, unknown>, requestedBy: string): Promise<string>;  // returns run_id

// ===== queues/scrapes.ts (C) =====
export function createScrapesConsumer(handlers: Record<ScrapeMessage['kind'], () => Promise<{ default: VercelHandler }>>): (batch: MessageBatch<ScrapeMessage>, env: OpsEnv, ctx: ExecutionContext) => Promise<void>;
export const scrapesConsumer: ReturnType<typeof createScrapesConsumer>;   // tender-scan -> api/tender-scan.js, funded-scan -> api/funded-startups.js
```

Ops route table (C): every route is `app.all(<function path>, …)` so `OPTIONS` and every method reach the handler as on Vercel.

| Function path | Module (lazy, from `workers/ops/src/routes/*.ts`: `../../../../api/<file>`) | Timeout | Notes |
|---|---|---|---|
| `/api/marketing` | `api/marketing.js` (`apollo-enrich`, unknown) · G modules (`webhook`, `google-auth`) | 300 s | infra.md §5.3 |
| `/api/notifications` | `api/notifications.js` | 300 s (nest bounded by `cpu_ms`) | `qrcode` alias (§2.6); `inv-*` arrive with the site's request overrides (Appendix P A-9) |
| `/api/gsc` | `api/gsc.js` | 300 s | its own `requireAdmin` still runs (api/gsc.js:190) |
| `/api/tenders` | `api/tenders.js` | 300 s | `/api/connector-status` arrives as `/api/tenders?…connectors=true` in `functionUrl` |
| `/api/tender-scan` | `api/tender-scan.js` | 300 s | MACHINE + POST → queued answer (§2.9); otherwise synchronous |
| `/api/funded-startups` | `api/funded-startups.js` | 300 s | synchronous (F-11) |
| `/api/scrape-website`, `/api/scrape-company-profile` | `api/scrape-website.js`, `api/scrape-company-profile.js` (`routes/scrape.ts`) | 300 s | — |
| `/api/scan-directory` | `api/scan-directory.js` | 300 s | — |
| anything else | — | — | 404 (only reachable through a site bug) |

### 2.6 Bindings, vars and secrets

`workers/site/wrangler.jsonc` Phase 2 additions (B; Phase 1 entries unchanged, workers/site/wrangler.jsonc:47-86):

```jsonc
"services": [ { "binding": "OPS", "service": "microns-ops", "entrypoint": "OpsApi" } ],
"r2_buckets": [ { "binding": "PRIVATE_FILES", "bucket_name": "microns-private", "jurisdiction": "eu" } ],
"ratelimits": [
  { "name": "API_RATE_LIMIT",      "namespace_id": "2001", "simple": { "limit": 30, "period": 60 } },
  { "name": "API_RATE_LIMIT_MAIL", "namespace_id": "2002", "simple": { "limit": 5,  "period": 60 } },
  { "name": "API_RATE_LIMIT_BULK", "namespace_id": "2003", "simple": { "limit": 300, "period": 60 } }
],
// vars added (placeholders replaced by the owner, never by secret values):
"R2_ACCOUNT_ID": "<CF_ACCOUNT_ID>", "LEGACY_S3_REGION": "eu-north-1",
"LEGACY_S3_RFQ_BUCKET": "<LEGACY_S3_RFQ_BUCKET>", "LEGACY_S3_ARTICLES_BUCKET": "<LEGACY_S3_ARTICLES_BUCKET>",
"API_FORWARD_TO_VERCEL": "false", "API_FORWARD_ORIGIN": "https://on-demand-craft-greece.vercel.app",
"ACCESS_TEAM_DOMAIN": "<ACCESS_TEAM_DOMAIN>", "ACCESS_AUD": "<ACCESS_AUD_PREVIEW>", "API_GATES_MODE": "recipient=report",
"API_MACHINE_HOSTS": "",   // Phase 3 runbook sets "api.micronshub.eu" (F-15)
// API_GATES_MODE for production is set at Phase 3 S11 from the owner's decision D-16 (§7).
// secrets.required becomes:
["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "R2_ACCESS_KEY_ID",
 "R2_SECRET_ACCESS_KEY", "LEGACY_AWS_ACCESS_KEY_ID", "LEGACY_AWS_SECRET_ACCESS_KEY", "ACCESS_MACHINE_CLIENT_IDS"]
```

`workers/ops/wrangler.jsonc` (C; Phase 2 subset of the draft, infra.md §5.5):

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "microns-ops", "main": "src/index.ts",
  "compatibility_date": "2026-09-01", "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false, "preview_urls": false,
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "limits": { "cpu_ms": 300000 },
  "alias": { "qrcode": "./../../node_modules/qrcode/lib/server.js" },
  "vars": { "SUPABASE_URL": "https://cfjrtmtaitwzggzpkhxi.supabase.co", "SITE_ORIGIN": "https://www.micronshub.eu" },
  "queues": {
    "producers": [ { "binding": "SCRAPES", "queue": "scrapes" } ],
    "consumers": [ { "queue": "scrapes", "max_batch_size": 1, "max_retries": 3, "max_concurrency": 2, "retry_delay": 300, "dead_letter_queue": "scrapes-dlq" } ]
  },
  "secrets": { "required": ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "APOLLO_API_KEY"] }
}
```

| Name | Worker | Kind | Status | Evidence |
|---|---|---|---|---|
| `OPS` (+ `entrypoint`), `PRIVATE_FILES`, `API_RATE_LIMIT`, `R2_ACCOUNT_ID`, `LEGACY_S3_REGION` | site | binding / var | CANON (entrypoint new) | CANON.md §3; infra.md §5.2 |
| `API_RATE_LIMIT_MAIL`, `API_RATE_LIMIT_BULK`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, `API_FORWARD_TO_VERCEL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `API_GATES_MODE`, `API_MACHINE_HOSTS`, `ACCESS_MACHINE_CLIENT_IDS` (secret) | site | binding / var / secret | **proposed** (§7 D-10) | gates_PRIVATE.md §12; infra.md §12.1 |
| `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY` | site | secret | CANON | CANON.md §3 |
| Ops names above | ops | var / secret / queue | CANON (Phase 5 names left out; `GSC_SERVICE_ACCOUNT_JSON` not set) | infra.md §12.2; wrangler.jsonc.draft:460-486 |
| `VITE_TURNSTILE_SITE_KEY` | frontend build: GitHub secret for the Worker build (test key in Phase 2, real key from Phase 3 S11); **not** set in the Vercel env (O-7) | public build var | **proposed** | gates_PRIVATE.md §12 |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | `tender-collector` (Supabase secrets), MCP env | secret | **proposed** | gates_PRIVATE.md §4 M2 |

No `VITE_AWS_*` name in any Worker config (exit gate 10; api/s3.js is never imported by a Worker).

### 2.7 Flag `api.forward_to_vercel`

| Item | Contract |
|---|---|
| Key / store | `api.forward_to_vercel` in KV `FLAGS` (CANON.md §7), read with `cacheTtl` 60 s (workers/site/src/flags.ts:10) |
| Value | `{"enabled": true}` = forward every `/api/*`; `"value": {"paths": ["/api/gsc"]}` = only these public paths; `"value": {"hosts": ["preview"]}` = only on preview hosts (`isPreviewHost`, workers/site/src/preview.ts:52), `"production"` = only on non-preview hosts; both lists combine with AND |
| Fallback | Var `API_FORWARD_TO_VERCEL`: `"true"` → forward all; anything else → off (an unparsable value is logged). KV missing, malformed or failing → the var |
| Forwarding | `forwardToVercel()`: method, path, query, body and end-to-end headers unchanged; `cf-*` stripped (forward.ts:38); never gated (gates_PRIVATE.md §0 D11) |
| Phase 4 | The `feature_flags` → KV sync writes the same key and shape (PLAN.md P4-2; AGENTS.md §2.3) |

### 2.8 Endpoint catalogue and action resolution (`resolve.ts`, B; G's action IDs depend on it)

The resolver copies each handler's own precedence exactly (gates_PRIVATE.md §0 D2). `#…` values are sentinels: the handler answers them before any side effect, so they are dispatched without a gate (step 4 of §2.4). `OPTIONS` is a sentinel only where the handler short-circuits it before any branch work; on `/api/marketing` it is an ordinary method and resolves like `GET` for `track`, `webhook` and `google-auth`, and is the sentinel `#options` for `apollo-enrich`, whose branch answers `OPTIONS` 200 and every other non-POST method 405 before anything else (api/marketing.js:605-611).

| Public path | Function URL | Endpoint | Resolution (evidence) | Normalised `action` | Target | Timeout |
|---|---|---|---|---|---|---|
| `/api/emails` | raw | `emails` | `OPTIONS` → `#options` (api/emails.js:358-360); method ≠ POST → `#method` (:362-364); body getter throws → `#throws` (caught, 500, :380-383); `raw = body?.action \|\| searchParams(functionUrl).get('action') \|\| 'email'` (:367) | `contact`, `rfq`, `rfq-pdf`; every other value → `email` (:368-378) | local | 30 s |
| `/api/s3` | raw | `s3` | `OPTIONS` → `#options` (api/s3.js:144-146); `action = query.action` (:148); body getter throws → `#throws` (500 `{"error":"Invalid JSON"}`, :150-151, :228-231); scope = `readBody().scope \|\| query.scope \|\| 'rfq'`, `'articles'` only on exact match (:70-72, :131-141, :152); no method check | `presign-upload`, `presign-download`, `delete`, `delete-folder`, `list`; anything else (incl. arrays, missing) → `#unknown` (400 `Unknown action: <value>`, :226-227) | local (`files.ts`) | 30 s |
| `/api/marketing` | raw | `marketing` | `action = query.action` (api/marketing.js:56); no top-level OPTIONS; with `action=apollo-enrich`: `OPTIONS` → `#options` (:610), other method ≠ POST → `#method` (:611) | `track`, `webhook`, `google-auth`, `apollo-enrich`; else `#unknown` (:67-68). `google-auth`: `step` = `'error'` when `query.error` is truthy (:384), else `query.step` ∈ authorize/callback/refresh, else action `#unknown-step` (:594-595) | `track` → local; others → ops | 30 s / 300 s |
| `/api/track` | `/api/marketing` + merged query, `action=track` unless the request sets `action` (vercel.json:150-153) | `marketing` | as `/api/marketing` | as above (`/api/track?action=webhook` reaches `webhook`, as on Vercel) | as above | as above |
| `/api/notifications` | raw | `notifications` | `OPTIONS` → `#options` (api/notifications.js:248-250); body getter throws → `#throws` (:274-277); `raw = body?.action \|\| searchParams.get('action') \|\| 'partner'` (:253); non-string → `#throws` (`.startsWith`, :256); `inv-…` any method (:256-258); else method ≠ POST → `#method` (:261-263) | the `inv-…` string as given; `nest`, `production-status`; every other value → `partner` (:265-272) | ops | 300 s |
| `/api/gsc` | raw | `gsc` | `OPTIONS` → `#options` (api/gsc.js:187-188); `requireAdmin` precedes the action (:190-193) | `gsc` (the GSC action is logged, not gated separately) | ops | 300 s |
| `/api/tenders` | raw | `tenders` | `OPTIONS` (api/tenders.js:29); GET branch order connectors → stats_only → export → id → list (:41-61); PATCH (:122); else `#method` (:141) | `connectors`, `stats`, `export`, `id`, `list`, `patch` | ops | 300 s |
| `/api/connector-status` | `/api/tenders` + merged query, `connectors=true` (vercel.json:154-157); method preserved | `tenders` | as `/api/tenders` | as above | ops | 300 s |
| `/api/tender-scan` | raw | `tender-scan` | `OPTIONS` (api/tender-scan.js:77); method ≠ POST → `#method` (:78) | `scan` | ops | 300 s |
| `/api/funded-startups` | raw | `funded-startups` | `OPTIONS` (api/funded-startups.js:34); GET order stats → feeds → export → id → list (:36-43); POST; PATCH; else `#method` | `stats`, `feeds`, `export`, `id`, `list`, `scan`, `patch` | ops | 300 s |
| `/api/scrape-website`, `/api/scrape-company-profile`, `/api/scan-directory` | raw | as named | `OPTIONS` → `#options`; method ≠ POST → `#method` (contracts.md §3.12-§3.14) | `post` | ops | 300 s |
| `/api/sitemap` | — | — | Router step 2, Phase 1 (workers/site/src/index.ts:82-90); a throw falls through to `forwardToVercel` | — | Phase 1 | — |
| any other `/api/*` | — | `null` | — | — | forward | 30 s |

### 2.9 Queue `scrapes` (C)

| Item | Contract |
|---|---|
| Producer | `routes/tender-scan.ts`: `principal.class === 'MACHINE'` and method POST → validate exactly as the handler (falsy `country_code` → 400 `{"error":"country_code is required"}`; non-string → run the handler synchronously (it fails before any write, api/tender-scan.js:84); unknown code → 400 `{"error":"No connector for country: <CC>"}`, codes copied from api/tender-scan.js:37-71 with a T1 test that parses that block) → `enqueueScrape` → 200 through `runVercel` with the handler's CORS headers (:24-29) and body `{"success":true,"country_code":"<CC>","tenders_found":0,"tenders_new":0,"tenders_relevant":0,"errors":[],"duration_ms":0,"queued":true,"run_id":"<uuid>"}` |
| Message | `ScrapeMessage` (§2.5), `v: 1`, ≤ 128 KB (CF docs) |
| Consumer | Synthetic `POST /api/<function>` with JSON `params`, same handler through `runNodeHandler`, `timeoutMs` 840,000; 2xx/4xx → `ack()`; 5xx, throw, shim 504 → `retry({ delaySeconds: 300 })`; after 3 retries → `scrapes-dlq` |
| Log | `[microns-ops] scrapes <kind> <params summary> status=<n> run_id=<uuid> attempts=<n>` (counts from the handler's JSON body when present) |
| Idempotency | Tender upserts on (`country_code`, `tender_reference`) and Telegram only for rows new in the run (contracts.md §3.10), so a retry repeats no alert |

### 2.10 Error policy (all `/api/*` answers produced by Phase 2 code; handler answers are untouched)

| Case | Status | Body (`Content-Type`) | Producer |
|---|---|---|---|
| No API credential where one is required | 401 | `{"error":"unauthorized"}` (JSON) | G |
| Valid credential of an insufficient class | 403 | `{"error":"forbidden"}` | G |
| Turnstile token missing or rejected | 403 | `{"error":"turnstile_failed"}` | G |
| Rate limit exceeded | 429 | `{"error":"rate_limited"}` + `Retry-After: 60` | G |
| Supabase Auth or siteverify unreachable | 503 | `{"error":"auth_unavailable"}` / `{"error":"turnstile_unavailable"}` (fail closed) | G |
| Data rule violated | 400 / 403 / 409 / 422 | `{"error":"<code>"}` per gates_PRIVATE.md §3 (incl. `invalid_field`, F-29) | G (decision), S (file constraints) |
| Body of an unsupported type on a path of F-29 | 415 | `{"error":"unsupported_media_type"}` | G |
| Body too large | 413 | `{"error":"payload_too_large"}` | B |
| A name this request needs is missing (per target, per gate check; F-22) | 500 | "Internal Server Error" (text/plain) + log `api config missing: <NAMES>` | B (targets), G (gate checks) |
| Handler throws before `end()` (non-`ApiError`) | 500 | "Internal Server Error" (text/plain) | A/B/C (workers/site/src/index.ts:40-45 convention) |
| Shim timeout | 504 | "Gateway Timeout" (text/plain) | A |
| `OPS` RPC rejects | 500 | "Internal Server Error"; `nest` → 504 JSON `TIMEOUT` (§2.4) | B |
| Forward upstream fails | 502 | `{"error":"upstream"}` | Phase 1 (forward.ts:45-50) |
| `OpsCall.v` unsupported / request without a registered call | 500 | text/plain | C |

Every answer leaves through `finalise()`, so `/api/*` always carries the Vercel CORS headers (workers/site/src/preview.ts:17-28, :76-79).

### 2.11 CORS

| Mode | Phase | Behaviour | Owner |
|---|---|---|---|
| parity | 2 and the Phase 3 observation window | Phase 1 `finalise()` sets the four vercel.json:163-172 headers with `set` on every `/api/*` response; handlers' own `OPTIONS` answers pass through (200 empty, 204 for `/api/s3`); whether a handler-set header or the platform header wins on Vercel is decided from the P0-3 capture (contracts.md §8 D7) | Phase 1, unchanged |
| allowlist | after the observation window | `applyAllowlistCors()` (A): reflect an allowed `Origin`, `Vary: Origin`, methods as today, allowed headers + `Authorization`, `X-Turnstile-Token`, `Max-Age 600`, never `Allow-Credentials`; wiring into `finalise()` and its var come with the switch (F-17) | A now, wiring later |

No browser caller needs cross-origin access or credentials (callers.md §2, §11).

Allow-list (exact host comparison, never substring matching; callers.md §11):

| Rule | Origins |
|---|---|
| Production | `SITE_ORIGIN` (`https://www.micronshub.eu`), `https://micronshub.eu` |
| Tenant subdomains | `^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.micronshub\.eu$` (one label) |
| Tenant custom domains | none exist (live 2026-10-02); added when the first one is created |
| Preview | `^https://([a-z0-9-]+-)?microns-site\.<WORKERS_SUBDOMAIN>\.workers\.dev$`, only when the request host is itself a preview host |
| Local dev | `http://localhost:8080` (vite.config.ts:113-114), only when the request host is a preview host |
| Never | `*.vercel.app`, `api.micronshub.eu`, anything else |

### 2.12 T2 harness (B owns; C, G, S, F use it)

| Item | Contract |
|---|---|
| Start | `node workers/site/test/integration/harness.mjs up` (long-running; script `t2:up`) or vitest `globalSetup` `workers/site/test/integration/global-setup.mjs` (used by `workers/site/vitest.t2.config.ts` and `workers/ops/vitest.t2.config.ts`) |
| What it runs | A stub upstream server on `127.0.0.1:<port>`, then `wrangler dev -c <tmp>/site/wrangler.jsonc -c <tmp>/ops/wrangler.jsonc --local --persist-to <tmp>/state --port <sitePort>` with the wrangler of `workers/site/node_modules` |
| Generated configs | Copies of both `wrangler.jsonc` in a temp dir with absolute `main`, `assets.directory` and `alias` paths, vars overridden: `SUPABASE_URL` and `API_FORWARD_ORIGIN` → stub origin, `ACCESS_TEAM_DOMAIN` → `http://<stub>`, `ACCESS_AUD` → `t2-aud`, bucket vars → `t2-rfq`/`t2-articles`, `R2_ACCOUNT_ID` → `t2account`; `queues.consumers` removed from the ops copy (no real scan runs locally); a `.dev.vars` beside each with dummy values (Turnstile: CF test secret `1x0000000000000000000000000000000AA`); the developer's own `.dev.vars` (exists in workers/site) is never read or written |
| Assets | If `dist/index.html` is missing, the harness writes a one-line shell into a temp assets dir instead (API tests need no real build) |
| URLs it publishes | `{site, stub, tmp}` written to the fixed file `workers/site/.wrangler/t2/urls.json` once workerd answers (`.wrangler/` is gitignored, workers/site/.gitignore:2) and removed on exit; also set as `T2_SITE_URL`, `T2_STUB_URL`, `T2_TMP` for processes the harness itself starts (vitest `globalSetup`). A background `t2:up` cannot export variables to its parent shell, so shells use `node test/integration/harness.mjs wait` (script `t2:wait`): polls the file for ≤ 120 s, prints the site URL, exits 1 on timeout |
| Stub control API | `POST {T2_STUB_URL}/__stub/routes` `{method, path (RegExp source), status, headers?, body?}` (canned answer; last registration wins), `POST /__stub/reset`, `GET /__stub/calls` (recorded method, path, selected headers; never bodies), `GET /cdn-cgi/access/certs` (keys from `POST /__stub/access-keys`), echo for forwarded requests under `/api/*` with header `x-t2-forwarded: 1` |
| Client | `workers/site/test/integration/stub-client.ts`: `stubRoute()`, `stubReset()`, `stubCalls()`, `mintSupabaseJwt({sub, email, exp})` (unsigned-for-real HS256 shape; verification is the stub's `/auth/v1/user`), `mintAccessJwt({commonName})` (RS256 with a key registered at the stub, built with WebCrypto `crypto.subtle`: `workers/site` has no `jose`, which lives only in `workers/shared/node_modules`) |
| Limits | No CPU limits locally (CF docs); no network to production; Turnstile T2 cases call the real siteverify with CF test secrets and the dummy token `XXXX.DUMMY.TOKEN.XXXX` on the localhost (preview) host, i.e. in test-key mode (F-30); "pass" cases send a body without `message`, so the handler answers 400 before any Resend call (api/emails.js:101-103); skipped with a notice when offline |

### 2.13 Test conventions

| Rule | Detail |
|---|---|
| T1 location | `workers/<pkg>/test/**/*.test.ts`; Node env; `vi.stubEnv` + `vi.resetModules()` before importing an `api/*.js` module (module-scope env reads, infra.md §2.3) |
| T2 location | `*.t2.ts` (never matched by the Phase 1 `test/**/*.test.ts` include, workers/site/vitest.config.ts:5-9) |
| Ops tests and `cloudflare:workers` | `workers/ops/vitest.config.ts` aliases `cloudflare:workers` to `test/helpers/cloudflare-workers.ts` (stub `WorkerEntrypoint`) |
| Fixtures | Tracking pixel 70 B SHA-256 `497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581`; unsubscribe HTML 547 B SHA-256 `2c9b981f4b00465600eb652d7cb3bf19d1d31327b57293d626e6344411a5eb43` (contracts.md §3.3) |
| Oracles | `etag` (A), `@smithy/signature-v4` golden presign (S), `svix` (G), jose-minted JWTs (G, through `workers/shared/test/helpers/jwt.ts`, which site tests import by relative path so `jose` resolves from `workers/shared/node_modules`), fake S3 that re-verifies SigV4 (S; infra.md §10.3) |
| Frontend helper tests (E) | `tests/frontend-api/vitest.config.mjs` sets `globals: true`; test files use the globals (`describe`, `it`, `expect`, `vi`) and never `import … from 'vitest'`, because the root `node_modules` has no `vitest` and bare imports resolve from the test file's folder; run with `workers/site/node_modules/.bin/vitest` |
| Secret-looking literals | Built at runtime (G-5); `.dev.vars.example` holds `dummy-not-a-secret` values only |

### 2.14 Wave 0: contract stubs (unit A, first, ≈ 1-2 h)

Before any other unit starts, A commits: the `workers/shared` package (package.json with every dependency of §2.2, lockfile, tsconfig whose `compilerOptions` equal workers/site/tsconfig.json's, vitest config, `.gitignore`), the complete `workers/shared/src/compat/ambient.d.ts`, and **stub files with the exact exports of §2.3, §2.4 and §2.5** for every module another unit imports: all `workers/shared/src/**` files, the Phase 2 optional fields of `workers/site/src/env.ts` (§2.4; types only, Phase 1 fields untouched), `workers/site/src/api/{resolve,files}.ts`, `workers/site/src/auth/{gate,constraints}.ts`, `workers/ops/src/env.ts`, `workers/ops/src/compat/express-shim.ts` (`vercelRoute`, `runVercel`), `workers/ops/src/routes/{marketing-webhook,google-auth}.ts`, `workers/ops/src/queues/messages.ts`. Stub bodies `throw new Error('not implemented: <unit>')`; types are complete. A also creates the `workers/ops` package skeleton (package.json and lockfile with the §2.2 ops dependencies, tsconfig whose `compilerOptions` equal workers/site/tsconfig.json's, `vitest.config.ts` with the `cloudflare:workers` alias, `test/helpers/cloudflare-workers.ts`) so that G can run its ops tests before C lands. Ownership of each stub and skeleton file then passes to the unit named in §2.1. Wave 0 passes when `npm --prefix workers/shared run typecheck`, `npm --prefix workers/ops ci && npm --prefix workers/ops run typecheck` and `npm --prefix workers/site run typecheck` (the Phase 1 site plus the Wave 0 stubs under the frozen site tsconfig) are green.

---

## 3. Build units

Effort figures are estimates; PLAN.md estimates Phase 2 at ≈ 7 d (PLAN.md:71, :261).

### Unit A: shared runtime (shim, rewrite, HTTP, CORS) — P2-2 (0.75 d), part of P2-3

| Item | Detail |
|---|---|
| Owns | `workers/shared/{package.json,package-lock.json,tsconfig.json,vitest.config.ts,.gitignore,README.md}`, `workers/shared/src/compat/*`, `workers/shared/src/http/*`, `workers/shared/test/{compat,http}/**`; Wave 0 stubs (§2.14) |
| Builds | §2.3 modules of A; §2.3.1 behaviour table; `functionUrlFor` as a copy of the sitemap algorithm (workers/site/src/sitemap.ts:59-103) applied to `API_REWRITES`; `VERCEL_API_CORS_HEADERS` byte-equal to workers/site/src/preview.ts:18-23; `isAllowedOrigin` per the allow-list of §2.11; `ambient.d.ts` (the site tsconfig restricts `types` to `@cloudflare/workers-types`, workers/site/tsconfig.json:13, so `node:querystring` gives TS2591 and `content-type` TS7016 without it; tsc probe 2026-10-03); `env-check.ts` |
| Depends on | Nothing (first unit) |
| Not in scope | Any change to `workers/site/src/compat/vercel-shim.ts`, `sitemap.ts`, `preview.ts` (F-3, F-17) |

Acceptance (local, no account):

| # | Command | Pass |
|---|---|---|
| A-1 | `npm ci && npm --prefix workers/shared ci && npm --prefix workers/shared run typecheck` | exit 0 |
| A-1b | `npm --prefix workers/site run typecheck` with the full A implementation and a site file importing `vercel-node.ts`, `etag.ts`, `env-check.ts` (B's first import, or a scratch import that is not committed); plus a T1 test that `workers/shared/tsconfig.json` and `workers/ops/tsconfig.json` have the same `compilerOptions` as workers/site/tsconfig.json | exit 0 under the frozen site tsconfig; no TS2591/TS7016 |
| A-2 | `npm --prefix workers/shared test -- test/compat test/http` | every §2.3.1 row has a named test and passes; `weakEtag` equals `etag(..., {weak:true})` for empty, ASCII, UTF-8, binary and ≥ 1,000-character bodies; `parseVercelBody` matches the `@vercel/node` table incl. invalid JSON (throws on each access), empty JSON (`{}`), no header (`''`), malformed `Content-Type` (throws), form-urlencoded, octet-stream, multipart (`undefined`) |
| A-3 | same run, `vercel-rewrite` tests | `/api/track?type=open&eid=1&cid=2` → `/api/marketing?type=open&eid=1&cid=2&action=track`; `/api/track?action=webhook` → `action=webhook`; `/api/connector-status?x=1` → `/api/tenders?x=1&connectors=true`; `/api/track?url=a+b` keeps `+` encoded as `%2B` (sitemap.ts:12-22 semantics); non-rewritten paths returned raw |
| A-4 | `npm --prefix workers/site test` | Phase 1 suite green and unchanged (336 tests at workers/site/README.md:75 or the count at the Phase 1 closing commit) |
| A-5 | `git diff --stat <phase1-close>.. -- workers/site/src workers/site/test` over A's commits | touches only the Wave 0 stub files of §2.14 (`env.ts` fields, `api/{resolve,files}.ts`, `auth/{gate,constraints}.ts`) |

### Unit G: gates — P2-7 (0.75 d), P2-8 verification part (0.2 d)

| Item | Detail |
|---|---|
| Owns | `workers/shared/src/auth/*`, `workers/shared/test/auth/**`, `workers/shared/test/helpers/jwt.ts`; `workers/site/src/auth/*` (gate, policy, constraints, db, tracking, and the PLAN-named adapters `supabase-jwt.ts`, `turnstile.ts`, `rate-limit.ts`, `access.ts`); `workers/site/test/{gates,gate-*,policy}.test.ts`; `workers/site/test/integration/gates.t2.ts`; `workers/ops/src/routes/{marketing-webhook,google-auth}.ts`; `workers/ops/test/{marketing-webhook,google-auth}.test.ts` |
| Builds | The shared auth primitives (§2.3) and `applyGate()` implementing `gates_PRIVATE.md` §2-§9 for every action ID of §5, with the amendments of Appendix P.1 (including the request overrides and `respond` outcomes of A-6, A-7, A-9, A-10); F-29 (415 / `invalid_field`); F-30 (Turnstile test-key mode, `allowTestSecret = isPreviewHost(host)`); MACHINE only on `isPreviewHost` hosts or hosts in `API_MACHINE_HOSTS` (F-15); the per-decision name checks of F-22; the three-binding rate limits (F-24, A-14); the `FileConstraints` of Appendix P.2; the two ops modules (Appendix P.4, P.5), which run the unchanged handler through A's `runNodeHandler` directly (not C's `runVercel`) |
| Depends on | A (`rpc.ts`, `json.ts`, `env-check.ts`, `vercel-node.ts`; G-3's real-handler case needs A's implementation), B's `ResolvedApi` type and `env.ts` fields (Wave 0), C's `OpsHono` type (Wave 0 stub). No dependency on C's implementation |
| Rules | Gate modes from `API_GATES_MODE` (`<class>=report\|enforce`, comma list; absent var → `recipient=report`; an absent class token → `enforce`); report mode logs `[microns-site] gate would deny <actionId> <code>` and allows. JWT pre-check before any network call. No secret or token in a log line. Site tests mint Access JWTs only through `workers/shared/test/helpers/jwt.ts` |

Acceptance:

| # | Command | Pass |
|---|---|---|
| G-1 | `npm --prefix workers/shared test -- test/auth` | Svix: valid vector (built with the `svix` library at runtime), body changed, wrong key, timestamp ±301 s, several `v1` entries, missing headers; JWT pre-check rejects the anon-key shape (`role` ≠ `authenticated`), expired, non-UUID `sub`; `/auth/v1/user` stubbed 200/401/5xx/timeout → ok/401/503/503; roles array → class; cache TTL ≤ min(60 s, exp − now); Access RS256 with a jose key pair and a stubbed certs endpoint; Turnstile with stubbed siteverify, real secret (success, wrong action, wrong hostname, stale `challenge_ts`, 5xx) and test-key mode (test secret + `allowTestSecret` with the documented answer `action:'test', hostname:'localhost', challenge_ts:2022-…` → ok; test secret + `!allowTestSecret` → 503 without a siteverify call; a real secret with that same answer → 403; `isTurnstileTestSecret` exact match only); `bindingFor` table |
| G-2 | `npm --prefix workers/site test -- test/gates test/gate- test/policy` | One test per action ID of §5 for each principal class; the site-side vectors of gates_PRIVATE.md §13 with stubbed upstreams: T1-T12 (T12 as amended in Appendix P A-3, Access JWT from `workers/shared/test/helpers/jwt.ts`), T14, T15 and its variants (Appendix P A-6/A-7), T18; F-29: form-urlencoded and `text/plain` bodies on `email`/`contact`/`rfq`/`inv-*` → 415, array or object values on the e-mail paths → 400 `invalid_field`; A-9 variants; burst vectors: 40 parallel `presign-download` by one STAFF user → all allowed, 40 sequential anonymous `presign-upload` for one fresh RFQ → all allowed (≤ the 50-object cap), 31 `rfq-pdf` calls by one STAFF user → 31st 429; MACHINE on a zone host only when it is in `API_MACHINE_HOSTS`; missing `TURNSTILE_SECRET_KEY` → 500 on `email` only (a `track` request still allowed); `actionIdOf` returns `null` only for sentinels (B's router test proves sentinels never reach `applyGate`) |
| G-3 | `npm --prefix workers/ops test -- test/marketing-webhook test/google-auth` | Appendix P.4/P.5 cases (incl. the retry case of P.4), vectors T13, T16, T17 |
| G-4 | `npm --prefix workers/site run test:integration -- gates.t2` (needs B's harness) | gate decisions over real workerd with the stub: 401/403/429/415 shapes, MACHINE via `mintAccessJwt` on a localhost (preview) host, Turnstile test-key mode against the real siteverify (1x secret + dummy token → gate passes, handler answers 400 for the missing `message`; no header → 403) |
| G-5 | `rg -n "eyJ\|whsec_[A-Za-z0-9]\|\bre_[A-Za-z0-9_]{24,}" workers/shared workers/site/src workers/site/test workers/ops` (the `re_` pattern needs a word boundary and ≥ 24 characters so that identifiers such as `failure_response` do not match; re-check against the current Resend key format) | no match (G-5 rule) |

### Unit B: site `/api` router, resolver, site-local handlers, config, CI — P2-3 (0.5 d), P2-4 emails/track (0.4 d), P2-12 tooling (0.35 d)

| Item | Detail |
|---|---|
| Owns | `workers/site/src/{env.ts,flags.ts}` (changed), `workers/site/src/compat/api-modules.d.ts` (changed), `workers/site/src/api/{forward.ts (changed),resolve.ts,router.ts,emails.ts,track.ts,ops-client.ts}`, `workers/site/{wrangler.jsonc,package.json,README.md}` (changed), `workers/site/{vitest.t2.config.ts,.dev.vars.example}`, `workers/site/scripts/check-bundle.mjs`, `workers/site/test/{resolve,router-api,forward-flag,rewrite-crosscheck,emails-local,track-local,env-api}.test.ts`, `workers/site/test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs,stub-client.ts,api-router.t2.ts,track.t2.ts,startup.t2.ts}`, root `package.json` (scripts), `.github/workflows/cf-preview.yml` |
| Builds | §2.4 (env, flags, forward incl. the `body` parameter and the exported `HOP_BY_HOP`, resolve incl. `endpointOfPath`, router with the 9-step flow and `NAMES_BY_TARGET`, emails, track, ops-client with the header stripping of §2.4), §2.6 site config, §2.7, §2.8, §2.10 (B rows), §2.12 harness incl. `t2:wait`; `README.md`: Phase 2 run section and the size-limit correction of line 187 (64 MiB uncompressed, no compressed limit; infra.md §1.1, §1.3) |
| Root scripts | `cf:install` → `npm --prefix workers/shared ci && npm --prefix workers/site ci && npm --prefix workers/ops ci && npm --prefix scripts/seo-parity ci`; add `cf:test:shared`, `cf:test:ops`, `cf:test:all`, `cf:typecheck:all`, `cf:dry:ops`, `cf:dev:all` (`npm --prefix workers/site run dev:all`), `cf:t2` (`npm --prefix workers/site run test:integration && npm --prefix workers/ops run test:integration`), `cf:e2e:api` (installs `@playwright/test@1.56.1` with `--no-save` as `cf:e2e` does, then `playwright test tests/e2e/api.spec.ts`). Rebase onto the Phase 1 closing commit first (G-4) |
| Site scripts | `dev:all` (`wrangler dev -c wrangler.jsonc -c ../ops/wrangler.jsonc --local --port 8787`), `test:integration` (`vitest run -c vitest.t2.config.ts`), `t2:up` (`node test/integration/harness.mjs up`), `t2:wait` (`node test/integration/harness.mjs wait`), `check-bundle` (`node scripts/check-bundle.mjs`), `build:dry` gains `--metafile .wrangler/dry/meta.json` |
| CI (`cf-preview.yml`) | Install `workers/shared` (and its lockfile in `cache-dependency-path`, :144-147); pass `VITE_TURNSTILE_SITE_KEY` from secrets to `vite build` and fail early with a clear message when it is empty; after `vite build`, fail if any `dist/**/*.html` contains `challenges.cloudflare.com` or `cf-turnstile` (prerender guard, E-11 T-b); run `check-bundle` after the dry run; existing steps and names unchanged |
| Bundle guard | Fails on any metafile input under `node_modules/(@aws-sdk\|@smithy\|pdf-lib\|@pdf-lib\|qrcode\|pngjs\|makerjs\|dxf-parser\|clipper-lib)/`, `/lib/(nesting\|inventory)/`, or `api/(s3\|notifications\|gsc\|tenders\|tender-scan\|funded-startups\|scrape-\|scan-directory)`; prints total and gzip size (infra.md §11) |
| Depends on | A (Wave 0 + implementation for T2), G (`applyGate`), S (`handleFiles`), C (ops Worker for T2) — B codes against the stubs and mocks them in T1 |

Acceptance:

| # | Command | Pass |
|---|---|---|
| B-1 | `npm --prefix workers/site run typecheck` | exit 0 (Phase 1 test helpers compile unchanged, F-22) |
| B-2 | `npm --prefix workers/site test` | Phase 1 suite unchanged and green; new tests: every row of §2.8 incl. `/api/track` merge, OPTIONS on `/api/marketing?action=google-auth&step=refresh` is **not** a sentinel, OPTIONS on `/api/marketing?action=apollo-enrich` **is** `#options` and GET there is `#method`, invalid JSON → `#throws` on emails/s3/notifications, `inv-x` any method, non-string notifications action; `routeApi` steps 1-9 with fake `OPS` (`handle` spy receives principal + `functionUrl`; headers without `cookie`, `cf-access-*`, `x-microns-*`, `content-length`, hop-by-hop; a rewritten body arrives intact), 413 at 4,718,593 bytes, `nest` RPC rejection → 504 JSON; a POST with a body to an unknown `/api/x` and to an endpoint whose target is set to `forward` both reach the upstream fake with the exact bytes (no "body already used"); per-target names: without `RESEND_API_KEY` → `/api/emails` 500 and `/api/marketing?action=track&type=open` allowed; without `OPS` → ops paths 500, local paths unaffected; without the R2/legacy names → `/api/s3` 500 only; flag: on / off / paths / hosts / malformed → var; `rewrite-crosscheck`: shared `mergeRewriteQuery` equals `rewriteSitemapPath` (workers/site/src/sitemap.ts:86-103) on all sitemap test inputs; `emails-local`/`track-local`: handler runs lazily, module-scope failure (no `RESEND_API_KEY`) → 500 on that route only |
| B-3 | `npm --prefix workers/site run build:dry && npm --prefix workers/site run check-bundle` | 0 forbidden inputs; size printed (probe reference: site API subset 1,253.95 KiB / gzip 210.47 KiB, infra.md §1.2) |
| B-4 | `npm --prefix workers/site run test:integration` | `api-router.t2`: OPTIONS on all 14 paths answered by handlers with the parity CORS headers; RPC reaches `OpsApi` (STAFF stub user → ops handler → stub DB); an unknown `/api/x` reaches the stub echo with `x-t2-forwarded`, as GET and as POST with a 1 KiB JSON body (echoed byte for byte) (the flag-on path itself is covered by B-2 in T1 and by gate 7 in T3); `track.t2`: T1, T2, T5, T10 byte fixtures and T3/T6/T9 shapes with the DB stub answering "not found"; `startup.t2`: without `RESEND_API_KEY` in the generated `.dev.vars`, `/api/emails` → 500 and `/en` + `/api/marketing?action=track&type=open` → 200 |
| B-5 | `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/cf-preview.yml'))"` (PyYAML 6.0.1 is installed) and `git diff -- .github/workflows/cf-preview.yml` | parses; diff limited to the four CI items above |
| B-6 | `git diff --stat <phase1-close>.. -- workers/site/src/index.ts workers/site/src/sitemap.ts workers/site/src/preview.ts workers/site/src/compat/vercel-shim.ts workers/site/test/*.test.ts workers/site/test/helpers workers/site/vitest.config.ts` | empty |

### Unit S: files API (R2 + legacy S3) — P2-4 files (0.6 d), P2-9 CORS file (0.05 d)

| Item | Detail |
|---|---|
| Owns | `workers/shared/src/storage/*`, `workers/shared/test/storage/**`, `workers/shared/test/helpers/fake-s3.ts`, `workers/site/src/api/files.ts`, `workers/site/test/{files,files-*}.test.ts`, `workers/site/test/integration/files.t2.ts`, `workers/site/r2/cors.private.json`, `scripts/r2-to-legacy-s3.mjs` |
| Builds | §2.3 storage functions; `handleFiles` per infra.md §6.2-§6.3: same statuses and bodies as api/s3.js:143-231 (incl. `Unknown action: <value>`, `fileName is required`, `key is required`, `prefix is required`, `{success:false, deletedCount:0}`, `lastModified` ISO string, `publicUrl`/`url` in the legacy string format), `X-Amz-Expires=300` for PUT, `expiresIn` default 3600 and 500 `{error}` above 604,800 (contracts.md §3.2), R2 → legacy fallback for `presign-download`, union of first pages for `list`/`delete-folder` (R2 wins on duplicate keys), deletes on both stores, `delete-folder` prefix normalised to end in `/` before listing on either store (F-23 exception 2; `list` keeps the raw prefix), `articles` scope on legacy only (D-17); applies `FileConstraints` (Appendix P.2) without changing any response shape for callers that respect them. Sentinels arrive ungated and are answered as api/s3.js does: `#options` → 204 empty (:144-146); `#unknown` → 400 `{"error":"Unknown action: <value>"}` with the value formatted as a template literal formats it (string as is, array joined by commas, missing → `undefined`; :226); `#throws` → 500 `{"error":"<getter error message>"}` (`Invalid JSON` for bad JSON; :228-231) |
| Rollback helper | `scripts/r2-to-legacy-s3.mjs`: owner-run; `--since <ISO>` `--dry-run` (default) `--execute`; copies R2 `rfq/<k>` → legacy rfq bucket `<k>` with the owner's own credentials from env; uses `@aws-sdk/client-s3` from the root `node_modules` (no new dependency); prints keys, never credentials (PLAN.md:255; infra.md §6.2) |
| Depends on | A (json, vercel-node `parseVercelBody` semantics via `ResolvedApi.body`), G (`FileConstraints` type), B (`ResolvedApi` stub) |

Acceptance:

| # | Command | Pass |
|---|---|---|
| S-1 | `npm --prefix workers/shared test -- test/storage` | golden: aws4fetch signatures equal `@smithy/signature-v4` for R2 PUT with signed `Content-Type`, R2 GET, R2 EU endpoint, legacy S3 eu-north-1 GET (8 cases, infra.md §1.2); a different `Content-Type` changes the PUT signature; `X-Amz-Expires` as requested; ListObjectsV2 XML parsing incl. escaped keys |
| S-2 | `npm --prefix workers/site test -- test/files` | every action × scope × store against the fake S3 (re-verifies SigV4) and a fake R2 binding: PUT → GET identical SHA-256 offline; legacy-only key downloads; response JSON byte-equal to fixtures derived from api/s3.js; constraint cases of Appendix P.2; `delete-folder` with prefix `RFQ-02102026-1` (and `RFQ-02102026-1/`) deletes `RFQ-02102026-1/a.step` on both stores and leaves `RFQ-02102026-10/b.step` |
| S-3 | `npm --prefix workers/site test -- test/files-config` | `R2_JURISDICTION` agrees with `"jurisdiction"` of `PRIVATE_FILES` in workers/site/wrangler.jsonc |
| S-4 | `npm --prefix workers/site run test:integration -- files.t2` | local R2 binding paths (head/list/delete) and presigned URL shapes through the real Worker |
| S-5 | `node scripts/r2-to-legacy-s3.mjs --help`; dry run against the fake S3 (`--endpoint` test flag) | lists the expected keys, writes nothing |

### Unit C: `microns-ops` (scaffold, routes, queue, nest) — P2-1 (0.25 d), P2-5 (0.75 d), P2-6 (0.5 d)

| Item | Detail |
|---|---|
| Owns | `workers/ops/**` except G's two route modules and their tests (incl. the Wave 0 skeleton and the `compat/express-shim.ts` stub A wrote, §2.14); `.github/workflows/cf-ops.yml` |
| Builds | §2.5, §2.6 ops config, §2.9; `README.md` (run, deploy order "ops first, `wrangler deploy` not version upload", secrets list), `.dev.vars.example`; `scripts/nest-fixture.mjs` exporting `buildNestPayload(instances: number, level: 'balanced'\|'best')` (DXF text + metadata as RfqDetails.tsx:1615-1632 sends) for 80 / 400 / 800 / 1,200 part instances; `cf-ops.yml`: `workflow_dispatch` only, installs root + shared + ops, typecheck, tests, dry run with metafile, then `wrangler deploy` only when input `deploy` is `true` (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) |
| Scripts | `dev` (`wrangler dev --local --port 8788`), `test`, `typecheck`, `build:dry` (`wrangler deploy --dry-run --outdir .wrangler/dry --metafile .wrangler/dry/meta.json`), `test:integration` (`vitest run -c vitest.t2.config.ts`, globalSetup = B's) |
| Depends on | A, G (Wave 0 stubs of the two marketing modules), B's harness for T2. `tsconfig.json` keeps the `compilerOptions` of workers/site/tsconfig.json (A-1b) |

Acceptance:

| # | Command | Pass |
|---|---|---|
| C-1 | `npm --prefix workers/ops ci && npm --prefix workers/ops run typecheck && npm --prefix workers/ops test` | `OpsApi.handle`: `v` check, principal only from `call`, a principal-like header ignored; Hono middleware rejects requests without a call; every route reaches its module lazily with `functionUrl`; `tender-scan`: MACHINE + POST → queued body (exact keys), STAFF → handler, validation 400s identical, connector code list equals api/tender-scan.js:37-71; consumer: ack/retry/DLQ mapping with an injected handler map; `funded-scan` kind through the handler |
| C-2 | `npm --prefix workers/ops run build:dry` | bundles; metafile contains `qrcode/lib/server.js`, not `qrcode/lib/browser.js`; size printed (probe reference 3,615.62 KiB / gzip 700.47 KiB, infra.md §1.2) |
| C-3 | `npm --prefix workers/ops run test:integration` | `inv-label` with a stubbed stock row → 200 `application/pdf`, body starts `%PDF-` (contracts.md §2); `nest` with the 80-instance fixture → 200 with `groups`; machine `tender-scan` (Access JWT minted at the stub) → queued 200 with the exact keys (the generated T2 ops config has no queue consumer, so no portal is contacted; consumer logic is C-1, a real scan runs only in T3); site → OPS RPC round trip with a STAFF principal |
| C-4 | `python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/cf-ops.yml'));t=d.get('on',d.get(True));assert list(t)==['workflow_dispatch'],t"` (PyYAML reads the `on` key as `True`) | exit 0: the only trigger is `workflow_dispatch` |

### Unit E: frontend — P2-10 (0.5 d + 0.25 d for the auth header and download changes)

All changes ship to `main` and therefore to Vercel production before Phase 3 (PLAN.md:215), so each must work against both the Vercel API and the Worker API. Compatibility rule: a change adds only request headers or optional named body fields, or changes how the browser opens a response it already receives; the Vercel handlers stay unchanged (G-3); every caller is same-origin (callers.md §2), so added headers trigger no preflight. The per-row evidence is in Appendix P.8 (PRIVATE).

| # | File (evidence) | Change | Compatibility |
|---|---|---|---|
| E-1 | new `src/utils/apiAuth.ts` | `apiAuthHeaders()` (session `access_token` from `supabase.auth.getSession()`, `{}` when signed out), `fetchWithAuth(url, init)`; `openWithAuth(url, filename)` for documents shown in a new tab: `const w = window.open('', '_blank')` runs synchronously in the click handler **before** any `await` (Safari and iOS block `window.open` once the user gesture has passed an awaited fetch), then `w.opener = null`, fetch with `apiAuthHeaders()`, `w.location.href = <object URL>`; `w === null` (popup blocked) → click a temporary `<a href=<object URL> download=<filename>>`; failure → `w?.close()` and a toast; the object URL is revoked on `w`'s `load` or after 60 s, whichever comes first. `downloadWithAuth(url, filename)` for files to save (CSV): fetch → Blob → temporary `<a download>` → revoke after 60 s | new file |
| E-2 | src/utils/s3Api.ts:11-15 | merge `apiAuthHeaders()` | request header only |
| E-3 | src/utils/awsS3Storage.ts:16-24 | optional `size: file.size` in the presign body | optional named body field |
| E-4 | src/utils/inventoryApi.ts:26-29 | merge `apiAuthHeaders()` into `headers`; **no body field** | request header only |
| E-5 | src/components/inventory/SessionCompletionModal.tsx:162; src/pages/inventory/QRScanner.tsx:241 (today plain `<a target="_blank">` links; QRScanner is the phone-side page) | label link → button using `openWithAuth(getLabelUrl(id), 'label-<id>.pdf')` (src/utils/inventoryApi.ts:223-225) | same request and PDF; window opened inside the click |
| E-6 | src/utils/partnerNotificationUtils.ts:110-116; src/utils/rfqPdfEmailService.ts:24-29; src/pages/OrderDetailsPage.tsx:1084-1100; src/pages/RfqDetails.tsx:1615-1632 | `Authorization` header | request header only |
| E-7 | src/components/dashboard/marketing/ApolloEnrichment.tsx:200; src/components/dashboard/marketing/EmailScraperView.tsx:59; src/pages/dashboard/CompanyScannerPage.tsx:297, :359, :402 | `Authorization` header | request header only |
| E-8 | src/pages/dashboard/TenderMonitorPage.tsx:121-135, :262, :276 | `Authorization` in `apiGet`/`apiPost`/PATCH; CSV via `downloadWithAuth` | request header only; same request |
| E-9 | src/pages/dashboard/FundedStartupsPage.tsx:392-394, :419-516 | session token instead of `VITE_SUPABASE_ANON_KEY` as Bearer; export via `downloadWithAuth` (:515) | request header value only |
| E-10 | src/components/dashboard/marketing/SenderAccountsManager.tsx:70-80, :213-228 | Gmail connect: open the popup synchronously on click, fetch the authorize step with the session token and `Accept: application/json`, `redirect: 'manual'`; a 200 JSON `{url}` → navigate the popup to `url`; **any other answer** (an `opaqueredirect`, 401/403, a challenge page, a network error) → navigate the popup to today's URL; accept `message` events only from `window.location.origin` or `https://www.micronshub.eu` (details Appendix P.5) | Vercel answers with a redirect → today's flow continues in the popup |
| E-11 | src/components/contact/ContactForm.tsx:98-109; src/components/quote-form/MultiStepQuoteForm.tsx:564 + src/utils/emailService.ts:19-43; new `src/components/security/TurnstileWidget.tsx`, `src/utils/turnstile.ts` | See "E-11 rules" below | request header only; the form submits with or without a token |
| E-12 | src/components/rfq/RfqFileDownload.tsx:30-110 | Look the file up through `/api/s3?action=list` (rfq scope, folder prefix; staff page, only importer RfqDetails.tsx:28); found → `presign-download` and open (via a window opened in the click, as `openWithAuth`); not found → today's `rfq-files` Supabase Storage path unchanged (PLAN.md P2-10, C12) | uses an existing action of the same endpoint (api/s3.js:209-223) |
| E-13 | src/pages/RfqDetails.tsx; src/components/inventory/InventoryLayout.tsx | on a 401 from `/api/*`, show "Sign in again" with a link to `/login` | shown only when an answer is 401 |
| — | src/pages/dashboard/SeoConsolePage.tsx | none (already sends the session token, :59-70) | — |
| — | src/pages/Contact.tsx, src/pages/QuoteRequestForm.tsx, src/components/quote-popup/QuotePopup.tsx, src/components/quote-form/MicronsMultiStepForm.tsx | none (unrouted or no form, callers.md §9) | — |

E-11 rules (Turnstile widget):

| # | Rule | Evidence |
|---|---|---|
| T-a | Explicit-render widget, `action` `contact` (ContactForm) or `quote` (MultiStepQuoteForm), `refresh-expired: 'auto'`; site key from `import.meta.env.VITE_TURNSTILE_SITE_KEY`, read only in `src/utils/turnstile.ts` (passes the `VITE_` filter, vite.config.ts:67-78); no key → no widget and no fallback key (F-16) | gates_PRIVATE.md F11 as amended (Appendix P A-16) |
| T-b | The script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` is injected only after the first `focusin` or `pointerdown` inside one of the two forms, or at submit if not yet loaded; never when `navigator.userAgent` contains `jsdom`; the loader is idempotent | The production build prerenders `/<lang>/contact` and `/<lang>/quote` (vite.config.ts:29-50, :43, :46) in jsdom with `runScripts: 'dangerously'`, `resources: 'usable'` (vite.config.ts:92-104; node_modules/@prerenderer/renderer-jsdom/dist/Renderer.js:145); both forms render there (src/App.tsx:184, :207; src/pages/Quote.tsx:4; src/pages/content/ContactPage.tsx:7) |
| T-c | The token is read with `turnstile.getResponse(id)` immediately before each `/api/emails` fetch and sent as `X-Turnstile-Token`; the widget stays mounted until that fetch has returned. `sendRFQEmails` gains an optional `getToken: () => Promise<string \| null>` argument | The quote form creates the RFQ (MultiStepQuoteForm.tsx:429), uploads every file in a loop (:481-488) and only then sends the mails (:564); tokens are valid 300 s and single-use (infra.md:63) |
| T-d | On 403 `{"error":"turnstile_failed"}`: `turnstile.reset(id)`, wait ≤ 30 s for a new token, retry once; then report the error as today | MultiStepQuoteForm.tsx:585 swallows mail errors; src/utils/emailService.ts:48-57 returns `false` on a non-2xx |
| T-e | The form always submits: without a token (no key, script blocked, widget error, 30 s timeout) the request goes without the header and the server decides; reset the widget after every attempt | — |

| Item | Detail |
|---|---|
| Owns | the files of the table, `src/vite-env.d.ts` only if a type for `VITE_TURNSTILE_SITE_KEY` is needed, `tests/frontend-api/**` |
| Depends on | Only the header names and query shapes of §2.8; no Worker code |

Acceptance:

| # | Command | Pass |
|---|---|---|
| E-a | `npx tsc -p tsconfig.app.json --noEmit 2>&1 \| grep -c "error TS"` before and after | count not higher; no error in a changed file (the baseline already has errors, e.g. src/utils/tenantPdfConfig.ts:58) |
| E-b | `npx eslint <changed files>` | no new errors |
| E-c | `workers/site/node_modules/.bin/vitest run -c tests/frontend-api/vitest.config.mjs` (config without imports, `globals: true`, §2.13; `@` alias → `src`; supabase client mocked) | `apiAuthHeaders` signed in/out; `openWithAuth` calls `window.open` before the fetch resolves (call order), falls back to an anchor download when `window.open` returns `null`, revokes on `load` or after 60 s; `downloadWithAuth` revokes; Turnstile loader idempotent, not injected before interaction, never under a `jsdom` user agent; token read right before the fetch; expired-token path (first answer 403 `turnstile_failed` → reset → one retry → 200); no token → request sent without the header; OAuth: every answer other than 200 JSON (opaqueredirect, 401, 403, 429 HTML) → popup to today's URL; origin filter |
| E-d | `npx vite build` twice (same env as Phase 1 local builds): without `VITE_TURNSTILE_SITE_KEY` and with the CF test site key `1x00000000000000000000AA` | both succeed; prerender count unchanged (cf-preview.yml:173-200 check logic); `rg -l "challenges.cloudflare.com\|cf-turnstile" dist --glob '*.html'` prints nothing for both builds |
| E-e | `git diff -U0 -- src/utils/inventoryApi.ts \| rg "^\+.*body"` | no added body field |
| E-f | `rg -n "VITE_TURNSTILE_SITE_KEY" src` | read only in `src/utils/turnstile.ts` |

### Unit F: callers, e2e and clean-up — P2-11 (0.35 d), P2-12 tests (0.4 d), exit gate 10 (0.1 d)

| Item | Detail |
|---|---|
| Owns | `mcp-server/src/index.ts`, `mcp-server/README.md`, `supabase/functions/tender-collector/index.ts`, `tests/e2e/api.spec.ts`, `tests/e2e/api/**` (helpers `*.ts` not named `*.spec.ts`, `seed.sql`, `cleanup.sql`, `fixtures.example.json`), `.env.example`, `docs/AWS_S3_VERCEL_GUIDE.md` |
| MCP server | One `SITE_URL` (`process.env.SITE_URL \|\| "https://www.micronshub.eu"`) for all six calls (mcp-server/src/index.ts:523, :678, :797, :1288, :1327, :1550; the `api_base_url` arguments stay as optional overrides); headers `CF-Access-Client-Id`/`CF-Access-Client-Secret` from env `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` on every `/api/*` fetch when both are set; `redirect: 'manual'` (a credentialed request never follows a cross-host redirect); `trigger_country_scan` prints "queued (run_id …)" when the answer has `queued`, else the counts; `export_tenders_csv` fetches `/api/tenders?export=csv&…` (the old `/api/tenders-export` path no longer exists, api/tenders.js:50) and returns the CSV text (truncated at 200 KB with a note) |
| `tender-collector` | Read the **live** source read-only (Supabase MCP `get_edge_function`, project `cfjrtmtaitwzggzpkhxi`, function `tender-collector`; live v11, callers.md §4) into the scratchpad; the repo file becomes that source plus: `CF-Access-Client-Id`/`-Secret` headers from `Deno.env.get('CF_ACCESS_CLIENT_ID'/'CF_ACCESS_CLIENT_SECRET')` when both are set, and logging of `queued`/`run_id` when present. `SITE_URL` default stays `https://www.micronshub.eu` (supabase/functions/tender-collector/index.ts:5). Not deployed (owner, §6) |
| `api.spec.ts` | Refuses to run unless `API_E2E_MODE` ∈ {`local`, `preview`} and `BASE_URL` is not `www`, the apex or `*.vercel.app`. Modes: `local` (T2 harness, tag `@local`: gate denials, sentinels, OPTIONS shapes, tracking T1/T2/T5/T10, forward echo); `preview` (T3: every endpoint and action of INVENTORY rows API-emails … API-sitemap, inventory.csv:61-72; gate vectors by action ID; R2 round trip and a legacy object download; Svix vectors; tracking T1-T11 with seeded IDs; `inv-label`; `nest` fixtures from `workers/ops/scripts/nest-fixture.mjs` tagged `@slow`; machine-token requests shaped like `tender-collector` and MCP); `compare` (optional, owner's allow-listed machine: the same tracking and OPTIONS requests against `VERCEL_BASE_URL` for byte comparison; tracking cases use **separate seeded `sent` events per platform and per case** (first-hit and repeat-hit for open, click and unsubscribe), because the first hit of a subscriber answers different headers from later hits (contracts.md:140, :143); repeat-hit events are primed once on each platform before the comparison; `tests/e2e/api/seed.sql` and the mode's description record this). Credentials: no `extraHTTPHeaders` anywhere (playwright.config.ts:3-9). Two request contexts: `apiCtx` (`baseURL` = BASE_URL, no default headers) used only through a helper `api(path, init)` that resolves the URL, asserts its origin equals the BASE_URL origin, adds the Access CI headers to that one call and sets `maxRedirects: 0`; `plainCtx` (no headers) for every absolute URL (presigned R2 `*.r2.cloudflarestorage.com` and legacy `*.s3.eu-north-1.amazonaws.com` URLs, third-party hosts); the helper throws on an absolute URL of another origin. Run settings without touching the frozen config (playwright.config.ts:19-21: timeout 30 s, retries 1): `test.describe.configure({ retries: 0 })` at the top of api.spec.ts (mail, seeded writes and the T18 rate-limit vector are not idempotent), `test.setTimeout(330_000)` plus a per-request `timeout` for `@slow` cases (`nest` fixtures up to the 300 s `cpu_ms`, F-12) |
| e2e env | `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` (CI token, existing), `E2E_FIXTURES` (path to a JSON outside git: test user credentials, machine token, seeded IDs, test webhook secret; shape in `tests/e2e/api/fixtures.example.json`), `E2E_SEND_MAIL=1` to enable the one mail-sending test (F-28) |
| Clean-up | `.env.example:23-29`: replace the `VITE_AWS_*` lines with the server names api/s3.js reads first (`AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ARTICLES_*`; api/s3.js:33-65) and add `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (CF test site key); `docs/AWS_S3_VERCEL_GUIDE.md:138-152`: same renaming, text says the keys are server-side only (vite.config.ts:67-72) |
| Depends on | B's harness (local mode), C's `nest-fixture.mjs`, the header names of §2.6 and the queued answer of §2.9 |

Acceptance:

| # | Command | Pass |
|---|---|---|
| F-1 | `npm --prefix mcp-server ci && npm --prefix mcp-server run build` | `tsc` exit 0 |
| F-2 | `rg -n -e '[\|]{2} "https://micronshub.eu"' -e 'tenders-export' mcp-server/src/index.ts` (today it matches only the code defaults at mcp-server/src/index.ts:1288, :1327, :1550 and the old path at :1333, not the `describe()` texts at :1285, :1547; probe 2026-10-03) | no default apex host, no old export path (descriptions may still mention the domain) |
| F-3 | `bun build --no-bundle supabase/functions/tender-collector/index.ts --outdir "$TMPDIR/tc"` | parses (no Deno in this container) |
| F-4 | `diff <scratch live source> supabase/functions/tender-collector/index.ts` | only the header and logging lines differ; the live source is never committed |
| F-5 | `npx playwright test tests/e2e/api.spec.ts --list` | lists the suite; without `API_E2E_MODE` the run aborts with the guard message |
| F-6 | `npm --prefix workers/site run t2:up &` then `BASE_URL=$(npm --prefix workers/site run -s t2:wait) API_E2E_MODE=local npx playwright test tests/e2e/api.spec.ts --grep @local` (the URL comes from `workers/site/.wrangler/t2/urls.json`, §2.12) | green |
| F-7 | `rg -n "VITE_AWS" .env.example docs/AWS_S3_VERCEL_GUIDE.md workers` | no output (exit gate 10, PLAN.md:253) |

---

## 4. Order, merge and integration

| Wave | Units | Gate to the next wave |
|---|---|---|
| 0 | A: package + contract stubs (§2.14) | `workers/shared` typecheck green |
| 1 (parallel) | A (implementation), G, S, B, C, E, F | each unit's T1 checks green (G-3's real-handler case waits for A's `runNodeHandler`, not for C) |
| 2 | B runs T2 for all (`npm run cf:t2`), then F's local e2e | T2 green; bundle guard green; size reports for both Workers |
| 3 (owner + Both) | §6 items, then T3 on the preview | Phase 2 exit gate (PLAN.md:242-253) |

Merge order (files are disjoint, so this only reduces rebuild churn): A → G → S → C → B → E → F. Each unit rebases on the integration branch before its final run; E merges last among code units because it reaches production.

| Exit gate (PLAN.md:244-253) | Evidence | Units |
|---|---|---|
| 1 api.spec green on preview | `API_E2E_MODE=preview` run | F (all) |
| 2 R2 round trip + legacy download | S-2 offline, T3 `@files` | S, F |
| 3 Svix accepted / rejected | G-1, G-3, T3 webhook vectors | G, F |
| 4 Tracking identical | track.t2, T3 `compare` mode from an allow-listed machine with per-platform, per-case seeded events (unit F); on `www` in Phase 2 and through the apex redirect in Phase 3 (callers.md §10) | B, G, F |
| 6 (note) | Turnstile on the preview runs in test-key mode (F-30): no header → 403, the dummy token → gate passes; the 1x/2x/3x secret matrix is covered in T1/T2 (G-1, G-4) | G, F |
| 5 OPTIONS parity | Phase 1 parity tool (scripts/seo-parity/lib/urls.mjs:250-253) + T3 | B, F |
| 6 Gate behaviour | G-2, G-4, T3 vectors by action ID | G, F |
| 7 Forward flag both ways | T3 with `{"enabled":true,"value":{"hosts":["preview"]}}`, then deleted; responses carry Vercel's own headers only when on | B, F |
| 8 MCP + tender-collector-shaped request | T3 machine-token requests; MCP build | F, C |
| 9 Size reports, no forbidden code in the site | B-3, C-2 | B, C |
| 10 No `VITE_AWS_*` | F-7 | F |

---

## 5. Gate matrix (by action ID)

The rules for each ID are in `gates_PRIVATE.md` §3 (PRIVATE) with the amendments of Appendix P.1; this table is summary level and safe for repo docs. Every write path gets a gate (PLAN.md:192-202); e-mail links stay credential-free by design (PLAN.md:200).

| ID | Endpoint / action | Rule source | Test vectors (gates_PRIVATE.md §13) | Runs in |
|---|---|---|---|---|
| EM-1 | `/api/emails` `email` (default and unknown values) | gates_PRIVATE.md §3.1 row `email` | T5, T6 | site |
| EM-2 | `/api/emails` `contact` | §3.1 `contact` | T5 | site |
| EM-3 | `/api/emails` `rfq` | §3.1 `rfq` | — | site |
| EM-4 | `/api/emails` `rfq-pdf` | §3.1 `rfq-pdf` | T1-T4 | site |
| S3-1 | `/api/s3` `presign-upload`, scope `rfq` | §3.2 row 1 | T9 | site |
| S3-2 | `presign-download`, `rfq` | §3.2 row 2 | T8 | site |
| S3-3 | `delete`, `rfq` | §3.2 row 3 | — | site |
| S3-4 | `delete-folder`, `rfq` | §3.2 row 4 | T10 | site |
| S3-5 | `list`, `rfq` | §3.2 row 5 | — | site |
| S3-6 | any action, scope `articles` | §3.2 row 6 | — | site |
| MK-1 | `track` (`open`, `click`, `unsubscribe`; also `/api/track`) | §3.3 `track`, §9 | T14, T15 | site |
| MK-2 | `webhook` | §3.3 `webhook`, §2.5 | T13 | ops |
| MK-3 | `google-auth` `authorize` | §3.3, §5 | — | site + ops |
| MK-4 | `google-auth` `callback` | §3.3, §2.6 | T17 | site + ops |
| MK-5 | `google-auth` `refresh` | §3.3 | — | site + ops |
| MK-6 | `google-auth` with `error` | §3.3 | T16 | ops |
| MK-7 | `apollo-enrich` | §3.3 | T1-T4 | site |
| NT-1 | `/api/notifications` `partner` (default, unknown non-`inv-`) | §3.4 | T7 | site |
| NT-2 | `production-status` | §3.4 | — | site |
| NT-3 | `nest` | §3.4 | — | site |
| NT-4 | `inv-*` except NT-5…NT-7 | §3.4, §6 | T11 | site |
| NT-5 | `inv-label` | §3.4 | — | site |
| NT-6 | `inv-stock-scan` | §3.4 | — | site |
| NT-7 | `inv-cron-batch` | §3.4 | — | site |
| GS-1 | `/api/gsc` (all actions) | §3.5 | T1-T4 | site (+ handler's own check in ops) |
| TD-1 | `/api/tenders` GET branches, `/api/connector-status` GET | §3.5 | — | site |
| TD-2 | `/api/tenders` PATCH (also via `/api/connector-status`) | §3.5 | — | site |
| TS-1 | `/api/tender-scan` POST | §3.5, §4 | T12 | site |
| FS-1 | `/api/funded-startups` GET branches | §3.5 | — | site |
| FS-2 | `/api/funded-startups` POST scan | §3.5 | — | site |
| FS-3 | `/api/funded-startups` PATCH | §3.5 | — | site |
| SC-1 | `/api/scrape-website` | §3.5 | — | site |
| SC-2 | `/api/scrape-company-profile` | §3.5 | — | site |
| SC-3 | `/api/scan-directory` | §3.5 | — | site |
| SM-1 | `/api/sitemap`, `/sitemap*.xml` (Phase 1) | §3.5 last row | — | site |
| X-0 | sentinels (`#options`, `#method`, `#unknown`, `#unknown-step`, `#throws`), incl. `OPTIONS`/non-POST on `apollo-enrich` | §2.8 order 1; Appendix P A-1/A-2 | T19 | site |
| X-1 | rate limits (all classes; three bindings, F-24) | §2.3; Appendix P A-14 | T18, burst vectors of G-2 | site |
| X-3 | body format rules (F-29) | Appendix P A-9, A-10 | G-2 vectors | site |
| X-2 | `api.forward_to_vercel` on | §0 D11, §10 R2 | T20 | site |

---

## 6. Owner-side checklist (final manual steps; Dimitris unless marked Both)

| # | Step | When | Blocks | Reference |
|---|---|---|---|---|
| O-1 | Sign the Phase 1 gate; P0-1 done (auto-merge gated, `main` protected); P0-8 done (Workers Paid, R2 enabled, CI API token, Access team domain) | before any Phase 2 push | everything | PLAN.md:42-43, :84, :91 |
| O-2 | Answer the open decisions of §7 (or accept the defaults) and approve the proposed names (§7 D-10) | before B/S/C merge | config values | — |
| O-3 | Create `microns-private` (`wrangler r2 bucket create microns-private -J eu`, if D-1 = eu) and `microns-public` (`--location weur`); apply `workers/site/r2/cors.private.json` with the real `<WORKERS_SUBDOMAIN>` (`wrangler r2 bucket cors set microns-private -J eu --file …`) | P2-9 | files API on the preview | infra.md §6.1, §6.5, §13 |
| O-4 | R2 API token (Object Read & Write, `microns-private` only) → site secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | P2-9 | presigning | infra.md §13 #4 |
| O-5 | A new AWS IAM key for the Worker with the scope in Appendix P.7 → `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY`; legacy bucket names from P0-4 into the two bucket vars; say whether Vercel uses a separate articles key pair | P2-9 | legacy reads | infra.md §12.1; contracts.md §4 |
| O-6 | `wrangler queues create scrapes` (DLQ is created automatically) | before the first ops deploy | ops deploy | infra.md §7.3 |
| O-7 | Turnstile widget with hostnames `www.micronshub.eu`, `micronshub.eu`, the preview hosts (check tenant-subdomain coverage). Phase 2: Worker secret `TURNSTILE_SECRET_KEY` = CF test secret `1x0000000000000000000000000000000AA` and GitHub secret `VITE_TURNSTILE_SITE_KEY` = CF test site key `1x00000000000000000000AA` (test keys pair with each other; CF docs, re-check); the gate runs in test-key mode on preview hosts only (F-30). **No** site key in the Vercel env in Phase 2: Vercel ignores the token, and without a key production pages load no challenge script before O-20 is done. Phase 3 S11: real secret on the Worker and real site key in the GitHub secret, because the Worker then serves the production SPA (a test secret left on a production host fails closed with 503, F-30) | P2-9; S11 | E live, T3 | gates_PRIVATE.md §2.2; infra.md §1.1 |
| O-8 | Access: create service tokens `microns-machine-collector` and `microns-machine-mcp`; add Service Auth rules for both to the preview Access app next to the CI token; put `<client-id>=collector,<client-id>=mcp` into site secret `ACCESS_MACHINE_CLIENT_IDS`; replace the `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` placeholders | P2-9 | TS-1 machine path, gate 8 | F-15 |
| O-9 | Ops secrets with `wrangler secret put <NAME>` in `workers/ops` (the first `put` creates the Worker), then the first ops deploy (`cf-ops.yml` with `deploy: true`) — ops must be deployed, not version-uploaded | P2-9 | site → OPS | infra.md §5.4 |
| O-10 | Site Phase 2 secrets; replace the placeholders in `workers/site/wrangler.jsonc` (`R2_ACCOUNT_ID`, bucket vars, Access vars) by values (IDs, not secrets); then a `cf-preview.yml` dispatch (it fails until every `secrets.required` name exists) | P2-9 | T3 | workers/site/wrangler.jsonc:77-80 |
| O-11 | Append every new secret, token and rate-limit `namespace_id` (2001, 2002, 2003) to the P0-2 consumer checklist on the day it is created | same day | — | PLAN.md:85, :214 |
| O-12 | Resend: read today's webhook destination (www, apex, the live-only `resend-webhook` function, or none). Phase 2: generate a test signing secret for ops `RESEND_WEBHOOK_SECRET` and place it in the e2e fixtures file. Phase 3 S11: create or repoint the real endpoint at `https://www.micronshub.eu/api/marketing?action=webhook` and set its signing secret | P2-8 | gate 3 | PLAN.md:213; callers.md §6 |
| O-13 | Google: read `GOOGLE_REDIRECT_URI` in Vercel and the Authorised redirect URIs in Google Cloud; ops secret `GOOGLE_REDIRECT_URI` = `https://www.micronshub.eu/api/marketing?action=google-auth&step=callback` (must be registered); optional: register the preview callback for a pre-flip end-to-end test | P2-8 | Gmail connect after the flip | contracts.md §3.4; callers.md §6 |
| O-14 | Supabase (Both): create e2e users (one with a staff role row in `user_roles`, one customer; e-mail addresses on Resend's test sink `delivered+…@resend.dev`), apply `tests/e2e/api/seed.sql` after review, fill the fixtures JSON outside git; apply `cleanup.sql` after the gate | before T3 | gates 1, 4, 6 | F-28 |
| O-15 | `tender-collector`: review and deploy the new source; Supabase function secrets `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` (collector token); `SITE_URL` unchanged until Phase 3 (then `https://api.micronshub.eu` if D-3 is accepted) | P2-11 | gate 8 real run | gates_PRIVATE.md §4 M2-M4 |
| O-16 | MCP: set `SITE_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (mcp token) in the local MCP configuration; rebuild | P2-11 | gate 8 | — |
| O-17 | Run the T3 `compare` mode (tracking bytes, OPTIONS) from the allow-listed vantage point used for P0-3 | P2-12 | gates 4, 5 | PLAN.md:86 |
| O-18 | Gate 7: write `{"enabled":true,"value":{"hosts":["preview"]}}` to KV `FLAGS` key `api.forward_to_vercel`, run the forward tests, delete the key | P2-12 | gate 7 | §2.7 |
| O-19 | Read the Workers Logs of `microns-ops` for the `nest` fixtures (CPU per invocation) and decide D-6 | P2-12 | — | infra.md §8 |
| O-20 | Privacy notice / cookie banner check for the Turnstile challenge script on the two public forms (the script loads only after the visitor interacts with a form, E-11 T-b) | before any production build carries a real site key (Phase 3 S11 at the latest; never in the Vercel env in Phase 2, O-7) | S11 | F-16 |
| O-21 | Sign the Phase 2 gate | end | Phase 3 | PLAN.md:51-56 |
| O-22 | Preview data hygiene (F-28): on the preview submit quotes and uploads only against seeded test RFQs; run `cleanup.sql` after each T3 run; before Phase 3, run `scripts/r2-to-legacy-s3.mjs --dry-run`, then `--execute` for any non-test object uploaded through the preview, so that production staff on Vercel (who presign against legacy S3) can open every file whose `rfq_files` row exists | during T3; before S11 | Phase 3 | src/utils/rfqFileStorage.ts:28-49; src/components/quote-form/MultiStepQuoteForm.tsx:487-500 |
| O-23 | Decide D-16 and D-17 (§7) and set the production values (`API_GATES_MODE`, article upload target) in the Phase 3 runbook; set `API_MACHINE_HOSTS` = `api.micronshub.eu` when that host and its Access app exist (D-3) | before S11 | Phase 3 | §7 |

PRIVATE owner items (Vercel Firewall options, timing relative to publishing gate code) are in Appendix P.6.

---

## 7. Open decisions and the defaults the build uses

| # | Question | Default built | Owner |
|---|---|---|---|
| D-1 | R2 jurisdiction `eu` for `microns-private` (only at creation) | `eu` (F-20) | Dimitris |
| D-2 | R2 key layout `rfq/<contract key>` for `/api/s3` uploads (CANON's `rfq/<rfq_id>/<file_id>-<name>` kept for Phase 4 e-mail RFQs); `publicUrl`/`url` keep the legacy string format | yes (F-10; contracts.md §8 D3; PLAN.md Q11) | Dimitris |
| D-3 | Machine credential: Access tokens on preview now and on a new host `api.micronshub.eu` from Phase 3 (runbook step before the `www` flip), or a Worker-checked shared secret on `www` | Access, two tokens (F-15) | Dimitris (gates_PRIVATE.md §12 O1) |
| D-4 | Queue only machine `tender-scan`; funded scan and GSC bulk stay synchronous | yes (F-11) | Dimitris |
| D-5 | All `/api/notifications` to `microns-ops` | yes (F-9) | Dimitris |
| D-6 | `nest`: `cpu_ms` 300,000 without an instance cap; Container fallback only if a real order exceeds it | yes (F-12) | Dimitris after O-19 |
| D-7 | Existing defects ported unchanged except the webhook retry acknowledgement and the `delete-folder` prefix normalisation | yes (F-23) | Dimitris (contracts.md §8 D9) |
| D-8 | Gate-specific choices (report mode for one check, upload limits, tenant-admin access, interim measures for the Vercel copy until the flip) | see Appendix P.6 | Dimitris |
| D-9 | Allow-list CORS switch-on timing (after the Phase 3 observation window, not Phase 6) | not wired in Phase 2 (F-17) | Dimitris |
| D-10 | New names: `api.micronshub.eu`, Access app `microns-machine-api`, tokens `microns-machine-collector`/`microns-machine-mcp`, vars `API_FORWARD_TO_VERCEL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `API_GATES_MODE`, `API_MACHINE_HOSTS`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, bindings `API_RATE_LIMIT_MAIL`, `API_RATE_LIMIT_BULK` (namespace 2003), secret `ACCESS_MACHINE_CLIENT_IDS`, Supabase/MCP secrets `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`, frontend `VITE_TURNSTILE_SITE_KEY`, entrypoint `OpsApi`, files `workers/shared/**`, `.github/workflows/cf-ops.yml`, `scripts/r2-to-legacy-s3.mjs` | used as proposed | Dimitris |
| D-11 | Unknown `/api/*` paths: forward until P0-3 confirms Vercel's answer (expected SPA shell 200), then serve the shell locally | forward (F-7) | after P0-3 |
| D-12 | CORS precedence when a handler sets the same header (`finalise()` overrides today) | Phase 1 behaviour; revisit from the P0-3 capture | after P0-3 (contracts.md §8 D7) |
| D-13 | FR tender connector parses a remote JSON file of unknown size | measure in T3; stream or cap only if large | Both (contracts.md §8 D13) |
| D-14 | Optional data change: `marketing_settings.tracking_domain` → `https://www.micronshub.eu` before the next campaign | not done by the build | Dimitris (callers.md §5) |
| D-15 | Re-check items: callee `cpu_ms` for RPC calls, exact error on CPU exhaustion, version overrides for RPC, `@vercel/node` production bytes for invalid JSON and default `Cache-Control`, Vercel `maxDuration` | measured in T3 / P0-3 | Both (infra.md §14 X-1…X-7) |
| D-16 | Tracking-link edge case (rule and residual change: Appendix P A-7): from the `www` flip, keep today's behaviour for this case, or switch to the new rule? Only today's behaviour guarantees the fixed requirement that links already in sent e-mails keep working byte-identically, because sends by earlier campaign versions cannot be audited (callers.md:122-123) | Built switchable (`API_GATES_MODE` token `redirect=report\|enforce`). Phase 2 preview: `enforce` (no real link reaches the preview). Production at S11: `redirect=report` (today's behaviour, logged) unless the owner accepts the residual change documented in Appendix P A-7 | Dimitris, before S11 (O-23) |
| D-17 | Article image uploads (`/api/s3` scope `articles`) stay on legacy S3 from the flip until P3-6 (PLAN.md:166, :274). This conflicts with "new uploads go to R2" and with CANON.md §4 ("Legacy … READ-ONLY"), and needs `PutObject` on the legacy articles bucket for that window (Appendix P.7) | PLAN.md behaviour. Alternative: connect `files.micronshub.eu` to `microns-public` before S11 and switch article uploads at the flip (more Phase 3 work for unit S) | Dimitris, before S11 (O-23) |

---

## 8. Deviations from PLAN.md §5.2 and repo doc corrections (to be written into the docs only with the owner's OK, PLAN.md:45)

| # | PLAN / doc statement | Build | Evidence |
|---|---|---|---|
| DV-1 | `partner`, `production-status` site-local (PLAN.md:169; ARCHITECTURE.md:301) | `OPS` | F-9 |
| DV-2 | Shim at `workers/ops/src/compat/express-shim.ts` "also used by the site" (PLAN.md:180, :224) | Core in `workers/shared/src/compat/vercel-node.ts`; the PLAN path is the Hono adapter; semantics `@vercel/node`, not Express | F-3; infra.md §3.4 |
| DV-3 | P2-6: funded scan and GSC bulk on Queue `scrapes`; ARCHITECTURE.md:306 "answer 2xx at once" for every `tender-scan` | Queue only for machine `tender-scan` | F-11 |
| DV-4 | `cpu_ms` 60,000 (wrangler.jsonc.draft:254-256; ARCHITECTURE.md:303) | 300,000 | F-12 |
| DV-5 | R2 keys `rfq/<rfq_id>/<file_id>-<name>` for the `/api/s3` replacement (PLAN.md:166; wrangler.jsonc.draft:143-150) | `rfq/<contract key>` | F-10 |
| DV-6 | P2-10 Turnstile in `src/pages/Contact.tsx`, `QuoteRequestForm.tsx`, `QuotePopup.tsx` (PLAN.md:215, :232) | `ContactForm.tsx`, `MultiStepQuoteForm.tsx`; `src/utils/s3Api.ts` and a shared auth-header helper added to the file list | callers.md §9-§10 |
| DV-7 | ARCHITECTURE.md:547 Access app on `www.micronshub.eu/api/tender-scan` "no browser caller" | Dropped; machine host `api.micronshub.eu` from Phase 3 | callers.md §10; F-15 |
| DV-8 | `OPS` binding without `entrypoint` (wrangler.jsonc.draft:137-141) | `"entrypoint": "OpsApi"` | F-6 |
| DV-9 | Ops `secrets.required` lists Phase 5 names (wrangler.jsonc.draft:483-485) | Phase 2 names only | infra.md §1.3 |
| DV-10 | Bucket names "constants in code" (wrangler.jsonc.draft:186-187) | Vars | F-21 |
| DV-11 | Route file `routes/inventory.ts` (PLAN.md:225); site `api/notifications.ts` (PLAN.md:227) | `routes/notifications.ts`, `routes/scrape.ts`; no site notifications module | F-9 |
| DV-12 | P2-11 MCP `export_tenders_csv` returns a link | Fetches and returns the CSV; path fixed | callers.md §10 |
| DV-13 | Exit gate 4 wording | Run on `www` in Phase 2 and through the apex redirect in Phase 3 (S13) | callers.md §10 |
| DV-14 | Gate-related behaviour changes (summary): one tracking-link edge case (switchable, D-16), the Gmail-connect flow, recipient checks, the webhook retry acknowledgement, JSON-only bodies with string fields on some write paths (F-29), the `delete-folder` prefix normalisation (F-23) | Documented deviations, details private | Appendix P |
| DV-15 | PLAN.md:231 adds `hono` and `aws4fetch` to the root `package.json` and lockfile | Per-package dependencies (`workers/ops`, `workers/shared`); root `package.json` gets scripts only | F-2 |
| DV-16 | PLAN.md:198 lists "CI tools" among the machine callers that use an Access service token | The CI Access token passes the preview's Access app but is not an API credential (principal `CI`, not `MACHINE`); e2e writes use a test staff user's JWT | Appendix P A-3; gates_PRIVATE.md §2.4 |
| DV-17 | PLAN.md:250 (exit gate 7): with `api.forward_to_vercel` on, "every `/api/*` request" is served by Vercel | `/api/sitemap` stays local even with the flag on: it is handled at router step 2 before `handleApi` (workers/site/src/index.ts:82-90); gate 7 is checked on the routed endpoints | §2.8 last rows |
| DV-18 | Fixed constraint "new uploads go to R2"; CANON.md §4 "Legacy … READ-ONLY" | Article uploads on legacy S3 until P3-6 as PLAN.md:166, :274 say; owner confirms or picks the alternative | D-17 |
| DV-19 | PLAN.md:198 "Access service token" for machine callers, implicitly on `www` | MACHINE accepted only on preview hosts and hosts in `API_MACHINE_HOSTS` (empty in Phase 2); `api.micronshub.eu` is added by the Phase 3 runbook | F-15; D-3 |
| Doc | workers/site/README.md:187 "10 MB after compression … Free limit is 3 MB"; ARCHITECTURE.md §20 | 64 MiB uncompressed on both plans, no compressed limit; startup 1 s (B fixes the README; ARCHITECTURE with the owner's OK) | infra.md §1.1, §1.3 |

---

## 9. Build risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Phase 1 files change under the Phase 2 build (G-4) | Start from the Phase 1 closing commit; B-6/A-5 diff checks |
| R-2 | `wrangler dev` with two configs is experimental (CF docs) and the harness rewrites paths | Probe-proven shape (infra.md §1.2); B keeps the harness small and fails loudly; T1 covers logic without workerd |
| R-3 | `qrcode` resolves to its browser build without the alias (contracts.md §2) | C-2 metafile check and C-3 `inv-label` T2 |
| R-4 | CPU limits are not enforced locally (CF docs) | `nest` CPU only from T3 logs (O-19) |
| R-5 | Unit E reaches production before Phase 3 | Harmlessness table, E-a…E-f, merge last |
| R-6 | Secrets-required lists block preview uploads until P2-9 | Expected; O-10 order; CI message |
| R-7 | Live schema drift makes some handler writes fail on both platforms (contracts.md §5) | T3 compares outputs, not only statuses (contracts.md §8 D12) |
| R-8 | Rate limits trip during e2e runs or on real page loads (parallel presigns, multi-file quotes) | BULK binding for idempotent reads and upload presigns (F-24); burst vectors in G-2; e2e spaces calls per key; one dedicated vector (T18) |
| R-9 | A Turnstile test secret reaches production and lets the dummy token pass | Test-key mode only on preview hosts; on any other host a test secret fails closed with 503 and an error log (F-30); O-7 step at S11 |
| R-10 | Frontend changes reach Vercel production before the Worker serves it (E-5 window handling, E-11 widget) | Neutral compatibility rule (§3 unit E), E-c/E-d checks, no Turnstile site key in the Vercel env in Phase 2 (O-7) |

---

## Appendix C — Critique log (review of 2026-10-03)

Each finding was checked against the repo at `ca87d83` and the scratch inputs before any change. All 25 were confirmed; none was rejected outright. Two suggested remedies were replaced by other fixes, and one alternative was rejected (reasons below). Findings marked [PRIVATE] are listed here by number only; their detail is in Appendix P.9.

| # | Sev. | Finding (public wording) | Verification | Outcome | Fixed in |
|---|---|---|---|---|---|
| 1 | High | Turnstile test keys can never pass the action, hostname and age checks, so the preview forms would answer 403 and exit gates 1 and 6 would fail | phase2/cfdocs/turnstile_testing.md:113-136 (fixed answer: action `test`, hostname `localhost`, challenge_ts 2022); old §2.3 `TurnstileInput`; old O-7 | Fixed. Own variant: test-key mode applies only on preview hosts, and a test secret on any other host fails closed (the critique's version had no host guard) | F-30, §2.3, §2.12, G-1, G-4, §4 gate 6, R-9, O-7, P A-18 |
| 2 | High | [PRIVATE] | confirmed | Fixed | F-29, §2.10, P A-10, P.9 |
| 3 | Med | A global config check made tracking links depend on unrelated secrets | old §2.4 step 1 and `ApiEnv`; api/marketing.js:11-21 needs only the Supabase names; old B-4 `startup.t2` expected the opposite | Fixed: names checked per target and per gate decision | F-22, §2.3 env-check, §2.4, §2.10, B-2 |
| 4 | Med | The request body was read twice (router buffer, then forward), so forwarded POSTs would answer 500 | workers/site/src/api/forward.ts:67-72; old §2.4 steps 2-3 | Fixed with both suggestions: path lookup before buffering, and a `body` parameter on `forwardToVercel` | §2.4, B-2, B-4 |
| 5 | Med | The quote form spends its Turnstile token only after all uploads | MultiStepQuoteForm.tsx:429, :481-488, :564, :585; emailService.ts:48-57; infra.md:63 | Fixed in the frontend (token read right before the call, widget kept mounted, one reset-and-retry). **Rejected alternative**: accepting `quote` without a token for a recently created RFQ, because it adds a second way past Turnstile for anyone who can create an RFQ number | E-11 T-c, T-d; E-c |
| 6 | Med | Widget problems: jsdom prerender, no always-submit rule, key-fallback conflict, privacy check after go-live | vite.config.ts:29-50, :92-104; Renderer.js:145; gates_PRIVATE.md F11 vs old E-11; old O-7/O-20 | Fixed: script loaded after interaction and never under jsdom; forms always submit; no fallback key (gates_PRIVATE.md amended); no site key in the Vercel env in Phase 2, O-20 before S11 | F-16, E-11 T-a…T-e, E-d, O-7, O-20, P A-16 |
| 7 | Med | Per-user rate limit would 429 real page loads | RfqDetails.tsx:307-313; QuoteDetailPage.tsx:129-134; PartConfigurationPage.tsx:159-166; inventoryApi.ts:14-41 | Fixed with a third binding (300/60 s) for idempotent reads and upload presigns, not an exemption, so a per-user ceiling remains; it also covers multi-file quote uploads (MultiStepQuoteForm.tsx:481-488), which the finding did not list | F-24, §2.3, §2.6, G-2, R-8, O-11, P A-14 |
| 8 | Med | [PRIVATE] | confirmed | Fixed | P A-6, P.3 |
| 9 | Med | [PRIVATE] | confirmed | Fixed | P A-7, P.3 |
| 10 | Med | [PRIVATE] | confirmed | Fixed with a switch and owner decision D-16 | D-16, O-23, P A-7, P-i |
| 11 | Med | [PRIVATE] | confirmed | Fixed | P.4, G-3 |
| 12 | Med | [PRIVATE] | confirmed | Fixed | F-29, P A-9, G-2 |
| 13 | Med | Typecheck dead end under the frozen site tsconfig | critic probe re-run with workers/site's tsc 7.0.2: TS2591 (`node:querystring`), TS7016 (`content-type`); workers/site/tsconfig.json:13 | Fixed: `ambient.d.ts`, which also covers `node:buffer` and `node:crypto`; tsconfig mirrors checked | §2.1, §2.3, §2.14, unit A, A-1b, unit C |
| 14 | Med | Unit G could not start before C; `jose` not resolvable from site tests | old §2.14 list (no express-shim.ts); old P.4 step 5; no `jose` in the root or workers/site `node_modules` (`ls`, 2026-10-03) | Fixed: G uses A's `runNodeHandler` directly, and `express-shim.ts` is a Wave 0 stub anyway; site tests mint through `workers/shared/test/helpers/jwt.ts`; B's stub client uses WebCrypto | §2.1, §2.12, §2.13, §2.14, unit G, P.4 |
| 15 | Med | Public sections described today's handlers | old §3 unit E intro and "Why harmless on Vercel" column; CANON.md §1 rule 2 | Fixed: neutral compatibility rule in §3; evidence moved to Appendix P.8; G-5 now covers the spec and READMEs | G-5, §3 unit E, P.8 |
| 16 | Med | Label opening would break on Safari and iOS | QRScanner.tsx:241; SessionCompletionModal.tsx:162 (plain links today); old E-1/E-5 | Fixed: `openWithAuth` opens the window inside the click | E-1, E-5, E-12, E-c |
| 17 | Med | e2e would send the CI token to presigned hosts; frozen timeout and retries | playwright.config.ts:3-9, :20-21; old unit F `api.spec` | Fixed: no `extraHTTPHeaders` at all; per-call headers through an origin-checking helper; a separate plain context; `retries: 0` and `setTimeout` inside the spec file | unit F |
| 18 | Low | Compare mode cannot be byte-identical on one seeded event | contracts.md:140, :143 | Fixed: per-platform, per-case seeded events | unit F, §4 gate 4, P.3 |
| 19 | Low | [PRIVATE] | confirmed (a), (b), (c) | Fixed; for (b) the suggested `opener_origin` query parameter was replaced by an origin derived from the request URL and carried in `OpsCall`, so no `/api` query shape changes | §2.3 `OpsCall`, E-10, P A-15, P.5 |
| 20 | Low | Article uploads on legacy S3 until P3-6 conflict with "new uploads go to R2" | PLAN.md:166, :274; CANON.md §4 | Fixed as owner decision D-17 (default: the PLAN.md behaviour) | D-17, DV-18, O-23, P.7 |
| 21 | Low | Preview uploads go to R2 while their rows land in production | src/utils/rfqFileStorage.ts:28-49 | Fixed: owner hygiene step and F-28 | F-28, O-22 |
| 22 | Low | `delete-folder` over-deletes `RFQ-…-1x` folders | RfqDetails.tsx:865; OrderDetailsPage.tsx:448; awsS3Storage.ts:94-100; api/s3.js:159, :188-195 | Fixed: prefix normalised to end in `/` (second F-23 exception) | F-23, D-7, DV-14, unit S, S-2, P.2 |
| 23 | Low | `callOps` forwarded a stale `content-length` | forward.ts:16-38 strips it, the old callOps rule did not | Fixed | §2.4 `callOps`, `HOP_BY_HOP`, B-2 |
| 24 | Low | Four acceptance commands could not run as written | rg on mcp-server/src/index.ts (:1285, :1547 matched); `re_[A-Za-z0-9]{8}` matched `failure_response`; no root `vitest`; a background job cannot export variables | Fixed. The F-2 pattern was rewritten without `\|` alternation (it sits in a markdown table) and probed | F-2, F-6, §2.12, §2.13, E-c, G-5 |
| 25 | Low | PLAN deviations missing from §8; apollo-enrich OPTIONS inconsistency; no owner for machine-host code | PLAN.md:198, :231, :250; workers/site/src/preview.ts:52-56; api/marketing.js:605-611 | Fixed: DV-15…DV-19; apollo-enrich `OPTIONS` → `#options` and non-POST → `#method`; `API_MACHINE_HOSTS` built now, empty until Phase 3 | §8, §2.8, F-15, B-2, P A-1, P A-17 |

Also corrected during verification (not raised by the review):

| Item | Change |
|---|---|
| Evidence base | HEAD `3b88e74` → `ca87d83`; citations in files changed by `ca87d83` re-checked: scripts/seo-parity/lib/urls.mjs:254-257 → :250-253, package.json:17-24 → :15-25; G-4 names the current state (wip commit, repair edits in `scripts/seo-parity/**`) |
| A-5 | It said "empty for A's commits", but A's Wave 0 stubs live in `workers/site/src`; it now allows exactly those stub files |
| `GateEnv` | Replaced by the site `Env`, with Phase 2 fields written by A in Wave 0, so G and B share one type |
| Side effect of the review | The critic's tsc probe in `scratchpad/critic-tsc` (scratch only; `node_modules` is a symlink to workers/site's) was left in place; it is not part of any unit |

---

