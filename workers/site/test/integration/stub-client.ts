// Client of the T2 upstream stub (./stub-server.mjs), for the T2 suites of workers/site and workers/ops.
//   stubRoute()        register a canned answer (method, path RegExp source, status, headers, body)
//   stubReset()        forget routes and recorded calls
//   stubCalls()        recorded calls (method, path + query, selected headers; never bodies)
//   mintSupabaseJwt()  a token with the shape of a Supabase user JWT (HS256 with a throwaway key): the Worker's
//                      local pre-check accepts it, and its verification is the stub's /auth/v1/user answer
//   mintAccessJwt()    an RS256 Cloudflare Access assertion for a service token (common_name = client id), signed
//                      with a key whose public half is registered at the stub's /cdn-cgi/access/certs
// Built on WebCrypto only (workers/site has no jose). One Access key pair per harness run, kept in the harness temp
// dir, so every T2 file signs with the key the Worker has already cached.

const NODE_FS: string = 'node:fs';
const URLS_FILE = new URL('../../.wrangler/t2/urls.json', (import.meta as unknown as { url: string }).url);
const ACCESS_AUD = 't2-aud';

interface FsLike {
  readFileSync(path: string | URL, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, options?: { flag?: string }): void;
  existsSync(path: string | URL): boolean;
}

export interface StubRoute {
  method: string;
  path: string;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface StubCall {
  method: string;
  path: string;
  headers?: Record<string, string>;
}

async function fs(): Promise<FsLike> {
  return (await import(/* @vite-ignore */ NODE_FS)) as FsLike;
}

interface Urls {
  site: string;
  stub: string;
  tmp: string;
}

async function urls(): Promise<Urls> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  if (env.T2_SITE_URL && env.T2_STUB_URL && env.T2_TMP) return { site: env.T2_SITE_URL, stub: env.T2_STUB_URL, tmp: env.T2_TMP };
  const f = await fs();
  if (!f.existsSync(URLS_FILE)) throw new Error('no T2 harness: T2_STUB_URL is not set and workers/site/.wrangler/t2/urls.json does not exist');
  return JSON.parse(f.readFileSync(URLS_FILE, 'utf8')) as Urls;
}

async function control(path: string, body?: unknown): Promise<Response> {
  const { stub } = await urls();
  const res = await fetch(`${stub}${path}`, body === undefined && path === '/__stub/calls'
    ? undefined
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`stub control ${path}: ${res.status} ${await res.text()}`);
  return res;
}

export async function stubRoute(route: StubRoute): Promise<void> {
  await control('/__stub/routes', route);
}

export async function stubReset(): Promise<void> {
  await control('/__stub/reset');
}

export async function stubCalls(): Promise<StubCall[]> {
  return (await (await control('/__stub/calls')).json()) as StubCall[];
}

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintSupabaseJwt(claims: { sub: string; email?: string; exp?: number }): Promise<string> {
  const { stub } = await urls();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: `${stub}/auth/v1`,
    sub: claims.sub,
    aud: 'authenticated',
    role: 'authenticated',
    email: claims.email,
    iat: now,
    exp: claims.exp ?? now + 600,
  };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // A throwaway key: nothing verifies this signature locally; the stub's /auth/v1/user answer decides.
  const key = (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign'])) as CryptoKey;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
  return `${input}.${base64url(signature)}`;
}

interface AccessKey {
  kid: string;
  privateKey: CryptoKey;
}

let accessKey: Promise<AccessKey> | undefined;

async function loadOrCreateAccessKey(): Promise<AccessKey> {
  const { tmp } = await urls();
  const f = await fs();
  const file = `${tmp}/t2-access-key.json`;
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  if (!f.existsSync(file)) {
    const pair = (await crypto.subtle.generateKey({ ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const kid = `t2-${crypto.randomUUID()}`;
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    try {
      f.writeFileSync(file, JSON.stringify({ kid, privateJwk, publicJwk }), { flag: 'wx' });
    } catch {
      // Another T2 file created it first: use that one.
    }
  }
  const saved = JSON.parse(f.readFileSync(file, 'utf8')) as { kid: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey };
  await control('/__stub/access-keys', { keys: [{ ...saved.publicJwk, kid: saved.kid, alg: 'RS256', use: 'sig' }] });
  const privateKey = await crypto.subtle.importKey('jwk', saved.privateJwk, algorithm, false, ['sign']);
  return { kid: saved.kid, privateKey };
}

export async function mintAccessJwt(claims: { commonName: string }): Promise<string> {
  accessKey ??= loadOrCreateAccessKey();
  const { kid, privateKey } = await accessKey;
  const { stub } = await urls();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    aud: [ACCESS_AUD],
    iss: new URL(stub).origin,
    common_name: claims.commonName,
    sub: '',
    type: 'app',
    iat: now,
    nbf: now - 5,
    exp: now + 300,
  };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(input)));
  return `${input}.${base64url(signature)}`;
}
