// /api/s3 files API: same actions, statuses and response bodies as api/s3.js, served from R2 (new uploads) with
// read fallback to the legacy S3 buckets; the articles scope stays on legacy S3.
//
// | Action           | rfq scope                                                        | articles scope |
// |------------------|------------------------------------------------------------------|----------------|
// | presign-upload   | presigned PUT to R2 `rfq/<key>`, 300 s, Content-Type signed      | legacy bucket  |
// | presign-download | R2 when `rfq/<key>` exists, else legacy (no existence check)     | legacy bucket  |
// | delete           | R2 and legacy                                                    | legacy bucket  |
// | delete-folder    | first list page of each store under `<prefix>/`; both deleted    | legacy bucket  |
// | list             | first list page of each store, merged (R2 wins), in key order    | legacy bucket  |
//
// The key returned to the browser is the key api/s3.js returns (`<prefix>/<safe name>`); R2 stores it under
// `rfq/`. `publicUrl` and `url` keep the legacy S3 URL format. A delete-folder prefix always ends in '/' before
// listing, so `RFQ-…-1` never matches `RFQ-…-10/`. The gate's FileConstraints are applied here; a caller that
// respects them sees the same answers as before.
//
// Upload rules for every caller: the content type must be a valid header value (else 400 invalid_field).
// Non-staff callers also:
//   - upload only the listed file types (400 file_type_not_allowed);
//   - declare the file size as a whole number of bytes (400 size_required), at most maxSizeBytes
//     (400 file_too_large); the upload URL signs it as Content-Length, so the body must have exactly that size;
//   - never target an existing key (409 exists);
//   - with maxObjectsUnderPrefix: find fewer than that many objects under the folder (409 limit_reached) and be
//     issued at most that many upload URLs per folder in total (409 limit_reached). The issued count is kept in
//     R2 under `upload-counters/<folder>/` and advanced with a conditional write, so requests that run at the
//     same time cannot share a number.

import { weakEtag } from '../../../shared/src/compat/etag';
import type { Principal } from '../../../shared/src/http/rpc';
import { apiError, jsonResponse } from '../../../shared/src/http/json';
import { logLine } from '../../../shared/src/http/log';
import {
  headObject,
  legacyPublicUrl,
  legacyTarget,
  listFirstPage,
  presignGet,
  presignPut,
  r2Target,
  signedDelete,
  type S3Target,
} from '../../../shared/src/storage/s3-presign';
import type { FileConstraints } from '../auth/constraints';
import { articlesStore, handleArticlesR2 } from './articles-store';
import type { ResolvedApi } from './resolve';

export interface FilesEnv {
  PRIVATE_FILES: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  LEGACY_S3_REGION: string;
  LEGACY_S3_RFQ_BUCKET: string;
  LEGACY_S3_ARTICLES_BUCKET: string;
  LEGACY_AWS_ACCESS_KEY_ID: string;
  LEGACY_AWS_SECRET_ACCESS_KEY: string;
}

/** Must equal the "jurisdiction" of the PRIVATE_FILES binding in wrangler.jsonc. */
export const R2_JURISDICTION: 'eu' | '' = 'eu';

/** R2 bucket name used for presigned URLs (the PRIVATE_FILES binding points at the same bucket). */
export const R2_BUCKET = 'microns-private';

/** Key prefix of /api/s3 rfq-scope objects in R2. */
export const R2_RFQ_PREFIX = 'rfq/';

/** Lifetime of a presigned upload URL, as api/s3.js. */
export const UPLOAD_EXPIRES_SEC = 300;

/** Default lifetime of a presigned download URL, as api/s3.js. */
export const DOWNLOAD_EXPIRES_SEC = 3600;

/** Key prefix (outside `rfq/`) of the per-folder count of issued upload URLs. */
export const UPLOAD_COUNTER_PREFIX = 'upload-counters/';

/** Conditional-write attempts for one count update before the request fails with 500. */
const COUNTER_ATTEMPTS = 8;

/** Longest accepted content type; browsers send `type/subtype` well below it. */
const MAX_CONTENT_TYPE_LENGTH = 255;

/** A header value a presigned URL can sign: visible ASCII, space and tab. */
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;

/** Longest error message written to the log line. */
const MAX_LOGGED_MESSAGE = 300;

const LOG_PREFIX = '[microns-site]';

type Scope = 'rfq' | 'articles';

interface Stores {
  env: FilesEnv;
  r2: S3Target;
  legacy: S3Target;
  legacyBucket: string;
  fetchImpl: typeof fetch;
}

/** Answer in the shape api/s3.js gives through `res.json()` (JSON with charset and a weak ETag). */
function handlerJson(status: number, body: unknown): Response {
  return jsonResponse(status, body, { ETag: weakEtag(JSON.stringify(body)) });
}

/** api/s3.js readBody(): falsy -> {}, a string is parsed as JSON ({} when it is not JSON), anything else as is. */
function readBody(value: unknown): any {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

/** api/s3.js sanitizeName(). */
function sanitizeName(name: unknown): string {
  return String(name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
}

/** Code point order, which is the UTF-8 byte order both stores list keys in. */
function compareKeys(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const d = (x.value.codePointAt(0) as number) - (y.value.codePointAt(0) as number);
    if (d !== 0) return d;
  }
}

/** ISO string with milliseconds, as a Date in api/s3.js JSON; a value that is not a date is kept as given. */
function isoDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function storesFor(env: FilesEnv, scope: Scope, fetchImpl: typeof fetch): Stores {
  const region = env.LEGACY_S3_REGION.trim();
  const legacyBucket = scope === 'articles' ? env.LEGACY_S3_ARTICLES_BUCKET : env.LEGACY_S3_RFQ_BUCKET;
  return {
    env,
    r2: r2Target(env.R2_ACCOUNT_ID.trim(), R2_JURISDICTION, R2_BUCKET, env.R2_ACCESS_KEY_ID.trim(), env.R2_SECRET_ACCESS_KEY.trim()),
    legacy: legacyTarget(legacyBucket, region, env.LEGACY_AWS_ACCESS_KEY_ID.trim(), env.LEGACY_AWS_SECRET_ACCESS_KEY.trim()),
    legacyBucket,
    fetchImpl,
  };
}

function publicUrlOf(s: Stores, key: string): string {
  return legacyPublicUrl(s.legacyBucket, s.legacy.region, key);
}

/** First list page of R2 under `rfq/<prefix>`, keys without `rfq/`. */
async function r2FirstPage(s: Stores, prefix: string): Promise<Array<{ key: string; lastModified: string }>> {
  const listed = await s.env.PRIVATE_FILES.list({ prefix: R2_RFQ_PREFIX + prefix, limit: 1000 });
  return listed.objects.map((o) => ({ key: o.key.slice(R2_RFQ_PREFIX.length), lastModified: o.uploaded.toISOString() }));
}

/** Union of the first pages of both stores (rfq) or of legacy (articles); R2 wins on duplicate keys. */
async function listBoth(s: Stores, scope: Scope, prefix: string): Promise<{
  merged: Array<{ key: string; lastModified: string }>;
  r2Keys: string[];
  legacyKeys: string[];
}> {
  const [legacyPage, r2] = await Promise.all([
    listFirstPage(s.legacy, prefix, s.fetchImpl),
    scope === 'rfq' ? r2FirstPage(s, prefix) : Promise.resolve([]),
  ]);
  const legacy = legacyPage.map((o) => ({ key: o.key, lastModified: isoDate(o.lastModified) }));
  if (scope === 'articles') return { merged: legacy, r2Keys: [], legacyKeys: legacy.map((o) => o.key) };
  const byKey = new Map<string, { key: string; lastModified: string }>();
  for (const o of legacy) byKey.set(o.key, o);
  for (const o of r2) byKey.set(o.key, o);
  const merged = [...byKey.values()].sort((a, b) => compareKeys(a.key, b.key));
  return { merged, r2Keys: r2.map((o) => o.key), legacyKeys: legacy.map((o) => o.key) };
}

async function exists(s: Stores, scope: Scope, key: string): Promise<boolean> {
  if (scope === 'rfq' && (await s.env.PRIVATE_FILES.head(R2_RFQ_PREFIX + key)) !== null) return true;
  return headObject(s.legacy, key, s.fetchImpl);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Takes the next of `limit` upload URLs for `folder`; false when all are taken. The count is the body of
 * `upload-counters/<folder>` (so each value has its own ETag) and is written only if the object is unchanged
 * since it was read (or still absent); a request that loses the race reads again.
 */
async function takeUploadUrl(s: Stores, folder: string, limit: number): Promise<boolean> {
  const key = UPLOAD_COUNTER_PREFIX + folder;
  for (let attempt = 0; attempt < COUNTER_ATTEMPTS; attempt++) {
    const current = await s.env.PRIVATE_FILES.head(key);
    const issued = current === null ? 0 : Number(current.customMetadata?.issued);
    if (!Number.isSafeInteger(issued) || issued < 0 || issued >= limit) return false;
    const next = String(issued + 1);
    const written = await s.env.PRIVATE_FILES.put(key, next, {
      httpMetadata: { contentType: 'text/plain' },
      customMetadata: { issued: next },
      onlyIf: current === null ? { etagDoesNotMatch: '*' } : { etagMatches: current.etag },
    });
    if (written !== null) return true;
    await pause(5 + Math.floor(Math.random() * 20) * (attempt + 1));
  }
  throw new Error('Upload count is busy, try again');
}

async function presignUpload(s: Stores, scope: Scope, body: any, c: FileConstraints): Promise<Response> {
  const { fileName, contentType, prefix, size } = body;
  if (!fileName) return handlerJson(400, { error: 'fileName is required' });
  const safeName = sanitizeName(fileName);
  const key = prefix ? `${prefix}/${safeName}` : safeName;
  const type = String(contentType || 'application/octet-stream');
  if (type.length > MAX_CONTENT_TYPE_LENGTH || !HEADER_VALUE.test(type)) return apiError(400, 'invalid_field');

  let contentLength: number | undefined;
  if (!c.staff) {
    if (c.extensionAllowList && !c.extensionAllowList.includes(extensionOf(safeName))) {
      return apiError(400, 'file_type_not_allowed');
    }
    if (c.maxSizeBytes !== undefined) {
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return apiError(400, 'size_required');
      if (size > c.maxSizeBytes) return apiError(400, 'file_too_large');
      contentLength = size;
    }
    if (c.noOverwrite && (await exists(s, scope, key))) return apiError(409, 'exists');
    if (c.maxObjectsUnderPrefix !== undefined) {
      const slash = key.indexOf('/');
      const under = slash === -1 ? '' : key.slice(0, slash + 1);
      const { merged } = await listBoth(s, scope, under);
      if (merged.length >= c.maxObjectsUnderPrefix) return apiError(409, 'limit_reached');
      if (!(await takeUploadUrl(s, under, c.maxObjectsUnderPrefix))) return apiError(409, 'limit_reached');
    }
  }

  const uploadUrl =
    scope === 'rfq'
      ? await presignPut(s.r2, R2_RFQ_PREFIX + key, type, UPLOAD_EXPIRES_SEC, { contentLength })
      : await presignPut(s.legacy, key, type, UPLOAD_EXPIRES_SEC, { contentLength });
  return handlerJson(200, { uploadUrl, key, publicUrl: publicUrlOf(s, key) });
}

async function presignDownload(s: Stores, scope: Scope, body: any, c: FileConstraints): Promise<Response> {
  const { key, expiresIn } = body;
  if (!key) return handlerJson(400, { error: 'key is required' });
  const k = String(key);
  const ttl = Math.min(Number(expiresIn) || DOWNLOAD_EXPIRES_SEC, c.maxExpiresIn);
  const inR2 = scope === 'rfq' && (await s.env.PRIVATE_FILES.head(R2_RFQ_PREFIX + k)) !== null;
  const url = inR2 ? await presignGet(s.r2, R2_RFQ_PREFIX + k, ttl) : await presignGet(s.legacy, k, ttl);
  return handlerJson(200, { url });
}

async function deleteOne(s: Stores, scope: Scope, body: any): Promise<Response> {
  const { key } = body;
  if (!key) return handlerJson(400, { error: 'key is required' });
  const k = String(key);
  if (scope === 'rfq') await s.env.PRIVATE_FILES.delete(R2_RFQ_PREFIX + k);
  await signedDelete(s.legacy, k, s.fetchImpl);
  return handlerJson(200, { success: true });
}

async function deleteFolder(s: Stores, scope: Scope, body: any, c: FileConstraints): Promise<Response> {
  const { prefix } = body;
  if (!prefix) return handlerJson(400, { error: 'prefix is required' });
  if (c.folderPrefixPattern && !(typeof prefix === 'string' && c.folderPrefixPattern.test(prefix))) {
    return apiError(400, 'invalid_prefix');
  }
  const raw = String(prefix);
  const folder = raw.endsWith('/') ? raw : `${raw}/`;
  const { merged, r2Keys, legacyKeys } = await listBoth(s, scope, folder);
  if (merged.length === 0) return handlerJson(200, { success: false, deletedCount: 0 });
  if (r2Keys.length > 0) await s.env.PRIVATE_FILES.delete(r2Keys.map((k) => R2_RFQ_PREFIX + k));
  for (const k of legacyKeys) await signedDelete(s.legacy, k, s.fetchImpl);
  return handlerJson(200, { success: true, deletedCount: merged.length });
}

async function listObjects(s: Stores, scope: Scope, body: any): Promise<Response> {
  const { prefix } = body;
  const { merged } = await listBoth(s, scope, String(prefix || ''));
  return handlerJson(200, { objects: merged.map((o) => ({ key: o.key, url: publicUrlOf(s, o.key), lastModified: o.lastModified })) });
}

export async function handleFiles(i: {
  resolved: ResolvedApi;
  principal: Principal;
  constraints: FileConstraints;
  env: FilesEnv;
  ctx: ExecutionContext;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const r = i.resolved;
  if (r.action === '#options') return new Response(null, { status: 204 });
  const fetchImpl: typeof fetch = i.fetchImpl ?? ((input, init) => fetch(input, init));
  try {
    // api/s3.js reads the body inside its try block: a body that cannot be parsed answers 500 with that error.
    if (!r.body.ok) throw r.body.error;
    const body = readBody(r.body.value);
    const own = body.scope || r.query.scope || 'rfq';
    const scope: Scope = r.scope ?? (own === 'articles' ? 'articles' : 'rfq');
    if (scope === 'articles' && articlesStore(i.env) === 'r2') return await handleArticlesR2({ action: r.action, rawAction: r.rawAction, body, env: i.env, constraints: i.constraints, fetchImpl, respond: handlerJson });
    const s = storesFor(i.env, scope, fetchImpl);
    switch (r.action) {
      case 'presign-upload':
        return await presignUpload(s, scope, body, i.constraints);
      case 'presign-download':
        return await presignDownload(s, scope, body, i.constraints);
      case 'delete':
        return await deleteOne(s, scope, body);
      case 'delete-folder':
        return await deleteFolder(s, scope, body, i.constraints);
      case 'list':
        return await listObjects(s, scope, body);
      default:
        return handlerJson(400, { error: `Unknown action: ${r.rawAction}` });
    }
  } catch (err) {
    const message = (err as { message?: unknown } | null | undefined)?.message;
    const logged = typeof message === 'string' ? message.slice(0, MAX_LOGGED_MESSAGE) : undefined;
    logLine(LOG_PREFIX, 'files error', { action: r.action, message: logged });
    return handlerJson(500, { error: message || 'S3 operation failed' });
  }
}
