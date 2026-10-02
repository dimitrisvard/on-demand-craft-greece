// microns-site router (PLAN.md P1-3; ARCHITECTURE.md §6.2). Every method takes the same path, as Vercel runs the
// vercel.json redirects, middleware and rewrites for every method.
//
//   1 redirect table (src/redirects.ts)            vercel.json redirects run before middleware and filesystem
//   2 sitemap routes (src/sitemap.ts)              vercel.json rewrites to api/sitemap.js, and /api/sitemap
//   3 /api/* (src/api/forward.ts)                  Phase 1: forwarded to Vercel production
//   4 SEO handler (src/seo/handler.ts)             /{lang} and /{lang}/*; null where middleware.ts returns undefined
//   5 directory index (src/static.ts)              only when DIRECTORY_INDEX_EMULATION is "true"
//   6 env.ASSETS.fetch(request)                    file, or the SPA shell with 200 (not_found_handling)
//
// Every response passes through finalise() (src/preview.ts) exactly once, here.
// Errors: a throw in step 2 or 4 is logged and the request falls through to the next step (as a middleware that
// returns undefined on Vercel); a throw in the static step (or in steps 1 and 3, which catch their own errors)
// answers 500 text/plain "Internal Server Error".

import { handleApi } from './api/forward';
import type { Env } from './env';
import { LOG_PREFIX } from './env';
import { finalise } from './preview';
import { matchRedirect } from './redirects';
import { handleSeo } from './seo/handler';
import { handleSitemap } from './sitemap';
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
      logStepError('sitemap', request, url, err);
    }

    // 3. /api/*.
    step = 'api';
    if (url.pathname.startsWith('/api/')) return await handleApi(request, env, ctx);

    // 4. SEO handler; null for every non-language path and wherever middleware.ts returns undefined.
    step = 'seo';
    try {
      const seo = await handleSeo(request, env, ctx);
      if (seo) return seo;
    } catch (err) {
      logStepError('seo', request, url, err);
    }

    // 5-6. Static assets.
    step = 'static';
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
