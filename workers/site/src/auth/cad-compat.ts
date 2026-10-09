// Credential of the CAD compat path (Phase 5, unit M5; action ID CD-1, POST /api/cad/<token>/flat-pattern): the
// path segment must equal the optional secret CAD_COMPAT_TOKEN, compared in constant time. src/env.ts stays unchanged
// (the Phase 2 env test checks every Env field), so the secret's type lives here.
//
// Rules
//   - 'not_configured' when the secret is missing or empty (the gate answers 500 for that request only); a missing
//     secret is never compared.
//   - The comparison runs over the SHA-256 digests of the presented token and of the secret with a fixed-length XOR
//     loop, so its time does not depend on where (or whether) the two values differ, nor on their lengths.
//   - The token never appears in a log line, an error text or the function URL sent to microns-ops.

import type { Env } from '../env';

export interface CadCompatEnv extends Env {
  CAD_COMPAT_TOKEN?: string;
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Constant-time equality of two SHA-256 digests (always 32 rounds). */
function sameDigest(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < 32; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function checkCadCompatToken(env: CadCompatEnv, token: string): Promise<'ok' | 'mismatch' | 'not_configured'> {
  const secret = env.CAD_COMPAT_TOKEN;
  if (typeof secret !== 'string' || secret === '') return 'not_configured';
  const [presented, expected] = await Promise.all([digest(typeof token === 'string' ? token : ''), digest(secret)]);
  return sameDigest(presented, expected) ? 'ok' : 'mismatch';
}
