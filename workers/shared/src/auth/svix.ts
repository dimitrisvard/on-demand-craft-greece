// Svix webhook signature verification over the raw request bytes (WebCrypto HMAC-SHA256), as Resend signs its
// webhook deliveries. Timestamp tolerance defaults to 300 s.

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

export function verifySvix(input: SvixInput): Promise<SvixResult> {
  throw new Error('not implemented: G');
}
