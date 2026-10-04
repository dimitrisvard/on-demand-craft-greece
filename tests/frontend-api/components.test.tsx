import { createElement, createRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabaseMock } from './mocks/supabase-client';
import {
  BROWSER_UA,
  act,
  captureAnchorClicks,
  fakeWindow,
  flush,
  jsonResponse,
  render,
  setUserAgent,
  stubFetch,
  stubObjectUrls,
  stubWindowOpen,
  typeInto,
  type Mounted,
} from './helpers';
import type { TurnstileApi, TurnstileRenderOptions } from '@/utils/turnstile';

const sonner = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: sonner }));

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TEST_SITE_KEY = '1x00000000000000000000AA';

let mounted: Mounted | null = null;
let objectUrls: ReturnType<typeof stubObjectUrls>;

function scripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script')).filter((s) => s.src === SCRIPT);
}

function button(container: HTMLElement, text: string | RegExp): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text || b.title === text : text.test(b.textContent ?? ''),
  );
  if (!found) throw new Error(`no button ${String(text)}`);
  return found as HTMLButtonElement;
}

async function waitFor(check: () => void, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() > end) throw err;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }
}

function fakeTurnstile(log: string[]) {
  let current: string | null = null;
  let options: TurnstileRenderOptions | null = null;
  const api = {
    render: vi.fn((_el: HTMLElement, o: TurnstileRenderOptions) => {
      options = o;
      log.push(`render ${o.action}`);
      return 'w1';
    }),
    getResponse: vi.fn(() => {
      log.push('getResponse');
      return current ?? undefined;
    }),
    reset: vi.fn(() => {
      log.push('reset');
      current = null;
    }),
    remove: vi.fn(),
  } satisfies TurnstileApi;
  return {
    api,
    issue(token: string) {
      current = token;
      options?.callback?.(token);
    },
  };
}

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  supabaseMock.reset();
  sonner.success.mockReset();
  sonner.error.mockReset();
  objectUrls = stubObjectUrls();
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  for (const s of scripts()) s.remove();
  delete (window as { turnstile?: unknown }).turnstile;
  vi.resetModules();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  objectUrls.restore();
});

describe('TurnstileWidget', () => {
  async function mountWidget() {
    const { default: TurnstileWidget } = await import('@/components/security/TurnstileWidget');
    const ref = createRef<{ getToken(): Promise<string | null>; reset(): void }>();
    mounted = await render(
      createElement(
        'form',
        null,
        createElement('input', { name: 'name' }),
        createElement(TurnstileWidget, { ref, action: 'contact' }),
      ),
    );
    return { ref, input: mounted.container.querySelector('input') as HTMLInputElement };
  }

  it('renders nothing and loads nothing without a site key', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    setUserAgent(BROWSER_UA);
    const { ref, input } = await mountWidget();
    expect(mounted?.container.querySelector('[data-turnstile-slot]')).toBeNull();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(scripts()).toHaveLength(0);
    expect(await ref.current?.getToken()).toBeNull();
  });

  it('injects the script only after the first interaction inside the form, once', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', TEST_SITE_KEY);
    setUserAgent(BROWSER_UA);
    const { input } = await mountWidget();
    expect(mounted?.container.querySelector('[data-turnstile-slot="contact"]')).not.toBeNull();
    expect(scripts()).toHaveLength(0);

    // Interaction outside the form does not count.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(scripts()).toHaveLength(0);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(scripts()).toHaveLength(1);
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(scripts()).toHaveLength(1);

    const log: string[] = [];
    const fake = fakeTurnstile(log);
    window.turnstile = fake.api;
    scripts()[0].dispatchEvent(new Event('load'));
    await flush();
    expect(fake.api.render).toHaveBeenCalledTimes(1);
    expect(fake.api.render.mock.calls[0][0]).toBe(mounted?.container.querySelector('[data-turnstile-slot="contact"]'));
  });

  it('never injects the script under a jsdom user agent (build prerender)', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', TEST_SITE_KEY);
    const { ref, input } = await mountWidget();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(await ref.current?.getToken()).toBeNull();
    expect(scripts()).toHaveLength(0);
  });
});

describe('ContactForm', () => {
  async function mountAndFill() {
    const { default: ContactForm } = await import('@/components/contact/ContactForm');
    mounted = await render(createElement(ContactForm));
    const c = mounted.container;
    await act(async () => {
      (c.querySelector('#name') as HTMLInputElement).focus();
      typeInto(c.querySelector('#name') as HTMLInputElement, 'Ada Lovelace');
      typeInto(c.querySelector('#email') as HTMLInputElement, 'ada@example.com');
      typeInto(c.querySelector('#subject') as HTMLSelectElement, 'technical');
      typeInto(c.querySelector('#message') as HTMLTextAreaElement, 'A long enough technical question about tolerances.');
    });
    return c;
  }

  it('submits without a token header when the build has no site key', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    const { calls } = stubFetch(() => jsonResponse(200, { success: true }));
    const c = await mountAndFill();
    await act(async () => {
      (c.querySelector('form') as HTMLFormElement).requestSubmit();
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe('/api/emails');
    expect(calls[0].headers.has('x-turnstile-token')).toBe(false);
    expect(JSON.parse(calls[0].body ?? '{}')).toMatchObject({ action: 'email', email: 'ada@example.com' });
  });

  it('reads the token right before the request, sends it, and resets the widget afterwards', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', TEST_SITE_KEY);
    setUserAgent(BROWSER_UA);
    const log: string[] = [];
    const fake = fakeTurnstile(log);
    window.turnstile = fake.api;
    const { calls } = stubFetch(() => jsonResponse(200, { success: true }), log);
    const c = await mountAndFill();
    // Focusing the first field rendered the widget; it then produced a token.
    await waitFor(() => expect(fake.api.render).toHaveBeenCalledTimes(1));
    act(() => fake.issue('contact-token'));
    log.length = 0;

    await act(async () => {
      (c.querySelector('form') as HTMLFormElement).requestSubmit();
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].headers.get('x-turnstile-token')).toBe('contact-token');
    expect(log.slice(0, 2)).toEqual(['getResponse', 'fetch /api/emails']);
    await waitFor(() => expect(log).toContain('reset'));
  });
});

describe('InventoryLayout', () => {
  it('shows "Sign in again" with a /login link after a 401 from /api/*', async () => {
    const { default: InventoryLayout } = await import('@/components/inventory/InventoryLayout');
    const { fetchWithAuth } = await import('@/utils/apiAuth');
    mounted = await render(
      createElement(MemoryRouter, { initialEntries: ['/dashboard/inventory/scan'] }, createElement(InventoryLayout, null, 'content')),
    );
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull();
    stubFetch(() => jsonResponse(401, { error: 'unauthorized' }));
    await act(async () => {
      await fetchWithAuth('/api/notifications?action=inv-alerts');
    });
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Sign in again');
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/login?returnTo=%2Fdashboard%2Finventory%2Fscan');
  });
});

describe('QRScanner label button', () => {
  it('opens the window inside the click, then fetches the label with the session token', async () => {
    supabaseMock.accessToken = 'staff-token';
    const log: string[] = [];
    const w = fakeWindow();
    stubWindowOpen(w, log);
    const { calls } = stubFetch((call) => {
      if (call.url.includes('inv-stock-scan')) {
        return jsonResponse(200, { data: { id: 'stock-7', qr_code: 'QR-7', status: 'used', material: { name: 'S235' } } });
      }
      return new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } });
    }, log);
    const { default: QRScanner } = await import('@/pages/inventory/QRScanner');
    mounted = await render(createElement(MemoryRouter, null, createElement(QRScanner)));
    const c = mounted.container;
    await act(async () => {
      typeInto(c.querySelector('input[placeholder="Enter QR code manually..."]') as HTMLInputElement, 'QR-7');
    });
    await act(async () => {
      button(c, /Look ?up|Find|Search/i).click();
    });
    await waitFor(() => expect(c.textContent).toContain('Print Label'));
    expect(calls[0].headers.get('authorization')).toBe('Bearer staff-token');
    expect(c.querySelector('a[href*="inv-label"]')).toBeNull();

    log.length = 0;
    act(() => {
      button(c, 'Print Label').click();
    });
    expect(log).toEqual(['open ']);
    await waitFor(() => expect(w.location.href).toMatch(/^blob:/));
    expect(log[1]).toBe('fetch /api/notifications?action=inv-label&stockItemId=stock-7');
    const labelCall = calls.find((x) => x.url.includes('inv-label'));
    expect(labelCall?.headers.get('authorization')).toBe('Bearer staff-token');
  });
});

describe('SenderAccountsManager (Gmail connect)', () => {
  async function mountManager() {
    supabaseMock.tableRows = [
      {
        id: 'acc-1',
        email: 'sales@example.com',
        display_name: 'Sales',
        provider: 'google_workspace',
        provider_config: {},
        daily_limit: 100,
        emails_sent_today: 0,
        is_active: true,
        warmup_enabled: false,
        warmup_current_limit: 0,
        warmup_daily_increment: 0,
      },
    ];
    const { default: SenderAccountsManager } = await import('@/components/dashboard/marketing/SenderAccountsManager');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mounted = await render(createElement(QueryClientProvider, { client }, createElement(SenderAccountsManager)));
    await waitFor(() => expect(mounted?.container.querySelector('button[title="Connect Google"]')).not.toBeNull());
    return mounted.container;
  }

  it('accepts OAuth result messages only from trusted origins', async () => {
    await mountManager();
    const data = { type: 'google-oauth-success', email: 'sales@example.com' };
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: 'https://evil.example' }));
    });
    expect(sonner.success).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin }));
    });
    expect(sonner.success).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'google-oauth-error', error: 'x' }, origin: 'https://www.micronshub.eu' }));
    });
    expect(sonner.error).toHaveBeenCalledTimes(1);
  });

  it('opens the popup in the click, asks for JSON with the session token, then navigates it', async () => {
    supabaseMock.accessToken = 'admin-token';
    const c = await mountManager();
    const log: string[] = [];
    const popup = fakeWindow();
    stubWindowOpen(popup, log);
    const google = 'https://accounts.google.com/o/oauth2/v2/auth?state=s';
    const { calls } = stubFetch(() => jsonResponse(200, { url: google }), log);
    act(() => {
      (c.querySelector('button[title="Connect Google"]') as HTMLButtonElement).click();
    });
    expect(log).toEqual(['open about:blank']);
    await waitFor(() => expect(popup.location.href).toBe(google));
    expect(calls[0].url).toBe('/api/marketing?action=google-auth&step=authorize&account_id=acc-1');
    expect(calls[0].headers.get('accept')).toBe('application/json');
    expect(calls[0].headers.get('authorization')).toBe('Bearer admin-token');
    expect(calls[0].redirect).toBe('manual');
  });

  it('falls back to the authorize URL in the popup when the answer is not JSON', async () => {
    const c = await mountManager();
    const popup = fakeWindow();
    stubWindowOpen(popup);
    stubFetch(() => new Response('<html>blocked</html>', { status: 429, headers: { 'content-type': 'text/html' } }));
    act(() => {
      (c.querySelector('button[title="Connect Google"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(popup.location.href).toBe('/api/marketing?action=google-auth&step=authorize&account_id=acc-1'));
  });
});

describe('RfqFileDownload', () => {
  const FILE = 'RFQ-20261004-1/part-A/bracket.step';

  async function mountDownload() {
    const { default: RfqFileDownload } = await import('@/components/rfq/RfqFileDownload');
    mounted = await render(createElement(RfqFileDownload, { fileName: 'bracket.step', filePath: FILE }));
    return mounted.container;
  }

  it('finds the file through /api/s3 list and opens a presigned download from a window opened in the click', async () => {
    supabaseMock.accessToken = 'staff-token';
    const log: string[] = [];
    const w = fakeWindow();
    stubWindowOpen(w, log);
    const presigned = 'https://bucket.example/rfq/RFQ-20261004-1/part-A/bracket.step?X-Amz-Signature=x';
    const { calls } = stubFetch((call) => {
      if (call.url === '/api/s3?action=list') return jsonResponse(200, { objects: [{ key: FILE, url: 'u', lastModified: 'd' }] });
      return jsonResponse(200, { url: presigned });
    }, log);
    const c = await mountDownload();
    await waitFor(() => expect(button(c, 'Download').disabled).toBe(false));
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ prefix: 'RFQ-20261004-1/part-A/', scope: 'rfq' });
    expect(calls[0].headers.get('authorization')).toBe('Bearer staff-token');

    log.length = 0;
    act(() => {
      button(c, 'Download').click();
    });
    expect(log).toEqual(['open ']);
    await waitFor(() => expect(w.location.href).toBe(presigned));
    expect(log[1]).toBe('fetch /api/s3?action=presign-download');
    const presign = calls.find((x) => x.url === '/api/s3?action=presign-download');
    expect(JSON.parse(presign?.body ?? '{}')).toEqual({ key: FILE, scope: 'rfq' });
    expect(presign?.headers.get('authorization')).toBe('Bearer staff-token');
  });

  it('keeps the Supabase Storage path when /api/s3 does not list the file', async () => {
    const open = stubWindowOpen(fakeWindow());
    const clicks = captureAnchorClicks();
    supabaseMock.storageList = [{ name: 'bracket.step' }];
    stubFetch((call) => {
      if (call.url === '/api/s3?action=list') return jsonResponse(200, { objects: [] });
      return jsonResponse(200, { url: 'https://signed.example/bracket.step' });
    });
    const c = await mountDownload();
    await waitFor(() => expect(button(c, 'Download').disabled).toBe(false));
    await act(async () => {
      button(c, 'Download').click();
    });
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(open).not.toHaveBeenCalled();
    expect(clicks[0]).toEqual({ href: 'https://signed.example/bracket.step', download: 'bracket.step' });
  });

  it('falls back to Supabase Storage when the /api/s3 lookup is refused', async () => {
    supabaseMock.storageList = [];
    stubFetch(() => jsonResponse(401, { error: 'unauthorized' }));
    const c = await mountDownload();
    await waitFor(() => expect(c.textContent).toContain('File not found'));
  });
});
