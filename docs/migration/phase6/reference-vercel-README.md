# Vercel reference (frozen)

Frozen copies of the configuration and the Edge Middleware the site ran on Vercel until the 2026 migration
(docs/migration/PLAN.md P6-6). Nothing here is deployed or read by a build: Vercel reads `vercel.json` and
`middleware.ts` only at the repository root, and the project is paused or deleted.

| File | Used by |
|---|---|
| `vercel.json` | Tests that keep the Worker equal to the old platform: the redirect table (`workers/site/test/redirects.test.ts`, `tests/middleware/smoke.mjs`, which also checks one redirect source byte for byte), the `/api` rewrites and CORS headers (`workers/shared/test/compat/vercel-rewrite.test.ts`, `workers/shared/test/http/cors.test.ts`) and the redirect URLs of the SEO parity tool (`scripts/seo-parity/lib/urls.mjs`, `scripts/seo-parity/test/urls-window.test.mjs`) |
| `middleware.ts` | The offline document parity of the SEO handler (`workers/site/test/seo-parity.test.ts` through `test/helpers/seo-harness.ts`), the route-decision tests (`workers/site/test/seo-handler.test.ts`, `tests/middleware/smoke.mjs`) and the fixture recorder (`workers/site/test/fixtures/seo/record.mjs`). It imports the shared modules from `../../middleware/`, which `workers/site/src/seo` uses as well |

Do not edit these files: a change here changes what the parity tests compare against. Bytes are identical to the
last Vercel version except the 13 import paths of `middleware.ts` (`./middleware/` became `../../middleware/`).
