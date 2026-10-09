// Article images in the public R2 bucket behind ARTICLES_STORE (src/api/articles-store.ts, PLAN.md P3-6), through
// handleFiles exactly as the router calls it. A fake S3 re-verifies every SigV4 signature for the public R2 bucket
// and the legacy articles bucket. Any value other than "r2" keeps the Phase 2 path (test/files.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuery, parseVercelBody } from '../../shared/src/compat/vercel-node';
import { weakEtag } from '../../shared/src/compat/etag';
import type { Principal } from '../../shared/src/http/rpc';
import { createFakeS3, type FakeBucketConfig } from '../../shared/test/helpers/fake-s3';
import {
  ARTICLE_IMAGE_MAX_BYTES,
  ARTICLE_IMAGE_TYPES,
  ARTICLES_PREFIX,
  articlesStore,
  handleArticlesR2,
  PUBLIC_BUCKET,
  PUBLIC_JURISDICTION,
  type ArticlesStoreEnv,
} from '../src/api/articles-store';
import { handleFiles, type FilesEnv } from '../src/api/files';
import type { ResolvedApi } from '../src/api/resolve';
import { CUSTOMER_FILE_CONSTRAINTS, NO_FILE_CONSTRAINTS, STAFF_FOLDER_CONSTRAINTS, type FileConstraints } from '../src/auth/constraints';
import configText from '../wrangler.jsonc?raw';
import corsPublicText from '../r2/cors.public.json?raw';
import corsPrivateText from '../r2/cors.private.json?raw';

// The spy proves which path files.ts takes; the real implementation still runs.
vi.mock('../src/api/articles-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/articles-store')>();
  return { ...actual, handleArticlesR2: vi.fn(actual.handleArticlesR2) };
});

// ----- world: public R2 bucket, private R2 bucket, legacy articles bucket; credentials built at run time -----

const ACCOUNT = 't2account';
const REGION = 'eu-north-1';
const ARTICLES_BUCKET = 't2-articles';
const R2_ID = ['r2', 'articles', 'test', 'id'].join('-');
const R2_SECRET = ['r2', 'articles', 'test', 'secret'].join('/');
const PUB_ID = ['r2', 'public', 'test', 'id'].join('-');
const PUB_SECRET = ['r2', 'public', 'test', 'secret'].join('/');
const AWS_ID = ['legacy', 'articles', 'test', 'id'].join('-');
const AWS_SECRET = ['legacy', 'articles', 'test', 'secret'].join('/');
const PUBLIC_HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;
const LEGACY_HOST = `${ARTICLES_BUCKET}.s3.${REGION}.amazonaws.com`;
const ORIGIN = 'https://files.micronshub.eu';

function world(publicKeys: { id: string; secret: string } = { id: R2_ID, secret: R2_SECRET }) {
  const buckets: FakeBucketConfig[] = [
    { name: 'microns-private', host: `${ACCOUNT}.eu.r2.cloudflarestorage.com`, style: 'path', region: 'auto', accessKeyId: R2_ID, secretAccessKey: R2_SECRET },
    { name: PUBLIC_BUCKET, host: PUBLIC_HOST, style: 'path', region: 'auto', accessKeyId: publicKeys.id, secretAccessKey: publicKeys.secret },
    { name: 't2-rfq', host: `t2-rfq.s3.${REGION}.amazonaws.com`, style: 'virtual', region: REGION, accessKeyId: AWS_ID, secretAccessKey: AWS_SECRET },
    { name: ARTICLES_BUCKET, host: LEGACY_HOST, style: 'virtual', region: REGION, accessKeyId: AWS_ID, secretAccessKey: AWS_SECRET },
  ];
  return createFakeS3(buckets);
}

let fake = world();

function filesEnv(over: Partial<FilesEnv & ArticlesStoreEnv> = {}): FilesEnv & ArticlesStoreEnv {
  return {
    PRIVATE_FILES: fake.r2Binding('microns-private'),
    R2_ACCOUNT_ID: ACCOUNT,
    R2_ACCESS_KEY_ID: R2_ID,
    R2_SECRET_ACCESS_KEY: R2_SECRET,
    LEGACY_S3_REGION: REGION,
    LEGACY_S3_RFQ_BUCKET: 't2-rfq',
    LEGACY_S3_ARTICLES_BUCKET: ARTICLES_BUCKET,
    LEGACY_AWS_ACCESS_KEY_ID: AWS_ID,
    LEGACY_AWS_SECRET_ACCESS_KEY: AWS_SECRET,
    ARTICLES_STORE: 'r2',
    PUBLIC_FILES_ORIGIN: ORIGIN,
    ...over,
  };
}

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const STAFF: Principal = { class: 'STAFF', uid: '00000000-0000-4000-8000-000000000001', roles: ['admin'] };
const ACTIONS = ['presign-upload', 'presign-download', 'delete', 'delete-folder', 'list'];

/** ResolvedApi exactly as the catalogue resolves a POST /api/s3?action=<action> with a JSON body. */
function resolved(action: string, json: Record<string, unknown>): ResolvedApi {
  const functionUrl = `/api/s3?action=${encodeURIComponent(action)}`;
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const query = parseQuery(functionUrl);
  const body = parseVercelBody('application/json', bytes);
  const scope = (json.scope || 'rfq') === 'articles' ? 'articles' : 'rfq';
  return {
    endpoint: 's3', publicPath: '/api/s3', functionUrl, method: 'POST', query, body, bodyBytes: bytes,
    action: ACTIONS.includes(action) ? action : '#unknown', rawAction: action, scope,
  } as ResolvedApi;
}

function call(action: string, json: Record<string, unknown>, o: { env?: FilesEnv & ArticlesStoreEnv; constraints?: FileConstraints } = {}): Promise<Response> {
  return handleFiles({
    resolved: resolved(action, { scope: 'articles', ...json }),
    principal: STAFF,
    constraints: o.constraints ?? NO_FILE_CONSTRAINTS,
    env: o.env ?? filesEnv(),
    ctx,
    fetchImpl: fake.fetch,
  });
}

async function json(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

const upload = (over: Record<string, unknown> = {}) => ({ fileName: '1700000000000_hero.png', prefix: 'featured/7', contentType: 'image/png', size: 4, ...over });

beforeEach(() => {
  fake = world();
  vi.mocked(handleArticlesR2).mockClear();
});

// ----- switch -----

describe('ARTICLES_STORE switch', () => {
  it('articlesStore() is r2 only for the exact trimmed value "r2"', () => {
    expect(articlesStore({ ARTICLES_STORE: 'r2' })).toBe('r2');
    expect(articlesStore({ ARTICLES_STORE: ' r2 ' })).toBe('r2');
    for (const value of [undefined, '', 'legacy', 'R2', 'r2x', 'on', 'true']) {
      expect(articlesStore({ ARTICLES_STORE: value }), String(value)).toBe('legacy');
    }
    expect(articlesStore({})).toBe('legacy');
  });

  it.each([undefined, 'legacy', 'R2', 'bogus'])('ARTICLES_STORE=%s keeps the Phase 2 path: the legacy articles bucket, never the public bucket', async (value) => {
    const env = filesEnv({ ARTICLES_STORE: value });
    const res = await call('presign-upload', upload(), { env });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(new URL(body.uploadUrl).host).toBe(LEGACY_HOST);
    expect(body.key).toBe('featured/7/1700000000000_hero.png');
    expect(body.publicUrl).toBe(`https://${LEGACY_HOST}/featured/7/1700000000000_hero.png`);
    expect(handleArticlesR2).not.toHaveBeenCalled();
  });

  it('"r2" sends the articles scope to the R2 handler; the rfq scope never', async () => {
    await call('presign-upload', upload());
    expect(handleArticlesR2).toHaveBeenCalledTimes(1);
    const rfq = await handleFiles({
      resolved: resolved('presign-upload', { fileName: 'a.step', prefix: 'RFQ-01102026-1', scope: 'rfq' }),
      principal: STAFF, constraints: NO_FILE_CONSTRAINTS, env: filesEnv(), ctx, fetchImpl: fake.fetch,
    });
    expect(rfq.status).toBe(200);
    expect(handleArticlesR2).toHaveBeenCalledTimes(1);
  });

  it('the committed config ships the switch off at the top level (previews) and in env.production', () => {
    const values = [...configText.matchAll(/"ARTICLES_STORE":\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(['legacy', 'legacy']);
    const origins = [...configText.matchAll(/"PUBLIC_FILES_ORIGIN":\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(origins).toEqual([ORIGIN, ORIGIN]);
    // No binding names the public bucket: the R2 handler reaches it over the S3 API.
    expect(configText).not.toContain(PUBLIC_BUCKET);
  });
});

// ----- presign-upload -----

describe('presign-upload in r2 mode', () => {
  it('presigned PUT to the public bucket under articles/, 300 s, Content-Type and Content-Length signed; key and publicUrl are the R2 key', async () => {
    const res = await call('presign-upload', upload());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body)).toEqual(['uploadUrl', 'key', 'publicUrl']);
    const url = new URL(body.uploadUrl);
    expect(PUBLIC_JURISDICTION).toBe('');
    expect(url.host).toBe(PUBLIC_HOST);
    expect(url.pathname).toBe(`/${PUBLIC_BUCKET}/articles/featured/7/1700000000000_hero.png`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')?.startsWith(`${R2_ID}/`)).toBe(true);
    expect(body.key).toBe('articles/featured/7/1700000000000_hero.png');
    expect(body.publicUrl).toBe(`${ORIGIN}/articles/featured/7/1700000000000_hero.png`);
    expect(new URL(body.publicUrl).pathname.slice(1)).toBe(body.key);
    // Nothing is written by the presign itself.
    expect(fake.writes()).toEqual([]);
  });

  it('the stored object has exactly the signed type and size; another size or type is refused by the store', async () => {
    const { uploadUrl, key } = await json(await call('presign-upload', upload({ size: 4 })));
    const wrongSize = await fake.fetch(uploadUrl, { method: 'PUT', body: 'abcde', headers: { 'Content-Type': 'image/png' } });
    expect(wrongSize.status).toBe(403);
    const wrongType = await fake.fetch(uploadUrl, { method: 'PUT', body: 'abcd', headers: { 'Content-Type': 'text/html' } });
    expect(wrongType.status).toBe(403);
    const ok = await fake.fetch(uploadUrl, { method: 'PUT', body: 'abcd', headers: { 'Content-Type': 'image/png' } });
    expect(ok.status).toBe(200);
    expect(fake.object(PUBLIC_BUCKET, key)?.contentType).toBe('image/png');
    expect(fake.keys(ARTICLES_BUCKET)).toEqual([]);
  });

  it('article uploads accept images only, for every caller including staff', async () => {
    const refused = [
      { fileName: 'logo.svg', contentType: 'image/svg+xml' },
      { fileName: 'page.html', contentType: 'text/html' },
      { fileName: 'page.htm', contentType: 'text/html' },
      { fileName: 'script.js', contentType: 'image/png' },
      { fileName: 'hero', contentType: 'image/png' },
      { fileName: 'hero.png', contentType: 'text/html' },
      { fileName: 'hero.png', contentType: 'image/jpeg' },
      { fileName: 'hero.png', contentType: 'image/svg+xml' },
      { fileName: 'hero.jpg', contentType: 'image/png' },
      { fileName: 'hero.png', contentType: 'IMAGE/PNG' },
      { fileName: 'hero.png', contentType: 'image/png; charset=utf-8' },
      { fileName: 'hero.png' },
    ];
    for (const r of refused) {
      const res = await call('presign-upload', upload({ ...r, contentType: r.contentType }));
      expect(res.status, JSON.stringify(r)).toBe(400);
      expect(await json(res), JSON.stringify(r)).toEqual({ error: 'file_type_not_allowed' });
    }
    expect(fake.calls).toEqual([]);
  });

  it('every listed image type is accepted with its own Content-Type, extension in any case', async () => {
    expect(Object.keys(ARTICLE_IMAGE_TYPES).sort()).toEqual(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
    for (const [ext, type] of Object.entries(ARTICLE_IMAGE_TYPES)) {
      for (const name of [`a.${ext}`, `A.${ext.toUpperCase()}`]) {
        const res = await call('presign-upload', upload({ fileName: name, contentType: type }));
        expect(res.status, name).toBe(200);
      }
    }
  });

  it('a staff upload needs a declared size: a whole number of bytes, at most 5 MiB', async () => {
    for (const size of [undefined, null, '4', 1.5, -1, Number.NaN]) {
      const res = await call('presign-upload', upload({ size }));
      expect(res.status, String(size)).toBe(400);
      expect(await json(res)).toEqual({ error: 'size_required' });
    }
    const big = await call('presign-upload', upload({ size: ARTICLE_IMAGE_MAX_BYTES + 1 }));
    expect(big.status).toBe(400);
    expect(await json(big)).toEqual({ error: 'file_too_large' });
    const max = await call('presign-upload', upload({ size: ARTICLE_IMAGE_MAX_BYTES }));
    expect(max.status).toBe(200);
    expect(ARTICLE_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(fake.calls).toEqual([]);
  });

  it('fileName is required and a content type that is not a header value is refused, before the image rules', async () => {
    const missing = await call('presign-upload', upload({ fileName: '' }));
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe('{"error":"fileName is required"}');
    const bad = await call('presign-upload', upload({ contentType: 'image/png\r\nX-Injected: 1' }));
    expect(bad.status).toBe(400);
    expect(await json(bad)).toEqual({ error: 'invalid_field' });
  });

  it('non-staff file constraints apply on top: the stricter list and size, no overwrite, the object count', async () => {
    const customer: FileConstraints = { ...CUSTOMER_FILE_CONSTRAINTS };
    // webp and gif are images but not in the non-staff list
    expect((await json(await call('presign-upload', upload({ fileName: 'a.webp', contentType: 'image/webp' }), { constraints: customer })))).toEqual({ error: 'file_type_not_allowed' });
    const small: FileConstraints = { ...customer, maxSizeBytes: 3 };
    expect(await json(await call('presign-upload', upload({ size: 4 }), { constraints: small }))).toEqual({ error: 'file_too_large' });
    fake.seed(PUBLIC_BUCKET, 'articles/featured/7/1700000000000_hero.png', 'x');
    const exists = await call('presign-upload', upload(), { constraints: customer });
    expect(exists.status).toBe(409);
    expect(await json(exists)).toEqual({ error: 'exists' });
    const limited: FileConstraints = { ...customer, noOverwrite: false, maxObjectsUnderPrefix: 1 };
    const limit = await call('presign-upload', upload({ fileName: 'other.png' }), { constraints: limited });
    expect(limit.status).toBe(409);
    expect(await json(limit)).toEqual({ error: 'limit_reached' });
  });

  it('R2_PUBLIC_* credentials are used when both are set; otherwise the site R2 token', async () => {
    fake = world({ id: PUB_ID, secret: PUB_SECRET });
    const own = await json(await call('presign-upload', upload(), { env: filesEnv({ R2_PUBLIC_ACCESS_KEY_ID: PUB_ID, R2_PUBLIC_SECRET_ACCESS_KEY: PUB_SECRET }) }));
    expect(new URL(own.uploadUrl).searchParams.get('X-Amz-Credential')?.startsWith(`${PUB_ID}/`)).toBe(true);
    const put = await fake.fetch(own.uploadUrl, { method: 'PUT', body: 'abcd', headers: { 'Content-Type': 'image/png' } });
    expect(put.status).toBe(200);
    // Only one of the pair: the site token, as without any.
    const half = await json(await call('presign-upload', upload(), { env: filesEnv({ R2_PUBLIC_ACCESS_KEY_ID: PUB_ID }) }));
    expect(new URL(half.uploadUrl).searchParams.get('X-Amz-Credential')?.startsWith(`${R2_ID}/`)).toBe(true);
    // The list call is header-signed with the public pair and accepted by the store.
    const listed = await call('list', { prefix: 'articles/' }, { env: filesEnv({ R2_PUBLIC_ACCESS_KEY_ID: PUB_ID, R2_PUBLIC_SECRET_ACCESS_KEY: PUB_SECRET }) });
    expect(listed.status).toBe(200);
  });

  it.each([undefined, '', 'http://files.micronshub.eu', 'files.micronshub.eu', 'https://files.micronshub.eu/images', 'https://files.micronshub.eu?x=1'])(
    'PUBLIC_FILES_ORIGIN=%j: 500 with the files.ts framing, no upload URL handed out',
    async (origin) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const res = await call('presign-upload', upload(), { env: filesEnv({ PUBLIC_FILES_ORIGIN: origin }) });
        const text = await res.text();
        expect(res.status).toBe(500);
        expect(text).toBe('{"error":"PUBLIC_FILES_ORIGIN is not configured"}');
        expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(res.headers.get('etag')).toBe(weakEtag(text));
        expect(fake.calls).toEqual([]);
      } finally {
        error.mockRestore();
        log.mockRestore();
      }
    },
  );

  it('answers carry the files.ts framing (JSON with charset, weak ETag of the body)', async () => {
    const res = await call('presign-upload', upload());
    const text = await res.text();
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('etag')).toBe(weakEtag(text));
  });
});

// ----- download, delete -----

describe('presign-download and delete in r2 mode: routed by the key prefix', () => {
  it('an articles/ key is read from the public bucket; any other key from the legacy bucket; expiry capped', async () => {
    const r2 = new URL((await json(await call('presign-download', { key: 'articles/featured/7/a.png' }))).url);
    expect(r2.host).toBe(PUBLIC_HOST);
    expect(r2.pathname).toBe(`/${PUBLIC_BUCKET}/articles/featured/7/a.png`);
    expect(r2.searchParams.get('X-Amz-Expires')).toBe('3600');
    const legacy = new URL((await json(await call('presign-download', { key: 'featured/7/a.png', expiresIn: 60 }))).url);
    expect(legacy.host).toBe(LEGACY_HOST);
    expect(legacy.searchParams.get('X-Amz-Expires')).toBe('60');
    const capped = new URL((await json(await call('presign-download', { key: 'articles/x.png', expiresIn: 99999 }, { constraints: { ...NO_FILE_CONSTRAINTS, maxExpiresIn: 600 } }))).url);
    expect(capped.searchParams.get('X-Amz-Expires')).toBe('600');
    const missing = await call('presign-download', {});
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe('{"error":"key is required"}');
  });

  it('delete removes the object from the store its key names, never from the other', async () => {
    fake.seed(PUBLIC_BUCKET, 'articles/featured/7/a.png', 'r');
    fake.seed(ARTICLES_BUCKET, 'featured/7/a.png', 'l');
    expect(await (await call('delete', { key: 'articles/featured/7/a.png' })).text()).toBe('{"success":true}');
    expect(fake.keys(PUBLIC_BUCKET)).toEqual([]);
    expect(fake.keys(ARTICLES_BUCKET)).toEqual(['featured/7/a.png']);
    expect(await (await call('delete', { key: 'featured/7/a.png' })).text()).toBe('{"success":true}');
    expect(fake.keys(ARTICLES_BUCKET)).toEqual([]);
  });

  it('the browser deletes by URL path, which reaches the right store for both URL forms', async () => {
    fake.seed(PUBLIC_BUCKET, 'articles/featured/7/a.png', 'r');
    fake.seed(ARTICLES_BUCKET, 'featured/7/b.png', 'l');
    const listed = (await json(await call('list', { prefix: 'featured/7/' }))).objects as Array<{ key: string; url: string }>;
    for (const o of listed) {
      const key = new URL(o.url).pathname.substring(1);
      expect(key).toBe(o.key);
      expect((await call('delete', { key })).status).toBe(200);
    }
    expect(fake.keys(PUBLIC_BUCKET)).toEqual([]);
    expect(fake.keys(ARTICLES_BUCKET)).toEqual([]);
  });
});

// ----- list, delete-folder -----

describe('list and delete-folder in r2 mode: both stores', () => {
  function seedBoth(): void {
    fake.seed(PUBLIC_BUCKET, 'articles/featured/7/b.png', 'r', { lastModified: new Date('2026-10-01T00:00:00Z') });
    fake.seed(PUBLIC_BUCKET, 'articles/featured/8/c.png', 'r', { lastModified: new Date('2026-10-02T00:00:00Z') });
    fake.seed(PUBLIC_BUCKET, 'articles/content/9/d.png', 'r');
    fake.seed(ARTICLES_BUCKET, 'featured/7/a.png', 'l', { lastModified: new Date('2026-03-15T08:00:00Z') });
    fake.seed(ARTICLES_BUCKET, 'featured/9/z.png', 'l', { lastModified: new Date('2026-03-15T09:00:00Z') });
    fake.seed(ARTICLES_BUCKET, 'content/1/x.png', 'l');
  }

  it('a browser prefix lists the first pages of both stores, merged in key order, each URL from its own store', async () => {
    seedBoth();
    const body = await json(await call('list', { prefix: 'featured/' }));
    expect(body.objects).toEqual([
      { key: 'articles/featured/7/b.png', url: `${ORIGIN}/articles/featured/7/b.png`, lastModified: '2026-10-01T00:00:00.000Z' },
      { key: 'articles/featured/8/c.png', url: `${ORIGIN}/articles/featured/8/c.png`, lastModified: '2026-10-02T00:00:00.000Z' },
      { key: 'featured/7/a.png', url: `https://${LEGACY_HOST}/featured/7/a.png`, lastModified: '2026-03-15T08:00:00.000Z' },
      { key: 'featured/9/z.png', url: `https://${LEGACY_HOST}/featured/9/z.png`, lastModified: '2026-03-15T09:00:00.000Z' },
    ]);
  });

  it('an articles/ prefix lists the public bucket only; no prefix lists everything of both stores', async () => {
    seedBoth();
    const r2Only = await json(await call('list', { prefix: 'articles/featured/' }));
    expect(r2Only.objects.map((o: { key: string }) => o.key)).toEqual(['articles/featured/7/b.png', 'articles/featured/8/c.png']);
    const all = await json(await call('list', {}));
    expect(all.objects.map((o: { key: string }) => o.key)).toEqual([
      'articles/content/9/d.png', 'articles/featured/7/b.png', 'articles/featured/8/c.png', 'content/1/x.png', 'featured/7/a.png', 'featured/9/z.png',
    ]);
    expect(fake.calls.filter((c) => c.op === 'ListObjectsV2').map((c) => c.bucket)).toEqual([PUBLIC_BUCKET, PUBLIC_BUCKET, ARTICLES_BUCKET]);
  });

  it('a list with objects in the public bucket and no valid PUBLIC_FILES_ORIGIN answers 500', async () => {
    seedBoth();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await call('list', { prefix: 'featured/' }, { env: filesEnv({ PUBLIC_FILES_ORIGIN: '' }) });
      expect(res.status).toBe(500);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('delete-folder deletes the folder in both stores (the prefix always ends in "/"), or in the public bucket only for an articles/ prefix', async () => {
    seedBoth();
    fake.seed(ARTICLES_BUCKET, 'featured/70/keep.png', 'l');
    fake.seed(PUBLIC_BUCKET, 'articles/featured/70/keep.png', 'r');
    expect(await (await call('delete-folder', { prefix: 'featured/7' })).text()).toBe('{"success":true,"deletedCount":2}');
    expect(fake.keys(PUBLIC_BUCKET)).toEqual(['articles/content/9/d.png', 'articles/featured/70/keep.png', 'articles/featured/8/c.png']);
    expect(fake.keys(ARTICLES_BUCKET)).toEqual(['content/1/x.png', 'featured/70/keep.png', 'featured/9/z.png']);
    expect(await (await call('delete-folder', { prefix: 'articles/featured/8/' })).text()).toBe('{"success":true,"deletedCount":1}');
    expect(fake.keys(ARTICLES_BUCKET)).toEqual(['content/1/x.png', 'featured/70/keep.png', 'featured/9/z.png']);
    expect(await (await call('delete-folder', { prefix: 'featured/404' })).text()).toBe('{"success":false,"deletedCount":0}');
    expect(await (await call('delete-folder', {})).text()).toBe('{"error":"prefix is required"}');
  });

  it('a folder prefix pattern still applies', async () => {
    seedBoth();
    const res = await call('delete-folder', { prefix: 'featured/7' }, { constraints: STAFF_FOLDER_CONSTRAINTS });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'invalid_prefix' });
    expect(fake.writes()).toEqual([]);
  });
});

// ----- other -----

describe('other answers in r2 mode', () => {
  it('an unknown action answers 400 with the raw value, as files.ts', async () => {
    const res = await call('bogus', {});
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"Unknown action: bogus"}');
  });

  it('r2/cors.public.json allows the same origins, methods and headers as r2/cors.private.json', () => {
    const pub = JSON.parse(corsPublicText);
    const priv = JSON.parse(corsPrivateText);
    expect(pub.rules.map((r: any) => r.allowed.origins)).toEqual(priv.rules.map((r: any) => r.allowed.origins));
    expect(pub.rules.map((r: any) => r.allowed.methods)).toEqual(priv.rules.map((r: any) => r.allowed.methods));
    expect(pub.rules.map((r: any) => r.allowed.headers)).toEqual(priv.rules.map((r: any) => r.allowed.headers));
    expect(ARTICLES_PREFIX).toBe('articles/');
  });
});
