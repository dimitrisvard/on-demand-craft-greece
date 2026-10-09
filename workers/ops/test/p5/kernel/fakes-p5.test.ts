// The T1 fakes of the Phase 5 ports (src/ports/p5-stub/) that the other Phase 5 units test with, the Phase 5 rules of
// scripts/check-bundle.mjs, the Phase 5 price rows, and the guard that no production module imports the fakes.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LLM_PRICES, llmCostUsd, PRICES_VERSION } from '../../../src/agents/prices';
import { P5_T2_ONLY_VARS } from '../../../src/ports/p5';
import {
  failText,
  FakeTextLlm,
  GmailSendRecorder,
  makeTestP5Ports,
  makeTestPorts,
  okText,
  ScriptedContainer,
  ScriptedSources,
  StorageRecorder,
  TelegramTextRecorder,
  UNSCRIPTED_STATUS,
} from '../../../src/ports/p5-stub/index';

const META = { agent: 'content_daily.translate', run_id: 'r1', tenant_id: 't1', step: 'translate', prompt: 'content_daily.translate@v1' };

describe('FakeTextLlm', () => {
  it('answers from fixtures keyed by <meta.prompt>:<SHA-256 of the input> and records every call', async () => {
    const key = await FakeTextLlm.fixtureKey('content_daily.translate@v1', 'Hello');
    expect(key).toBe('content_daily.translate@v1:185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969');
    const llm = new FakeTextLlm({ fixtures: { [key]: okText('Hallo', { model: 'gemini-2.5-flash-lite', stop: 'STOP' }) } });
    const hit = await llm.gemini({ model: 'gemini-2.5-flash-lite', prompt: 'Hello', temperature: 0.3, maxOutputTokens: 8192, timeoutMs: 90_000, meta: META });
    expect(hit).toMatchObject({ ok: true, text: 'Hallo', stop: 'STOP', model: 'gemini-2.5-flash-lite' });
    const miss = await llm.anthropic({ model: 'claude-sonnet-5', maxTokens: 16384, userText: 'Other', timeoutMs: 310_000, gatewayTimeoutMs: 300_000, meta: { ...META, prompt: 'content_daily.generate_en@v1' } });
    expect(miss).toMatchObject({ ok: false, code: 'other', retryable: false });
    expect(llm.calls.map((c) => [c.provider, c.model, c.input, c.maxTokens, c.temperature, c.gatewayTimeoutMs])).toEqual([
      ['gemini', 'gemini-2.5-flash-lite', 'Hello', 8192, 0.3, undefined],
      ['anthropic', 'claude-sonnet-5', 'Other', 16384, undefined, 300_000],
    ]);
    expect(llm.calls[0]?.inputSha256).toBe(key.split(':')[1]);
  });

  it('a script answers calls without a fixture (e.g. a model chain: 429, 404, then text); add() registers fixtures', async () => {
    const llm = new FakeTextLlm({
      script: (c) => (c.model === 'a' ? failText('rate_limited', { status: 429 }) : c.model === 'b' ? failText('not_found', { status: 404 }) : okText(`ok from ${c.model}`)),
    });
    const ask = (model: string) => llm.gemini({ model, prompt: 'p', temperature: 0.3, maxOutputTokens: 10, timeoutMs: 1, meta: META });
    expect(await ask('a')).toMatchObject({ ok: false, code: 'rate_limited', status: 429, retryable: true });
    expect(await ask('b')).toMatchObject({ ok: false, code: 'not_found', status: 404, retryable: false });
    expect(await ask('c')).toMatchObject({ ok: true, text: 'ok from c' });
    await llm.add(META.prompt, 'p', okText('fixture wins'));
    expect(await ask('a')).toMatchObject({ ok: true, text: 'fixture wins' });
  });

  it('failText builds a failure with the usage of an answered call when given, and none otherwise', () => {
    const usage = { input_tokens: 10, output_tokens: 16_384, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0.16386, model: 'claude-sonnet-5' };
    expect(failText('other', { status: 200, retryable: false, message: 'anthropic: stopped at max_tokens', usage })).toEqual({
      ok: false,
      status: 200,
      code: 'other',
      retryable: false,
      message: 'anthropic: stopped at max_tokens',
      usage,
    });
    expect(failText('rate_limited', { status: 429 })).not.toHaveProperty('usage');
  });

  it('a fixture result is returned as a copy', async () => {
    const llm = new FakeTextLlm();
    await llm.add(META.prompt, 'x', okText('one'));
    const first = await llm.gemini({ model: 'm', prompt: 'x', temperature: 0, maxOutputTokens: 1, timeoutMs: 1, meta: META });
    if (first.ok) first.text = 'mutated';
    expect(await llm.gemini({ model: 'm', prompt: 'x', temperature: 0, maxOutputTokens: 1, timeoutMs: 1, meta: META })).toMatchObject({ text: 'one' });
  });
});

describe('ScriptedSources', () => {
  it('base(name) is https://<name>.test unless given; routes match by prefix or RegExp and method; later route() wins', async () => {
    const sources = new ScriptedSources({
      bases: { hn: 'https://hn.example' },
      routes: [{ match: 'https://pullpush.test/reddit/', respond: new Response('[1]', { status: 200 }) }],
    });
    expect(sources.base('pullpush')).toBe('https://pullpush.test');
    expect(sources.base('hn')).toBe('https://hn.example');
    sources.route({ method: 'POST', match: /indexnow$/, respond: () => new Response(null, { status: 202 }) });
    expect(await (await sources.fetch('https://pullpush.test/reddit/search?x=1')).text()).toBe('[1]');
    expect(await (await sources.fetch('https://pullpush.test/reddit/search?x=2')).text()).toBe('[1]');
    expect((await sources.fetch('https://indexnow.test/indexnow', { method: 'POST', body: '{"k":1}', headers: { 'content-type': 'application/json' } })).status).toBe(202);
    expect((await sources.fetch('https://indexnow.test/indexnow')).status).toBe(UNSCRIPTED_STATUS);
    expect(sources.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['GET', 'https://pullpush.test/reddit/search?x=1', null],
      ['GET', 'https://pullpush.test/reddit/search?x=2', null],
      ['POST', 'https://indexnow.test/indexnow', '{"k":1}'],
      ['GET', 'https://indexnow.test/indexnow', null],
    ]);
    expect(sources.requests[2]?.headers['content-type']).toBe('application/json');
  });
});

describe('recorders', () => {
  it('StorageRecorder records uploads and answers the scripted failure', async () => {
    const storage = new StorageRecorder();
    expect(await storage.upload('sitemap-complete.xml', '<a/>', { contentType: 'application/xml', cacheControl: '3600' })).toEqual({ ok: true });
    storage.failWith = { status: 500, message: 'down' };
    expect(await storage.upload('sitemap-complete.xml', '<b/>', { contentType: 'application/xml', cacheControl: '3600' })).toEqual({ ok: false, status: 500, message: 'down' });
    expect(storage.uploads.map((u) => u.xml)).toEqual(['<a/>', '<b/>']);
  });

  it('GmailSendRecorder answers in script order, then gmail-<n>; keeps a copy of the bytes', async () => {
    const gmail = new GmailSendRecorder();
    gmail.script.push({ ok: false, status: 429, retryable: true, message: 'slow down' });
    const bytes = new TextEncoder().encode('Subject: x\r\n\r\nbody');
    expect(await gmail.send('t', bytes)).toMatchObject({ ok: false, status: 429 });
    expect(await gmail.send('t', bytes)).toEqual({ ok: true, id: 'gmail-2' });
    bytes[0] = 0;
    expect(gmail.mimeText(1)).toBe('Subject: x\r\n\r\nbody');
  });

  it('ScriptedContainer records requests per slot and destroyed slots; unscripted answers 599', async () => {
    const container = new ScriptedContainer();
    expect((await container.fetch('cad-0', new Request('http://cad/health'))).status).toBe(UNSCRIPTED_STATUS);
    container.setScript((slot) => new Response(slot));
    expect(await (await container.fetch('cad-1', new Request('http://cad/flat-pattern', { method: 'POST', body: '{}' }))).text()).toBe('cad-1');
    await container.destroy('cad-1');
    expect(container.requests.map((r) => [r.slot, r.method, r.url, r.body])).toEqual([
      ['cad-0', 'GET', 'http://cad/health', null],
      ['cad-1', 'POST', 'http://cad/flat-pattern', '{}'],
    ]);
    expect(container.destroyed).toEqual(['cad-1']);
  });

  it('TelegramTextRecorder keeps texts byte for byte and the preview flag only when given', async () => {
    const telegram = new TelegramTextRecorder();
    await telegram.send('\u{1F534} HIGH LEAD\n\nx', { disableWebPagePreview: true });
    telegram.answer = { ok: false, status: null };
    expect(await telegram.send('plain')).toEqual({ ok: false, status: null });
    expect(telegram.messages).toEqual([{ text: '\u{1F534} HIGH LEAD\n\nx', disableWebPagePreview: true }, { text: 'plain' }]);
    expect(telegram.texts()).toEqual(['\u{1F534} HIGH LEAD\n\nx', 'plain']);
  });

  it('makeTestP5Ports builds every fake and keeps the ones given; makeTestPorts is the Phase 4 agentPorts', () => {
    const telegram = new TelegramTextRecorder();
    const p5 = makeTestP5Ports({ telegramText: telegram });
    expect(p5.telegramText).toBe(telegram);
    expect(p5.textLlm).toBeInstanceOf(FakeTextLlm);
    expect(p5.sources).toBeInstanceOf(ScriptedSources);
    expect(p5.storage).toBeInstanceOf(StorageRecorder);
    expect(p5.gmailSend).toBeInstanceOf(GmailSendRecorder);
    expect(p5.container).toBeInstanceOf(ScriptedContainer);
    const ports = makeTestPorts();
    expect(typeof ports.db.select).toBe('function');
    expect(typeof ports.clock.now).toBe('function');
  });
});

describe('Phase 5 price rows', () => {
  it('Gemini rows for the chain models with a source; PRICES_VERSION and every Phase 4 row unchanged', () => {
    expect(PRICES_VERSION).toBe('2026-09-25');
    expect(LLM_PRICES['gemini-2.5-flash-lite']).toEqual({ input: 0.1, output: 0.4, cache_read: 0.01, cache_write: 0.1 });
    expect(LLM_PRICES['gemini-2.5-flash']).toEqual({ input: 0.3, output: 2.5, cache_read: 0.03, cache_write: 0.3 });
    expect(LLM_PRICES['claude-sonnet-5']).toEqual({ input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 });
    expect(llmCostUsd('gemini-2.5-flash', { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeCloseTo(2.8, 10);
    // No row: the caller records the tokens without a price (price_missing when nothing priced).
    for (const model of ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-flash-latest']) {
      expect(llmCostUsd(model, { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), model).toBeNull();
    }
  });
});

interface CheckBundleP5 {
  P5_T2_ONLY_VARS: string[];
  T2_ONLY_VARS: string[];
  CONTAINERS_ROOT: string;
  phase4Problems(meta: unknown, config: unknown): string[];
  phase5Problems(meta: unknown, config: unknown): string[];
  forbiddenP5Vars(config: unknown): string[];
  repoRelative(input: string): string;
  parseJsonc(text: string): Record<string, unknown>;
}
const checkBundle = (await import(/* @vite-ignore */ new URL('../../../scripts/check-bundle.mjs', import.meta.url).href)) as CheckBundleP5;

describe('check-bundle Phase 5 rules', () => {
  const input = () => ({ bytes: 1, imports: [] });
  const ONE_COPY = {
    'node_modules/@cloudflare/containers/dist/index.js': input(),
    'node_modules/@cloudflare/containers/dist/lib/container.js': input(),
    'node_modules/@cloudflare/containers/dist/lib/utils.js': input(),
    'src/cad-container/cad-container.ts': input(),
  };
  const production = checkBundle.parseJsonc(readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8'));

  it('the real production config and a one-copy metafile pass', () => {
    expect(checkBundle.phase5Problems({ inputs: ONE_COPY }, production)).toEqual([]);
    expect(checkBundle.forbiddenP5Vars(production)).toEqual([]);
  });

  it('the Phase 5 T2-only names are the list of src/ports/p5.ts; the Phase 4 list stays as it was', () => {
    expect(checkBundle.P5_T2_ONLY_VARS).toEqual([...P5_T2_ONLY_VARS]);
    expect(checkBundle.T2_ONLY_VARS).toEqual(['AGENT_STUBS', 'AGENT_LLM_BASE_URL', 'RESEND_API_BASE', 'TELEGRAM_API_BASE', 'GMAIL_API_BASE', 'GOOGLE_TOKEN_URL']);
  });

  it('fails on a production var PULLPUSH_API_BASE (and every other Phase 5 T2-only name)', () => {
    expect(checkBundle.phase5Problems({ inputs: ONE_COPY }, { vars: { PULLPUSH_API_BASE: 'http://127.0.0.1:1', SITE_ORIGIN: 'x' } })).toEqual(['production wrangler.jsonc sets the Phase 5 T2-only var PULLPUSH_API_BASE']);
    expect(checkBundle.forbiddenP5Vars({ vars: Object.fromEntries(P5_T2_ONLY_VARS.map((n) => [n, 'x'])) })).toEqual([...P5_T2_ONLY_VARS]);
    // The Phase 4 rule also refuses the *_API_BASE names (but not the other two).
    expect(checkBundle.phase4Problems({ inputs: {} }, { vars: { AGENT_GEMINI_BASE_URL: 'x' } }).filter((p) => p.includes('T2-only'))).toEqual([]);
    expect(checkBundle.phase5Problems({ inputs: ONE_COPY }, { vars: { AGENT_GEMINI_BASE_URL: 'x', CAD_CONTAINER_BASE_URL: 'y' } })).toHaveLength(2);
  });

  it('fails on a second @cloudflare/containers copy (another install, or a nested one)', () => {
    const second = { ...ONE_COPY, '../cad/node_modules/@cloudflare/containers/dist/lib/container.js': input() };
    expect(checkBundle.phase5Problems({ inputs: second }, production)).toEqual([
      '@cloudflare/containers input outside workers/ops/node_modules/@cloudflare/containers/: ../cad/node_modules/@cloudflare/containers/dist/lib/container.js',
      '@cloudflare/containers dist/lib/container.js is bundled 2 times (expected exactly once)',
    ]);
    const root = { 'src/index.ts': input(), '../../node_modules/@cloudflare/containers/dist/lib/container.js': input() };
    expect(checkBundle.phase5Problems({ inputs: root }, production)).toEqual([
      '@cloudflare/containers input outside workers/ops/node_modules/@cloudflare/containers/: ../../node_modules/@cloudflare/containers/dist/lib/container.js',
    ]);
    const nested = { ...ONE_COPY, 'node_modules/agents/node_modules/@cloudflare/containers/dist/index.js': input() };
    expect(checkBundle.phase5Problems({ inputs: nested }, production)).toEqual([
      '@cloudflare/containers input outside workers/ops/node_modules/@cloudflare/containers/: node_modules/agents/node_modules/@cloudflare/containers/dist/index.js',
    ]);
  });

  it('fails when the container module is missing from the bundle', () => {
    expect(checkBundle.phase5Problems({ inputs: { 'src/index.ts': input() } }, production)).toEqual(['@cloudflare/containers dist/lib/container.js is bundled 0 times (expected exactly once)']);
  });

  it('repoRelative maps metafile paths (relative to workers/ops) onto the repository', () => {
    expect(checkBundle.repoRelative('node_modules/x/y.js')).toBe('workers/ops/node_modules/x/y.js');
    expect(checkBundle.repoRelative('../../node_modules/x/y.js')).toBe('node_modules/x/y.js');
    expect(checkBundle.repoRelative('..\\cad\\node_modules\\x.js')).toBe('workers/cad/node_modules/x.js');
  });
});

describe('the fakes never reach the bundle', () => {
  it('no module under src/ outside src/ports/p5-stub imports the p5-stub folder', () => {
    const src = fileURLToPath(new URL('../../../src/', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) {
          if (file !== path.join(src, 'ports', 'p5-stub')) walk(file);
        } else if (file.endsWith('.ts') && /from\s+['"][^'"]*p5-stub[^'"]*['"]/.test(readFileSync(file, 'utf8'))) {
          offenders.push(path.relative(src, file));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
