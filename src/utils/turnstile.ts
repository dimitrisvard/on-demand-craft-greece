// Cloudflare Turnstile for the public forms that post to /api/emails.
//
// Rules:
// - The site key comes from the build variable read in turnstileSiteKey(); no key
//   means no widget, and there is no fallback key.
// - The script is injected only on demand (first interaction with a form, or at
//   submit), once per page, and never when the user agent is jsdom (the build
//   prerenders the pages that hold the forms in jsdom).
// - A token is read with turnstile.getResponse() immediately before each request
//   and sent in the X-Turnstile-Token header. Tokens are single-use: a token that
//   was already sent is never sent again; the widget is reset and a fresh token
//   is awaited for at most TOKEN_WAIT_MS.
// - A form always submits: without a token the request goes without the header
//   and the server decides.
// - One retry after a 403 {"error":"turnstile_failed"}, with a fresh token.

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_HEADER = 'X-Turnstile-Token';
export const TOKEN_WAIT_MS = 30_000;

export type TurnstileAction = 'contact' | 'quote';

export interface TurnstileRenderOptions {
  sitekey: string;
  action: TurnstileAction;
  'refresh-expired': 'auto';
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'error-callback'?: () => boolean | void;
  'expired-callback'?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  getResponse(widgetId: string): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** The public Turnstile site key of this build, or null when none is configured. */
export function turnstileSiteKey(): string | null {
  const key: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
}

/** True while the page runs inside jsdom (build-time prerendering, tests). */
export function isJsdomUserAgent(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
}

let scriptLoad: Promise<TurnstileApi | null> | null = null;

/**
 * Injects the Turnstile script once and resolves with `window.turnstile`.
 * Resolves null (and injects nothing) under jsdom; resolves null when the script
 * fails to load (a later call may try again).
 */
export function loadTurnstile(): Promise<TurnstileApi | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || isJsdomUserAgent()) {
    return Promise.resolve(null);
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptLoad) {
    scriptLoad = new Promise<TurnstileApi | null>((resolve) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.addEventListener('load', () => resolve(window.turnstile ?? null));
      script.addEventListener('error', () => {
        script.remove();
        scriptLoad = null;
        resolve(null);
      });
      document.head.appendChild(script);
    });
  }
  return scriptLoad;
}

/** One Turnstile widget (explicit render) and the single-use tokens it issues. */
export class TurnstileController {
  private api: TurnstileApi | null = null;
  private widgetId: string | null = null;
  private container: HTMLElement | null = null;
  private activation: Promise<void> | null = null;
  private readonly spent = new Set<string>();
  private waiters: Array<(token: string | null) => void> = [];
  /** The widget reported an error and has not produced a token since. */
  private errored = false;

  constructor(
    private readonly action: TurnstileAction,
    private readonly siteKey: string | null = turnstileSiteKey(),
    private readonly load: () => Promise<TurnstileApi | null> = loadTurnstile,
    private readonly waitMs: number = TOKEN_WAIT_MS,
  ) {}

  /** False when the build has no site key: no widget, no script, no token. */
  get enabled(): boolean {
    return this.siteKey !== null;
  }

  /** Sets the element the widget renders into (null detaches). */
  attach(container: HTMLElement | null): void {
    this.container = container;
    this.render();
  }

  /** Loads the script (once) and renders the widget into the attached container. */
  activate(): Promise<void> {
    if (!this.siteKey) return Promise.resolve();
    if (!this.activation) {
      this.activation = this.load().then((api) => {
        this.api = api;
        this.render();
        if (!api) {
          // Script blocked or failed: a later interaction or submit may try again.
          this.activation = null;
          this.settle(null);
        }
      });
    }
    return this.activation;
  }

  private render(): void {
    if (!this.api || !this.container || this.widgetId !== null || !this.siteKey) return;
    try {
      this.widgetId =
        this.api.render(this.container, {
          sitekey: this.siteKey,
          action: this.action,
          'refresh-expired': 'auto',
          appearance: 'interaction-only',
          callback: (token) => {
            this.errored = false;
            this.settle(token);
          },
          'error-callback': () => {
            // Turnstile keeps retrying on its own; a request made meanwhile goes without a token.
            this.errored = true;
            this.settle(null);
            return true;
          },
        }) ?? null;
    } catch {
      this.widgetId = null;
      this.settle(null);
    }
  }

  private settle(token: string | null): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(token);
  }

  private read(): string | null {
    if (!this.api || this.widgetId === null) return null;
    try {
      return this.api.getResponse(this.widgetId) || null;
    } catch {
      return null;
    }
  }

  private nextCallback(ms: number): Promise<string | null> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (token: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(token);
      };
      const timer = setTimeout(() => finish(null), ms);
      this.waiters.push(finish);
    });
  }

  /**
   * A token for exactly one request, read with getResponse() at call time; null
   * when there is none within TOKEN_WAIT_MS (no key, script blocked, widget
   * error, timeout). A token already handed out is never returned again.
   */
  async getToken(): Promise<string | null> {
    if (!this.siteKey) return null;
    const deadline = Date.now() + this.waitMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.activate(), new Promise<void>((resolve) => { timer = setTimeout(resolve, this.waitMs); })]);
    clearTimeout(timer);
    if (!this.api || this.widgetId === null) return null;

    let token = this.read();
    if (token && this.spent.has(token)) {
      this.reset();
      token = null;
    }
    if (!token) {
      if (this.errored) return null;
      const fromCallback = await this.nextCallback(Math.max(0, deadline - Date.now()));
      const current = this.read();
      token = current && !this.spent.has(current) ? current : fromCallback;
    }
    if (!token || this.spent.has(token)) return null;
    this.spent.add(token);
    return token;
  }

  /** Asks the widget for a new token. */
  reset(): void {
    if (!this.api || this.widgetId === null) return;
    this.errored = false;
    try {
      this.api.reset(this.widgetId);
    } catch {
      /* the next getToken() waits for a callback or times out */
    }
  }

  /** Removes the widget; a later attach() + activate() renders a new one. */
  destroy(): void {
    if (this.api && this.widgetId !== null) {
      try {
        this.api.remove(this.widgetId);
      } catch {
        /* already gone */
      }
    }
    this.widgetId = null;
    this.container = null;
    this.activation = null;
    this.settle(null);
  }
}

/** True for a 403 whose JSON body is {"error":"turnstile_failed"}. */
export async function isTurnstileRejection(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const body = (await res.clone().json()) as { error?: unknown } | null;
    return body?.error === 'turnstile_failed';
  } catch {
    return false;
  }
}

/**
 * `fetch` with the X-Turnstile-Token header when `getToken` yields a token; the
 * token is obtained right before each attempt. After a 403 turnstile_failed the
 * request is sent once more with a fresh token (if one arrives in time).
 */
export async function fetchWithTurnstile(
  url: string,
  init: RequestInit,
  getToken?: () => Promise<string | null>,
): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set(TURNSTILE_HEADER, token);
    return fetch(url, { ...init, headers });
  };
  const first = await send(getToken ? await getToken() : null);
  if (!getToken || !(await isTurnstileRejection(first))) return first;
  const fresh = await getToken();
  return fresh ? send(fresh) : first;
}
