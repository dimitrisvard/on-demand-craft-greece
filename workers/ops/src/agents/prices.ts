// Prices used for agent_runs.cost_cents and the Analytics Engine cost_usd double (list prices, USD).
// Sources: claude-api skill model table (cached 2026-09-25, read 2026-10-03 and 2026-10-05) for the Anthropic rows;
// https://developers.cloudflare.com/workers-ai/models/bge-m3/ (fetched 2026-10-03) for bge-m3; the Gemini rows of
// Phase 5 name their own source below. Rows added for a new model leave every earlier price, and so
// PRICES_VERSION, unchanged.
// A price change is a code change with a new PRICES_VERSION, recorded in agent_runs.output.prices_version.
//
// Rules
//   - LLM cost of one call = (input * input + output * output + cache read * cache_read + cache creation *
//     cache_write) / 1,000,000; cache_write is 1.25 x input (5-minute cache).
//   - A model without a row has no price: the caller records the known parts and output.price_missing. A dated id
//     ('<model>-<yyyymmdd>') uses the row of its undated id.
//   - cost_cents = 100 x the USD sum of the run's successful calls, rounded up to the column's 4 decimals, so a run
//     with any priced spend never records 0.

export const PRICES_VERSION = '2026-09-25';

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export const LLM_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'claude-sonnet-5-5': { input: 2.0, output: 10.0, cache_read: 0.2, cache_write: 2.5 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 1.25 },
  // Dated id of the same model, as a response may name it.
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 1.25 },
  // Server-side refusal fallback target of extract calls (same list price as Sonnet 5.5); Phase 5 also uses it as the
  // content-daily article model (value.model default).
  'claude-sonnet-5': { input: 2.0, output: 10.0, cache_read: 0.2, cache_write: 2.5 },
  // ----- Phase 5: translation chain (Gemini through the AI Gateway route google-ai-studio) -----
  // Source: https://ai.google.dev/gemini-api/docs/pricing, paid tier, standard, text input and output (thinking
  // included), context caching (fetched 2026-10-08, page "last updated 2026-10-07"). Gemini bills no separate cache
  // write, so cache_write = input. gemini-2.0-flash, gemini-2.0-flash-lite and the alias gemini-flash-latest have
  // no row on that page: a call answered by them is recorded with its tokens and no price (price_missing when the
  // run spent nothing priced); an alias call is priced by the answer's modelVersion when that has a row.
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cache_read: 0.01, cache_write: 0.1 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cache_read: 0.03, cache_write: 0.3 },
});

/** USD per million input tokens. */
export const EMBED_PRICES: Readonly<Record<string, number>> = Object.freeze({
  '@cf/baai/bge-m3': 0.0118,
});

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** The price row of a model id (exact, else the id without a trailing -yyyymmdd), or null. */
export function modelPrice(model: string): ModelPrice | null {
  return LLM_PRICES[model] ?? LLM_PRICES[model.replace(/-\d{8}$/, '')] ?? null;
}

function tokens(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** USD of one LLM call, or null when the model has no price row. */
export function llmCostUsd(model: string, u: TokenCounts): number | null {
  const p = modelPrice(model);
  if (!p) return null;
  return (
    (tokens(u.input_tokens) * p.input +
      tokens(u.output_tokens) * p.output +
      tokens(u.cache_read_input_tokens) * p.cache_read +
      tokens(u.cache_creation_input_tokens) * p.cache_write) /
    1_000_000
  );
}

/** USD of one embedding call, or null when the model has no price row. */
export function embedCostUsd(model: string, inputTokens: number): number | null {
  const p = EMBED_PRICES[model];
  return p === undefined ? null : (tokens(inputTokens) * p) / 1_000_000;
}

/** agent_runs.cost_cents (numeric(12,4)) for a USD sum: rounded up to 4 decimals; 0 for no spend. */
export function costCents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  // Units of 1/10,000 cent; the small tolerance absorbs binary rounding (0.03 * 1e6 = 30000.000000000004).
  return Math.ceil(usd * 1_000_000 - 1e-6) / 10_000;
}
