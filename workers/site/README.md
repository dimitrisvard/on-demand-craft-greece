# microns-site (Cloudflare Worker, Phase 1)

`microns-site` serves every public URL of www.micronshub.eu the way Vercel serves it today: the redirect table,
the sitemap routes, `/api/*`, the SEO server-side rendering of `/{lang}` and `/{lang}/*`, and the static build in
`dist/`. Phase 1 runs **only as a preview on `*.workers.dev`** behind Cloudflare Access, with
`X-Robots-Tag: noindex` on every response. Nothing in production uses it.

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
| 3 | `src/api/forward.ts` | Every other `/api/*` request is proxied to `API_FORWARD_ORIGIN` (Vercel production). `cf-*` headers, including the Access token, are stripped. |
| 4 | `src/seo/handler.ts` (+ `supabase.ts`, `cache.ts`, `clientRoutes.ts`) | Copy of the `middleware.ts` orchestrator. It reads the shell with `env.ASSETS.fetch('/index.html')` and uses a per-isolate `Map` plus KV `SEO_CACHE` (1 h positive, 30 s negative). It returns `null` exactly where middleware.ts returns `undefined`. `seo.strict_404` is wired but off; while off, misses are logged as `would_404`. |
| 5 | `src/static.ts` | Directory-index emulation for `/laserkritis[/]` and `/zohoverify[/]`, when `DIRECTORY_INDEX_EMULATION` is `"true"`. |
| 6 | `env.ASSETS.fetch` | Serves the file, or the SPA shell with 200 (`not_found_handling: single-page-application`). HEAD reads the asset as GET so it can send `Content-Length` (see deviations). |
| all | `src/preview.ts` | Applies the vercel.json `headers` rules (CORS on `/api/*`, Content-Type on `/assets/*`). Adds `X-Robots-Tag: noindex` on `*.workers.dev`, localhost and `PREVIEW_HOSTNAMES`, never on the production zone. Sends HSTS only on `SITE_ORIGIN` when `HSTS_VALUE` is set. Strips the body on HEAD. |

Errors: a throw in step 4, or in step 2 on a public `/sitemap*.xml` URL, answers `500 text/plain`. Vercel answers
`MIDDLEWARE_INVOCATION_FAILED` / `FUNCTION_INVOCATION_FAILED` in these cases, never the prerendered file or the
shell. On `/api/sitemap` a throw is logged and falls through to the step 3 forward. A handler that runs past the
30 s budget gets a 504.

## Files

| Path | Purpose |
|---|---|
| `wrangler.jsonc` | Assets `../../dist` (`html_handling` none, SPA fallback, `run_worker_first`), KV `SEO_CACHE` and `FLAGS` (placeholder IDs), vars, required secret `SUPABASE_ANON_KEY`, `nodejs_compat` |
| `src/env.ts` | `Env` bindings and `LOG_PREFIX` (`[microns-site]`) |
| `src/flags.ts` | `getFlag(env, key, fallback)` from KV `FLAGS` (`{"enabled": bool}`) |
| `src/index.ts` | Router (steps 1–6, error policy, HEAD `Content-Length`) |
| `src/redirects.ts` | `REDIRECTS`, `findRedirect`, `matchRedirect` |
| `src/sitemap.ts`, `src/compat/*` | Sitemap routes, Vercel query merge, `(req, res)` shim, ambient type for `api/sitemap.js` |
| `src/api/forward.ts` | Phase 1 `/api/*` forward |
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
npm run cf:install                       # npm ci in workers/site and scripts/seo-parity (root: npm ci)
npx vite build                           # at the repo root; the Worker serves ../../dist
# workers/site/.dev.vars (gitignored), one line:
#   SUPABASE_ANON_KEY=<public anon key of project cfjrtmtaitwzggzpkhxi>

cd workers/site
npx wrangler dev --local --port 8787     # local KV; /api/* is still forwarded to Vercel production
curl -sI http://localhost:8787/en        # 200, X-Seo-Source: db, X-Robots-Tag: noindex
```

Flags are set in local KV with
`npx wrangler kv key put --binding FLAGS seo.strict_404 '{"enabled":true}' --local`.

## Tests and gate commands

| Command (repo root unless noted) | What it checks |
|---|---|
| `npm run cf:typecheck` | Strict `tsc` over `src/` and `test/`. middleware.ts is not imported: it is not strict-clean, so the harness loads it through a computed path. |
| `npm run cf:test` | vitest: 336 tests in 7 files. Includes **offline document parity**, which runs middleware.ts and `handleSeo` on the same shell and recorded REST answers for 51 cases and requires byte-identical HTML, status and headers (SEO_PARITY.md §6 row 3 (c)). |
| `npm run cf:smoke` (`node tests/middleware/smoke.mjs`) | Renderer smoke checks. Redirect table: 28 entries, all 308, RD-01…RD-25 equal to vercel.json, RD-12 byte-identical to vercel.json:59, RD-26…RD-28 present in SEORedirects.tsx. Route decisions: middleware.ts `parseRoute` equals the Worker `parseRoute` for the 22 G7 probes, the 51 fixture paths, the 210 prerender routes and the G9/edge paths (322 decisions). No network needed. |
| `node --test scripts/seo-parity/test/*.test.mjs` | Parity tool unit tests (59). Node 22 does not accept a directory argument here; use the glob. |
| `bash -n scripts/verify-ssr.sh` | Syntax check |
| `npm run cf:dry` (`wrangler deploy --dry-run --outdir .wrangler/dry`) | Bundle and size report |
| `npx wrangler check startup` (in `workers/site`) | Local startup CPU profile |
| `HOST=<preview> bash scripts/verify-ssr.sh` | Gate item 3 |
| `node scripts/seo-parity.mjs --generate-urls ...` then `--base https://www.micronshub.eu --candidate <preview> --urls urls.json` | Gate item 1 (SEO_PARITY.md §5) |

Fixture refresh after content edits, from the repo root:
`set -a; . workers/site/.dev.vars; set +a; NODE_USE_ENV_PROXY=1 node workers/site/test/fixtures/seo/record.mjs`.

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
- **Router error policy.** 500 `text/plain` (not Vercel's error page) on a throw in the SEO step or on a public
  sitemap URL. 504 after a 30 s function budget (Vercel's maxDuration is to be confirmed).
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
  - Failure negatives (5xx, network error, timeout, missing key) stay in the isolate. Only "no row" negatives
    go to KV, for 30 s.
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
4. **verify-ssr.sh content assertions** (`scripts/verify-ssr.sh`, not changed here). Against the local Worker it
   fails 7 checks deterministically, and it can fail 1 more at random:
   - The 7 failures are `/nb/tjenester/platarbeid` (the heading is "Platebearbeidings­tjenester"),
     `/it/blog`, `/sv/blogg`, `/da/blog` and `/nb/blogg` (no `blog|articolo|artikel|artikkel` word in the
     body), `/en/contact` raw size 21,444 < 22,000, and `/en/legal-notice` 16,822 < 20,000.
   - For every one of these URLs, the Worker output is **byte-identical** to `middleware.ts` run in Node on the
     same `dist/index.html` and live Supabase. They are therefore properties of today's code and content, not
     Worker bugs, and production most likely fails them too. The raw-size checks also depend on the shell size
     (5,446 B locally). Not confirmable live (Q1).
   - The random failure is a race in the script: `set -o pipefail` with `echo "$html" | grep -q` sometimes reads
     a match as a miss (7 in 2,000 runs, measured). It already exists at HEAD.
   - Decide whether to update the assertions and the pipe pattern (for example `grep -q ... <<<"$html"`).
5. **SEO_CACHE negative writes** (robustness-3, open). Each unknown `/{lang}/<seg>` writes 2 KV negatives and
   each unknown blog slug writes 1. The exact change is in the seo-handler report.
6. **Content.** The cs `localized_slug` values `odvetvi`/`projekty` differ from the static slugs
   `prumysl`/`nase-prace`.
7. **Docs** (owned by the orchestrator). Record the router error policy, the KV `v` field and limits, the HEAD
   `Content-Length` rule and the stricter parity window (06:55 UTC) in ARCHITECTURE.md §6.2/§17 and
   SEO_PARITY.md.
8. **Prerender is not deterministic.** jsdom captures third-party tag-manager `<script>` tags with `random=`
   timestamps. Two local builds of the same tree differ in 83 prerendered `index.html` files; the shell and
   assets are identical. The prerendered files are served only where the SEO handler returns nothing
   (G9 #8–9 `/en/index.html`, `/fi/palvelut/index.html`). There, F23 will differ between any two builds, the
   Vercel build and the Cloudflare build included. This needs a rule in the parity tool or a deterministic
   prerender before gate item 1.

## Phase 1 exit gate (PLAN.md §5.1), status 2026-10-02

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Parity diff preview vs Vercel production, 0 differences outside the allow-list | **blocked** | Production answers 429 to this container (Q1), and no preview exists yet (owner item 1). The tool works end to end against the real Worker: a local self-diff (`wrangler dev`, gate profile without G10, 1,074 entries, 4,316 requests per host) gave 1,065 pass, 9 not-applicable, 0 fail (exit 0). With G10, the run is invalid because the `/api/*` OPTIONS forward reaches Vercel, which answers 429 (Q1). Offline document parity: 51/51 cases byte-identical to middleware.ts. Known risks for the real run: AL-001…004 pending; G9 #8–9 non-deterministic prerender (owner item 8); HEAD `Content-Length` to re-check. |
| 2 | `dist/` file list identical to the Vercel production build, except the two deleted files | **partial** | A local `npx vite build` of this tree gives 638 files, 213 `index.html`, no "Prerendering skipped". Against the previous local build the list is identical except `_redirects` (`public/index.html` never reached `dist/`: the built shell overwrites it). The shell and all assets are byte-identical; 83 prerendered pages differ only in third-party script tags (owner item 8). The production file list cannot be listed: the Vercel API returns "File tree not found" for git deployment `dpl_6EWQ2aRCJcFtVEYtNXFpPsW67bKq`. Its commit `9afcba8` is an ancestor of this branch, and the build inputs differ from it only in `package.json` scripts and the two deletions. |
| 3 | `HOST=<preview> scripts/verify-ssr.sh` exits 0 | **fail (blocked on preview)** | Against `wrangler dev` on localhost: exit 1, with 156 checks ok and 7 deterministic failures that are byte-identical to middleware.ts output (owner item 4), plus a random race in the script. Not yet run against a preview. |
| 4 | Playwright `seo.spec.ts` green against the preview | **blocked** | No preview. `@playwright/test` is not a root devDependency; the specs and the Access fixture were only run against local stubs. |
| 5 | Lighthouse on 5 URLs ≥ Vercel | **blocked** | Needs the preview and access to production (Q1). |
| 6 | `tests/middleware/smoke.mjs` green | **pass** | Exit 0: 1,259 assertions ok, 0 fail. Includes the redirect table and the 322 route-decision comparisons; mutation-checked (a changed RD-12 source and a case-insensitive language matcher each fail it). |
| 7 | Size within Workers Paid limits; startup under 1 s | **pass (local)** | `wrangler deploy --dry-run`: 1,897.59 KiB, gzip 476.47 KiB. The Paid limit is 10 MB after compression and the Free limit is 3 MB. Assets: 852 files read from `dist/`; the largest is `occt-import-js.wasm` at 7.6 MB, under the 25 MiB per-file limit. `wrangler check startup`: 16.0 ms active CPU in a 50.3 ms profile window, locally. Re-check startup on the first upload. |
| 8 | Preview hosts send `X-Robots-Tag: noindex` and refuse requests without Access | **partial** | `noindex` is on every response sampled from the local Worker (HTML, 308, XML, assets, HEAD). `preview.ts` treats `*.workers.dev` the same way and is unit-tested. Access is not configured yet (owner item 1). |
| 9 | Vercel production build of the same commit succeeds | **blocked** | The commit is not pushed or built on Vercel yet (git state is owned by the orchestrator). The local `vite build` of this tree succeeds, and the last production deployment (`9afcba8`) is READY. |

Rollback: nothing in production uses this Worker. Run `wrangler delete` and revert the Phase 1 commits; Vercel
ignores `workers/`.
