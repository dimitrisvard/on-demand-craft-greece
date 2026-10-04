import { Sha256 } from '@aws-crypto/sha256-js';
import { SignatureV4 } from '@smithy/signature-v4';
import { describe, expect, it } from 'vitest';
import {
  MAX_PRESIGN_EXPIRES_SEC,
  PRESIGN_EXPIRES_ERROR,
  headObject,
  legacyPublicUrl,
  legacyTarget,
  listFirstPage,
  objectUrl,
  presignGet,
  presignPut,
  r2Target,
  signedDelete,
  type S3Target,
} from '../../src/storage/s3-presign';
import { createFakeS3, type FakeBucketConfig } from '../helpers/fake-s3';

// Test credentials are built at run time (never a key-shaped literal in the repository).
const ACCOUNT = 'f'.repeat(32);
const R2_KEY_ID = ['r2', 'test', 'id'].join('-');
const R2_SECRET = ['r2', 'test', 'secret', 'not', 'real'].join('/');
const AWS_KEY_ID = ['legacy', 'test', 'id'].join('-');
const AWS_SECRET = ['legacy', 'test', 'secret', 'not', 'real'].join('/');
const DATETIME = '20261002T120000Z';
const SIGNING_DATE = new Date('2026-10-02T12:00:00Z');

const r2 = r2Target(ACCOUNT, '', 'microns-private', R2_KEY_ID, R2_SECRET);
const r2eu = r2Target(ACCOUNT, 'eu', 'microns-private', R2_KEY_ID, R2_SECRET);
const legacy = legacyTarget('example-rfq-bucket', 'eu-north-1', AWS_KEY_ID, AWS_SECRET);

/** Presigned URL the AWS SDK's signer produces for the same request (independent oracle). */
async function smithyPresign(
  t: S3Target,
  host: string,
  encodedPath: string,
  method: 'GET' | 'PUT',
  expiresIn: number,
  headers: Record<string, string> = {},
): Promise<URLSearchParams> {
  const signer = new SignatureV4({
    credentials: { accessKeyId: t.accessKeyId, secretAccessKey: t.secretAccessKey },
    region: t.region,
    service: 's3',
    sha256: Sha256,
    uriEscapePath: false,
    applyChecksum: false,
  });
  const keep = new Set(['x-amz-content-sha256']);
  const signed = await signer.presign(
    { method, protocol: 'https:', hostname: host, path: encodedPath, query: {}, headers: { host, ...headers, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' } },
    { signingDate: SIGNING_DATE, expiresIn, unhoistableHeaders: keep, unsignableHeaders: keep },
  );
  return new URLSearchParams(signed.query as Record<string, string>);
}

interface GoldenCase {
  name: string;
  target: S3Target;
  key: string;
  method: 'GET' | 'PUT';
  expires: number;
  contentType?: string;
  contentLength?: number;
  /** The URL up to the query, written out by hand. */
  base: string;
}

const KEY = 'RFQ-02102026-1/part-1/drawing_v2.step';
const golden: GoldenCase[] = [
  { name: 'R2 PUT, Content-Type signed', target: r2, key: `rfq/${KEY}`, method: 'PUT', expires: 300, contentType: 'application/octet-stream', base: `https://${ACCOUNT}.r2.cloudflarestorage.com/microns-private/rfq/${KEY}` },
  { name: 'R2 PUT, Content-Type and Content-Length signed', target: r2, key: `rfq/${KEY}`, method: 'PUT', expires: 300, contentType: 'model/step', contentLength: 123456, base: `https://${ACCOUNT}.r2.cloudflarestorage.com/microns-private/rfq/${KEY}` },
  { name: 'R2 GET', target: r2, key: `rfq/${KEY}`, method: 'GET', expires: 3600, base: `https://${ACCOUNT}.r2.cloudflarestorage.com/microns-private/rfq/${KEY}` },
  { name: 'R2 EU jurisdiction PUT', target: r2eu, key: 'rfq/a/b.dxf', method: 'PUT', expires: 300, contentType: 'application/dxf', base: `https://${ACCOUNT}.eu.r2.cloudflarestorage.com/microns-private/rfq/a/b.dxf` },
  { name: 'R2 EU jurisdiction GET', target: r2eu, key: 'rfq/a/b.dxf', method: 'GET', expires: 60, base: `https://${ACCOUNT}.eu.r2.cloudflarestorage.com/microns-private/rfq/a/b.dxf` },
  { name: 'legacy S3 eu-north-1 GET (virtual host)', target: legacy, key: 'RFQ-1/file_1.pdf', method: 'GET', expires: 3600, base: 'https://example-rfq-bucket.s3.eu-north-1.amazonaws.com/RFQ-1/file_1.pdf' },
  { name: 'legacy S3 eu-north-1 PUT (articles)', target: legacyTarget('example-articles', 'eu-north-1', AWS_KEY_ID, AWS_SECRET), key: 'featured/42/hero.png', method: 'PUT', expires: 300, contentType: 'image/png', base: 'https://example-articles.s3.eu-north-1.amazonaws.com/featured/42/hero.png' },
  { name: 'legacy S3 GET, key with space, plus, parentheses and non-ASCII', target: legacy, key: 'RFQ-1/folder x/file (1)+ü!.pdf', method: 'GET', expires: 3600, base: 'https://example-rfq-bucket.s3.eu-north-1.amazonaws.com/RFQ-1/folder%20x/file%20%281%29%2B%C3%BC%21.pdf' },
];

describe('presigned URLs equal the AWS SDK signer (golden)', () => {
  for (const c of golden) {
    it(c.name, async () => {
      const url = new URL(
        c.method === 'PUT'
          ? await presignPut(c.target, c.key, c.contentType as string, c.expires, { contentLength: c.contentLength, datetime: DATETIME })
          : await presignGet(c.target, c.key, c.expires, { datetime: DATETIME }),
      );
      expect(`${url.origin}${url.pathname}`).toBe(c.base);
      const headers: Record<string, string> = {};
      if (c.contentType) headers['content-type'] = c.contentType;
      if (c.contentLength !== undefined) headers['content-length'] = String(c.contentLength);
      const oracle = await smithyPresign(c.target, url.host, url.pathname, c.method, c.expires, headers);
      for (const name of ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature']) {
        expect(url.searchParams.get(name), name).toBe(oracle.get(name));
      }
      expect([...url.searchParams.keys()].sort()).toEqual([...oracle.keys()].sort());
    });
  }

  it('signs Content-Type: another type gives another signature', async () => {
    const a = new URL(await presignPut(r2, 'rfq/x.step', 'model/step', 300, { datetime: DATETIME }));
    const b = new URL(await presignPut(r2, 'rfq/x.step', 'application/octet-stream', 300, { datetime: DATETIME }));
    expect(a.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(a.searchParams.get('X-Amz-Signature')).not.toBe(b.searchParams.get('X-Amz-Signature'));
  });

  it('signs Content-Length only when given', async () => {
    const without = new URL(await presignPut(r2, 'rfq/x.step', 'model/step', 300, { datetime: DATETIME }));
    const withLength = new URL(await presignPut(r2, 'rfq/x.step', 'model/step', 300, { contentLength: 10, datetime: DATETIME }));
    expect(without.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(withLength.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
  });

  it('sets X-Amz-Expires to the requested value', async () => {
    for (const expires of [1, 300, 3600, MAX_PRESIGN_EXPIRES_SEC]) {
      const url = new URL(await presignGet(r2, 'rfq/x', expires));
      expect(url.searchParams.get('X-Amz-Expires')).toBe(String(expires));
    }
    const put = new URL(await presignPut(r2, 'rfq/x', 'text/plain', 300));
    expect(put.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('refuses an expiry above 7 days with the AWS SDK error text', async () => {
    await expect(presignGet(r2, 'rfq/x', MAX_PRESIGN_EXPIRES_SEC + 1)).rejects.toThrow(PRESIGN_EXPIRES_ERROR);
    await expect(presignPut(r2, 'rfq/x', 'text/plain', Infinity)).rejects.toThrow(PRESIGN_EXPIRES_ERROR);
    expect(PRESIGN_EXPIRES_ERROR).toBe('Signature version 4 presigned URLs must have an expiration date less than one week in the future');
  });

  it('uses the current time when no datetime is given', async () => {
    const before = Date.now();
    const url = new URL(await presignGet(r2, 'rfq/x', 60));
    const d = url.searchParams.get('X-Amz-Date') as string;
    const ms = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15));
    expect(Math.abs(ms - before)).toBeLessThan(5000);
  });
});

describe('targets and URLs', () => {
  it('builds the R2 endpoint with and without the EU jurisdiction', () => {
    expect(r2).toMatchObject({ endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`, region: 'auto', style: 'path', bucket: 'microns-private' });
    expect(r2eu.endpoint).toBe(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com`);
  });

  it('addresses one-label legacy buckets by virtual host and dotted names path style', () => {
    expect(legacy).toMatchObject({ endpoint: 'https://s3.eu-north-1.amazonaws.com', region: 'eu-north-1', style: 'virtual' });
    const dotted = legacyTarget('my.bucket', 'eu-north-1', AWS_KEY_ID, AWS_SECRET);
    expect(dotted.style).toBe('path');
    expect(objectUrl(dotted, 'a/b').toString()).toBe('https://s3.eu-north-1.amazonaws.com/my.bucket/a/b');
  });

  it('formats the legacy public URL with the raw key', () => {
    expect(legacyPublicUrl('example-rfq-bucket', 'eu-north-1', 'RFQ-1/a b.pdf')).toBe('https://example-rfq-bucket.s3.eu-north-1.amazonaws.com/RFQ-1/a b.pdf');
  });

  it('refuses keys a URL cannot address unchanged', () => {
    for (const key of ['', 'a/../b', '../x', 'a/./b', 'a/.', 'a/..', '.']) {
      expect(() => objectUrl(r2, key), JSON.stringify(key)).toThrow();
    }
    expect(objectUrl(r2, 'a/.../b..c/.d').pathname).toBe('/microns-private/a/.../b..c/.d');
    expect(objectUrl(legacy, 'a//b/').pathname).toBe('/a//b/');
    expect(objectUrl(r2, 'a%2e%2e/b').pathname).toBe('/microns-private/a%252e%252e/b');
  });

  it('never lets a presigned URL reach another object through dot segments', async () => {
    await expect(presignPut(r2, 'rfq/RFQ-1/../RFQ-2/x.step', 'model/step', 300)).rejects.toThrow('"." or ".."');
    await expect(presignGet(legacy, 'RFQ-1/../../x', 60)).rejects.toThrow('"." or ".."');
  });
});

// ----- signed calls against the fake S3 (re-verifies every signature with the SDK signer) -----

const R2_BUCKET: FakeBucketConfig = { name: 'microns-private', host: `${ACCOUNT}.eu.r2.cloudflarestorage.com`, style: 'path', region: 'auto', accessKeyId: R2_KEY_ID, secretAccessKey: R2_SECRET };
const LEGACY_BUCKET: FakeBucketConfig = { name: 'example-rfq-bucket', host: 'example-rfq-bucket.s3.eu-north-1.amazonaws.com', style: 'virtual', region: 'eu-north-1', accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET };

describe('signed S3 calls (fake S3)', () => {
  it('PUT through a presigned URL then GET returns the same bytes', async () => {
    const fake = createFakeS3([R2_BUCKET, LEGACY_BUCKET]);
    const bytes = crypto.getRandomValues(new Uint8Array(4096));
    const put = await presignPut(r2eu, 'rfq/RFQ-1/a b+c.step', 'model/step', 300, { contentLength: bytes.byteLength });
    const res = await fake.fetch(put, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'model/step' } });
    expect(res.status).toBe(200);
    expect(fake.keys('microns-private')).toEqual(['rfq/RFQ-1/a b+c.step']);
    const get = await fake.fetch(await presignGet(r2eu, 'rfq/RFQ-1/a b+c.step', 60));
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
  });

  it('the fake refuses a PUT whose Content-Type or Content-Length differs from the signed one', async () => {
    const fake = createFakeS3([R2_BUCKET]);
    const put = await presignPut(r2eu, 'rfq/x.step', 'model/step', 300, { contentLength: 3 });
    const wrongType = await fake.fetch(put, { method: 'PUT', body: new Uint8Array(3), headers: { 'Content-Type': 'text/html' } });
    expect(wrongType.status).toBe(403);
    expect(await wrongType.text()).toContain('SignatureDoesNotMatch');
    const wrongSize = await fake.fetch(put, { method: 'PUT', body: new Uint8Array(4), headers: { 'Content-Type': 'model/step' } });
    expect(wrongSize.status).toBe(403);
    expect(fake.keys('microns-private')).toEqual([]);
  });

  it('the fake refuses tampered, expired and wrongly scoped URLs', async () => {
    let now = Date.now();
    const fake = createFakeS3([R2_BUCKET, LEGACY_BUCKET], { now: () => now });
    fake.seed('microns-private', 'rfq/x', 'hello');
    const url = new URL(await presignGet(r2eu, 'rfq/x', 60));
    url.searchParams.set('X-Amz-Expires', '61');
    expect((await fake.fetch(url.toString())).status).toBe(403);
    const ok = await presignGet(r2eu, 'rfq/x', 60);
    expect((await fake.fetch(ok)).status).toBe(200);
    now += 61_000;
    expect((await fake.fetch(ok)).status).toBe(403);
    const wrongCreds = { ...r2eu, accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET };
    now = Date.now();
    expect((await fake.fetch(await presignGet(wrongCreds, 'rfq/x', 60))).status).toBe(403);
    // Without the jurisdiction the host is another endpoint: nothing answers there.
    await expect(fake.fetch(await presignGet(r2, 'rfq/x', 60))).rejects.toThrow('fetch failed');
  });

  it('headObject answers true/false and throws on any other status', async () => {
    const fake = createFakeS3([LEGACY_BUCKET]);
    fake.seed('example-rfq-bucket', 'RFQ-1/a.pdf', 'x');
    expect(await headObject(legacy, 'RFQ-1/a.pdf', fake.fetch)).toBe(true);
    expect(await headObject(legacy, 'RFQ-1/b.pdf', fake.fetch)).toBe(false);
    const wrong = { ...legacy, secretAccessKey: 'other' };
    await expect(headObject(wrong, 'RFQ-1/a.pdf', fake.fetch)).rejects.toThrow('HeadObject failed with status 403');
  });

  it('signedDelete removes the object, succeeds for a missing key and throws with the S3 message on refusal', async () => {
    const fake = createFakeS3([LEGACY_BUCKET]);
    fake.seed('example-rfq-bucket', 'RFQ-1/a.pdf', 'x');
    await signedDelete(legacy, 'RFQ-1/a.pdf', fake.fetch);
    await signedDelete(legacy, 'RFQ-1/missing.pdf', fake.fetch);
    expect(fake.keys('example-rfq-bucket')).toEqual([]);
    const wrong = { ...legacy, secretAccessKey: 'other' };
    await expect(signedDelete(wrong, 'RFQ-1/a.pdf', fake.fetch)).rejects.toThrow('The request signature we calculated does not match the signature you provided');
  });

  it('listFirstPage lists keys under a prefix in S3 order, first 1,000 only, keys decoded', async () => {
    const fake = createFakeS3([LEGACY_BUCKET]);
    const when = new Date('2026-09-30T10:11:12Z');
    fake.seed('example-rfq-bucket', 'RFQ-1/b & <c>.pdf', 'x', { lastModified: when });
    fake.seed('example-rfq-bucket', 'RFQ-1/a "q" \'s\'.pdf', 'x', { lastModified: when });
    fake.seed('example-rfq-bucket', 'RFQ-10/x.pdf', 'x');
    for (let i = 0; i < 1005; i++) fake.seed('example-rfq-bucket', `RFQ-2/${String(i).padStart(4, '0')}`, 'x');
    expect(await listFirstPage(legacy, 'RFQ-1/', fake.fetch)).toEqual([
      { key: 'RFQ-1/a "q" \'s\'.pdf', lastModified: '2026-09-30T10:11:12.000Z' },
      { key: 'RFQ-1/b & <c>.pdf', lastModified: '2026-09-30T10:11:12.000Z' },
    ]);
    expect((await listFirstPage(legacy, 'RFQ-2/', fake.fetch)).length).toBe(1000);
    expect((await listFirstPage(legacy, 'RFQ 1/', fake.fetch)).length).toBe(0);
  });

  it('listFirstPage throws with the S3 message when the request is refused', async () => {
    const fake = createFakeS3([LEGACY_BUCKET]);
    await expect(listFirstPage({ ...legacy, region: 'us-east-1' }, '', fake.fetch)).rejects.toThrow('wrong');
  });
});
