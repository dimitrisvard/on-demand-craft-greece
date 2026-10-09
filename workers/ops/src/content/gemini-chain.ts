// The live Gemini model chain of translate-article (version 81) over P5Ports.textLlm.gemini (AI Gateway route
// google-ai-studio, provider key stored in the gateway).
//
// Rules (live semantics)
//   - Models in order: gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.0-flash, gemini-2.0-flash-lite,
//     gemini-flash-latest (v1beta), temperature 0.3, maxOutputTokens 8192, 90 s per call, no continuation.
//   - 429 and 404 -> next model at once; HTTP 500 and 503 -> the same model again after 3 s and 6 s (3 attempts),
//     then the next model; any other 5xx and a timeout -> next model.
//   - Every model failed in one of those ways -> GeminiOverloadedError (the consumer retries the message later).
//   - Any other failure (empty answer, blocked, a 4xx other than 404/429) stops the chain with GeminiCallError.
//     An answered call that failed (a 200 without text, blocked or with an error) is billed: its usage travels on
//     the GeminiCallError, so the caller adds it to the run like the usage of a successful call.
//   - The answer text is returned whatever the finish reason (a truncated answer is caught by the parser guards).

import type { LlmUsage } from '../ports/index';
import type { TextLlmMeta, TextLlmPort } from '../ports/p5';

export const GEMINI_MODELS: readonly string[] = Object.freeze([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
]);

export const GEMINI_TEMPERATURE = 0.3;
export const GEMINI_MAX_OUTPUT_TOKENS = 8192;
export const GEMINI_CALL_TIMEOUT_MS = 90_000;
/** Attempts on one model for HTTP 500/503 (waits 3 s, then 6 s). */
export const OVERLOAD_MAX_RETRIES = 3;

/** Every model of the chain was overloaded, rate limited, missing or timed out. */
export class GeminiOverloadedError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'GeminiOverloadedError';
    this.status = status;
  }
}

/** A failure that a different model would not fix (stops the chain). */
export class GeminiCallError extends Error {
  readonly code: string;
  /** Usage of the answered call that failed (empty when nothing was answered). */
  readonly usage: LlmUsage[];
  constructor(code: string, message: string, usage: LlmUsage[] = []) {
    super(message);
    this.name = 'GeminiCallError';
    this.code = code;
    this.usage = usage;
  }
}

/** The billed usage a chain failure carries (GeminiCallError of an answered call; anything else carries none). */
export function geminiFailureUsage(e: unknown): LlmUsage[] {
  if (!(e instanceof Error) || e.name !== 'GeminiCallError') return [];
  const usage = (e as { usage?: unknown }).usage;
  return Array.isArray(usage) ? (usage as LlmUsage[]) : [];
}

export interface GeminiAnswer {
  text: string;
  finishReason: string;
  model: string;
  /** Usage of every successful call of this chain run (one entry). */
  usage: LlmUsage[];
}

export interface GeminiChainOptions {
  meta: TextLlmMeta;
  /** Waits between same-model attempts (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One translation call through the chain; throws GeminiOverloadedError or GeminiCallError. */
export async function callGemini(port: TextLlmPort, prompt: string, o: GeminiChainOptions): Promise<GeminiAnswer> {
  const sleep = o.sleep ?? realSleep;
  let lastStatus: number | null = null;
  let lastCode = 'server';
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < OVERLOAD_MAX_RETRIES; attempt++) {
      const result = await port.gemini({
        model,
        prompt,
        temperature: GEMINI_TEMPERATURE,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        timeoutMs: o.timeoutMs ?? GEMINI_CALL_TIMEOUT_MS,
        meta: o.meta,
      });
      if (result.ok) {
        if (!result.text) throw new GeminiCallError('empty', `empty Gemini response (${model})`, [result.usage]);
        return { text: result.text, finishReason: result.stop || 'UNKNOWN', model, usage: [result.usage] };
      }
      lastStatus = result.status;
      lastCode = result.code;
      const sameModelAgain = result.code === 'server' && (result.status === 500 || result.status === 503) && attempt < OVERLOAD_MAX_RETRIES - 1;
      if (sameModelAgain) {
        await sleep(3000 * 2 ** attempt);
        continue;
      }
      if (result.code === 'not_found' || result.code === 'rate_limited' || result.code === 'server' || result.code === 'timeout') break;
      throw new GeminiCallError(result.code, `Gemini ${result.code}${result.status ? ` ${result.status}` : ''} on ${model}`, result.usage ? [result.usage] : []);
    }
  }
  throw new GeminiOverloadedError(`all Gemini models failed (last: ${lastCode}${lastStatus ? ` ${lastStatus}` : ''})`, lastStatus);
}

/** True for the error that means "try again later" (also across module copies). */
export function isGeminiOverloaded(e: unknown): boolean {
  return e instanceof GeminiOverloadedError || (e instanceof Error && e.name === 'GeminiOverloadedError');
}
