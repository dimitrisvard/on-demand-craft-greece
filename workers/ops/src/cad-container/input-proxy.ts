// Outbound input proxy of the CAD Container (Phase 5, unit D5). The container has no internet; the compat path
// rewrites the caller's input URL to http://cad-input.internal/u/<base64url(original)>, and this handler (registered
// on CadContainer through the inherited static outboundByHost setter) fetches the original from the Worker.
//
// Rules
//   - Only GET and HEAD requests for INPUT_HOST/u/<base64url> are served; the decoded URL must be https:, carry no
//     user name or password, and its host must be in CAD_INPUT_HOSTS (exact host[:port] match, case-insensitive;
//     no wildcards, no suffix match). Anything else answers 403.
//   - The upstream request is fetch(url, {redirect: 'manual'}) without any header of the container request. A
//     redirect (301, 302, 303, 307, 308) is followed only when its Location resolves to an allowed https: URL, at
//     most MAX_INPUT_REDIRECTS times; a fourth redirect or a disallowed target answers 403.
//   - The answer streams the upstream body with its status, content-type and content-length; nothing else of the
//     upstream response is passed on.
//   - HTTP only between the container and this handler, so no CA certificate is needed in the image.
//   - Log lines carry the status and the host only, never the URL (presigned URLs carry signatures).

import { formatLogLine } from '../../../shared/src/http/log';
import type { CadEnv } from './cad-container';

/** Host the container reaches for its input; intercepted by the outbound handler, never resolved. */
export const INPUT_HOST = 'cad-input.internal';

/** Path prefix of an encoded input URL. */
export const INPUT_PATH_PREFIX = '/u/';

/** Redirects followed per input (each hop re-checked against the allow-list). */
export const MAX_INPUT_REDIRECTS = 3;

/** Upper bound of one upstream fetch, redirects included (the compat path itself ends at 110 s). */
export const INPUT_FETCH_TIMEOUT_MS = 100_000;

/** Longest encoded segment accepted (an original URL of about 6 KB). */
const MAX_ENCODED_CHARS = 8192;

const LOG_PREFIX_CAD = '[microns-cad]';
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** 'http://cad-input.internal/u/' + base64url(original) (UTF-8, no padding). */
export function encodeInputUrl(original: string): string {
  return `http://${INPUT_HOST}${INPUT_PATH_PREFIX}${toBase64Url(new TextEncoder().encode(original))}`;
}

/** The original URL of an encoded input URL, or null when the URL is not one (host, path or encoding). */
export function decodeInputUrl(encoded: string | URL): string | null {
  let url: URL;
  try {
    url = typeof encoded === 'string' ? new URL(encoded) : encoded;
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || url.hostname !== INPUT_HOST || url.port !== '' || url.search !== '' || url.hash !== '') return null;
  if (!url.pathname.startsWith(INPUT_PATH_PREFIX)) return null;
  const segment = url.pathname.slice(INPUT_PATH_PREFIX.length);
  if (segment.length === 0 || segment.length > MAX_ENCODED_CHARS) return null;
  const bytes = fromBase64Url(segment);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** The allow-list entries of CAD_INPUT_HOSTS: trimmed, lower-case, empty entries dropped. */
export function inputHostList(hosts: string | undefined): string[] {
  return (hosts ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

/** Exact host match of url (host[:port] as the URL carries it) against the comma list CAD_INPUT_HOSTS. */
export function isAllowedInputHost(url: URL, hosts: string): boolean {
  const host = url.host.toLowerCase();
  if (host === '') return false;
  return inputHostList(hosts).includes(host);
}

/** True when the URL may be fetched as a compat input: https:, no credentials, host on the allow-list. */
export function isAllowedInputUrl(url: URL, hosts: string | undefined): boolean {
  return url.protocol === 'https:' && url.username === '' && url.password === '' && isAllowedInputHost(url, hosts ?? '');
}

function forbidden(reason: string, host?: string): Response {
  console.log(formatLogLine(LOG_PREFIX_CAD, 'input refused', { reason, host }));
  return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** The upstream answer as the container sees it: status, content-type, content-length and the body stream. */
function passThrough(upstream: Response): Response {
  const headers = new Headers();
  const type = upstream.headers.get('content-type');
  const length = upstream.headers.get('content-length');
  if (type) headers.set('content-type', type);
  if (length) headers.set('content-length', length);
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** Outbound handler for INPUT_HOST: allow-list, https only, <= 3 redirects re-checked, else 403. */
export async function fetchCompatInput(request: Request, env: CadEnv, ctx: unknown): Promise<Response> {
  void ctx;
  if (request.method !== 'GET' && request.method !== 'HEAD') return forbidden('method');
  const original = decodeInputUrl(request.url);
  if (original === null) return forbidden('encoding');
  let target: URL;
  try {
    target = new URL(original);
  } catch {
    return forbidden('url');
  }
  const hosts = env.CAD_INPUT_HOSTS;
  if (!isAllowedInputUrl(target, hosts)) return forbidden('host', target.protocol === 'https:' ? target.host : undefined);
  const signal = AbortSignal.timeout(INPUT_FETCH_TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    let upstream: Response;
    try {
      upstream = await globalThis.fetch(target.toString(), { method: request.method, redirect: 'manual', signal });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'error';
      console.log(formatLogLine(LOG_PREFIX_CAD, 'input fetch failed', { host: target.host, error: name }));
      return new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (!REDIRECT_STATUSES.has(upstream.status)) {
      console.log(formatLogLine(LOG_PREFIX_CAD, 'input fetched', { host: target.host, status: upstream.status, hops: hop }));
      return passThrough(upstream);
    }
    const location = upstream.headers.get('location');
    await upstream.body?.cancel().catch(() => undefined);
    if (!location) return passThrough(new Response(null, { status: upstream.status }));
    if (hop >= MAX_INPUT_REDIRECTS) return forbidden('redirects', target.host);
    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      return forbidden('redirect_url', target.host);
    }
    if (!isAllowedInputUrl(next, hosts)) return forbidden('redirect_host', next.protocol === 'https:' ? next.host : undefined);
    target = next;
  }
}
