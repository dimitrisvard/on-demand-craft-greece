import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TurnstileModule = typeof import('../../src/auth/turnstile');

// A fresh module per test, so the once-per-isolate log line can be observed.
let mod: TurnstileModule;
beforeEach(async () => {
  vi.resetModules();
  mod = await import('../../src/auth/turnstile');
});
afterEach(() => {
  vi.restoreAllMocks();
});

const REAL_SECRET = ['real', 'turnstile', 'secret', 'test', 'value'].join('-');
const NOW = Date.parse('2026-10-04T12:00:00.000Z');
// The fixed answer of Cloudflare's test secrets (phase2 cfdocs, turnstile testing).
const TEST_KEY_ANSWER = {
  success: true,
  challenge_ts: '2022-02-28T15:14:30.096Z',
  hostname: 'localhost',
  'error-codes': [],
  action: 'test',
  cdata: 'test-data',
};

interface Call { url: string; body: URLSearchParams }

function siteverify(answer: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function input(o: Partial<Parameters<TurnstileModule['verifyTurnstile']>[0]> = {}) {
  return {
    token: 'token-from-widget',
    secret: REAL_SECRET,
    remoteIp: '203.0.113.7',
    expectedActions: ['contact', 'quote'],
    hostnameAllowed: (h: string) => h === 'www.micronshub.eu',
    allowTestSecret: false,
    nowMs: () => NOW,
    ...o,
  };
}

const goodAnswer = (o: Record<string, unknown> = {}) => ({
  success: true,
  action: 'contact',
  hostname: 'www.micronshub.eu',
  challenge_ts: new Date(NOW - 60_000).toISOString(),
  ...o,
});

describe('verifyTurnstile with a real secret', () => {
  it('accepts success with an expected action, an allowed hostname and a fresh token', async () => {
    const { calls, fetchImpl } = siteverify(goodAnswer());
    expect(await mod.verifyTurnstile(input({ fetchImpl }))).toEqual({ ok: true, testMode: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(mod.SITEVERIFY_URL);
    expect(calls[0].body.get('secret')).toBe(REAL_SECRET);
    expect(calls[0].body.get('response')).toBe('token-from-widget');
    expect(calls[0].body.get('remoteip')).toBe('203.0.113.7');
    expect(calls[0].body.get('idempotency_key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects success: false', async () => {
    const { fetchImpl } = siteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await mod.verifyTurnstile(input({ fetchImpl }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
  });

  it('rejects a wrong action', async () => {
    const { fetchImpl } = siteverify(goodAnswer({ action: 'login' }));
    expect(await mod.verifyTurnstile(input({ fetchImpl }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
  });

  it('rejects a wrong hostname', async () => {
    const { fetchImpl } = siteverify(goodAnswer({ hostname: 'evil.example' }));
    expect(await mod.verifyTurnstile(input({ fetchImpl }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
  });

  it('rejects a challenge older than 300 s and accepts exactly 300 s', async () => {
    const stale = siteverify(goodAnswer({ challenge_ts: new Date(NOW - 301_000).toISOString() }));
    expect(await mod.verifyTurnstile(input({ fetchImpl: stale.fetchImpl }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
    const edge = siteverify(goodAnswer({ challenge_ts: new Date(NOW - 300_000).toISOString() }));
    expect((await mod.verifyTurnstile(input({ fetchImpl: edge.fetchImpl }))).ok).toBe(true);
  });

  it('accepts a challenge_ts at most 60 s in the future (clock skew) and rejects one further ahead', async () => {
    const ahead = siteverify(goodAnswer({ challenge_ts: new Date(NOW + 120_000).toISOString() }));
    expect(await mod.verifyTurnstile(input({ fetchImpl: ahead.fetchImpl }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
    const edge = siteverify(goodAnswer({ challenge_ts: new Date(NOW + 60_000).toISOString() }));
    expect(await mod.verifyTurnstile(input({ fetchImpl: edge.fetchImpl }))).toEqual({ ok: true, testMode: false });
  });

  it('rejects a missing or unparsable challenge_ts', async () => {
    for (const challenge_ts of [undefined, 'not a date', 1_700_000_000]) {
      const { fetchImpl } = siteverify(goodAnswer({ challenge_ts }));
      expect(await mod.verifyTurnstile(input({ fetchImpl }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
    }
  });

  it('answers 503 when siteverify answers 5xx', async () => {
    const { fetchImpl } = siteverify({ error: 'down' }, 502);
    expect(await mod.verifyTurnstile(input({ fetchImpl }))).toEqual({ ok: false, status: 503, code: 'turnstile_unavailable' });
  });

  it('retries once after a network error with the same idempotency key, then answers 503', async () => {
    const keys: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      keys.push(new URLSearchParams(String(init.body)).get('idempotency_key')!);
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await mod.verifyTurnstile(input({ fetchImpl }))).toEqual({ ok: false, status: 503, code: 'turnstile_unavailable' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('answers 403 without calling siteverify when the token is missing', async () => {
    const { calls, fetchImpl } = siteverify(goodAnswer());
    expect(await mod.verifyTurnstile(input({ token: null, fetchImpl }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
    expect(calls).toHaveLength(0);
  });

  it('rejects the fixed test-key answer when the secret is real', async () => {
    const { fetchImpl } = siteverify(TEST_KEY_ANSWER);
    expect(await mod.verifyTurnstile(input({ fetchImpl, allowTestSecret: true }))).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
  });
});

describe('verifyTurnstile with a Cloudflare test secret', () => {
  const TEST_SECRET = '1x0000000000000000000000000000000AA';

  it('accepts the documented test answer on a preview host (success only) and logs test-key mode once', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { fetchImpl } = siteverify(TEST_KEY_ANSWER);
    const opts = input({ secret: TEST_SECRET, token: 'XXXX.DUMMY.TOKEN.XXXX', allowTestSecret: true, fetchImpl });
    expect(await mod.verifyTurnstile(opts)).toEqual({ ok: true, testMode: true });
    expect(await mod.verifyTurnstile(opts)).toEqual({ ok: true, testMode: true });
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('turnstile test-key mode'));
    expect(lines).toEqual(['[microns-site] turnstile test-key mode']);
  });

  it('still requires success in test-key mode (2x secret answer)', async () => {
    const { fetchImpl } = siteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    const opts = input({ secret: '2x0000000000000000000000000000000AA', allowTestSecret: true, fetchImpl });
    expect(await mod.verifyTurnstile(opts)).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
  });

  it('still requires a token in test-key mode', async () => {
    const { calls, fetchImpl } = siteverify(TEST_KEY_ANSWER);
    const opts = input({ secret: TEST_SECRET, token: null, allowTestSecret: true, fetchImpl });
    expect(await mod.verifyTurnstile(opts)).toEqual({ ok: false, status: 403, code: 'turnstile_failed' });
    expect(calls).toHaveLength(0);
  });

  it('answers 503 without calling siteverify on a non-preview host, with an error log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { calls, fetchImpl } = siteverify(TEST_KEY_ANSWER);
    const opts = input({ secret: TEST_SECRET, token: 'XXXX.DUMMY.TOKEN.XXXX', allowTestSecret: false, fetchImpl });
    expect(await mod.verifyTurnstile(opts)).toEqual({ ok: false, status: 503, code: 'turnstile_unavailable' });
    expect(calls).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/^\[microns-site\] /);
  });
});

describe('isTurnstileTestSecret', () => {
  it('matches the three documented secrets exactly', () => {
    for (const s of mod.TURNSTILE_TEST_SECRETS) expect(mod.isTurnstileTestSecret(s)).toBe(true);
    expect(mod.TURNSTILE_TEST_SECRETS).toHaveLength(3);
  });

  it.each([
    ' 1x0000000000000000000000000000000AA',
    '1x0000000000000000000000000000000AA ',
    '1x0000000000000000000000000000000aa',
    '1x0000000000000000000000000000000AAA',
    '4x0000000000000000000000000000000AA',
    '1x00000000000000000000AA',
    '',
  ])('does not match %j', (s) => {
    expect(mod.isTurnstileTestSecret(s)).toBe(false);
  });
});
