// /api/s3 re-implementation (src/api/files.ts): every action x scope x store against a fake S3 that re-verifies
// each SigV4 signature, and a fake R2 binding over the same store. Response bodies are compared with the real
// api/s3.js, run through the shared Vercel shim with the AWS SDK pointed at the same fake S3.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuery, parseVercelBody, runNodeHandler, type VercelHandler } from '../../shared/src/compat/vercel-node';
import { weakEtag } from '../../shared/src/compat/etag';
import type { Principal } from '../../shared/src/http/rpc';
import { createFakeS3, type FakeBucketConfig } from '../../shared/test/helpers/fake-s3';
import { handleFiles, R2_JURISDICTION, type FilesEnv } from '../src/api/files';
import type { ResolvedApi } from '../src/api/resolve';
import { NO_FILE_CONSTRAINTS, type FileConstraints } from '../src/auth/constraints';

// ----- world: R2 bucket + two legacy buckets, test credentials built at run time -----

const ACCOUNT = 't2account';
const REGION = 'eu-north-1';
const RFQ_BUCKET = 't2-rfq';
const ARTICLES_BUCKET = 't2-articles';
const R2_ID = ['r2', 'files', 'test', 'id'].join('-');
const R2_SECRET = ['r2', 'files', 'test', 'secret'].join('/');
const AWS_ID = ['legacy', 'files', 'test', 'id'].join('-');
const AWS_SECRET = ['legacy', 'files', 'test', 'secret'].join('/');
const R2_HOST = `${ACCOUNT}.${R2_JURISDICTION ? `${R2_JURISDICTION}.` : ''}r2.cloudflarestorage.com`;

const BUCKETS: FakeBucketConfig[] = [
  { name: 'microns-private', host: R2_HOST, style: 'path', region: 'auto', accessKeyId: R2_ID, secretAccessKey: R2_SECRET },
  { name: RFQ_BUCKET, host: `${RFQ_BUCKET}.s3.${REGION}.amazonaws.com`, style: 'virtual', region: REGION, accessKeyId: AWS_ID, secretAccessKey: AWS_SECRET },
  { name: ARTICLES_BUCKET, host: `${ARTICLES_BUCKET}.s3.${REGION}.amazonaws.com`, style: 'virtual', region: REGION, accessKeyId: AWS_ID, secretAccessKey: AWS_SECRET },
];

const fake = createFakeS3(BUCKETS);
const env: FilesEnv = {
  PRIVATE_FILES: fake.r2Binding('microns-private'),
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: R2_ID,
  R2_SECRET_ACCESS_KEY: R2_SECRET,
  LEGACY_S3_REGION: REGION,
  LEGACY_S3_RFQ_BUCKET: RFQ_BUCKET,
  LEGACY_S3_ARTICLES_BUCKET: ARTICLES_BUCKET,
  LEGACY_AWS_ACCESS_KEY_ID: AWS_ID,
  LEGACY_AWS_SECRET_ACCESS_KEY: AWS_SECRET,
};
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const STAFF: Principal = { class: 'STAFF', uid: '00000000-0000-4000-8000-000000000001', roles: ['admin'] };
const UNCAPPED: FileConstraints = { staff: true, maxExpiresIn: Number.MAX_SAFE_INTEGER, noOverwrite: false };

// Constraint sets with the values of the gate's rules (the gate decides which set a caller gets).
const EXTENSIONS = ['step', 'stp', 'iges', 'igs', 'stl', 'dxf', 'dwg', 'pdf', 'png', 'jpg', 'jpeg', 'zip', 'x_t', 'sldprt'];
const CUSTOMER: FileConstraints = { staff: false, maxExpiresIn: 3600, noOverwrite: true, extensionAllowList: EXTENSIONS, maxSizeBytes: 209_715_200 };
const ANONYMOUS: FileConstraints = { ...CUSTOMER, maxObjectsUnderPrefix: 50 };
const STAFF_FOLDER: FileConstraints = {
  ...NO_FILE_CONSTRAINTS,
  folderPrefixPattern: /^(RFQ-\d{8}-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/,
};

// ----- request building: ResolvedApi exactly as the catalogue resolves /api/s3 -----

const ACTIONS = ['presign-upload', 'presign-download', 'delete', 'delete-folder', 'list'];

interface Call {
  method?: string;
  search?: string;
  json?: unknown;
  text?: string;
  contentType?: string | null;
}

function readBodyLike(value: unknown): any {
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

function build(c: Call): { resolved: ResolvedApi; request: Request; bytes: Uint8Array | null } {
  const method = c.method ?? 'POST';
  const functionUrl = `/api/s3${c.search ?? ''}`;
  const text = c.json !== undefined ? JSON.stringify(c.json) : c.text;
  const contentType = c.contentType !== undefined ? c.contentType : text !== undefined ? 'application/json' : null;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const bytes = hasBody && text !== undefined ? new TextEncoder().encode(text) : new Uint8Array();
  const query = parseQuery(functionUrl);
  const body = parseVercelBody(contentType, bytes);
  const rawAction = query.action;
  let action: string;
  if (method === 'OPTIONS') action = '#options';
  else if (!body.ok) action = '#throws';
  else action = typeof rawAction === 'string' && ACTIONS.includes(rawAction) ? rawAction : '#unknown';
  let scope: 'rfq' | 'articles' | undefined;
  if (body.ok) {
    try {
      const own = readBodyLike(body.value).scope || query.scope || 'rfq';
      scope = own === 'articles' ? 'articles' : 'rfq';
    } catch {
      scope = undefined;
    }
  }
  const headers: Record<string, string> = contentType ? { 'content-type': contentType } : {};
  const request = new Request(`https://microns-site.example.workers.dev${functionUrl}`, { method, headers });
  const resolved: ResolvedApi = { endpoint: 's3', publicPath: '/api/s3', functionUrl, method, query, body, bodyBytes: bytes, action, rawAction, scope };
  return { resolved, request, bytes: hasBody ? bytes : null };
}

function ours(c: Call, constraints: FileConstraints = NO_FILE_CONSTRAINTS): Promise<Response> {
  return handleFiles({ resolved: build(c).resolved, principal: STAFF, constraints, env, ctx, fetchImpl: fake.fetch });
}

async function json(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

const enc = (s: string) => new TextEncoder().encode(s);

async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(() => {
  fake.reset();
});

// ----- parity with api/s3.js -----

describe('responses equal api/s3.js (legacy store only, real handler through the shim)', () => {
  let server: { url: string; close(): Promise<void> };
  let handler: VercelHandler;
  // Absolute path of the untouched Vercel handler (a variable specifier keeps it out of the type program).
  const S3_HANDLER: string = new URL('../../../api/s3.js', (import.meta as unknown as { url: string }).url).pathname;

  beforeAll(async () => {
    server = await fake.listen();
    vi.stubEnv('AWS_ENDPOINT_URL_S3', server.url);
    vi.stubEnv('AWS_REGION', REGION);
    vi.stubEnv('AWS_S3_BUCKET', RFQ_BUCKET);
    vi.stubEnv('AWS_ARTICLES_BUCKET', ARTICLES_BUCKET);
    vi.stubEnv('AWS_ACCESS_KEY_ID', AWS_ID);
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', AWS_SECRET);
    vi.resetModules();
    handler = ((await import(/* @vite-ignore */ S3_HANDLER)) as { default: VercelHandler }).default;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.close();
  });

  function seedLegacy(): void {
    const when = new Date('2026-09-30T10:11:12Z');
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-1/part-a/a.step', 'a', { lastModified: when });
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-1/part-a/b & c.pdf', 'b', { lastModified: new Date('2026-09-30T10:11:13.250Z') });
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-10/x.step', 'x', { lastModified: when });
    fake.seed(ARTICLES_BUCKET, 'featured/7/hero.png', 'p', { lastModified: when });
  }

  async function snapshot(res: Response): Promise<{ status: number; type: string | null; etag: string | null; text: string }> {
    return { status: res.status, type: res.headers.get('content-type'), etag: res.headers.get('etag'), text: await res.text() };
  }

  async function compare(c: Call, o: { constraints?: FileConstraints; urls?: boolean } = {}) {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      fake.reset();
      seedLegacy();
      const b = build(c);
      const oracle = await snapshot(await runNodeHandler(handler, { request: b.request, functionUrl: b.resolved.functionUrl, body: b.bytes, logPrefix: '[test]' }));
      const oracleStore = { rfq: fake.keys(RFQ_BUCKET), articles: fake.keys(ARTICLES_BUCKET) };
      const oracleCalls = fake.calls.map((call) => `${call.op} ${call.status}`);
      fake.reset();
      seedLegacy();
      const mine = await snapshot(await ours(c, o.constraints));
      const mineStore = { rfq: fake.keys(RFQ_BUCKET), articles: fake.keys(ARTICLES_BUCKET) };
      expect(mine.status).toBe(oracle.status);
      expect(mine.type).toBe(oracle.type);
      expect(mineStore).toEqual(oracleStore);
      if (!o.urls) {
        expect(mine.text).toBe(oracle.text);
        expect(mine.etag).toBe(oracle.etag);
      }
      return { oracle, mine, oracleCalls };
    } finally {
      errors.mockRestore();
      logs.mockRestore();
    }
  }

  it('OPTIONS: 204 without a body', async () => {
    const { mine } = await compare({ method: 'OPTIONS', search: '?action=list' });
    expect(mine).toMatchObject({ status: 204, text: '', type: null });
  });

  it('missing, unknown and repeated action: 400 Unknown action: <value>', async () => {
    expect((await compare({ json: {} })).mine.text).toBe('{"error":"Unknown action: undefined"}');
    expect((await compare({ search: '?action=bogus', json: {} })).mine.text).toBe('{"error":"Unknown action: bogus"}');
    expect((await compare({ search: '?action=list&action=delete', json: {} })).mine.text).toBe('{"error":"Unknown action: list,delete"}');
  });

  it('invalid JSON: 500 Invalid JSON, before the action is looked at', async () => {
    expect((await compare({ search: '?action=list', text: '{bad' })).mine.text).toBe('{"error":"Invalid JSON"}');
    expect((await compare({ search: '?action=bogus', text: '{bad' })).mine.status).toBe(500);
  });

  it('text/plain bodies are parsed as JSON, and a JSON null string fails as the handler fails', async () => {
    const listed = await compare({ search: '?action=list', text: '{"prefix":"RFQ-02102026-1/"}', contentType: 'text/plain' });
    expect(JSON.parse(listed.mine.text).objects).toHaveLength(2);
    const nul = await compare({ search: '?action=list', text: 'null', contentType: 'text/plain' });
    expect(nul.mine.status).toBe(500);
    expect(JSON.parse(nul.mine.text).error).toContain('null');
    await compare({ search: '?action=list', text: 'null' });
  });

  it('presign-upload: 400 without fileName; key and publicUrl as api/s3.js (rfq and articles)', async () => {
    await compare({ search: '?action=presign-upload', json: { prefix: 'RFQ-1' } });
    for (const body of [
      { fileName: 'part 1 (v2).STEP', prefix: 'RFQ-02102026-1/part-a', contentType: 'model/step' },
      { fileName: 'drawing.pdf' },
      { fileName: 'hero image.png', prefix: 'featured/7', contentType: 'image/png', scope: 'articles' },
    ]) {
      const { oracle, mine } = await compare({ search: '?action=presign-upload', json: body }, { urls: true });
      const a = JSON.parse(oracle.text);
      const m = JSON.parse(mine.text);
      expect(Object.keys(m)).toEqual(Object.keys(a));
      expect(m.key).toBe(a.key);
      expect(m.publicUrl).toBe(a.publicUrl);
    }
    const viaQuery = await compare({ search: '?action=presign-upload&scope=articles', json: { fileName: 'x.png' } }, { urls: true });
    expect(JSON.parse(viaQuery.mine.text).publicUrl).toBe(JSON.parse(viaQuery.oracle.text).publicUrl);
  });

  it('presign-download: 400 without key; {url}; an expiry above 7 days fails with the SDK text', async () => {
    await compare({ search: '?action=presign-download', json: {} });
    const { oracle, mine } = await compare({ search: '?action=presign-download', json: { key: 'RFQ-02102026-1/part-a/a.step' } }, { urls: true });
    expect(Object.keys(JSON.parse(mine.text))).toEqual(Object.keys(JSON.parse(oracle.text)));
    const tooLong = await compare({ search: '?action=presign-download', json: { key: 'RFQ-02102026-1/part-a/a.step', expiresIn: 604_801 } }, { constraints: UNCAPPED });
    expect(tooLong.mine.text).toBe('{"error":"Signature version 4 presigned URLs must have an expiration date less than one week in the future"}');
  });

  it('delete: 400 without key; {success:true}; same objects left', async () => {
    await compare({ search: '?action=delete', json: {} });
    const { mine } = await compare({ search: '?action=delete', json: { key: 'RFQ-02102026-1/part-a/a.step' } });
    expect(mine.text).toBe('{"success":true}');
    await compare({ search: '?action=delete', json: { key: 'featured/7/hero.png', scope: 'articles' } });
    await compare({ search: '?action=delete', json: { key: 'missing.pdf' } });
  });

  it('delete-folder: 400 without prefix; count; nothing found -> success false', async () => {
    await compare({ search: '?action=delete-folder', json: {} });
    expect((await compare({ search: '?action=delete-folder', json: { prefix: 'RFQ-02102026-1/' } })).mine.text).toBe('{"success":true,"deletedCount":2}');
    expect((await compare({ search: '?action=delete-folder', json: { prefix: 'RFQ-404/' } })).mine.text).toBe('{"success":false,"deletedCount":0}');
    await compare({ search: '?action=delete-folder', json: { prefix: 'featured/', scope: 'articles' } });
  });

  it('list: objects with key, legacy url and ISO lastModified, byte for byte', async () => {
    const { mine, oracleCalls } = await compare({ search: '?action=list', json: { prefix: 'RFQ-02102026-1/' } });
    // The oracle really ran against the fake S3 over HTTP, signature verified.
    expect(oracleCalls).toContain('ListObjectsV2 200');
    expect(JSON.parse(mine.text).objects[1]).toEqual({
      key: 'RFQ-02102026-1/part-a/b & c.pdf',
      url: `https://${RFQ_BUCKET}.s3.${REGION}.amazonaws.com/RFQ-02102026-1/part-a/b & c.pdf`,
      lastModified: '2026-09-30T10:11:13.250Z',
    });
    await compare({ search: '?action=list', json: {} });
    await compare({ search: '?action=list', json: { scope: 'articles' } });
    await compare({ method: 'GET', search: '?action=list&scope=articles' });
    await compare({ method: 'GET', search: '?action=list&prefix=ignored' });
  });
});

// ----- R2 and legacy semantics -----

function r2Keys(): string[] {
  return fake.keys('microns-private');
}

describe('presign-upload', () => {
  it('rfq: presigned PUT to R2 rfq/<key>, 300 s, Content-Type signed; PUT then GET returns the same SHA-256', async () => {
    const res = await ours({ search: '?action=presign-upload', json: { fileName: 'part 1.STEP', prefix: 'RFQ-02102026-1/part-a', contentType: 'model/step' } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.key).toBe('RFQ-02102026-1/part-a/part_1.STEP');
    expect(body.publicUrl).toBe(`https://${RFQ_BUCKET}.s3.${REGION}.amazonaws.com/RFQ-02102026-1/part-a/part_1.STEP`);
    const url = new URL(body.uploadUrl);
    expect(url.host).toBe(R2_HOST);
    expect(url.pathname).toBe('/microns-private/rfq/RFQ-02102026-1/part-a/part_1.STEP');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');

    const file = crypto.getRandomValues(new Uint8Array(65_536));
    expect((await fake.fetch(body.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } })).status).toBe(403);
    expect((await fake.fetch(body.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': 'model/step' } })).status).toBe(200);
    expect(r2Keys()).toEqual(['rfq/RFQ-02102026-1/part-a/part_1.STEP']);
    expect(fake.keys(RFQ_BUCKET)).toEqual([]);

    const dl = await json(await ours({ search: '?action=presign-download', json: { key: body.key } }));
    expect(new URL(dl.url).host).toBe(R2_HOST);
    const got = new Uint8Array(await (await fake.fetch(dl.url)).arrayBuffer());
    expect(await sha256(got)).toBe(await sha256(file));
  });

  it('defaults Content-Type to application/octet-stream', async () => {
    const body = await json(await ours({ search: '?action=presign-upload', json: { fileName: 'a.step', prefix: 'RFQ-1' } }));
    expect((await fake.fetch(body.uploadUrl, { method: 'PUT', body: enc('x'), headers: { 'Content-Type': 'application/octet-stream' } })).status).toBe(200);
  });

  it('articles: presigned PUT to the legacy articles bucket, never R2', async () => {
    const body = await json(await ours({ search: '?action=presign-upload', json: { fileName: 'hero.png', prefix: 'featured/7', contentType: 'image/png', scope: 'articles' } }));
    expect(new URL(body.uploadUrl).host).toBe(`${ARTICLES_BUCKET}.s3.${REGION}.amazonaws.com`);
    expect(body.publicUrl).toBe(`https://${ARTICLES_BUCKET}.s3.${REGION}.amazonaws.com/featured/7/hero.png`);
    expect((await fake.fetch(body.uploadUrl, { method: 'PUT', body: enc('png'), headers: { 'Content-Type': 'image/png' } })).status).toBe(200);
    expect(fake.keys(ARTICLES_BUCKET)).toEqual(['featured/7/hero.png']);
    expect(r2Keys()).toEqual([]);
  });

  it('refuses a key with a dot segment: 500, nothing signed', async () => {
    const res = await ours({ search: '?action=presign-upload', json: { fileName: 'x.step', prefix: 'RFQ-1/../RFQ-2' } });
    expect(res.status).toBe(500);
    expect((await json(res)).error).toContain('".." path segment');
  });
});

describe('presign-download', () => {
  it('falls back to legacy S3 for a key that is not in R2 (no existence check)', async () => {
    fake.seed(RFQ_BUCKET, 'RFQ-1/old.pdf', 'legacy bytes');
    const dl = await json(await ours({ search: '?action=presign-download', json: { key: 'RFQ-1/old.pdf' } }));
    const url = new URL(dl.url);
    expect(url.host).toBe(`${RFQ_BUCKET}.s3.${REGION}.amazonaws.com`);
    expect(await (await fake.fetch(dl.url)).text()).toBe('legacy bytes');
    const missing = await json(await ours({ search: '?action=presign-download', json: { key: 'RFQ-1/none.pdf' } }));
    expect(new URL(missing.url).host).toBe(`${RFQ_BUCKET}.s3.${REGION}.amazonaws.com`);
  });

  it('prefers R2 when the key exists in both stores', async () => {
    fake.seed(RFQ_BUCKET, 'RFQ-1/a.pdf', 'legacy');
    fake.seed('microns-private', 'rfq/RFQ-1/a.pdf', 'r2');
    const dl = await json(await ours({ search: '?action=presign-download', json: { key: 'RFQ-1/a.pdf' } }));
    expect(await (await fake.fetch(dl.url)).text()).toBe('r2');
  });

  it('articles scope reads the legacy articles bucket only', async () => {
    fake.seed('microns-private', 'rfq/featured/7/hero.png', 'r2');
    fake.seed(ARTICLES_BUCKET, 'featured/7/hero.png', 'article');
    const dl = await json(await ours({ search: '?action=presign-download', json: { key: 'featured/7/hero.png', scope: 'articles' } }));
    expect(await (await fake.fetch(dl.url)).text()).toBe('article');
  });

  it('expiresIn: default 3600, as requested below the cap, capped at maxExpiresIn for every caller', async () => {
    const ttl = async (expiresIn: unknown, c: FileConstraints) =>
      new URL((await json(await ours({ search: '?action=presign-download', json: { key: 'k', expiresIn } }, c))).url).searchParams.get('X-Amz-Expires');
    expect(await ttl(undefined, NO_FILE_CONSTRAINTS)).toBe('3600');
    expect(await ttl('60', NO_FILE_CONSTRAINTS)).toBe('60');
    expect(await ttl(99_999, NO_FILE_CONSTRAINTS)).toBe('3600');
    expect(await ttl(604_801, NO_FILE_CONSTRAINTS)).toBe('3600');
    expect(await ttl(99_999, CUSTOMER)).toBe('3600');
    expect(await ttl('abc', UNCAPPED)).toBe('3600');
  });
});

describe('delete', () => {
  it('rfq: deletes the key on both stores', async () => {
    fake.seed('microns-private', 'rfq/RFQ-1/a.pdf', 'r2');
    fake.seed(RFQ_BUCKET, 'RFQ-1/a.pdf', 'legacy');
    fake.seed(RFQ_BUCKET, 'RFQ-1/b.pdf', 'legacy');
    const res = await ours({ search: '?action=delete', json: { key: 'RFQ-1/a.pdf' } });
    expect(await res.text()).toBe('{"success":true}');
    expect(r2Keys()).toEqual([]);
    expect(fake.keys(RFQ_BUCKET)).toEqual(['RFQ-1/b.pdf']);
  });

  it('articles: legacy articles bucket only', async () => {
    fake.seed('microns-private', 'rfq/featured/7/hero.png', 'r2');
    fake.seed(ARTICLES_BUCKET, 'featured/7/hero.png', 'a');
    await ours({ search: '?action=delete', json: { key: 'featured/7/hero.png', scope: 'articles' } });
    expect(fake.keys(ARTICLES_BUCKET)).toEqual([]);
    expect(r2Keys()).toEqual(['rfq/featured/7/hero.png']);
  });

  it('a refused legacy delete answers 500 with the S3 message and logs no key', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await handleFiles({
      resolved: build({ search: '?action=delete', json: { key: 'RFQ-1/secret-name.pdf' } }).resolved,
      principal: STAFF,
      constraints: NO_FILE_CONSTRAINTS,
      env: { ...env, LEGACY_AWS_SECRET_ACCESS_KEY: 'wrong' },
      ctx,
      fetchImpl: fake.fetch,
    });
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'The request signature we calculated does not match the signature you provided' });
    const line = logs.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain('[microns-site] files error');
    expect(line).not.toContain('secret-name');
    logs.mockRestore();
  });
});

describe('delete-folder', () => {
  function seedFolders(): void {
    fake.seed('microns-private', 'rfq/RFQ-02102026-1/a.step', 'r2');
    fake.seed('microns-private', 'rfq/RFQ-02102026-10/b.step', 'r2');
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-1/a.step', 'legacy');
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-1/c.step', 'legacy');
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-10/b.step', 'legacy');
  }

  for (const prefix of ['RFQ-02102026-1', 'RFQ-02102026-1/']) {
    it(`prefix ${JSON.stringify(prefix)} deletes RFQ-02102026-1/ on both stores and leaves RFQ-02102026-10/`, async () => {
      seedFolders();
      const res = await ours({ search: '?action=delete-folder', json: { prefix } }, STAFF_FOLDER);
      expect(await res.text()).toBe('{"success":true,"deletedCount":2}');
      expect(r2Keys()).toEqual(['rfq/RFQ-02102026-10/b.step']);
      expect(fake.keys(RFQ_BUCKET)).toEqual(['RFQ-02102026-10/b.step']);
    });
  }

  it('the same normalisation applies without a prefix pattern', async () => {
    seedFolders();
    await ours({ search: '?action=delete-folder', json: { prefix: 'RFQ-02102026-1' } }, NO_FILE_CONSTRAINTS);
    expect(fake.keys(RFQ_BUCKET)).toEqual(['RFQ-02102026-10/b.step']);
  });

  it('nothing under the folder: success false, deletedCount 0', async () => {
    seedFolders();
    expect(await (await ours({ search: '?action=delete-folder', json: { prefix: 'RFQ-02102026-2' } })).text()).toBe('{"success":false,"deletedCount":0}');
  });

  it('a prefix outside the pattern answers 400 invalid_prefix and deletes nothing', async () => {
    seedFolders();
    for (const prefix of ['R', 'RFQ-02102026-1/a', ['RFQ-02102026-1'], 'RFQ-02102026-1//']) {
      const res = await ours({ search: '?action=delete-folder', json: { prefix } }, STAFF_FOLDER);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":"invalid_prefix"}');
    }
    expect(fake.writes()).toEqual([]);
  });

  it('a whole RFQ id (UUID) is a valid folder', async () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    fake.seed('microns-private', `rfq/${id}/x.stl`, 'r2');
    expect(await (await ours({ search: '?action=delete-folder', json: { prefix: id } }, STAFF_FOLDER)).text()).toBe('{"success":true,"deletedCount":1}');
  });

  it('first list page of each store only (at most 1,000 keys each)', async () => {
    for (let i = 0; i < 1003; i++) fake.seed(RFQ_BUCKET, `RFQ-02102026-3/${String(i).padStart(4, '0')}.pdf`, 'x');
    const body = await json(await ours({ search: '?action=delete-folder', json: { prefix: 'RFQ-02102026-3' } }));
    expect(body).toEqual({ success: true, deletedCount: 1000 });
    expect(fake.keys(RFQ_BUCKET)).toHaveLength(3);
  });

  it('articles scope: legacy articles bucket only', async () => {
    fake.seed('microns-private', 'rfq/featured/7/a.png', 'r2');
    fake.seed(ARTICLES_BUCKET, 'featured/7/a.png', 'a');
    expect(await (await ours({ search: '?action=delete-folder', json: { prefix: 'featured/7', scope: 'articles' } })).text()).toBe('{"success":true,"deletedCount":1}');
    expect(r2Keys()).toEqual(['rfq/featured/7/a.png']);
  });
});

describe('list', () => {
  it('rfq: R2 and legacy merged in key order, R2 wins on a duplicate key, legacy URL format', async () => {
    fake.seed(RFQ_BUCKET, 'RFQ-1/b.pdf', 'l', { lastModified: new Date('2026-01-01T00:00:00Z') });
    fake.seed(RFQ_BUCKET, 'RFQ-1/d.pdf', 'l', { lastModified: new Date('2026-01-02T00:00:00Z') });
    fake.seed('microns-private', 'rfq/RFQ-1/b.pdf', 'r', { lastModified: new Date('2026-10-01T00:00:00Z') });
    fake.seed('microns-private', 'rfq/RFQ-1/a.pdf', 'r', { lastModified: new Date('2026-10-02T00:00:00Z') });
    fake.seed('microns-private', 'rfq/RFQ-2/z.pdf', 'r');
    const body = await json(await ours({ search: '?action=list', json: { prefix: 'RFQ-1/' } }));
    const u = (k: string) => `https://${RFQ_BUCKET}.s3.${REGION}.amazonaws.com/${k}`;
    expect(body).toEqual({
      objects: [
        { key: 'RFQ-1/a.pdf', url: u('RFQ-1/a.pdf'), lastModified: '2026-10-02T00:00:00.000Z' },
        { key: 'RFQ-1/b.pdf', url: u('RFQ-1/b.pdf'), lastModified: '2026-10-01T00:00:00.000Z' },
        { key: 'RFQ-1/d.pdf', url: u('RFQ-1/d.pdf'), lastModified: '2026-01-02T00:00:00.000Z' },
      ],
    });
  });

  it('keeps the raw prefix (no folder normalisation): RFQ-1 also lists RFQ-10/', async () => {
    fake.seed('microns-private', 'rfq/RFQ-1/a.pdf', 'r');
    fake.seed('microns-private', 'rfq/RFQ-10/b.pdf', 'r');
    const body = await json(await ours({ search: '?action=list', json: { prefix: 'RFQ-1' } }));
    expect(body.objects.map((o: { key: string }) => o.key)).toEqual(['RFQ-1/a.pdf', 'RFQ-10/b.pdf']);
  });

  it('formats a LastModified without milliseconds as an ISO date with milliseconds (as the AWS SDK Date does)', async () => {
    fake.seed(RFQ_BUCKET, 'RFQ-1/a.pdf', 'l', { lastModified: new Date('2026-01-01T00:00:00Z') });
    const secondsOnly: typeof fetch = async (input, init) => {
      const res = await fake.fetch(input, init);
      const text = await res.text();
      return new Response(text.replace(/\.000Z</g, 'Z<'), { status: res.status, headers: res.headers });
    };
    const res = await handleFiles({ resolved: build({ search: '?action=list', json: {} }).resolved, principal: STAFF, constraints: NO_FILE_CONSTRAINTS, env, ctx, fetchImpl: secondsOnly });
    expect((await json(res)).objects[0].lastModified).toBe('2026-01-01T00:00:00.000Z');
  });

  it('articles: legacy articles bucket only', async () => {
    fake.seed('microns-private', 'rfq/featured/1.png', 'r');
    fake.seed(ARTICLES_BUCKET, 'featured/2.png', 'a');
    const body = await json(await ours({ search: '?action=list', json: { scope: 'articles', prefix: 'featured/' } }));
    expect(body.objects.map((o: { key: string }) => o.key)).toEqual(['featured/2.png']);
    expect(body.objects[0].url).toBe(`https://${ARTICLES_BUCKET}.s3.${REGION}.amazonaws.com/featured/2.png`);
  });
});

// ----- FileConstraints -----

describe('FileConstraints on presign-upload', () => {
  const upload = (b: Record<string, unknown>, c: FileConstraints) => ours({ search: '?action=presign-upload', json: { prefix: 'RFQ-02102026-5/part-a', contentType: 'model/step', ...b } }, c);

  it('extension allow-list for non-staff (case-insensitive, on the sanitised name); staff unrestricted', async () => {
    for (const fileName of ['a.STEP', 'b.stp', 'c.x_t', 'd.SLDPRT', 'e.jpeg', 'f.zip', 'g h.pdf']) {
      expect((await upload({ fileName }, CUSTOMER)).status, fileName).toBe(200);
    }
    for (const fileName of ['evil.exe', 'noext', 'x.step.html', 'x.']) {
      const res = await upload({ fileName }, CUSTOMER);
      expect(res.status, fileName).toBe(400);
      expect(await res.text()).toBe('{"error":"file_type_not_allowed"}');
    }
    expect((await upload({ fileName: 'evil.exe' }, NO_FILE_CONSTRAINTS)).status).toBe(200);
  });

  it('declared size: above the cap -> 400 file_too_large; within it -> signed as Content-Length', async () => {
    const tooBig = await upload({ fileName: 'a.step', size: 209_715_201 }, CUSTOMER);
    expect(tooBig.status).toBe(400);
    expect(await tooBig.text()).toBe('{"error":"file_too_large"}');
    const body = await json(await upload({ fileName: 'a.step', size: 5 }, CUSTOMER));
    expect(new URL(body.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect((await fake.fetch(body.uploadUrl, { method: 'PUT', body: enc('123456'), headers: { 'Content-Type': 'model/step' } })).status).toBe(403);
    expect((await fake.fetch(body.uploadUrl, { method: 'PUT', body: enc('12345'), headers: { 'Content-Type': 'model/step' } })).status).toBe(200);
    // A size that is not a number is not a declaration.
    const unsized = await json(await upload({ fileName: 'b.step', size: '5' }, CUSTOMER));
    expect(new URL(unsized.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    // Staff: never signed, never capped.
    const staff = await json(await upload({ fileName: 'c.step', size: 209_715_201 }, NO_FILE_CONSTRAINTS));
    expect(new URL(staff.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
  });

  it('noOverwrite: an existing key in R2 or in legacy S3 -> 409 exists; staff may overwrite', async () => {
    fake.seed('microns-private', 'rfq/RFQ-02102026-5/part-a/r2.step', 'x');
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-5/part-a/old.step', 'x');
    for (const fileName of ['r2.step', 'old.step']) {
      const res = await upload({ fileName }, CUSTOMER);
      expect(res.status, fileName).toBe(409);
      expect(await res.text()).toBe('{"error":"exists"}');
    }
    expect((await upload({ fileName: 'new.step' }, CUSTOMER)).status).toBe(200);
    expect((await upload({ fileName: 'r2.step' }, NO_FILE_CONSTRAINTS)).status).toBe(200);
  });

  it('anonymous: at most 50 objects under the RFQ folder (both stores, duplicates once, other folders ignored)', async () => {
    for (let i = 0; i < 30; i++) fake.seed('microns-private', `rfq/RFQ-02102026-5/part-a/r${i}.step`, 'x');
    for (let i = 0; i < 19; i++) fake.seed(RFQ_BUCKET, `RFQ-02102026-5/part-b/l${i}.step`, 'x');
    fake.seed(RFQ_BUCKET, 'RFQ-02102026-5/part-a/r0.step', 'x');
    for (let i = 0; i < 60; i++) fake.seed('microns-private', `rfq/RFQ-02102026-50/p/${i}.step`, 'x');
    // 49 objects: one more is allowed.
    const ok = await json(await upload({ fileName: 'last.step' }, ANONYMOUS));
    expect((await fake.fetch(ok.uploadUrl, { method: 'PUT', body: enc('x'), headers: { 'Content-Type': 'model/step' } })).status).toBe(200);
    // 50 objects: refused.
    const full = await upload({ fileName: 'one-more.step' }, ANONYMOUS);
    expect(full.status).toBe(409);
    expect(await full.text()).toBe('{"error":"limit_reached"}');
    // Signed-in customers and staff have no object cap.
    expect((await upload({ fileName: 'one-more.step' }, CUSTOMER)).status).toBe(200);
  });

  it('40 sequential anonymous uploads into one fresh RFQ are all allowed', async () => {
    for (let i = 0; i < 40; i++) {
      const res = await upload({ fileName: `part-${i}.step`, size: 1 }, ANONYMOUS);
      expect(res.status, String(i)).toBe(200);
      const { uploadUrl } = await json(res);
      expect((await fake.fetch(uploadUrl, { method: 'PUT', body: enc('x'), headers: { 'Content-Type': 'model/step' } })).status).toBe(200);
    }
    expect(r2Keys()).toHaveLength(40);
  });

  it('staff: true switches every upload limit off, even when limits are set', async () => {
    const staffWithLimits: FileConstraints = { ...ANONYMOUS, staff: true };
    fake.seed('microns-private', 'rfq/RFQ-02102026-5/part-a/exists.step', 'x');
    for (let i = 0; i < 60; i++) fake.seed(RFQ_BUCKET, `RFQ-02102026-5/many/${i}.step`, 'x');
    for (const b of [{ fileName: 'tool.exe' }, { fileName: 'exists.step' }, { fileName: 'big.step', size: 1e12 }]) {
      const res = await upload(b, staffWithLimits);
      expect(res.status, b.fileName).toBe(200);
      expect(new URL((await json(res)).uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    }
  });

  it('a constraint answer happens before anything is signed or written', async () => {
    await upload({ fileName: 'evil.exe' }, ANONYMOUS);
    await upload({ fileName: 'a.step', size: 1e12 }, ANONYMOUS);
    expect(fake.calls).toEqual([]);
    expect(fake.writes()).toEqual([]);
  });
});

// ----- sentinels and headers -----

describe('sentinels and response headers', () => {
  it('#options -> 204, #unknown -> 400 with the raw value, #throws -> 500 with the parser message', async () => {
    const run = (r: ResolvedApi) => handleFiles({ resolved: r, principal: { class: 'ANON' }, constraints: NO_FILE_CONSTRAINTS, env, ctx, fetchImpl: fake.fetch });
    const opt = await run(build({ method: 'OPTIONS' }).resolved);
    expect(opt.status).toBe(204);
    expect(await opt.text()).toBe('');
    expect(await (await run(build({ search: '?action=a&action=b', json: {} }).resolved)).text()).toBe('{"error":"Unknown action: a,b"}');
    expect(await (await run(build({ search: '?action=list', text: '{' }).resolved)).text()).toBe('{"error":"Invalid JSON"}');
    expect(await (await run({ ...build({ search: '?action=x' }).resolved, action: '#method' })).text()).toBe('{"error":"Unknown action: x"}');
    expect(fake.calls).toEqual([]);
  });

  it('handler-shaped answers carry JSON with charset and the weak ETag of the body; constraint answers carry JSON', async () => {
    const res = await ours({ search: '?action=delete', json: { key: 'x' } });
    const text = await res.text();
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('etag')).toBe(weakEtag(text));
    const refused = await ours({ search: '?action=presign-upload', json: { fileName: 'x.exe' } }, CUSTOMER);
    expect(refused.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });
});
