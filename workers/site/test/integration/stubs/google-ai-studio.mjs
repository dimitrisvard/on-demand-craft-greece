// Google AI Studio (Gemini) stub of the T2 profile 'jobs' (generated ops config: AGENT_GEMINI_BASE_URL =
// <stub>/google-ai-studio), standing in for the AI Gateway route google-ai-studio.
//
//   POST /google-ai-studio/v1beta/models/<model>:generateContent
//       401 without cf-aig-authorization (the Worker always sends the gateway headers); else the next scripted
//       answer of that model, then the model's `then` answer, then the script default. An answer is
//       {status, body?} (a raw generateContent body) or {text, finishReason?} (a one-candidate answer with usage).
//       Unscripted: 404 (model not found), so a chain test fails loudly.
//   POST /__stub/google-ai-studio/script   {models?: {<model>: [answers] | {answers: [...], then?: answer}}, default?: answer}
//   GET  /__stub/google-ai-studio/calls    recorded calls: model, the SHA-256 of the prompt text, temperature,
//                                          maxOutputTokens, the cf-aig-metadata keys and whether a provider key was
//                                          sent (it must never be)
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

import { createHash } from 'node:crypto';

export const prefixes = ['/google-ai-studio/', '/__stub/google-ai-studio/'];

/** JSON answer. */
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined || status === 204 ? undefined : JSON.stringify(body));
}

/** Parsed JSON of a request body, or undefined. */
function jsonOf(body) {
  try {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}
const PATH = /^\/google-ai-studio\/v1beta\/models\/([^/:]+):generateContent$/;

function bodyOf(answer, model) {
  if (answer.text === undefined) return answer.body ?? {};
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: answer.text }] }, finishReason: answer.finishReason ?? 'STOP' }],
    usageMetadata: { promptTokenCount: answer.promptTokens ?? 100, candidatesTokenCount: answer.outputTokens ?? 200 },
    modelVersion: answer.modelVersion ?? model,
  };
}

export function createStubModule() {
  let models = {};
  let fallback = null;
  const calls = [];

  function next(model) {
    const entry = models[model];
    if (Array.isArray(entry)) return entry.shift() ?? fallback;
    if (entry && typeof entry === 'object') return entry.answers?.shift() ?? entry.then ?? fallback;
    return fallback;
  }

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/google-ai-studio/script' && req.method === 'POST') {
      const script = jsonOf(body) ?? {};
      models = structuredClone(script.models ?? {});
      fallback = script.default ?? null;
      sendJson(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/google-ai-studio/calls' && req.method === 'GET') {
      sendJson(res, 200, calls);
      return true;
    }
    const match = PATH.exec(url.pathname);
    if (!match || req.method !== 'POST') return false;
    const model = decodeURIComponent(match[1]);
    const parsed = jsonOf(body) ?? {};
    const prompt = parsed.contents?.[0]?.parts?.[0]?.text ?? '';
    let metadataKeys = [];
    try {
      metadataKeys = Object.keys(JSON.parse(String(req.headers['cf-aig-metadata'] ?? '{}')));
    } catch {
      metadataKeys = ['<invalid>'];
    }
    calls.push({
      model,
      prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
      temperature: parsed.generationConfig?.temperature ?? null,
      maxOutputTokens: parsed.generationConfig?.maxOutputTokens ?? null,
      cf_aig_metadata_keys: metadataKeys,
      provider_key_sent: req.headers['x-goog-api-key'] !== undefined || url.searchParams.has('key'),
    });
    if (req.headers['cf-aig-authorization'] === undefined) {
      sendJson(res, 401, { error: { code: 401, message: 'gateway authorization missing' } });
      return true;
    }
    const answer = next(model);
    if (!answer) {
      sendJson(res, 404, { error: { code: 404, message: `models/${model} is not found (unscripted)`, status: 'NOT_FOUND' } });
      return true;
    }
    sendJson(res, answer.status ?? 200, bodyOf(answer, model));
    return true;
  }

  function reset() {
    models = {};
    fallback = null;
    calls.length = 0;
  }

  return { prefixes, handle, reset, calls };
}
