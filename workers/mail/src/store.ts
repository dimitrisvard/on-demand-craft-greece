// M3 store-raw: the raw MIME in R2 microns-private under email/<message_id_sha256>/raw.eml (the key the
// inbound_emails row must name, inbound_emails_raw_key_check). R2 verifies the SHA-256 of the body.
//
// Rules
//   - New key: the bytes are written ('stored').
//   - The key holds the same bytes (same SHA-256, kept in customMetadata.raw_sha256 and as the R2 checksum):
//     nothing is written ('same', a redelivery).
//   - The key holds other bytes: they are replaced only while no inbound_emails row exists for the message hash (an
//     earlier delivery stopped before M4, e.g. a resend with new transport headers): 'replaced'. Once a row exists,
//     the stored bytes belong to it and stay as they are: 'kept' (the handler logs duplicate_mismatch and stops).
//   - Three attempts with 200 ms and 800 ms pauses; then the handler falls back (M7).

export const STORE_DELAYS_MS = [200, 800] as const;

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function rawKey(messageIdSha256: string): string {
  return `email/${messageIdSha256}/raw.eml`;
}

export interface StoredRaw {
  key: string;
  outcome: 'stored' | 'same' | 'replaced' | 'kept';
}

function hexOf(buffer: ArrayBuffer | undefined): string | null {
  if (!buffer) return null;
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of a stored object (custom metadata first, then the R2 checksum), or null when unknown. */
function storedSha256(object: R2Object): string | null {
  const meta = object.customMetadata?.raw_sha256;
  if (meta && /^[0-9a-f]{64}$/.test(meta)) return meta;
  return hexOf(object.checksums?.sha256);
}

export async function storeRaw(
  bucket: R2Bucket,
  o: { sha: string; raw: ArrayBuffer; rawSha256: string; mailbox: string; receivedAt: string },
  /** True when an inbound_emails row exists for o.sha (asked only when the key holds other bytes). */
  rowExists: () => Promise<boolean>,
  sleep: Sleep = realSleep,
): Promise<StoredRaw> {
  const key = rawKey(o.sha);
  const options: R2PutOptions = {
    httpMetadata: { contentType: 'message/rfc822' },
    sha256: o.rawSha256,
    customMetadata: { mailbox: o.mailbox, received_at: o.receivedAt, raw_sha256: o.rawSha256 },
  };
  let lastError: unknown;
  for (let attempt = 0; attempt <= STORE_DELAYS_MS.length; attempt++) {
    try {
      const existing = await bucket.head(key);
      if (existing && storedSha256(existing) === o.rawSha256) return { key, outcome: 'same' };
      if (existing && (await rowExists())) return { key, outcome: 'kept' };
      await bucket.put(key, o.raw, options);
      return { key, outcome: existing ? 'replaced' : 'stored' };
    } catch (error) {
      lastError = error;
      if (attempt < STORE_DELAYS_MS.length) await sleep(STORE_DELAYS_MS[attempt]);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('store-raw failed');
}
