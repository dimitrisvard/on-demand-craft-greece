// O5: the narrative prompt follows the Phase 4 prompt convention (PHASE5_SPEC §3.2 registry row, §6.6, D-31):
// registry entry, front matter equal to the entry, structured-output schema {lines: string[]} within the schema
// rules, LOCK.json hashes of the released files, and a system text that keeps the model on the figures.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { frontMatterProblems, parseFrontMatter, PROMPTS, schemaRuleProblems, selectPrompt } from '../../../src/agents/prompts/registry';
import { NARRATIVE_PROMPT } from '../../../src/workflows/ops-digest';

const DIR = new URL('../../../src/agents/prompts/ops_digest/', import.meta.url);
const read = (f: string): string => readFileSync(new URL(f, DIR), 'utf8');
const bytes = (f: string) => readFileSync(new URL(f, DIR));

describe('ops_digest.narrative@v1', () => {
  it('registry entry as the spec names it', () => {
    expect(NARRATIVE_PROMPT).toBe('ops_digest.narrative@v1');
    expect(PROMPTS[NARRATIVE_PROMPT]).toEqual({ file: 'ops_digest/narrative.v1.md', schema: 'ops_digest/narrative.v1.schema.json', route: 'extract', max_tokens: 800, effort: 'low' });
    expect(selectPrompt('ops_digest.narrative', { enabled: true, mode: 'assist', value: {} })).toBe(NARRATIVE_PROMPT);
  });

  it('front matter equals the entry; the schema is {lines: string[]} and follows the rules', () => {
    const { meta, body } = parseFrontMatter(read('narrative.v1.md'));
    expect(frontMatterProblems(NARRATIVE_PROMPT, meta)).toEqual([]);
    expect(body).toContain('<metrics>');
    expect(body).toMatch(/exactly five lines/);
    expect(body).toMatch(/Never invent or estimate a number/);
    const schema = JSON.parse(read('narrative.v1.schema.json'));
    expect(schema).toEqual({ type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } }, required: ['lines'], additionalProperties: false });
    expect(schemaRuleProblems(schema)).toEqual([]);
  });

  it('LOCK.json lists exactly the released files with their SHA-256', () => {
    const lock = JSON.parse(read('LOCK.json')) as Record<string, string>;
    const files = readdirSync(DIR).filter((f) => /\.v\d+\.(md|schema\.json)$/.test(f)).sort();
    expect(Object.keys(lock).sort()).toEqual(files);
    expect(files).toEqual(['narrative.v1.md', 'narrative.v1.schema.json']);
    for (const f of files) expect(lock[f], f).toBe(createHash('sha256').update(bytes(f)).digest('hex'));
  });

  it('the files hold no literal emoji and no address', () => {
    for (const f of ['narrative.v1.md', 'narrative.v1.schema.json']) {
      const text = read(f);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    }
  });
});
