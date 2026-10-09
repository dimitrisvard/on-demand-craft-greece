// C5: fix-links against the live fix-article-links (version 15, test/oracles/fix-article-links.v15.ts): the same link
// rewrites for every language, rows written only when a blog link changed, complete mapping over paged reads, and
// shadow mode counting without writing.

import { describe, expect, it } from 'vitest';
import { addTargetBlankToInternalLinks, buildSlugMapping, fixLinksForLanguage, fixLinksInContent, slugMappingOf } from '../../../src/content/fix-links';
import { SERVICE_SLUGS, TARGET_LANGS } from '../../../src/content/languages';
import { P5MemoryDb } from '../../../src/ports/p5-stub/index';
import { fakeSupabase } from '../../oracles/fake-supabase';
import * as oracle from '../../oracles/fix-article-links.v15';
import { rng } from './fixtures';

const tid = (n: number) => `7${String(n).padStart(7, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const aid = (n: number) => `6${String(n).padStart(7, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Translated content with every link form the live code handles. */
function content(lang: string, r: () => number, groups: number): string {
  const g = () => 1 + Math.floor(r() * groups);
  return [
    `<p>Intro<a href="/en/quote">quote</a>text and <a href='/en/services/cnc-machining'>cnc</a>.</p>`,
    `<p>See <a href="/${lang}/blog/en-guide-${g()}">a</a>, <a href='/en/blog/en-guide-${g()}?ref=x'>b</a> and <a href="/${lang}/blog/en-guide-${g()}#part">c</a>.</p>`,
    `<p>Already local <a href="/${lang}/blog/${lang}-guide-1" target="_self">d</a>; unknown <a href="/${lang}/blog/no-such-slug">e</a>(x)</p>`,
    `<table><tbody><tr><td><a href="/en/blog/en-guide-${g()}">in table</a>next</td></tr></tbody></table>`,
    `<p>External <a href="https://example.com/x">ext</a>and services <a href="/en/services">all</a>!</p>`,
    `<p><a href="/en/services/sheet-metal">sm</a><a href="/en/services/injection-molding">im</a></p>`,
  ].join('\n');
}

function corpus(groups = 12) {
  const r = rng(3);
  const articles: Array<Record<string, unknown>> = [];
  let n = 0;
  for (let gi = 1; gi <= groups; gi++) {
    articles.push({ id: aid(++n), slug: `en-guide-${gi}`, language: 'en', translation_id: tid(gi), content: '<p>en</p>', status: 'published' });
    for (const lang of TARGET_LANGS) {
      if ((gi + lang.charCodeAt(0)) % 4 === 0) continue; // some languages missing
      articles.push({ id: aid(++n), slug: `${lang}-guide-${gi}`, language: lang, translation_id: tid(gi), content: content(lang, r, groups), status: 'published' });
    }
  }
  // an English article without translation_id and a translated orphan
  articles.push({ id: aid(++n), slug: 'en-orphan', language: 'en', translation_id: null, content: '<p>x</p>', status: 'published' });
  articles.push({ id: aid(++n), slug: 'de-orphan', language: 'de', translation_id: null, content: content('de', r, groups), status: 'published' });
  return articles;
}

describe('fix-links against the live function', () => {
  it('service slug table is the live one', () => {
    expect(SERVICE_SLUGS).toEqual(oracle.SERVICE_SLUGS);
  });

  it('mapping equals the live global mapping', async () => {
    const articles = corpus();
    const client = fakeSupabase({ articles: structuredClone(articles) });
    oracle.setOracleSupabase(client);
    const live = await oracle.buildGlobalSlugMapping();
    const db = new P5MemoryDb();
    db.seed('articles', structuredClone(articles));
    expect(await buildSlugMapping(db)).toEqual(live);
  });

  it('full pass, one language at a time: same contents and counts as the live fix_all pass', async () => {
    const articles = corpus();
    const client = fakeSupabase({ articles: structuredClone(articles) });
    oracle.setOracleSupabase(client);
    const liveMapping = await oracle.buildGlobalSlugMapping();
    const live = await oracle.fixAllArticleLinks(liveMapping);

    const db = new P5MemoryDb();
    db.seed('articles', structuredClone(articles));
    let updated = 0;
    let links = 0;
    for (const lang of TARGET_LANGS) {
      const mapping = await buildSlugMapping(db);
      const r = await fixLinksForLanguage(db, lang, mapping, { write: true, pageSize: 7 });
      updated += r.updated;
      links += r.links;
      expect(r.changed).toBe(r.updated);
    }
    expect({ updated, links }).toEqual({ updated: live.articlesUpdated, links: live.linksFixed });
    expect(updated).toBeGreaterThan(20);
    const port = new Map(db.rows('articles').map((a) => [a.id, a.content]));
    for (const a of client.tables.articles) expect(port.get(a.id)).toBe(a.content);
    // rows with no blog-link change are not written (live rule), even when spacing would change
    const writes = db.calls.filter((c) => c.method === 'update').length;
    expect(writes).toBe(client.updates.length);
  });

  it('shadow (write: false) counts the same rows and writes nothing', async () => {
    const articles = corpus();
    const db = new P5MemoryDb();
    db.seed('articles', structuredClone(articles));
    const mapping = await buildSlugMapping(db);
    const r = await fixLinksForLanguage(db, 'de', mapping, { write: false });
    expect(r.changed).toBeGreaterThan(0);
    expect(r.updated).toBe(0);
    expect(db.calls.some((c) => c.method === 'update')).toBe(false);
    expect(db.rows('articles').map((a) => a.content)).toEqual(articles.map((a) => a.content));
  });

  it('text transforms equal the live ones on edge inputs', () => {
    const mapping = slugMappingOf(
      [{ slug: 'a', translation_id: 't1' }, { slug: 'b$&', translation_id: 't2' }],
      [{ slug: 'a-de', translation_id: 't1', language: 'de' }, { slug: '$1-x', translation_id: 't2', language: 'de' }],
    );
    const inputs = [
      '',
      '<p>x<a href="/de/blog/a">y</a>z</p>',
      "<a href='/de/blog/a/'>trailing</a>",
      '<a href="/de/blog/b$&">dollar</a> and <a href="/de/blog/a">again</a> <a href="/de/blog/a">twice</a>',
      '<table><tr><td>[<a href="/de/blog/a">t</a>]</td></tr></table><table><tr><td>x</td></tr></table>',
      '<a href="/de/quote" target="_blank">q</a><a  href="/de/services/x">s</a>',
      '<p>multi\nline <a href="/de/blog/a">\nx</a>.</p>',
    ];
    for (const input of inputs) {
      expect(fixLinksInContent(input, 'de', mapping)).toEqual(oracle.fixLinksInContent(input, 'de', mapping));
      expect(addTargetBlankToInternalLinks(input)).toBe(oracle.addTargetBlankToInternalLinks(input));
    }
  });

  it('mapping is complete beyond one PostgREST page (paged reads)', async () => {
    const db = new P5MemoryDb();
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 230; i++) {
      rows.push({ id: aid(i * 20), slug: `en-${i}`, language: 'en', translation_id: tid(i), content: '' });
      TARGET_LANGS.forEach((lang, k) => rows.push({ id: aid(i * 20 + k + 1), slug: `${lang}-${i}`, language: lang, translation_id: tid(i), content: '' }));
    }
    db.seed('articles', rows);
    expect(rows.length).toBeGreaterThan(3000);
    const mapping = await buildSlugMapping(db);
    expect(Object.keys(mapping).length).toBe(230);
    expect(mapping['en-230']).toEqual(Object.fromEntries(TARGET_LANGS.map((l) => [l, `${l}-230`])));
    // English rows: one page; all rows: 4 pages of 1,000 (each later page repeats its boundary row)
    expect(db.calls.filter((c) => c.method === 'select').length).toBe(5);
  });
});
