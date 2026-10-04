// Test-only: Svix deliveries signed by the svix library itself (the oracle), for tests in other packages that
// import this file by relative path (svix resolves from workers/shared/node_modules).

import { Webhook } from 'svix';

/** A Svix test secret built at runtime ("whsec_" + base64 of a fixed phrase); not a credential. */
export function svixTestSecret(phrase = 'microns-svix-test-key-NOT-A-SECRET'): string {
  return 'whsec_' + btoa(phrase);
}

/** Headers of a delivery of `body` signed with `secret` at `timestampSec`. */
export function svixHeaders(secret: string, id: string, timestampSec: number, body: string): Record<string, string> {
  const signature = new Webhook(secret).sign(id, new Date(timestampSec * 1000), body);
  return { 'svix-id': id, 'svix-timestamp': String(timestampSec), 'svix-signature': signature };
}
