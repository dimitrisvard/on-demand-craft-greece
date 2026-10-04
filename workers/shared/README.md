# workers/shared

Source-only TypeScript shared by the two Workers of the `/api` port: `microns-site` (`workers/site`) and `microns-ops` (`workers/ops`). There is no build step and no workspace: each Worker imports these files by relative path (`../../shared/src/...`) and bundles them with its own wrangler. This package keeps its own `package.json` and lockfile; the root lockfile is unchanged.

## Modules

| Module | Purpose | Used by |
|---|---|---|
| `src/compat/vercel-node.ts` | Runs an unchanged Vercel Node.js Function `(req, res)` with the helper semantics of `@vercel/node` 17.0.0 (`runNodeHandler`, `parseVercelBody`, `parseQuery`, `ApiError`, body limit, default timeout) | site (`emails`, `track`), ops (every route, queue consumer, webhook and OAuth modules) |
| `src/compat/ambient.d.ts` | Minimal type declarations for `content-type`, `node:querystring`, `node:buffer`, `node:crypto`, so importing programs type-check with `types: ["@cloudflare/workers-types"]` only | referenced by `vercel-node.ts` and `etag.ts` |
| `src/compat/vercel-rewrite.ts` | The `vercel.json` rewrites that target an `/api` function (`/api/track`, `/api/connector-status`) and the query merge Vercel applies to them | site router |
| `src/compat/etag.ts` | Weak ETag equal to the `etag` package with `{ weak: true }` | `vercel-node.ts` |
| `src/http/rpc.ts` | Site to ops RPC contract (`OpsCall`, `Principal`, `OpsApiRpc`) | both |
| `src/http/env-check.ts` | Per-request name checks (`missingNames`, `configError`): a missing binding, var or secret answers 500 only on the requests that need it | both |
| `src/http/json.ts` | `jsonResponse`, `textResponse`, `apiError` for answers the Worker code produces itself | both |
| `src/http/log.ts` | One-line structured logs (`logLine`) | both |
| `src/http/cors.ts` | Parity CORS headers (byte copy of the site's `finalise()` values) and the allow-list mode (built and tested, not wired) | site |
| `src/auth/*` | Request verification primitives: Supabase session tokens, Cloudflare Access service-token assertions, Turnstile siteverify, Svix webhook signatures, rate-limit keys | site gates, ops webhook and OAuth modules |
| `src/storage/*` | S3-API presigning for R2 and legacy S3 (`aws4fetch`), ListObjectsV2 parsing | site files API |

## Shim behaviour (`runNodeHandler`)

| Area | Behaviour |
|---|---|
| `req` | `method`; `url` = function path + query (rewrite merged); `headers` with lower-case names (repeated values joined); lazy, settable `query` (repeated key → array), `body`, `cookies`; raw bytes as `req[RAW_BODY]` and `req.rawBody` |
| `req.body` | No `Content-Type` → `''`; `application/json` → object, empty → `{}`, invalid → `ApiError(400, 'Invalid JSON')` on every read; `text/plain` → string; `application/x-www-form-urlencoded` → `querystring.parse`; `application/octet-stream` → `Buffer`; other types → `undefined`; malformed `Content-Type` → `TypeError` on every read |
| `res` helpers | `status`, `json`, `send`, `redirect` as `@vercel/node`: default `text/html` for strings, `charset=utf-8` added to any string type, weak ETag, `application/octet-stream` for a `Buffer`, JSON for objects, numbers and booleans, 204/304 without body, `redirect` default 307 with no body |
| `res` (Node) | `statusCode`, `statusMessage`, `setHeader` (values stringified, arrays kept, names and values checked as Node checks them), `getHeader(s)`, `hasHeader`, `removeHeader`, `writeHead`, `write`, `end`; `end(string \| Buffer)` sends the bytes as given (no type, charset or ETag) |
| Response | One `Response` built at `res.end()`; HEAD and null-body statuses carry no body |
| After `end()` | The rest of the handler runs under `ctx.waitUntil`; a late rejection is logged. A handler that returns before it ends (timer, callback) is answered by its later `end()` within the same deadline |
| Throw before `end()` | An error with a numeric `statusCode` 400-599 → that status, `text/plain`, body = message; anything else propagates (the caller answers 500). The handler is not registered with `ctx.waitUntil` |
| Timeout | No `end()` within `timeoutMs` (default 30 s) → 504 `text/plain` `Gateway Timeout`; the handler is not registered with `ctx.waitUntil` |
| `process.env` | Not handled here: populated by the runtime (`nodejs_compat`) |

Known differences from a Node server running `@vercel/node`:

| Item | Shim |
|---|---|
| `Content-Length`, `Transfer-Encoding` | Left to the runtime, which sets `Content-Length` from the body; a HEAD answer carries none |
| Repeated request headers | Joined with `, ` by the `Headers` object (Node keeps the first value of some single-value headers and joins `Cookie` with `; `) |
| Uncaught `ApiError` and timeout bodies | Plain text (status and message; `Gateway Timeout`), not the platform error page |
| Header values with U+0080-U+00FF characters (for example a `Location` built from a decoded URL) | Sent as UTF-8 on every answer (`é` = `C3 A9`): the runtime encodes header strings as UTF-8 and the shim cannot send raw Latin-1 bytes. Node sends UTF-8 only when the header block goes out with a UTF-8 string body (`end(string)`, or `send`/`json` under 1,000 characters); with no body (`end()`, `redirect`, 204/304, HEAD), a `Buffer` body or a longer `send` string it sends Latin-1 (`é` = `E9`). Vercel's production bytes for such a redirect are not measured here (a capture item before the switch). Characters above U+00FF throw in both |

## Commands

| Command | What it does |
|---|---|
| `npm --prefix workers/shared ci` | Install the pinned dependencies |
| `npm --prefix workers/shared run typecheck` | `tsc` over `src` and `test` |
| `npm --prefix workers/shared test` | All unit tests (vitest in Node) |
| `npm --prefix workers/shared test -- test/compat test/http` | Shim, rewrite, ETag and HTTP helper tests only |

## Rules

| Rule | Detail |
|---|---|
| Compiler options | `tsconfig.json` has exactly the `compilerOptions` of `workers/site/tsconfig.json` (and so does `workers/ops`); a test checks it |
| Imports | `src/**` never imports from `workers/site` or `workers/ops`; tests may, to prove parity with a site file |
| Node built-ins | Only `node:buffer`, `node:querystring` and `node:crypto` (all provided by `nodejs_compat`), typed through `src/compat/ambient.d.ts` |
| Dependencies | Exact versions; `etag`, `svix`, `@smithy/signature-v4` and `@aws-crypto/sha256-js` are test oracles only |
| Logs | Start with `[microns-site]` or `[microns-ops]`; never tokens, cookies, signatures, Access assertions, request bodies or e-mail addresses; the shim logs the method and function path only |
| Test data | Key-like values are built at runtime; no secret or secret-looking literal is committed |
