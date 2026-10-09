// C5: the frozen content prompts (src/content/prompts/, D-31). Each file is byte-equal to the template literal of the
// live source (repository copies of generate-daily-article v36 and translate-article v81, re-synced from live in
// Wave 0): escapes evaluated, `${...}` substitutions kept as written. LOCK.json pins the bytes; a prompt change is a
// new version file.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placeholders, renderTemplate, TemplateError } from '../../../src/content/template';

const ROOT = new URL('../../../../../', import.meta.url).pathname;
const PROMPTS = new URL('../../../src/content/prompts/', import.meta.url).pathname;

/** The cooked text of the template literal that starts right after `marker` (substitutions kept verbatim). */
function templateAfter(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(src.indexOf(marker, start + 1)).toBe(-1);
  let i = start + marker.length;
  let out = '';
  const escapes: Record<string, string> = { '\\': '\\', '`': '`', $: '$', n: '\n', t: '\t', '"': '"', "'": "'" };
  for (;;) {
    const c = src[i];
    if (c === undefined) throw new Error('unterminated template');
    if (c === '\\') {
      const e = escapes[src[i + 1]];
      if (e === undefined) throw new Error(`unsupported escape \\${src[i + 1]}`);
      out += e;
      i += 2;
    } else if (c === '$' && src[i + 1] === '{') {
      let depth = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) break;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '`') {
      return out;
    } else {
      out += c;
      i++;
    }
  }
}

const gen = readFileSync(`${ROOT}supabase/functions/generate-daily-article/index.ts`, 'utf8');
const tr = readFileSync(`${ROOT}supabase/functions/translate-article/index.ts`, 'utf8');
const SOURCES: Record<string, string> = {
  'generate_en.v1.md': templateAfter(gen, 'const prompt = `'),
  'translate.v1.md': templateAfter(tr, '  const prompt = `'),
  'translate_table.v1.md': templateAfter(tr, 'const translationPrompt = `'),
};

describe('frozen content prompts', () => {
  const lock = JSON.parse(readFileSync(`${PROMPTS}LOCK.json`, 'utf8')) as Record<string, string>;

  it('LOCK.json lists exactly the prompt files', () => {
    const files = readdirSync(PROMPTS).filter((f) => f.endsWith('.md')).sort();
    expect(Object.keys(lock).sort()).toEqual(files);
    expect(files).toEqual(['generate_en.v1.md', 'translate.v1.md', 'translate_table.v1.md']);
  });

  for (const [file, live] of Object.entries(SOURCES)) {
    it(`${file} is byte-equal to the live template and to its lock`, () => {
      const bytes = readFileSync(`${PROMPTS}${file}`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(lock[file]);
      const text = new TextDecoder().decode(bytes);
      expect(text).toBe(live);
      expect(text.includes('\r')).toBe(false);
    });
  }

  it('placeholders are the live substitutions', () => {
    const text = (f: string) => readFileSync(`${PROMPTS}${f}`, 'utf8');
    expect(placeholders(text('generate_en.v1.md'))).toEqual([
      'BRAND_NAME',
      'title',
      'relatedArticles',
      'selectedService.name',
      'selectedService.name.toLowerCase()',
      'selectedService.url',
      'selectedService.anchor',
      'selectedQuoteText',
      "siloCategory || 'General'",
    ]);
    expect(placeholders(text('translate.v1.md'))).toEqual(['langName', 'languageSpecificNote', 'BRAND_NAME', 'original.title', 'contentForTranslation', 'original.excerpt', 'original.metaTitle', 'original.metaDescription']);
    expect(placeholders(text('translate_table.v1.md'))).toEqual(['langName', 'chunk.length', 'textToTranslate']);
  });

  it('renderTemplate refuses a missing or an unused value', () => {
    expect(() => renderTemplate('a ${x} b', {})).toThrow(TemplateError);
    expect(() => renderTemplate('a ${x} b', { x: '1', y: '2' })).toThrow(/unused: y/);
    expect(renderTemplate('a ${x} ${x}', { x: '${x}' })).toBe('a ${x} ${x}');
  });
});
