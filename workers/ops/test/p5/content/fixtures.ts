// Synthetic content fixtures for the C5 tests: article HTML of a given length (headings, paragraphs, tables, the
// internal links the live prompt asks for), model answers in the live JSON and delimiter formats, and sitemap rows.
// Deterministic (a seeded generator), no real article text.

import { TARGET_LANGS } from '../../../src/content/languages';

const WORDS = [
  'tolerance', 'aluminium', 'machining', 'surface', 'finish', 'spindle', 'fixture', 'tooling', 'anodised', 'steel',
  'bending', 'flange', 'radius', 'burr', 'chamfer', 'thread', 'coolant', 'feed', 'rate', 'roughness', 'hardness',
  'casting', 'mould', 'gate', 'runner', 'shrinkage', 'draft', 'angle', 'wall', 'thickness', 'laser', 'punch', 'die',
];

/** A small deterministic generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sentence(r: () => number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(r() * WORDS.length)]);
  out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return `${out.join(' ')}.`;
}

/** Article HTML with about `words` words, two tables and the live link types. */
export function articleHtml(words: number, o: { seed?: number; blogSlugs?: string[]; quote?: '"' | "'" } = {}): string {
  const r = rng(o.seed ?? 7);
  const q = o.quote ?? "'";
  const parts: string[] = ["<div class='blog-post'>", '<p>Key engineering problem first.</p>', '<ul><li>One</li><li>Two</li></ul>'];
  let count = 6;
  let section = 0;
  while (count < words) {
    section++;
    parts.push(`<h2>Section ${section} ${sentence(r, 3)}</h2>`);
    for (let p = 0; p < 4 && count < words; p++) {
      const s = sentence(r, 14) + ' ' + sentence(r, 12);
      count += 26;
      if (p === 1 && section === 1) parts.push(`<p>${s} For high-precision results, <a href=${q}/en/quote${q}>Get a quote in 24 hours</a> from Microns Hub.</p>`);
      else if (p === 2 && section === 2) parts.push(`<p>${s} See our<a href=${q}/en/services/cnc-machining${q}>precision CNC machining services</a>and <a href=${q}/en/services${q}>our manufacturing services</a>.</p>`);
      else if (p === 3 && o.blogSlugs?.length) parts.push(`<p>${s} Related: <a href=${q}/en/blog/${o.blogSlugs[section % o.blogSlugs.length]}${q}>guide</a>.</p>`);
      else parts.push(`<p>${s}</p>`);
    }
    if (section === 2) {
      parts.push(`<table class='editor-table'><thead><tr><th>Property</th><th>6061-T6</th><th>7075-T6</th></tr></thead><tbody><tr><td>Yield strength</td><td>276 MPa</td><td>503 MPa</td></tr><tr><td><strong>Hardness</strong></td><td>95 HB</td><td>150 HB</td></tr></tbody></table>`);
    }
    if (section === 4) {
      parts.push(`<table class='editor-table'><tbody><tr><td>Finish</td><td>Ra 0.8 µm <a href='/en/services/sheet-metal'>sheet</a></td></tr></tbody></table>`);
    }
  }
  parts.push('<h2>Frequently Asked Questions</h2><h3>What tolerance?</h3><p>ISO 2768-m.</p></div>');
  return parts.join('\n');
}

/** The model's JSON answer as the live prompt asks for it (content with single-quoted attributes). */
export function modelJson(content: string, o: { excerpt?: string; metaTitle?: string; metaDescription?: string; fence?: boolean } = {}): string {
  const body = JSON.stringify(
    {
      content,
      excerpt: o.excerpt ?? 'A technical summary of the process for European buyers.',
      metaTitle: o.metaTitle ?? 'Guide | Microns Hub',
      metaDescription: o.metaDescription ?? 'Process, tolerances and cost drivers explained.',
      faqSchema: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] },
    },
    null,
    2,
  );
  return o.fence ? '```json\n' + body + '\n```' : body;
}

/** A JSON answer whose content holds one raw double quote (invalid JSON, recovered by the key anchor). */
export function strayQuoteJson(content: string): string {
  const good = modelJson(content);
  const marker = '<p>Key engineering problem first.</p>';
  return good.replace(marker, '<p>Key "engineering problem first.</p>');
}

/** The delimiter answer of the translation prompt. */
export function delimiterAnswer(o: { title: string; slug: string; content: string; excerpt?: string; metaTitle?: string; metaDescription?: string; end?: boolean }): string {
  return [
    '===TITLE===',
    o.title,
    '===SLUG===',
    o.slug,
    '===CONTENT===',
    o.content,
    '===EXCERPT===',
    o.excerpt ?? 'Kurzfassung.',
    '===META_TITLE===',
    o.metaTitle ?? `${o.title} | Microns Hub`,
    '===META_DESCRIPTION===',
    o.metaDescription ?? 'Beschreibung.',
    ...(o.end === false ? [] : ['===END===']),
  ].join('\n');
}

export interface SitemapFixtureRow {
  id: string;
  slug: string;
  language: string;
  status: string;
  updated_at: string;
  created_at: string;
  translation_id: string | null;
}

/** 300 published articles: groups of 1-14 languages, orphans, non-ASCII and XML-special slugs, odd language values,
 *  equal and microsecond-different updated_at values; plus a few drafts. */
export function sitemapFixture(n = 300): SitemapFixtureRow[] {
  const r = rng(42);
  const out: SitemapFixtureRow[] = [];
  const langs = ['en', ...TARGET_LANGS];
  let i = 0;
  let group = 0;
  while (out.length < n) {
    group++;
    const tid = `7${String(group).padStart(7, '0')}-0000-4000-8000-${String(group).padStart(12, '0')}`;
    const size = group % 3 === 0 ? 14 : 1 + Math.floor(r() * 14);
    for (let k = 0; k < size && out.length < n; k++) {
      i++;
      const lang = langs[k];
      const day = 1 + (i % 28);
      const micro = i % 3 === 0 ? '' : `.${String(100000 + i * 37).slice(0, 1 + (i % 6))}`;
      let slug = `guide-${group}-${lang}`;
      if (lang === 'fi' && group % 3 === 0) slug = `työstö-opas-${group}`;
      if (lang === 'de' && group % 5 === 0) slug = `blätter-&-ränder-${group}`;
      out.push({
        id: `6${String(i).padStart(7, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`,
        slug,
        language: lang,
        status: 'published',
        updated_at: `2026-09-${String(day).padStart(2, '0')}T0${i % 10}:00:00${micro}+00:00`,
        created_at: `2026-08-${String(day).padStart(2, '0')}T06:00:00+00:00`,
        translation_id: group % 11 === 0 ? null : tid,
      });
    }
  }
  // odd values the live code normalises or drops (fixtures of at least 22 rows)
  if (out.length >= 22) {
    out[3].language = 'EN ';
    out[10].language = 'De';
    out[17].language = 'xx';
    out[20].updated_at = out[21].updated_at;
  }
  out.push({ ...out[out.length > 5 ? 5 : 0], id: '69999999-0000-4000-8000-000000000001', slug: 'draft-one', status: 'draft' });
  return out;
}
