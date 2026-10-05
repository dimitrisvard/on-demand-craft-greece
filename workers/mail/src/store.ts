// M3 store-raw: the raw MIME in R2 microns-private under email/<message_id_sha256>/raw.eml (the same key on
// redelivery, so a second delivery overwrites with the same bytes). R2 verifies the SHA-256 of the body.
// Three attempts with 200 ms and 800 ms pauses; then the handler falls back (M7).

export const STORE_DELAYS_MS = [200, 800] as const;

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function rawKey(messageIdSha256: string): string {
  return `email/${messageIdSha256}/raw.eml`;
}

export async function storeRaw(
  bucket: R2Bucket,
  o: { sha: string; raw: ArrayBuffer; rawSha256: string; mailbox: string; receivedAt: string },
  sleep: Sleep = realSleep,
): Promise<string> {
  const key = rawKey(o.sha);
  let lastError: unknown;
  for (let attempt = 0; attempt <= STORE_DELAYS_MS.length; attempt++) {
    try {
      await bucket.put(key, o.raw, {
        httpMetadata: { contentType: 'message/rfc822' },
        sha256: o.rawSha256,
        customMetadata: { mailbox: o.mailbox, received_at: o.receivedAt },
      });
      return key;
    } catch (error) {
      lastError = error;
      if (attempt < STORE_DELAYS_MS.length) await sleep(STORE_DELAYS_MS[attempt]);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('store-raw failed');
}
