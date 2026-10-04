// S3 API access with aws4fetch: R2 (S3-compatible endpoint) and the legacy AWS S3 buckets. Presigned PUT URLs
// sign Content-Type (and Content-Length when given), so the upload must use the type it was presigned for.
//
// Rules this module enforces for every URL it builds or signs:
// - The object key is percent-encoded per path segment (RFC 3986), so the signed path is exactly the key.
// - A key with an empty name, or with a "." or ".." path segment, is refused: URL parsers (browsers, fetch)
//   resolve dot segments, so such a URL would address a different object than the one that was checked.
// - A presigned URL lives at most 604,800 s (7 days), the SigV4 maximum on S3 and R2.

import { AwsV4Signer } from 'aws4fetch';
import { parseListObjectsV2, parseS3Error } from './s3-xml';

export interface S3Target {
  endpoint: string;
  bucket: string;
  region: string;
  style: 'path' | 'virtual';
  accessKeyId: string;
  secretAccessKey: string;
}

/** SigV4 maximum lifetime of a presigned URL, in seconds. */
export const MAX_PRESIGN_EXPIRES_SEC = 604_800;

/** Same wording as the AWS SDK presigner, so an over-long expiry answers the same error text. */
export const PRESIGN_EXPIRES_ERROR =
  'Signature version 4 presigned URLs must have an expiration date less than one week in the future';

export function r2Target(accountId: string, jurisdiction: 'eu' | '', bucket: string, accessKeyId: string, secretAccessKey: string): S3Target {
  const host = jurisdiction ? `${accountId}.${jurisdiction}.r2.cloudflarestorage.com` : `${accountId}.r2.cloudflarestorage.com`;
  return { endpoint: `https://${host}`, bucket, region: 'auto', style: 'path', accessKeyId, secretAccessKey };
}

// A bucket name is used as a host label only when it is one DNS label (no dots): a dotted name does not match
// the endpoint's wildcard TLS certificate, so it is addressed path style instead (as the AWS SDK does).
const VIRTUAL_HOSTABLE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function legacyTarget(bucket: string, region: string, accessKeyId: string, secretAccessKey: string): S3Target {
  const style = VIRTUAL_HOSTABLE.test(bucket) ? 'virtual' : 'path';
  return { endpoint: `https://s3.${region}.amazonaws.com`, bucket, region, style, accessKeyId, secretAccessKey };
}

/** `https://${bucket}.s3.${region}.amazonaws.com/${key}`, raw key. */
export function legacyPublicUrl(bucket: string, region: string, key: string): string {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

// ----- URLs -----

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function encodeQuery(params: ReadonlyArray<readonly [string, string]>): string {
  return params.map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).join('&');
}

/** URL of the bucket root (no trailing slash for path style, '/' for virtual-host style). */
function bucketUrl(t: S3Target): URL {
  const base = new URL(t.endpoint);
  if (t.style === 'virtual') {
    base.hostname = `${t.bucket}.${base.hostname}`;
    base.pathname = '/';
  } else {
    base.pathname = `/${encodeSegment(t.bucket)}`;
  }
  base.search = '';
  base.hash = '';
  return base;
}

/** URL of one object; refuses keys that a URL cannot address unchanged. */
export function objectUrl(t: S3Target, key: string): URL {
  if (key.length === 0) throw new Error('Object key is empty');
  const segments = key.split('/');
  if (segments.some((s) => s === '.' || s === '..')) {
    throw new Error('Object key has a "." or ".." path segment');
  }
  const encodedKey = segments.map(encodeSegment).join('/');
  const url = bucketUrl(t);
  const expected = t.style === 'virtual' ? `/${encodedKey}` : `${url.pathname}/${encodedKey}`;
  url.pathname = expected;
  // Defence in depth: the parsed path must be exactly the encoded key (no normalisation happened).
  if (url.pathname !== expected) throw new Error('Object key cannot be addressed by a URL unchanged');
  return url;
}

// ----- signing -----

function checkExpires(expiresSec: number): void {
  if (expiresSec > MAX_PRESIGN_EXPIRES_SEC) throw new Error(PRESIGN_EXPIRES_ERROR);
}

async function presign(
  t: S3Target,
  method: 'GET' | 'PUT',
  key: string,
  expiresSec: number,
  headers: Record<string, string>,
  datetime: string | undefined,
): Promise<string> {
  checkExpires(expiresSec);
  const url = objectUrl(t, key);
  // Set before signing: the signature covers X-Amz-Expires (aws4fetch would otherwise default to 86,400 s).
  url.search = encodeQuery([['X-Amz-Expires', String(expiresSec)]]);
  const signer = new AwsV4Signer({
    method,
    url: url.toString(),
    headers,
    accessKeyId: t.accessKeyId,
    secretAccessKey: t.secretAccessKey,
    service: 's3',
    region: t.region,
    signQuery: true,
    // Sign Content-Type and Content-Length too: a PUT with another type or size is refused by the store.
    allHeaders: true,
    datetime,
  });
  const signed = await signer.sign();
  return signed.url.toString();
}

export function presignPut(
  t: S3Target,
  key: string,
  contentType: string,
  expiresSec: number,
  o?: { contentLength?: number; datetime?: string },
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (o?.contentLength !== undefined) headers['Content-Length'] = String(o.contentLength);
  return presign(t, 'PUT', key, expiresSec, headers, o?.datetime);
}

export function presignGet(t: S3Target, key: string, expiresSec: number, o?: { datetime?: string }): Promise<string> {
  return presign(t, 'GET', key, expiresSec, {}, o?.datetime);
}

/** Header-signed request (Authorization header), sent through fetchImpl. */
async function signedFetch(t: S3Target, method: string, url: URL, fetchImpl: typeof fetch): Promise<Response> {
  const signer = new AwsV4Signer({
    method,
    url: url.toString(),
    accessKeyId: t.accessKeyId,
    secretAccessKey: t.secretAccessKey,
    service: 's3',
    region: t.region,
  });
  const signed = await signer.sign();
  return fetchImpl(signed.url.toString(), { method, headers: signed.headers });
}

async function s3Failure(operation: string, res: Response): Promise<Error> {
  const text = await res.text().catch(() => '');
  const { code, message } = parseS3Error(text);
  return new Error(message || code || `${operation} failed with status ${res.status}`);
}

export async function signedDelete(t: S3Target, key: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await signedFetch(t, 'DELETE', objectUrl(t, key), fetchImpl);
  if (!res.ok) throw await s3Failure('DeleteObject', res);
  await res.body?.cancel();
}

/** true: the object exists; false: 404. Any other answer throws. */
export async function headObject(t: S3Target, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await signedFetch(t, 'HEAD', objectUrl(t, key), fetchImpl);
  await res.body?.cancel();
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`HeadObject failed with status ${res.status}`);
}

/** ListObjectsV2, first page only (at most 1,000 keys). */
export async function listFirstPage(t: S3Target, prefix: string, fetchImpl: typeof fetch = fetch): Promise<Array<{ key: string; lastModified: string }>> {
  const url = bucketUrl(t);
  url.search = encodeQuery([['list-type', '2'], ['prefix', prefix]]);
  const res = await signedFetch(t, 'GET', url, fetchImpl);
  if (!res.ok) throw await s3Failure('ListObjectsV2', res);
  return parseListObjectsV2(await res.text());
}
