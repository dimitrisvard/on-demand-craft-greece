// Credentials of /api/agent/* that are not a user session (Phase 4):
//
//   Relay request (action ID AG-2, POST /api/agent/decision from the Telegram relay)
//     X-Microns-Timestamp  unix seconds, at most 300 s from the Worker's clock (either direction)
//     X-Microns-Signature  hex HMAC-SHA256(AGENT_APPROVAL_SECRET, <timestamp> + "." + <raw body bytes>)
//     The signature is checked with crypto.subtle.verify (constant time). A signature accepted once is refused for
//     the next 10 minutes in this isolate (a captured request cannot be replayed within the timestamp window).
//
//   Signed partner file link (action ID AG-3, GET /api/agent/file?k&exp&sig)
//     sig = base64url(HMAC-SHA256(K, k + "|" + exp)), K = HKDF-SHA256(AGENT_APPROVAL_SECRET, empty salt,
//     info "microns-file-link-v1", 256-bit HMAC key); exp = unix seconds, in the future and at most 7 days ahead;
//     k = a traveller PDF of an order or a drawing PDF / flat DXF of a CAD job. microns-ops checks the link again and
//     that the key belongs to an order with a production partner.
//
//   Staff file preview (action ID AG-7, GET /api/agent/file?k with a staff session)
//     k must match STAFF_FILE_KEY_RE; a key containing "..", a backslash or an encoded slash or backslash
//     (%2f, %5c) is refused before the pattern is applied.
//
// AGENT_APPROVAL_SECRET is optional in the site's env (an unrelated deploy never fails for agent config): the gate
// rows that need it read it through AgentSiteEnv and answer 500 for that request only when it is missing.
// Nothing here logs a signature, a timestamp, a key or a body.

import type { Env } from '../env';

export interface AgentSiteEnv extends Env {
  /** Shared with microns-ops (signed file links) and the Telegram relay (request signatures). */
  AGENT_APPROVAL_SECRET?: string;
}

export const RELAY_TIMESTAMP_HEADER = 'X-Microns-Timestamp';
export const RELAY_SIGNATURE_HEADER = 'X-Microns-Signature';
/** Largest accepted difference between the relay's timestamp and the Worker's clock. */
export const RELAY_WINDOW_SECONDS = 300;
/** How long an accepted relay signature is refused again. */
export const RELAY_REPLAY_MS = 600_000;

export const FILE_LINK_INFO = 'microns-file-link-v1';
export const FILE_LINK_MAX_SECONDS = 7 * 24 * 3600;
/** Partner downloads: an order's traveller PDF, or a CAD job's drawing PDF or flat DXF. */
export const PARTNER_FILE_KEY_RE = /^(orders\/[0-9a-f-]{36}\/traveler\.pdf|cad\/[0-9a-f-]{36}\/output\/(drawing\.pdf|flat\.dxf))$/;
/** Staff previews: quote PDFs, traveller PDFs, CAD outputs, stored raw e-mails and their attachments. */
export const STAFF_FILE_KEY_RE =
  /^(quotes\/[0-9a-f-]{36}\/v\d+\/quote\.pdf|orders\/[0-9a-f-]{36}\/traveler\.pdf|cad\/[0-9a-f-]{36}\/output\/[a-z_.]+|email\/[0-9a-f]{64}\/(raw\.eml|att\/[0-9]+-[A-Za-z0-9._-]{1,100}))$/;

const TIMESTAMP_RE = /^\d{1,12}$/;
const SIGNATURE_RE = /^[0-9a-f]{64}$/;
const SEEN_MAX = 10_000;

const encoder = new TextEncoder();

/** True when the request carries either relay header (the relay path decides; a session is then not considered). */
export function hasRelayHeaders(headers: Headers): boolean {
  return headers.has(RELAY_TIMESTAMP_HEADER) || headers.has(RELAY_SIGNATURE_HEADER);
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

async function relayKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** The signed message of a relay request: <timestamp> + "." + <raw body bytes>. */
function relayMessage(timestamp: string, body: Uint8Array): Uint8Array {
  return concat(encoder.encode(`${timestamp}.`), body);
}

/** hex HMAC-SHA256(secret, timestamp + "." + body): what the relay sends as X-Microns-Signature. */
export async function relaySignature(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await relayKey(secret), relayMessage(timestamp, body));
  return toHex(new Uint8Array(mac));
}

/** Accepted relay signatures of this isolate, each refused again until its expiry. */
export class SeenSignatures {
  private readonly entries = new Map<string, number>();

  constructor(private readonly ttlMs: number = RELAY_REPLAY_MS, private readonly max: number = SEEN_MAX) {}

  /** Records the signature; false when it was already seen within its expiry. */
  add(signature: string, nowMs: number): boolean {
    const expires = this.entries.get(signature);
    if (expires !== undefined && expires > nowMs) return false;
    if (this.entries.size >= this.max) this.prune(nowMs);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(signature, nowMs + this.ttlMs);
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(nowMs: number): void {
    for (const [signature, expires] of this.entries) if (expires <= nowMs) this.entries.delete(signature);
  }
}

/** The isolate's set (module scope: one per isolate). */
export const relaySeen = new SeenSignatures();

export type RelayCheck = { ok: true } | { ok: false; reason: 'headers' | 'window' | 'signature' | 'replay' };

/**
 * Verifies a relay request: both headers in their formats, the timestamp within RELAY_WINDOW_SECONDS of `nowMs`, the
 * signature over the raw body bytes, and no earlier use of the same signature in `seen`.
 */
export async function verifyRelayRequest(
  headers: Headers,
  body: Uint8Array,
  secret: string,
  nowMs: number,
  seen: SeenSignatures = relaySeen,
): Promise<RelayCheck> {
  const timestamp = (headers.get(RELAY_TIMESTAMP_HEADER) ?? '').trim();
  const signature = (headers.get(RELAY_SIGNATURE_HEADER) ?? '').trim().toLowerCase();
  if (!TIMESTAMP_RE.test(timestamp) || !SIGNATURE_RE.test(signature)) return { ok: false, reason: 'headers' };
  if (Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) > RELAY_WINDOW_SECONDS) return { ok: false, reason: 'window' };
  const valid = await crypto.subtle.verify('HMAC', await relayKey(secret), fromHex(signature), relayMessage(timestamp, body));
  if (!valid) return { ok: false, reason: 'signature' };
  if (!seen.add(signature, nowMs)) return { ok: false, reason: 'replay' };
  return { ok: true };
}

// ----- signed partner file links -----

function base64UrlBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function fileLinkKey(secret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(FILE_LINK_INFO) },
    ikm,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['verify'],
  );
}

/** True when k, exp and sig form a valid, unexpired partner link (HMAC verify: constant time). */
export async function verifyFileLink(secret: string, key: string, expText: string, sig: string, nowMs: number): Promise<boolean> {
  if (!PARTNER_FILE_KEY_RE.test(key) || !/^\d{1,12}$/.test(expText)) return false;
  const exp = Number(expText);
  const nowS = Math.floor(nowMs / 1000);
  if (exp <= nowS || exp > nowS + FILE_LINK_MAX_SECONDS) return false;
  const mac = base64UrlBytes(sig);
  if (!mac || mac.byteLength !== 32) return false;
  return crypto.subtle.verify('HMAC', await fileLinkKey(secret), mac, encoder.encode(`${key}|${exp}`));
}

// ----- staff file previews -----

/** The raw (still percent-encoded) values of a query parameter, in order. */
export function rawQueryValues(search: string, name: string): string[] {
  const out: string[] = [];
  const text = search.startsWith('?') ? search.slice(1) : search;
  if (!text) return out;
  for (const part of text.split('&')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (key === name) out.push(eq < 0 ? '' : part.slice(eq + 1));
  }
  return out;
}

/**
 * The staff preview key of a request's query (parameter k), or null when it is refused: exactly one k, no encoded
 * slash or backslash in its raw form, no ".." or backslash after decoding, and the decoded key matches
 * STAFF_FILE_KEY_RE.
 */
export function staffFileKey(search: string): string | null {
  const raw = rawQueryValues(search, 'k');
  if (raw.length !== 1) return null;
  if (/%(2f|5c)/i.test(raw[0])) return null;
  let key: string;
  try {
    key = decodeURIComponent(raw[0].replace(/\+/g, ' '));
  } catch {
    return null;
  }
  if (key.includes('..') || key.includes('\\')) return null;
  return STAFF_FILE_KEY_RE.test(key) ? key : null;
}
