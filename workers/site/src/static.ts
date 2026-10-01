// Router step 5: Vercel filesystem emulation in front of env.ASSETS (ARCHITECTURE.md §6.1, §6.2 steps 5-6).
// html_handling "none" serves exact file paths only, so the directory index Vercel serves for /dir/ and /dir
// (public/laserkritis/, public/zohoverify/) is emulated here when <dir>/index.html exists. Everything else goes
// to env.ASSETS.fetch(request): the file, or the SPA shell with 200 (not_found_handling, vercel.json:158-161).
//
// Existence check: with not_found_handling "single-page-application" a missing file comes back as the shell with
// 200, so a path counts as a file only when its ETag differs from the ETag of /index.html (bodies are compared
// when either ETag is missing). Assets are immutable per deployed version, so results are memoised per isolate.

import type { Env } from './env';

interface ExistenceCache {
  shellTag?: Promise<string | null>;
  paths: Map<string, Promise<boolean>>;
}

const MAX_MEMOISED_PATHS = 1000;
const caches = new WeakMap<object, ExistenceCache>();

function cacheFor(env: Env): ExistenceCache {
  let cache = caches.get(env.ASSETS);
  if (!cache) {
    cache = { paths: new Map() };
    caches.set(env.ASSETS, cache);
  }
  return cache;
}

function assetRequest(path: string, base: URL, method: 'GET' | 'HEAD'): Request {
  return new Request(new URL(path, base.origin), { method });
}

async function bodyOf(env: Env, path: string, base: URL): Promise<string> {
  return (await env.ASSETS.fetch(assetRequest(path, base, 'GET'))).text();
}

async function checkFile(env: Env, path: string, base: URL): Promise<boolean> {
  const res = await env.ASSETS.fetch(assetRequest(path, base, 'HEAD'));
  if (!res.ok) return false;
  const cache = cacheFor(env);
  cache.shellTag ??= env.ASSETS.fetch(assetRequest('/index.html', base, 'HEAD'))
    .then((shell) => shell.headers.get('ETag'))
    .catch(() => null);
  const tag = res.headers.get('ETag');
  const shellTag = await cache.shellTag;
  if (tag && shellTag) return tag !== shellTag;
  const [candidate, shell] = await Promise.all([bodyOf(env, path, base), bodyOf(env, '/index.html', base)]);
  return candidate !== shell;
}

// True when `path` is a real file in dist/ (not the SPA fallback).
export async function assetExists(env: Env, path: string, base: URL): Promise<boolean> {
  const { paths } = cacheFor(env);
  let known = paths.get(path);
  if (!known) {
    if (paths.size >= MAX_MEMOISED_PATHS) paths.clear();
    known = checkFile(env, path, base).catch(() => false);
    paths.set(path, known);
  }
  return known;
}

// The dist/ path Vercel's filesystem step would serve for a directory request, if any.
export async function directoryIndex(url: URL, env: Env): Promise<string | null> {
  const { pathname } = url;
  if (pathname === '/') return null; // env.ASSETS answers / with /index.html already
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  let candidate: string;
  if (pathname.endsWith('/')) candidate = `${pathname}index.html`;
  else if (!lastSegment.includes('.')) candidate = `${pathname}/index.html`;
  else return null;
  return (await assetExists(env, candidate, url)) ? candidate : null;
}

// True when the static step would serve a real file (exact path or directory index) instead of the shell.
export async function hasStaticFile(url: URL, env: Env): Promise<boolean> {
  const lastSegment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (lastSegment.includes('.') && (await assetExists(env, url.pathname, url))) return true;
  return (await directoryIndex(url, env)) !== null;
}

export async function serveStatic(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const index = await directoryIndex(url, env);
  if (index) return env.ASSETS.fetch(new Request(new URL(index + url.search, url.origin), request));
  return env.ASSETS.fetch(request);
}
