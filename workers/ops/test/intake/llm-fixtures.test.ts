// LLM fixtures of the intake prompts (test/fixtures/llm/rfq_intake.*): one per (case, prompt), keyed by the SHA-256
// of the user content the Workflow builds for the case. With INTAKE_FIXTURES_WRITE=1 the files are (re)written from
// the answers of test/intake/cases.ts; without it the test checks that every case still finds its fixtures (a
// change of the prompt input changes the hash and fails here), that each file's hash is the hash of its stored
// content, that each answer satisfies its prompt's schema, and that no fixture is left without a case.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LlmCall, LlmFailure, LlmPort, LlmResult } from '../../src/ports/index';
import { llmContentSha256, valueSchemaProblems } from '../../src/ports/llm';
import { FakeLlm, LLM_FIXTURE_DIR } from '../helpers/agent-env';
import { CASES, caseResponse, harness, runCase, seedMail, type IntakeCase } from './cases';

const WRITE = process.env.INTAKE_FIXTURES_WRITE === '1';
const PROMPTS = ['rfq_intake.triage@v1', 'rfq_intake.extract@v1', 'rfq_intake.classify_process@v1'] as const;
const SCHEMA_DIR = new URL('../../src/agents/prompts/rfq_intake/', import.meta.url).pathname;

function expectedOf(c: IntakeCase, prompt: string): Record<string, unknown> | undefined {
  if (prompt === 'rfq_intake.triage@v1' && c.triage) return { kind: c.triage.kind, language: c.triage.language, injection_suspected: c.triage.injection_suspected };
  if (prompt === 'rfq_intake.classify_process@v1' && c.classify) return { process: c.classify.process };
  if (prompt === 'rfq_intake.extract@v1' && c.extract) return { company: c.extract.company.value, country: c.extract.country.value, deadline: c.extract.deadline.value };
  return undefined;
}

/** Answers every call from the case table and writes the fixture file of each call. */
class WritingLlm implements LlmPort {
  readonly inner = new FakeLlm();
  readonly written: string[] = [];
  constructor(private readonly c: IntakeCase) {}

  async call<T>(call: LlmCall<T>): Promise<LlmResult<T> | LlmFailure> {
    const response = caseResponse(this.c, call.prompt);
    if (!response) return { ok: false, code: 'schema', retryable: false, message: `no answer for ${call.prompt}` };
    const sha = await llmContentSha256(call.user);
    const dir = `${LLM_FIXTURE_DIR}${call.prompt}/`;
    mkdirSync(dir, { recursive: true });
    const fixture: Record<string, unknown> = { prompt: call.prompt, request_sha256: sha, case: this.c.file.replace(/\.eml$/, ''), user: call.user, response };
    const expected = expectedOf(this.c, call.prompt);
    if (expected) fixture.expected = expected;
    writeFileSync(`${dir}${sha.slice(0, 16)}.json`, `${JSON.stringify(fixture, null, 2)}\n`);
    this.written.push(`${call.prompt}/${sha.slice(0, 16)}`);
    await this.inner.add(call.prompt, call.user, response);
    return this.inner.call(call);
  }
}

const LLM_CASES = CASES.filter((c) => c.triage || c.extract || c.classify);

describe.skipIf(!WRITE)('write the intake LLM fixtures (INTAKE_FIXTURES_WRITE=1)', () => {
  it.each(LLM_CASES.map((c) => [c.file, c] as const))('%s', async (_file, c) => {
    const h = harness({ quoteFlag: true });
    const llm = new WritingLlm(c);
    h.ports.llm = llm as unknown as FakeLlm;
    const mail = await seedMail(h, c.file);
    const { result } = await runCase(h, mail, { verb: c.verb });
    expect(result.outcome).toBe(c.outcome);
    expect(llm.written.length).toBeGreaterThan(0);
  });
});

describe.skipIf(WRITE)('intake LLM fixtures', () => {
  it.each(LLM_CASES.map((c) => [c.file, c] as const))('%s finds a fixture for every model call', async (_file, c) => {
    const h = harness({ quoteFlag: true });
    const mail = await seedMail(h, c.file);
    const { result } = await runCase(h, mail, { verb: c.verb });
    const calls = h.ports.llm.calls;
    expect(calls.map((x) => x.prompt).filter((p) => p === 'rfq_intake.triage@v1')).toHaveLength(c.triage ? 1 : 0);
    expect(calls.map((x) => x.prompt).filter((p) => p === 'rfq_intake.extract@v1')).toHaveLength(c.extract ? 1 : 0);
    expect(calls.map((x) => x.prompt).filter((p) => p === 'rfq_intake.classify_process@v1')).toHaveLength(c.classify ? 1 : 0);
    for (const call of calls) expect(existsSync(`${LLM_FIXTURE_DIR}${call.prompt}/${call.sha256.slice(0, 16)}.json`), `${c.file} ${call.prompt}`).toBe(true);
    expect(result.outcome).toBe(c.outcome);
  });

  it('every fixture file: hash of its content, an answer that fits its schema, and a case that uses it', async () => {
    const used = new Set<string>();
    for (const c of LLM_CASES) {
      const h = harness({ quoteFlag: true });
      const mail = await seedMail(h, c.file);
      await runCase(h, mail, { verb: c.verb });
      for (const call of h.ports.llm.calls) used.add(`${call.prompt}/${call.sha256.slice(0, 16)}.json`);
    }
    let files = 0;
    for (const prompt of PROMPTS) {
      const dir = `${LLM_FIXTURE_DIR}${prompt}/`;
      expect(existsSync(dir), dir).toBe(true);
      const schema = JSON.parse(readFileSync(`${SCHEMA_DIR}${prompt.split('.')[1].split('@')[0]}.v1.schema.json`, 'utf8'));
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        files++;
        const fixture = JSON.parse(readFileSync(dir + name, 'utf8')) as { prompt: string; request_sha256: string; user: LlmCall['user']; response: { content: Array<{ text: string }> } };
        expect(fixture.prompt).toBe(prompt);
        expect(await llmContentSha256(fixture.user)).toBe(fixture.request_sha256);
        expect(name).toBe(`${fixture.request_sha256.slice(0, 16)}.json`);
        expect(valueSchemaProblems(schema, JSON.parse(fixture.response.content[0].text)), `${prompt}/${name}`).toEqual([]);
        expect(used.has(`${prompt}/${name}`), `${prompt}/${name} is used by a case`).toBe(true);
      }
    }
    expect(files).toBe(used.size);
  });
});
