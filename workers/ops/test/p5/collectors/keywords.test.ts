// Keyword scoring of the collectors (src/collectors/keywords.ts): every rule branch of the live tables for both
// variants (reddit counts industry_specific as material, hn does not), then equality with the live matchKeywords of
// reddit-collector v15 and hn-collector v7 (run from their repository sources, test/p5/collectors/live-source.ts) on
// a seeded corpus of 600 texts; loadKeywords reads only the active rows.

import { describe, expect, it } from 'vitest';
import { loadKeywords, matchKeywords, type Keyword } from '../../../src/collectors/keywords';
import { P5MemoryDb } from '../../../src/ports/p5-stub/index';
import { fixture, seedKeywords, type FixtureKeyword } from './harness';
import { fakeSupabase, loadLive } from './live-source';

const KW: Keyword[] = fixture<FixtureKeyword[]>('keywords.json')
  .filter((k) => k.is_active)
  .map(({ keyword, category, weight }) => ({ keyword, category, weight }));

describe('rule table (hand-computed)', () => {
  const cases: Array<{ text: string; reddit: string; hn: string; matched: string[]; weight: number }> = [
    { text: 'nothing relevant here', reddit: 'noise', hn: 'noise', matched: [], weight: 0 },
    { text: 'Looking for manufacturer in GERMANY', reddit: 'high', hn: 'high', matched: ['looking for manufacturer', 'Germany'], weight: 4 },
    { text: 'xometry is slow', reddit: 'high', hn: 'high', matched: ['xometry is slow', 'xometry'], weight: 4 },
    { text: 'who can machine for our formula student car', reddit: 'high', hn: 'high', matched: ['who can machine', 'formula student'], weight: 4 },
    { text: 'machining quote and rapid prototyping, cnc', reddit: 'high', hn: 'high', matched: ['machining quote', 'cnc', 'rapid prototyping'], weight: 6 },
    { text: 'who can machine this?', reddit: 'medium', hn: 'medium', matched: ['who can machine'], weight: 2 },
    { text: 'titanium and aluminium 6061 stock', reddit: 'medium', hn: 'medium', matched: ['aluminium 6061', 'titanium'], weight: 2 },
    { text: 'aerospace medical device brackets', reddit: 'medium', hn: 'low', matched: ['aerospace', 'medical device'], weight: 2 },
    { text: 'formula student season', reddit: 'medium', hn: 'medium', matched: ['formula student'], weight: 2 },
    { text: 'rapid prototyping with sheet metal', reddit: 'medium', hn: 'medium', matched: ['sheet metal', 'rapid prototyping'], weight: 3 },
    { text: 'protolabs or xometry?', reddit: 'low', hn: 'low', matched: ['xometry', 'protolabs'], weight: 2 },
    { text: 'an EU supplier', reddit: 'low', hn: 'low', matched: ['EU supplier'], weight: 2 },
    { text: 'cnc', reddit: 'low', hn: 'low', matched: ['cnc'], weight: 1 },
    { text: 'tolerance only', reddit: 'noise', hn: 'noise', matched: ['tolerance'], weight: 0 },
    { text: 'anodising (null weight)', reddit: 'noise', hn: 'noise', matched: ['anodising'], weight: 0 },
    { text: 'titanium', reddit: 'low', hn: 'low', matched: ['titanium'], weight: 1 },
  ];
  for (const c of cases) {
    it(`${JSON.stringify(c.text)} -> reddit ${c.reddit}, hn ${c.hn}`, () => {
      const r = matchKeywords(c.text, KW, 'reddit');
      const h = matchKeywords(c.text, KW, 'hn');
      expect(r.score).toBe(c.reddit);
      expect(h.score).toBe(c.hn);
      expect(r.matched).toEqual(c.matched);
      expect(h.matched).toEqual(c.matched);
      expect(h.scoreValue).toBe(c.weight);
    });
  }

  it('categories keep the order of their first match; matching is a case-insensitive substring', () => {
    const m = matchKeywords('CNC in germany: Looking For Manufacturer', KW, 'reddit');
    expect(m.matched).toEqual(['looking for manufacturer', 'Germany', 'cnc']);
    expect(m.categories).toEqual(['sourcing_intent', 'geographic_europe', 'process']);
    expect(matchKeywords('xometryish', KW, 'reddit').matched).toEqual(['xometry']);
  });
});

describe('loadKeywords', () => {
  it('reads keyword, category and weight of the active rows only', async () => {
    const db = new P5MemoryDb();
    seedKeywords(db);
    const loaded = await loadKeywords(db);
    expect(loaded).toEqual(KW);
    expect(loaded.some((k) => k.keyword === 'weekend')).toBe(false);
  });
});

/** Mulberry32: a small seeded PRNG so the corpus is the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function corpus(n: number, seed: number): string[] {
  const rand = prng(seed);
  const filler = ['part', 'batch', 'please', 'quick', 'question', 'shop', 'lathe', 'design', 'help', 'Ask HN:', 'r/'];
  const pieces = [...KW.map((k) => k.keyword), ...filler];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const words: string[] = [];
    const len = 1 + Math.floor(rand() * 6);
    for (let j = 0; j < len; j++) {
      let w = pieces[Math.floor(rand() * pieces.length)];
      const r = rand();
      if (r < 0.2) w = w.toUpperCase();
      else if (r < 0.3) w = w.replace(/^./, (c) => c.toUpperCase());
      words.push(w);
    }
    out.push(words.join(rand() < 0.5 ? ' ' : ', '));
  }
  return out;
}

describe('equal to the live matchKeywords (600 seeded texts per variant)', () => {
  const rt = { env: {}, supabase: fakeSupabase(new P5MemoryDb()), fetch: async () => new Response(null, { status: 599 }) };
  const liveReddit = loadLive('reddit-collector', rt);
  const liveHn = loadLive('hn-collector', rt);
  const texts = corpus(600, 20261008);

  it('reddit variant', () => {
    let nonNoise = 0;
    for (const text of texts) {
      const port = matchKeywords(text, KW, 'reddit');
      const live = liveReddit.matchKeywords(text, KW);
      expect({ matched: port.matched, categories: port.categories, score: port.score }, text).toEqual({ matched: live.matched, categories: live.categories, score: live.score });
      if (port.score !== 'noise') nonNoise++;
    }
    expect(nonNoise).toBeGreaterThan(300);
  });

  it('hn variant (with score_value)', () => {
    const scores = new Set<string>();
    for (const text of texts) {
      const port = matchKeywords(text, KW, 'hn');
      const live = liveHn.matchKeywords(text, KW);
      expect(port, text).toEqual({ matched: live.matched, categories: live.categories, score: live.score, scoreValue: live.scoreValue });
      scores.add(port.score);
    }
    expect([...scores].sort()).toEqual(['high', 'low', 'medium', 'noise']);
  });

  it('the two variants differ exactly where industry_specific decides', () => {
    const differ = texts.filter((t) => matchKeywords(t, KW, 'reddit').score !== matchKeywords(t, KW, 'hn').score);
    expect(differ.length).toBeGreaterThan(0);
    for (const t of differ) expect(matchKeywords(t, KW, 'reddit').categories).toContain('industry_specific');
  });
});
