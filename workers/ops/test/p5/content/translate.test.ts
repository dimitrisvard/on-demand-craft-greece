// C5: translateToLanguage() against the live translate-article v81 (test/oracles/translate-article.v81.ts) on the same
// model answers: prompts sent (main and table chunks), delimiter parse and fallbacks, guards, link localisation and
// clean-up, table placeholders (exact, tolerant and emergency restores), table cell translation in chunks of 80, the
// 90 s table budget and broken-table repair.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_NAMES, TARGET_LANGS } from '../../../src/content/languages';
import { localizeLinks, makeSlug, TranslationRejectedError, translateToLanguage, type OriginalArticle } from '../../../src/content/translate';
import * as oracle from '../../oracles/translate-article.v81';
import { delimiterAnswer } from './fixtures';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

const TABLE_A = "<table class='editor-table'><thead><tr><th>Property</th><th>6061-T6</th></tr></thead><tbody><tr><td>Yield</td><td><strong>276</strong> MPa</td></tr></tbody></table>";
const TABLE_B = '<table><tbody><tr><td>Ra 0.8 <em>µm</em> polished</td><td></td></tr></tbody></table>';

function original(o: Partial<OriginalArticle> = {}): OriginalArticle {
  const body = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} about anodised aluminium and tolerances.</p>`).join('\n');
  return {
    title: 'Anodising Aluminium Parts',
    content: `<p>Intro <a href="/en/quote">quote</a>, <a href='/en/services/cnc-machining'>cnc</a>, <a href="/en/services">all</a>, <a href="/en/blog/other-guide">guide</a>.</p>\n${TABLE_A}\n${body}\n${TABLE_B}\n<p>End.</p>`,
    excerpt: 'Excerpt.',
    metaTitle: 'Anodising | Microns Hub',
    metaDescription: 'Meta.',
    ...o,
  };
}

type Answer = (prompt: string, kind: 'main' | 'table') => string | { status: number };

/** Main answer: the content part of the prompt with each paragraph marked, placeholders transformed by `ph`. */
function mainAnswer(o: { ph?: (c: string) => string; extra?: string; meta?: Partial<Parameters<typeof delimiterAnswer>[0]>; end?: boolean } = {}): Answer {
  return (prompt, kind) => {
    if (kind === 'table') {
      const n = Number(/\((\d+) cells total\)/.exec(prompt)![1]);
      const cells = prompt.split('CELLS TO TRANSLATE:\n')[1].split('\n---CELL---\n');
      expect(cells.length).toBe(n);
      return cells.map((c) => `T(${c})`).join('\n---CELL---\n');
    }
    const lang = /into ([A-Za-z]+)\./.exec(prompt)![1];
    let content = prompt.split('\nCONTENT:\n')[1].split('\n\nEXCERPT: ')[0].replace(/<p>Paragraph/g, `<p>${lang} paragraph`);
    if (o.ph) content = o.ph(content);
    if (o.extra) content += o.extra;
    return delimiterAnswer({ title: `${lang} Title Éé`, slug: `${lang}-titel ärger`, content, end: o.end, ...o.meta });
  };
}

/** Kind of a prompt (the table prompt has its own first line). */
function kindOf(prompt: string): 'main' | 'table' {
  return prompt.startsWith('Translate the following table cell contents') ? 'table' : 'main';
}

interface Run {
  prompts: string[];
  result: { ok: true; value: Record<string, unknown> } | { ok: false; message: string };
}

async function runLive(orig: OriginalArticle, lang: string, answer: Answer, mainMs = 1000): Promise<Run> {
  let now = 1_000_000;
  const prompts: string[] = [];
  oracle.setOracleIo({
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      if (ms < 60_000) Promise.resolve().then(fn);
      return 0;
    },
    clearTimeout: () => {},
    fetch: async (_url: string, init: { body: string }) => {
      const prompt = JSON.parse(init.body).contents[0].parts[0].text as string;
      prompts.push(prompt);
      const kind = kindOf(prompt);
      if (kind === 'main') now += mainMs;
      const a = answer(prompt, kind);
      if (typeof a !== 'string') return new Response('{}', { status: a.status });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: a }] }, finishReason: 'STOP' }] }), { status: 200 });
    },
  });
  try {
    return { prompts, result: { ok: true, value: await oracle.translateToLanguage(orig, (LANGUAGE_NAMES as Record<string, string>)[lang], lang) } };
  } catch (e) {
    return { prompts, result: { ok: false, message: (e as Error).message } };
  }
}

async function runPort(orig: OriginalArticle, lang: string, answer: Answer, mainMs = 1000): Promise<Run & { tables: boolean | null }> {
  let now = 1_000_000;
  const prompts: string[] = [];
  let tables: boolean | null = null;
  try {
    const r = await translateToLanguage(orig, (LANGUAGE_NAMES as Record<string, string>)[lang], lang, {
      now: () => now,
      sleep: async () => {},
      call: async (prompt, kind) => {
        prompts.push(prompt);
        expect(kind).toBe(kindOf(prompt));
        if (kind === 'main') now += mainMs;
        const a = answer(prompt, kind);
        if (typeof a !== 'string') throw new Error(`Gemini API error: ${a.status}`);
        return a;
      },
    });
    const { tablesTranslated, ...value } = r;
    tables = tablesTranslated;
    return { prompts, result: { ok: true, value }, tables };
  } catch (e) {
    expect(e).toBeInstanceOf(TranslationRejectedError);
    return { prompts, result: { ok: false, message: (e as Error).message }, tables };
  }
}

async function same(orig: OriginalArticle, lang: string, answer: Answer, mainMs = 1000) {
  const live = await runLive(orig, lang, answer, mainMs);
  const port = await runPort(orig, lang, answer, mainMs);
  expect(port.prompts).toEqual(live.prompts);
  expect(port.result).toEqual(live.result);
  return port;
}

describe('translateToLanguage against the live function', () => {
  for (const lang of TARGET_LANGS) {
    it(`${lang}: prompts and result equal (tables translated)`, async () => {
      const r = await same(original(), lang, mainAnswer());
      expect(r.result.ok).toBe(true);
      expect(r.tables).toBe(true);
      expect(r.prompts.length).toBe(2);
    });
  }

  it('placeholders with spaces are restored by the tolerant patterns', async () => {
    await same(original(), 'de', mainAnswer({ ph: (c) => c.replace('<!--TABLE_1-->', '<!-- TABLE_1 -->').replace('<!--TABLE_0-->', '<!--TABLE0-->') }));
  });

  it('1-based placeholders and an old-style placeholder', async () => {
    await same(original(), 'fr', mainAnswer({ ph: (c) => c.replace('<!--TABLE_1-->', '<!--TABLE_2-->').replace('<!--TABLE_0-->', '__TABLE_PLACEHOLDER_0__') }));
  });

  it('a dropped placeholder, a duplicated one and an unclosed table in the answer', async () => {
    await same(original(), 'it', mainAnswer({ ph: (c) => c.replace('<!--TABLE_0-->', '').replace('<!--TABLE_1-->', '<!--TABLE_1--><!--TABLE_1-->'), extra: "\n<table class='x'><tr><td>open" }));
  });

  it('dashboard links removed, mismatched href quotes repaired, meta fields clipped and branded', async () => {
    const r = await same(
      original(),
      'pl',
      mainAnswer({
        extra: `\n<p><a href="/en/dashboard/x">admin</a> and <a href="/pl/x'>bad</a> and <a href='/pl/y">bad2</a></p>`,
        meta: { metaTitle: 'M'.repeat(90), metaDescription: 'D'.repeat(200) },
      }),
    );
    if (r.result.ok) {
      expect(String(r.result.value.content)).not.toContain('dashboard');
      expect(String(r.result.value.metaTitle).length).toBe(70);
    }
  });

  it('table cells: more than 80 cells go in two chunks; a changed separator is re-split', async () => {
    const rowsHtml = Array.from({ length: 50 }, (_, i) => `<tr><td>a${i}</td><td>b${i}</td></tr>`).join('');
    const big = original({ content: original().content.replace(TABLE_B, `<table><tbody>${rowsHtml}</tbody></table>`) });
    const r = await same(big, 'nl', (prompt, kind) => {
      if (kind === 'table') {
        const cells = prompt.split('CELLS TO TRANSLATE:\n')[1].split('\n---CELL---\n');
        return cells.map((c) => `X ${c}`).join(' ---cell--- ');
      }
      return mainAnswer()(prompt, kind);
    });
    expect(r.prompts.length).toBe(3);
  });

  it('a failed table call keeps the English tables', async () => {
    const r = await same(original(), 'sv', (prompt, kind) => (kind === 'table' ? { status: 400 } : mainAnswer()(prompt, kind)));
    expect(r.tables).toBe(false);
    expect(String((r.result as { value: Record<string, unknown> }).value.content)).toContain(TABLE_A);
  });

  it('main call over 90 s: table translation skipped', async () => {
    const r = await same(original(), 'hu', mainAnswer(), 95_000);
    expect(r.prompts.length).toBe(1);
    expect(r.tables).toBe(false);
  });

  it('answers without ===END===, without excerpt and meta delimiters', async () => {
    await same(original(), 'cs', mainAnswer({ end: false }));
    await same(original(), 'da', (prompt, kind) => {
      const full = mainAnswer()(prompt, kind) as string;
      return kind === 'main' ? full.split('===EXCERPT===')[0] : full;
    });
  });

  it('rejections: no usable content, and content under 200 characters', async () => {
    const none = await same(original(), 'fi', () => 'sorry');
    expect(none.result.ok).toBe(false);
    const short = await same(original(), 'nb', (p, k) => (k === 'main' ? delimiterAnswer({ title: 't', slug: 's', content: 'x'.repeat(150) }) : ''));
    expect(short.result).toEqual({ ok: false, message: 'Translated content for Norwegian is empty or truncated (150 chars)' });
  });

  it('no tables: one call, tablesTranslated null', async () => {
    const r = await same(original({ content: original().content.replace(TABLE_A, '').replace(TABLE_B, '') }), 'es', mainAnswer());
    expect(r.prompts.length).toBe(1);
    expect(r.tables).toBe(null);
  });

  it('localizeLinks and makeSlug equal the live helpers', () => {
    const html = `<a href="/en/quote">q</a><a href='/EN/SERVICES/sheet-metal'>s</a><a href="/en/services/injection-molding">i</a><a href="/en/blog/x">b</a><a href="/en/services">a</a>`;
    for (const lang of [...TARGET_LANGS, 'xx']) expect(localizeLinks(html, lang)).toBe(oracle.localizeLinks(html, lang));
    for (const t of ['Élégant Ünïcode — Title!', '  a  b  ', 'Česká tvorba řešení']) expect(makeSlug(t)).toBe(oracle.makeSlug(t));
  });
});
