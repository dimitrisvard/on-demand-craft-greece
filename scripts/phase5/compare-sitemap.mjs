#!/usr/bin/env node
// Compares two sitemap files (Phase 5 switch-over step S4): the shadow copy written by the Worker
// (R2 phase5-shadow/sitemaps/<date>/sitemap-complete.xml) and the object the live generator wrote to Storage.
//
//   node scripts/phase5/compare-sitemap.mjs <a.xml> <b.xml>
//   node scripts/phase5/compare-sitemap.mjs --self-test
//
// Report: byte identity (SHA-256), URL counts, URLs missing on either side, entries that differ in anything but
// <lastmod>, entries whose <lastmod> differs, and whether the entry order is the same. Equal updated_at values have
// no fixed order in the live query, so order is reported but does not decide the result.
// <lastmod> rule: only the static pages carry the day of generation (generator v19), so a static entry may differ
// in <lastmod> when each side shows its own file's generation day (the one <lastmod> all static entries of that
// file share). Article <lastmod> comes from the database and must be equal; any other difference is DIFFERENT.
// An article entry is a URL /<lang>/<blog segment>/<slug> with the blog segment blog, blogg or blogi.
// Exit code 0 = EQUIVALENT (same URL set, every entry equal apart from the allowed <lastmod>), 1 = DIFFERENT,
// 2 = usage error. Reads local files only; it never fetches anything.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The <url> entries of a sitemap: loc -> {lastmod, rest (the entry without lastmod), index}. */
export function parseSitemap(xml) {
  const entries = new Map();
  const order = [];
  const duplicates = [];
  const re = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(block)?.[1] ?? '';
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/.exec(block)?.[1] ?? null;
    const rest = block.replace(/<lastmod>[\s\S]*?<\/lastmod>/, '<lastmod/>');
    if (entries.has(loc)) duplicates.push(loc);
    entries.set(loc, { lastmod, rest, index: order.length });
    order.push(loc);
  }
  return { entries, order, duplicates };
}

/** True for a blog article URL: /<lang>/<blog|blogg|blogi>/<slug>. */
export function isArticleLoc(loc) {
  let path;
  try {
    path = new URL(loc.replace(/&amp;/g, '&')).pathname;
  } catch {
    return false;
  }
  const parts = path.split('/').filter(Boolean);
  return parts.length === 3 && ['blog', 'blogg', 'blogi'].includes(parts[1]);
}

/** The generation day of a parsed sitemap: the <lastmod> shared by all its static entries, else null. */
export function generationDay(parsed) {
  const days = new Set();
  for (const loc of parsed.order) if (!isArticleLoc(loc)) days.add(parsed.entries.get(loc).lastmod);
  return days.size === 1 ? [...days][0] : null;
}

/** The comparison of two sitemap texts. */
export function compareSitemaps(a, b) {
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const pa = parseSitemap(a);
  const pb = parseSitemap(b);
  const dayA = generationDay(pa);
  const dayB = generationDay(pb);
  const missingInB = pa.order.filter((loc) => !pb.entries.has(loc));
  const missingInA = pb.order.filter((loc) => !pa.entries.has(loc));
  const differing = [];
  const lastmodOnly = [];
  const lastmodNotAllowed = [];
  for (const loc of pa.order) {
    const x = pa.entries.get(loc);
    const y = pb.entries.get(loc);
    if (!y) continue;
    if (x.rest !== y.rest) differing.push(loc);
    else if (x.lastmod !== y.lastmod) {
      lastmodOnly.push(loc);
      const generationDayOnly = !isArticleLoc(loc) && dayA !== null && dayB !== null && x.lastmod === dayA && y.lastmod === dayB;
      if (!generationDayOnly) lastmodNotAllowed.push(loc);
    }
  }
  const headA = a.slice(0, a.indexOf('<url>') >= 0 ? a.indexOf('<url>') : a.length);
  const headB = b.slice(0, b.indexOf('<url>') >= 0 ? b.indexOf('<url>') : b.length);
  const sameOrder = pa.order.length === pb.order.length && pa.order.every((loc, i) => pb.order[i] === loc);
  const equivalent =
    missingInA.length === 0 &&
    missingInB.length === 0 &&
    differing.length === 0 &&
    lastmodNotAllowed.length === 0 &&
    headA === headB &&
    pa.duplicates.length === 0 &&
    pb.duplicates.length === 0;
  return {
    bytesIdentical: a === b,
    shaA: sha(a),
    shaB: sha(b),
    urlsA: pa.order.length,
    urlsB: pb.order.length,
    generationDayA: dayA,
    generationDayB: dayB,
    missingInA,
    missingInB,
    differing,
    lastmodOnly,
    lastmodNotAllowed,
    duplicates: [...pa.duplicates, ...pb.duplicates],
    headerEqual: headA === headB,
    sameOrder,
    equivalent,
  };
}

function report(r) {
  const lines = [
    `bytes: ${r.bytesIdentical ? 'identical' : 'different'} (sha256 a=${r.shaA.slice(0, 16)} b=${r.shaB.slice(0, 16)})`,
    `urls: a=${r.urlsA} b=${r.urlsB}`,
    `missing in b: ${r.missingInB.length}${r.missingInB.length ? ` (first: ${r.missingInB.slice(0, 5).join(' ')})` : ''}`,
    `missing in a: ${r.missingInA.length}${r.missingInA.length ? ` (first: ${r.missingInA.slice(0, 5).join(' ')})` : ''}`,
    `entries differing apart from lastmod: ${r.differing.length}${r.differing.length ? ` (first: ${r.differing.slice(0, 5).join(' ')})` : ''}`,
    `entries differing in lastmod only: ${r.lastmodOnly.length}`,
    `generation day (static lastmod): a=${r.generationDayA ?? 'none'} b=${r.generationDayB ?? 'none'}`,
    `lastmod differences other than the generation day of static pages: ${r.lastmodNotAllowed.length}${r.lastmodNotAllowed.length ? ` (first: ${r.lastmodNotAllowed.slice(0, 5).join(' ')})` : ''}`,
    `duplicate locs: ${r.duplicates.length}`,
    `header: ${r.headerEqual ? 'equal' : 'different'}`,
    `order: ${r.sameOrder ? 'same' : 'different'}`,
    `RESULT: ${r.equivalent ? 'EQUIVALENT' : 'DIFFERENT'}`,
  ];
  return lines.join('\n');
}

function sample(o = {}) {
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  const entry = (loc, lastmod, extra = '') =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>${extra}\n  </url>`;
  const day = o.day ?? '2026-10-08';
  let list = [
    entry('https://www.micronshub.eu/en', day, '\n    <xhtml:link rel="alternate" hreflang="de" href="https://www.micronshub.eu/de"/>'),
    entry('https://www.micronshub.eu/de', o.secondStaticDay ?? day),
    entry('https://www.micronshub.eu/en/blog/a', o.articleDay ?? '2026-09-01'),
    entry('https://www.micronshub.eu/fi/blogi/ty%C3%B6st%C3%B6', '2026-09-02'),
  ];
  if (o.reorder) list = [list[0], list[1], list[3], list[2]];
  if (o.drop) list = list.slice(0, 3);
  if (o.hreflang) list[0] = list[0].replace('hreflang="de"', 'hreflang="fr"');
  return `${head}${list.join('\n')}\n</urlset>`;
}

function selfTest() {
  // the pattern of each case: [name, a, b, expected equivalent, expected bytes identical]
  const cases = [
    ['identical files', sample(), sample(), true, true],
    ['static lastmod of another day', sample(), sample({ day: '2026-10-09' }), true, false],
    ['equal set in another order', sample(), sample({ reorder: true }), true, false],
    ['a URL missing', sample(), sample({ drop: true }), false, false],
    ['an hreflang link changed', sample(), sample({ hreflang: true }), false, false],
    ['an article lastmod changed', sample(), sample({ articleDay: '2026-08-31' }), false, false],
    ['an article lastmod set to the generation day', sample(), sample({ articleDay: '2026-10-08' }), false, false],
    ['static lastmods of one file disagree', sample(), sample({ day: '2026-10-09', secondStaticDay: '2026-10-07' }), false, false],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'compare-sitemap-'));
  let failures = 0;
  try {
    for (const [name, a, b, eq, same] of cases) {
      const fa = join(dir, 'a.xml');
      const fb = join(dir, 'b.xml');
      writeFileSync(fa, a);
      writeFileSync(fb, b);
      const r = compareSitemaps(readFileSync(fa, 'utf8'), readFileSync(fb, 'utf8'));
      const ok = r.equivalent === eq && r.bytesIdentical === same;
      if (!ok) failures++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${r.equivalent ? 'EQUIVALENT' : 'DIFFERENT'}`);
    }
    const reordered = compareSitemaps(sample(), sample({ reorder: true }));
    if (reordered.sameOrder) {
      failures++;
      console.log('FAIL order change not reported');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`self-test FAILED (${failures})`);
    return 1;
  }
  console.log('self-test ok');
  return 0;
}

function main(argv) {
  if (argv[0] === '--self-test') return selfTest();
  if (argv.length !== 2) {
    console.error('usage: node scripts/phase5/compare-sitemap.mjs <a.xml> <b.xml> | --self-test');
    return 2;
  }
  const r = compareSitemaps(readFileSync(argv[0], 'utf8'), readFileSync(argv[1], 'utf8'));
  console.log(report(r));
  return r.equivalent ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
