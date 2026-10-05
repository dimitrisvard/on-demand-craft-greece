// src/auth/agent-hmac.ts: the relay signature (pinned vector shared with tests/edge/telegram-callback.test.ts),
// the replay set, signed partner links against an independent node:crypto implementation, and staff file keys.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  PARTNER_FILE_KEY_RE,
  RELAY_REPLAY_MS,
  SeenSignatures,
  STAFF_FILE_KEY_RE,
  hasRelayHeaders,
  rawQueryValues,
  relaySignature,
  staffFileKey,
  verifyFileLink,
  verifyRelayRequest,
} from '../src/auth/agent-hmac';

// node:crypto loaded by a variable specifier (the Workers type set of this package declares only part of it).
const NODE_CRYPTO: string = 'node:crypto';
interface NodeCrypto {
  createHmac(algorithm: string, key: string | Uint8Array): { update(data: string): { digest(encoding: 'hex' | 'base64url'): string } };
  hkdfSync(digest: string, ikm: string, salt: Uint8Array, info: string, length: number): ArrayBuffer;
}
let nodeCrypto: NodeCrypto;
beforeAll(async () => {
  nodeCrypto = (await import(/* @vite-ignore */ NODE_CRYPTO)) as NodeCrypto;
});


// Pinned vector: the relay (supabase/functions/telegram-leads-bot/agent-callback.ts) must produce exactly this
// signature for this secret, timestamp and body; the edge test asserts the same hex.
const RELAY_VECTOR = {
  secret: 'relay-fixture-value',
  timestamp: '1760000000',
  body: '{"v":1,"token":"ABCDEFGHIJKLMNOPQRSTUVWXYZ","code":"dis","tg":{"user_id":4242,"chat_id":4242,"message_id":1000}}',
  signature: 'c9be10ba859402e118d4a39bc49ff7e23687e4bd05f5d4638da0cdf85b15e348',
};

const enc = (s: string) => new TextEncoder().encode(s);
const T0 = 1_760_000_000_000;
const ORDER = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';

function headers(timestamp: string, signature: string): Headers {
  return new Headers({ 'X-Microns-Timestamp': timestamp, 'X-Microns-Signature': signature });
}

describe('relay signature', () => {
  it('matches the pinned vector and node:crypto', async () => {
    expect(await relaySignature(RELAY_VECTOR.secret, RELAY_VECTOR.timestamp, enc(RELAY_VECTOR.body))).toBe(RELAY_VECTOR.signature);
    expect(nodeCrypto.createHmac('sha256', RELAY_VECTOR.secret).update(`${RELAY_VECTOR.timestamp}.${RELAY_VECTOR.body}`).digest('hex')).toBe(RELAY_VECTOR.signature);
  });

  it('verifies the pinned vector at its time; upper-case hex accepted; one byte of body changed refused', async () => {
    const seen = new SeenSignatures();
    expect(await verifyRelayRequest(headers(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature.toUpperCase()), enc(RELAY_VECTOR.body), RELAY_VECTOR.secret, T0, seen)).toEqual({ ok: true });
    expect(await verifyRelayRequest(headers(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature), enc(`${RELAY_VECTOR.body} `), RELAY_VECTOR.secret, T0, new SeenSignatures())).toEqual({ ok: false, reason: 'signature' });
  });

  it('window, header formats, replay', async () => {
    const body = enc(RELAY_VECTOR.body);
    const check = (ts: string, sig: string, now: number, seen = new SeenSignatures()) => verifyRelayRequest(headers(ts, sig), body, RELAY_VECTOR.secret, now, seen);
    expect(await check(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature, T0 + 300_999)).toEqual({ ok: true });
    expect(await check(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature, T0 + 301_000)).toEqual({ ok: false, reason: 'window' });
    expect(await check(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature, T0 - 301_000)).toEqual({ ok: false, reason: 'window' });
    expect(await check('', RELAY_VECTOR.signature, T0)).toEqual({ ok: false, reason: 'headers' });
    expect(await check(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature.slice(2), T0)).toEqual({ ok: false, reason: 'headers' });
    const seen = new SeenSignatures();
    expect(await check(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature, T0, seen)).toEqual({ ok: true });
    expect(await check(RELAY_VECTOR.timestamp, RELAY_VECTOR.signature, T0 + 1000, seen)).toEqual({ ok: false, reason: 'replay' });
  });

  it('relay headers: either header counts', () => {
    expect(hasRelayHeaders(new Headers({ 'x-microns-timestamp': '1' }))).toBe(true);
    expect(hasRelayHeaders(new Headers({ 'X-Microns-Signature': 'a' }))).toBe(true);
    expect(hasRelayHeaders(new Headers({ authorization: 'Bearer x' }))).toBe(false);
  });
});

describe('SeenSignatures', () => {
  it('refuses a signature again until its 10-minute expiry, then accepts it', () => {
    const seen = new SeenSignatures();
    expect(seen.add('s', 0)).toBe(true);
    expect(seen.add('s', RELAY_REPLAY_MS - 1)).toBe(false);
    expect(seen.add('s', RELAY_REPLAY_MS)).toBe(true);
  });

  it('stays bounded: expired entries are pruned, then the oldest is dropped', () => {
    const seen = new SeenSignatures(1000, 3);
    seen.add('a', 0);
    seen.add('b', 0);
    seen.add('c', 0);
    seen.add('d', 2000);
    expect(seen.size).toBe(1);
    seen.add('e', 2000);
    seen.add('f', 2000);
    seen.add('g', 2000);
    expect(seen.size).toBe(3);
    expect(seen.add('e', 2001)).toBe(false);
    expect(seen.add('d', 2001)).toBe(true);
  });
});

describe('signed partner links', () => {
  const secret = 'link-fixture-value';
  const sig = (key: string, exp: number) => nodeCrypto.createHmac('sha256', new Uint8Array(nodeCrypto.hkdfSync('sha256', secret, new Uint8Array(0), 'microns-file-link-v1', 32))).update(`${key}|${exp}`).digest('base64url');
  const key = `orders/${ORDER}/traveler.pdf`;
  const exp = T0 / 1000 + 3600;

  it('accepts a link signed with HKDF-SHA256 + HMAC-SHA256 (node:crypto) within 7 days', async () => {
    expect(await verifyFileLink(secret, key, String(exp), sig(key, exp), T0)).toBe(true);
    expect(await verifyFileLink(secret, key, String(T0 / 1000 + 7 * 86400), sig(key, T0 / 1000 + 7 * 86400), T0)).toBe(true);
  });

  it('refuses expiry in the past or beyond 7 days, other keys, malformed signatures', async () => {
    expect(await verifyFileLink(secret, key, String(T0 / 1000), sig(key, T0 / 1000), T0)).toBe(false);
    expect(await verifyFileLink(secret, key, String(T0 / 1000 + 7 * 86400 + 1), sig(key, T0 / 1000 + 7 * 86400 + 1), T0)).toBe(false);
    expect(await verifyFileLink(secret, `quotes/${ORDER}/v1/quote.pdf`, String(exp), sig(`quotes/${ORDER}/v1/quote.pdf`, exp), T0)).toBe(false);
    expect(await verifyFileLink(secret, key, String(exp), `${sig(key, exp)}=`, T0)).toBe(false);
    expect(await verifyFileLink(secret, key, String(exp), sig(key, exp).slice(1), T0)).toBe(false);
    expect(await verifyFileLink(secret, key, `${exp}.0`, sig(key, exp), T0)).toBe(false);
  });

  it('partner and staff key patterns', () => {
    expect(PARTNER_FILE_KEY_RE.test(`cad/${ORDER}/output/drawing.pdf`)).toBe(true);
    expect(PARTNER_FILE_KEY_RE.test(`cad/${ORDER}/output/flat.svg`)).toBe(false);
    expect(STAFF_FILE_KEY_RE.test(`cad/${ORDER}/output/flat.svg`)).toBe(true);
    expect(STAFF_FILE_KEY_RE.test(`email/${'0'.repeat(64)}/att/12-${'a'.repeat(100)}`)).toBe(true);
    expect(STAFF_FILE_KEY_RE.test(`email/${'0'.repeat(64)}/att/12-${'a'.repeat(101)}`)).toBe(false);
  });
});

describe('staff file keys', () => {
  it('raw query values keep their encoding', () => {
    expect(rawQueryValues('?k=a%2Fb&x=1&k=c', 'k')).toEqual(['a%2Fb', 'c']);
    expect(rawQueryValues('', 'k')).toEqual([]);
  });

  it('decoded key returned only when allowed', () => {
    expect(staffFileKey(`?k=orders/${ORDER}/traveler.pdf`)).toBe(`orders/${ORDER}/traveler.pdf`);
    expect(staffFileKey(`?k=orders%2F${ORDER}/traveler.pdf`)).toBeNull();
    expect(staffFileKey(`?k=orders%2f${ORDER}/traveler.pdf`)).toBeNull();
    expect(staffFileKey(`?k=orders/${ORDER}/traveler.pdf%5C`)).toBeNull();
    expect(staffFileKey(`?k=orders/${ORDER}/..traveler.pdf`)).toBeNull();
    expect(staffFileKey('?k=%E0%A4%A')).toBeNull();
    expect(staffFileKey(`?x=orders/${ORDER}/traveler.pdf`)).toBeNull();
  });
});
