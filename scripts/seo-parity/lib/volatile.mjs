// Volatile-field rules (SEO_PARITY.md §2.4): the registry, and the two rules
// that need more than a one-line test in compare.mjs.
//
// Every rule here only ever turns a difference into "equal" under a stated,
// narrow condition; it never changes how a field is extracted for the exact
// comparison. A rule that applies is recorded on the entry's result
// (`volatile: [{ rule, ... }]`) and summarised in report.md.

import { PRODUCTION_ORIGIN } from './constants.mjs';
import { encPath } from './util.mjs';

/**
 * The §2.4-style rules the tool applies, for the report and the docs. `mode`
 * is where a rule applies: `snapshot` (a stored base against a later
 * candidate), `all`, or `live` (re-check needs a live candidate).
 */
export const VOLATILE_RULES = [
  { id: 'window', mode: 'all', fields: ['run'], rule: 'Runs start between 10:05 and 06:55 UTC; a run that crosses 00:00, 06:55 or 09:00 UTC is invalid (window.mjs).' },
  { id: 'db-recheck', mode: 'live', fields: ['F9', 'F14–F22'], rule: 'A database-backed difference (X-Seo-Source: db on either side) is re-fetched after --recheck-after; gone = transient (recheck.mjs).' },
  { id: 'sitemap-loc-set', mode: 'snapshot', fields: ['F24', 'F26'], rule: 'Sitemap <loc> set: base ⊆ candidate; new <loc> values are listed, not compared.' },
  { id: 'sitemap-lastmod', mode: 'snapshot', fields: ['F26'], rule: 'Sitemap <lastmod> may only move forward.' },
  { id: 'sitemap-alternates', mode: 'snapshot', fields: ['F26'], rule: 'Sitemap alternates per <loc>: base ⊆ candidate.' },
  { id: 'blog-article-hreflang', mode: 'snapshot', fields: ['F17', 'F23'], rule: 'Blog article hreflang set: base ⊆ candidate; the rest of the document exact.' },
  {
    id: 'blog-index-article-list',
    mode: 'snapshot',
    fields: ['F20', 'F21', 'F22', 'F23'],
    rule: 'Blog index pages (the 14 localizedPath(lang, "blog-index") URLs of middleware/slugs.ts) only, and only when the article list changed: the '
      + 'article list (the <article> items inside article#seo-content, which must be adjacent siblings separated by ASCII whitespace only, and the '
      + 'itemListElement entries of the ItemList JSON-LD block, paired item by item) may start with articles that are not in the base list. Each of '
      + 'them must be an article of that blog index (https://www.micronshub.eu<blog index path>/<one non-empty path segment>, no query or fragment) '
      + 'that was not yet published when the base was captured: its URL is in no <loc> of the base snapshot\'s /sitemap-<lang>.xml, '
      + '/sitemap-complete.xml or /api/sitemap record and in no entry of the base URL set. The base snapshot must hold at least one of those sitemap '
      + 'records (HTTP 200, a parsable urlset) and it must list every article of the base list; otherwise new and older articles cannot be told '
      + 'apart and the rule does not apply. After the new articles the candidate must repeat the base list from its first item, byte for byte and '
      + 'in order, and must be at least as long as the base list. So the only accepted change is "articles published since the capture first, the '
      + 'oldest fall off the end" (the handler lists the 10 newest, middleware.ts fetchRecentArticles). The number of new articles is not capped: at '
      + 'one article per language per day the list turns over within the C+1 … C+14 window. The list is then replaced by one fixed marker in both '
      + 'documents (so its position and parent stay compared) and the ItemList is emptied; the two documents must be equal in every field '
      + '(F13–F25). A list that did not change relaxes nothing. New article URLs are listed.',
  },
  {
    id: 'prerender-tag-scripts',
    mode: 'all',
    fields: ['F23'],
    rule: 'Documents served without X-Seo-Source on both sides (the SEO handler declined, so a static or prerendered file answered; SEO_PARITY.md §3.5 '
      + 'G9 #8-9) only: <script> elements that the Google tag runtime adds while the jsdom prerender runs are left out of F23. An element is left out '
      + 'only when it is a direct child of <head>, has exactly the two attributes type="text/javascript" and src, has no content, and its src starts with '
      + 'https://www.googletagmanager.com/gtag/js? or https://googleads.g.doubleclick.net/pagead/viewthroughconversion/. Their presence depends on network '
      + 'timing during the build and their query carries per-build values (random, fst, auid, tag_exp, gtm, rcb, url of the prerender server). '
      + 'Every other byte of the document stays in F23, including the gtag loader element <script src="https://www.googletagmanager.com/gtag/js?id=…"> '
      + '(no type attribute; added once per prerendered file by the loader script of index.html, the same bytes in every build); F13–F22 are '
      + 'extracted from the full document as before. A snapshot record without the variant (captured by a tool before 1.1.0) cannot use the rule: '
      + 'the entry then carries { applied: false, reason }.',
  },
];

export const RULE_IDS = new Set(VOLATILE_RULES.map((r) => r.id));

// ------------------------------------------------------------ prerender tag scripts

const TAG_SCRIPT_PREFIXES = [
  'https://www.googletagmanager.com/gtag/js?',
  'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/',
];

/**
 * True for a parse5 element added by the Google tag runtime during the
 * prerender (rule `prerender-tag-scripts`). The static loader element of
 * index.html (`<script src=".../gtag/js?id=…">`, no type attribute) is not
 * matched and stays compared.
 */
export function isPrerenderTagScript(n) {
  if (n.tagName !== 'script' || n.parentNode?.tagName !== 'head') return false;
  if (!n.attrs || n.attrs.length !== 2) return false;
  const type = n.attrs.find((a) => a.name === 'type');
  const src = n.attrs.find((a) => a.name === 'src');
  if (!type || !src || type.value !== 'text/javascript') return false;
  if (n.childNodes && n.childNodes.length) return false;
  return TAG_SCRIPT_PREFIXES.some((p) => src.value.startsWith(p));
}

/** Host and path of a left-out tag script (its query is per build and not reported). */
export function tagScriptLabel(src) {
  try { const u = new URL(src); return `${u.host}${u.pathname}`; } catch { return 'unparsable src'; }
}

// ------------------------------------------------------------ blog index article list

/** The blog index URLs of the 14 languages, from the handler's own slug table. */
export function blogIndexPaths(src) {
  return new Set([...src.LANGUAGES].map((l) => encPath(src.localizedPath(l, 'blog-index'))));
}

/** Absolute, percent-encoded form of an article link, for pairing HTML and JSON-LD items. */
export function articleKey(href) {
  try { return new URL(href, PRODUCTION_ORIGIN).href; } catch { return null; }
}

/**
 * True when `key` (an articleKey) is an article of the blog index at
 * `blogIndexPath`: exactly https://www.micronshub.eu<index path>/<segment>,
 * one non-empty path segment, no query, fragment or credentials (the handler
 * links localizedPath(lang, 'blog-article', slug), middleware/slugs.ts).
 */
export function isBlogArticleKey(key, blogIndexPath) {
  if (typeof key !== 'string' || typeof blogIndexPath !== 'string') return false;
  let u; let index;
  try { u = new URL(key); index = new URL(blogIndexPath, PRODUCTION_ORIGIN).pathname; } catch { return false; }
  if (u.origin !== PRODUCTION_ORIGIN || key !== `${PRODUCTION_ORIGIN}${u.pathname}`) return false;
  const prefix = `${index.replace(/\/+$/, '')}/`;
  if (!u.pathname.startsWith(prefix)) return false;
  const slug = u.pathname.slice(prefix.length);
  return slug.length > 0 && !slug.includes('/');
}

/**
 * Form of a www URL used to look it up among the base snapshot's sitemap
 * <loc> values: every path segment percent-decoded and re-encoded with
 * encodeURIComponent, as api/sitemap.js encodeSitemapUrl writes them, so that
 * a link and a <loc> naming the same article compare equal however each was
 * escaped. null for anything that does not parse.
 */
export function publishedKey(href) {
  let u;
  try { u = new URL(href, PRODUCTION_ORIGIN); } catch { return null; }
  const seg = (s) => { try { return encodeURIComponent(decodeURIComponent(s)); } catch { return s; } };
  return `${u.origin}${u.pathname.split('/').map(seg).join('/')}${u.search}`;
}

/**
 * Rule `blog-index-article-list`, list part. `base` and `cand` are arrays of
 * { key, html, jsonld } in page order. Accepted: cand = N ++ base[0..m) where
 * every item of N has a key not in base that is an article of the blog index
 * at `blogIndexPath` (isBlogArticleKey) and cand.length >= base.length.
 * When N is not empty, `published` (what the base snapshot shows as published
 * at capture time: { sitemapHas(publishedKey), where(publishedKey) → the
 * sitemap or URL set that lists it, or null; source }) must list every base
 * item in its sitemaps and none of N; without it (null, or { error }) the
 * rule fails closed. N empty means the list did not change (`unchanged: true`).
 * @returns { ok, added: [key], dropped: [key], unchanged, reason }
 */
export function articleListShift(base, cand, blogIndexPath, published = null) {
  const fail = (added, reason) => ({ ok: false, added, dropped: [], unchanged: false, reason });
  const baseKeys = new Set(base.map((x) => x.key));
  let k = 0;
  while (k < cand.length && !baseKeys.has(cand[k].key)) k++;
  const added = cand.slice(0, k).map((x) => x.key);
  const foreign = added.findIndex((key) => !isBlogArticleKey(key, blogIndexPath));
  if (foreign !== -1) return fail(added, `item ${foreign + 1} (${added[foreign]}) is not an article of ${blogIndexPath}`);
  if (new Set(added).size !== added.length) return fail(added, 'a new article is listed twice');
  const rest = cand.slice(k);
  if (cand.length < base.length) return fail(added, `the candidate lists ${cand.length} articles, the base ${base.length}`);
  for (let i = 0; i < rest.length; i++) {
    const b = base[i]; const c = rest[i];
    if (!b) return fail(added, `item ${k + i + 1} (${c.key}) is not where the base list continues`);
    if (b.key !== c.key) return fail(added, `item ${k + i + 1} is ${c.key}, the base list continues with ${b.key}`);
    if (b.html !== c.html) return fail(added, `item ${k + i + 1} (${c.key}): the HTML list item differs`);
    if (b.jsonld !== c.jsonld) return fail(added, `item ${k + i + 1} (${c.key}): the ItemList entry differs`);
  }
  if (!added.length) return { ok: true, added, dropped: [], unchanged: true, reason: null };
  // "Published since the capture" needs evidence from the capture itself.
  if (!published || published.error) return fail(added, published?.error || 'no record of the articles published at capture time');
  const unlisted = base.find((x) => !published.sitemapHas(publishedKey(x.key)));
  if (unlisted) return fail(added, `the base snapshot's sitemaps (${published.source}) do not list base article ${unlisted.key}, so they cannot tell articles published since the capture from older ones`);
  for (const [i, key] of added.entries()) {
    const where = published.where(publishedKey(key));
    if (where) return fail(added, `item ${i + 1} (${key}) was already published when the base was captured (listed in ${where})`);
  }
  return { ok: true, added, dropped: base.slice(rest.length).map((x) => x.key), unchanged: false, reason: null };
}
