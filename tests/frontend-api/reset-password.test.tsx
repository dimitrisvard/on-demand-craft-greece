// /reset-password (PLAN.md P6-4): request mode, link errors, new-password mode, the PASSWORD_RECOVERY hand-over in
// AuthContext, and the route/robots wiring. Globals: describe/it/expect/vi (tests/frontend-api/vitest.config.mjs).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { act, flush, render, typeInto, type Mounted } from './helpers';

type Listener = (event: string, session: unknown) => void;

const auth = vi.hoisted(() => {
  const state = {
    session: null as unknown,
    listeners: [] as Array<(event: string, session: unknown) => void>,
    unsubscribed: 0,
    updateUser: null as unknown as ReturnType<typeof vi.fn>,
    resetPassword: null as unknown as ReturnType<typeof vi.fn>,
    defaultRoute: '/customer/dashboard',
  };
  return state;
});

vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit']) chain[name] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: auth.session }, error: null }),
        onAuthStateChange: (cb: Listener) => {
          auth.listeners.push(cb);
          return { data: { subscription: { unsubscribe: () => { auth.unsubscribed += 1; auth.listeners = auth.listeners.filter((l) => l !== cb); } } } };
        },
        updateUser: (...args: unknown[]) => auth.updateUser(...args),
        resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
      },
      from: () => chain,
    },
  };
});

vi.mock('@/contexts/AuthContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/contexts/AuthContext')>();
  return {
    ...real,
    useAuth: () => ({
      resetPassword: (...args: unknown[]) => auth.resetPassword(...args),
      getDefaultRoute: () => auth.defaultRoute,
    }),
  };
});

const { default: ResetPassword } = await import('@/pages/ResetPassword');
const { recoveryLinkError, passwordProblem, MIN_PASSWORD_LENGTH } = await import('@/utils/passwordRecovery');
const { default: AuthProvider } = await import('@/contexts/AuthContext');

let mounted: Mounted | null = null;
let currentPath = '';
// Every navigate() gives the location a new key, also for the same path; the type tells PUSH from REPLACE.
let currentKey = '';
let currentNavType = '';

function PathProbe() {
  const location = useLocation();
  const navType = useNavigationType();
  currentPath = location.pathname;
  currentKey = location.key;
  currentNavType = navType;
  return null;
}

async function renderPage(path = '/reset-password'): Promise<Mounted> {
  mounted = await render(
    createElement(
      HelmetProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(PathProbe),
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/reset-password', element: createElement(ResetPassword) }),
          createElement(Route, { path: '*', element: createElement('div', { 'data-testid': 'elsewhere' }) }),
        ),
      ),
    ),
  );
  await act(async () => {
    await flush();
  });
  return mounted;
}

function emit(event: string, session: unknown) {
  act(() => {
    for (const l of [...auth.listeners]) l(event, session);
  });
}

function field(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id}`);
  return el as HTMLInputElement;
}

async function submit(container: HTMLElement) {
  const form = container.querySelector('form');
  if (!form) throw new Error('no form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
}

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  auth.session = null;
  auth.listeners = [];
  auth.unsubscribed = 0;
  auth.updateUser = vi.fn(async () => ({ data: { user: {} }, error: null }));
  auth.resetPassword = vi.fn(async () => undefined);
  auth.defaultRoute = '/customer/dashboard';
  setUrl('/reset-password');
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

describe('recoveryLinkError', () => {
  it('reads the Supabase error from the fragment (implicit flow) or the query', () => {
    expect(recoveryLinkError('https://www.micronshub.eu/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
      .toBe('This reset link has expired or has already been used.');
    expect(recoveryLinkError('https://www.micronshub.eu/reset-password?error=server_error&error_description=Something+failed'))
      .toBe('Something failed');
    expect(recoveryLinkError('https://www.micronshub.eu/reset-password#error=access_denied')).toBe('This reset link is not valid.');
  });

  it('is null for a clean URL, a session fragment and garbage', () => {
    expect(recoveryLinkError('https://www.micronshub.eu/reset-password')).toBeNull();
    expect(recoveryLinkError('https://www.micronshub.eu/reset-password#access_token=x&type=recovery')).toBeNull();
    expect(recoveryLinkError('not a url')).toBeNull();
  });
});

describe('passwordProblem', () => {
  it('enforces the registration minimum and equal entries', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(passwordProblem('12345', '12345')).toMatch(/at least 6/);
    expect(passwordProblem('123456', '123457')).toMatch(/do not match/);
    expect(passwordProblem('123456', '123456')).toBeNull();
  });
});

describe('ResetPassword page', () => {
  it('without a session: request form, empty address refused, link requested with the trimmed address', async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain('Reset your password');
    await submit(container);
    expect(container.querySelector('[data-testid="form-error"]')?.textContent).toContain('e-mail address');
    expect(auth.resetPassword).not.toHaveBeenCalled();

    act(() => typeInto(field('reset-email'), '  buyer@example.com '));
    await submit(container);
    expect(auth.resetPassword).toHaveBeenCalledWith('buyer@example.com');
    expect(container.querySelector('[data-testid="sent"]')?.textContent).toContain('buyer@example.com');
  });

  it('shows the error of a failed request and stays on the request form', async () => {
    auth.resetPassword = vi.fn(async () => { throw new Error('For security purposes, you can only request this after 40 seconds.'); });
    const { container } = await renderPage();
    act(() => typeInto(field('reset-email'), 'buyer@example.com'));
    await submit(container);
    expect(container.querySelector('[data-testid="form-error"]')?.textContent).toContain('40 seconds');
    expect(field('reset-email')).toBeTruthy();
  });

  it('with a session: new-password form; mismatch blocks the update; a valid pair updates and continues', async () => {
    auth.session = { access_token: 't', user: { id: 'u1' } };
    const { container } = await renderPage();
    expect(container.textContent).toContain('Set a new password');

    act(() => {
      typeInto(field('new-password'), 'secret-1');
      typeInto(field('confirm-password'), 'secret-2');
    });
    await submit(container);
    expect(container.querySelector('[data-testid="form-error"]')?.textContent).toContain('do not match');
    expect(auth.updateUser).not.toHaveBeenCalled();

    act(() => typeInto(field('confirm-password'), 'secret-1'));
    await submit(container);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'secret-1' });
    expect(container.textContent).toContain('Your password has been changed.');

    auth.defaultRoute = '/dashboard';
    const cont = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Continue');
    await act(async () => {
      cont?.click();
      await flush();
    });
    expect(currentPath).toBe('/dashboard');
  });

  it('shows the Supabase error of a refused update and keeps the form', async () => {
    auth.session = { access_token: 't', user: { id: 'u1' } };
    auth.updateUser = vi.fn(async () => ({ data: null, error: { message: 'New password should be different from the old password.' } }));
    const { container } = await renderPage();
    act(() => {
      typeInto(field('new-password'), 'secret-1');
      typeInto(field('confirm-password'), 'secret-1');
    });
    await submit(container);
    expect(container.querySelector('[data-testid="form-error"]')?.textContent).toContain('different from the old');
    expect(field('new-password')).toBeTruthy();
  });

  it('switches to the new-password form when PASSWORD_RECOVERY arrives after the first check', async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain('Reset your password');
    emit('PASSWORD_RECOVERY', { access_token: 't', user: { id: 'u1' } });
    expect(container.textContent).toContain('Set a new password');
  });

  it('an expired link wins over an older session; a later recovery event still opens the form', async () => {
    setUrl('/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    auth.session = { access_token: 'older', user: { id: 'u0' } };
    const { container } = await renderPage();
    expect(container.querySelector('[data-testid="link-error"]')?.textContent).toContain('expired');
    expect(container.querySelector('#reset-email')).not.toBeNull();
    emit('SIGNED_IN', { access_token: 'older', user: { id: 'u0' } });
    expect(container.querySelector('#new-password')).toBeNull();
    emit('PASSWORD_RECOVERY', { access_token: 'new', user: { id: 'u1' } });
    expect(container.querySelector('#new-password')).not.toBeNull();
    expect(container.querySelector('[data-testid="link-error"]')).toBeNull();
  });

  it('is marked noindex and unsubscribes on unmount', async () => {
    // react-helmet-async commits head changes in requestAnimationFrame.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    await renderPage();
    await act(async () => {
      await flush(10);
    });
    const robots = document.head.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute('content')).toBe('noindex, nofollow');
    expect(auth.listeners.length).toBe(1);
    mounted?.unmount();
    mounted = null;
    expect(auth.unsubscribed).toBe(1);
  });
});

describe('AuthContext hands PASSWORD_RECOVERY to /reset-password', () => {
  async function renderProvider(path: string) {
    setUrl(path);
    mounted = await render(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(AuthProvider, null, createElement(PathProbe)),
      ),
    );
    await act(async () => {
      await flush();
    });
  }

  it('from another page (Supabase Site URL fallback): replaces the entry with /reset-password', async () => {
    await renderProvider('/');
    const before = currentKey;
    expect(currentNavType).toBe('POP');
    emit('PASSWORD_RECOVERY', { access_token: 't', user: { id: 'u1' } });
    await act(async () => {
      await flush();
    });
    expect(currentPath).toBe('/reset-password');
    expect(currentKey).not.toBe(before);
    // The landing page is not kept in the history: Back does not return to the consumed link.
    expect(currentNavType).toBe('REPLACE');
  });

  it('on /reset-password itself, or for other events: no navigation', async () => {
    await renderProvider('/en');
    let before = currentKey;
    emit('SIGNED_IN', { access_token: 't', user: { id: 'u1' } });
    await act(async () => {
      await flush();
    });
    expect(currentPath).toBe('/en');
    expect(currentKey).toBe(before);
    expect(currentNavType).toBe('POP');
    mounted?.unmount();
    mounted = null;
    auth.listeners = [];

    // A navigate() to the same path would still create a new entry (new key) and remount the page.
    await renderProvider('/reset-password');
    before = currentKey;
    emit('PASSWORD_RECOVERY', { access_token: 't', user: { id: 'u1' } });
    await act(async () => {
      await flush();
    });
    expect(currentPath).toBe('/reset-password');
    expect(currentKey).toBe(before);
    expect(currentNavType).toBe('POP');
  });
});

describe('route, language and robots wiring', () => {
  // Same repo-root lookup as callers.test.ts.
  const read = (p: string) => {
    const testPath = expect.getState().testPath;
    if (!testPath) throw new Error('test path unknown');
    return readFileSync(join(resolve(testPath, '../../..'), p), 'utf8');
  };

  it('App.tsx has /reset-password without a language prefix, AuthContext links to it', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('<Route path="/reset-password" element={<ResetPassword />} />');
    expect(app).not.toMatch(/path="\/:lang\/reset-password"/);
    expect(read('src/contexts/AuthContext.tsx')).toContain("redirectTo: window.location.origin + '/reset-password'");
    expect(read('src/contexts/LanguageContext.tsx')).toMatch(/NON_LANGUAGE_ROUTES = \[[^\]]*'\/reset-password'/s);
  });

  it('robots.txt disallows it like /login; Login links to it with rel=nofollow', () => {
    expect(read('public/robots.txt').split('\n')).toContain('Disallow: /reset-password');
    const login = read('src/pages/Login.tsx');
    expect(login).toContain('<Link to="/reset-password" rel="nofollow"');
    expect(login).not.toContain('<a href="#" className="text-sm text-primary hover:underline">');
  });
});
