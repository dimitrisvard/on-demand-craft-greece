// Article images of /api/s3 scope "articles" in the public R2 bucket microns-public (PLAN.md P3-6), behind the var
// ARTICLES_STORE. Any value other than "r2" (default "legacy") keeps src/api/files.ts on its Phase 2 path: every
// articles action on the legacy S3 bucket. With "r2", files.ts hands the articles scope to handleArticlesR2():
//
// | Action           | Key or prefix given              | Store used                                                    |
// |------------------|----------------------------------|---------------------------------------------------------------|
// | presign-upload   | prefix + name (browser key)      | R2 microns-public, key "articles/<browser key>"               |
// | presign-download | "articles/..." / anything else   | R2 / legacy bucket (as Phase 2)                               |
// | delete           | "articles/..." / anything else   | R2 / legacy bucket (as Phase 2)                               |
// | delete-folder    | "articles/..." / any other       | R2 only / R2 "articles/<prefix>/" and legacy "<prefix>/"      |
// | list             | "articles/..." / any other       | R2 only / R2 "articles/<prefix>" and legacy "<prefix>" merged |
//
// Every returned key is the URL path of its object: legacy https://<bucket>.s3.<region>.amazonaws.com/<key> (as
// Phase 2), R2 <PUBLIC_FILES_ORIGIN>/articles/<browser key>. The browser deletes by URL path
// (src/utils/articleImageStorage.ts), so a delete reaches the store that holds the object without a frontend change.
// Answers have the keys, statuses and framing of files.ts (its handlerJson is passed in as `respond`).
//
// Upload rules in "r2" mode, for every caller (microns-public is served on a subdomain of the site):
//   - article uploads accept images only: jpg, jpeg, png, webp, gif, avif, and the Content-Type must be the type of
//     the extension (400 file_type_not_allowed); the content type must be a valid header value (400 invalid_field);
//   - every upload declares its size as a whole number of bytes (400 size_required), at most 5 MiB
//     (400 file_too_large); the upload URL signs Content-Type and Content-Length, so the stored object has exactly
//     the checked type and size.
// A caller with non-staff file constraints also meets them: its extension list and size limit (the stricter one
// wins), no overwrite of an existing key (409 exists) and its object count under the folder (409 limit_reached).
//
// Store access: the S3 API with the R2 token (R2_PUBLIC_ACCESS_KEY_ID/R2_PUBLIC_SECRET_ACCESS_KEY when both are set,
// else R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY), no binding: nothing in wrangler.jsonc names microns-public, so a
// preview upload is unchanged while the switch is off.

import { apiError } from '../../../shared/src/http/json';
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
import type { FilesEnv } from './files';

/** Public R2 bucket of article images (served on PUBLIC_FILES_ORIGIN). */
export const PUBLIC_BUCKET = 'microns-public';

/** microns-public is created without a jurisdiction (location hint only), so its S3 endpoint has no "eu." label. */
export const PUBLIC_JURISDICTION: 'eu' | '' = '';

/** Key prefix of article images in microns-public. */
export const ARTICLES_PREFIX = 'articles/';

/** Image types an article upload may have: extension (lower case) -> the only Content-Type accepted for it. */
export const ARTICLE_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
});

/** Largest article image: 5 MiB, the media library's own limit. */
export const ARTICLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Lifetime of a presigned upload URL (as files.ts). */
const UPLOAD_EXPIRES_SEC = 300;

/** Default lifetime of a presigned download URL (as files.ts). */
const DOWNLOAD_EXPIRES_SEC = 3600;

/** Longest accepted content type (as files.ts). */
const MAX_CONTENT_TYPE_LENGTH = 255;

/** A header value a presigned URL can sign: visible ASCII, space and tab (as files.ts). */
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;

export interface ArticlesStoreEnv {
  ARTICLES_STORE?: string; // var, "legacy" (default) | "r2"
  PUBLIC_FILES_ORIGIN?: string; // var, "https://files.micronshub.eu"
  R2_PUBLIC_ACCESS_KEY_ID?: string; // secret, optional: only when one R2 token cannot cover both buckets
  R2_PUBLIC_SECRET_ACCESS_KEY?: string; // secret, optional
}

export type ArticlesStore = 'legacy' | 'r2';

/**
 * Where article images go: 'r2' only for the exact trimmed value "r2", 'legacy' for anything else (absent, empty,
 * a typo). Accepts any Worker env object (files.ts passes its FilesEnv); only ARTICLES_STORE is read.
 */
export function articlesStore(env: ArticlesStoreEnv | object): ArticlesStore {
  const value = (env as ArticlesStoreEnv).ARTICLES_STORE;
  return typeof value === 'string' && value.trim() === 'r2' ? 'r2' : 'legacy';
}

type Env = FilesEnv & ArticlesStoreEnv;

interface Stores {
  env: Env;
  pub: S3Target;
  legacy: S3Target;
  legacyBucket: string;
  fetchImpl: typeof fetch;
}

interface Listed {
  key: string;
  lastModified: string;
  store: 'r2' | 'legacy';
}

function storesOf(env: Env, fetchImpl: typeof fetch): Stores {
  const ownId = (env.R2_PUBLIC_ACCESS_KEY_ID ?? '').trim();
  const ownSecret = (env.R2_PUBLIC_SECRET_ACCESS_KEY ?? '').trim();
  const both = ownId !== '' && ownSecret !== '';
  const id = both ? ownId : env.R2_ACCESS_KEY_ID.trim();
  const secret = both ? ownSecret : env.R2_SECRET_ACCESS_KEY.trim();
  const region = env.LEGACY_S3_REGION.trim();
  return {
    env,
    pub: r2Target(env.R2_ACCOUNT_ID.trim(), PUBLIC_JURISDICTION, PUBLIC_BUCKET, id, secret),
    legacy: legacyTarget(env.LEGACY_S3_ARTICLES_BUCKET, region, env.LEGACY_AWS_ACCESS_KEY_ID.trim(), env.LEGACY_AWS_SECRET_ACCESS_KEY.trim()),
    legacyBucket: env.LEGACY_S3_ARTICLES_BUCKET,
    fetchImpl,
  };
}

const isR2Key = (key: string): boolean => key.startsWith(ARTICLES_PREFIX);

/** Public URL of an R2 article key; throws when PUBLIC_FILES_ORIGIN is not an https origin (files.ts answers 500). */
function publicUrlOf(env: ArticlesStoreEnv, r2Key: string): string {
  const raw = (env.PUBLIC_FILES_ORIGIN ?? '').trim().replace(/\/+$/, '');
  let origin: URL | null = null;
  try {
    origin = new URL(raw);
  } catch {
    origin = null;
  }
  if (!origin || origin.protocol !== 'https:' || origin.origin !== raw) throw new Error('PUBLIC_FILES_ORIGIN is not configured');
  return `${raw}/${r2Key}`;
}

function urlOf(s: Stores, o: Listed): string {
  return o.store === 'r2' ? publicUrlOf(s.env, o.key) : legacyPublicUrl(s.legacyBucket, s.legacy.region, o.key);
}

/** api/s3.js sanitizeName() (as files.ts). */
function sanitizeName(name: unknown): string {
  return String(name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Code point order, the UTF-8 byte order both stores list keys in (as files.ts). */
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

/** ISO string with milliseconds; a value that is not a date is kept as given (as files.ts). */
function isoDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** First list page of each store for a browser prefix (R2 only for an "articles/" prefix), merged in key order. */
async function listBoth(s: Stores, prefix: string): Promise<Listed[]> {
  const r2Prefix = isR2Key(prefix) ? prefix : ARTICLES_PREFIX + prefix;
  const [r2, legacy] = await Promise.all([
    listFirstPage(s.pub, r2Prefix, s.fetchImpl),
    isR2Key(prefix) ? Promise.resolve([]) : listFirstPage(s.legacy, prefix, s.fetchImpl),
  ]);
  const merged: Listed[] = [
    ...r2.map((o) => ({ key: o.key, lastModified: isoDate(o.lastModified), store: 'r2' as const })),
    ...legacy.map((o) => ({ key: o.key, lastModified: isoDate(o.lastModified), store: 'legacy' as const })),
  ];
  return merged.sort((a, b) => compareKeys(a.key, b.key));
}

type Respond = (status: number, body: unknown) => Response;

async function presignUpload(s: Stores, body: any, c: FileConstraints, respond: Respond): Promise<Response> {
  const { fileName, contentType, prefix, size } = body;
  if (!fileName) return respond(400, { error: 'fileName is required' });
  const safeName = sanitizeName(fileName);
  const browserKey = prefix ? `${prefix}/${safeName}` : safeName;
  const type = String(contentType || 'application/octet-stream');
  if (type.length > MAX_CONTENT_TYPE_LENGTH || !HEADER_VALUE.test(type)) return apiError(400, 'invalid_field');

  const extension = extensionOf(safeName);
  const imageType = Object.prototype.hasOwnProperty.call(ARTICLE_IMAGE_TYPES, extension) ? ARTICLE_IMAGE_TYPES[extension] : undefined;
  if (!imageType || type !== imageType) return apiError(400, 'file_type_not_allowed');
  if (!c.staff && c.extensionAllowList && !c.extensionAllowList.includes(extension)) return apiError(400, 'file_type_not_allowed');

  const maxBytes = !c.staff && c.maxSizeBytes !== undefined ? Math.min(c.maxSizeBytes, ARTICLE_IMAGE_MAX_BYTES) : ARTICLE_IMAGE_MAX_BYTES;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return apiError(400, 'size_required');
  if (size > maxBytes) return apiError(400, 'file_too_large');

  const key = ARTICLES_PREFIX + browserKey;
  if (!c.staff) {
    if (c.noOverwrite && (await headObject(s.pub, key, s.fetchImpl))) return apiError(409, 'exists');
    if (c.maxObjectsUnderPrefix !== undefined) {
      const slash = browserKey.indexOf('/');
      const under = slash === -1 ? '' : browserKey.slice(0, slash + 1);
      if ((await listBoth(s, under)).length >= c.maxObjectsUnderPrefix) return apiError(409, 'limit_reached');
    }
  }

  // The public URL first: no upload URL is handed out while the public origin is not configured.
  const publicUrl = publicUrlOf(s.env, key);
  const uploadUrl = await presignPut(s.pub, key, type, UPLOAD_EXPIRES_SEC, { contentLength: size });
  return respond(200, { uploadUrl, key, publicUrl });
}

async function presignDownload(s: Stores, body: any, c: FileConstraints, respond: Respond): Promise<Response> {
  const { key, expiresIn } = body;
  if (!key) return respond(400, { error: 'key is required' });
  const k = String(key);
  const ttl = Math.min(Number(expiresIn) || DOWNLOAD_EXPIRES_SEC, c.maxExpiresIn);
  const url = await presignGet(isR2Key(k) ? s.pub : s.legacy, k, ttl);
  return respond(200, { url });
}

async function deleteOne(s: Stores, body: any, respond: Respond): Promise<Response> {
  const { key } = body;
  if (!key) return respond(400, { error: 'key is required' });
  const k = String(key);
  await signedDelete(isR2Key(k) ? s.pub : s.legacy, k, s.fetchImpl);
  return respond(200, { success: true });
}

async function deleteFolder(s: Stores, body: any, c: FileConstraints, respond: Respond): Promise<Response> {
  const { prefix } = body;
  if (!prefix) return respond(400, { error: 'prefix is required' });
  if (c.folderPrefixPattern && !(typeof prefix === 'string' && c.folderPrefixPattern.test(prefix))) {
    return apiError(400, 'invalid_prefix');
  }
  const raw = String(prefix);
  const folder = raw.endsWith('/') ? raw : `${raw}/`;
  const listed = await listBoth(s, folder);
  if (listed.length === 0) return respond(200, { success: false, deletedCount: 0 });
  for (const o of listed) await signedDelete(o.store === 'r2' ? s.pub : s.legacy, o.key, s.fetchImpl);
  return respond(200, { success: true, deletedCount: listed.length });
}

async function listObjects(s: Stores, body: any, respond: Respond): Promise<Response> {
  const { prefix } = body;
  const listed = await listBoth(s, String(prefix || ''));
  return respond(200, { objects: listed.map((o) => ({ key: o.key, url: urlOf(s, o), lastModified: o.lastModified })) });
}

/**
 * The articles scope of /api/s3 in "r2" mode. Called by files.ts inside its try block: a thrown error (store
 * failure, PUBLIC_FILES_ORIGIN not configured) becomes the files.ts 500 answer.
 */
export async function handleArticlesR2(i: {
  action: string;
  rawAction: unknown; // ResolvedApi.rawAction, shown in the unknown-action message as files.ts shows it
  body: any;
  env: FilesEnv & ArticlesStoreEnv;
  constraints: FileConstraints;
  fetchImpl: typeof fetch;
  respond: (status: number, body: unknown) => Response;
}): Promise<Response> {
  const s = storesOf(i.env, i.fetchImpl);
  switch (i.action) {
    case 'presign-upload':
      return presignUpload(s, i.body, i.constraints, i.respond);
    case 'presign-download':
      return presignDownload(s, i.body, i.constraints, i.respond);
    case 'delete':
      return deleteOne(s, i.body, i.respond);
    case 'delete-folder':
      return deleteFolder(s, i.body, i.constraints, i.respond);
    case 'list':
      return listObjects(s, i.body, i.respond);
    default:
      return i.respond(400, { error: `Unknown action: ${i.rawAction}` });
  }
}
