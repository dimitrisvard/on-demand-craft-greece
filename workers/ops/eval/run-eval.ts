// Offline evaluation of the agent prompts (run with vitest: npm run eval:synthetic / eval:live).
//
// Modes
//   replay (default)  every fixture (eval/samples, test/fixtures/llm, and the folders in EVAL_DIRS) is replayed
//                     through the production LLM adapter (src/ports/llm.ts) with a fetch that answers the recorded
//                     response: parsing, stop reasons, schema checks and pricing run the real code; no network.
//   live (owner)      EVAL_MODE=live: each request of the golden set (EVAL_GOLDEN_DIR, JSON files {prompt, user,
//                     expected}, kept outside git) goes to the real gateway (EVAL_GATEWAY_BASE_URL and
//                     AI_GATEWAY_TOKEN from the environment); each response is written as a fixture under
//                     eval/recordings/<date>/ (git-ignored), so the same run can be replayed later for $0.
//
// Metrics per prompt: cases, ok, failures by code, field accuracy against `expected` (a {value, confidence} field
// is compared by value; strings case-insensitively after trimming), high-confidence errors (wrong fields whose
// confidence is at least 0.7: the calibration of the auto-accept threshold), tokens and cost.
// Gate: a prompt or model change ships only when no prompt's field accuracy or ok rate drops by more than 2 points
// against the baseline report of the current version (regressions()).

import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPTS, parseFrontMatter, type PromptId } from '../src/agents/prompts/registry';
import type { OpsEnv } from '../src/env';
import type { JsonSchemaObject, LlmContent, LlmFailure, LlmResult, LlmUsage } from '../src/ports/index';
import { AnthropicLlm, llmContentSha256, valueSchemaProblems } from '../src/ports/llm';

export const OPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SAMPLES_DIR = path.join(OPS_DIR, 'eval', 'samples');
export const LLM_FIXTURES_DIR = path.join(OPS_DIR, 'test', 'fixtures', 'llm');
export const PROMPTS_DIR = path.join(OPS_DIR, 'src', 'agents', 'prompts');
export const RECORDINGS_DIR = path.join(OPS_DIR, 'eval', 'recordings');
export const HIGH_CONFIDENCE = 0.7;

export interface EvalFixture {
  prompt: string;
  request_sha256: string;
  case?: string;
  status?: number;
  user?: LlmContent[];
  response: Record<string, unknown>;
  expected?: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

export interface EvalCase {
  file: string;
  fixture: EvalFixture;
}

export interface CaseResult {
  file: string;
  prompt: string;
  ok: boolean;
  code?: LlmFailure['code'];
  fieldsCompared: number;
  fieldsCorrect: number;
  highConfidenceErrors: number;
  usage?: LlmUsage;
}

export interface PromptMetrics {
  cases: number;
  ok: number;
  failures: Record<string, number>;
  fields_compared: number;
  fields_correct: number;
  field_accuracy: number | null;
  ok_rate: number;
  high_confidence_errors: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

const FIXTURE_SCHEMA = JSON.parse(readFileSync(path.join(OPS_DIR, 'eval', 'fixtures.schema.json'), 'utf8')) as Record<string, unknown>;

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsonFiles(full));
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** Problems of one fixture: its shape (fixtures.schema.json), the hash format and, when the user content is given,
 *  that the hash is the hash of that content. */
export async function fixtureProblems(f: unknown): Promise<string[]> {
  const problems = valueSchemaProblems(FIXTURE_SCHEMA, f);
  if (problems.length) return problems;
  const fixture = f as EvalFixture;
  if (!/^[0-9a-f]{64}$/.test(fixture.request_sha256)) return ['request_sha256 is not 64 lower-case hex'];
  if (fixture.user && (await llmContentSha256(fixture.user)) !== fixture.request_sha256) return ['request_sha256 is not the hash of user'];
  return [];
}

/** Every fixture of the given folders, with the problems of the malformed ones. */
export async function loadCases(dirs: readonly string[]): Promise<{ cases: EvalCase[]; problems: string[] }> {
  const cases: EvalCase[] = [];
  const problems: string[] = [];
  for (const dir of dirs) {
    for (const file of jsonFiles(dir)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        problems.push(`${path.relative(OPS_DIR, file)}: not JSON`);
        continue;
      }
      const p = await fixtureProblems(parsed);
      if (p.length) problems.push(`${path.relative(OPS_DIR, file)}: ${p.join('; ')}`);
      else cases.push({ file: path.relative(OPS_DIR, file), fixture: parsed as EvalFixture });
    }
  }
  return { cases, problems };
}

const PERMISSIVE: JsonSchemaObject = { type: 'object', properties: {}, required: [], additionalProperties: false };

/** System text and output schema of a prompt (its files when present, else the fixture's own schema). */
export function promptMaterial(prompt: string, fixtureSchema?: Record<string, unknown>): { system: string; schema: JsonSchemaObject; route: 'extract' | 'classify'; maxTokens: number } {
  const entry = PROMPTS[prompt as PromptId];
  const route = entry?.route ?? 'classify';
  const maxTokens = entry?.max_tokens ?? 1024;
  let schema: Record<string, unknown> | undefined = fixtureSchema;
  let system = 'eval';
  if (entry) {
    const schemaFile = path.join(PROMPTS_DIR, entry.schema);
    const textFile = path.join(PROMPTS_DIR, entry.file);
    if (existsSync(schemaFile)) schema = JSON.parse(readFileSync(schemaFile, 'utf8')) as Record<string, unknown>;
    if (existsSync(textFile)) system = parseFrontMatter(readFileSync(textFile, 'utf8')).body;
  }
  // Without any schema the output is only required to be a JSON object.
  const effective = schema ?? { ...PERMISSIVE, additionalProperties: true };
  return { system, schema: effective as unknown as JsonSchemaObject, route, maxTokens };
}

function normalised(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as Record<string, unknown>)) return normalised((v as Record<string, unknown>).value);
  if (typeof v === 'string') return v.trim().toLowerCase();
  return v;
}

function confidenceOf(v: unknown): number | null {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).confidence === 'number') return (v as { confidence: number }).confidence;
  return null;
}

/** Field accuracy of one output against its expected fields (top-level keys of `expected`). */
export function score(value: unknown, expected: Record<string, unknown> | undefined, topConfidence: number | null): { compared: number; correct: number; highConfidenceErrors: number } {
  if (!expected || typeof value !== 'object' || value === null) return { compared: 0, correct: 0, highConfidenceErrors: 0 };
  const out = value as Record<string, unknown>;
  let compared = 0;
  let correct = 0;
  let highConfidenceErrors = 0;
  for (const [key, want] of Object.entries(expected)) {
    compared++;
    const got = out[key];
    if (JSON.stringify(normalised(got)) === JSON.stringify(normalised(want))) {
      correct++;
      continue;
    }
    const confidence = confidenceOf(got) ?? topConfidence;
    if (confidence !== null && confidence >= HIGH_CONFIDENCE) highConfidenceErrors++;
  }
  return { compared, correct, highConfidenceErrors };
}

/** Replays one fixture through the production adapter (fetch answers the recorded response; nothing else). */
export async function replayCase(c: EvalCase): Promise<CaseResult> {
  const f = c.fixture;
  const material = promptMaterial(f.prompt, f.schema);
  const fetchImpl = (async () =>
    new Response(JSON.stringify(f.response), { status: f.status ?? 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const env = { AGENT_STUBS: 'llm', AGENT_LLM_BASE_URL: 'https://eval.replay.invalid/anthropic', AI_GATEWAY_TOKEN: 'eval-replay' } as OpsEnv;
  const result = await new AnthropicLlm(env, { fetch: fetchImpl }).call({
    prompt: f.prompt as PromptId,
    route: material.route,
    system: material.system,
    user: f.user ?? [{ type: 'text', text: '' }],
    schema: material.schema,
    maxTokens: material.maxTokens,
    meta: { agent: 'eval', run_id: 'eval', tenant_id: 'eval', step: f.prompt },
  });
  return resultOf(c.file, f, result);
}

function resultOf(file: string, f: { prompt: string; expected?: Record<string, unknown> }, result: LlmResult<unknown> | LlmFailure): CaseResult {
  if (!result.ok) return { file, prompt: f.prompt, ok: false, code: result.code, fieldsCompared: 0, fieldsCorrect: 0, highConfidenceErrors: 0, usage: result.usage };
  const top = typeof (result.value as Record<string, unknown>)?.confidence === 'number' ? ((result.value as Record<string, unknown>).confidence as number) : null;
  const s = score(result.value, f.expected, top);
  return { file, prompt: f.prompt, ok: true, fieldsCompared: s.compared, fieldsCorrect: s.correct, highConfidenceErrors: s.highConfidenceErrors, usage: result.usage };
}

/** Metrics per prompt and in total ('*'). */
export function summarize(results: readonly CaseResult[]): Record<string, PromptMetrics> {
  const out: Record<string, PromptMetrics> = {};
  const add = (key: string, r: CaseResult) => {
    const m = (out[key] ??= { cases: 0, ok: 0, failures: {}, fields_compared: 0, fields_correct: 0, field_accuracy: null, ok_rate: 0, high_confidence_errors: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 });
    m.cases++;
    if (r.ok) m.ok++;
    else m.failures[r.code ?? 'error'] = (m.failures[r.code ?? 'error'] ?? 0) + 1;
    m.fields_compared += r.fieldsCompared;
    m.fields_correct += r.fieldsCorrect;
    m.high_confidence_errors += r.highConfidenceErrors;
    m.input_tokens += r.usage?.input_tokens ?? 0;
    m.output_tokens += r.usage?.output_tokens ?? 0;
    m.cost_usd += r.usage?.cost_usd ?? 0;
  };
  for (const r of results) {
    add(r.prompt, r);
    add('*', r);
  }
  for (const m of Object.values(out)) {
    m.ok_rate = m.cases ? (100 * m.ok) / m.cases : 0;
    m.field_accuracy = m.fields_compared ? (100 * m.fields_correct) / m.fields_compared : null;
  }
  return out;
}

/** Prompts whose ok rate or field accuracy dropped by more than maxDrop points against the baseline. */
export function regressions(current: Record<string, PromptMetrics>, baseline: Record<string, PromptMetrics>, maxDrop = 2): string[] {
  const out: string[] = [];
  for (const [prompt, base] of Object.entries(baseline)) {
    const now = current[prompt];
    if (!now) continue;
    if (base.ok_rate - now.ok_rate > maxDrop) out.push(`${prompt}: ok rate ${base.ok_rate.toFixed(1)} -> ${now.ok_rate.toFixed(1)}`);
    if (base.field_accuracy !== null && now.field_accuracy !== null && base.field_accuracy - now.field_accuracy > maxDrop) {
      out.push(`${prompt}: field accuracy ${base.field_accuracy.toFixed(1)} -> ${now.field_accuracy.toFixed(1)}`);
    }
  }
  return out;
}

/** The printed report (numbers only: no e-mail text, no model output). */
export function formatReport(metrics: Record<string, PromptMetrics>): string {
  const lines = ['prompt | cases | ok % | field acc % | high-conf errors | failures | in tok | out tok | USD'];
  for (const [prompt, m] of Object.entries(metrics).sort(([a], [b]) => (a === '*' ? 1 : b === '*' ? -1 : a.localeCompare(b)))) {
    const failures = Object.entries(m.failures).map(([k, v]) => `${k}:${v}`).join(',') || '-';
    lines.push(`${prompt} | ${m.cases} | ${m.ok_rate.toFixed(1)} | ${m.field_accuracy === null ? '-' : m.field_accuracy.toFixed(1)} | ${m.high_confidence_errors} | ${failures} | ${m.input_tokens} | ${m.output_tokens} | ${m.cost_usd.toFixed(6)}`);
  }
  return lines.join('\n');
}

// ----- live mode (owner only) -----

export interface GoldenRequest {
  prompt: string;
  user: LlmContent[];
  expected?: Record<string, unknown>;
  case?: string;
}

export interface LiveConfig {
  goldenDir: string;
  gatewayBaseUrl: string;
  gatewayToken: string;
  recordingsDir: string;
}

/** The live configuration from the environment, or the reason live mode cannot run. */
export function liveConfig(env: Record<string, string | undefined>): LiveConfig | { missing: string[] } {
  const missing = ['EVAL_GOLDEN_DIR', 'EVAL_GATEWAY_BASE_URL', 'AI_GATEWAY_TOKEN'].filter((n) => !env[n]);
  if (missing.length) return { missing };
  return {
    goldenDir: env.EVAL_GOLDEN_DIR as string,
    gatewayBaseUrl: env.EVAL_GATEWAY_BASE_URL as string,
    gatewayToken: env.AI_GATEWAY_TOKEN as string,
    recordingsDir: path.join(RECORDINGS_DIR, new Date().toISOString().slice(0, 10)),
  };
}

/** Runs the golden requests against the gateway and records every response as a replayable fixture. */
export async function runLive(cfg: LiveConfig, fetchImpl: typeof fetch = (i, init) => fetch(i, init)): Promise<CaseResult[]> {
  const ai = { gateway: () => ({ getUrl: async () => cfg.gatewayBaseUrl }) } as unknown as Ai;
  const env = { AI: ai, AI_GATEWAY_ID: 'microns', AI_GATEWAY_TOKEN: cfg.gatewayToken } as OpsEnv;
  const results: CaseResult[] = [];
  for (const file of jsonFiles(cfg.goldenDir)) {
    const g = JSON.parse(readFileSync(file, 'utf8')) as GoldenRequest;
    const material = promptMaterial(g.prompt);
    let recorded: Record<string, unknown> | null = null;
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetchImpl(input, init);
      recorded = (await res.clone().json()) as Record<string, unknown>;
      return res;
    }) as typeof fetch;
    const result = await new AnthropicLlm(env, { fetch: recording }).call({
      prompt: g.prompt as PromptId,
      route: material.route,
      system: material.system,
      user: g.user,
      schema: material.schema,
      maxTokens: material.maxTokens,
      meta: { agent: 'eval', run_id: 'eval-live', tenant_id: 'eval', step: g.prompt },
    });
    if (recorded) {
      const sha = await llmContentSha256(g.user);
      const dir = path.join(cfg.recordingsDir, g.prompt);
      mkdirSync(dir, { recursive: true });
      const fixture: EvalFixture = { prompt: g.prompt, request_sha256: sha, case: g.case ?? path.basename(file), user: g.user, response: recorded, ...(g.expected ? { expected: g.expected } : {}) };
      writeFileSync(path.join(dir, `${sha.slice(0, 16)}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    }
    results.push(resultOf(path.basename(file), g, result));
  }
  return results;
}
