# microns-site (Cloudflare Worker, Phases 1-2)

`microns-site` serves every public URL of www.micronshub.eu the way Vercel serves it today: the redirect table,
the sitemap routes, `/api/*`, the SEO server-side rendering of `/{lang}` and `/{lang}/*`, and the static build in
`dist/`. Phase 1 runs **only as a preview on `*.workers.dev`** behind Cloudflare Access, with
`X-Robots-Tag: noindex` on every response. Nothing in production uses it. Phase 2 (PLAN.md §5.2) ports `/api/*`:
the site answers emails, files and tracking itself and sends every other endpoint to `microns-ops` over the
service binding `OPS` (section "Phase 2: /api port" below).

The specs live in `docs/migration/`: PLAN.md §5.1, ARCHITECTURE.md §6, §7.1, §17 and §19, SEO_PARITY.md and
INVENTORY.md. Today's Vercel code is the source of truth for behaviour: `middleware.ts`, `middleware/*`,
`vercel.json`, `api/sitemap.js` and `src/components/SEORedirects.tsx`. The Worker imports `middleware/*` and
`api/sitemap.js` unchanged.

## Request flow

Every method takes the same path (`src/index.ts`). Every response passes through `finalise()` exactly once.

| Step | Module | What it does |
|---|---|---|
| 1 | `src/redirects.ts` | 28 redirects, all 308. RD-01…RD-25 come from vercel.json:2-128, byte-exact (RD-12 keeps its mojibake source). RD-26…RD-28 are client-only entries of SEORedirects.tsx, served as 308 (documented deviation AL-001…AL-003). Matches the raw pathname and the NFC-decoded pathname. |
| 2 | `src/sitemap.ts` + `src/compat/vercel-shim.ts` | `/sitemap.xml`, `/sitemap-complete.xml`, `/sitemap-index.xml`, `/sitemap-:lang.xml` and `/api/sitemap` run `api/sitemap.js` unchanged through a `(req, res)` shim. Cache API 1 h, status 200 only. |
| 3 | `src/api/forward.ts` + `src/api/router.ts` | Every other `/api/*` request: the flag `api.forward_to_vercel` (or the var `API_FORWARD_TO_VERCEL`) sends it unchanged to `API_FORWARD_ORIGIN` (the Vercel deployment); otherwise the Phase 2 router answers it (local handler, `microns-ops`, or the forward for paths outside its catalogue). `cf-*` headers, including the Access token, never leave Cloudflare. |
| 4 | `src/seo/handler.ts` (+ `supabase.ts`, `cache.ts`, `clientRoutes.ts`) | Copy of the `middleware.ts` orchestrator. It reads the shell with `env.ASSETS.fetch('/index.html')` and uses a per-isolate `Map` (1 h; 30 s for "no row") plus KV `SEO_CACHE` (positives only, 1 h). It returns `null` exactly where middleware.ts returns `undefined`. `seo.strict_404` is wired but off; while off, misses are logged as `would_404`. |
| 5 | `src/static.ts` | Directory-index emulation for `/laserkritis[/]` and `/zohoverify[/]`, when `DIRECTORY_INDEX_EMULATION` is `"true"`. |
| 6 | `env.ASSETS.fetch` | Serves the file, or the SPA shell with 200 (`not_found_handling: single-page-application`). HEAD reads the asset as GET so it can send `Content-Length` (see deviations). |
| all | `src/preview.ts` | Applies the vercel.json `headers` rules (CORS on `/api/*`, Content-Type on `/assets/*`). Adds `X-Robots-Tag: noindex` on `*.workers.dev`, localhost and `PREVIEW_HOSTNAMES`, never on the production zone. Sends HSTS only on `SITE_ORIGIN` when `HSTS_VALUE` is set. Strips the body on HEAD. |

Errors: a throw in any step answers `500 text/plain`, logged with the step and path. For step 4 and the public
`/sitemap*.xml` URLs, Vercel answers `MIDDLEWARE_INVOCATION_FAILED` / `FUNCTION_INVOCATION_FAILED`, never the
prerendered file or the shell. The one exception is `/api/sitemap`: a throw there is logged and falls through to the
step 3 forward. A sitemap handler that has not ended its response within the 30 s budget gets a 504. A `null` from
step 4 is not an error and continues to steps 5–6 (ARCHITECTURE.md §6.2).

## Files

| Path | Purpose |
|---|---|
| `wrangler.jsonc` | Assets `../../dist` (`html_handling` none, SPA fallback, `run_worker_first`), KV `SEO_CACHE` and `FLAGS` (placeholder IDs), vars, required secrets, `nodejs_compat`; Phase 2: `OPS`, `PRIVATE_FILES`, three rate limits, `/api` vars |
| `src/env.ts` | `Env` bindings and `LOG_PREFIX` (`[microns-site]`) |
| `src/flags.ts` | `getFlag(env, key, fallback)` and `getFlagValue(env, key)` from KV `FLAGS` (`{"enabled": bool, "value": {...}}`) |
| `src/index.ts` | Router (steps 1–6, error policy, HEAD `Content-Length`) |
| `src/redirects.ts` | `REDIRECTS`, `findRedirect`, `matchRedirect` |
| `src/sitemap.ts`, `src/compat/*` | Sitemap routes, Vercel query merge, `(req, res)` shim, ambient type for `api/sitemap.js` |
| `src/api/forward.ts` | `handleApi` (flag check, then router), `forwardToVercel` |
| `src/api/resolve.ts`, `src/api/router.ts` | Phase 2 `/api` catalogue, action resolver and router |
| `src/api/emails.ts`, `src/api/track.ts`, `src/api/ops-client.ts` | Local handlers (lazy `api/emails.js`, `api/marketing.js`) and the `OPS` RPC client |
| `src/seo/*` | SEO handler, Supabase lookups (same REST URLs as middleware.ts), two-tier cache, client-route exemptions for strict 404 |
| `src/static.ts` | Directory index, `hasStaticFile` |
| `src/preview.ts` | `finalise()` |
| `test/*.test.ts` | vitest suites (router, redirects, sitemap, SEO handler, cache, soft 404, offline parity) |
| `test/fixtures/seo/` | `shell.html`, recorded Supabase REST answers (`rest.json`), the 51 offline-parity cases and `record.mjs` |

Related files outside this folder: `scripts/seo-parity.mjs` and `scripts/seo-parity/` (parity tool),
`scripts/seo-parity.allow.json`, `scripts/verify-ssr.sh` (`HOST_B` pairing, Access headers),
`tests/middleware/smoke.mjs`, `tests/e2e/fixtures/access.ts`, `.github/workflows/cf-preview.yml`.

## Run locally

```sh
# once
npm run cf:install                       # npm ci in workers/shared, workers/site, workers/ops, scripts/seo-parity (root: npm ci)
npx vite build                           # at the repo root; the Worker serves ../../dist
# workers/site/.dev.vars (gitignored), one line:
#   SUPABASE_ANON_KEY=<public anon key of project cfjrtmtaitwzggzpkhxi>

cd workers/site
npx wrangler dev --local --port 8787     # local KV; the ops endpoints need `npm run dev:all` (Phase 2 below)
curl -sI http://localhost:8787/en        # 200, X-Seo-Source: db, X-Robots-Tag: noindex
```

Flags are set in local KV with
`npx wrangler kv key put --binding FLAGS seo.strict_404 '{"enabled":true}' --local`.

## Tests and gate commands

| Command (repo root unless noted) | What it checks |
|---|---|
| `npm run cf:typecheck` | Strict `tsc` over `src/` and `test/`. middleware.ts is not imported: it is not strict-clean, so the harness loads it through a computed path. |
| `npm run cf:test` | vitest: the Phase 1 suites (340 tests in 7 files at the Phase 1 close) plus the Phase 2 suites (below). Includes **offline document parity**, which runs middleware.ts and `handleSeo` on the same shell and recorded REST answers for 51 cases and requires byte-identical HTML, status and headers (SEO_PARITY.md §6 row 3 (c)). |
| `npm run cf:smoke` (`node tests/middleware/smoke.mjs`) | Renderer smoke checks. Redirect table: 28 entries, all 308, RD-01…RD-25 equal to vercel.json, RD-12 byte-identical to vercel.json:59, RD-26…RD-28 present in SEORedirects.tsx. Route decisions: middleware.ts `parseRoute` equals the Worker `parseRoute` for the 22 G7 probes, the 51 fixture paths, the 210 prerender routes and the G9/edge paths (323 decisions). No network needed. |
| `npm --prefix scripts/seo-parity test` (or `node --test scripts/seo-parity/test/*.test.mjs`) | Parity tool unit tests (94), offline. Node 22 does not accept a directory argument here; use the npm script or the glob. |
| `bash -n scripts/verify-ssr.sh` | Syntax check |
| `npm run cf:dry` (`wrangler deploy --dry-run --outdir .wrangler/dry --metafile .wrangler/dry/meta.json`) | Bundle and size report; then `npm --prefix workers/site run check-bundle` (Phase 2 bundle guard) |
| `npx wrangler check startup` (in `workers/site`) | Local startup CPU profile |
| `HOST=<preview> bash scripts/verify-ssr.sh` | Gate item 3 |
| `BASE_URL=<preview> npm run cf:e2e` | Gate item 4: installs `@playwright/test@1.56.1` with `--no-save` (no `package.json` or lockfile change) and runs `tests/e2e/seo.spec.ts`. Set `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` for a preview behind Access. Without `BASE_URL` it targets production. First run on a machine: `npx playwright install chromium` |
| `node scripts/seo-parity.mjs --generate-urls ...` then `--base https://www.micronshub.eu --candidate <preview> --urls urls.json` | Gate item 1 (SEO_PARITY.md §5) |

Fixture refresh after content edits, from the repo root:
`set -a; . workers/site/.dev.vars; set +a; NODE_USE_ENV_PROXY=1 node workers/site/test/fixtures/seo/record.mjs`.

## Phase 2: /api port

PLAN.md §5.2. The site answers `/api/emails`, `/api/s3` and the tracking links itself; every other endpoint runs
in `microns-ops` (`workers/ops`), reached over the service binding `OPS` (RPC to the named entrypoint `OpsApi`).
Shared code (the `@vercel/node` shim, rewrite merge, HTTP helpers, auth and storage primitives) lives in
`workers/shared` and is imported by relative path.

### Router (`src/api/router.ts`)

| Step | What it does |
|---|---|
| 0 | `handleApi` (`src/api/forward.ts`): flag `api.forward_to_vercel` on → `forwardToVercel()`, every method, no gate |
| 1 Path | Catalogue lookup (`src/api/resolve.ts`) on the canonical spelling of the path (percent-decoded, dot segments resolved, repeated and trailing slashes removed, lower case, without a `.js`, `.mjs`, `.cjs` or `.ts` extension): every spelling of a catalogue path is resolved, gated and dispatched as the catalogue path, and its handler sees the catalogue path; any other `/api/*` path is forwarded with its body unread |
| 2 Body | Buffered once; more than 4,718,592 bytes → 413 `{"error":"payload_too_large"}` (the rest of the body is read and discarded first, so the client receives the answer) |
| 3 Resolve | Endpoint, function URL (vercel.json rewrites of `/api/track` and `/api/connector-status` merged, request keys win), action with the handler's own precedence |
| 4 Names | The names of the dispatch target only (table below); a missing one answers 500 and logs `api config missing: <NAMES>` |
| 5 Sentinel | Answers the handler gives before any side effect (`#options`, `#method`, `#unknown`, `#unknown-step`, `#throws`) go ungated, as ANON |
| 6 Gate | `applyGate()` (`src/auth/gate.ts`): deny or respond, or allow with the principal and optional overrides of the function URL and body |
| 7 Dispatch | Local handler, `microns-ops`, or the forward (an endpoint whose port is not finished is set to `forward` in `ENDPOINT_TARGETS`) |
| 8 Log | `[microns-site] api endpoint=… action=… actionId=… target=… status=… ms=… principal=… requestId=…` (no body, token or e-mail address) |
| 9 Return | `finalise()` adds the vercel.json CORS headers, noindex and the HEAD handling, as for every answer |

| Public path | Runs in |
|---|---|
| `/api/emails` | site: `api/emails.js` unchanged, through the shared shim, imported on first use, 30 s |
| `/api/s3` | site: files API (`src/api/files.ts`), R2 `microns-private` with legacy S3 fallback |
| `/api/marketing?action=track`, `/api/track` | site: `api/marketing.js` unchanged (track branch), imported on first use, 30 s |
| `/api/marketing` (other actions), `/api/notifications`, `/api/gsc`, `/api/tenders`, `/api/connector-status`, `/api/tender-scan`, `/api/funded-startups`, `/api/scrape-website`, `/api/scrape-company-profile`, `/api/scan-directory` | `microns-ops`: the verified principal, function URL and action travel in the RPC `call`, never in headers; the request reaches ops without `cookie`, `cf-access-*`, `x-microns-*`, `content-length` and hop-by-hop headers |
| `/api/sitemap` | site, router step 2 (Phase 1) |
| any other `/api/*` | forward to `API_FORWARD_ORIGIN` |

| Dispatch target | Names checked per request |
|---|---|
| emails | `RESEND_API_KEY` |
| track | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_ORIGIN` |
| files | `PRIVATE_FILES`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `LEGACY_S3_REGION`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY` |
| ops | `OPS` |
| forward | none (a bad `API_FORWARD_ORIGIN` answers 502) |

Gate decisions check their own names (`src/auth/gate.ts`). Every Phase 2 field of `Env` is optional, so a missing
name fails only the requests that need it.

| Case | Answer of the router |
|---|---|
| Body over 4.5 MiB | 413 `{"error":"payload_too_large"}` |
| A name of the target missing | 500 `text/plain` "Internal Server Error" |
| Handler throws before `res.end()`, gate throws, handler module fails to load | 500 `text/plain`, logged with the request id |
| `OPS` RPC rejects | 500 `text/plain`; for `nest` 504 `{"success":false,"error":"Nesting exceeded the time limit","code":"TIMEOUT"}` |
| Forward upstream fails | 502 `{"error":"upstream"}` |

### Flag `api.forward_to_vercel` (KV `FLAGS`, 60 s edge cache)

| Value | Effect |
|---|---|
| `{"enabled":true}` | every `/api/*` request goes to Vercel |
| `{"enabled":true,"value":{"paths":["/api/gsc"]}}` | only these public paths (exact match) |
| `{"enabled":true,"value":{"hosts":["preview"]}}` | only on preview hosts; `"production"`: only on the others; combines with `paths` (AND) |
| `{"enabled":false}` | nothing goes to Vercel |
| missing, malformed, KV error | var `API_FORWARD_TO_VERCEL`: `"true"` forwards everything, `"false"`/empty/absent nothing, any other value nothing (logged) |

### Run locally

```sh
npm ci && npm run cf:install
cp workers/site/.dev.vars.example workers/site/.dev.vars   # put the public anon key in (see the file)
cp workers/ops/.dev.vars.example workers/ops/.dev.vars
npm run cf:dev:all                                         # site on :8787, microns-ops behind OPS
curl -i -X OPTIONS http://localhost:8787/api/tenders       # answered by the ops handler
# in workers/site: forward every /api request to Vercel instead (vars in .dev.vars are ignored)
npx wrangler dev --local --port 8787 --var API_FORWARD_TO_VERCEL:true
npx wrangler kv key put --binding FLAGS api.forward_to_vercel '{"enabled":true,"value":{"hosts":["preview"]}}' --local
```

### Tests and checks

| Command (repo root unless noted) | What it checks |
|---|---|
| `npm run cf:typecheck:all` | `tsc` for `workers/shared`, `workers/site`, `workers/ops` |
| `npm run cf:test:all` | T1 (vitest in Node) of the three packages. Site Phase 2 suites: `resolve` (every resolution row, and each sentinel answered by the unchanged handler with no outbound call), `router-api` (steps 1-9 with a fake `OPS`), `forward-flag`, `rewrite-crosscheck` (shared merge equals the sitemap merge on all sitemap test inputs), `emails-local`, `track-local` (byte fixtures, the 30 s deadline), `env-api` (names per target; `Env`, router and `wrangler.jsonc` agree), `check-bundle` (which inputs the bundle guard refuses, and its exit status on fixture metafiles) |
| `npm --prefix workers/site run build:dry && npm --prefix workers/site run check-bundle` | Bundle guard: fails on any input from `@aws-sdk`, `@smithy`, `pdf-lib`, `@pdf-lib`, `qrcode`, `pngjs`, `makerjs`, `dxf-parser`, `clipper-lib`, `lib/nesting`, `lib/inventory` or an `api/*.js` handler that runs in ops; prints the sizes |
| `npm run cf:t2` | T2: real workerd (`wrangler dev` with both configs) in front of a local upstream stub; site and ops suites |
| `npm --prefix workers/site run t2:up &` then `npm --prefix workers/site run -s t2:wait` | Long-running harness for the Playwright local mode; `t2:wait` prints the site URL (`.wrangler/t2/urls.json`) |

| T2 file (`test/integration/`) | Role |
|---|---|
| `harness.mjs` | Starts the stub and `wrangler dev -c <site> -c <ops> --local` from generated config copies (stub URLs, dummy secrets, Turnstile test secret, no queue consumer); `up` / `wait` |
| `stub-server.mjs` | Upstream stub: Supabase answers (canned routes, "no rows" by default), forward echo with `x-t2-forwarded: 1`, Access certs; control API under `/__stub/` |
| `stub-client.ts` | `stubRoute`, `stubReset`, `stubCalls`, `mintSupabaseJwt`, `mintAccessJwt` (WebCrypto) |
| `global-setup.mjs` | vitest globalSetup of both Workers' T2 configs; `T2_REUSE=1` uses a running `t2:up` |
| `api-router.t2.ts`, `track.t2.ts`, `startup.t2.ts` | OPTIONS on the routed paths, RPC round trip, forward echo, 413; tracking bytes; startup isolation without `RESEND_API_KEY` |

### Status (2026-10-04, local)

| Check | Result |
|---|---|
| Typecheck (`cf:typecheck:all`) | exit 0 for shared, site and ops |
| T1 (`cf:test:all`) | shared 308, site 1,181 (21 files), ops 171: all green |
| Dry run (`build:dry`) | 3,366.23 KiB, gzip 728.01 KiB; 411 inputs, 0 forbidden (`check-bundle`) |
| `npx wrangler check startup` | 26.9 ms active CPU in an 86.1 ms profile window, locally (limit 1 s) |
| T2 site suites (`test:integration`) | 5 files, 52 tests green (router, tracking, startup, gates, files) |

### Owner items for the site (Phase 2)

| Item | Detail |
|---|---|
| Secrets | `npx wrangler secret put <NAME>` here for every name in `secrets.required` (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `LEGACY_AWS_ACCESS_KEY_ID`, `LEGACY_AWS_SECRET_ACCESS_KEY`, `ACCESS_MACHINE_CLIENT_IDS`); a version upload is refused until each exists |
| Placeholders | `R2_ACCOUNT_ID`, `LEGACY_S3_RFQ_BUCKET`, `LEGACY_S3_ARTICLES_BUCKET`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` in `wrangler.jsonc` (IDs and names, not secrets) |
| Repository secret | `VITE_TURNSTILE_SITE_KEY` for `cf-preview.yml` (the workflow stops early without it) |
| Order | `microns-ops` is deployed first (`wrangler deploy`, not a version upload); then the site preview |
| Rate limits | namespaces `2001`, `2002`, `2003` go into the P0-2 consumer checklist |

## Documented deviations from Vercel

Each one is either on the allow-list or a defensive change that does not change the bytes served. Items marked
"to confirm" depend on the P0-3 live baseline.

- **Redirects.** RD-26…RD-28 (`/csoffert`, `/enoffert`, `/pl/wykończenie-powierzchni`) are server 308s. Today
  Vercel answers 200 with the shell and the client redirects (AL-001…AL-003, approval pending). The two client
  regex patterns stay client-side. Location is the destination plus the request query (to confirm, G9 #15).
  Matching is case-sensitive with no trailing-slash variant (to confirm). The decoded match also redirects
  percent-encoded ASCII (`/dawycen%61`).
- **`/_redirects`.** The file is deleted (P1-2) and the URL answers the shell (AL-004, pending). After the merge,
  Vercel production will also serve the shell there, so capture the P0-3 baseline before merging or mark AL-004
  as pre-merge only.
- **Router error policy.** 500 `text/plain` (not Vercel's error page) on a throw in any step, except
  `/api/sitemap`, which falls through to the forward. 504 after a 30 s function budget (Vercel's maxDuration is
  to be confirmed).
- **Sitemap query merge.** Follows the `vercel dev` reference router (vercel CLI 62.0.0): the request's keys win
  and come first, and components are decoded and re-encoded. Two robustness differences: a malformed escape is
  kept raw, and values split at the first `=`. Production merge behaviour is to be confirmed with G5 probes that
  carry a query.
- **Sitemap and shim details.** The hard-coded `SUPABASE_URL`/`BASE_URL` of api/sitemap.js are kept. No
  ETag/304 handling in the shim. An `Age` header is left on cache hits. HEAD runs as GET. Methods other than
  GET/HEAD skip the cache. The Cache API does nothing on `*.workers.dev`.
- **SEO handler.**
  - The shell comes from `env.ASSETS` (no self-fetch).
  - A shell failure or missing configuration is logged, not silent.
  - KV reads have a 500 ms limit. For service pages, the service page list and content pages, the KV read runs
    inside middleware.ts's single 2.5 s race.
  - KV holds positives only (1 h). "No row" negatives (30 s) and failed lookups (5xx, network error, timeout,
    missing key) never reach KV; where middleware.ts caches them, they stay in the isolate `Map`. Unknown URLs
    therefore cost no KV write. A content-page
    row found under a segment that is neither its `slug` nor its `localized_slug` also stays in the isolate (1 h).
  - KV values are `{data, expires, v}`; a `v` mismatch is a miss. Bump `CACHE_SHAPE_VERSION` in
    `src/seo/supabase.ts` to flush.
  - Isolate Maps are capped (1000 entries per kind, 300 for articles). Keys over 512 bytes are not cached.
  - The `seo.strict_404` read has a 500 ms limit, then uses `SEO_STRICT_404`.
  - With the flag on, S-05 becomes 404 and only S-06/S-07 keep the parent document.
- **HEAD `Content-Length` on static files** (integration fix). Under `wrangler dev` 4.145.0, workerd sends no
  `Content-Length` on a HEAD answer, not even for `env.ASSETS`' own HEAD response. Vercel sends the file size,
  and the parity tool compares it on G8 #10 (`HEAD /occt-import-js.wasm`, 7,604,031 B). On HEAD, step 5–6 now
  reads the asset as GET, counts the bytes as they stream, and sets the header. Re-check on the real preview.
  SEO documents (step 4) get no `Content-Length` on HEAD, on purpose: it is not compared, and Vercel's value is
  unknown.
- **Directory index.** `/laserkritis` and `/laserkritis/` both serve `laserkritis/index.html`. Vercel's behaviour
  for the form without a slash is to be confirmed (H-10, G8 #4–9, G9 #10–11). It is switchable with
  `DIRECTORY_INDEX_EMULATION`.
- **Preview.** `X-Robots-Tag: noindex` on every response on preview hosts.

## Needs the owner

1. **Cloudflare account setup.** Create KV namespaces `SEO_CACHE` and `FLAGS` and commit their IDs in
   `wrangler.jsonc`. Set the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Run `npx wrangler secret put SUPABASE_ANON_KEY` here once;
   this creates `microns-site` as a draft Worker, which `versions upload` needs. Create the Access application and
   service token for the preview hosts. Then dispatch `cf-preview.yml`.
2. **P0-3 baseline / Q1.** www.micronshub.eu answers this build container with a Vercel 429 challenge, so no
   Vercel-vs-Worker run exists yet. The baseline also settles:
   - query forwarding on redirects;
   - case and trailing-slash matching;
   - the RD-12 status;
   - the directory-index form without a slash;
   - the sitemap query merge;
   - whether `s-maxage` passes through Vercel's CDN;
   - the SPA-fallback headers;
   - the function maxDuration;
   - the HSTS value.
3. **Allow-list.** Set `approved_on` for AL-001…AL-004. Runs that use a pending entry are valid but not signable.
4. **verify-ssr.sh content assertions** (`scripts/verify-ssr.sh`). Against the local Worker it fails the same
   7 checks in every run (listed in SEO_PARITY.md §6):
   - The 7 failures are `/nb/tjenester/platarbeid` (the heading is "Platebearbeidings­tjenester"),
     `/it/blog`, `/sv/blogg`, `/da/blog` and `/nb/blogg` (no `blog|articolo|artikel|artikkel` word in the
     body), `/en/contact` raw size 21,444 < 22,000, and `/en/legal-notice` 16,822 < 20,000.
   - For every one of these URLs, the Worker output is **byte-identical** to `middleware.ts` run in Node on the
     same `dist/index.html` and live Supabase. They are therefore properties of today's code and content, not
     Worker bugs, and production most likely fails them too. The raw-size checks also depend on the shell size
     (5,446 B locally). Not confirmable live (Q1).
   - The script's `grep -q` checks read the page through here-strings (`grep -q ... <<<"$html"`), so they no
     longer fail at random under `pipefail` (the earlier SIGPIPE race is fixed).
   - The owner's baseline run against production confirms them; then decide whether to update the assertions.
5. **SEO_CACHE negative writes** (robustness-3): resolved 2026-10-03, nothing to decide. KV holds positives
   only; unknown URLs cost no KV write (see the SEO handler deviations above).
6. **Content (PLAN.md Q24).** The cs `content_pages.localized_slug` values `odvetvi` (industries) and `projekty`
   (our work) differ from the static slugs `prumysl` and `nase-prace` (middleware/slugs.ts:64), which the
   prerender and the published sitemap use; the other 13 languages match. All 9 cs content rows link to the
   database forms, which answer 200 with their own canonical. Vercel serves the same; the parity URL set covers
   both forms.
7. **Docs.** Done 2026-10-03: ARCHITECTURE.md §6.2 and §17, SEO_PARITY.md §1, §2.4, §5 and §6, PLAN.md P1-3,
   P1-4 and the Phase 1 file list, RISKS.md R-42.
8. **Prerender is not deterministic.** jsdom captures third-party tag-manager `<script>` tags with `random=`
   timestamps. Two local builds of the same tree differ in 83 prerendered `index.html` files; the shell and
   assets are identical. The prerendered files are served only where the SEO handler returns nothing
   (G9 #8–9 `/en/index.html`, `/fi/palvelut/index.html`). The parity tool now leaves exactly those elements out
   of F23 there (rule `prerender-tag-scripts`, SEO_PARITY.md §2.4): a run over the 212 prerendered routes of the
   two builds went from 83 failures to 0. A deterministic prerender remains an option.

## Phase 1 exit gate (PLAN.md §5.1), status 2026-10-03

"Local" means against `wrangler dev --local` in the build container, never the preview. Every local result is
repeated on the preview once owner item 1 is done.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Parity diff preview vs Vercel production, 0 differences outside the allow-list | **blocked** | Production answers 429 to this container (Q1), and no preview exists yet (owner item 1). The tool works end to end against the real Worker: a local self-diff (`wrangler dev`, gate profile without G10, 1,074 entries, 4,316 requests per host) gave 1,065 pass, 9 not-applicable, 0 fail (exit 0); the tool now marks such a run as a self-diff, never signable. With G10, the run is invalid because the `/api/*` OPTIONS forward reaches Vercel, which answers 429 (Q1). Offline document parity: 51/51 cases byte-identical to middleware.ts. Known risks for the real run: AL-001…004 pending; HEAD `Content-Length` to re-check on the preview. G9 #8–9 prerender tag scripts are handled by rule `prerender-tag-scripts` (owner item 8). |
| 2 | `dist/` file list identical to the Vercel production build, except the two deleted files | **partial** | A local `npx vite build` of this tree gives 638 files, 213 `index.html`, no "Prerendering skipped". Against the previous local build the list is identical except `_redirects` (`public/index.html` never reached `dist/`: the built shell overwrites it). The shell and all assets are byte-identical; 83 prerendered pages differ only in third-party script tags (owner item 8). The production file list cannot be listed: the Vercel API returns "File tree not found" for git deployment `dpl_6EWQ2aRCJcFtVEYtNXFpPsW67bKq`. Its commit `9afcba8` is an ancestor of this branch, and the build inputs differ from it only in `package.json` scripts and the two deletions. |
| 3 | `HOST=<preview> scripts/verify-ssr.sh` exits 0 | **fail (local: the 7 pre-existing checks only)** | `HOST=http://127.0.0.1:8796 bash scripts/verify-ssr.sh`: exit 1, with 157 checks ok and 7 deterministic failures that are byte-identical to middleware.ts output (owner item 4; SEO_PARITY.md §6). Listed as pre-existing, to be confirmed by the owner's baseline run against production. Not yet run against a preview. |
| 4 | Playwright `seo.spec.ts` green against the preview | **pass (local)** | `BASE_URL=http://127.0.0.1:8796 npm run cf:e2e -- --retries=0`: 8 passed, 0 failed; the same with `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` set (dummy values, which never appear in the output). `package.json` and `package-lock.json` unchanged (`--no-save`). Not yet run against a preview (owner item 1). |
| 5 | Lighthouse on 5 URLs ≥ Vercel | **blocked** | Needs the preview and access to production (Q1). |
| 6 | `tests/middleware/smoke.mjs` green | **pass** | Exit 0: 1,259 assertions ok, 0 fail. Includes the redirect table and the 323 route-decision comparisons; mutation-checked (a changed RD-12 source and a case-insensitive language matcher each fail it). |
| 7 | Size within Workers Paid limits; startup under 1 s | **pass (local)** | `wrangler deploy --dry-run`: 1,897.59 KiB, gzip 476.47 KiB. The Worker size limit is 64 MiB uncompressed on Free and Paid, with no compressed limit; global scope must start within 1 s. Assets: 852 files read from `dist/`; the largest is `occt-import-js.wasm` at 7.6 MB, under the 25 MiB per-file limit. `wrangler check startup`: 16.0 ms active CPU in a 50.3 ms profile window, locally. Re-check startup on the first upload. |
| 8 | Preview hosts send `X-Robots-Tag: noindex` and refuse requests without Access | **partial** | `noindex` is on every response sampled from the local Worker (HTML, 308, XML, assets, HEAD). `preview.ts` treats `*.workers.dev` the same way and is unit-tested. Access is not configured yet (owner item 1). |
| 9 | Vercel production build of the same commit succeeds | **blocked** | The commit is not pushed or built on Vercel yet (git state is owned by the orchestrator). The local `vite build` of this tree succeeds, and the last production deployment (`9afcba8`) is READY. |

Rollback: nothing in production uses this Worker. Run `wrangler delete` and revert the Phase 1 commits; Vercel
ignores `workers/`.
