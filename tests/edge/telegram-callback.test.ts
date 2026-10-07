// W-7 / L-1: the Telegram approval relay (supabase/functions/telegram-leads-bot/agent-callback.ts) and its wiring
// in the function's index.ts (loaded under Node with the URL imports replaced, tests/edge/vitest.config.mjs).
//   - webhook secret header: missing, wrong, right, unset secret
//   - origin: the owner chat and the owner as sender only
//   - callback_data format
//   - the signed request equals the site verifier's expectation (pinned vector shared with
//     workers/site/test/agent-hmac.test.ts, and verifyRelayRequest of workers/site/src/auth/agent-hmac.ts)
//   - answer text per status, exactly one answerCallbackQuery per callback, 200 to Telegram in every branch
//   - no bot token, approval token, signature or body in a log line
// Globals (describe, it, expect, vi) come from the config; nothing reaches a network.

import {
  ANSWERS,
  CALLBACK_DATA_RE,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WEBHOOK_SECRET_HEADER,
  answerFor,
  checkWebhookSecret,
  constantTimeEqual,
  decisionBody,
  handleAgentCallback,
  signDecision,
  type AgentCallbackDeps,
  type CallbackQuery,
} from '../../supabase/functions/telegram-leads-bot/agent-callback.ts';
import { CALLBACK_DATA_RE as SHARED_CALLBACK_DATA_RE, VERB_CODES, callbackData, isDecisionBodyRelay } from '../../workers/shared/src/agent-api';
import { SeenSignatures, verifyRelayRequest } from '../../workers/site/src/auth/agent-hmac';

// Same vector as workers/site/test/agent-hmac.test.ts (RELAY_VECTOR).
const RELAY_VECTOR = {
  secret: 'relay-fixture-value',
  timestamp: '1760000000',
  body: '{"v":1,"token":"ABCDEFGHIJKLMNOPQRSTUVWXYZ","code":"dis","tg":{"user_id":4242,"chat_id":4242,"message_id":1000}}',
  signature: 'c9be10ba859402e118d4a39bc49ff7e23687e4bd05f5d4638da0cdf85b15e348',
};

const OWNER = 4242;
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BOT_TOKEN = 'bot-fixture-value';
const WEBHOOK_SECRET = 'webhook-fixture-value';
const DECISION_URL = 'https://site.example.test/api/agent/decision';
const TELEGRAM_BASE = 'https://telegram.example.test';
const NOW = 1_760_000_000_000;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

type Answer = (call: Recorded, init: RequestInit) => Response | Promise<Response>;

/** A fetch that records every call; decision requests get `decision`, Bot API calls 200 {"ok":true}. */
function recorder(decision: Answer = () => json(200, { v: 1, ok: true, run_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', verb: 'dismiss', outcome: 'dismissed', label: 'Dismissed' })) {
  const calls: Recorded[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Recorded = { url: String(input), method: (init.method ?? 'GET').toUpperCase(), headers: new Headers(init.headers), body: typeof init.body === 'string' ? init.body : '' };
    calls.push(call);
    if (call.url === DECISION_URL) return decision(call, init);
    return json(200, { ok: true, result: true });
  }) as typeof fetch;
  const answers = () => calls.filter((c) => c.url.endsWith('/answerCallbackQuery')).map((c) => JSON.parse(c.body) as { callback_query_id: string; text: string; show_alert?: boolean });
  const decisions = () => calls.filter((c) => c.url === DECISION_URL);
  return { calls, fetchFn, answers, decisions };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function deps(fetchFn: typeof fetch, over: Partial<AgentCallbackDeps> = {}, logs: string[] = []): AgentCallbackDeps {
  return {
    webhookSecret: WEBHOOK_SECRET,
    approvalSecret: RELAY_VECTOR.secret,
    decisionUrl: DECISION_URL,
    botToken: BOT_TOKEN,
    ownerChatId: String(OWNER),
    fetch: fetchFn,
    now: () => NOW,
    telegramApiBase: TELEGRAM_BASE,
    log: (line) => logs.push(line),
    ...over,
  };
}

function query(over: Partial<CallbackQuery> & { chat?: number; from?: number } = {}): CallbackQuery {
  const { chat = OWNER, from = OWNER, ...rest } = over;
  return { id: 'cbq-1', from: { id: from }, message: { message_id: 1000, chat: { id: chat } }, data: `ap:${TOKEN}:dis`, ...rest };
}

function expectNoSecretsIn(lines: string[], extra: string[] = []): void {
  const text = lines.join('\n');
  for (const s of [BOT_TOKEN, TOKEN, RELAY_VECTOR.secret, RELAY_VECTOR.signature, WEBHOOK_SECRET, ...extra]) expect(text).not.toContain(s);
}

describe('webhook secret header', () => {
  const req = (header?: string) => new Request('https://fn.example.test/telegram-leads-bot', { method: 'POST', headers: header === undefined ? {} : { [WEBHOOK_SECRET_HEADER]: header }, body: '{}' });

  it('set: missing or wrong header refused, exact value accepted', () => {
    expect(checkWebhookSecret(req(), WEBHOOK_SECRET)).toBe(false);
    expect(checkWebhookSecret(req(''), WEBHOOK_SECRET)).toBe(false);
    expect(checkWebhookSecret(req('webhook-fixture-valuE'), WEBHOOK_SECRET)).toBe(false);
    expect(checkWebhookSecret(req('xwebhook-fixture-value'), WEBHOOK_SECRET)).toBe(false);
    expect(checkWebhookSecret(req('webhook-fixture'), WEBHOOK_SECRET)).toBe(false);
    expect(checkWebhookSecret(req(WEBHOOK_SECRET), WEBHOOK_SECRET)).toBe(true);
  });

  it('unset (undefined or empty): every update passes (text commands run as before)', () => {
    expect(checkWebhookSecret(req(), undefined)).toBe(true);
    expect(checkWebhookSecret(req('anything'), '')).toBe(true);
  });

  it('constant-time comparison gives plain equality', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('é', 'e')).toBe(false);
  });
});

describe('signature: the site verifier accepts what the relay sends', () => {
  it('reproduces the pinned vector', async () => {
    const body = decisionBody(TOKEN, 'dis', { user_id: OWNER, chat_id: OWNER, message_id: 1000 });
    expect(body).toBe(RELAY_VECTOR.body);
    expect(await signDecision(RELAY_VECTOR.secret, RELAY_VECTOR.timestamp, body)).toBe(RELAY_VECTOR.signature);
    expect(isDecisionBodyRelay(JSON.parse(body))).toBe(true);
  });

  it('a relayed decision passes verifyRelayRequest of microns-site with the same secret, and fails with another', async () => {
    const rec = recorder();
    await handleAgentCallback(query(), deps(rec.fetchFn));
    const [sent] = rec.decisions();
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('content-type')).toBe('application/json');
    expect(sent.headers.get(TIMESTAMP_HEADER)).toBe(RELAY_VECTOR.timestamp);
    expect(sent.headers.get(SIGNATURE_HEADER)).toBe(RELAY_VECTOR.signature);
    expect(sent.body).toBe(RELAY_VECTOR.body);
    const bytes = new TextEncoder().encode(sent.body);
    expect(await verifyRelayRequest(sent.headers, bytes, RELAY_VECTOR.secret, NOW, new SeenSignatures())).toEqual({ ok: true });
    expect(await verifyRelayRequest(sent.headers, bytes, 'other-value', NOW, new SeenSignatures())).toEqual({ ok: false, reason: 'signature' });
  });

  it('the relay regex equals the shared contract; every card code fits it and Telegram callback_data limits', () => {
    expect(CALLBACK_DATA_RE.source).toBe(SHARED_CALLBACK_DATA_RE.source);
    for (const [kind, table] of Object.entries(VERB_CODES)) {
      for (const code of Object.values(table)) {
        if (code === null) continue;
        const data = callbackData(TOKEN, code);
        expect(CALLBACK_DATA_RE.test(data), `${kind} ${code}`).toBe(true);
        expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe('handleAgentCallback', () => {
  it('without the webhook secret callbacks are ignored: no answer, no decision', async () => {
    const rec = recorder();
    expect(await handleAgentCallback(query(), deps(rec.fetchFn, { webhookSecret: undefined }))).toBe('ignored');
    expect(await handleAgentCallback(query(), deps(rec.fetchFn, { webhookSecret: '' }))).toBe('ignored');
    expect(rec.calls).toEqual([]);
  });

  it('origin: another chat, another sender, no message, or no owner configured -> "Not allowed", no decision', async () => {
    const cases: Array<[string, CallbackQuery, Partial<AgentCallbackDeps>]> = [
      ['other chat', query({ chat: 777 }), {}],
      ['other sender', query({ from: 777 }), {}],
      ['group chat of the owner', query({ chat: -100123 }), {}],
      ['no message (inline)', { ...query(), message: undefined }, {}],
      ['sender id as text', { ...query(), from: { id: String(OWNER) } }, {}],
      ['owner not configured', query(), { ownerChatId: undefined }],
    ];
    for (const [name, q, over] of cases) {
      const rec = recorder();
      expect(await handleAgentCallback(q, deps(rec.fetchFn, over)), name).toBe('not_allowed');
      expect(rec.decisions(), name).toEqual([]);
      expect(rec.answers(), name).toEqual([{ callback_query_id: 'cbq-1', text: ANSWERS.notAllowed }]);
    }
  });

  it('callback_data: anything but ap:<token>:<code> -> "Unknown button", no decision', async () => {
    for (const data of [`ap:${TOKEN.toLowerCase()}:dis`, `ap:${TOKEN}:DIS`, `ap:${TOKEN}:disms`, `ap:${TOKEN.slice(1)}:dis`, `ap:${TOKEN}1:dis`, `xx:${TOKEN}:dis`, `ap:${TOKEN}:dis:x`, `/leads`, 42, undefined]) {
      const rec = recorder();
      expect(await handleAgentCallback(query({ data }), deps(rec.fetchFn)), String(data)).toBe('unknown_button');
      expect(rec.decisions()).toEqual([]);
      expect(rec.answers()).toEqual([{ callback_query_id: 'cbq-1', text: ANSWERS.unknownButton }]);
    }
  });

  it('200 -> the label of the result (at most 200 characters); a 200 without a usable label -> "Done"', async () => {
    const ok = recorder();
    expect(await handleAgentCallback(query(), deps(ok.fetchFn))).toBe('decided');
    expect(ok.answers()).toEqual([{ callback_query_id: 'cbq-1', text: 'Dismissed' }]);
    expect(ok.calls[ok.calls.length - 1].url).toBe(`${TELEGRAM_BASE}/bot${BOT_TOKEN}/answerCallbackQuery`);

    const long = recorder(() => json(200, { label: 'x'.repeat(250) }));
    await handleAgentCallback(query(), deps(long.fetchFn));
    expect(long.answers()[0].text).toHaveLength(200);

    const notJson = recorder(() => new Response('<html>shell</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await handleAgentCallback(query(), deps(notJson.fetchFn));
    expect(notJson.answers()).toEqual([{ callback_query_id: 'cbq-1', text: ANSWERS.done }]);
  });

  it('answer text per status; failures as alerts; exactly one answer per callback', async () => {
    const table: Array<[number, string, boolean, string]> = [
      [409, ANSWERS.alreadyDecided, false, 'already_decided'],
      [422, ANSWERS.notPossible, false, 'not_possible'],
      [401, ANSWERS.notAuthorised, true, 'not_authorised'],
      [403, ANSWERS.notAuthorised, true, 'not_authorised'],
      [400, ANSWERS.failed, true, 'failed'],
      [404, ANSWERS.failed, true, 'failed'],
      [413, ANSWERS.failed, true, 'failed'],
      [429, ANSWERS.failed, true, 'failed'],
      [500, ANSWERS.failed, true, 'failed'],
      [502, ANSWERS.failed, true, 'failed'],
    ];
    for (const [status, text, alert, outcome] of table) {
      const logs: string[] = [];
      const rec = recorder(() => json(status, { error: 'x' }));
      expect(await handleAgentCallback(query(), deps(rec.fetchFn, {}, logs)), String(status)).toBe(outcome);
      expect(rec.decisions(), String(status)).toHaveLength(1);
      expect(rec.answers(), String(status)).toEqual([alert ? { callback_query_id: 'cbq-1', text, show_alert: true } : { callback_query_id: 'cbq-1', text }]);
      expect(answerFor(status)).toMatchObject({ text, alert });
      if (alert) expect(logs.join('\n')).toContain(`HTTP ${status}`);
      expectNoSecretsIn(logs);
    }
  });

  it('a network error or a timeout (8 s by default) -> "Could not record the decision" alert', async () => {
    const down = recorder(() => {
      throw new TypeError('fetch failed');
    });
    expect(await handleAgentCallback(query(), deps(down.fetchFn))).toBe('failed');
    expect(down.answers()).toEqual([{ callback_query_id: 'cbq-1', text: ANSWERS.failed, show_alert: true }]);

    const hang = recorder((_call, init) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const started = Date.now();
    expect(await handleAgentCallback(query(), deps(hang.fetchFn, { timeoutMs: 30 }))).toBe('failed');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(hang.answers()).toEqual([{ callback_query_id: 'cbq-1', text: ANSWERS.failed, show_alert: true }]);
  });

  it('relay configuration missing -> alert, no decision request; the log names the setting, never a value', async () => {
    for (const over of [{ approvalSecret: undefined }, { decisionUrl: '' }]) {
      const logs: string[] = [];
      const rec = recorder();
      expect(await handleAgentCallback(query(), deps(rec.fetchFn, over, logs))).toBe('failed');
      expect(rec.decisions()).toEqual([]);
      expect(rec.answers()).toEqual([{ callback_query_id: 'cbq-1', text: ANSWERS.failed, show_alert: true }]);
      expect(logs.join('\n')).toMatch(/AGENT_APPROVAL_SECRET|AGENT_DECISION_URL/);
      expectNoSecretsIn(logs);
    }
  });

  it('a failing answerCallbackQuery never throws; nothing secret is logged', async () => {
    const logs: string[] = [];
    const calls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (String(input) === DECISION_URL) return json(200, { label: 'Dismissed' });
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(handleAgentCallback(query(), deps(fetchFn, {}, logs))).resolves.toBe('decided');
    expect(calls).toHaveLength(2);
    expectNoSecretsIn(logs, [DECISION_URL]);
  });
});

// ----- the function's index.ts: the header rule and the callback branch -----

interface EdgeGlobals {
  Deno?: { env: { get(name: string): string | undefined } };
  __edgeServeHandler?: (req: Request) => Promise<Response>;
}

async function loadFunction(env: Record<string, string>, fetchFn: typeof fetch): Promise<(req: Request) => Promise<Response>> {
  const g = globalThis as EdgeGlobals;
  vi.resetModules();
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] } });
  vi.stubGlobal('fetch', fetchFn);
  g.__edgeServeHandler = undefined;
  await import('../../supabase/functions/telegram-leads-bot/index.ts');
  const handler = g.__edgeServeHandler;
  if (!handler) throw new Error('index.ts did not call serve()');
  return handler;
}

const BASE_ENV = {
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-fixture-value',
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_CHAT_ID: String(OWNER),
};
const FULL_ENV = { ...BASE_ENV, TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET, AGENT_APPROVAL_SECRET: RELAY_VECTOR.secret, AGENT_DECISION_URL: DECISION_URL };

function update(body: unknown, secret?: string): Request {
  return new Request('https://fn.example.test/functions/v1/telegram-leads-bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret === undefined ? {} : { [WEBHOOK_SECRET_HEADER]: secret }) },
    body: JSON.stringify(body),
  });
}

const callbackUpdate = { update_id: 1, callback_query: query() };
const textUpdate = { update_id: 2, message: { message_id: 5, chat: { id: OWNER }, from: { id: OWNER }, text: '/leads' } };

describe('index.ts webhook', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('secret set: an update without or with a wrong header -> 401, nothing processed', async () => {
    const rec = recorder();
    const handler = await loadFunction(FULL_ENV, rec.fetchFn);
    for (const header of [undefined, 'wrong-value']) {
      const res = await handler(update(callbackUpdate, header));
      expect(res.status).toBe(401);
      const text = await handler(update(textUpdate, header));
      expect(text.status).toBe(401);
    }
    expect(rec.calls).toEqual([]);
  });

  it('secret set and sent: a callback is relayed and answered once; Telegram gets 200 even when the decision fails', async () => {
    for (const status of [200, 409, 500]) {
      const rec = recorder(() => json(status, status === 200 ? { label: 'Dismissed' } : { error: 'x' }));
      const handler = await loadFunction(FULL_ENV, rec.fetchFn);
      const res = await handler(update(callbackUpdate, WEBHOOK_SECRET));
      expect([res.status, await res.text()], String(status)).toEqual([200, 'OK']);
      expect(rec.decisions(), String(status)).toHaveLength(1);
      expect(rec.decisions()[0].headers.get(SIGNATURE_HEADER)).toBe(RELAY_VECTOR.signature);
      expect(rec.answers(), String(status)).toHaveLength(1);
      // The text-command path never ran for a callback.
      expect(rec.calls.some((c) => c.url.endsWith('/sendMessage'))).toBe(false);
    }
  });

  it('secret set and sent: text commands still run (sendMessage to the chat)', async () => {
    const rec = recorder();
    const handler = await loadFunction(FULL_ENV, rec.fetchFn);
    const res = await handler(update(textUpdate, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    const sends = rec.calls.filter((c) => c.url.endsWith('/sendMessage'));
    expect(sends).toHaveLength(1);
    expect(JSON.parse(sends[0].body).chat_id).toBe(OWNER);
  });

  it('secret unset: text commands run as before, callbacks are ignored with 200 and nothing is sent', async () => {
    const rec = recorder();
    const handler = await loadFunction({ ...BASE_ENV, AGENT_APPROVAL_SECRET: RELAY_VECTOR.secret, AGENT_DECISION_URL: DECISION_URL }, rec.fetchFn);
    const cb = await handler(update(callbackUpdate));
    expect([cb.status, await cb.text()]).toEqual([200, 'OK']);
    expect(rec.calls).toEqual([]);
    const text = await handler(update(textUpdate));
    expect(text.status).toBe(200);
    expect(rec.calls.filter((c) => c.url.endsWith('/sendMessage'))).toHaveLength(1);
  });

  it('a callback from another chat is answered "Not allowed" and still answered 200 to Telegram', async () => {
    const rec = recorder();
    const handler = await loadFunction(FULL_ENV, rec.fetchFn);
    const res = await handler(update({ update_id: 3, callback_query: query({ chat: 999, from: 999 }) }, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(rec.decisions()).toEqual([]);
    expect(rec.answers()).toEqual([{ callback_query_id: 'cbq-1', text: ANSWERS.notAllowed }]);
  });
});
