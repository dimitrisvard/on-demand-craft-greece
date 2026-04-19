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

console.log('\n=== Summary ===');
if (fails === 0) {
  console.log(`All smoke tests passed.`);
  process.exit(0);
} else {
  console.log(`FAIL (${fails} assertion(s) failed).`);
  process.exit(1);
}
