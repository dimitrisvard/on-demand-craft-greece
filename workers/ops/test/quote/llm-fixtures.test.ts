// LLM fixtures of the quote prompts (test/fixtures/llm/quote.*): one per model call of the canonical quote (the seed
// of test/quote/seed.ts, also used by test/t2/quote.t2.ts), keyed by the SHA-256 of the user content the Workflow
// builds. With QUOTE_FIXTURES_WRITE=1 the files are (re)written from the canned answers of seed.ts; without it the
// test runs the canonical quote against the fixture files alone (a change of the prompt input changes the hash and
// fails here, and with it the T2 run), checks that each file's hash is the hash of its stored content, that each
// answer satisfies its prompt's schema, and that no fixture is left without a use.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LlmCall } from '../../src/ports/index';
import { llmContentSha256, valueSchemaProblems } from '../../src/ports/llm';
import { FakeLlm, LLM_FIXTURE_DIR, type AgentTestPorts } from '../helpers/agent-env';
import { harness, messageOf, runCase } from './harness';
import { COVER_ANSWER, NOTES_ANSWER } from './seed';

const WRITE = process.env.QUOTE_FIXTURES_WRITE === '1';
const PROMPTS = ['quote.price_notes@v1', 'quote.cover_email@v1'] as const;
const ANSWERS: Record<(typeof PROMPTS)[number], Record<string, unknown>> = { 'quote.price_notes@v1': NOTES_ANSWER, 'quote.cover_email@v1': COVER_ANSWER };
const SCHEMA_DIR = new URL('../../src/agents/prompts/quote/', import.meta.url).pathname;
const CASE = 'canonical-de-bracket';

const schemaOf = (prompt: string) => JSON.parse(readFileSync(`${SCHEMA_DIR}${prompt.split('.')[1].split('@')[0]}.v1.schema.json`, 'utf8')) as unknown;

/** The canonical quote, approved on the dashboard: draft, approval, send, follow-ups, expiry. */
async function canonical(llm?: FakeLlm) {
  const h = harness();
  if (llm) h.ports.llm = llm as unknown as AgentTestPorts['llm'];
  const { result } = await runCase(h, { decisions: { 'quote-approved': [{ verb: 'approve' }] } });
  return { h, result };
}

describe.skipIf(!WRITE)('write the quote LLM fixtures (QUOTE_FIXTURES_WRITE=1)', () => {
  it(CASE, async () => {
    const { h, result } = await canonical();
    expect(result.outcome).toBe('expired');
    const seen = new Set<string>();
    for (const { prompt, user } of h.llm.users) {
      const answer = ANSWERS[prompt as (typeof PROMPTS)[number]];
      expect(answer, prompt).toBeDefined();
      const sha = await llmContentSha256(user);
      if (seen.has(`${prompt}/${sha}`)) continue;
      seen.add(`${prompt}/${sha}`);
      const dir = `${LLM_FIXTURE_DIR}${prompt}/`;
      mkdirSync(dir, { recursive: true });
      const fixture = { prompt, request_sha256: sha, case: CASE, user, response: messageOf('claude-sonnet-5-5', answer) };
      writeFileSync(`${dir}${sha.slice(0, 16)}.json`, `${JSON.stringify(fixture, null, 2)}\n`);
    }
    expect(seen.size).toBe(PROMPTS.length);
  });
});

describe.skipIf(WRITE)('quote LLM fixtures', () => {
  it('the canonical quote runs on the fixture files alone (one call per prompt)', async () => {
    const llm = new FakeLlm();
    const { h, result } = await canonical(llm);
    expect(result.outcome).toBe('expired');
    expect(llm.calls.map((c) => c.prompt)).toEqual([...PROMPTS]);
    for (const call of llm.calls) expect(existsSync(`${LLM_FIXTURE_DIR}${call.prompt}/${call.sha256.slice(0, 16)}.json`), call.prompt).toBe(true);
    // the fixture answers reached the quote: model notes on the card, drafts on the row
    expect(h.ports.telegram.cards[0].card.lines.find((l) => l.label === 'Model notes')?.value).toBe('2 assumptions, 1 risks, 0 suggestions');
    expect(h.ports.db.rows('quote_workflows')[0].drafts).toMatchObject({ language: 'de', subject: COVER_ANSWER.subject });
  });

  it('every fixture file: hash of its content, an answer that fits its schema, and a use in the canonical quote', async () => {
    const llm = new FakeLlm();
    await canonical(llm);
    const used = new Set(llm.calls.map((c) => `${c.prompt}/${c.sha256.slice(0, 16)}.json`));
    let files = 0;
    for (const prompt of PROMPTS) {
      const dir = `${LLM_FIXTURE_DIR}${prompt}/`;
      expect(existsSync(dir), dir).toBe(true);
      const schema = schemaOf(prompt);
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        files++;
        const fixture = JSON.parse(readFileSync(dir + name, 'utf8')) as { prompt: string; request_sha256: string; user: LlmCall['user']; response: { content: Array<{ text: string }> } };
        expect(fixture.prompt).toBe(prompt);
        expect(await llmContentSha256(fixture.user)).toBe(fixture.request_sha256);
        expect(name).toBe(`${fixture.request_sha256.slice(0, 16)}.json`);
        expect(valueSchemaProblems(schema, JSON.parse(fixture.response.content[0].text)), `${prompt}/${name}`).toEqual([]);
        expect(used.has(`${prompt}/${name}`), `${prompt}/${name} is used`).toBe(true);
        // model input carries no e-mail address
        expect(JSON.stringify(fixture.user)).not.toMatch(/@example\.de/);
      }
    }
    expect(files).toBe(used.size);
  });
});
