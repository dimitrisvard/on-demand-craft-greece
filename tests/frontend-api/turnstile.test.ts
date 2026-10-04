import { BROWSER_UA, jsonResponse, setUserAgent, stubFetch } from './helpers';
import type { TurnstileApi, TurnstileRenderOptions } from '@/utils/turnstile';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TEST_SITE_KEY = '1x00000000000000000000AA'; // Cloudflare's documented always-pass test site key

/** Fresh copy of the module (the script loader keeps per-page state). */
async function freshTurnstile() {
  vi.resetModules();
  return import('@/utils/turnstile');
}

function scripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script')).filter((s) => s.src === SCRIPT);
}

/** A stand-in for window.turnstile with one widget whose token the test controls. */
function fakeTurnstileApi(log?: string[]) {
  let current: string | null = null;
  let options: TurnstileRenderOptions | null = null;
  const api = {
    render: vi.fn((_el: HTMLElement, o: TurnstileRenderOptions) => {
      options = o;
      return 'w1';
    }),
    getResponse: vi.fn(() => {
      log?.push(`getResponse ${current}`);
      return current ?? undefined;
    }),
    reset: vi.fn(() => {
      log?.push('reset');
      current = null;
    }),
    remove: vi.fn(),
  } satisfies TurnstileApi;
  return {
    api,
    /** The widget produced a token (fires the render callback). */
    issue(token: string) {
      current = token;
      options?.callback?.(token);
    },
    fail() {
      options?.['error-callback']?.();
    },
    options: () => options,
  };
}

beforeEach(() => {
  for (const s of scripts()) s.remove();
  delete (window as { turnstile?: unknown }).turnstile;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('site key', () => {
  it('is read from the build variable; empty means none', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', TEST_SITE_KEY);
    expect((await freshTurnstile()).turnstileSiteKey()).toBe(TEST_SITE_KEY);
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect((await freshTurnstile()).turnstileSiteKey()).toBeNull();
  });
});

describe('script loader', () => {
  it('never injects the script under a jsdom user agent', async () => {
    const t = await freshTurnstile();
    expect(navigator.userAgent).toContain('jsdom');
    expect(await t.loadTurnstile()).toBeNull();
    expect(scripts()).toHaveLength(0);
  });

  it('injects the explicit-render script once, however often it is asked', async () => {
    setUserAgent(BROWSER_UA);
    const t = await freshTurnstile();
    const first = t.loadTurnstile();
    const second = t.loadTurnstile();
    expect(second).toBe(first);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].async).toBe(true);

    const fake = fakeTurnstileApi();
    window.turnstile = fake.api;
    scripts()[0].dispatchEvent(new Event('load'));
    expect(await first).toBe(fake.api);
    expect(await t.loadTurnstile()).toBe(fake.api);
    expect(scripts()).toHaveLength(1);
  });

  it('resolves null when the script fails, and a later call may try again', async () => {
    setUserAgent(BROWSER_UA);
    const t = await freshTurnstile();
    const failed = t.loadTurnstile();
    scripts()[0].dispatchEvent(new Event('error'));
    expect(await failed).toBeNull();
    expect(scripts()).toHaveLength(0);
    void t.loadTurnstile();
    expect(scripts()).toHaveLength(1);
  });
});

describe('TurnstileController', () => {
  it('without a site key: no script, no widget, no token', async () => {
    const t = await freshTurnstile();
    const load = vi.fn(async () => fakeTurnstileApi().api);
    const c = new t.TurnstileController('contact', null, load);
    expect(c.enabled).toBe(false);
    c.attach(document.createElement('div'));
    await c.activate();
    expect(await c.getToken()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads nothing until activated (interaction or submit)', async () => {
    const t = await freshTurnstile();
    const fake = fakeTurnstileApi();
    const load = vi.fn(async () => fake.api);
    const c = new t.TurnstileController('quote', TEST_SITE_KEY, load);
    c.attach(document.createElement('div'));
    expect(load).not.toHaveBeenCalled();
    await c.activate();
    await c.activate();
    expect(load).toHaveBeenCalledTimes(1);
    expect(fake.api.render).toHaveBeenCalledTimes(1);
    expect(fake.options()).toMatchObject({ sitekey: TEST_SITE_KEY, action: 'quote', 'refresh-expired': 'auto' });
  });

  it('reads the token with getResponse at call time and never hands the same token out twice', async () => {
    const log: string[] = [];
    const t = await freshTurnstile();
    const fake = fakeTurnstileApi(log);
    const c = new t.TurnstileController('contact', TEST_SITE_KEY, async () => fake.api);
    c.attach(document.createElement('div'));
    await c.activate();
    fake.issue('token-A');
    expect(await c.getToken()).toBe('token-A');
    expect(log).toEqual(['getResponse token-A']);

    // Second request: token-A is spent, so the widget is reset and a fresh token awaited.
    const next = c.getToken();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.api.reset).toHaveBeenCalledTimes(1);
    fake.issue('token-B');
    expect(await next).toBe('token-B');
  });

  it('starts loading at submit when there was no interaction, and waits for the first token', async () => {
    const t = await freshTurnstile();
    const fake = fakeTurnstileApi();
    const c = new t.TurnstileController('contact', TEST_SITE_KEY, async () => fake.api);
    c.attach(document.createElement('div'));
    const pending = c.getToken();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.api.render).toHaveBeenCalledTimes(1);
    fake.issue('token-1');
    expect(await pending).toBe('token-1');
  });

  it('gives up after 30 s without a token', async () => {
    vi.useFakeTimers();
    const t = await freshTurnstile();
    const fake = fakeTurnstileApi();
    const c = new t.TurnstileController('contact', TEST_SITE_KEY, async () => fake.api);
    c.attach(document.createElement('div'));
    let result: string | null | undefined;
    void c.getToken().then((v) => {
      result = v;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
  });

  it('returns null at once on a widget error or when the script is blocked', async () => {
    const t = await freshTurnstile();
    const fake = fakeTurnstileApi();
    const c = new t.TurnstileController('contact', TEST_SITE_KEY, async () => fake.api);
    c.attach(document.createElement('div'));
    await c.activate();
    // Error while a request waits for its token.
    const pending = c.getToken();
    await new Promise((r) => setTimeout(r, 0));
    fake.fail();
    expect(await pending).toBeNull();
    // Error reported before the request: no wait at all.
    expect(await c.getToken()).toBeNull();
    // A later token clears the error state.
    fake.issue('token-after-retry');
    expect(await c.getToken()).toBe('token-after-retry');

    const blocked = new t.TurnstileController('contact', TEST_SITE_KEY, async () => null);
    blocked.attach(document.createElement('div'));
    expect(await blocked.getToken()).toBeNull();
  });
});

describe('fetchWithTurnstile', () => {
  it('sends the token in X-Turnstile-Token, obtained right before the request', async () => {
    const t = await freshTurnstile();
    const log: string[] = [];
    const { calls } = stubFetch(() => jsonResponse(200, { success: true }), log);
    const getToken = vi.fn(async () => {
      log.push('getToken');
      return 'tok-1';
    });
    await t.fetchWithTurnstile('/api/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, getToken);
    expect(log).toEqual(['getToken', 'fetch /api/emails']);
    expect(calls[0].headers.get('x-turnstile-token')).toBe('tok-1');
    expect(calls[0].headers.get('content-type')).toBe('application/json');
  });

  it('sends the request without the header when there is no token', async () => {
    const t = await freshTurnstile();
    const { calls } = stubFetch(() => jsonResponse(200, {}));
    await t.fetchWithTurnstile('/api/emails', { method: 'POST', body: '{}' }, async () => null);
    await t.fetchWithTurnstile('/api/emails', { method: 'POST', body: '{}' });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => !c.headers.has('x-turnstile-token'))).toBe(true);
  });

  it('retries once with a fresh token after 403 turnstile_failed', async () => {
    const t = await freshTurnstile();
    const { calls } = stubFetch((_c, i) => (i === 0 ? jsonResponse(403, { error: 'turnstile_failed' }) : jsonResponse(200, { success: true })));
    const tokens = ['expired', 'fresh'];
    const res = await t.fetchWithTurnstile('/api/emails', { method: 'POST', body: '{}' }, async () => tokens.shift() ?? null);
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.headers.get('x-turnstile-token'))).toEqual(['expired', 'fresh']);
  });

  it('retries only once, and never for other 403 answers', async () => {
    const t = await freshTurnstile();
    const twice = stubFetch(() => jsonResponse(403, { error: 'turnstile_failed' }));
    expect((await t.fetchWithTurnstile('/api/emails', { method: 'POST' }, async () => 'tok')).status).toBe(403);
    expect(twice.calls).toHaveLength(2);

    const other = stubFetch(() => jsonResponse(403, { error: 'forbidden' }));
    await t.fetchWithTurnstile('/api/emails', { method: 'POST' }, async () => 'tok');
    expect(other.calls).toHaveLength(1);
  });

  it('does not retry when no fresh token arrives', async () => {
    const t = await freshTurnstile();
    const { calls } = stubFetch(() => jsonResponse(403, { error: 'turnstile_failed' }));
    const tokens: Array<string | null> = ['expired', null];
    const res = await t.fetchWithTurnstile('/api/emails', { method: 'POST' }, async () => tokens.shift() ?? null);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(1);
  });
});

describe('sendRFQEmails (quote form mail)', () => {
  const data = { customerName: 'A B', customerEmail: 'a@example.com', companyName: 'C', rfqNumber: 'RFQ-20261004-1', phone: '1' };

  it('reads the token right before the request and sends it as a header', async () => {
    const { sendRFQEmails } = await import('@/utils/emailService');
    const log: string[] = [];
    const { calls } = stubFetch(() => jsonResponse(200, { success: true }), log);
    const result = await sendRFQEmails(data, async () => {
      log.push('getToken');
      return 'tok';
    });
    expect(result).toEqual({ confirmationSent: true, notificationSent: true });
    expect(log).toEqual(['getToken', 'fetch /api/emails']);
    expect(calls[0].headers.get('x-turnstile-token')).toBe('tok');
    const body = JSON.parse(calls[0].body ?? '{}') as Record<string, unknown>;
    expect(body.action).toBe('email');
    expect(Object.values(body).every((v) => typeof v === 'string')).toBe(true);
  });

  it('still sends the request without a token', async () => {
    const { sendRFQEmails } = await import('@/utils/emailService');
    const { calls } = stubFetch(() => jsonResponse(200, { success: true }));
    expect((await sendRFQEmails(data)).confirmationSent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.has('x-turnstile-token')).toBe(false);
  });

  it('expired token: 403 turnstile_failed -> widget reset -> one retry -> 200', async () => {
    const t = await freshTurnstile();
    const { sendRFQEmails } = await import('@/utils/emailService');
    const log: string[] = [];
    const fake = fakeTurnstileApi(log);
    const c = new t.TurnstileController('quote', TEST_SITE_KEY, async () => fake.api);
    c.attach(document.createElement('div'));
    await c.activate();
    fake.issue('stale-token');

    const { calls } = stubFetch(
      (_c, i) => (i === 0 ? jsonResponse(403, { error: 'turnstile_failed' }) : jsonResponse(200, { success: true })),
      log,
    );
    // The widget produces a new token shortly after it is reset.
    fake.api.reset.mockImplementation(() => {
      log.push('reset');
      setTimeout(() => fake.issue('fresh-token'), 10);
    });

    const result = await sendRFQEmails(data, () => c.getToken());
    expect(result.confirmationSent).toBe(true);
    expect(calls.map((x) => x.headers.get('x-turnstile-token'))).toEqual(['stale-token', 'fresh-token']);
    expect(log.indexOf('reset')).toBeGreaterThan(log.indexOf('fetch /api/emails'));
    expect(log.lastIndexOf('fetch /api/emails')).toBeGreaterThan(log.indexOf('reset'));
  });

  it('reports failure as before when the server keeps refusing', async () => {
    const { sendRFQEmails } = await import('@/utils/emailService');
    stubFetch(() => jsonResponse(403, { error: 'turnstile_failed' }));
    const tokens = ['a', 'b'];
    expect(await sendRFQEmails(data, async () => tokens.shift() ?? null)).toEqual({ confirmationSent: false, notificationSent: false });
  });
});
