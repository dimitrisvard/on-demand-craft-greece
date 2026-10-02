// microns-site router (PLAN.md P1-3; ARCHITECTURE.md §6.2). Every method takes the same path, as Vercel runs the
// vercel.json redirects, middleware and rewrites for every method.
//
//   1 redirect table (src/redirects.ts)            vercel.json redirects run before middleware and filesystem
//   2 sitemap routes (src/sitemap.ts)              vercel.json rewrites to api/sitemap.js, and /api/sitemap
//   3 /api/* (src/api/forward.ts)                  Phase 1: forwarded to Vercel production
//   4 SEO handler (src/seo/handler.ts)             /{lang} and /{lang}/*; null where middleware.ts returns undefined
//   5 directory index (src/static.ts)              only when DIRECTORY_INDEX_EMULATION is "true"
//   6 env.ASSETS.fetch(request)                    file, or the SPA shell with 200 (not_found_handling)
//     HEAD in steps 5-6 reads the asset as GET to set Content-Length (headFromAssets; SEO_PARITY.md G8 #10)
//
// Every response passes through finalise() (src/preview.ts) exactly once, here.
// Errors (every one is logged with LOG_PREFIX, the step and the path):
//   - step 2 on a public sitemap URL (/sitemap*.xml): 500. On Vercel these are Function rewrites, and a crashing
//     Function answers 5xx (FUNCTION_INVOCATION_FAILED), never the SPA shell with 200 (SEO_PARITY.md section 10.3
//     treats a non-XML /sitemap*.xml answer as a rollback trigger);
//   - step 2 on /api/sitemap: falls through to step 3, the Phase 1 forward to Vercel, which answers it;
//   - step 4: 500. A throw is an uncaught exception in middleware.ts, which Vercel answers with 500
//     (MIDDLEWARE_INVOCATION_FAILED); only a *returned* undefined (null here) continues to the filesystem. Falling
//     through would serve the prerendered Helmet file of a language route, which H-8 forbids;
//   - steps 1, 3 and 5-6: 500.
// Every 500 is text/plain "Internal Server Error". (The task text asked for a fall-through in steps 2 and 4;
// changed to the Vercel behaviour above, hard rule 6, and reported.)

import { handleApi } from './api/forward';
import type { Env } from './env';
import { LOG_PREFIX } from './env';
import { finalise } from './preview';
import { matchRedirect } from './redirects';
import { handleSeo } from './seo/handler';
import { handleSitemap, isPublicSitemapPath } from './sitemap';
import { serveStatic } from './static';

type Step = 'redirect' | 'sitemap' | 'api' | 'seo' | 'static';

function logStepError(step: Step, request: Request, url: URL, err: unknown): void {
  console.error(`${LOG_PREFIX} router step ${step} failed: ${request.method} ${url.pathname}`, err);
}

function internalError(): Response {
  return new Response('Internal Server Error', {
    status: 500,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// Steps 5-6. static.ts always emulates directory indexes, so the variable is honoured here.
function serveFromAssets(request: Request, env: Env): Promise<Response> {
  if (env.DIRECTORY_INDEX_EMULATION === 'true') return serveStatic(request, env);
  return env.ASSETS.fetch(request);
}

// HEAD in steps 5-6. workerd writes no Content-Length for a response without a body, not even for env.ASSETS'
// own HEAD answer (seen with wrangler dev 4.145.0), while Vercel's CDN sends the file size on HEAD, and the
// parity tool compares it on HEAD-only entries (SEO_PARITY.md G8 #10, /occt-import-js.wasm). So the asset is
// read as GET, its bytes are counted as they stream (not buffered), and the length is set explicitly;
// finalise() then sends the headers without a body. A body-less answer (e.g. 304) or one that already has a
// Content-Length is returned unchanged. (Integration fix; to re-check on the workers.dev preview.)
async function headFromAssets(request: Request, env: Env): Promise<Response> {
  const res = await serveFromAssets(new Request(request, { method: 'GET' }), env);
  if (!res.body || res.headers.has('Content-Length')) return res;
  let length = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
  }
  const out = new Response(null, res);
  out.headers.set('Content-Length', String(length));
  return out;
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  let step: Step = 'redirect';
  try {
    // 1. Redirect table: before the SEO handler, because sources such as /en/dawycena sit inside /{lang}/*.
    const redirect = matchRedirect(url);
    if (redirect) return redirect;

    // 2. Sitemap routes, before /api/* so /api/sitemap is answered locally.
    step = 'sitemap';
    try {
      const sitemap = await handleSitemap(request, env, ctx);
      if (sitemap) return sitemap;
    } catch (err) {
      if (isPublicSitemapPath(url)) throw err; // 500 below
      logStepError('sitemap', request, url, err);
    }

    // 3. /api/*.
    step = 'api';
    if (url.pathname.startsWith('/api/')) return await handleApi(request, env, ctx);

    // 4. SEO handler; null for every non-language path and wherever middleware.ts returns undefined. A throw
    //    answers 500 (outer catch), never the prerendered file.
    step = 'seo';
    const seo = await handleSeo(request, env, ctx);
    if (seo) return seo;

    // 5-6. Static assets.
    step = 'static';
    if (request.method === 'HEAD') return await headFromAssets(request, env);
    return await serveFromAssets(request, env);
  } catch (err) {
    logStepError(step, request, url, err);
    return internalError();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await route(request, env, ctx);
    return finalise(response, request, env);
  },
} satisfies ExportedHandler<Env>;
