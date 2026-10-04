// Svix webhook signature verification over the raw request bytes (WebCrypto HMAC-SHA256), as Resend signs its
// webhook deliveries.
//   - Headers svix-id, svix-timestamp, svix-signature (space-separated "v1,<base64>" entries) are all required.
//   - Key: the base64 part of the secret after the "whsec_" prefix.
//   - Signed content: "<svix-id>.<svix-timestamp>." followed by the raw body bytes, exactly as received.
//   - The timestamp must be within toleranceSec (default 300) of now, in either direction.
//   - Any v1 entry may match; comparison is constant-time.

export interface SvixInput {
  secret: string;
  headers: Headers;
  rawBody: Uint8Array;
  nowSec?: () => number;
  /** Default 300. */
  toleranceSec?: number;
}

export type SvixResult =
  | { ok: true; id: string; timestamp: number }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'bad_timestamp' | 'bad_signature' };

const SECRET_PREFIX = 'whsec_';
const DEFAULT_TOLERANCE_SEC = 300;

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Constant-time comparison of two strings of ASCII characters (base64 signatures). */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function verifySvix(input: SvixInput): Promise<SvixResult> {
  if (!input.secret) return { ok: false, reason: 'missing_secret' };

  const id = input.headers.get('svix-id');
  const timestampHeader = input.headers.get('svix-timestamp');
  const signatureHeader = input.headers.get('svix-signature');
  if (!id || !timestampHeader || !signatureHeader) return { ok: false, reason: 'missing_headers' };

  if (!/^\d+$/.test(timestampHeader.trim())) return { ok: false, reason: 'bad_timestamp' };
  const timestamp = Number(timestampHeader.trim());
  const now = input.nowSec ? input.nowSec() : Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: 'bad_timestamp' };
  }

  const encodedKey = input.secret.startsWith(SECRET_PREFIX) ? input.secret.slice(SECRET_PREFIX.length) : input.secret;
  const keyBytes = base64ToBytes(encodedKey);
  if (!keyBytes || keyBytes.length === 0) return { ok: false, reason: 'bad_signature' };

  // The integer timestamp is signed, as the svix library formats it.
  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + input.rawBody.length);
  signed.set(prefix, 0);
  signed.set(input.rawBody, prefix.length);

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, signed)));

  let matched = false;
  for (const entry of signatureHeader.split(' ')) {
    const comma = entry.indexOf(',');
    if (comma < 0) continue;
    const version = entry.slice(0, comma);
    const signature = entry.slice(comma + 1);
    if (version !== 'v1') continue;
    // Every entry is compared, so the time taken does not depend on which entry matches.
    if (timingSafeEqual(signature, expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: 'bad_signature' };
  return { ok: true, id, timestamp };
}
