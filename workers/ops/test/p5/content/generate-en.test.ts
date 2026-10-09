// C5: the English article port against the live generate-daily-article (version 36,
// test/oracles/generate-daily-article.v36.ts): parser and guards on recorded-style answers (valid, code fence, stray
// quote, truncated, under 2,000 words), cleanHtmlContent, the prompt text for every rotation, silo neighbours,
// rotation indices, silo of the day and the slug.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArticleRejectedError,
  cleanHtmlContent,
  fetchSiloNeighbors,
  formatSiloArticlesForPrompt,
  generateSlug,
  parseMasterArticle,
  recoverContentField,
  renderGeneratePrompt,
  rotationIndices,
  SILO_ROTATION,
  todaysSilo,
  wordCount,
} from '../../../src/content/generate-en';
import { P5MemoryDb } from '../../../src/ports/p5-stub/index';
import { fakeSupabase } from '../../oracles/fake-supabase';
import * as oracle from '../../oracles/generate-daily-article.v36';
import { articleHtml, modelJson, strayQuoteJson } from './fixtures';

afterEach(() => vi.useRealTimers());

const TITLE = 'Precision CNC Machining of Al 6061-T6: Tolerances (ISO 2768) & Cost';

/** The live parser's result for an answer, or the error message it throws. */
async function liveParse(answer: string, title = TITLE): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  oracle.setOracleModel(async () => answer);
  try {
    return { ok: true, value: await oracle.generateMasterArticle(title, 'Advanced CNC Machining Strategy', '- x', 0, 0) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

function portParse(answer: string, title = TITLE): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const r = parseMasterArticle(answer, title);
    const { words: _w, ...rest } = r;
    return { ok: true, value: rest };
  } catch (e) {
    expect(e).toBeInstanceOf(ArticleRejectedError);
    return { ok: false, message: (e as Error).message };
  }
}

describe('parser and guards against the live code', () => {
  const long = articleHtml(2300, { seed: 1 });
  const cases: Array<[string, string]> = [
    ['valid JSON', modelJson(long)],
    ['code fence', modelJson(long, { fence: true })],
    ['stray quote in content (key-anchored recovery)', strayQuoteJson(long)],
    ['truncated answer (no closing key)', modelJson(long).slice(0, 9000)],
    ['under 2,000 words', modelJson(articleHtml(1500, { seed: 2 }))],
    ['H1 with the title and long meta fields', modelJson(`<h1>${TITLE}</h1>\n` + long, { metaTitle: 'T'.repeat(120), excerpt: 'E'.repeat(400), metaDescription: '```json D' })],
    ['no JSON at all', 'I cannot do that.'],
    ['broken JSON without content key', '{"excerpt": "x", '],
  ];
  for (const [name, answer] of cases) {
    it(name, async () => {
      const live = await liveParse(answer);
      const port = portParse(answer);
      expect(port).toEqual(live);
    });
  }

  it('outcomes: valid and stray-quote publish >= 2,000 words; truncated and short are rejected', () => {
    expect(parseMasterArticle(modelJson(long), TITLE).words).toBeGreaterThanOrEqual(2000);
    expect(parseMasterArticle(strayQuoteJson(long), TITLE).words).toBeGreaterThanOrEqual(2000);
    expect(() => parseMasterArticle(modelJson(long).slice(0, 9000), TITLE)).toThrow(/Article too short/);
    expect(() => parseMasterArticle(modelJson(articleHtml(1500, { seed: 2 })), TITLE)).toThrow(/Article too short: \d+ words/);
    const h1 = parseMasterArticle(modelJson(`<h1>${TITLE}</h1>\n` + long), TITLE);
    expect(h1.content).not.toContain('<h1');
  });

  it('recoverContentField and wordCount', () => {
    const text = '{"content": "a "b" c", "excerpt": "e"}';
    const start = text.indexOf('"content": "') + 12;
    expect(recoverContentField(text, start)).toEqual(oracle.recoverContentField(text, start));
    expect(wordCount('<p>one</p><p>two three</p>')).toBe(3);
  });
});

describe('cleanHtmlContent', () => {
  it('equals the live clean-up on links, tables, pre/code and whitespace', () => {
    const inputs = [
      articleHtml(400, { seed: 9, blogSlugs: ['x-y'] }),
      '<p>Text<a href="/en/quote">q</a>more.</p>\n\n\n\n<p>  spaced   words  </p>',
      '<table><tr><td>A<a href="/x">l</a>B</td></tr></table>',
      '<pre>  keep   spaces  </pre><p>a    b</p><code>x    y</code>',
      '<p>(<a href="/a">x</a>), <a href="/b">y</a>!</p><td>\n\n\n</td>',
      '',
      '<p>same</p><p>same</p><pre><p>same</p></pre>',
    ];
    for (const input of inputs) expect(cleanHtmlContent(input)).toBe(oracle.cleanHtmlContent(input));
  });
});

describe('prompt text', () => {
  it('equals the live prompt for every service and quote rotation, with and without neighbours and silo', async () => {
    const neighbourSets = [[], [{ title: 'Guide "A"', slug: 'guide-a' }], [{ title: 'A', slug: 'a' }, { title: 'B', slug: 'b' }, { title: 'C', slug: 'c' }]];
    for (const neighbours of neighbourSets) {
      const related = formatSiloArticlesForPrompt(neighbours);
      expect(related).toBe(oracle.formatSiloArticlesForPrompt(neighbours));
      for (let serviceIndex = 0; serviceIndex < 3; serviceIndex++) {
        for (let quoteIndex = 0; quoteIndex < 5; quoteIndex++) {
          for (const silo of ['Sheet Metal & Fabrication', null]) {
            let livePrompt = '';
            oracle.setOracleModel(async (prompt: string) => {
              livePrompt = prompt;
              return modelJson(articleHtml(2100));
            });
            await oracle.generateMasterArticle(TITLE, silo, related, serviceIndex, quoteIndex);
            expect(renderGeneratePrompt({ title: TITLE, siloCategory: silo, relatedArticles: related, serviceIndex, quoteIndex })).toBe(livePrompt);
          }
        }
      }
    }
  });

  it('a title containing ${...} is inserted as text', () => {
    const p = renderGeneratePrompt({ title: 'Cost ${x} guide', siloCategory: null, relatedArticles: '-', serviceIndex: 0, quoteIndex: 0 });
    expect(p).toContain('"Cost ${x} guide"');
  });
});

describe('database helpers against the live queries', () => {
  const titles = [
    { id: 't-1', title: 'Old A', silo_category: 'Sheet Metal & Fabrication', processed: true, created_at: '2026-09-01T00:00:00Z' },
    { id: 't-2', title: 'Old B', silo_category: 'Sheet Metal & Fabrication', processed: true, created_at: '2026-09-02T00:00:00Z' },
    { id: 't-3', title: 'Dup', silo_category: 'Sheet Metal & Fabrication', processed: true, created_at: '2026-09-03T00:00:00Z' },
    { id: 't-3b', title: 'Dup', silo_category: 'Sheet Metal & Fabrication', processed: true, created_at: '2026-09-03T00:00:00Z' },
    { id: 't-4', title: 'Other silo', silo_category: 'Die Casting & Metal Casting', processed: true, created_at: '2026-09-04T00:00:00Z' },
    { id: 't-5', title: 'Current', silo_category: 'Sheet Metal & Fabrication', processed: false, created_at: '2026-09-05T00:00:00Z' },
  ];
  const articles = [
    { id: 'a-1', title: 'Old A', slug: 'old-a', language: 'en', status: 'published', created_at: '2026-09-01T07:00:00Z' },
    { id: 'a-2', title: 'Dup', slug: 'dup', language: 'en', status: 'published', created_at: '2026-09-03T07:00:00Z' },
    { id: 'a-3', title: 'Other silo', slug: 'other', language: 'en', status: 'published', created_at: '2026-09-04T07:00:00Z' },
    { id: 'a-4', title: 'Old B', slug: 'old-b', language: 'en', status: 'published', created_at: '2026-09-02T07:00:00Z' },
    { id: 'a-5', title: 'Current', slug: 'current', language: 'en', status: 'draft', created_at: '2026-09-05T07:00:00Z' },
    { id: 'a-6', title: 'Old A', slug: 'old-a-de', language: 'de', status: 'published', created_at: '2026-09-01T08:00:00Z' },
  ];

  it('silo neighbours: up to 2 of the last 20 English articles with exactly one matching title row', async () => {
    oracle.setOracleSupabase(fakeSupabase({ articles: structuredClone(articles), article_titles: structuredClone(titles) }));
    const db = new P5MemoryDb();
    db.seed('articles', structuredClone(articles));
    db.seed('article_titles', structuredClone(titles));
    for (const [silo, current] of [['Sheet Metal & Fabrication', 't-5'], ['Sheet Metal & Fabrication', 't-1'], ['Die Casting & Metal Casting', 't-5'], [null, 't-5']] as const) {
      expect(await fetchSiloNeighbors(db, silo, current)).toEqual(await oracle.fetchSiloNeighbors(silo, current));
    }
    expect(await fetchSiloNeighbors(db, 'Sheet Metal & Fabrication', 't-5')).toEqual([{ title: 'Old B', slug: 'old-b' }, { title: 'Old A', slug: 'old-a' }]);
  });

  it('rotation indices: published English count mod 3 and mod 5', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({ id: `b-${String(i).padStart(5, '0')}`, title: `t${i}`, slug: `s${i}`, language: i % 7 === 0 ? 'de' : 'en', status: i % 11 === 0 ? 'draft' : 'published', created_at: '2026-01-01T00:00:00Z' }));
    oracle.setOracleSupabase(fakeSupabase({ articles: structuredClone(many) }));
    const db = new P5MemoryDb();
    db.seed('articles', many);
    const live = await oracle.getRotationIndex();
    const port = await rotationIndices(db);
    expect({ serviceIndex: port.serviceIndex, quoteIndex: port.quoteIndex }).toEqual(live);
    expect(port.count).toBeGreaterThan(1000);
  });

  it('silo of the day and the slug equal the live functions', () => {
    for (const day of ['2026-01-01', '2026-01-05', '2026-01-06', '2026-02-28', '2026-10-08', '2028-12-31']) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${day}T07:00:00Z`));
      expect(todaysSilo(day)).toBe(oracle.getTodaysSilo());
      vi.useRealTimers();
    }
    expect(SILO_ROTATION).toEqual(oracle.SILO_ROTATION);
    for (const t of [TITLE, '  --Hello, World!--  ', 'Ünïcode títle 2026']) expect(generateSlug(t)).toBe(oracle.generateSlug(t));
  });
});
