// C5: the Gemini model chain against the live chain of translate-article v81 (test/oracles/translate-article.v81.ts)
// on the same scripted HTTP answers: model order, same-model attempts on 500/503 with 3 s and 6 s waits, 429 and
// 404 fall through, every model overloaded -> overloaded error, other failures stop the chain.

import { describe, expect, it } from 'vitest';
import { callGemini, GEMINI_MODELS, GeminiCallError, geminiFailureUsage, GeminiOverloadedError, isGeminiOverloaded } from '../../../src/content/gemini-chain';
import { statusFailure } from '../../../src/ports/p5';
import { failText, FakeTextLlm, okText } from '../../../src/ports/p5-stub/index';
import * as oracle from '../../oracles/translate-article.v81';

type Script = Record<string, number[]>;
const META = { agent: 'content_daily.translate', run_id: 'r', tenant_id: 't', step: 'translate-de', prompt: 'content_daily.translate@v1' };

function geminiBody(text: string): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
}

/** Runs the live chain over scripted statuses; returns the models called, the waits and the outcome. */
async function live(script: Script): Promise<{ calls: string[]; waits: number[]; outcome: string }> {
  const queues: Script = structuredClone(script);
  const calls: string[] = [];
  const waits: number[] = [];
  oracle.setOracleIo({
    fetch: async (url: string) => {
      const model = /models\/([^:]+):generateContent/.exec(url)![1];
      calls.push(model);
      const status = queues[model]?.shift() ?? 503;
      return status === 200 ? new Response(geminiBody(`text from ${model}`), { status }) : new Response('{"error":{}}', { status });
    },
    setTimeout: (fn: () => void, ms: number) => {
      if (ms < 60_000) {
        waits.push(ms);
        Promise.resolve().then(fn);
      }
      return 0;
    },
    clearTimeout: () => {},
  });
  try {
    const r = await oracle.callGeminiWithFallback([{ role: 'user', parts: [{ text: 'p' }] }], 90000);
    return { calls, waits, outcome: `ok:${r.text}` };
  } catch (e) {
    return { calls, waits, outcome: e instanceof oracle.GeminiOverloadedError ? 'overloaded' : 'error' };
  }
}

async function port(script: Script, o: { emptyOn?: string; timeoutOn?: string } = {}): Promise<{ calls: string[]; waits: number[]; outcome: string }> {
  const queues: Script = structuredClone(script);
  const llm = new FakeTextLlm({
    script: (call) => {
      if (call.model === o.timeoutOn) return failText('timeout', { status: null });
      const status = queues[call.model]?.shift() ?? 503;
      if (status === 200) return call.model === o.emptyOn ? failText('empty', { status: 200 }) : okText(`text from ${call.model}`, { model: call.model, stop: 'STOP' });
      return statusFailure('gemini', status);
    },
  });
  const waits: number[] = [];
  try {
    const r = await callGemini(llm, 'p', { meta: META, sleep: async (ms) => void waits.push(ms) });
    expect(llm.calls.every((c) => c.temperature === 0.3 && c.maxTokens === 8192 && c.timeoutMs === 90_000 && c.meta.prompt === META.prompt)).toBe(true);
    return { calls: llm.calls.map((c) => c.model), waits, outcome: `ok:${r.text}` };
  } catch (e) {
    if (e instanceof GeminiOverloadedError) expect(isGeminiOverloaded(e)).toBe(true);
    else expect(e).toBeInstanceOf(GeminiCallError);
    return { calls: llm.calls.map((c) => c.model), waits, outcome: e instanceof GeminiOverloadedError ? 'overloaded' : 'error' };
  }
}

describe('Gemini chain against the live chain', () => {
  it('model order is the live order', () => {
    expect(GEMINI_MODELS).toEqual(oracle.GEMINI_MODELS.map((m: { model: string }) => m.model));
    expect(oracle.GEMINI_MODELS.every((m: { apiVersion: string }) => m.apiVersion === 'v1beta')).toBe(true);
  });

  const cases: Array<[string, Script]> = [
    ['429 -> next model at once', { 'gemini-2.5-flash-lite': [429], 'gemini-2.5-flash': [200] }],
    ['404 -> next model at once', { 'gemini-2.5-flash-lite': [404], 'gemini-2.5-flash': [404], 'gemini-2.0-flash': [200] }],
    ['503 three times -> next model after 3 s and 6 s', { 'gemini-2.5-flash-lite': [503, 503, 503], 'gemini-2.5-flash': [200] }],
    ['500 once then success on the same model', { 'gemini-2.5-flash-lite': [500, 200] }],
    ['mixed 429, 503 x3, 404, success on the 4th model', { 'gemini-2.5-flash-lite': [429], 'gemini-2.5-flash': [503, 500, 503], 'gemini-2.0-flash': [404], 'gemini-2.0-flash-lite': [200] }],
    ['every model 5xx -> overloaded', {}],
    ['every model 429 -> overloaded', Object.fromEntries(GEMINI_MODELS.map((m) => [m, [429]]))],
    ['400 stops the chain', { 'gemini-2.5-flash-lite': [400] }],
  ];
  for (const [name, script] of cases) {
    it(name, async () => {
      const a = await live(script);
      const b = await port(script);
      expect(b).toEqual(a);
    });
  }

  it('all 5xx: 15 calls, 10 waits, overloaded', async () => {
    const r = await port({});
    expect(r.outcome).toBe('overloaded');
    expect(r.calls.length).toBe(15);
    expect(r.waits).toEqual([3000, 6000, 3000, 6000, 3000, 6000, 3000, 6000, 3000, 6000]);
  });

  it('an empty answer stops the chain (live: Empty Gemini response, no fallback)', async () => {
    const r = await port({ 'gemini-2.5-flash-lite': [200] }, { emptyOn: 'gemini-2.5-flash-lite' });
    expect(r).toEqual({ calls: ['gemini-2.5-flash-lite'], waits: [], outcome: 'error' });
  });

  it('a timeout falls through to the next model (live: an aborted request counts as overload)', async () => {
    const r = await port({ 'gemini-2.5-flash': [200] }, { timeoutOn: 'gemini-2.5-flash-lite' });
    expect(r).toEqual({ calls: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'], waits: [], outcome: 'ok:text from gemini-2.5-flash' });
  });

  it('deliberate difference: 502/504 fall through to the next model (live stops the chain)', async () => {
    const script = { 'gemini-2.5-flash-lite': [502], 'gemini-2.5-flash': [200] };
    expect((await live(script)).outcome).toBe('error');
    expect(await port(script)).toEqual({ calls: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'], waits: [], outcome: 'ok:text from gemini-2.5-flash' });
  });

  it('an answered call that fails keeps its billed usage on the GeminiCallError; unanswered failures carry none', async () => {
    const usage = { input_tokens: 800, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0.0001, model: 'gemini-2.5-flash-lite' };
    const failOnce = async (r: ReturnType<typeof failText>) => {
      const llm = new FakeTextLlm({ script: () => r });
      try {
        await callGemini(llm, 'p', { meta: META, sleep: async () => {} });
      } catch (e) {
        return e;
      }
      throw new Error('expected a failure');
    };
    for (const code of ['blocked', 'empty', 'other'] as const) {
      const e = await failOnce(failText(code, { status: 200, usage }));
      expect(e).toBeInstanceOf(GeminiCallError);
      expect((e as GeminiCallError).usage).toEqual([usage]);
      expect(geminiFailureUsage(e)).toEqual([usage]);
    }
    // a 200 that the port reports as ok but without text is billed too
    const llmEmpty = new FakeTextLlm({ script: (c) => okText('', { model: c.model, usage }) });
    const empty = await callGemini(llmEmpty, 'p', { meta: META, sleep: async () => {} }).catch((e: unknown) => e);
    expect(geminiFailureUsage(empty)).toEqual([expect.objectContaining({ input_tokens: 800, output_tokens: 20 })]);
    // a 4xx without an answer, and the overloaded chain, carry no usage
    expect(geminiFailureUsage(await failOnce(failText('other', { status: 400 })))).toEqual([]);
    expect(geminiFailureUsage(await failOnce(failText('server', { status: 503 })))).toEqual([]);
    expect(geminiFailureUsage(new Error('x'))).toEqual([]);
  });
});
