// LlmPort over the Anthropic SDK and the AI Gateway (src/agents/gateway.ts): structured output with
// messages.parse + jsonSchemaOutputFormat; one Analytics Engine point per provider call.
//
// Rules
//   - extract: Sonnet through the beta namespace with server-side refusal fallback ('default'), effort from the
//     prompt registry, one cache_control breakpoint on the system block. classify: Haiku, no effort, no cache marker.
//     No `thinking` field on either.
//   - stop_reason 'refusal' -> failure 'refusal' (not retryable). 'max_tokens' -> one more call with max_tokens x 2
//     (at most 8,192), then failure 'max_tokens' (not retryable). Output that is not JSON or does not match the
//     schema -> one re-ask (the same request again), then failure 'schema' (not retryable).
//   - Provider errors: 429 -> 'budget' (the run parks); 408 and client timeouts -> 'timeout' (retryable); 5xx and
//     network errors -> 'provider_5xx' (retryable); other 4xx -> 'provider_4xx' (not retryable). A missing
//     configuration name is thrown as ConfigMissingError.
//   - Usage of every call that returned one is summed into the result (also on a failure), priced with
//     src/agents/prices.ts (the answering model's row, else the route model's row).
//   - Nothing of the request or response body is logged.

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { anthropicFor, LLM_ROUTES, type AnthropicForOptions } from '../agents/gateway';
import { canonicalJson, sha256hex } from '../agents/ids';
import { llmCostUsd } from '../agents/prices';
import { PROMPTS } from '../agents/prompts/registry';
import type { OpsEnv } from '../env';
import type { ClockPort, EventsPort, JsonSchemaObject, LlmCall, LlmContent, LlmFailure, LlmPort, LlmResult, LlmUsage } from './index';

export const MAX_TOKENS_CAP = 8192;

/** Canonical form of the user content: the key of LLM fixtures (T1 and the T2 stub compute the same hash). */
export function llmContentKey(user: readonly LlmContent[]): string {
  return canonicalJson(
    user.map((c) =>
      c.type === 'text' ? { type: 'text', text: c.text } : c.type === 'pdf' ? { type: 'pdf', base64: c.base64 } : { type: 'image', mediaType: c.mediaType, base64: c.base64 },
    ),
  );
}

/** SHA-256 hex of the canonical user content. */
export async function llmContentSha256(user: readonly LlmContent[]): Promise<string> {
  return sha256hex(llmContentKey(user));
}

/** Messages API content blocks of the user turn. */
export function toAnthropicContent(user: readonly LlmContent[]): Anthropic.ContentBlockParam[] {
  return user.map((c): Anthropic.ContentBlockParam => {
    if (c.type === 'text') return { type: 'text', text: c.text };
    if (c.type === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: c.base64 } };
    return { type: 'image', source: { type: 'base64', media_type: c.mediaType, data: c.base64 } };
  });
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/** Problems of a value against the schema subset used by the prompts (type, enum, const, properties, required,
 *  additionalProperties false, items, anyOf); empty = valid. */
export function valueSchemaProblems(schema: unknown, value: unknown, path = '$'): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf)) {
    return s.anyOf.some((alt) => valueSchemaProblems(alt, value, path).length === 0) ? [] : [`${path}: matches no anyOf alternative`];
  }
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => typeMatches(t, value))) return [`${path}: expected ${types.join('|')}`];
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => e === value)) return [`${path}: not in enum`];
  if ('const' in s && s.const !== value) return [`${path}: not the const value`];
  const problems: string[] = [];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = (s.properties ?? {}) as Record<string, unknown>;
    for (const key of Array.isArray(s.required) ? (s.required as string[]) : []) if (!(key in obj)) problems.push(`${path}.${key}: missing`);
    for (const [key, v] of Object.entries(obj)) {
      if (key in properties) problems.push(...valueSchemaProblems(properties[key], v, `${path}.${key}`));
      else if (s.additionalProperties === false) problems.push(`${path}.${key}: not allowed`);
    }
  }
  if (Array.isArray(value) && s.items !== undefined) value.forEach((item, i) => problems.push(...valueSchemaProblems(s.items, item, `${path}[${i}]`)));
  return problems;
}

type ParsedText = { ok: true; value: unknown } | { ok: false };

/** jsonSchemaOutputFormat with a parse that never throws, so usage is kept when the text is not JSON. */
function outputFormat(schema: JsonSchemaObject) {
  const base = jsonSchemaOutputFormat(schema as unknown as Parameters<typeof jsonSchemaOutputFormat>[0]);
  return {
    ...base,
    parse: (text: string): ParsedText => {
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch {
        return { ok: false };
      }
    },
  };
}

function addUsage(total: LlmUsage | undefined, u: LlmUsage): LlmUsage {
  if (!total) return u;
  return {
    input_tokens: total.input_tokens + u.input_tokens,
    output_tokens: total.output_tokens + u.output_tokens,
    cache_read_input_tokens: total.cache_read_input_tokens + u.cache_read_input_tokens,
    cache_creation_input_tokens: total.cache_creation_input_tokens + u.cache_creation_input_tokens,
    cost_usd: total.cost_usd + u.cost_usd,
    model: u.model,
  };
}

function n(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
}

/** LlmUsage of a response's usage object, priced by the answering model (else the route model). */
export function usageOf(raw: unknown, answeringModel: string, routeModel: string): LlmUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const counts = {
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_read_input_tokens: n(u.cache_read_input_tokens),
    cache_creation_input_tokens: n(u.cache_creation_input_tokens),
  };
  const cost = llmCostUsd(answeringModel, counts) ?? llmCostUsd(routeModel, counts) ?? 0;
  return { ...counts, cost_usd: cost, model: answeringModel };
}

/** LlmFailure of a thrown provider error, or null when the error is not a provider error (rethrown). */
export function failureOf(e: unknown): Omit<LlmFailure, 'usage'> | null {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, code: 'timeout', retryable: true, message: 'client timeout' };
  if (e instanceof Anthropic.APIUserAbortError) return { ok: false, code: 'timeout', retryable: true, message: 'aborted' };
  if (e instanceof Anthropic.APIConnectionError) return { ok: false, code: 'provider_5xx', retryable: true, message: 'connection error' };
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === 'number' ? e.status : 0;
    if (status === 429) return { ok: false, code: 'budget', retryable: false, message: 'rate or spend limit (429)' };
    if (status === 408) return { ok: false, code: 'timeout', retryable: true, message: 'provider timeout (408)' };
    if (status >= 500) return { ok: false, code: 'provider_5xx', retryable: true, message: `provider error (${status})` };
    if (status >= 400) return { ok: false, code: 'provider_4xx', retryable: false, message: `provider refused the request (${status})` };
    return { ok: false, code: 'provider_5xx', retryable: true, message: 'provider error' };
  }
  return null;
}

export interface AnthropicLlmOptions extends AnthropicForOptions {
  events?: EventsPort;
  clock?: ClockPort;
}

interface ParsedResponse {
  model?: string;
  stop_reason?: string | null;
  usage?: unknown;
  parsed_output?: ParsedText | null;
}

export class AnthropicLlm implements LlmPort {
  constructor(
    private readonly env: OpsEnv,
    private readonly o: AnthropicLlmOptions = {},
  ) {}

  private now(): number {
    return this.o.clock ? this.o.clock.now().getTime() : Date.now();
  }

  private async send(c: LlmCall<unknown>, maxTokens: number): Promise<{ data: ParsedResponse; logId?: string }> {
    const route = LLM_ROUTES[c.route];
    const entry = PROMPTS[c.prompt];
    // The gateway's log id is read from the response headers through a wrapping fetch (parse() returns the
    // parsed message only).
    const capture: { logId?: string } = {};
    const base = this.o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const capturing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await base(input, init);
      capture.logId = response.headers.get('cf-aig-log-id') ?? undefined;
      return response;
    }) as typeof fetch;
    const client = await anthropicFor(this.env, { ...c.meta, prompt: c.prompt }, { fetch: capturing });
    const system: Anthropic.TextBlockParam[] = [
      c.route === 'extract' ? { type: 'text', text: c.system, cache_control: { type: 'ephemeral' } } : { type: 'text', text: c.system },
    ];
    const output_config: Record<string, unknown> = { format: outputFormat(c.schema) };
    if (c.route === 'extract' && entry?.effort) output_config.effort = entry.effort;
    const params = {
      model: route.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user' as const, content: toAnthropicContent(c.user) }],
      output_config,
    };
    const data = (
      route.betas.length > 0
        ? await client.beta.messages.parse({ ...params, betas: [...route.betas], ...(route.fallbacks ? { fallbacks: route.fallbacks } : {}) } as never)
        : await client.messages.parse(params as never)
    ) as unknown as ParsedResponse;
    return { data, logId: capture.logId };
  }

  private point(c: LlmCall<unknown>, outcome: string, attempt: number, started: number, usage?: LlmUsage): void {
    this.o.events?.point({
      event: 'llm_call',
      run_id: c.meta.run_id,
      agent: c.meta.agent,
      step: c.meta.step,
      route: c.route,
      model: usage?.model ?? LLM_ROUTES[c.route].model,
      outcome,
      prompt_version: c.prompt,
      tenant_id: c.meta.tenant_id,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      cache_read_tokens: usage?.cache_read_input_tokens,
      cache_write_tokens: usage?.cache_creation_input_tokens,
      cost_usd: usage?.cost_usd,
      latency_ms: this.now() - started,
      attempt,
    });
  }

  async call<T>(c: LlmCall<T>): Promise<LlmResult<T> | LlmFailure> {
    const routeModel = LLM_ROUTES[c.route].model;
    let maxTokens = Math.min(c.maxTokens, MAX_TOKENS_CAP);
    let usage: LlmUsage | undefined;
    let raisedMaxTokens = false;
    let reasked = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const started = this.now();
      let sent: { data: ParsedResponse; logId?: string };
      try {
        sent = await this.send(c as LlmCall<unknown>, maxTokens);
      } catch (error) {
        const failure = failureOf(error);
        if (!failure) throw error;
        this.point(c as LlmCall<unknown>, failure.code, attempt, started);
        return { ...failure, ...(usage ? { usage } : {}) };
      }
      const { data } = sent;
      const callUsage = usageOf(data.usage, data.model ?? routeModel, routeModel);
      usage = addUsage(usage, callUsage);
      const stop = data.stop_reason ?? 'end_turn';
      if (stop === 'refusal') {
        this.point(c as LlmCall<unknown>, 'refusal', attempt, started, callUsage);
        return { ok: false, code: 'refusal', retryable: false, usage, message: 'the model declined the request' };
      }
      if (stop === 'max_tokens') {
        this.point(c as LlmCall<unknown>, 'max_tokens', attempt, started, callUsage);
        if (!raisedMaxTokens && maxTokens < MAX_TOKENS_CAP) {
          raisedMaxTokens = true;
          maxTokens = Math.min(maxTokens * 2, MAX_TOKENS_CAP);
          continue;
        }
        return { ok: false, code: 'max_tokens', retryable: false, usage, message: 'output exceeded max_tokens' };
      }
      const parsed = data.parsed_output;
      const valid =
        (stop === 'end_turn' || stop === 'stop_sequence') && parsed && parsed.ok === true && valueSchemaProblems(c.schema, parsed.value).length === 0;
      if (!valid) {
        this.point(c as LlmCall<unknown>, 'schema', attempt, started, callUsage);
        if (!reasked) {
          reasked = true;
          continue;
        }
        return { ok: false, code: 'schema', retryable: false, usage, message: 'output did not match the schema' };
      }
      this.point(c as LlmCall<unknown>, 'ok', attempt, started, callUsage);
      return { ok: true, value: (parsed as { ok: true; value: unknown }).value as T, usage, model: callUsage.model, stop: 'end_turn', ...(sent.logId ? { logId: sent.logId } : {}) };
    }
    return { ok: false, code: 'schema', retryable: false, ...(usage ? { usage } : {}), message: 'no valid output' };
  }
}
