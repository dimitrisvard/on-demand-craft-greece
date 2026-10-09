# Phase 3 cutover: redirect rules, zone routes, owner commands

Payloads and commands for the zone side of the Phase 3 cutover (`docs/migration/PLAN.md` P3-3, P3-4, runbook §6.2 S11-S14). Contract: `docs/migration/specs/PHASE36_SPEC.md` §4.4 (payloads), §9.2 OW3-6 and OW3-13 (owner steps), F36-6 and F36-7 (rules). Nothing here calls Cloudflare on its own: the owner runs every command below, at the step the runbook names. The site Worker's own routes (`www.micronshub.eu/*`, `*.micronshub.eu/*`) live in `env.production` of `workers/site/wrangler.jsonc` and are applied by the `routes` action of `.github/workflows/cf-site-production.yml`.

| File | What |
|---|---|
| `redirect-rules.mjs` | Builds the Single Redirect ruleset (HTTP → HTTPS and apex → `www`) from the S11 baseline snapshot of `scripts/seo-parity.mjs`; prints the HSTS advice. Reads files only |
| `payloads/redirect-rules.default.json` | The generator's `--default` output (308 for both rules, HTTP rule first), committed for review; a test keeps it byte-equal to the generator |
| `payloads/zone-routes.json` | The three Workers routes without a Worker that S11 creates, and the rule for every later host |
| `test/redirect-rules.test.mjs` | 6 cases, no network |

## Rules

- **Routes without a Worker.** Every proxied hostname of `micronshub.eu` that `microns-site` must not answer gets a Workers route without a Worker, pattern `<host>/*`, before its DNS record is proxied. A route without a Worker negates every less specific pattern, so the `*.micronshub.eu/*` route of `microns-site` never answers that host; a route on a host without a proxied record has no effect, so creating it early is safe. At S11, before the `routes` action: `cad-vps.micronshub.eu/*`, `files.micronshub.eu/*`, `mcp.micronshub.eu/*`. Later: the Mac mini Tunnel host, any Tunnel- or Access-only host, and the CAD Tunnel host if Phase 4 names it differently (Claude then changes `zone-routes.json` in the same commit).
- **Redirect rules.** Both rules are applied at S11 in one ruleset. A redirect rule acts only on proxied hostnames: the HTTP → HTTPS rule takes effect per host as its record is proxied (S12-S14), the apex rule when the apex record is proxied at S13. Rollback of the apex rule = un-proxy the apex record, or replace the rule list with an empty one.
- **Listing.** List the zone routes after every route change, after every `routes` run and after any fallback `wrangler deploy --env production`: those replace the routes of `microns-site`, and the listing confirms that every route without a Worker is still there.

## Before you start

| Item | How |
|---|---|
| `ZONE_ID` | Cloudflare dashboard → `micronshub.eu` → Overview → API → Zone ID (or the `zones?name=` call below) |
| `CLOUDFLARE_API_TOKEN` | An API token you create for these steps, zone `micronshub.eu` only, with Workers Routes Write, Dynamic URL Redirects Write and Zone Read. Read it into the shell without echo and never write it to a file in the repository: `read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN`; afterwards `unset CLOUDFLARE_API_TOKEN` |
| curl | 7.82 or later for `--json` (older: `-H 'Content-Type: application/json' --data @file` / `--data '<json>'`) |

```sh
export ZONE_ID=$(curl -sS "https://api.cloudflare.com/client/v4/zones?name=micronshub.eu" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).result[0].id')
```

## S11 order (OW3-6)

| Step | Action | Command or place |
|---|---|---|
| (a) | Refresh the baseline from your machine (P0-3) | `docs/migration/SEO_PARITY.md` §4 B4-B5: `node scripts/seo-parity.mjs --generate-urls --base https://www.micronshub.eu --profile full --out urls.json` (with `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the environment), then `node scripts/seo-parity.mjs --capture --base https://www.micronshub.eu --urls urls.json --snapshot baseline-s11` |
| (b) | Build the redirect payload | `node scripts/phase3/redirect-rules.mjs --baseline baseline-s11 --out redirect-rules.json`. Exit 1: stop and send Claude the `problem:` lines. Read the `HSTS:` line: `HSTS: worker = <value>` → Claude commits `HSTS_VALUE` in `env.production` before (f); `HSTS: zone = <value>` → set the zone HSTS setting to that value at (c); `HSTS: none` → neither. `cmp redirect-rules.json scripts/phase3/payloads/redirect-rules.default.json` shows whether the baseline kept the 308/308 defaults |
| (c) | Zone settings | `docs/migration/SEO_PARITY.md` §8 and `docs/migration/PLAN.md` §6.4: Always Use HTTPS **off** (the HTTP → HTTPS rule carries the baseline status), URL normalisation to origin off, the one `/api/*` rate-limiting rule, HSTS per (b) |
| (c2) | Turnstile production pair, both at the same moment | in `workers/site`: `npx wrangler versions secret put TURNSTILE_SECRET_KEY --env production`; the repository secret `VITE_TURNSTILE_SITE_KEY` = the real site key |
| (d) | The three routes without a Worker | [Create the routes without a Worker](#create-the-routes-without-a-worker) |
| (e) | Apply the redirect payload | [Apply the redirect rules](#apply-the-redirect-rules) |
| (f) | Production release | GitHub Actions → `cf-site-production.yml`: `upload` → parity of the printed version preview URL against `baseline-s11` (`node scripts/seo-parity.mjs --snapshot baseline-s11 --candidate <version preview URL>`) → `deploy` with that version ID → `routes` |
| (g) | Check the routes | [List the zone routes](#list-the-zone-routes): 5 routes, `www.micronshub.eu/*` and `*.micronshub.eu/*` → `microns-site`, the three of (d) without a Worker |

S12-S14 then proxy `www`, the apex and the wildcard one at a time (runbook §6.2), each followed by the `dns-parity` check of `scripts/dns-parity/README.md` with the `--expect-proxied` list of that step (S12 `www,api`; S13 `www,@,api`; S14 onwards `www,@,*,api`): a name is listed only once its record is proxied.

## Commands

### Create the routes without a Worker

All routes of `payloads/zone-routes.json` (S11, step d); the body carries the pattern only, no `script`:

```sh
node -e 'for (const r of require("./scripts/phase3/payloads/zone-routes.json").routes) console.log(r.pattern)' |
while read -r pattern; do
  curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    --json "{\"pattern\": \"$pattern\"}"
  echo
done
```

Each answer has `"success": true` and the route `id`. An error saying the pattern already exists means the route was created before: confirm it in the listing.

One later host (OW3-13), before its record is proxied:

```sh
HOST=<name>.micronshub.eu
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json "{\"pattern\": \"$HOST/*\"}"
```

then list the zone routes, and send Claude the host name so `zone-routes.json` lists it.

### List the zone routes

```sh
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" |
  node -e 'const j = JSON.parse(require("fs").readFileSync(0, "utf8")); if (!j.success) { console.error(JSON.stringify(j.errors)); process.exit(1); }
for (const r of j.result) console.log(`${r.pattern}\t${r.script || "(no Worker)"}\t${r.id}`);'
```

Expected from S11 on: `www.micronshub.eu/*` and `*.micronshub.eu/*` with `microns-site`, and every route of `zone-routes.json` with `(no Worker)`.

### Delete one route (rollback of that route)

```sh
curl -sS -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes/<route id>" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### Apply the redirect rules

First read the phase's entry point. At S11 it is absent (HTTP 404) or holds no rules; if it lists rules other than `microns_http_to_https` and `microns_apex_to_www`, stop and send Claude the answer, because the `PUT` below replaces the whole rule list:

```sh
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Apply with `PUT`:

```sh
curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json @redirect-rules.json
```

If the `PUT` answers 404 (no entry point ruleset for the phase yet), create the ruleset with `POST` instead, same rules:

```sh
node -e 'const p = JSON.parse(require("fs").readFileSync("redirect-rules.json", "utf8"));
process.stdout.write(JSON.stringify({ name: "default", kind: "zone", phase: "http_request_dynamic_redirect", ...p }));' > redirect-rules.post.json
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json @redirect-rules.post.json
```

Afterwards the `GET` above lists exactly the two rules. If the API refuses `raw.http.request.uri.path` in a target expression, rebuild with `node scripts/phase3/redirect-rules.mjs --baseline baseline-s11 --path-field normalised --out redirect-rules.json`, apply again, and check the encoded-path rows of the parity run at S13 with Claude.

Rollback: un-proxy the apex record (the apex rule then no longer acts), or empty the rule list:

```sh
curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{"rules": []}'
```

## `redirect-rules.mjs`

```sh
node scripts/phase3/redirect-rules.mjs --baseline <snapshot dir> [--out <file>] [--path-field raw|normalised]
node scripts/phase3/redirect-rules.mjs --default [--out <file>]
```

| Exit | Meaning |
|---|---|
| 0 | payload written (stdout without `--out`); the summary, the `HSTS:` line and the apply command go to stderr |
| 1 | the baseline contradicts an assumption the rules rely on: an entry missing or failed, a variant that did not redirect, path or query not kept, a status outside 301/302/307/308, mixed statuses, a hop of `http://micronshub.eu/en` whose status differs from the rule that answers it, an unknown hop order, or no answer for `https://www.micronshub.eu/en`; each is printed as `problem:` |
| 64 | usage, or the snapshot directory cannot be read |

What it reads from the baseline (`results.ndjson`, GET records; pages of the base host are keyed by their path): the apex redirects of `/`, `/en/services`, `/logo.png` and `/api/marketing?action=track&parity=1` (one status, path and query kept), `http://www.micronshub.eu/en` (HTTP → HTTPS status), the hop order of `http://micronshub.eu/en` (first hop to `https://micronshub.eu/en`: the HTTP rule first; a capture with base `https://www.micronshub.eu` records only that hop, because the next one starts on another origin, and a capture that follows it records the apex redirect as the second hop; first hop straight to `https://www.micronshub.eu/en`: the apex rule first), and `Strict-Transport-Security` on the `www` page, the apex redirect and a tenant page. HSTS advice: on `www` only → `HSTS: worker = <value>` (the Worker sends it); on several hosts → `HSTS: zone = <value>` (the zone setting sends it, the Worker does not); none → `HSTS: none`.

## Tests

```sh
node --test scripts/phase3/test/*.test.mjs
```

6 cases, no network: HTTPS-first and apex-first baselines (rule order, statuses, raw path, query kept, HSTS read from a snapshot keyed like the real one), one `problem:` line per contradiction, the HSTS advice, the CLI on snapshots written by the seo-parity capture code itself (`captureSide` and `SnapshotWriter` against a stub client, both hop orders; needs `npm --prefix scripts/seo-parity ci`, part of `npm run cf:install`) with exit codes and `--path-field`, and the committed payloads (the redirect default byte-equal to the generator; the three routes without a Worker).
