// Per-entry comparison (SEO_PARITY.md §2.1–§2.4).
//
// Records compared here have the same shape whether they come from a live
// capture or a snapshot (see run.mjs `captureSide`):
//   { methods: { GET: { hops, attempts, error, stop }, HEAD: {...}, OPTIONS: {...} } }
// Each diff is { field, sub?, hop?, base, candidate, rule? }.

import { IGNORED_HEADER_PREFIXES, IGNORED_HEADERS, OWN_RULE_HEADERS } from './constants.mjs';
import { blogIndexArticleList, extractHtml, htmlF23Parts, parseSitemap } from './extract.mjs';
import { canonicalJson, deepEqual, multisetSubset, sha256 } from './util.mjs';
import { articleListShift, publishedKey } from './volatile.mjs';

const ignored = (name) => IGNORED_HEADERS.has(name) || IGNORED_HEADER_PREFIXES.some((p) => name.startsWith(p));

export const norm = {
  F5: (v) => (v == null ? null : v.trim().toLowerCase().replace(/\s*;\s*/g, ';')),
  F6: (v) => (v == null ? null : v.trim()),
  F7: (v) => (v == null ? null : [...new Set(v.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].sort()),
  F8: (v) => (v == null ? null : [...new Set(v.split(';').map((t) => t.trim().toLowerCase()).filter(Boolean))].sort()),
  F9: (v) => (v == null ? null : v),
  F10: (v) => (v == null ? null : v.trim().toLowerCase()),
  F11: (v) => (v == null ? null : v.trim()),
};

const HEADER_FIELDS = [
  ['content-type', 'F5'], ['cache-control', 'F6'], ['vary', 'F7'],
  ['strict-transport-security', 'F8'], ['x-seo-source', 'F9'],
];

const isRedirect = (h) => h && h.status >= 300 && h.status < 400 && h.location;

/** Replace the candidate origin by the base origin (F2, F3, F22). */
export function originNormaliser(baseOrigin, candOrigin) {
  return (side, s) => {
    if (side !== 'candidate' || s == null || baseOrigin === candOrigin) return s;
    if (s === candOrigin) return baseOrigin;
    if (s.startsWith(`${candOrigin}/`) || s.startsWith(`${candOrigin}?`)) return baseOrigin + s.slice(candOrigin.length);
    return s;
  };
}

/** Header comparison F5–F11 plus Set-Cookie names and the role rules. */
export function compareHeaders(b, c, ctx, extra = {}) {
  const diffs = [];
  const bh = b.headers || {};
  const ch = c.headers || {};
  const add = (field, sub, base, candidate, rule) => diffs.push({ field, ...(sub ? { sub } : {}), ...extra, base, candidate, ...(rule ? { rule } : {}) });
  for (const [name, field] of HEADER_FIELDS) {
    const bv = norm[field](bh[name] ?? null);
    const cv = norm[field](ch[name] ?? null);
    if (!deepEqual(bv, cv)) add(field, null, bv, cv);
  }
  // F10 X-Robots-Tag per role.
  const bx = norm.F10(bh['x-robots-tag'] ?? null);
  const cx = norm.F10(ch['x-robots-tag'] ?? null);
  if (ctx.role === 'preview') {
    if (cx !== 'noindex') add('F10', null, bx, cx, 'preview candidate must send exactly "noindex"');
  } else if (bx !== cx) add('F10', null, bx, cx, 'production candidate must equal base');
  // F11 every other header, deny by default.
  const names = new Set([...Object.keys(bh), ...Object.keys(ch)]);
  for (const name of [...names].sort()) {
    if (ignored(name) || OWN_RULE_HEADERS.has(name)) continue;
    const bv = norm.F11(bh[name] ?? null);
    const cv = norm.F11(ch[name] ?? null);
    if (bv !== cv) add('F11', name, bv, cv);
  }
  // Set-Cookie: names compared (values recorded as hashes only).
  const bn = (b.set_cookies || []).map((x) => x.name);
  let cn = (c.set_cookies || []).map((x) => x.name);
  if (ctx.role === 'preview') cn = cn.filter((n) => n !== 'CF_Authorization');
  if (!deepEqual([...bn].sort(), [...cn].sort())) add('F11', 'set-cookie', [...bn].sort(), [...cn].sort());
  if (ctx.role === 'production' && cn.includes('__cf_bm')) add('F11', '__cf_bm', bn.includes('__cf_bm') ? '__cf_bm' : null, '__cf_bm', 'a __cf_bm cookie on a production candidate means a bot feature is on (§8)');
  return diffs;
}

const chainOf = (hops, side, n) => hops.filter(isRedirect).map((h) => [h.status, n(side, h.location)]);
const finalOf = (hops, side, n) => {
  const last = hops[hops.length - 1];
  if (!last) return null;
  return n(side, isRedirect(last) ? last.location : last.url);
};

function compareDocument(be, ce, ctx, n, entry) {
  const diffs = [];
  const add = (field, base, candidate, extra = {}) => diffs.push({ field, ...extra, base, candidate });
  if (be.F13 !== ce.F13) add('F13', be.F13, ce.F13);
  for (const f of ['F14', 'F15', 'F16']) if (!deepEqual(be[f], ce[f])) add(f, be[f], ce[f]);
  // F17: multiset, order-insensitive (already sorted at extraction).
  if (!deepEqual(be.F17, ce.F17)) {
    const volatile = ctx.snapshotMode && entry.kind === 'blog-article';
    if (!(volatile && multisetSubset(be.F17, ce.F17))) add('F17', be.F17, ce.F17, volatile ? { rule: 'snapshot mode: base ⊆ candidate' } : {});
  }
  const props = new Set([...Object.keys(be.F18 || {}), ...Object.keys(ce.F18 || {})]);
  for (const p of [...props].sort()) {
    const bv = be.F18?.[p] ?? null; const cv = ce.F18?.[p] ?? null;
    if (!deepEqual(bv, cv)) add('F18', bv, cv, { sub: p });
  }
  const robots = (r) => ({ robots: [...(r?.robots || [])].map((x) => x.join(',')).sort(), googlebot: [...(r?.googlebot || [])].map((x) => x.join(',')).sort() });
  if (!deepEqual(robots(be.F19), robots(ce.F19))) add('F19', robots(be.F19), robots(ce.F19));
  if (!deepEqual(be.F20, ce.F20)) add('F20', be.F20, ce.F20, (be.F20_invalid || ce.F20_invalid) ? { flag: 'jsonld_invalid' } : {});
  const b21 = be.F21; const c21 = ce.F21;
  if (!b21 !== !c21) add('F21', b21 ? 'present' : null, c21 ? 'present' : null, { sub: 'article' });
  else if (b21 && c21) {
    if (b21.sha256 !== c21.sha256) add('F21', b21.sha256, c21.sha256, { sub: 'text', base_length: b21.length, candidate_length: c21.length });
    if (b21.lang !== c21.lang) add('F21', b21.lang, c21.lang, { sub: 'lang' });
  }
  const b22 = be.F22 || [];
  const c22 = (ce.F22 || []).map((x) => { const i = x.indexOf(' '); return x.slice(0, i + 1) + n('candidate', x.slice(i + 1)); }).sort();
  // Blog index pages in snapshot mode: see the blog-index-article-list rule
  // in compareEntry (the article list as a whole, not F22 alone).
  if (!deepEqual(b22, c22)) add('F22', b22, c22);
  const assets = (a) => (ctx.normaliseAssetHashes ? a.map((x) => x.replace(/-[A-Za-z0-9_-]{8}\.([A-Za-z0-9]+)$/, '-[hash].$1')) : a);
  if (!deepEqual(assets(be.F25 || []), assets(ce.F25 || []))) add('F25', be.F25 || [], ce.F25 || []);
  if (ctx.normaliseAssetHashes) {
    const pairs = [];
    const ba = be.F25 || []; const ca = ce.F25 || [];
    for (let i = 0; i < Math.min(ba.length, ca.length); i++) if (ba[i] !== ca[i]) pairs.push([ba[i], ca[i]]);
    if (pairs.length) ctx.assetPairs?.push(...pairs);
  }
  return diffs;
}

// Fields the blog index article list feeds (ItemList JSON-LD, #seo-content
// text and links, the normalised document).
const ARTICLE_LIST_FIELDS = new Set(['F20', 'F21', 'F22', 'F23']);

const hasSeoSource = (hop) => Object.prototype.hasOwnProperty.call(hop.headers || {}, 'x-seo-source');

/**
 * What the base snapshot shows as published at capture time for one language
 * (rule blog-index-article-list): the <loc> values of its /sitemap-<lang>.xml,
 * /sitemap-complete.xml and /api/sitemap records (the whole snapshot, not only
 * the selected entries; final response 200 with a parsable urlset), and the
 * URLs of its URL set. Cached per language on ctx.
 * @returns { sitemapHas, where, source } or { error }
 */
export function publishedAtCapture(ctx, lang) {
  ctx.publishedCache ||= new Map();
  if (ctx.publishedCache.has(lang)) return ctx.publishedCache.get(lang);
  const wanted = [`/sitemap-${lang}.xml`, '/sitemap-complete.xml', '/api/sitemap'];
  const sitemaps = new Map();
  for (const rec of ctx.baseCapture?.records?.values() || []) {
    if (!wanted.includes(rec.url) || sitemaps.has(rec.url)) continue;
    const last = rec.methods?.GET?.hops?.at(-1);
    if (!last || last.status !== 200 || last.extracted?.family !== 'xml') continue;
    const body = ctx.bodies.base.get(last.body_sha256);
    if (!body) continue;
    const sm = parseSitemap(body.toString('utf8'));
    if (sm.error || sm.root !== 'urlset') continue;
    sitemaps.set(rec.url, new Set([...sm.entries.keys()].map(publishedKey)));
  }
  let out;
  if (!sitemaps.size) {
    out = { error: `the base snapshot holds no usable sitemap record (${wanted.join(', ')}: final response 200 with a urlset) to tell articles published since the capture from older ones` };
  } else {
    const urlSet = new Set((ctx.baseCapture.urls?.entries || []).map((e) => publishedKey(e.url)));
    const listed = [...sitemaps.entries()];
    const sitemapOf = (k) => listed.find(([, s]) => s.has(k))?.[0] ?? null;
    out = {
      source: listed.map(([u]) => u).join(', '),
      sitemapHas: (k) => sitemapOf(k) !== null,
      where: (k) => sitemapOf(k) ?? (urlSet.has(k) ? 'the base URL set' : null),
    };
  }
  ctx.publishedCache.set(lang, out);
  return out;
}

/**
 * Rule blog-index-article-list (volatile.mjs), snapshot mode only: the
 * article list changed only by articles published since the capture, listed
 * first, and the documents with the list replaced by a marker are equal in
 * every field.
 * @returns { ok, added, dropped } or { ok: false, reason }
 */
function blogIndexListRule(bl, cl, ctx, n, entry) {
  const bb = ctx.bodies.base.get(bl.body_sha256);
  const cb = ctx.bodies.candidate.get(cl.body_sha256);
  if (!bb || !cb) return { ok: false, reason: 'body not stored' };
  const lb = blogIndexArticleList(bb.toString('utf8'));
  const lc = blogIndexArticleList(cb.toString('utf8'));
  if (lb.error || lc.error) return { ok: false, reason: `article list not recognised (base: ${lb.error || 'ok'}; candidate: ${lc.error || 'ok'})` };
  const shift = articleListShift(lb.items, lc.items, entry.url, publishedAtCapture(ctx, entry.url.split('/')[1]));
  // An unchanged list explains nothing: the differences are elsewhere.
  if (shift.ok && shift.unchanged) return { ok: false, reason: 'the article list is unchanged; the differences are outside it' };
  if (!shift.ok) return { ok: false, reason: `article list: ${shift.reason}` };
  const reduced = (text, hop) => ({
    ...extractHtml(text, { linkHeader: hop.headers?.link || null }),
    F23_list_free: sha256(htmlF23Parts(text).render({ normaliseAssetHashes: ctx.normaliseAssetHashes })),
  });
  const rb = reduced(lb.reduced, bl);
  const rc = reduced(lc.reduced, cl);
  const rest = compareDocument(rb, rc, { ...ctx, assetPairs: null }, n, entry).map((d) => d.field);
  if (rb.F23_list_free !== rc.F23_list_free) rest.push('F23');
  if (rest.length) return { ok: false, reason: `the document outside the article list differs (${[...new Set(rest)].join(', ')})` };
  return { ok: true, added: shift.added, dropped: shift.dropped };
}

function compareSitemaps(bodyB, bodyC, ctx, newUrls) {
  const bs = parseSitemap(bodyB.toString('utf8'));
  const cs = parseSitemap(bodyC.toString('utf8'));
  const diffs = [];
  if (bs.error || cs.error) {
    diffs.push({ field: 'F26', sub: 'parse', base: bs.error || null, candidate: cs.error || null });
    return diffs;
  }
  if (bs.root !== cs.root) diffs.push({ field: 'F26', sub: 'root', base: bs.root, candidate: cs.root });
  const removed = [...bs.entries.keys()].filter((l) => !cs.entries.has(l));
  const added = [...cs.entries.keys()].filter((l) => !bs.entries.has(l));
  if (removed.length) diffs.push({ field: 'F26', sub: 'loc-removed', base: removed.length, candidate: 0, examples: removed.slice(0, 20) });
  if (added.length) {
    if (ctx.snapshotMode) newUrls.push(...added);
    else diffs.push({ field: 'F26', sub: 'loc-added', base: 0, candidate: added.length, examples: added.slice(0, 20) });
  }
  const changed = [];
  for (const [loc, b] of bs.entries) {
    const c = cs.entries.get(loc);
    if (!c) continue;
    const what = [];
    if (b.changefreq !== c.changefreq) what.push('changefreq');
    if (b.priority !== c.priority) what.push('priority');
    if (b.lastmod !== c.lastmod) {
      // Snapshot mode: lastmod may only move forward (base ⊆ candidate in time).
      if (!(ctx.snapshotMode && (c.lastmod || '') >= (b.lastmod || ''))) what.push('lastmod');
    }
    if (!deepEqual(b.alternates, c.alternates)) {
      if (!(ctx.snapshotMode && multisetSubset(b.alternates, c.alternates))) what.push('alternates');
    }
    if (what.length) changed.push({ loc, fields: what, base: { lastmod: b.lastmod, changefreq: b.changefreq, priority: b.priority, alternates: b.alternates.length }, candidate: { lastmod: c.lastmod, changefreq: c.changefreq, priority: c.priority, alternates: c.alternates.length } });
  }
  if (changed.length) diffs.push({ field: 'F26', sub: 'loc-changed', base: changed.length, candidate: changed.length, examples: changed.slice(0, 20) });
  return diffs;
}

/**
 * Compare one entry.
 * @param ctx { role, baseOrigin, candOrigin, snapshotMode, normaliseAssetHashes, bodies: { base: BodyStore, candidate: BodyStore }, assetPairs: [],
 *   blogIndexPaths: Set of the blog index URLs, baseCapture: { records, urls } of the base snapshot (rule blog-index-article-list) }
 * @returns { diffs, newUrls, seoSourceDb, volatile: [{ rule, ... }] }
 */
export function compareEntry(entry, b, c, ctx) {
  const n = originNormaliser(ctx.baseOrigin, ctx.candOrigin);
  const diffs = [];
  const newUrls = [];
  const volatile = [];
  let seoSourceDb = false;
  const bm = b.methods; const cm = c.methods;

  if (bm.GET && cm.GET) {
    const bh = bm.GET.hops; const ch = cm.GET.hops;
    if (bh[0]?.status !== ch[0]?.status) diffs.push({ field: 'F1', base: bh[0]?.status ?? null, candidate: ch[0]?.status ?? null });
    const bc = chainOf(bh, 'base', n); const cc = chainOf(ch, 'candidate', n);
    if (!deepEqual(bc, cc)) diffs.push({ field: 'F2', base: bc, candidate: cc });
    const bf = finalOf(bh, 'base', n); const cf = finalOf(ch, 'candidate', n);
    if (bf !== cf) diffs.push({ field: 'F3', base: bf, candidate: cf });
    for (let i = 0; i < Math.min(bh.length, ch.length); i++) {
      diffs.push(...compareHeaders(bh[i], ch[i], ctx, i > 0 ? { hop: i } : {}));
    }
    const bl = bh[bh.length - 1]; const cl = ch[ch.length - 1];
    if ((bl?.headers?.['x-seo-source'] === 'db') || (cl?.headers?.['x-seo-source'] === 'db')) seoSourceDb = true;
    // Documents: the final responses, unless a 3xx ends the chain (3xx bodies are recorded, not gated).
    if (bl && cl && !isRedirect(bl) && !isRedirect(cl) && bl.extracted && cl.extracted) {
      const be = bl.extracted; const ce = cl.extracted;
      const bothHtml = be.family === 'html' && ce.family === 'html';
      const eitherHtml = be.family === 'html' || ce.family === 'html';
      const docDiffs = [];
      if (bothHtml) docDiffs.push(...compareDocument(be, ce, ctx, n, entry));
      if (eitherHtml) {
        const key = ctx.normaliseAssetHashes ? 'F23_hashless' : 'F23';
        const bv = be[key]?.sha256 ?? null; const cv = ce[key]?.sha256 ?? null;
        // Snapshot mode, blog article: the hreflang set may grow (base ⊆
        // candidate, as F17); the rest of the document stays exact.
        const k2 = ctx.normaliseAssetHashes ? 'hashless_sha256' : 'sha256';
        const volatileOk = bv !== cv && ctx.snapshotMode && entry.kind === 'blog-article' && bothHtml
          && be.F23_sans_hreflang && ce.F23_sans_hreflang && be.F23_sans_hreflang[k2] === ce.F23_sans_hreflang[k2]
          && multisetSubset(be.F23_hreflang || [], ce.F23_hreflang || []);
        // Rule prerender-tag-scripts (volatile.mjs): documents served without
        // X-Seo-Source on both sides compare without the tag runtime's script
        // elements; all other bytes stay exact.
        const bs = be.F23_sans_tag_scripts; const cs = ce.F23_sans_tag_scripts;
        const tagCase = bv !== cv && !volatileOk && bothHtml && !hasSeoSource(bl) && !hasSeoSource(cl);
        const tagOk = tagCase && bs && cs && bs[k2] === cs[k2];
        if (tagOk) volatile.push({ rule: 'prerender-tag-scripts', field: 'F23', base_removed: bs.removed, candidate_removed: cs.removed });
        else if (tagCase && (!bs || !cs)) {
          // A snapshot record from a tool before 1.1.0 has no such variant: say
          // so instead of failing F23 without a reason.
          const sides = [!bs && 'base', !cs && 'candidate'].filter(Boolean);
          volatile.push({ rule: 'prerender-tag-scripts', applied: false, reason: `the ${sides.join(' and ')} record${sides.length > 1 ? 's have' : ' has'} no F23 variant without tag scripts (captured by a tool before 1.1.0)` });
        }
        if (bv !== cv && !volatileOk && !tagOk) docDiffs.push({ field: 'F23', base: bv, candidate: cv, base_length: be[key]?.length ?? null, candidate_length: ce[key]?.length ?? null });
      }
      // Rule blog-index-article-list (volatile.mjs): snapshot mode, the 14
      // blog index URLs only.
      if (bothHtml && ctx.snapshotMode && entry.kind === 'blog-index' && ctx.blogIndexPaths?.has(entry.url)
        && docDiffs.some((d) => ARTICLE_LIST_FIELDS.has(d.field))) {
        const r = blogIndexListRule(bl, cl, ctx, n, entry);
        if (r.ok) {
          const relaxed = [...new Set(docDiffs.filter((d) => ARTICLE_LIST_FIELDS.has(d.field)).map((d) => d.field))];
          for (let i = docDiffs.length - 1; i >= 0; i--) if (ARTICLE_LIST_FIELDS.has(docDiffs[i].field)) docDiffs.splice(i, 1);
          volatile.push({ rule: 'blog-index-article-list', fields: relaxed, added: r.added, dropped: r.dropped });
          newUrls.push(...r.added);
        } else {
          volatile.push({ rule: 'blog-index-article-list', applied: false, reason: r.reason });
        }
      }
      diffs.push(...docDiffs);
      if (!bothHtml && be.F24 !== ce.F24) {
        const bothXml = be.family === 'xml' && ce.family === 'xml';
        let sitemapDiffs = [];
        if (bothXml) {
          const bb = ctx.bodies.base.get(be.F24); const cb = ctx.bodies.candidate.get(ce.F24);
          if (bb && cb) sitemapDiffs = compareSitemaps(bb, cb, ctx, newUrls);
          else sitemapDiffs = [{ field: 'F26', sub: 'parse', base: bb ? 'ok' : 'body not stored', candidate: cb ? 'ok' : 'body not stored' }];
        }
        // Snapshot mode: sitemaps follow the volatile rules of F26 only.
        if (!(bothXml && ctx.snapshotMode)) diffs.push({ field: 'F24', base: be.F24, candidate: ce.F24, base_length: bl.body_length, candidate_length: cl.body_length });
        diffs.push(...sitemapDiffs);
      }
    }
  }

  if (bm.HEAD && cm.HEAD) {
    const bh = bm.HEAD.hops[0]; const ch = cm.HEAD.hops[0];
    if (bh.status !== ch.status) diffs.push({ field: 'F4', sub: 'status', base: bh.status, candidate: ch.status });
    // Location is excluded from F11 because F2 covers it for GET; HEAD has no
    // chain walk, so its Location (origin-normalised as F2) is compared here.
    if (n('base', bh.location ?? null) !== n('candidate', ch.location ?? null)) diffs.push({ field: 'F4', sub: 'location', base: n('base', bh.location ?? null), candidate: n('candidate', ch.location ?? null) });
    for (const d of compareHeaders(bh, ch, ctx)) diffs.push({ ...d, field: 'F4', sub: d.sub ? `${d.field}:${d.sub}` : d.field });
    if ((ch.head_body_length || 0) > 0) diffs.push({ field: 'F4', sub: 'body', base: bh.head_body_length || 0, candidate: ch.head_body_length, rule: 'HEAD body must be empty' });
    if (entry.methods.length === 1 && entry.methods[0] === 'HEAD') {
      const bv = bh.headers?.['content-length'] ?? null; const cv = ch.headers?.['content-length'] ?? null;
      if (bv !== cv) diffs.push({ field: 'F4', sub: 'content-length', base: bv, candidate: cv });
    }
  }

  if (bm.OPTIONS && cm.OPTIONS) {
    const bh = bm.OPTIONS.hops[0]; const ch = cm.OPTIONS.hops[0];
    if (bh.status !== ch.status) diffs.push({ field: 'F12', sub: 'status', base: bh.status, candidate: ch.status });
    if (n('base', bh.location ?? null) !== n('candidate', ch.location ?? null)) diffs.push({ field: 'F12', sub: 'location', base: n('base', bh.location ?? null), candidate: n('candidate', ch.location ?? null) });
    for (const d of compareHeaders(bh, ch, ctx)) diffs.push({ ...d, field: 'F12', sub: d.sub ? `${d.field}:${d.sub}` : d.field });
  }

  return { diffs, newUrls, seoSourceDb, volatile };
}

/** Values another entry has for a field, for allow-list `same_as_url` references. */
export function fieldValue(rec, field, { normaliseAssetHashes = false } = {}) {
  const hops = rec?.methods?.GET?.hops;
  const last = hops?.[hops.length - 1];
  if (!last?.extracted) return undefined;
  // Same key choice as compareEntry's F23 rule.
  if (field === 'F23') return last.extracted[normaliseAssetHashes ? 'F23_hashless' : 'F23']?.sha256 ?? null;
  if (field === 'F24') return last.extracted.F24;
  if (field === 'F5') return norm.F5(last.headers['content-type'] ?? null);
  return undefined;
}

export { canonicalJson };
