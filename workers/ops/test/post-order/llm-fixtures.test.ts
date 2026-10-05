// The committed LLM fixtures of the post-order prompts (test/fixtures/llm/post_order.*@v1/*.json, used by the T2
// stub server and eval:synthetic) answer exactly the requests the Workflow builds for the synthetic order of
// seed-data.ts: the run below uses the plain FakeLlm (file fixtures only, no scripted answers). With
// POST_ORDER_FIXTURES=write the files are (re)written from the scripted answers of the harness.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { llmContentSha256 } from '../../src/ports/llm';
import { FakeLlm, LLM_FIXTURE_DIR } from '../helpers/agent-env';
import { harness, messageOf, NOTES_ANSWER, REORDER_ANSWER, runCase, runOf } from './harness';

const PROMPTS = ['post_order.traveller_notes@v1', 'post_order.reorder_draft@v1'] as const;
const EXPECTED: Record<string, unknown> = { 'post_order.traveller_notes@v1': NOTES_ANSWER, 'post_order.reorder_draft@v1': REORDER_ANSWER };

describe.runIf(process.env.POST_ORDER_FIXTURES === 'write')('write the post-order fixtures', () => {
  it('records the requests of the shortfall scenario with the scripted answers', async () => {
    const h = harness({ sheet: [500, 500] });
    await runCase(h, { decisions: { 'handoff-approved': ['send_partner'], 'reorder-approved': ['approve_draft'] } });
    for (const prompt of PROMPTS) {
      const call = h.llm.users.find((u) => u.prompt === prompt);
      if (!call) throw new Error(`no call of ${prompt}`);
      const sha = await llmContentSha256(call.user);
      const dir = path.join(LLM_FIXTURE_DIR, prompt);
      mkdirSync(dir, { recursive: true });
      const fixture = { prompt, request_sha256: sha, case: 'post-order-shortfall', user: call.user, response: { ...messageOf(EXPECTED[prompt]), id: 'msg_fixture' }, expected: EXPECTED[prompt] };
      writeFileSync(path.join(dir, `${sha.slice(0, 16)}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    }
  });
});

describe('post-order LLM fixtures', () => {
  it('each prompt has exactly one fixture, named by its request hash', async () => {
    for (const prompt of PROMPTS) {
      const dir = path.join(LLM_FIXTURE_DIR, prompt);
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      expect(files, prompt).toHaveLength(1);
      const f = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8')) as { prompt: string; request_sha256: string; user: Parameters<typeof llmContentSha256>[0] };
      expect(f.prompt).toBe(prompt);
      expect(files[0]).toBe(`${f.request_sha256.slice(0, 16)}.json`);
      expect(await llmContentSha256(f.user)).toBe(f.request_sha256);
    }
  });

  it('the Workflow runs on the file fixtures alone (the requests it builds match them)', async () => {
    const h = harness({ sheet: [500, 500] });
    h.ports.llm = new FakeLlm({ clock: h.ports.clock }) as unknown as typeof h.ports.llm;
    const { result } = await runCase(h, { decisions: { 'handoff-approved': ['send_partner'], 'reorder-approved': ['approve_draft'] } });
    expect(result.outcome).toBe('handed_off');
    expect(runOf(h)).toMatchObject({ status: 'succeeded', llm_calls: 2, output: { reorder: 'approved' } });
  });
});
