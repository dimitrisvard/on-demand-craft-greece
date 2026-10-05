// AI Gateway client for Anthropic (provider-native endpoint through the Workers AI binding).
//
// Rules
//   - baseURL = await env.AI.gateway(AI_GATEWAY_ID).getUrl('anthropic'); in generated T2 configs only,
//     AGENT_LLM_BASE_URL (the harness stub) instead.
//   - The provider key is stored in the gateway: the client sends no x-api-key; the gateway token goes in
//     cf-aig-authorization (authenticated gateway).
//   - cf-aig-metadata carries exactly five string keys (agent, run_id, tenant_id, step, prompt): ids only, never an
//     e-mail address. cf-aig-collect-log-payload is 'false' for every call with customer data.
//   - maxRetries 0 (the Workflow step owns retries), client timeout 170 s, gateway request timeout 150 s.
//   - extract calls go through the beta namespace with server-side fallback ('default'); classify calls do not.
//   - The client never resolves credentials of its own (no environment key, no local profile): the gateway holds
//     the provider key.
//   - The stub path (generated T2 configs only): with 'llm' in AGENT_STUBS the base URL is AGENT_LLM_BASE_URL and the
//     header x-microns-prompt names the prompt; it requires that AI is not bound (makePorts checks the same).
// Model ids and prices: src/agents/prices.ts.

import Anthropic from '@anthropic-ai/sdk';
import type { OpsEnv } from '../env';
import { need } from './config';

/** The five cf-aig-metadata keys. */
export interface GatewayMeta {
  agent: string;
  run_id: string;
  tenant_id: string;
  step: string;
  prompt: string;
}

export type LlmRoute = 'extract' | 'classify';

export interface RouteConfig {
  model: string;
  /** Beta flags sent on the call (beta namespace when non-empty). */
  betas: readonly string[];
  /** Server-side refusal fallback; only on extract. */
  fallbacks: 'default' | null;
}

export const LLM_ROUTES: Readonly<Record<LlmRoute, RouteConfig>> = Object.freeze({
  extract: { model: 'claude-sonnet-5-5', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
  classify: { model: 'claude-haiku-4-5', betas: [], fallbacks: null },
});

export const EMBED_MODEL = '@cf/baai/bge-m3';
export const EMBED_DIMENSIONS = 1024;

export const CLIENT_TIMEOUT_MS = 170_000;
export const GATEWAY_REQUEST_TIMEOUT_MS = 150_000;

/** The five metadata keys in their fixed order. */
export const GATEWAY_META_KEYS = ['agent', 'run_id', 'tenant_id', 'step', 'prompt'] as const;

/** cf-aig-metadata value: exactly the five keys, string values (at most 200 characters each). */
export function gatewayMetadata(meta: GatewayMeta): string {
  const out: Record<string, string> = {};
  for (const key of GATEWAY_META_KEYS) out[key] = String(meta[key] ?? '').slice(0, 200);
  return JSON.stringify(out);
}

/** Gateway headers of every provider call: cf-aig-authorization, cf-aig-metadata, payload logging off, timeout. */
export function gatewayHeaders(env: OpsEnv, meta: GatewayMeta): Record<string, string> {
  need(env, 'AI_GATEWAY_TOKEN');
  return {
    'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
    'cf-aig-metadata': gatewayMetadata(meta),
    'cf-aig-collect-log-payload': 'false',
    'cf-aig-request-timeout': String(GATEWAY_REQUEST_TIMEOUT_MS),
  };
}

/** Comma list of AGENT_STUBS as a set of tokens. */
export function stubTokens(env: Pick<OpsEnv, 'AGENT_STUBS'>): Set<string> {
  return new Set((env.AGENT_STUBS ?? '').split(',').map((t) => t.trim()).filter(Boolean));
}

/** The SDK client without its default credential chain: the gateway authenticates the provider call. */
class GatewayAnthropic extends Anthropic {
  protected override _shouldResolveDefaultCredentials(): boolean {
    return false;
  }
}

export interface AnthropicForOptions {
  /** fetch used by the SDK (tests record requests with it). */
  fetch?: typeof fetch;
}

/** Base URL of the provider-native Anthropic endpoint of the gateway, or the T2 stub. */
export async function anthropicBaseUrl(env: OpsEnv): Promise<string> {
  if (stubTokens(env).has('llm')) {
    if (env.AI) throw new Error('AGENT_STUBS names llm while the AI binding is bound');
    need(env, 'AGENT_LLM_BASE_URL');
    return env.AGENT_LLM_BASE_URL;
  }
  need(env, 'AI', 'AI_GATEWAY_ID');
  return env.AI.gateway(env.AI_GATEWAY_ID).getUrl('anthropic');
}

/** Anthropic SDK client pointed at the gateway (callers write (await anthropicFor(env, meta)).messages…). */
export async function anthropicFor(env: OpsEnv, meta: GatewayMeta, o: AnthropicForOptions = {}): Promise<Anthropic> {
  const headers: Record<string, string | null> = { 'x-api-key': null, ...gatewayHeaders(env, meta) };
  const baseURL = await anthropicBaseUrl(env);
  if (stubTokens(env).has('llm')) headers['x-microns-prompt'] = meta.prompt;
  return new GatewayAnthropic({
    apiKey: null,
    authToken: null,
    baseURL,
    maxRetries: 0,
    timeout: CLIENT_TIMEOUT_MS,
    defaultHeaders: headers,
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
}
