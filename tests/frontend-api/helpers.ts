// Shared helpers for the frontend API tests (globals: describe/it/expect/vi).
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

/** Replaces navigator.userAgent for one test (restored by vi.restoreAllMocks). */
export function setUserAgent(ua: string): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
  redirect: RequestRedirect | undefined;
}

/** Installs a fetch stub answering with `answer(call, index)`; records every call. */
export function stubFetch(answer: (call: RecordedCall, index: number) => Response | Promise<Response>, log?: string[]) {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: RecordedCall = {
      url: String(input),
      method: (init.method || 'GET').toUpperCase(),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : null,
      redirect: init.redirect,
    };
    calls.push(call);
    log?.push(`fetch ${call.url}`);
    return answer(call, calls.length - 1);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** A redirect answered under `redirect: 'manual'` (type opaqueredirect, status 0). */
export function opaqueRedirect(): Response {
  const res = new Response(null, { status: 200 });
  Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
  Object.defineProperty(res, 'status', { value: 0 });
  Object.defineProperty(res, 'ok', { value: false });
  return res;
}

/** A window returned by a stubbed window.open. */
export interface FakeWindow {
  opener: unknown;
  closed: boolean;
  location: { href: string };
  close: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
}

export function fakeWindow(): FakeWindow {
  const listeners: Record<string, Array<() => void>> = {};
  const w: FakeWindow = {
    opener: window,
    closed: false,
    location: { href: 'about:blank' },
    close: vi.fn(() => {
      w.closed = true;
    }),
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    fire: (type) => {
      for (const l of listeners[type] ?? []) l();
    },
  };
  return w;
}

/** Stubs window.open; returns the spy (and logs 'open' into `log`). */
export function stubWindowOpen(result: FakeWindow | null, log?: string[]) {
  return vi.spyOn(window, 'open').mockImplementation(((...args: unknown[]) => {
    log?.push(`open ${String(args[0])}`);
    return result as unknown as Window;
  }) as typeof window.open);
}

/** URL.createObjectURL / revokeObjectURL stubs (jsdom implements neither). */
export function stubObjectUrls() {
  let n = 0;
  const create = vi.fn(() => `blob:http://localhost:3000/object-${++n}`);
  const revoke = vi.fn();
  const u = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
  const saved = { create: u.createObjectURL, revoke: u.revokeObjectURL };
  u.createObjectURL = create;
  u.revokeObjectURL = revoke;
  const restore = () => {
    u.createObjectURL = saved.create;
    u.revokeObjectURL = saved.revoke;
  };
  return { create, revoke, restore };
}

/** Records anchor clicks instead of navigating (jsdom has no navigation). */
export function captureAnchorClicks() {
  const clicks: Array<{ href: string; download: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
  return clicks;
}

/** Lets pending promise callbacks run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export interface Mounted {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
}

export async function render(ui: ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Sets a React-controlled input's value and fires the events React listens to. */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

export { act };
