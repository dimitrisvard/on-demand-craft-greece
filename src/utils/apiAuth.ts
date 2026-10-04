// Authenticated calls to the site's own /api/* endpoints from the browser.
//
// Rules:
// - Every helper sends the signed-in user's Supabase access token as
//   `Authorization: Bearer <token>`; signed-out visitors send no header.
// - All callers are same-origin, so the added header needs no CORS preflight.
// - Documents opened in a new tab get their window from `window.open` inside the
//   click handler, before any `await`: browsers (Safari and iOS in particular)
//   block `window.open` once the user gesture has passed an awaited fetch.
// - Object URLs created here are always revoked (on the window's `load`, or after
//   OBJECT_URL_TTL_MS at the latest).
// - A 401 answer from /api/* is announced with API_UNAUTHORIZED_EVENT so that a
//   page can offer "Sign in again".
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export const API_UNAUTHORIZED_EVENT = 'microns:api-unauthorized';
export const OBJECT_URL_TTL_MS = 60_000;
/** Production origin of the site; OAuth popups post their result from here. */
export const SITE_ORIGIN = 'https://www.micronshub.eu';

/** `{ Authorization: 'Bearer <access_token>' }` for the current session, `{}` when signed out. */
export async function apiAuthHeaders(): Promise<Record<string, string>> {
  try {
    // getSession() refreshes an expired access token before returning it.
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Adds the auth headers without overriding a header the caller set itself. */
function withAuthHeaders(init: HeadersInit | undefined, auth: Record<string, string>): Headers {
  const headers = new Headers(init);
  for (const [name, value] of Object.entries(auth)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
}

/** True for a same-origin URL under /api/. */
export function isSiteApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/** Announces a 401 from /api/* (see useApiUnauthorized). */
export function reportApiStatus(url: string, status: number): void {
  if (status === 401 && isSiteApiUrl(url)) {
    window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, { detail: { url } }));
  }
}

/** `fetch` with the session's Authorization header merged into `init.headers`. */
export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = withAuthHeaders(init.headers, await apiAuthHeaders());
  const res = await fetch(url, { ...init, headers });
  reportApiStatus(url, res.status);
  return res;
}

/** Subscribes to API_UNAUTHORIZED_EVENT; returns the unsubscribe function. */
export function onApiUnauthorized(listener: () => void): () => void {
  window.addEventListener(API_UNAUTHORIZED_EVENT, listener);
  return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, listener);
}

/** True once any /api/* call on this page has answered 401. */
export function useApiUnauthorized(): boolean {
  const [unauthorized, setUnauthorized] = useState(false);
  useEffect(() => onApiUnauthorized(() => setUnauthorized(true)), []);
  return unauthorized;
}

/** Clicks a temporary `<a download>`; used when no window could be opened. */
export function clickDownloadAnchor(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Revokes once: on `target`'s `load` after it shows `href`, or after OBJECT_URL_TTL_MS. */
function scheduleRevoke(href: string, revoke: () => void, target?: Window): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    revoke();
  };
  const timer = setTimeout(run, OBJECT_URL_TTL_MS);
  if (!target) return;
  try {
    target.addEventListener('load', () => {
      // The initial about:blank document may also fire `load`; wait for ours.
      let shown = true;
      try {
        shown = target.location.href === href;
      } catch {
        shown = true;
      }
      if (shown) run();
    });
  } catch {
    /* the timer still revokes */
  }
}

export interface WindowTarget {
  href: string;
  /** Called once the target no longer needs `href` (object URLs). */
  revoke?: () => void;
}

/**
 * Opens a new window synchronously (call this directly from a click handler,
 * before any `await`), then resolves the target and navigates the window to it.
 * Popup blocked → a temporary `<a download>` is clicked instead. Failure → the
 * window is closed and a toast is shown. Resolves true when the target was shown.
 */
export function openInNewWindow(resolveTarget: () => Promise<WindowTarget>, filename: string): Promise<boolean> {
  const w = window.open('', '_blank');
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* not settable in every browser */
    }
  }
  return (async () => {
    try {
      const target = await resolveTarget();
      if (!w) {
        clickDownloadAnchor(target.href, filename);
        if (target.revoke) scheduleRevoke(target.href, target.revoke);
        return true;
      }
      if (w.closed) {
        target.revoke?.();
        return false;
      }
      if (target.revoke) scheduleRevoke(target.href, target.revoke, w);
      w.location.href = target.href;
      return true;
    } catch (err) {
      w?.close();
      toast({
        title: 'Could not open the document',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
      return false;
    }
  })();
}

/** Fetches `url` with the session token and shows the answer in a new window (see openInNewWindow). */
export function openWithAuth(url: string, filename: string): Promise<boolean> {
  return openInNewWindow(async () => {
    const res = await fetchWithAuth(url);
    if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    return { href, revoke: () => URL.revokeObjectURL(href) };
  }, filename);
}

/** File name of a `Content-Disposition` header, or null. */
export function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(value);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) || null;
    } catch {
      /* fall through to the plain parameter */
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(value);
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return name || null;
}

/** Fetches `url` with the session token and saves the answer as a file. Throws on a non-2xx answer. */
export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  clickDownloadAnchor(href, filenameFromDisposition(res.headers.get('content-disposition')) ?? filename);
  scheduleRevoke(href, () => URL.revokeObjectURL(href));
}

/** Origins whose `postMessage` results an OAuth popup may deliver to this page. */
export function isTrustedMessageOrigin(origin: string): boolean {
  return origin === window.location.origin || origin === SITE_ORIGIN;
}

/**
 * Asks `requestUrl` (with the session token, `Accept: application/json`,
 * `redirect: 'manual'`) for the URL a popup should show. Only a 200 JSON answer
 * carrying an https `url` is used; any other answer (a redirect, 401/403, an HTML
 * page, a network error) yields `fallbackUrl`.
 */
export async function resolvePopupUrl(requestUrl: string, fallbackUrl: string): Promise<string> {
  try {
    const res = await fetchWithAuth(requestUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
    if (res.status !== 200 || res.type === 'opaqueredirect') return fallbackUrl;
    if (!(res.headers.get('content-type') || '').toLowerCase().includes('application/json')) return fallbackUrl;
    const body = (await res.json()) as { url?: unknown } | null;
    if (typeof body?.url !== 'string') return fallbackUrl;
    return new URL(body.url).protocol === 'https:' ? body.url : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

/**
 * Opens a named popup synchronously (call from a click handler), then navigates it
 * to the URL resolvePopupUrl() returns. The popup keeps its opener so that it can
 * post its result back. Returns null when the popup was blocked.
 */
export function openAuthorizedPopup(requestUrl: string, fallbackUrl: string, name: string, features: string): Window | null {
  const popup = window.open('about:blank', name, features);
  if (!popup) return null;
  void resolvePopupUrl(requestUrl, fallbackUrl).then((target) => {
    if (!popup.closed) popup.location.href = target;
  });
  return popup;
}
