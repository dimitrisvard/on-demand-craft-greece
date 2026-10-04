// verifySvix against the svix library (oracle): signatures are produced by svix's own Webhook.sign at runtime and
// accept/reject decisions are compared with Webhook.verify where both apply.
import { Webhook } from 'svix';
import { describe, expect, it } from 'vitest';
import { verifySvix } from '../../src/auth/svix';

// Built at runtime: the secret is a test value, not a credential.
const SECRET = 'whsec_' + btoa('microns-svix-test-key-NOT-A-SECRET');
const OTHER_SECRET = 'whsec_' + btoa('another-svix-test-key-NOT-A-SECRET');
const NOW = 1_790_000_000;
const encoder = new TextEncoder();
const BODY = '{"type":"email.bounced","created_at":"2026-10-04T10:00:00.000Z","data":{"email_id":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c","bounce":{"type":"hard"}}}';

function signed(o: { secret?: string; id?: string; ts?: number; body?: string } = {}): Headers {
  const id = o.id ?? 'msg_2mBqB0aVPpWjzWRVYhyKy3LXuGD';
  const ts = o.ts ?? NOW;
  const signature = new Webhook(o.secret ?? SECRET).sign(id, new Date(ts * 1000), o.body ?? BODY);
  return new Headers({ 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': signature });
}

function run(headers: Headers, body = BODY, secret = SECRET, now = NOW) {
  return verifySvix({ secret, headers, rawBody: encoder.encode(body), nowSec: () => now });
}

describe('verifySvix', () => {
  it('accepts a vector signed by the svix library', async () => {
    const headers = signed();
    expect(await run(headers)).toEqual({ ok: true, id: 'msg_2mBqB0aVPpWjzWRVYhyKy3LXuGD', timestamp: NOW });
  });

  it('agrees with svix Webhook.verify on the same vector (oracle)', async () => {
    const headers = signed({ ts: Math.floor(Date.now() / 1000) });
    const plain = Object.fromEntries(headers.entries());
    expect(() => new Webhook(SECRET).verify(BODY, plain)).not.toThrow();
    const result = await verifySvix({ secret: SECRET, headers, rawBody: encoder.encode(BODY) });
    expect(result.ok).toBe(true);
  });

  it('rejects a changed body', async () => {
    expect(await run(signed(), BODY.replace('hard', 'soft'))).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a body that differs only in whitespace (raw bytes are signed)', async () => {
    expect(await run(signed(), JSON.stringify(JSON.parse(BODY), null, 1))).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature made with another key', async () => {
    expect(await run(signed({ secret: OTHER_SECRET }))).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('accepts a secret given without the whsec_ prefix', async () => {
    expect((await run(signed(), BODY, SECRET.slice('whsec_'.length))).ok).toBe(true);
  });

  it('rejects timestamps 301 s in the past or the future and accepts 300 s', async () => {
    expect(await run(signed({ ts: NOW - 301 }))).toEqual({ ok: false, reason: 'bad_timestamp' });
    expect(await run(signed({ ts: NOW + 301 }))).toEqual({ ok: false, reason: 'bad_timestamp' });
    expect((await run(signed({ ts: NOW - 300 }))).ok).toBe(true);
    expect((await run(signed({ ts: NOW + 300 }))).ok).toBe(true);
  });

  it('rejects a timestamp that is not an integer', async () => {
    const headers = signed();
    headers.set('svix-timestamp', `${NOW}.5`);
    expect(await run(headers)).toEqual({ ok: false, reason: 'bad_timestamp' });
    headers.set('svix-timestamp', 'abc');
    expect(await run(headers)).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  it('accepts when any of several v1 entries matches, and ignores other versions', async () => {
    const good = signed().get('svix-signature')!;
    const bad = signed({ secret: OTHER_SECRET }).get('svix-signature')!;
    const headers = signed();
    headers.set('svix-signature', `${bad} v2,${good.slice(3)} ${good}`);
    expect((await run(headers)).ok).toBe(true);
    headers.set('svix-signature', `${bad} v2,${good.slice(3)}`);
    expect(await run(headers)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects when a header is missing', async () => {
    for (const name of ['svix-id', 'svix-timestamp', 'svix-signature']) {
      const headers = signed();
      headers.delete(name);
      expect(await run(headers)).toEqual({ ok: false, reason: 'missing_headers' });
    }
  });

  it('reports a missing secret before anything else', async () => {
    expect(await run(new Headers(), BODY, '')).toEqual({ ok: false, reason: 'missing_secret' });
  });

  it('signs the svix-id as received (a different id fails)', async () => {
    const headers = signed();
    headers.set('svix-id', 'msg_other');
    expect(await run(headers)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('verifies non-ASCII bodies byte for byte', async () => {
    const body = '{"type":"email.delivered","data":{"email_id":"x","subject":"Προσφορά ✓"}}';
    expect((await run(signed({ body }), body)).ok).toBe(true);
  });
});
