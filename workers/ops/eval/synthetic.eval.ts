// Offline evaluation (eval/run-eval.ts). Default: replay of the public synthetic fixtures (eval/samples,
// test/fixtures/llm and the folders listed in EVAL_DIRS) with global fetch replaced by a function that throws, so
// the run can never reach a network. EVAL_MODE=live (owner only, see eval/README.md): the golden set against the
// real gateway, responses recorded under eval/recordings/ (git-ignored).
// The run fails on a malformed fixture, on any network attempt in replay mode, and on a regression of more than
// 2 points against EVAL_BASELINE (a report JSON written by an earlier run) when one is given.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LLM_FIXTURES_DIR, OPS_DIR, SAMPLES_DIR, formatReport, liveConfig, loadCases, regressions, replayCase, runLive, summarize, type PromptMetrics } from './run-eval';

const live = process.env.EVAL_MODE === 'live';
const extraDirs = (process.env.EVAL_DIRS ?? '').split(',').map((d) => d.trim()).filter(Boolean).map((d) => path.resolve(OPS_DIR, d));

function writeReport(metrics: Record<string, PromptMetrics>): void {
  const out = process.env.EVAL_REPORT;
  if (!out) return;
  const file = path.resolve(OPS_DIR, out);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(metrics, null, 2)}\n`);
}

function checkBaseline(metrics: Record<string, PromptMetrics>): string[] {
  const baseline = process.env.EVAL_BASELINE;
  if (!baseline || !existsSync(path.resolve(OPS_DIR, baseline))) return [];
  return regressions(metrics, JSON.parse(readFileSync(path.resolve(OPS_DIR, baseline), 'utf8')) as Record<string, PromptMetrics>);
}

describe.skipIf(live)('eval:synthetic (replay, no network)', () => {
  const realFetch = globalThis.fetch;
  let networkAttempts = 0;

  beforeAll(() => {
    globalThis.fetch = (() => {
      networkAttempts++;
      throw new Error('eval:synthetic never uses the network');
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('replays every fixture through the production adapter and prints the metrics', async () => {
    const { cases, problems } = await loadCases([SAMPLES_DIR, LLM_FIXTURES_DIR, ...extraDirs]);
    expect(problems, 'malformed fixtures').toEqual([]);
    expect(cases.length).toBeGreaterThan(0);
    const results = [];
    for (const c of cases) results.push(await replayCase(c));
    const metrics = summarize(results);
    console.log(`eval:synthetic ${cases.length} cases\n${formatReport(metrics)}`);
    writeReport(metrics);
    expect(networkAttempts).toBe(0);
    expect(checkBaseline(metrics)).toEqual([]);
    // The bundled samples exercise every outcome the report distinguishes.
    const samples = metrics['eval.sample@v1'];
    expect(samples).toMatchObject({ cases: 4, ok: 3, failures: { max_tokens: 1 }, fields_compared: 9, fields_correct: 7, high_confidence_errors: 2 });
  });
});

describe.skipIf(!live)('eval:live (owner only)', () => {
  it('runs the golden set against the gateway and records the responses', async () => {
    const cfg = liveConfig(process.env);
    if ('missing' in cfg) throw new Error(`eval:live needs ${cfg.missing.join(', ')} (see eval/README.md)`);
    const results = await runLive(cfg);
    const metrics = summarize(results);
    console.log(`eval:live ${results.length} cases (recordings: ${path.relative(OPS_DIR, cfg.recordingsDir)})\n${formatReport(metrics)}`);
    writeReport(metrics);
    expect(checkBaseline(metrics)).toEqual([]);
  });
});
