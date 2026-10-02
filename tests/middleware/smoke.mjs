/**
 * Local smoke test for middleware renderers.
 *
 * Compiles the middleware modules to ESM with esbuild and invokes each
 * renderer, asserting that the output has the expected shape, contains
 * localized content, and survives the UTF-8 roundtrip.
 *
 * Run: node tests/middleware/smoke.mjs
 */
import { build } from 'esbuild';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, '.smoke-out');

if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

const bundlePath = path.join(OUT_DIR, 'bundle.mjs');

await build({
  entryPoints: [
    path.join(ROOT, 'middleware/renderers/homepage.ts'),
    path.join(ROOT, 'middleware/renderers/servicesIndex.ts'),
    path.join(ROOT, 'middleware/renderers/serviceDetail.ts'),
    path.join(ROOT, 'middleware/renderers/industries.ts'),
    path.join(ROOT, 'middleware/renderers/simplePage.ts'),
    path.join(ROOT, 'middleware/renderers/blogIndex.ts'),
    path.join(ROOT, 'middleware/meta.ts'),
    path.join(ROOT, 'middleware/slugs.ts'),
    path.join(ROOT, 'middleware/schema.ts'),
  ],
  bundle: false,
  format: 'esm',
  target: 'es2022',
  outdir: path.join(OUT_DIR, 'src'),
  loader: { '.json': 'json' },
  platform: 'neutral',
  logLevel: 'silent',
});

// esbuild with bundle:false preserves imports as-is. We need bundling so that
// the renderers can find each other at runtime. Re-run with bundle:true.
await build({
  entryPoints: {
    homepage: path.join(ROOT, 'middleware/renderers/homepage.ts'),
    servicesIndex: path.join(ROOT, 'middleware/renderers/servicesIndex.ts'),
    serviceDetail: path.join(ROOT, 'middleware/renderers/serviceDetail.ts'),
    industries: path.join(ROOT, 'middleware/renderers/industries.ts'),
    simplePage: path.join(ROOT, 'middleware/renderers/simplePage.ts'),
    blogIndex: path.join(ROOT, 'middleware/renderers/blogIndex.ts'),
    meta: path.join(ROOT, 'middleware/meta.ts'),
    slugs: path.join(ROOT, 'middleware/slugs.ts'),
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: OUT_DIR,
  loader: { '.json': 'json' },
  platform: 'neutral',
  logLevel: 'silent',
});

// Dynamic import each bundled module to exercise it.
const home = await import(path.join(OUT_DIR, 'homepage.js'));
const svcIdx = await import(path.join(OUT_DIR, 'servicesIndex.js'));
const svcDet = await import(path.join(OUT_DIR, 'serviceDetail.js'));
const ind = await import(path.join(OUT_DIR, 'industries.js'));
const simple = await import(path.join(OUT_DIR, 'simplePage.js'));
const blog = await import(path.join(OUT_DIR, 'blogIndex.js'));
const meta = await import(path.join(OUT_DIR, 'meta.js'));
const slugs = await import(path.join(OUT_DIR, 'slugs.js'));

let fails = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log('  [ok]', msg);
  } else {
    console.log('  [FAIL]', msg);
    fails += 1;
  }
};

const ALL_LANGS = ['en','de','fr','es','it','nl','pl','pt','sv','da','fi','nb','hu','cs'];
const pageTypes = ['homepage','services-index','service-detail','industries','blog-index','about','contact','quote','our-work'];
const serviceIds = ['cnc-machining','sheet-metal','3d-printing','injection-molding','surface-finishes','rapid-prototyping'];
const bodyLen = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
const noMojibake = (s) => !/Ã[£§¡©¶¼ŸÂ¨]/.test(s);

console.log('=== slugs.localizedPath roundtrip (all 14 langs) ===');
for (const lang of ALL_LANGS) {
  for (const sid of serviceIds) {
    const pathStr = slugs.localizedPath(lang, 'service-detail', sid);
    assert(pathStr.startsWith(`/${lang}/`), `${lang}/${sid} path starts with /${lang}/ -> ${pathStr}`);
    assert(pathStr.length > 10, `${lang}/${sid} path non-empty: ${pathStr}`);
  }
}

console.log('\n=== meta.getMeta (all 14 langs x 9 page types) ===');
for (const lang of ALL_LANGS) {
  for (const type of pageTypes) {
    const route = { lang, type, pathAfterLang: '', serviceId: type === 'service-detail' ? 'sheet-metal' : undefined };
    const m = meta.getMeta(route);
    assert(typeof m.title === 'string' && m.title.length > 5, `${lang}/${type} has title: "${m.title.slice(0,60)}"`);
    assert(typeof m.description === 'string' && m.description.length > 10, `${lang}/${type} has description`);
    assert(noMojibake(m.title + m.description), `${lang}/${type} meta is clean UTF-8`);
  }
}

console.log('\n=== renderHomepage (all 14 langs) ===');
for (const lang of ALL_LANGS) {
  const r = home.renderHomepage(lang);
  const len = bodyLen(r.bodyHtml);
  assert(len >= 800, `${lang} homepage body length ${len} >= 800`);
  assert(r.bodyHtml.includes('<h1>'), `${lang} homepage has h1`);
  assert(r.bodyHtml.includes('<h2>'), `${lang} homepage has h2`);
  assert(r.jsonLd.length >= 2, `${lang} homepage has >=2 JSON-LD blocks`);
  assert(noMojibake(r.bodyHtml), `${lang} homepage body is clean UTF-8`);
  for (const js of r.jsonLd) JSON.parse(js);
}

console.log('\n=== renderServicesIndex (all 14 langs) ===');
for (const lang of ALL_LANGS) {
  const r = svcIdx.renderServicesIndex(lang);
  const len = bodyLen(r.bodyHtml);
  assert(len >= 500, `${lang} services-index body length ${len} >= 500`);
  assert(r.bodyHtml.includes(slugs.localizedPath(lang, 'service-detail', 'cnc-machining')),
    `${lang} services-index links to cnc detail`);
  assert(noMojibake(r.bodyHtml), `${lang} services-index body is clean UTF-8`);
  for (const js of r.jsonLd) JSON.parse(js);
}

console.log('\n=== renderServiceDetail (all 14 langs x 6 services = 84) ===');
for (const lang of ALL_LANGS) {
  for (const sid of serviceIds) {
    const r = svcDet.renderServiceDetail(lang, sid);
    const len = bodyLen(r.bodyHtml);
    assert(len >= 800, `${lang}/${sid} detail body length ${len} >= 800`);
    assert(r.bodyHtml.includes('<h1>'), `${lang}/${sid} has h1`);
    assert(r.bodyHtml.includes(`aria-label="breadcrumb"`), `${lang}/${sid} has breadcrumbs`);
    assert(noMojibake(r.bodyHtml), `${lang}/${sid} body is clean UTF-8`);
    for (const js of r.jsonLd) JSON.parse(js);
  }
}

console.log('\n=== renderIndustries (all 14 langs) ===');
for (const lang of ALL_LANGS) {
  const r = ind.renderIndustries(lang);
  const len = bodyLen(r.bodyHtml);
  assert(len >= 500, `${lang} industries body length ${len} >= 500`);
  assert(noMojibake(r.bodyHtml), `${lang} industries body is clean UTF-8`);
  for (const js of r.jsonLd) JSON.parse(js);
}

console.log('\n=== renderSimplePage (all 14 langs x 4 types = 56) ===');
for (const lang of ALL_LANGS) {
  for (const type of ['about','contact','quote','our-work']) {
    const r = simple.renderSimplePage(lang, type);
    const len = bodyLen(r.bodyHtml);
    assert(len >= 300, `${lang}/${type} simple body length ${len} >= 300`);
    assert(noMojibake(r.bodyHtml), `${lang}/${type} simple body is clean UTF-8`);
    for (const js of r.jsonLd) JSON.parse(js);
  }
}

console.log('\n=== renderBlogIndex (all 14 langs) ===');
for (const lang of ALL_LANGS) {
  const r = await blog.renderBlogIndex(lang, async () => []);
  assert(r.bodyHtml.includes('<h1>'), `${lang} blog-index has h1`);
  assert(noMojibake(r.bodyHtml), `${lang} blog-index body is clean UTF-8`);
  for (const js of r.jsonLd) JSON.parse(js);
}

console.log('\n=== UTF-8 spot-checks on body output ===');
const ptDetail = svcDet.renderServiceDetail('pt', 'sheet-metal');
assert(!/Ã[£§¡©¶¼Ÿ]/.test(ptDetail.bodyHtml), 'pt sheet-metal body is clean UTF-8');
assert(ptDetail.bodyHtml.includes('ç') || ptDetail.bodyHtml.toLowerCase().includes('chapa'),
  'pt sheet-metal body contains Portuguese diacritics or "chapa"');

// ─── Worker modules (docs/migration/SEO_PARITY.md §6 row 3; PLAN.md §5.1 item 6) ───────────────────────────
//
// (a) the redirect table of workers/site/src/redirects.ts against vercel.json and SEORedirects.tsx;
// (b) route decisions: parseRoute of middleware.ts:334-346 (not exported there, so re-exported by an esbuild
//     onLoad plugin that appends one export line to the bundled copy; the file on disk is never changed)
//     against the Worker's parseRoute, for every G7 soft-404 probe, every offline-parity fixture path, the 210
//     prerender routes (G1), the G9 path variants and a set of encoding edge cases;
// (c) offline document parity (middleware.ts vs handleSeo, byte-identical HTML and headers on recorded Supabase
//     responses) is NOT repeated here: it is workers/site/test/seo-parity.test.ts (vitest, no network), run by
//     `npm --prefix workers/site test` / `npm run cf:test`, over the 51 cases of
//     workers/site/test/fixtures/seo/cases.json (38 documents, 13 undefined/null).

const { isDeepStrictEqual } = await import('node:util');
const MIDDLEWARE_TS = path.join(ROOT, 'middleware.ts');
const exposeMiddlewareParseRoute = {
  name: 'smoke-expose-middleware-parseRoute',
  setup(b) {
    b.onLoad({ filter: /[\\/]middleware\.ts$/ }, async (args) => {
      if (path.resolve(args.path) !== MIDDLEWARE_TS) return undefined;
      const source = await readFile(MIDDLEWARE_TS, 'utf8');
      return {
        contents: `${source}\nexport { parseRoute as __smokeParseRoute };\n`,
        loader: 'ts',
        resolveDir: ROOT,
      };
    });
  },
};

await build({
  entryPoints: {
    'worker-redirects': path.join(ROOT, 'workers/site/src/redirects.ts'),
    'worker-seo': path.join(ROOT, 'workers/site/src/seo/handler.ts'),
    'vercel-middleware': MIDDLEWARE_TS,
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: OUT_DIR,
  loader: { '.json': 'json' },
  platform: 'neutral',
  logLevel: 'silent',
  plugins: [exposeMiddlewareParseRoute],
});

const wkRedirects = await import(path.join(OUT_DIR, 'worker-redirects.js'));
const wkSeo = await import(path.join(OUT_DIR, 'worker-seo.js'));
const vercelMw = await import(path.join(OUT_DIR, 'vercel-middleware.js'));

console.log('\n=== Worker redirect table (workers/site/src/redirects.ts) ===');
const vercelJsonBytes = await readFile(path.join(ROOT, 'vercel.json'));
const vercelRedirects = JSON.parse(vercelJsonBytes.toString('utf8')).redirects;
const table = wkRedirects.REDIRECTS;
assert(table.length === 28, `redirect table has 28 entries (got ${table.length})`);
assert(table.every((r, i) => r.id === `RD-${String(i + 1).padStart(2, '0')}`), 'ids are RD-01 ... RD-28 in order');
assert(new Set(table.map((r) => r.source)).size === table.length, 'sources are unique');
assert(vercelRedirects.length === 25, `vercel.json has 25 redirects (got ${vercelRedirects.length})`);
for (let i = 0; i < 25; i += 1) {
  const r = table[i];
  const v = vercelRedirects[i] || {};
  assert(r.origin === 'vercel' && r.source === v.source && r.destination === v.destination && v.permanent === true,
    `${r.id} equals vercel.json redirects[${i}] (${JSON.stringify(v.source)} -> ${v.destination}, permanent)`);
}
for (const r of table.slice(25)) assert(r.origin === 'client', `${r.id} is a client-only entry (${r.source})`);

// RD-12: the source string must be byte-identical to the "source" value on vercel.json:59.
const vercelLines = vercelJsonBytes.toString('latin1').split('\n');
const line59 = Buffer.from(vercelLines[58] ?? '', 'latin1');
const line59Match = /^\s*"source": "(.*)",\s*$/s.exec(line59.toString('latin1'));
const rd12 = table.find((r) => r.id === 'RD-12');
const rd12Bytes = Buffer.from(rd12.source, 'utf8');
const line59Bytes = line59Match ? Buffer.from(line59Match[1], 'latin1') : Buffer.alloc(0);
assert(line59Match !== null, 'vercel.json:59 is a "source" line');
assert(rd12Bytes.equals(line59Bytes), `RD-12 source is byte-identical to vercel.json:59 (${rd12Bytes.toString('hex')})`);
assert(rd12Bytes.includes(Buffer.from([0xc3, 0x85, 0xc2, 0x84])), 'RD-12 keeps the mojibake bytes C3 85 C2 84');

// RD-26 ... RD-28 come from the client map in src/components/SEORedirects.tsx.
const seoRedirectsTsx = await readFile(path.join(ROOT, 'src/components/SEORedirects.tsx'), 'utf8');
for (const r of table.slice(25)) {
  assert(seoRedirectsTsx.includes(`'${r.source}': '${r.destination}'`), `${r.id} pair is in SEORedirects.tsx REDIRECT_MAP`);
}

// Every source answers 308 through matchRedirect, with the destination as Location (no query on the request).
const requestUrlFor = (source) => {
  // Send the source as its percent-encoded UTF-8 bytes, as a client would (RD-12, RD-28 are non-ASCII).
  const u = new URL('https://www.micronshub.eu/');
  u.pathname = source;
  return u;
};
for (const r of table) {
  const res = wkRedirects.matchRedirect(requestUrlFor(r.source));
  assert(res !== null && res.status === 308 && res.headers.get('location') === r.destination,
    `${r.id} ${requestUrlFor(r.source).pathname} -> 308 ${res ? res.headers.get('location') : 'null'}`);
}
{
  const res = wkRedirects.matchRedirect(new URL('https://www.micronshub.eu/pl/wyko%C5%84czenie-powierzchni'));
  assert(res !== null && res.status === 308 && res.headers.get('location') === '/pl/uslugi/wykonczenie-powierzchni',
    'RD-28 encoded form /pl/wyko%C5%84czenie-powierzchni -> 308 (SEORedirects.tsx:40)');
  const none = wkRedirects.matchRedirect(new URL('https://www.micronshub.eu/en/services'));
  assert(none === null, '/en/services is not a redirect');
}

console.log('\n=== Route decisions: middleware.ts parseRoute vs Worker parseRoute ===');
const mwParse = vercelMw.__smokeParseRoute;
const wkParse = wkSeo.parseRoute;
assert(typeof mwParse === 'function' && typeof wkParse === 'function', 'both parseRoute functions are loaded');

// G7 soft-404 probes (SEO_PARITY.md §7.1), en and fi; S-05 uses a real article slug per language (fixture rows).
const G7 = [
  ['S-01', '/en/zz-parity-404', '/fi/zz-parity-404'],
  ['S-02', '/en/zz-parity-404/zz', '/fi/zz-parity-404/zz'],
  ['S-03', '/en/services/zz-parity-404', '/fi/palvelut/zz-parity-404'],
  ['S-04', '/en/blog/zz-parity-404', '/fi/blogi/zz-parity-404'],
  ['S-05', '/en/blog/spot-welding-vs-riveting-strength-comparisons-for-assembly/zz',
    '/fi/blogi/pistehitsaus-vs-niittaus-lujuusvertailut-kokoonpanoissa/zz'],
  ['S-06', '/en/about/zz-parity-404', '/fi/meista/zz-parity-404'],
  ['S-07', '/en/services/cnc-machining/zz', '/fi/palvelut/cnc-työstö/zz'],
  ['S-08', '/en/zz/zz/zz', '/fi/zz/zz/zz'],
  ['S-09', '/en/about.html', '/fi/meista.html'],
  ['S-10', '/EN/about', '/FI/meista'],
  ['S-11', '/el/login', '/xx/about'],
];
// Expected outcome of the route decision per class: a parent document (S-06, S-07), no route (S-10, S-11), or
// a route that the handler turns into "no document" (the soft-404 class the Worker logs as would_404).
const PARENT_TYPE = { 'S-06': 'about', 'S-07': 'service-detail' };
const pathnameOf = (p) => new URL(p, 'https://www.micronshub.eu').pathname;
const segsOf = (pathname) => {
  const m = pathname.match(/^\/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)(\/(.*))?$/);
  if (!m) return null;
  const rest = (m[3] || '').replace(/\/$/, '');
  return { lang: m[1], segs: rest ? rest.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }) : [] };
};
let decisions = 0;
const compareDecision = (label, p) => {
  const pathname = pathnameOf(p);
  const run = (fn) => { try { return fn(pathname); } catch (err) { return { thrown: String(err) }; } };
  const a = run(mwParse);
  const b = run(wkParse);
  decisions += 1;
  if (!isDeepStrictEqual(a, b)) {
    assert(false, `${label} ${pathname}: middleware.ts ${JSON.stringify(a)} != Worker ${JSON.stringify(b)}`);
    return null;
  }
  return a;
};
for (const [cls, ...probes] of G7) {
  for (const p of probes) {
    const route = compareDecision(`G7 ${cls}`, p);
    const pathname = pathnameOf(p);
    if (cls === 'S-10' || cls === 'S-11') {
      assert(route === null, `G7 ${cls} ${pathname}: no route on both (non-language path)`);
    } else if (PARENT_TYPE[cls]) {
      assert(route !== null && route.type === PARENT_TYPE[cls], `G7 ${cls} ${pathname}: parent ${PARENT_TYPE[cls]} on both`);
    } else {
      const lp = segsOf(pathname);
      const got = wkSeo.soft404Class(lp.lang, lp.segs, route);
      assert(got === cls, `G7 ${cls} ${pathname}: equal decision (${route ? route.type : 'null'}), Worker class ${got}`);
    }
  }
}

// Offline-parity fixture paths (workers/site/test/fixtures/seo/cases.json).
const fixtureCases = JSON.parse(await readFile(path.join(ROOT, 'workers/site/test/fixtures/seo/cases.json'), 'utf8')).cases;
for (const c of fixtureCases) compareDecision('fixture', c.path);
assert(fixtureCases.length >= 30, `fixture paths compared: ${fixtureCases.length}`);

// G1: the 210 prerender routes (vite.config.ts buildPrerenderRoutes, loaded the way the parity tool does).
const { loadSources } = await import(url.pathToFileURL(path.join(ROOT, 'scripts/seo-parity/lib/sources.mjs')).href);
const sources = await loadSources(ROOT);
const prerenderRoutes = sources.buildPrerenderRoutes();
assert(prerenderRoutes.length === 210, `G1 prerender routes: ${prerenderRoutes.length}`);
let g1Failures = 0;
for (const r of prerenderRoutes) {
  const route = compareDecision('G1', r);
  if (route === null || route.type === 'other') g1Failures += 1;
}
assert(g1Failures === 0, `G1: every prerender route resolves to a document route on both (${g1Failures} without)`);

// G9 path variants and encoding edge cases.
const EXTRA = [
  '/', '/EN', '/en', '/en/', '/en/services/', '/en//services', '/de/services', '/en/index.html',
  '/fi/palvelut/index.html', '/zohoverify', '/laserkritis', '/zz-parity-404', '/services', '/reset-password',
  '/deorcamento', '/en/dawycena', '/pl/wyko%C5%84czenie-powierzchni', '/pl/wyko%C3%85%C2%84czenie-powierzchni',
  '/fi/palvelut/cnc-ty%C3%B6st%C3%B6', '/fi/palvelut/cnc-tyo%CC%88sto%CC%88', '/en/%E0%A4%A', '/en/blog/%ZZ',
  '/en/blog/a/b/c', '/en//', '/en///', '/en/services//cnc-machining/', '/cs/vzdelavani', '/cs/odvetvi', '/cs/prumysl',
  '/en/login', '/en/quote/success', '/de/angebot/erfolg', '/en/quote-request', '/en/legal-notice', '/enx',
  '/en-gb', '/en.html', '/sitemap.xml', '/api/sitemap', '/robots.txt',
];
for (const p of EXTRA) compareDecision('edge', p);
assert(decisions > 300, `route decisions compared: ${decisions}, all equal unless listed above`);

console.log('\n=== Summary ===');
if (fails === 0) {
  console.log(`All smoke tests passed.`);
  process.exit(0);
} else {
  console.log(`FAIL (${fails} assertion(s) failed).`);
  process.exit(1);
}
