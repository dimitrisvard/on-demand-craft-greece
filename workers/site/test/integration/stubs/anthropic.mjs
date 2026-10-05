// Anthropic Messages API stub of the T2 profile 'agents' (generated ops config: AGENT_STUBS contains 'llm',
// AGENT_LLM_BASE_URL = <stub>/anthropic). microns-ops runs its real SDK client against it.
//
//   POST /anthropic/v1/messages   replays a fixture chosen by the header x-microns-prompt and the SHA-256 of the
//                                 canonical user content (the same hash as llmContentSha256() in
//                                 workers/ops/src/ports/llm.ts): first a fixture registered by the test, then the
//                                 file workers/ops/test/fixtures/llm/<prompt>/<first 16 hex>.json; an unknown request
//                                 answers 400 so a test fails loudly
//   POST /__stub/anthropic/fixtures   {prompt, request_sha256, response, status?} registers a fixture
//   GET  /__stub/anthropic/requests   recorded requests: prompt, content hash, model, and which gateway headers were
//                                     present (never their values, never the body)
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.resolve(HERE, '../../../../ops/test/fixtures/llm');
export const prefixes = ['/anthropic/', '/__stub/anthropic/'];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

/** The canonical user content of a Messages request (text, pdf and image blocks of the first user message). */
export function contentKeyOf(body) {
  const content = body?.messages?.[0]?.content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
  const user = blocks.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'document') return { type: 'pdf', base64: b.source?.data };
    if (b.type === 'image') return { type: 'image', mediaType: b.source?.media_type, base64: b.source?.data };
    return { type: b.type };
  });
  return JSON.stringify(sortKeys(user));
}

export function contentSha256(body) {
  return createHash('sha256').update(contentKeyOf(body)).digest('hex');
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export function createStubModule({ fixturesDir = FIXTURES_DIR } = {}) {
  const registered = new Map();
  const requests = [];

  function fixtureFor(prompt, sha) {
    const inMemory = registered.get(`${prompt}/${sha}`);
    if (inMemory) return inMemory;
    const file = path.join(fixturesDir, prompt, `${sha.slice(0, 16)}.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  }

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/anthropic/fixtures' && req.method === 'POST') {
      const f = JSON.parse(body.toString('utf8') || '{}');
      if (typeof f.prompt !== 'string' || !/^[0-9a-f]{64}$/.test(f.request_sha256 ?? '') || typeof f.response !== 'object') {
        send(res, 400, { error: 'prompt, request_sha256 and response are required' });
        return true;
      }
      registered.set(`${f.prompt}/${f.request_sha256}`, f);
      send(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/anthropic/requests' && req.method === 'GET') {
      send(res, 200, requests);
      return true;
    }
    if (url.pathname === '/anthropic/v1/messages' && req.method === 'POST') {
      const prompt = String(req.headers['x-microns-prompt'] ?? '');
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'body is not JSON' } });
        return true;
      }
      const sha = contentSha256(parsed);
      let metadataKeys = [];
      try {
        metadataKeys = Object.keys(JSON.parse(String(req.headers['cf-aig-metadata'] ?? '{}')));
      } catch {
        metadataKeys = ['<invalid>'];
      }
      requests.push({
        prompt,
        sha256: sha,
        model: parsed.model,
        fallbacks: parsed.fallbacks ?? null,
        x_api_key: req.headers['x-api-key'] !== undefined,
        cf_aig_authorization: req.headers['cf-aig-authorization'] !== undefined,
        cf_aig_metadata_keys: metadataKeys,
        cf_aig_collect_log_payload: req.headers['cf-aig-collect-log-payload'] ?? null,
      });
      const fixture = prompt ? fixtureFor(prompt, sha) : null;
      if (!fixture) {
        send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: `no fixture for ${prompt || '<no prompt header>'} ${sha.slice(0, 16)}` } });
        return true;
      }
      send(res, fixture.status ?? 200, fixture.response);
      return true;
    }
    return false;
  }

  function reset() {
    registered.clear();
    requests.length = 0;
  }

  return { prefixes, handle, reset, registered, requests };
}
