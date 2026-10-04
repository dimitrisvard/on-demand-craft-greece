// Test-only token minting with jose. Site tests import this file by relative path, so `jose` resolves from
// workers/shared/node_modules. Keys are generated per run; no key material is stored in the repository.

import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

const encoder = new TextEncoder();
// HS256 key for Supabase-shaped user tokens. The gate never checks this signature locally (Supabase Auth does),
// so any value works; it is built at runtime and is not a secret.
const SUPABASE_TEST_KEY = encoder.encode(['microns', 'supabase', 'test', 'key', 'NOT', 'A', 'SECRET'].join('-'));

export interface SupabaseClaims {
  sub: string;
  email?: string;
  /** Seconds since the epoch; default now + 3600. */
  exp?: number;
  /** Default 'authenticated'. */
  role?: string;
  /** Default 'authenticated'. */
  aud?: string | string[];
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** A token with the shape of a Supabase user access token. */
export async function mintSupabaseJwt(claims: SupabaseClaims): Promise<string> {
  const payload: Record<string, unknown> = {
    sub: claims.sub,
    role: claims.role ?? 'authenticated',
    aud: claims.aud ?? 'authenticated',
    exp: claims.exp ?? nowSec() + 3600,
    iat: nowSec(),
  };
  if (claims.email !== undefined) payload.email = claims.email;
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(SUPABASE_TEST_KEY);
}

/** A token with the shape of a project API key (role 'anon', no user). */
export async function mintProjectKeyShape(role: 'anon' | 'service_role' = 'anon'): Promise<string> {
  return new SignJWT({ iss: 'supabase', ref: 'testproject', role, exp: nowSec() + 3600, iat: nowSec() })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(SUPABASE_TEST_KEY);
}

export interface SigningKey {
  kid: string;
  alg: 'RS256' | 'ES256';
  privateKey: CryptoKey;
  publicJwk: JWK;
}

/** RS256 key pair, as Cloudflare Access signs its assertions. */
export async function accessKeyPair(kid = 'access-test-kid'): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, alg: 'RS256', privateKey, publicJwk };
}

/** ES256 key pair, as a Supabase project with asymmetric signing keys publishes. */
export async function es256KeyPair(kid = 'supabase-test-kid'): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { kid, alg: 'ES256', privateKey, publicJwk };
}

export interface AccessClaims {
  /** Team origin, e.g. https://team.cloudflareaccess.com. */
  iss: string;
  aud: string | string[];
  /** Service tokens: the client id. */
  commonName?: string;
  /** Human identities. */
  email?: string;
  /** Seconds since the epoch; default now + 600. */
  exp?: number;
  /** Header kid; default the key's kid. */
  kid?: string;
}

/** A Cloudflare Access assertion signed with `key`. */
export async function mintAccessJwt(key: SigningKey, claims: AccessClaims): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: claims.iss,
    aud: claims.aud,
    exp: claims.exp ?? nowSec() + 600,
    iat: nowSec(),
    nbf: nowSec() - 5,
    sub: claims.commonName ? '' : 'test-user-id',
    type: 'app',
  };
  if (claims.commonName !== undefined) payload.common_name = claims.commonName;
  if (claims.email !== undefined) payload.email = claims.email;
  return new SignJWT(payload).setProtectedHeader({ alg: key.alg, kid: claims.kid ?? key.kid }).sign(key.privateKey);
}

/** A token signed with `key` for the dormant Supabase JWKS path. */
export async function mintSupabaseJwtWithKey(key: SigningKey, claims: SupabaseClaims & { iss: string }): Promise<string> {
  const payload: Record<string, unknown> = {
    iss: claims.iss,
    sub: claims.sub,
    role: claims.role ?? 'authenticated',
    aud: claims.aud ?? 'authenticated',
    exp: claims.exp ?? nowSec() + 3600,
    iat: nowSec(),
  };
  if (claims.email !== undefined) payload.email = claims.email;
  return new SignJWT(payload).setProtectedHeader({ alg: key.alg, kid: key.kid, typ: 'JWT' }).sign(key.privateKey);
}

/** Body of a certs (JWKS) endpoint publishing these keys. */
export function jwksBody(...keys: SigningKey[]): { keys: JWK[] } {
  return { keys: keys.map((k) => k.publicJwk) };
}
