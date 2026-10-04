// S3 API access with aws4fetch: R2 (S3-compatible endpoint) and the legacy AWS S3 buckets. Presigned PUT URLs
// sign Content-Type (and Content-Length when given), so the upload must use the type it was presigned for.

export interface S3Target {
  endpoint: string;
  bucket: string;
  region: string;
  style: 'path' | 'virtual';
  accessKeyId: string;
  secretAccessKey: string;
}

export function r2Target(accountId: string, jurisdiction: 'eu' | '', bucket: string, accessKeyId: string, secretAccessKey: string): S3Target {
  throw new Error('not implemented: S');
}

export function legacyTarget(bucket: string, region: string, accessKeyId: string, secretAccessKey: string): S3Target {
  throw new Error('not implemented: S');
}

/** `https://${bucket}.s3.${region}.amazonaws.com/${key}`, raw key. */
export function legacyPublicUrl(bucket: string, region: string, key: string): string {
  throw new Error('not implemented: S');
}

export function presignPut(
  t: S3Target,
  key: string,
  contentType: string,
  expiresSec: number,
  o?: { contentLength?: number; datetime?: string },
): Promise<string> {
  throw new Error('not implemented: S');
}

export function presignGet(t: S3Target, key: string, expiresSec: number, o?: { datetime?: string }): Promise<string> {
  throw new Error('not implemented: S');
}

export function signedDelete(t: S3Target, key: string, fetchImpl?: typeof fetch): Promise<void> {
  throw new Error('not implemented: S');
}

export function headObject(t: S3Target, key: string, fetchImpl?: typeof fetch): Promise<boolean> {
  throw new Error('not implemented: S');
}

/** ListObjectsV2, first page only (at most 1,000 keys). */
export function listFirstPage(t: S3Target, prefix: string, fetchImpl?: typeof fetch): Promise<Array<{ key: string; lastModified: string }>> {
  throw new Error('not implemented: S');
}
