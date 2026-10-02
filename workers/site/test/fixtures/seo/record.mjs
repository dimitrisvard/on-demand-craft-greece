// Records the Supabase REST responses that middleware.ts requests for the parity cases in cases.json, so the
// offline parity test (test/seo-parity.test.ts) runs middleware.ts and the Worker SEO handler on identical inputs
// without network.
//
// How: middleware.ts is bundled with esbuild and run once per case (fresh module instance, so its Map caches do
// not hide a request) with a recording fetch: the shell comes from shell.html, every Supabase REST URL is
// forwarded to the real API and its status and JSON body are stored under the exact request URL. Overrides of a
// case are NOT applied while recording (the test applies them), but cases with overrides are run with them too so
// any extra URL they cause is recorded.
//
// Run from the repository root (read-only anon access; the key is never written anywhere):
//   set -a; . workers/site/.dev.vars; set +a
//   NODE_USE_ENV_PROXY=1 node workers/site/test/fixtures/seo/record.mjs     # NODE_USE_ENV_PROXY only behind a proxy
// Output: workers/site/test/fixtures/seo/rest.json ({ "<url>": { "status": n, "body": <json> } }, keys sorted).

import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co'; // middleware.ts:43
const REST_PREFIX = `${SUPABASE_URL}/rest/v1/`;

const anonKey = process.env.SUPABASE_ANON_KEY;
if (!anonKey) {
  console.error('SUPABASE_ANON_KEY is not set (source workers/site/.dev.vars first)');
  process.exit(1);
}

const { origin, cases } = JSON.parse(await readFile(path.join(HERE, 'cases.json'), 'utf8'));
const shell = await readFile(path.join(HERE, 'shell.html'), 'utf8');

const outDir = await mkdtemp(path.join(tmpdir(), 'seo-record-'));
const bundle = path.join(outDir, 'middleware.mjs');
await build({
  entryPoints: [path.join(ROOT, 'middleware.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  loader: { '.json': 'json' },
  outfile: bundle,
  logLevel: 'silent',
});

const realFetch = globalThis.fetch;
const recorded = {};
const pending = [];

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function recordingFetch(overrides) {
  return async (input, init) => {
    const u = urlOf(input);
    if (u === `${origin}/index.html`) {
      return new Response(shell, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (!u.startsWith(REST_PREFIX)) throw new Error(`unexpected fetch ${u}`);
    const real = realFetch(u, init).then(async (res) => {
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      recorded[u] = { status: res.status, body };
      return { status: res.status, text };
    });
    pending.push(real);
    const { status, text } = await real;
    const ov = overrides.find((o) => u.includes(o.match));
    if (!ov) return new Response(text, { status, headers: { 'content-type': 'application/json' } });
    let body = JSON.parse(text);
    if ('body' in ov) body = ov.body;
    if (ov.patchRows && Array.isArray(body)) body = body.map((r) => ({ ...r, ...ov.patchRows }));
    return new Response(JSON.stringify(body), { status: ov.status ?? status, headers: { 'content-type': 'application/json' } });
  };
}

let n = 0;
for (const c of cases) {
  n += 1;
  globalThis.fetch = recordingFetch(c.overrides ?? []);
  const mod = await import(`${url.pathToFileURL(bundle).href}?case=${n}`);
  const res = await mod.default(new Request(origin + c.path));
  const got = res ? 'document' : 'null';
  console.log(`${got === c.expect ? 'ok  ' : 'DIFF'} ${c.path} -> ${got}${res ? ` ${res.status} ${res.headers.get('x-seo-source')}` : ''}`);
}
await Promise.allSettled(pending);
globalThis.fetch = realFetch;
await rm(outDir, { recursive: true, force: true });

const sorted = Object.fromEntries(Object.keys(recorded).sort().map((k) => [k, recorded[k]]));
const failed = Object.entries(sorted).filter(([, v]) => v.status < 200 || v.status >= 300);
const out = path.join(HERE, 'rest.json');
const json = JSON.stringify(sorted, null, 1) + '\n';
await writeFile(out, json);
console.log(`${Object.keys(sorted).length} REST responses, ${json.length} bytes -> ${path.relative(ROOT, out)}`);
if (failed.length) {
  console.error(`non-2xx responses recorded: ${failed.map(([k, v]) => `${v.status} ${k}`).join(', ')}`);
  process.exit(2);
}
// The middleware timers (2.5 s races) may keep the event loop alive briefly; exit explicitly.
process.exit(0);
