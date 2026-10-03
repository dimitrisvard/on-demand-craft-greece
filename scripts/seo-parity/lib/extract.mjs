// Field extraction F13–F26 (SEO_PARITY.md §2.1). HTML is parsed with parse5
// (HTML5 tree construction), XML with saxes (streaming); no regular
// expressions are used on HTML markup. Regexes appear only on plain strings
// (header values, asset paths inside attribute values, whitespace).

import { parse } from 'parse5';
import { SaxesParser } from 'saxes';
import { canonicalJson, canonicalJsonRaw, collapse, parseJsonRaw, renderJsonRaw, sha256 } from './util.mjs';
import { articleKey, isPrerenderTagScript, tagScriptLabel } from './volatile.mjs';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ASSET_RE = /^(?:https?:\/\/[^/]+)?(\/assets\/[^?#\s]+)/;
const ASSET_HASH_RE = /\/assets\/([^/?#\s"'<>]+?)-([A-Za-z0-9_-]{8})\.([A-Za-z0-9]+)/g;

const attr = (node, name) => {
  const a = node.attrs?.find((x) => x.name === name);
  return a ? a.value : null;
};

function* walk(node) {
  yield node;
  const kids = node.nodeName === 'template' && node.content ? node.content.childNodes : node.childNodes;
  if (kids) for (const k of kids) yield* walk(k);
}

function textOf(node, skip = new Set()) {
  let out = '';
  for (const n of walk(node)) {
    if (n !== node && skip.has(n.nodeName)) continue;
    if (n.nodeName === '#text') {
      // Skip text whose ancestor is in `skip`.
      let p = n.parentNode;
      let skipped = false;
      while (p && p !== node) { if (skip.has(p.nodeName)) { skipped = true; break; } p = p.parentNode; }
      if (!skipped) out += n.value;
    }
  }
  return out;
}

const relTokens = (node) => String(attr(node, 'rel') || '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Normalised document (F23): whitespace collapsed; with
 * `normaliseAssetHashes` the hash of /assets/<name>-<hash>.<ext> becomes [hash].
 */
export function normaliseDocument(text, normaliseAssetHashes = false) {
  let t = collapse(text);
  if (normaliseAssetHashes) t = t.replace(ASSET_HASH_RE, '/assets/$1-[hash].$3');
  return t;
}

/** Nearest <head>/<body> ancestor of an element ('other' inside templates etc.). */
function containerOf(n) {
  for (let p = n.parentNode; p; p = p.parentNode) {
    if (p.namespaceURI === HTML_NS && (p.tagName === 'head' || p.tagName === 'body')) return p.tagName;
  }
  return 'other';
}

/**
 * F23 for HTML. The elements whose own field rule is order-insensitive
 * (link[hreflang] → F17, og:/twitter: meta → F18, JSON-LD blocks → F20) are
 * cut from their position, and their exact source text is appended to the
 * document as a sorted list, each prefixed with its container (head or body).
 * So a reordering of these elements passes (as F17/F18/F20 declare), while any
 * byte, attribute, escaping or head/body change in them still fails F23. A
 * JSON-LD block keeps its start and end tag bytes; its content is the raw
 * canonical form (keys sorted, every token as written, see canonicalJsonRaw),
 * or the raw text when it is not valid JSON. Everything else (title,
 * canonical, robots, #seo-content markup, injected scripts) stays in place
 * byte for byte. Then ASCII whitespace is collapsed. Offsets come from
 * parse5's source locations.
 */
export function normaliseHtmlDocument(text, normaliseAssetHashes = false) {
  return htmlF23Parts(text).render({ normaliseAssetHashes });
}

/**
 * The pieces of the HTML F23 document. `render({ withoutHreflang })` leaves
 * the hreflang items out (snapshot-mode rule for blog articles: hreflang sets
 * are base ⊆ candidate, the rest of the document stays exact).
 * `render({ withoutTagScripts })` leaves out the script elements of rule
 * `prerender-tag-scripts` (volatile.mjs); by default they stay in place.
 */
export function htmlF23Parts(text) {
  const document = parse(text, { sourceCodeLocationInfo: true });
  const cuts = [];
  for (const n of walk(document)) {
    if (!n.tagName || n.namespaceURI !== HTML_NS || !n.sourceCodeLocation) continue;
    if (isPrerenderTagScript(n)) {
      const loc = n.sourceCodeLocation;
      const end = loc.endTag ? loc.endTag.endOffset : loc.endOffset;
      if (Number.isInteger(loc.startOffset) && Number.isInteger(end)) cuts.push({ start: loc.startOffset, end, tagScript: tagScriptLabel(n.attrs.find((a) => a.name === 'src').value) });
      continue;
    }
    let cut = false;
    const isJsonLd = n.tagName === 'script' && (attr(n, 'type') || '').trim().toLowerCase() === 'application/ld+json';
    if (n.tagName === 'link' && attr(n, 'hreflang') !== null) cut = true;
    if (isJsonLd) cut = true;
    if (n.tagName === 'meta') {
      const key = (attr(n, 'property') || attr(n, 'name') || '').trim().toLowerCase();
      if (key.startsWith('og:') || key.startsWith('twitter:')) cut = true;
    }
    if (!cut) continue;
    const loc = n.sourceCodeLocation;
    const end = loc.endTag ? loc.endTag.endOffset : loc.endOffset;
    if (!Number.isInteger(loc.startOffset) || !Number.isInteger(end)) continue;
    let source = text.slice(loc.startOffset, end);
    if (isJsonLd && loc.startTag) {
      const inner = textOf(n);
      let body;
      try { body = canonicalJsonRaw(inner); } catch { body = inner; }
      const endTag = loc.endTag ? text.slice(loc.endTag.startOffset, loc.endTag.endOffset) : '';
      source = text.slice(loc.startTag.startOffset, loc.startTag.endOffset) + body + endTag;
    }
    cuts.push({ start: loc.startOffset, end, item: `${containerOf(n)} ${collapse(source)}`, hreflang: n.tagName === 'link' });
  }
  cuts.sort((a, b) => a.start - b.start);
  let doc = '';
  let docSansTags = '';
  let pos = 0;
  const items = [];
  const tagScripts = [];
  for (const c of cuts) {
    if (c.start < pos) continue; // nested inside a previous cut: already part of its source
    const before = text.slice(pos, c.start);
    doc += before;
    docSansTags += before;
    pos = c.end;
    if (c.tagScript) {
      doc += text.slice(c.start, c.end); // stays in place, byte for byte
      tagScripts.push(c.tagScript);
    } else items.push(c);
  }
  doc += text.slice(pos);
  docSansTags += text.slice(pos);
  const sorted = (list) => list.map((c) => c.item).sort();
  return {
    hreflang: sorted(items.filter((c) => c.hreflang)),
    tagScripts,
    render({ normaliseAssetHashes = false, withoutHreflang = false, withoutTagScripts = false } = {}) {
      const list = sorted(withoutHreflang ? items.filter((c) => !c.hreflang) : items);
      const base = withoutTagScripts ? docSansTags : doc;
      const out = list.length ? `${base}\n<!-- seo-parity F23: order-insensitive elements, sorted -->\n${list.join('\n')}` : base;
      return normaliseDocument(out, normaliseAssetHashes);
    },
  };
}

/**
 * Article list of a blog index page (rule `blog-index-article-list`,
 * volatile.mjs), read with parse5 source offsets:
 *  - the <article> elements inside the single article#seo-content (one per
 *    listed article; key = its first a[href]);
 *  - the itemListElement entries of the single ItemList JSON-LD block (each
 *    must carry position i + 1; the entry without its position member, in raw
 *    canonical form, is the item).
 * The two lists must pair up item by item (same article URL), as the
 * handler renders both from one query (middleware/renderers/blogIndex.ts).
 * Returns { items: [{ key, html, jsonld }], reduced } where `reduced` is the
 * document with the HTML items cut out and itemListElement emptied, or
 * { error } when the page does not have that shape (then nothing is relaxed).
 */
export function blogIndexArticleList(text) {
  const document = parse(text, { sourceCodeLocationInfo: true });
  const seo = [];
  const lists = [];
  for (const n of walk(document)) {
    if (!n.tagName || n.namespaceURI !== HTML_NS) continue;
    if (n.tagName === 'article' && attr(n, 'id') === 'seo-content') seo.push(n);
    if (n.tagName === 'script' && (attr(n, 'type') || '').trim().toLowerCase() === 'application/ld+json') {
      let tree;
      try { tree = parseJsonRaw(textOf(n)); } catch { continue; }
      if (tree.t !== 'o') continue;
      const type = tree.members.filter((m) => m.key === '@type');
      if (type.length === 1 && type[0].value.t === 's' && JSON.parse(type[0].value.raw) === 'ItemList') lists.push({ n, tree });
    }
  }
  if (seo.length !== 1) return { error: `${seo.length} article#seo-content elements` };
  if (lists.length !== 1) return { error: `${lists.length} ItemList JSON-LD blocks` };
  const html = [];
  for (const n of walk(seo[0])) {
    if (n === seo[0] || n.tagName !== 'article' || n.namespaceURI !== HTML_NS) continue;
    const loc = n.sourceCodeLocation;
    if (!loc?.endTag) return { error: 'a list item without its end tag' };
    if (html.length && loc.startOffset < html[html.length - 1].end) return { error: 'nested list items' };
    let href = null;
    for (const d of walk(n)) if (d.tagName === 'a' && attr(d, 'href') !== null) { href = attr(d, 'href'); break; }
    if (href === null) return { error: 'a list item without a link' };
    html.push({ start: loc.startOffset, end: loc.endTag.endOffset, key: articleKey(href), html: collapse(text.slice(loc.startOffset, loc.endTag.endOffset)) });
  }
  const { n: block, tree } = lists[0];
  const listMembers = tree.members.filter((m) => m.key === 'itemListElement');
  if (listMembers.length !== 1 || listMembers[0].value.t !== 'a') return { error: 'ItemList without one itemListElement array' };
  const json = [];
  for (const [i, el] of listMembers[0].value.items.entries()) {
    if (el.t !== 'o') return { error: `itemListElement ${i + 1} is not an object` };
    const pos = el.members.filter((m) => m.key === 'position');
    const url = el.members.filter((m) => m.key === 'url');
    if (pos.length !== 1 || pos[0].value.t !== 'l' || JSON.parse(pos[0].value.raw) !== i + 1) return { error: `itemListElement ${i + 1} has no position ${i + 1}` };
    if (url.length !== 1 || url[0].value.t !== 's') return { error: `itemListElement ${i + 1} has no url` };
    json.push({ key: articleKey(JSON.parse(url[0].value.raw)), jsonld: renderJsonRaw({ t: 'o', members: el.members.filter((m) => m.key !== 'position') }) });
  }
  if (html.length !== json.length) return { error: `${html.length} HTML list items, ${json.length} ItemList entries` };
  for (let i = 0; i < html.length; i++) {
    if (!html[i].key || html[i].key !== json[i].key) return { error: `list item ${i + 1}: HTML link ${html[i].key} and ItemList url ${json[i].key} differ` };
  }
  const bl = block.sourceCodeLocation;
  if (!bl?.startTag || !bl.endTag) return { error: 'ItemList block without source location' };
  const emptied = renderJsonRaw({ t: 'o', members: tree.members.map((m) => (m.key === 'itemListElement' ? { ...m, value: { t: 'a', items: [] } } : m)) });
  const ops = [...html.map((h) => ({ start: h.start, end: h.end, insert: '' })), { start: bl.startTag.endOffset, end: bl.endTag.startOffset, insert: emptied }]
    .sort((a, b) => a.start - b.start);
  let reduced = '';
  let p = 0;
  for (const o of ops) {
    if (o.start < p) return { error: 'overlapping list ranges' };
    reduced += text.slice(p, o.start) + o.insert;
    p = o.end;
  }
  reduced += text.slice(p);
  return { items: html.map((h, i) => ({ key: h.key, html: h.html, jsonld: json[i].jsonld })), reduced };
}

/** Assets referenced by the document and the Link header (F25). */
function assetRefs(document, linkHeader) {
  const refs = [];
  for (const n of walk(document)) {
    if (!n.attrs) continue;
    for (const name of ['src', 'href']) {
      const v = attr(n, name);
      if (!v) continue;
      const m = ASSET_RE.exec(v.trim());
      if (m) refs.push(m[1]);
    }
  }
  if (linkHeader) {
    for (const part of linkHeader.split(',')) {
      const m = /<([^>]+)>/.exec(part);
      if (m) { const a = ASSET_RE.exec(m[1].trim()); if (a) refs.push(`link:${a[1]}`); }
    }
  }
  return refs;
}

/** Extract F13–F22 and F25 from an HTML body. */
export function extractHtml(text, { linkHeader = null } = {}) {
  const document = parse(text);
  const out = {
    F13: null, F14: [], F15: [], F16: [], F17: [], F18: {}, F19: { robots: [], googlebot: [] },
    F20: [], F20_invalid: 0, F21: null, F22: [], F25: [],
  };
  let seoArticle = null;
  let seoArticleCount = 0;
  for (const n of walk(document)) {
    if (!n.tagName) continue;
    const html = n.namespaceURI === HTML_NS;
    if (n.tagName === 'html' && html && out.F13 === null) out.F13 = attr(n, 'lang');
    if (!html) continue;
    switch (n.tagName) {
      case 'title':
        out.F14.push(collapse(textOf(n)));
        break;
      case 'meta': {
        const name = (attr(n, 'name') || '').trim().toLowerCase();
        const prop = (attr(n, 'property') || '').trim().toLowerCase();
        const content = attr(n, 'content');
        if (name === 'description') out.F15.push(collapse(content));
        if (name === 'robots' || name === 'googlebot') {
          out.F19[name].push(String(content || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).sort());
        }
        // Keyed on the attribute too: Facebook reads og:* only from property=,
        // so property="og:title" and name="og:title" are different values.
        const key = prop.startsWith('og:') || prop.startsWith('twitter:') ? `property:${prop}`
          : name.startsWith('og:') || name.startsWith('twitter:') ? `name:${name}` : null;
        if (key) (out.F18[key] ||= []).push(collapse(content));
        break;
      }
      case 'link': {
        const rel = relTokens(n);
        if (rel.includes('canonical')) out.F16.push(attr(n, 'href'));
        const hl = attr(n, 'hreflang');
        // A hreflang link without rel=alternate is ignored by Google: record it
        // with its rel tokens so that it never equals a valid alternate.
        if (hl !== null) out.F17.push(rel.includes('alternate') ? [hl.toLowerCase(), attr(n, 'href')] : [hl.toLowerCase(), attr(n, 'href'), `rel=${rel.join(' ')}`]);
        break;
      }
      case 'script': {
        const type = (attr(n, 'type') || '').trim().toLowerCase();
        if (type === 'application/ld+json') {
          const raw = textOf(n);
          try {
            out.F20.push(canonicalJson(JSON.parse(raw)));
          } catch {
            out.F20.push(`jsonld_invalid:${collapse(raw)}`);
            out.F20_invalid += 1;
          }
        }
        break;
      }
      case 'article':
        if (attr(n, 'id') === 'seo-content') { seoArticleCount += 1; if (!seoArticle) seoArticle = n; }
        break;
      default:
    }
  }
  out.F17.sort((a, b) => { const x = a.join('\u0000'); const y = b.join('\u0000'); return x < y ? -1 : x > y ? 1 : 0; });
  out.F20.sort();
  if (seoArticle) {
    const text = collapse(textOf(seoArticle, new Set(['script', 'style'])));
    out.F21 = { sha256: sha256(text), length: text.length, lang: attr(seoArticle, 'lang'), count: seoArticleCount };
    for (const n of walk(seoArticle)) {
      if (n.tagName === 'a' && attr(n, 'href') !== null) out.F22.push(`a ${attr(n, 'href')}`);
      if (n.tagName === 'img' && attr(n, 'src') !== null) out.F22.push(`img ${attr(n, 'src')}`);
    }
    out.F22.sort();
  }
  out.F25 = assetRefs(document, linkHeader);
  return out;
}

/** Text of #seo-content for display in diffs (not stored in snapshots). */
export function seoContentText(text) {
  const document = parse(text);
  for (const n of walk(document)) {
    if (n.tagName === 'article' && attr(n, 'id') === 'seo-content') return collapse(textOf(n, new Set(['script', 'style'])));
  }
  return null;
}

/**
 * Parse a sitemap (urlset or sitemapindex) with a streaming parser (F26).
 * Returns { root, entries: Map<loc, {lastmod, changefreq, priority, alternates}> }
 * or { error }.
 */
export function parseSitemap(text) {
  const parser = new SaxesParser({ xmlns: false });
  let root = null;
  const entries = new Map();
  const stack = [];
  let cur = null;
  let textBuf = '';
  let error = null;
  parser.on('error', (e) => { error = e.message; });
  parser.on('opentag', (tag) => {
    const name = tag.name.replace(/^[^:]+:/, '');
    if (root === null) root = tag.name;
    stack.push(name);
    textBuf = '';
    if ((name === 'url' || name === 'sitemap') && stack.length === 2) cur = { loc: null, lastmod: null, changefreq: null, priority: null, alternates: [] };
    if (name === 'link' && cur) {
      const a = tag.attributes;
      if (String(a.rel || '').toLowerCase() === 'alternate') cur.alternates.push([String(a.hreflang || '').toLowerCase(), String(a.href || '')]);
    }
  });
  parser.on('text', (t) => { textBuf += t; });
  parser.on('cdata', (t) => { textBuf += t; });
  parser.on('closetag', (tag) => {
    const name = tag.name.replace(/^[^:]+:/, '');
    if (cur && ['loc', 'lastmod', 'changefreq', 'priority'].includes(name)) cur[name] = textBuf.trim();
    if ((name === 'url' || name === 'sitemap') && stack.length === 2 && cur) {
      cur.alternates.sort((a, b) => (a.join('\u0000') < b.join('\u0000') ? -1 : 1));
      if (cur.loc !== null) entries.set(cur.loc, cur);
      cur = null;
    }
    stack.pop();
    textBuf = '';
  });
  try {
    parser.write(text).close();
  } catch (e) {
    error = error || e.message;
  }
  if (error) return { error, root, entries };
  return { root, entries };
}

/** Extracted record stored per GET (snapshot results.ndjson). */
export function extractForHop(hop, body) {
  const out = { family: hop.family, F23: null, F24: hop.body_sha256 };
  if (hop.family === 'html' || hop.family === 'xml' || hop.family === 'txt' || hop.family === 'json') {
    const text = body.toString('utf8');
    const parts = hop.family === 'html' ? htmlF23Parts(text) : null;
    const normalise = (o) => (parts ? parts.render(o) : normaliseDocument(text, o.normaliseAssetHashes));
    const norm = normalise({ normaliseAssetHashes: false });
    out.F23 = { sha256: sha256(norm), length: norm.length };
    // Variant with asset hashes replaced, used only with --normalise-asset-hashes (F25).
    const normH = normalise({ normaliseAssetHashes: true });
    out.F23_hashless = { sha256: sha256(normH), length: normH.length };
    if (parts) {
      // Snapshot mode, blog articles (§2.4): hreflang sets compare as base ⊆
      // candidate, so F23 is also kept without the hreflang items, plus the
      // items themselves (short link elements).
      out.F23_sans_hreflang = {
        sha256: sha256(parts.render({ withoutHreflang: true })),
        hashless_sha256: sha256(parts.render({ withoutHreflang: true, normaliseAssetHashes: true })),
      };
      out.F23_hreflang = parts.hreflang;
      // Rule prerender-tag-scripts (volatile.mjs): F23 without the tag
      // runtime's script elements, used only for documents served without
      // X-Seo-Source on both sides.
      out.F23_sans_tag_scripts = {
        sha256: sha256(parts.render({ withoutTagScripts: true })),
        hashless_sha256: sha256(parts.render({ withoutTagScripts: true, normaliseAssetHashes: true })),
        removed: parts.tagScripts,
      };
    }
    if (hop.family === 'html') Object.assign(out, extractHtml(text, { linkHeader: hop.headers.link || null }));
    if (hop.family === 'xml') {
      // Only a summary is stored; the parsed comparison (F26) runs from the raw
      // body when F24 differs.
      const sm = parseSitemap(text);
      out.F26 = { root: sm.root, locs: sm.entries.size, error: sm.error || null };
    }
  }
  return out;
}

export const ASSET_HASH_PATTERN = ASSET_HASH_RE;
