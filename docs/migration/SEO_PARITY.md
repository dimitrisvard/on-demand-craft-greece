# SEO parity: diff tool, URL set, gates and monitoring

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [README.md](README.md) · [PLAN.md](PLAN.md) · [INVENTORY.md](INVENTORY.md) · [inventory.csv](inventory.csv) · [ARCHITECTURE.md](ARCHITECTURE.md) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [AGENTS.md](AGENTS.md) · [RISKS.md](RISKS.md) · [COSTS.md](COSTS.md)

This file specifies the SEO parity gate the brief asks for (brief §2 item 2, §6, §7 item 5): what is compared, on which URLs, how the Vercel baseline is captured, the tool `scripts/seo-parity.mjs`, the Cloudflare zone settings that keep HTML untouched, and the Google Search Console (GSC) watch after the cutover. Nothing here has been built or run.

| Evidence tag | Meaning |
|---|---|
| `path:line` | This repository at commit `9afcba8` |
| live 2026-09-30 | Read-only re-capture on that date; "live sitemap" = the published `sitemap-complete.xml` blob read that day (6,273,304 B, 2,596 `<loc>`) |
| CF docs (verified 2026-09-27) | Cloudflare documentation checked during planning (plan §15a) |
| CF docs (verified 2026-09-30) | Cloudflare documentation re-read for this file |
| to verify at execution | Platform behaviour not confirmed in the docs; checked on the zone before it matters |

## 1. The gate

**Parity = 0 differences** means: for every entry of the URL set (§3), every compared field (§2) is equal on the base and the candidate after the normalisation rules, or the difference matches an unexpired entry of the allow-list `scripts/seo-parity.allow.json` (§5.6), and the run itself is valid.

| Outcome per URL | Meaning | Counts against the gate |
|---|---|---|
| `pass` | All fields equal after normalisation | No |
| `allowed` | Every difference matches an unexpired allow-list entry exactly (same field, same base and candidate values) | No |
| `transient` | A difference in a database-backed field disappeared on the re-check after 65 min (§2.4) | No (listed in the report) |
| `not-applicable` | The entry cannot be tested in this mode (for example apex or `http://` variants against a `*.workers.dev` preview) | No (listed; tested at the stage named in §3.5) |
| `fail` | Any other difference, or an allow-list entry that has expired | Yes |
| `error` | Network error, timeout, or no response after 3 attempts | Yes, if more than 0.5 % of entries; otherwise listed and re-run |

A run is **invalid** (exit code 3, no verdict) when: the base answers with a challenge (`429` or `x-vercel-mitigated: challenge`, H-1); the candidate answers with a Cloudflare Access login redirect; errors exceed 0.5 %; or the run crosses a volatile window (§2.4). An invalid run is repeated, never signed.

Where the gate applies (phase numbers per [PLAN.md](PLAN.md) §3):

| Stage | Base → candidate | Profile | Required result | Reference |
|---|---|---|---|---|
| Phase 1 iterations | Vercel production `https://www.micronshub.eu` → preview `microns-site.<WORKERS_SUBDOMAIN>.workers.dev` (or `staging-microns-site.<WORKERS_SUBDOMAIN>.workers.dev`) | `gate` | Trend to 0 | P1-8, P1-10 |
| Phase 1 exit | Same | `full` once, then `gate` | 0 unexplained differences | PLAN.md §5.1 gate item 1 |
| Phase 2 exit | Same; the `api` group now exercises the Phase 2 router instead of the Phase 1 forward to Vercel | `gate` | 0 unexplained; tracking URLs unchanged | PLAN.md §5.2, P2-12 |
| Phase 3 go/no-go (S11, C − 1 d) | Baseline re-captured from Vercel (P0-3 refresh) → the production version ID on its preview URL | `full` | 0 unexplained | PLAN.md §6.2 S11 |
| Phase 3 flip (S12, C + 10 min) | S11 snapshot → `https://www.micronshub.eu` (now Cloudflare) | 20-URL smoke list (the sentinel URLs of §10.1) | 0 unexplained | PLAN.md §6.2 S12 |
| Phase 3 apex and wildcard (S13, S14) | S11 snapshot → production | `variants` group | Every hop of every chain equal | H-11, H-13, H-24 |
| Phase 3 observation (S16: C + 1 h, + 6 h, + 24 h, + 48 h) and exit | S11 snapshot → production | `gate` | 0 unexplained (volatile fields per §2.4) | PLAN.md §5.3 gate item 4 |
| Post-cutover, daily C + 1 … C + 14 | S11 snapshot → production | `gate` | 0 unexplained; any failure is handled per PLAN.md §6.5 | §10 |
| Phases 4–6, every `microns-site` production version | Production → the new version's preview URL | `gate` before promotion; `full` for P6-6 prerender removal | 0 unexplained | PLAN.md §5.4 gate item 5, P6-4, P6-6 |
| Phase 5 sitemap move to R2 | Production → preview | `sitemaps` group, then `gate` | Byte-identical sitemaps | INVENTORY.md BKT-sb-sitemaps |
| Phase 7 (optional) | The SEO handler switches from Supabase REST to D1 → the full gate is re-run | `full` | 0 unexplained | PLAN.md §5.7, P7-8 |

Baseline of record: until Phase 3 sign-off it is the Vercel capture (P0-3, refreshed at S11). At S17 a capture of Cloudflare production becomes the reference for Phases 4–7; allow-list entries that only existed because Vercel differed then expire.

## 2. Compared fields and normalisation

### 2.1 Per-URL fields

| # | Field | Extraction | Normalisation | Rule |
|---|---|---|---|---|
| F1 | Status | GET status, redirects not followed (`redirect: 'manual'`) | none | Equal |
| F2 | Redirect chain | Each hop: status + `Location` resolved to an absolute URL; up to 5 hops; hops into `/api/*` or off-site hosts are recorded, never requested | Candidate origin replaced by the base origin before comparing | Equal hop by hop |
| F3 | Final URL | Last URL of the chain | As F2 | Equal |
| F4 | HEAD | HEAD status and the header set of F5–F12 | As for GET; HEAD body must be empty | Equal to base HEAD |
| F5 | `Content-Type` | Header | Lowercase; spaces around `;` removed | Equal (`text/html; charset=utf-8` on SEO responses, middleware.ts:673) |
| F6 | `Cache-Control` | Header | Trimmed only | Byte-equal (`public, max-age=0, must-revalidate` on SEO responses, middleware.ts:674; `public, max-age=3600, s-maxage=3600` on sitemaps, api/sitemap.js:393) |
| F7 | `Vary` | Header | Tokens lowercased, as a set | Equal set |
| F8 | `Strict-Transport-Security` | Header | Directives lowercased, as a set | Equal set (H-24) |
| F9 | `X-Seo-Source` | Header, presence and value (`db`, `i18n`, `none`; middleware.ts:675) | none | Equal; absent on both for non-SEO paths |
| F10 | `X-Robots-Tag` | Header | Lowercase | Preview role: candidate must send exactly `noindex` (P1-7); production role: equal to base (expected absent; the baseline confirms) |
| F11 | Other response headers | Every header not in the ignore list (§2.2) | Names lowercased; values trimmed | Equal (deny by default: a new header such as `Speculation-Rules` fails) |
| F12 | `OPTIONS` on `/api/*` | Status, `Access-Control-Allow-*`, `Allow` | As F11 | Equal (vercel.json:164-171; H-28) |
| F13 | `<html lang>` | Attribute | none | Equal |
| F14 | `<title>` | Text of every `<title>` | Entities decoded, whitespace collapsed | Equal list (count included) |
| F15 | Meta description | `meta[name=description]` content | As F14 | Equal list |
| F16 | Canonical | Every `link[rel=canonical]` href, in document order | none (absolute `https://www.micronshub.eu…` on both hosts, middleware/types.ts:64) | Equal list |
| F17 | Hreflang | Multiset of (`hreflang` lowercased, `href`) | none | Equal set, order-insensitive (15 links on static pages: 14 + `x-default`) |
| F18 | `og:*` and `twitter:*` | Map property → list of `content` | As F14 | Equal per property; property order ignored |
| F19 | Robots meta | `meta[name=robots]` and `meta[name=googlebot]` | Tokens lowercased and trimmed, as a set | Equal (`index,follow,max-image-preview:large,max-snippet:-1`, middleware/inject.ts:62) |
| F20 | JSON-LD | Every `script[type="application/ld+json"]`: `JSON.parse`, then canonical JSON (object keys sorted recursively, arrays keep their order, no whitespace) | A block that does not parse is compared as whitespace-collapsed text and flagged `jsonld_invalid` | Equal multiset of blocks, block order ignored (includes the static `Organization` block of index.html:30) |
| F21 | `#seo-content` text | Inner HTML of `article#seo-content` (middleware/inject.ts:90) without `script`/`style`, tags stripped, entities decoded | Whitespace collapsed and trimmed | Equal; `lang` attribute equal |
| F22 | `#seo-content` links | Multiset of `a[href]` and `img[src]` inside the article | Origin-normalised | Equal multiset |
| F23 | Normalised document | Whole body | Whitespace collapsed; asset hashes per F25 | Equal; this catches edge injections (beacons, rewritten e-mail addresses, rewritten script or font tags) that F13–F22 do not look at |
| F24 | Raw body hash | SHA-256 of the decoded body | none | Equal for XML, TXT and binary files; recorded for HTML |
| F25 | Hashed assets | `/assets/<name>-<hash>.<ext>` in `src`, `href`, `Link` | Default none; `--normalise-asset-hashes` replaces the hash with `[hash]` and lists every pair in the report | Equal. P0-7 proves identical `dist/` lists; the flag is used only if P0-7 shows drift that is build-environment-only |
| F26 | Sitemap XML | Root element, `<loc>` set, per-`<loc>` `lastmod`, `changefreq`, `priority`, alternates | As F24 first; parsed only when F24 differs | Equal (live mode); §2.4 in snapshot mode |

3xx response bodies and `Set-Cookie` values are recorded, not gated; `Set-Cookie` names are compared, except `CF_Authorization` on a preview candidate. On a production candidate a `__cf_bm` cookie is a failure: it indicates a bot feature that §8 requires off.

### 2.2 Headers ignored (recorded, not gated)

`date`, `age`, `server`, `via`, `connection`, `keep-alive`, `transfer-encoding`, `content-length` (the decoded body is compared instead), `content-encoding`, `etag`, `last-modified`, `accept-ranges`, `alt-svc`, `nel`, `report-to`, `server-timing`, `cf-ray`, `cf-cache-status`, other `cf-*`, `x-vercel-*`, `x-matched-path`. The list lives in the tool and can only grow through a reviewed change.

### 2.3 Request rules

| Rule | Detail |
|---|---|
| Methods | GET and HEAD for every entry; HEAD only for `/occt-import-js.wasm` (7,604,031 B); OPTIONS only for `/api/*`. No POST, PUT, PATCH or DELETE is ever sent. GET on `/api/*` only for `/api/sitemap` (read-only) and for the apex tracking URL of G9 #19, where only the first hop (the apex redirect) is requested |
| Pairing | The base and candidate requests for one entry are sent back to back, so both sides read Supabase within seconds of each other |
| User agent | `micronshub-seo-parity/1.0 (owner-run parity check)`; the SEO handler does not sniff user agents (middleware.ts:414-419) |
| Concurrency | 8 entries in flight (`--concurrency 8`); about 2,200 requests per host for the `gate` profile |
| Access | `CF-Access-Client-Id` / `CF-Access-Client-Secret` (CF docs, verified 2026-09-27) are sent only to the candidate host, never to the base, redirect targets or third parties; values are never written to any output |
| Retries | 3 attempts with back-off on network errors and 5xx; the report shows the attempt count |

### 2.4 Time-varying content

The renderers read no clock (no `Date` use in middleware/): the only `Date.now()` calls in middleware.ts are cache expiry (middleware.ts:114-398), and article JSON-LD dates come from the database row (middleware.ts:642-645). What does change over time:

| Source | Effect | Rule |
|---|---|---|
| Content pipeline 07:00–09:00 UTC (article 07:00, `process-article-queue` every 5 min, translation 08:00, link fixing 08:30, sitemap 09:00; live 2026-09-30) | New articles, changed bodies, new hreflang entries, new sitemap blob | Runs happen between 10:05 and 06:55 UTC; the tool refuses to start inside the window and marks the run invalid if it crosses 09:00 or 00:00 UTC |
| Per-isolate caches of 1 h (30 s negative) on Vercel (middleware.ts:44, :193) and Map + KV `SEO_CACHE` 1 h on the Worker | A row edited within the last hour can differ between hosts | A database-backed field difference (F9, F14–F22 with `X-Seo-Source: db` on either side) is re-checked after 65 min (`--recheck-after 3900`); gone = `transient`, still there = `fail` |
| Supabase fetch timeout 2.5 s (middleware.ts:194) | One side falls back to `i18n` | Same re-check |
| `/sitemap.xml` `<lastmod>` = request date (api/sitemap.js:378) | Differs across midnight UTC | Same-day window rule above |
| Snapshot mode (candidate compared with a stored snapshot) | Articles published since the capture | "Volatile" fields compare as base ⊆ candidate: sitemap `<loc>` set, `lastmod` values, blog index article list, blog hreflang sets; all other fields exact. New URLs are listed, not compared |

## 3. URL set

### 3.1 Groups and counts

| Group | Entries (`gate`) | How the list is generated | Notes |
|---|---|---|---|
| G1 Prerender routes | 210 | The 15 route shapes of vite.config.ts:29-50 built from the `SLUGS` map at vite.config.ts:10-25 (14 languages); the generator asserts 210 unique paths | All shadowed by the SEO handler in production (H-8); all 210 are in the live sitemap |
| G2 `service_pages` | 98 → 0 new | Supabase REST with the anon key: `service_pages?select=language,slug&status=eq.published`; URL = `localizedPath()` of middleware/slugs.ts:186 (`index` → services index, else service detail) | 7 slugs × 14 (live 2026-09-30); all 98 URLs are already in G1, the generator fails if one is not |
| G3 `content_pages` | 126 → 42 new | `content_pages?select=language,slug,localized_slug&status=eq.published`; `home` → `/{lang}`, `blog` → `/{lang}/{blog}`, otherwise `/{lang}/` + `localizedContentSlug()` (middleware/slugs.ts:169); the sitemap rule "`localized_slug`, else `slug`" (api/sitemap.js:126) is applied too and both URLs are kept if they differ | 9 slugs × 14 (live 2026-09-30). New: `education`, `legal-notice`, `privacy-policy` × 14, `cs` with localised slugs `vzdelavani`, `pravni-informace`, `zasady-ochrany-osobnich-udaju` (live sitemap) |
| G4 Articles | 700 (`full`: 2,344) | From `/sitemap-complete.xml` of the base: per language, sort the article `<loc>` values by SHA-256 of `seed + "\n" + loc` and take the first 50; seed `micronshub-parity-v1`, recorded in `urls.json` | Every language has at least 158 published articles (live 2026-09-30); the sample only changes where articles were added or removed |
| G5 Sitemaps | 20 | 17 public URLs from the rewrites at vercel.json:130-145 and the handler switch at api/sitemap.js:401-410: `/sitemap.xml`, `/sitemap-complete.xml`, `/sitemap-index.xml`, `/sitemap-{lang}.xml` × 14; plus `/api/sitemap` (direct function path); plus 2 probes: `/sitemap-xx.xml` (unsupported language → 404, api/sitemap.js:337-339) and `/sitemap-enx.xml` (the language is read with `/lang=([a-z]{2})/i`, api/sitemap.js:334, so today it serves the `en` blob) | §9 |
| G6 Redirects | 32 | 25 sources of vercel.json:2-128; 3 client-only entries (`/csoffert`, `/enoffert`, `/pl/wyko%C5%84czenie-powierzchni`; src/components/SEORedirects.tsx:39-43, :57); 2 samples per client regex (src/components/SEORedirects.tsx:66, :73): `/frdevis`, `/ESorcamento`, `/en/frdevis`, `/de/PLwycena` | The mojibake source RD-12 (vercel.json:59) is sent as the percent-encoded bytes of its source string; its baseline status decides the expectation. Client-only entries and pattern samples: baseline 200 (SPA shell) |
| G7 Soft-404 probes | 22 | 11 classes × 2 languages (`en`, `fi`), fixed paths in §7.1 | `fi` exercises non-ASCII slugs (`cnc-työstö`) and `blogi` |
| G8 Special files | 22 | Fixed list, §3.4 | |
| G9 Host and path variants | 24 | Fixed list, §3.5 | 9 of them are `not-applicable` against a preview |
| G10 `/api/*` OPTIONS | 14 | The 12 endpoints in `api/` plus the aliases `/api/track` and `/api/connector-status` (vercel.json:150-157) | OPTIONS only; in Phase 1 answered through the forward to Vercel (PLAN.md P1-3) |
| **Total** | **1,086** (`gate`) · **2,730** (`full`) | | `full` = all 2,596 live sitemap URLs + the 134 entries of G5–G10 |

Excluded on purpose: `on-demand-craft-greece.vercel.app` (duplicate Vercel host, live 2026-09-30); write actions of any kind; authenticated app pages beyond the probes in G9 (they are the same SPA shell).

### 3.2 Profiles

| Profile | Content | Used for |
|---|---|---|
| `gate` | G1–G10 with the 700-article sample | Every iteration and every stage marked `gate` in §1 |
| `full` | G1–G10 with all articles | Baseline capture (P0-3), Phase 1 exit, S11, P6-6, Phase 7 |
| `sitemaps`, `redirects`, `variants`, `api` | One group each | Targeted re-runs |

### 3.3 Redirect expectations

| Entries | Baseline (today) | Candidate from Phase 1 | Allow-list |
|---|---|---|---|
| 25 server redirects | 308 to the destination in vercel.json (Vercel `permanent: true`; H-11) | 308, same `Location` | none |
| 3 client-only entries | 200 SPA shell, then a client `navigate(replace)` (src/components/SEORedirects.tsx:188) | 308 to the same destination (PLAN.md P1-5) | AL-001…AL-003 |
| 4 pattern samples | 200 SPA shell, client redirect | 200 (the patterns stay client-side unless P1-5 ports them; if ported, entry AL-005 is added before the run) | none by default |
| `/deorcamento?utm_source=parity` (G9) | 308, query preserved or not as the baseline shows | Same | none |

### 3.4 Special files (G8)

| # | Path | Source | Check |
|---|---|---|---|
| 1–2 | `/robots.txt`, `/robots-ai.txt` | public/ | F24 byte-equal (§9) |
| 3 | `/indexnow_key.txt` | public/indexnow_key.txt | F24 byte-equal; the key value (secret `INDEXNOW_KEY`) is never printed |
| 4–7 | `/zohoverify/`, `/zohoverify/index.html`, `/zohoverify/verifyforzoho.html`, `/zohoverify/verifyforzoho.txt` | public/zohoverify/ | The directory form tells whether P1-3 step 5 (directory-index emulation) is needed |
| 8–9 | `/laserkritis/`, `/laserkritis/index.html` | public/laserkritis/index.html | As above |
| 10 | `/occt-import-js.wasm` | public/ | HEAD only: status, `Content-Type`, `Content-Length` |
| 11 | `/occt-import-js.js` | public/ | F24 |
| 12 | `/index.html` | built shell | F23, F24 |
| 13 | `/cookie-consent.html` | public/ | Kept until Phase 6 (PLAN.md §7b) |
| 14 | `/_redirects` | public/_redirects (deleted in P1-2) | Allow-list AL-004 |
| 15–19 | `/logo.png`, `/logo2.png`, `/favicon.ico`, `/favicon2.ico`, `/placeholder.svg` | public/ | F24 |
| 20 | Default `og:image` under `/lovable-uploads/` | middleware/types.ts:65 | F24 |
| 21–22 | The entry `/assets/*.js` and `/assets/*.css` named in the shell | dist/assets/ | F5 (`application/javascript; charset=utf-8`, `text/css; charset=utf-8` per vercel.json:173-183), F24 |

### 3.5 Host and path variants (G9)

| # | Request | What it pins down | Preview run |
|---|---|---|---|
| 1 | `/` | 200 shell, no canonical (index.html:17) | tested |
| 2 | `/EN` | Uppercase language (H-9) | tested |
| 3–4 | `/en/`, `/en/services/` | Trailing slash normalised by the handler (middleware.ts:338); Vercel-level behaviour unknown (H-10) | tested |
| 5 | `/en//services` | Double slash (middleware.ts:342) | tested |
| 6 | `/en/services?utm_source=parity` | Query ignored for routing and canonical | tested |
| 7 | `/de/services` | English slug under another language (middleware/slugs.ts:85-88) | tested |
| 8–9 | `/en/index.html`, `/fi/palvelut/index.html` | The handler returns nothing (unknown segment), so the prerendered file, if the build produced it (Q15, P0-7), is the answer on both platforms; otherwise the shell | tested |
| 10–11 | `/zohoverify`, `/laserkritis` | Directory without slash | tested |
| 12 | `/zz-parity-404` | Unknown non-language path | tested |
| 13 | `/services` | Unprefixed legacy route (200 shell, client redirect) | tested |
| 14 | `/reset-password` | No route today (H-22) | tested |
| 15 | `/deorcamento?utm_source=parity` | Query on a redirect | tested |
| 16–18 | `https://micronshub.eu/`, `https://micronshub.eu/en/services`, `https://micronshub.eu/logo.png` | Apex redirect status, path and query (H-11, H-24); e-mails embed the apex logo | not-applicable → S13 |
| 19 | `https://micronshub.eu/api/marketing?action=track&parity=1` | Apex redirect of the tracking URL embedded in sent e-mails (H-14); the hop into `/api/*` is recorded, never requested | not-applicable → S13 |
| 20–21 | `http://www.micronshub.eu/en`, `http://micronshub.eu/en` | HTTP → HTTPS chain, HSTS | not-applicable → S13 |
| 22–23 | `https://laserkritis.micronshub.eu/en`, `https://laserkritis.micronshub.eu/` | Tenant host keeps the Microns SEO body and `www` canonical (H-13, PLAN.md Q9) | not-applicable → S14 |
| 24 | `https://zz-parity-probe.micronshub.eu/en` | Wildcard behaviour for an unknown label | not-applicable → S14 |

## 4. Baseline capture (P0-3)

| Step | Action | Owner | Done when |
|---|---|---|---|
| B1 | Q1 answered; for the capture window only, a Vercel Firewall rule that exempts the capture IP, or Attack Challenge Mode paused (H-1; what the current Vercel plan offers is read at P0-4). Which one was used is recorded | Dimitris | A test GET of `/en` from the capture machine returns 200 without `x-vercel-mitigated` |
| B2 | Vantage point: the owner's laptop (residential IP) or an allow-listed runner; Node version pinned per P0-7; honest user agent (§2.3); concurrency 8 | Dimitris | Machine ready |
| B3 | Content freeze for the window: no dashboard edits to `service_pages`, `content_pages` or articles; start after 10:05 UTC | Dimitris | Window agreed |
| B4 | `node scripts/seo-parity.mjs --generate-urls --base https://www.micronshub.eu --profile full --out urls.json` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the environment | Claude supplies, Dimitris runs | `urls.json` holds 2,730 entries, the 700-article sample flagged for the `gate` profile; generator assertions pass |
| B5 | Capture A: `--capture --base https://www.micronshub.eu --urls urls.json --snapshot <dir>/A --concurrency 8` (GET + HEAD, OPTIONS on `/api/*`, manual redirects, all headers, raw HTML/XML/TXT) | Dimitris | Exit 0; error rate < 0.5 %; no challenge responses |
| B6 | Capture B, at least 65 min after A; then `--snapshot <dir>/A --candidate snapshot:<dir>/B` (self-diff) | Dimitris | The self-diff lists the noise floor: every field that differs between two captures of the same production. Any such field outside §2.4 is investigated before Phase 1 relies on it |
| B7 | Store A, B and the self-diff outside git (private storage), record the date and the SHA-256 of `A/manifest.json` in the PLAN.md §2 gate log; remove the Vercel exemption | Dimitris | Phase 0 gate item 4 |
| B8 | Re-capture at S11 (`full`) and, immediately before S12, a `gate` capture | Both | Snapshots dated; the S12 comparison uses the latest |

The baseline answers these open points; each answer is copied into [PLAN.md](PLAN.md) §2 evidence:

| Question | Read from | Used by |
|---|---|---|
| Apex → `www` status and whether path and query are kept (Vercel `redirectStatusCode: null`, live 2026-09-30) | G9 16–19 | Single Redirect Rule (S13) |
| HTTP → HTTPS chain and HSTS value | G9 20–21, F8 on all | §8 rows 22–23 |
| Trailing and double slash handling before the middleware | G9 3–5 | P1-4 (H-10) |
| `/zohoverify/` and `/laserkritis/` directory index | G8 4–9, G9 10–11 | P1-3 step 5 |
| Status of the RD-12 mojibake source | G6 | P1-5 |
| Default response headers on Vercel (HSTS, `X-Content-Type-Options`, others) | F11 on all | §8 |

## 5. Diff tool: `scripts/seo-parity.mjs`

Node script (Node version per P0-7), no browser. It parses HTML with an HTML5 parser and XML with a streaming parser (dev dependencies, never regular expressions for HTML), and it imports middleware/slugs.ts through esbuild, as tests/middleware/smoke.mjs:24-65 does, so that URLs are built with the same slug maps as the handler.

### 5.1 Modes

| Mode | Invocation | Output |
|---|---|---|
| Generate URL list | `--generate-urls --base <origin> [--profile gate\|full] [--seed <s>] --out <file>` | `urls.json` |
| Capture | `--capture --base <origin> --urls <file> --snapshot <dir>` | Snapshot directory |
| Live vs live | `--base <origin> --candidate <origin> --urls <file> --out <dir>` | Report |
| Snapshot vs live | `--snapshot <dir> --candidate <origin> --out <dir>` (the URL list comes from the snapshot) | Report |
| Snapshot vs snapshot | `--snapshot <dir> --candidate snapshot:<dir> --out <dir>` | Report (self-diff, CI without network access to the base) |

### 5.2 Flags

| Flag | Default | Meaning |
|---|---|---|
| `--base <origin>` | — | Reference host, for example `https://www.micronshub.eu` |
| `--candidate <origin\|snapshot:dir>` | — | Host under test, or a second snapshot |
| `--candidate-role preview\|production` | `preview` if the host ends in `.workers.dev` or is listed in the environment variable `PREVIEW_HOSTNAMES` | Selects the F10 rule and the `__cf_bm` rule |
| `--urls <file>` | from `--snapshot` | URL list |
| `--snapshot <dir>` | — | Read (compare modes) or write (`--capture`) a snapshot |
| `--allow <file>` | `scripts/seo-parity.allow.json` | Allow-list |
| `--concurrency <n>` | 8 | Entries in flight |
| `--access-client-id <id>`, `--access-client-secret <secret>` | env `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Access service token for the candidate. Prefer the environment: command-line values are visible in the process list |
| `--out <dir>` | `./parity-out/<run_id>` | Report directory |
| `--profile`, `--only <group>` | `gate`, all groups | §3.2 |
| `--seed <s>` | `micronshub-parity-v1` | Article sample seed |
| `--recheck-after <s>` | 3900 | Re-check delay for database-backed differences (§2.4); `0` disables |
| `--normalise-asset-hashes` | off | F25 |
| `--max-hops <n>`, `--timeout <ms>` | 5, 30000 | Redirect chain limit, per-request timeout |

### 5.3 Inputs and outputs

| Item | Content |
|---|---|
| `urls.json` | `{ "version", "generated_at", "seed", "profile", "sources": { "sitemap_sha256", "service_pages", "content_pages" }, "entries": [ { "id", "group", "url", "methods", "expect" } ] }` |
| Snapshot | `manifest.json` (tool version, run times, base, user agent, vantage type, bypass method, URL-list SHA-256), `urls.json`, `results.ndjson` (one line per request: URL, method, status, chain, response headers, body SHA-256 and length, extracted F13–F26), `raw/<sha256>.gz` (HTML, XML, TXT bodies, content-addressed). No request headers and no Access values are stored |
| `report.json` | Run metadata, summary counts, one result per entry with its differences |
| `report.md` | Human summary for the gate log (§5.5) |
| `diffs/<id>.diff` | Unified diff of the normalised documents (F23) for failures, first 200 lines |

`report.json` excerpt (shape only; values are illustrative):

```json
{
  "run_id": "2026-10-13T10:32:05Z-3f9c",
  "base": "https://www.micronshub.eu",
  "candidate": "https://microns-site.<WORKERS_SUBDOMAIN>.workers.dev",
  "candidate_role": "preview",
  "profile": "gate",
  "seed": "micronshub-parity-v1",
  "summary": { "entries": 1086, "pass": 1071, "allowed": 4, "transient": 2, "not_applicable": 9, "fail": 0, "error": 0 },
  "results": [
    { "id": "G6-026", "url": "/csoffert", "outcome": "allowed",
      "diffs": [ { "field": "F1", "base": 200, "candidate": 308, "allow": "AL-001" },
                 { "field": "F2", "base": [], "candidate": [ [308, "https://www.micronshub.eu/cs/nabidka"] ], "allow": "AL-001" } ] },
    { "id": "G4-0412", "url": "/de/blog/<slug>", "outcome": "transient",
      "diffs": [ { "field": "F21", "base_sha256": "1a2b…", "candidate_sha256": "9f8e…", "recheck": "equal after 3900 s" } ] }
  ]
}
```

### 5.4 Exit codes

| Code | Meaning |
|---|---|
| 0 | Valid run, 0 unexplained differences |
| 1 | Valid run, at least one `fail` (including an expired allow-list entry) |
| 2 | Usage or input error: bad flags, unreadable URL list or snapshot, allow-list that does not validate |
| 3 | Invalid run: challenge from the base, Access login redirect from the candidate, error rate above 0.5 %, or a volatile window crossed (§1, §2.4) |

### 5.5 Markdown report excerpt

Illustrative excerpt (format only; the numbers are not results):

```markdown
# SEO parity report 2026-10-13T10:32Z
Base https://www.micronshub.eu · Candidate https://microns-site.<WORKERS_SUBDOMAIN>.workers.dev (preview)
Profile gate · 1,086 entries · 2,188 requests per host · seed micronshub-parity-v1 · window 10:32–10:41 UTC
Result: PASS (0 unexplained differences) · exit 0

| Outcome | Entries |
|---|---|
| pass | 1,071 |
| allowed | 4 |
| transient (re-check equal) | 2 |
| not-applicable (S13/S14) | 9 |
| fail | 0 |
| error | 0 |

## Allowed differences
| Entry | URL | Field | Base | Candidate | Expires |
|---|---|---|---|---|---|
| AL-001 | /csoffert | F1/F2 | 200 | 308 → /cs/nabidka | 2027-01-31 |
| AL-004 | /_redirects | F5/F24 | 200 text/plain | 200 text/html (shell) | 2027-01-31 |

## Failures
None.
```

A failure section lists, per entry, the field, both values (long values as SHA-256 plus length), the re-check result and the path of the diff file.

### 5.6 Allow-list `scripts/seo-parity.allow.json`

The file is committed (public repository): justifications are plain text, never secrets.

```json
{
  "version": 1,
  "entries": [
    {
      "id": "AL-001",
      "url": "/csoffert",
      "match": "exact",
      "field": "response",
      "expected": { "base": { "status": 200 }, "candidate": { "status": 308, "location": "/cs/nabidka" } },
      "justification": "Client-only redirect becomes a server 308 (PLAN.md P1-5; INVENTORY.md RD-26).",
      "applies_to": ["preview", "production"],
      "expires": "2027-01-31",
      "approver": "Dimitris",
      "approved_on": "YYYY-MM-DD"
    }
  ]
}
```

| Key | Rule |
|---|---|
| `url`, `match` | `exact` path, `glob`, or `regex` (anchored); `host` optional |
| `field` | One field ID of §2.1, or `response` (all fields of that URL), which is allowed only when the expected candidate status differs from the base status (a redirect or a 404 has no comparable document) |
| `expected` | The exact base and candidate values; a difference with other values still fails |
| `justification`, `approver`, `approved_on` | Required; approver is Dimitris |
| `expires` | Required; at most 120 days after approval; an expired entry makes its difference a `fail` |
| Forbidden | `field: "*"`, entries without a URL, field-level entries on F6 or F9 for SEO paths (the brief requires those identical) |

Initial entries (Phase 1):

| ID | URL | Field | Base → candidate | Reference |
|---|---|---|---|---|
| AL-001 | `/csoffert` | `response` | 200 → 308 `/cs/nabidka` | PLAN.md P1-5; INVENTORY.md RD-26 |
| AL-002 | `/enoffert` | `response` | 200 → 308 `/en/quote` | RD-27 |
| AL-003 | `/pl/wyko%C5%84czenie-powierzchni` | `response` | 200 → 308 `/pl/uslugi/wykonczenie-powierzchni` | RD-28 |
| AL-004 | `/_redirects` | F5, F23, F24 | 200 text file → 200 SPA shell | PLAN.md P1-2; H-3 |
| AL-005 (only if P1-5 ports the patterns) | the 4 pattern samples | `response` | 200 → 308 | INVENTORY.md RD-P1, RD-P2 |
| AL-1xx (after Q5) | soft-404 probes S-01…S-09 | `response` | 200 → 404 | §7 |

## 6. Extensions to existing checks

| Check | Change (Phase 1) | Gate use |
|---|---|---|
| `scripts/verify-ssr.sh` | One request wrapper replaces the 11 `curl` calls (scripts/verify-ssr.sh:41, :75, :234, :266, :275, :283, :293, :316, :329, :362, :373). When `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are set and the target host equals the host under test, it adds the two Access headers and drops `-L`, so the headers can never be forwarded to another host on a redirect. New `HOST_B`: every check runs against `HOST` and `HOST_B`, the per-check result lines are written to two files and compared with `diff`; any failed check or differing line exits 1. `HOST` default stays `https://www.micronshub.eu` (scripts/verify-ssr.sh:22); user agent unchanged (:21); the script never echoes headers | `HOST=<preview> scripts/verify-ssr.sh` green (PLAN.md §5.1 item 3); `HOST_B` pairing at S11 |
| `tests/e2e/seo.spec.ts` + `playwright.config.ts` | `BASE_URL` selects the host (playwright.config.ts:8). Access headers are added by a fixture with `context.route()` only for requests to the `BASE_URL` host. `extraHTTPHeaders` is not used, because it sends the headers with every request, including third-party hosts the shell loads (fonts, tag manager; index.html:42-84). The test at tests/e2e/seo.spec.ts:37-42 expects `<urlset` from `/sitemap.xml`, but `/sitemap.xml` serves a `<sitemapindex>` (api/sitemap.js:377-389), so it fails against production today; change it to expect `<sitemapindex` and add the `<urlset` assertion for `/sitemap-complete.xml` (test-only change) | Green on production and on the preview (PLAN.md §5.1 item 4) |
| `tests/middleware/smoke.mjs` | Add the Worker modules to the esbuild bundle (same pattern as smoke.mjs:47-65): (a) redirect table has 28 entries, all 308, RD-12 source byte-identical to vercel.json:59; (b) route decisions for every G7 probe equal between `parseRoute` in middleware.ts:334-346 and the Worker copy; (c) offline document parity: `middleware.ts` and `workers/site/src/seo/handler.ts` run against the same shell (`dist/index.html`) and the same recorded Supabase REST responses (captured once with the anon key for the fixture URLs; stubbed `fetch` and `env.ASSETS`) and must return byte-identical HTML and headers for 30 fixture URLs | Green (PLAN.md §5.1 item 6); runs in CI without network |
| Lighthouse | 5 URLs, mobile preset, 3 runs per host interleaved from the same machine; score = median; candidate ≥ base on each URL (PLAN.md §5.1 item 5); a URL that misses by 3 points or less is re-run 5 times and the median of 5 decides; LCP, CLS, TBT and TTFB are reported alongside. Access: a temporary Access Bypass policy for the runner's single IP during the run, because `--extra-headers` would send the service token to third-party origins too | Gate item 5 |

Lighthouse URLs:

| # | URL | Why |
|---|---|---|
| 1 | `/en` | Home: largest SSR body (scripts/verify-ssr.sh:275-282 expects at least 22,000 B) and the hero preload |
| 2 | `/de/dienstleistungen/cnc-bearbeitung` | Non-English service detail |
| 3 | `/en/industries` | Image-heavy (at least 10 Unsplash images, scripts/verify-ssr.sh:293-300) |
| 4 | `/fr/devis` | Quote page: form and the largest client bundle |
| 5 | `/en/blog/titanium-grade-5-vs-grade-2-machinability-and-medical-applications` | Article with a database body (in the live sitemap) |

## 7. Soft-404 policy

The brief (§6) asks for real 404s. The plan keeps today's 200s through cutover and adds the flag `seo.strict_404` (H-9; PLAN.md §7, Q5): changing status codes during the host move would mix two causes in GSC. The effective value is the KV `FLAGS` entry `seo.strict_404` if present, else the var `SEO_STRICT_404` (`"false"`); the flag is read per request, so switching it back takes about a minute.

### 7.1 Classes (probes of G7)

| ID | Class | Probes (`en` · `fi`) | Today (status · document) | With `seo.strict_404` on |
|---|---|---|---|---|
| S-01 | Unknown single segment | `/en/zz-parity-404` · `/fi/zz-parity-404` | 200 · shell after 2 Supabase lookups (middleware/slugs.ts:154-156; middleware.ts:536-591) | 404 · shell |
| S-02 | Unknown two segments | `/en/zz-parity-404/zz` · `/fi/zz-parity-404/zz` | 200 · shell (middleware/slugs.ts:158) | 404 · shell |
| S-03 | Unknown service slug | `/en/services/zz-parity-404` · `/fi/palvelut/zz-parity-404` | 200 · shell (middleware/slugs.ts:113) | 404 · shell |
| S-04 | Unknown blog slug | `/en/blog/zz-parity-404` · `/fi/blogi/zz-parity-404` | 200 · shell, then the client navigates to the blog index (src/pages/BlogPost.tsx:96) | 404 · shell |
| S-05 | Blog path with an extra segment | `/en/blog/<first sampled slug>/zz` · `/fi/blogi/<first sampled slug>/zz` | 200 · shell (slug `a/b` misses, middleware/slugs.ts:119, middleware.ts:599) | 404 · shell |
| S-06 | Known page + extra segment | `/en/about/zz-parity-404` · `/fi/meista/zz-parity-404` | 200 · parent SEO body and parent canonical (middleware/slugs.ts:140-142) | 404 · shell, except real client sub-routes (§7.2) |
| S-07 | Service detail + extra segment | `/en/services/cnc-machining/zz` · `/fi/palvelut/cnc-työstö/zz` | 200 · service-detail SEO body and canonical (middleware/slugs.ts:111-112 ignores later segments); the client renders a blank page | 404 · shell |
| S-08 | Three or more unknown segments | `/en/zz/zz/zz` · `/fi/zz/zz/zz` | 200 · shell; blank page (no `*` route, src/App.tsx:162-319) | 404 · shell |
| S-09 | `.html` suffix | `/en/about.html` · `/fi/meista.html` | 200 · shell (unknown single segment) | 404 · shell; real files such as `/en/index.html` unchanged |
| S-10 | Uppercase language | `/EN/about` · `/FI/meista` | 200 · shell (the matcher is case-sensitive, middleware.ts:335) | Unchanged: outside the flag (non-language path) |
| S-11 | Unsupported language code | `/el/login` · `/xx/about` | 200 · shell | Unchanged: outside the flag |

### 7.2 Exemptions and mechanics

| Item | Rule |
|---|---|
| Real client routes | Paths the React router renders as pages keep 200: `/{lang}/login` (src/App.tsx:181), `/{lang}/{quote}/success` (:185), `/{lang}/{contact}/success` (:194, :208), `/{lang}/quote-request`, and every two-segment path whose English form is in `ROUTE_MAP` (src/components/TranslatedRouteMatcher.tsx:46-65). The list is generated from those files; a unit test proves each keeps 200 |
| Response | Status 404, the same shell document and headers as the SPA fallback, no `X-Seo-Source`; the client still renders NotFound (src/pages/NotFound.tsx:20-38) |
| Shadow mode | While the flag is off, the Worker logs `would_404` with the class and path to Workers Logs (no behaviour change), so the evidence below exists before the switch |
| Parity after the switch | Allow-list entries AL-1xx for S-01…S-09; the next baseline of record includes the 404s |

### 7.3 Evidence before switching (PLAN.md Q5, P3-7)

| # | Evidence | Source |
|---|---|---|
| 1 | 14 consecutive days after the flip within every threshold of §10.3 | Daily log (§10) |
| 2 | Page indexing: "Soft 404" and "Not found (404)" counts flat against the S11 snapshot; example URLs of both reasons exported and classified into S-01…S-11 | GSC UI |
| 3 | No path with `would_404` in the last 7 days has clicks or impressions in GSC Performance (last 90 days, by page) | Workers Logs × GSC Performance |
| 4 | The 100 most frequent `would_404` paths reviewed; any real page found gets a redirect or an exemption first | Workers Logs |
| 5 | URL Inspection on 20 `would_404` paths: none indexed as a normal page | `/api/gsc?action=inspect-url` or MCP `gsc_inspect_url` |
| 6 | Owner answers Q5 "yes" | PLAN.md §9 |

After the switch: 7 days of daily 404 counts (P3-7). Expected: Googlebot 404s rise (these URLs were soft 404s), indexed pages stay flat. Rollback: flag off in KV.

## 8. Cloudflare zone settings for parity

Applied at S11 before any record is proxied (PLAN.md §6.4) and exported with the S11 evidence (dashboard screenshots and the zone settings API output). Zone plan: Free (PLAN.md §5.3); Pro only if Super Bot Fight Mode tuning is wanted. Whether each feature acts on Worker-generated responses is not documented feature by feature, so every item is set regardless; the production parity runs (F11, F23) are the proof.

| # | Setting | Required | Why | Source |
|---|---|---|---|---|
| 1 | Cache Rules, Page Rules ("Cache Everything"), Edge Cache TTL | None for HTML, XML or TXT | HTML and JSON are not cached by default; `.xml`, `.txt`, `.wasm` are not in the default cached-extension list; `max-age=0` is honoured | CF docs (verified 2026-09-27; re-read 2026-09-30) |
| 2 | Rocket Loader | Off | Rewrites script tags; available on all plans | CF docs (verified 2026-09-30) |
| 3 | Auto Minify | Absent: deprecated 2024-08-05; confirm the zone reports nothing enabled | Rewrote HTML, CSS, JS | CF docs (verified 2026-09-30) |
| 4 | Email Address Obfuscation | Off | On by default; injects `email-decode.min.js` and rewrites addresses; the database contact and legal pages contain addresses (scripts/verify-ssr.sh:222 expects `info@micronshub`) | CF docs (verified 2026-09-30) |
| 5 | Mirage | Off / absent: deprecated Nov 2025, end of life Jan 2026 | Rewrote image tags | CF docs (verified 2026-09-30) |
| 6 | Server-side Excludes | Absent: deprecated 2024-06-14 | Rewrote HTML | CF docs (verified 2026-09-30) |
| 7 | Automatic HTTPS Rewrites | Off | Rewrites `http` URLs in page responses; article bodies come from the database; default state to verify at execution | CF docs (verified 2026-09-30) |
| 8 | Cloudflare Fonts | Off | Removes Google Fonts links and inlines CSS; the shell loads Google Fonts (index.html:42-49) | CF docs (verified 2026-09-30) |
| 9 | Speed Brain | Off | Enabled by default on Free; adds a `Speculation-Rules` header | CF docs (verified 2026-09-30) |
| 10 | Early Hints | Off | Sends 103 responses built from `Link` headers; no parity value | CF docs (verified 2026-09-30); default state to verify at execution |
| 11 | Zaraz | Off, no tools configured | Loads third-party tools into pages | Injection details: to verify at execution |
| 12 | Web Analytics automatic setup | Disabled (manual snippet only, if ever wanted) | Enabled by default for proxied sites; injects the beacon; only `Cache-Control: no-transform` prevents it, and adding that would break F6 | CF docs (verified 2026-09-27; re-read 2026-09-30) |
| 13 | Managed robots.txt (AI crawler preference in robots.txt) | Off | Prepends managed content to the existing `robots.txt`; off by default; `robots.txt` must stay byte-identical | CF docs (verified 2026-09-30) |
| 14 | AI Labyrinth; block-AI-bots setting | Off | AI Labyrinth injects hidden links into HTML; blocking AI crawlers would contradict public/robots-ai.txt | Labyrinth: CF docs (verified 2026-09-30); blocking setting: to verify at execution |
| 15 | Crawler Hints | Off through Phase 3 + 14 days, then decide | Sends IndexNow notifications from cache signals; HTML is never cached here, so the signals would be noise; IndexNow is already sent by `translate-article` (C18) | CF docs (verified 2026-09-30); default state to verify at execution |
| 16 | Bot Fight Mode | Off | Cannot be skipped by WAF custom rules; JavaScript detections are injected and cannot be disabled | CF docs (verified 2026-09-30) |
| 17 | Super Bot Fight Mode (Pro only) | Verified bots: Allow; definitely and likely automated: Allow; JavaScript detections off; static resource protection off | Pro and above; custom rules with Skip run before it | CF docs (verified 2026-09-30) |
| 18 | WAF custom rule "verified bots" | `(cf.client.bot)` → Skip the remaining custom rules, rate limiting and, where present, managed rules and Super Bot Fight Mode | `cf.client.bot` marks known good bots | Field: CF docs (verified 2026-09-30); skip options per plan: to verify at execution |
| 19 | Browser Integrity Check | Off zone-wide | On by default; challenges missing or non-standard user agents: SEO tools with custom user agents and server-to-server callers of `/api/*` | CF docs (verified 2026-09-30) |
| 20 | Security Level "I'm Under Attack" | Never on | Challenges every visitor, crawlers included | To verify at execution |
| 21 | Rate limiting | Exactly one rule: path starts with `/api/`, except `/api/track` and `/api/marketing` (tracking pixels arrive through mail-client image proxies that share few IPs; those two paths are limited per route by the Worker's `API_RATE_LIMIT` binding from Phase 2); verified bots excluded; per-IP threshold at least 5× the highest 10 s rate seen in Phase 2 logs | Free plan: 1 rule, IP characteristic, 10 s period and timeout, path and verified-bot fields | CF docs (verified 2026-09-27; re-read 2026-09-30) |
| 22 | Always Use HTTPS | On only if its status and `Location` equal the baseline HTTP → HTTPS hop; otherwise off and a Single Redirect Rule with the baseline status | The docs page does not state the status code | To verify at execution (H-24) |
| 23 | HSTS | Max-age, `includeSubDomains`, `preload` as in the baseline; No-Sniff only if the baseline has `X-Content-Type-Options: nosniff` | Options per CF docs; HSTS is sent on HTTPS responses only | CF docs (verified 2026-09-30) |
| 24 | HTTP/3 | Allowed | `alt-svc` is ignored by the diff (§2.2) | Default state: to verify at execution |
| 25 | Hotlink Protection | Off | Blocks gif, ico, jpg, jpeg, png requests with a foreign Referer; e-mails embed `https://micronshub.eu/logo.png` and social previews fetch `og:image` | CF docs (verified 2026-09-30) |
| 26 | Replace insecure JavaScript libraries | Off | On by default on Free; rewrites `polyfill.io` script sources only (no such reference in index.html or src/ today, so parity-neutral) | CF docs (verified 2026-09-30) |
| 27 | Managed Transforms and response-header Transform Rules | None that add or remove headers | F11 fails on any added header | To verify at execution |
| 28 | Polish / image optimisation | Off | Changes image bytes (F24 on G8) | Applicability to Worker and asset responses: to verify at execution |

## 9. Sitemaps and robots (H-12)

| URL | Handler | Body source | Status rules |
|---|---|---|---|
| `/sitemap.xml` | `type=main-index` → `handleMainIndex` (api/sitemap.js:377-389) | Generated: one `<sitemap>` pointing at `/sitemap-complete.xml`, `<lastmod>` = request date (:378). The `sitemap.xml` object in Storage is not served | 200 |
| `/sitemap-complete.xml`, `/api/sitemap` | `handleMain` (api/sitemap.js:234-312) | Storage blob `sitemaps/sitemap-complete.xml` if it contains `<urlset` and is longer than 100 characters (:239); regenerated daily at 09:00 UTC (6,273,304 B, 2,596 `<loc>`, live 2026-09-30); else a dynamic build from Supabase REST (:247-307) | 200; 500 with an empty `urlset` on error (:310) |
| `/sitemap-index.xml` | `handleIndex` (api/sitemap.js:315-329) | Storage blob, stale since 2025-12-30 (live 2026-09-30) | 200, also on Storage failure (empty index, :321, :327) |
| `/sitemap-{lang}.xml` × 14 | `handleLang` (api/sitemap.js:332-354) | Storage blobs, stale since 2025-12-30 (live 2026-09-30) | 404 `Sitemap not found` for an unsupported language (:338); 404 with an empty `urlset` on Storage failure (:346) |

| Rule | Detail |
|---|---|
| Headers | Every branch, 404 and 500 included: `Content-Type: application/xml; charset=utf-8`, `Cache-Control: public, max-age=3600, s-maxage=3600`, `Vary: Accept-Encoding` (api/sitemap.js:392-396); compared with F5–F7 |
| Stale blobs | Served as they are (PLAN.md P1-6); fixing them is a separate SEO decision after cutover |
| Stale comment | api/sitemap.js:5-7 says `/sitemap-complete.xml` redirects to `/sitemap.xml`; vercel.json:134-137 is a rewrite. Parity follows vercel.json |
| Edge caching | `.xml` is not cached by default (CF docs, verified 2026-09-30); the Worker keeps a 1 h Cache API copy (PLAN.md P1-6). Vercel honours `s-maxage=3600` today, so for up to 1 h after 09:00 UTC the two hosts can serve different generations: covered by the 10:05 UTC window (§2.4) |
| Comparison | F24 byte-equal in the same window; if not equal, F26 parsed comparison and the report shows added, removed and changed `<loc>` values |
| Phase 5 | Blobs move to R2 `microns-private` `sitemaps/…` and are served at the identical URLs; the `sitemaps` group must stay byte-equal across the switch |
| `robots.txt` | Static asset, byte-identical (F24), including the `Sitemap:` line (public/robots.txt:36) and today's Disallow gaps (H-28); HEAD checked; §8 row 13 keeps Cloudflare from prepending content |
| `robots-ai.txt` | Byte-identical, including its placeholder `Sitemap:` line (public/robots-ai.txt:99): debt, not fixed during parity |
| `indexnow_key.txt` | Byte-identical at the identical path (H-14) |

## 10. GSC monitoring plan

The GSC property is the domain property `sc-domain:micronshub.eu` (supabase/migrations/20260411_gsc_dashboard.sql:23), verified by the `google-site-verification` TXT record (live 2026-09-30) that the zone import must keep (PLAN.md §6.2 S9). A domain property covers `www`, the apex, `http://` and tenant hosts together.

### 10.1 Pre-cutover snapshot (S11, C − 1 d)

| Item | Detail | Source |
|---|---|---|
| Page indexing | Indexed count; not-indexed count per reason (Soft 404, Not found (404), Page with redirect, Duplicate without user-selected canonical, Google chose a different canonical, Crawled / Discovered – currently not indexed, Server error (5xx), Blocked by robots.txt); CSV exports | GSC UI |
| Crawl stats (90 days) | Requests per day, by response code, by file type, by Googlebot type; average response time; host status (robots.txt fetch, DNS, server connectivity) | GSC UI (no API) |
| Core Web Vitals | Mobile and desktop URL counts per status (a trailing indicator; not a rollback trigger) | GSC UI |
| Performance | Top 100 pages and top 100 queries (clicks, impressions, CTR, position) for the last 28 days and 7 days; daily totals for 90 days | `/api/gsc?action=search-analytics`, MCP `gsc_get_top_pages`, `gsc_get_top_queries` |
| Sitemaps | Submitted sitemaps, status, last read, discovered URLs | MCP `gsc_list_sitemaps`, `/api/gsc?action=sitemaps` |
| Sentinel URLs | URL Inspection of 20 URLs: the 14 `/{lang}` homepages, `/en/services`, `/de/dienstleistungen/cnc-bearbeitung`, `/en/industries`, `/fr/devis`, the Lighthouse article (§6), `/cs/vzdelavani` | MCP `gsc_inspect_url`, `/api/gsc?action=inspect-url` |
| Monitored URL states | Count of `gsc_monitored_urls` (2,456 rows, live 2026-09-30) by `coverage_state` in `gsc_inspection_cache` | Supabase, read-only |

### 10.2 Daily for 14 days after the flip (C + 1 … C + 14)

Each day: the §10.1 items that change daily (crawl stats, host status, page indexing when GSC updates it, performance, sitemaps status, sentinel inspection), the `gate` parity run against the S11 snapshot (§1), and Workers Logs for `microns-site` (5xx, status mix, `X-Seo-Source` distribution, `would_404` counts). GSC reports lag by days, so the first 48 h rely on Workers Logs, parity runs and URL Inspection live tests (PLAN.md S15); GSC trends confirm over the 14 days. The daily table is appended to the Phase 3 evidence in the PLAN.md §2 gate log.

### 10.3 Thresholds and rollback triggers

| Metric | Baseline | Investigate | Rollback trigger |
|---|---|---|---|
| 5xx share (crawl stats; Workers Logs on SEO paths) | S11 snapshot | Any 5xx day | > 0.1 % (Workers Logs: over 15 min) |
| Googlebot 404 responses | 28-day daily mean before S11 | > 1.5× | > 2× |
| Indexed pages | S11 count | −1 % | −2 % |
| Crawl requests per day | 90-day series | −20 % | −30 % day over day, unless the same weekday shows a comparable drop in the previous 4 weeks |
| Host status | All green | Any warning | robots.txt fetch or DNS failure |
| Sitemaps report | "Success" for `/sitemap.xml` and `/sitemap-complete.xml` | Any warning | Error, or a `/sitemap*.xml` response that is not 200 `application/xml`: fix within 1 h, else rollback |
| Parity run | 0 unexplained | Any `transient` | Any unexplained difference on an SEO URL not fixed within 1 h |
| Verified bots | No challenges in Security Events | — | Any challenge or block not fixed within 15 min |
| Clicks (Performance) | Same weekday, previous 4 weeks | −20 % week over week | Not a trigger alone; decided with the rows above |

The 5xx, 404, indexed-pages, sitemap, parity and verified-bot triggers are those of PLAN.md §6.5; the crawl-request and host-status triggers are added here for PLAN.md §6.5. Rollback means the record flips of PLAN.md §6.2 S12–S14 (about 10 min each, TTL 300 s); the decision is Dimitris's, on Claude's recommendation.

### 10.4 Data sources and roles

| Source | Provides | Notes |
|---|---|---|
| GSC UI | Page indexing, crawl stats, host status, Core Web Vitals, sitemaps, URL Inspection live test | The Search Console API does not expose page indexing or crawl stats |
| `/api/gsc` | Actions `search-analytics`, `inspect-url`, `bulk-inspect`, `sitemaps`, `monitored-urls` (api/gsc.js:196-207), admin-gated (api/gsc.js:189) | Used by src/pages/dashboard/SeoConsolePage.tsx; served through the Phase 2 router after cutover |
| Local MCP server | `gsc_search_analytics`, `gsc_get_top_queries`, `gsc_get_top_pages`, `gsc_compare_periods`, `gsc_inspect_url`, `gsc_get_unindexed_pages`, `gsc_list_sitemaps`, `gsc_submit_sitemap` and others (mcp-server/src/index.ts:1611-1911) | Stdio server on the owner's machine |
| Live-only edge functions `gsc-performance`, `gsc-inspect-url`, `gsc-index-url`, `gsc-sitemap-sync` | Not in the repo; no caller found in `src/` (live 2026-09-30) | Used only after PLAN.md Q6 is answered |
| Tables `gsc_monitored_urls`, `gsc_inspection_cache` | Per-URL coverage state over time (supabase/migrations/20260411_gsc_dashboard.sql:61-100) | Read-only queries |
| Workers Logs, Security Events | 5xx, latency, status mix, bot challenges | Cloudflare dashboard |
| URL Inspection quota | Daily per-property limit | Google docs, re-check at execution; the sentinel list stays at 20 URLs a day |

| Role | Who | When |
|---|---|---|
| GSC UI readings and exports | Dimitris | Daily, C + 1 … C + 14 |
| API and MCP pulls, Workers Logs, parity run, daily table, recommendation | Claude | Daily, C + 1 … C + 14 |
| Rollback decision | Dimitris | On any trigger in §10.3 |
| Sitemap re-submission | Dimitris (Claude prepares) | Once, after the S16 C + 1 h checks pass: submit `https://www.micronshub.eu/sitemap.xml` once (GSC UI or MCP `gsc_submit_sitemap`); no repeated submissions; other submitted sitemaps are left as the S11 snapshot lists them |

## 11. To confirm at execution

| Item | Where it is settled |
|---|---|
| Apex redirect status, HTTP → HTTPS chain, HSTS and default Vercel headers | Baseline (§4) |
| Whether P1-5 ports the two client regex patterns (AL-005) | PLAN.md P1-5 review |
| Items marked "to verify at execution" in §8 | Zone review at S11 |
| URL Inspection quota | Google documentation before C − 1 d |
