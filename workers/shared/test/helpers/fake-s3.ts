// Fake S3 for tests: one in-memory object store reachable three ways.
//   fetch       in-process fetch handler for the hosts of the configured buckets (R2 path style, AWS virtual
//               host), used as `fetchImpl` and to PUT/GET through presigned URLs;
//   r2Binding   an R2Bucket view (head/get/put/delete/list) over a bucket of the same store;
//   listen()    a Node HTTP server on 127.0.0.1 that serves every bucket path style (for the AWS SDK).
// Every request must be signed (query or Authorization header). The signature is re-computed with
// @smithy/signature-v4 (the signer inside the AWS SDK) as an independent oracle; a mismatch answers 403
// SignatureDoesNotMatch as S3 does. Credentials, region and service in the scope must be the bucket's own.

import { Sha256 } from '@aws-crypto/sha256-js';
import { SignatureV4 } from '@smithy/signature-v4';

export interface FakeBucketConfig {
  name: string;
  /** Host the bucket answers on over HTTPS: '<bucket>.s3.<region>.amazonaws.com' (virtual) or '<account>[.eu].r2.cloudflarestorage.com' (path). */
  host: string;
  style: 'path' | 'virtual';
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
  lastModified: Date;
  etag: string;
}

export interface FakeCall {
  via: 's3' | 'r2';
  method: string;
  bucket: string | null;
  key: string | null;
  op: string;
  status: number;
}

export interface FakeS3 {
  readonly fetch: typeof fetch;
  r2Binding(bucket: string): R2Bucket;
  seed(bucket: string, key: string, body: Uint8Array | string, o?: { contentType?: string; lastModified?: Date }): void;
  object(bucket: string, key: string): StoredObject | undefined;
  keys(bucket: string): string[];
  readonly calls: FakeCall[];
  /** Calls that changed the store (PUT/DELETE over S3, put/delete over the binding). */
  writes(): FakeCall[];
  /** Empties every bucket and the call log. */
  reset(): void;
  listen(): Promise<{ url: string; close(): Promise<void> }>;
}

const XML = 'application/xml';

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

function errorXml(status: number, code: string, message: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`;
  return new Response(body, { status, headers: { 'content-type': XML } });
}

/** UTF-8 binary order (S3 list order) equals code point order. */
export function compareKeys(a: string, b: string): number {
  const ia = [...a];
  const ib = [...b];
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
    const d = (ia[i].codePointAt(0) as number) - (ib[i].codePointAt(0) as number);
    if (d !== 0) return d;
  }
  return ia.length - ib.length;
}

function rfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** S3's canonical URI: each segment decoded, then encoded with RFC 3986 unreserved characters only. */
function canonicalPath(rawPath: string): string {
  return rawPath.split('/').map((s) => rfc3986(decodeURIComponent(s))).join('/');
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseAmzDate(v: string | null): Date | null {
  const m = v ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v) : null;
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

function toBytes(value: Uint8Array | string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

interface Route { config: FakeBucketConfig; key: string | null; rawKeyPath: string }

export function createFakeS3(buckets: FakeBucketConfig[], o: { now?: () => number } = {}): FakeS3 {
  const now = o.now ?? (() => Date.now());
  const store = new Map<string, Map<string, StoredObject>>(buckets.map((b) => [b.name, new Map()]));
  const calls: FakeCall[] = [];
  const localHosts = new Set<string>();
  let etagCounter = 0;

  function bucketMap(name: string): Map<string, StoredObject> {
    const m = store.get(name);
    if (!m) throw new Error(`fake-s3: no bucket ${name}`);
    return m;
  }

  function putObject(bucket: string, key: string, body: Uint8Array, contentType: string, lastModified?: Date): StoredObject {
    const obj: StoredObject = { body, contentType, lastModified: lastModified ?? new Date(Math.floor(now() / 1000) * 1000), etag: `"etag-${++etagCounter}"` };
    bucketMap(bucket).set(key, obj);
    return obj;
  }

  function route(url: URL): Route | null {
    const virtual = buckets.find((b) => b.style === 'virtual' && b.host === url.host);
    if (virtual) {
      const rawKeyPath = url.pathname.slice(1);
      return { config: virtual, key: rawKeyPath ? decodeURIComponent(rawKeyPath) : null, rawKeyPath };
    }
    const local = localHosts.has(url.host);
    const segments = url.pathname.split('/');
    const name = decodeURIComponent(segments[1] ?? '');
    const config = buckets.find((b) => b.name === name && (local || (b.style === 'path' && b.host === url.host)));
    if (!config) return null;
    const rawKeyPath = segments.slice(2).join('/');
    return { config, key: segments.length > 2 && rawKeyPath ? decodeURIComponent(rawKeyPath) : null, rawKeyPath };
  }

  function signer(config: FakeBucketConfig, region: string): SignatureV4 {
    return new SignatureV4({
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      region,
      service: 's3',
      sha256: Sha256,
      uriEscapePath: false,
      applyChecksum: false,
    });
  }

  /** Region of the credential scope, or the error answer. GetBucketLocation may be signed for any region. */
  function scopeRegion(config: FakeBucketConfig, credential: string | null, anyRegion: boolean): string | Response {
    const parts = (credential ?? '').split('/');
    if (parts.length !== 5 || parts[4] !== 'aws4_request') return errorXml(400, 'AuthorizationQueryParametersError', 'Malformed credential');
    if (parts[0] !== config.accessKeyId) return errorXml(403, 'InvalidAccessKeyId', 'The access key does not exist for this bucket');
    if (parts[2] !== config.region && !anyRegion) return errorXml(400, 'AuthorizationHeaderMalformed', `The region '${parts[2]}' is wrong; expecting '${config.region}'`);
    if (parts[3] !== 's3') return errorXml(400, 'AuthorizationHeaderMalformed', 'Wrong service');
    return parts[2];
  }

  function signedHeaderValues(request: Request, names: string[], bodyLength: number): Record<string, string> | null {
    const out: Record<string, string> = {};
    for (const name of names) {
      if (name === 'host') continue;
      let value = request.headers.get(name);
      // An HTTP client sends Content-Length for a body; an in-process Request does not carry it.
      if (value === null && name === 'content-length') value = String(bodyLength);
      if (value === null) return null;
      out[name] = value;
    }
    return out;
  }

  async function verify(request: Request, url: URL, config: FakeBucketConfig, body: Uint8Array, anyRegion: boolean): Promise<Response | null> {
    const base = { method: request.method, protocol: url.protocol, hostname: url.hostname, port: url.port ? Number(url.port) : undefined, path: canonicalPath(url.pathname) };
    const signature = url.searchParams.get('X-Amz-Signature');
    if (signature !== null) {
      const sp = url.searchParams;
      const region = scopeRegion(config, sp.get('X-Amz-Credential'), anyRegion);
      if (typeof region !== 'string') return region;
      const date = parseAmzDate(sp.get('X-Amz-Date'));
      const expires = Number(sp.get('X-Amz-Expires'));
      if (!date || !Number.isFinite(expires)) return errorXml(400, 'AuthorizationQueryParametersError', 'Missing date or expiry');
      if (expires <= 0 || expires > 604_800) return errorXml(400, 'AuthorizationQueryParametersError', 'X-Amz-Expires must be between 1 and 604800');
      if (now() > date.getTime() + expires * 1000) return errorXml(403, 'AccessDenied', 'Request has expired');
      const signedNames = (sp.get('X-Amz-SignedHeaders') ?? '').split(';');
      const values = signedHeaderValues(request, signedNames, body.byteLength);
      if (!values) return errorXml(403, 'SignatureDoesNotMatch', 'A signed header is missing');
      const query: Record<string, string> = {};
      const auth = new Set(['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature']);
      for (const [k, v] of sp) if (!auth.has(k)) query[k] = v;
      const sha = new Set(['x-amz-content-sha256']);
      const presigned = await signer(config, region).presign(
        { ...base, query, headers: { host: url.host, ...values, 'x-amz-content-sha256': sp.get('X-Amz-Content-Sha256') ?? 'UNSIGNED-PAYLOAD' } },
        { signingDate: date, expiresIn: expires, unhoistableHeaders: sha, unsignableHeaders: sha, signableHeaders: new Set(signedNames) },
      );
      const q = presigned.query ?? {};
      const ok = q['X-Amz-Signature'] === signature && q['X-Amz-SignedHeaders'] === sp.get('X-Amz-SignedHeaders');
      return ok ? null : errorXml(403, 'SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided');
    }
    const authorization = request.headers.get('authorization');
    const m = authorization ? /^AWS4-HMAC-SHA256 Credential=([^,]+), ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(authorization) : null;
    if (!authorization || !m) return errorXml(403, 'AccessDenied', 'Access Denied');
    const region = scopeRegion(config, m[1], anyRegion);
    if (typeof region !== 'string') return region;
    const date = parseAmzDate(request.headers.get('x-amz-date'));
    if (!date) return errorXml(403, 'AccessDenied', 'Missing x-amz-date');
    if (Math.abs(now() - date.getTime()) > 15 * 60 * 1000) return errorXml(403, 'RequestTimeTooSkewed', 'The difference between the request time and the current time is too large');
    const payload = request.headers.get('x-amz-content-sha256');
    if (!payload) return errorXml(400, 'InvalidRequest', 'Missing required header for this request: x-amz-content-sha256');
    if (/^[0-9a-f]{64}$/.test(payload) && payload !== (await digestHex(body))) {
      return errorXml(400, 'XAmzContentSHA256Mismatch', 'The provided x-amz-content-sha256 header does not match what was computed');
    }
    const signedNames = m[2].split(';');
    const values = signedHeaderValues(request, signedNames.filter((n) => n !== 'x-amz-date'), body.byteLength);
    if (!values) return errorXml(403, 'SignatureDoesNotMatch', 'A signed header is missing');
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;
    const signed = await signer(config, region).sign(
      { ...base, query, headers: { host: url.host, ...values } },
      { signingDate: date, signableHeaders: new Set(signedNames) },
    );
    const expected = signed.headers['authorization'];
    return expected === authorization.replace(/, ?/g, ', ')
      ? null
      : errorXml(403, 'SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided');
  }

  function listXml(bucket: string, sp: URLSearchParams): string {
    const prefix = sp.get('prefix') ?? '';
    const maxKeys = Math.min(Number(sp.get('max-keys') ?? '1000') || 1000, 1000);
    const token = sp.get('continuation-token');
    const after = token ? decodeURIComponent(token) : sp.get('start-after') ?? '';
    const all = [...bucketMap(bucket).entries()]
      .filter(([k]) => k.startsWith(prefix) && (!after || compareKeys(k, after) > 0))
      .sort(([a], [b]) => compareKeys(a, b));
    const page = all.slice(0, maxKeys);
    const truncated = all.length > page.length;
    const contents = page
      .map(([k, v]) => `<Contents><Key>${xmlEscape(k)}</Key><LastModified>${v.lastModified.toISOString()}</LastModified><ETag>${xmlEscape(v.etag)}</ETag><Size>${v.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`)
      .join('');
    const next = truncated ? `<NextContinuationToken>${xmlEscape(encodeURIComponent(page[page.length - 1][0]))}</NextContinuationToken>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const r = route(url);
    if (!r) throw new TypeError(`fetch failed: fake-s3 does not serve ${url.host}${url.pathname}`);
    const body = request.method === 'GET' || request.method === 'HEAD' ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());
    const record = (op: string, status: number): void => {
      calls.push({ via: 's3', method: request.method, bucket: r.config.name, key: r.key, op, status });
    };
    const isLocation = r.key === null && request.method === 'GET' && url.searchParams.has('location');
    const denied = await verify(request, url, r.config, body, isLocation);
    if (denied) {
      record('denied', denied.status);
      return denied;
    }
    const objects = bucketMap(r.config.name);
    if (r.key === null) {
      if (isLocation) {
        record('GetBucketLocation', 200);
        const constraint = r.config.region === 'us-east-1' ? '' : r.config.region;
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${constraint}</LocationConstraint>`, { status: 200, headers: { 'content-type': XML } });
      }
      if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
        record('ListObjectsV2', 200);
        return new Response(listXml(r.config.name, url.searchParams), { status: 200, headers: { 'content-type': XML } });
      }
      record('bucket', 400);
      return errorXml(400, 'InvalidRequest', 'Only ListObjectsV2 is supported on a bucket');
    }
    const key = r.key;
    switch (request.method) {
      case 'PUT': {
        const obj = putObject(r.config.name, key, body, request.headers.get('content-type') ?? 'binary/octet-stream');
        record('PutObject', 200);
        return new Response(null, { status: 200, headers: { etag: obj.etag } });
      }
      case 'GET':
      case 'HEAD': {
        const obj = objects.get(key);
        const op = request.method === 'GET' ? 'GetObject' : 'HeadObject';
        if (!obj) {
          record(op, 404);
          return request.method === 'GET' ? errorXml(404, 'NoSuchKey', 'The specified key does not exist.') : new Response(null, { status: 404 });
        }
        record(op, 200);
        const headers = { 'content-type': obj.contentType, 'content-length': String(obj.body.byteLength), etag: obj.etag, 'last-modified': obj.lastModified.toUTCString() };
        return new Response(request.method === 'GET' ? obj.body.slice() : null, { status: 200, headers });
      }
      case 'DELETE':
        objects.delete(key);
        record('DeleteObject', 204);
        return new Response(null, { status: 204 });
      default:
        record('method', 405);
        return errorXml(405, 'MethodNotAllowed', 'The specified method is not allowed against this resource.');
    }
  }

  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return handle(new Request(input as RequestInfo, init));
    } catch (e) {
      return Promise.reject(e);
    }
  }) as typeof fetch;

  function r2Object(key: string, obj: StoredObject): R2Object {
    return {
      key,
      version: obj.etag,
      size: obj.body.byteLength,
      etag: obj.etag.replace(/"/g, ''),
      httpEtag: obj.etag,
      uploaded: obj.lastModified,
      httpMetadata: { contentType: obj.contentType },
      customMetadata: {},
      storageClass: 'Standard',
      checksums: { toJSON: () => ({}) },
      writeHttpMetadata: () => undefined,
    } as unknown as R2Object;
  }

  function r2Binding(bucket: string): R2Bucket {
    const objects = bucketMap(bucket);
    const record = (method: string, key: string | null, status = 200): void => {
      calls.push({ via: 'r2', method, bucket, key, op: `r2.${method}`, status });
    };
    const binding = {
      async head(key: string) {
        record('head', key);
        const obj = objects.get(key);
        return obj ? r2Object(key, obj) : null;
      },
      async get(key: string) {
        record('get', key);
        const obj = objects.get(key);
        if (!obj) return null;
        const bytes = obj.body.slice();
        return Object.assign(r2Object(key, obj), {
          body: new Response(bytes).body,
          bodyUsed: false,
          arrayBuffer: async () => bytes.buffer,
          text: async () => new TextDecoder().decode(bytes),
        });
      },
      async put(key: string, value: Uint8Array | string | ArrayBuffer | ArrayBufferView | null, opts?: { httpMetadata?: { contentType?: string } }) {
        record('put', key);
        const obj = putObject(bucket, key, value === null ? new Uint8Array() : toBytes(value), opts?.httpMetadata?.contentType ?? 'application/octet-stream');
        return r2Object(key, obj);
      },
      async delete(keys: string | string[]) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (list.length > 1000) throw new Error('fake-r2: delete takes at most 1000 keys');
        for (const key of list) {
          record('delete', key);
          objects.delete(key);
        }
      },
      async list(opts: { prefix?: string; limit?: number; cursor?: string; startAfter?: string } = {}) {
        record('list', opts.prefix ?? '');
        const limit = Math.min(opts.limit ?? 1000, 1000);
        const after = opts.cursor ? decodeURIComponent(opts.cursor) : opts.startAfter ?? '';
        const all = [...objects.entries()]
          .filter(([k]) => k.startsWith(opts.prefix ?? '') && (!after || compareKeys(k, after) > 0))
          .sort(([a], [b]) => compareKeys(a, b));
        const page = all.slice(0, limit);
        const truncated = all.length > page.length;
        return {
          objects: page.map(([k, v]) => r2Object(k, v)),
          truncated,
          ...(truncated ? { cursor: encodeURIComponent(page[page.length - 1][0]) } : {}),
          delimitedPrefixes: [],
        };
      },
    };
    return binding as unknown as R2Bucket;
  }

  async function listen(): Promise<{ url: string; close(): Promise<void> }> {
    // Loaded at run time so the module type-checks without Node type declarations (Worker tsconfig).
    const nodeHttp = (await import(/* @vite-ignore */ NODE_HTTP)) as NodeHttp;
    const server = nodeHttp.createServer((req, res) => {
      const chunks: Uint8Array[] = [];
      req.on('data', (c: Uint8Array) => chunks.push(c));
      req.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
        const method = req.method ?? 'GET';
        const hasBody = method !== 'GET' && method !== 'HEAD';
        let total = 0;
        for (const c of chunks) total += c.byteLength;
        const bytes = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
          bytes.set(c, at);
          at += c.byteLength;
        }
        handle(new Request(`http://${headers.get('host')}${req.url}`, { method, headers, body: hasBody ? bytes : undefined }))
          .catch(() => errorXml(404, 'NoSuchBucket', 'The specified bucket does not exist'))
          .then(async (response) => {
            const out = new Uint8Array(await response.arrayBuffer());
            const head: Record<string, string> = {};
            response.headers.forEach((v, k) => {
              head[k] = v;
            });
            if (method !== 'HEAD') head['content-length'] = String(out.byteLength);
            res.writeHead(response.status, head);
            res.end(method === 'HEAD' ? undefined : out);
          });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    const host = `127.0.0.1:${address.port}`;
    localHosts.add(host);
    return {
      url: `http://${host}`,
      close: () => new Promise<void>((resolve) => {
        localHosts.delete(host);
        server.close(() => resolve());
      }),
    };
  }

  return {
    fetch: fakeFetch,
    r2Binding,
    seed(bucket, key, body, opts) {
      putObject(bucket, key, toBytes(body), opts?.contentType ?? 'application/octet-stream', opts?.lastModified);
    },
    object: (bucket, key) => bucketMap(bucket).get(key),
    keys: (bucket) => [...bucketMap(bucket).keys()].sort(compareKeys),
    calls,
    reset() {
      for (const m of store.values()) m.clear();
      calls.length = 0;
    },
    writes: () => calls.filter((c) => c.status < 300 && /^(PutObject|DeleteObject|r2\.put|r2\.delete)$/.test(c.op)),
    listen,
  };
}

const NODE_HTTP: string = 'node:http';

interface NodeHttp {
  createServer(listener: (req: NodeIncoming, res: NodeOutgoing) => void): {
    listen(port: number, host: string, cb: () => void): void;
    address(): unknown;
    close(cb: () => void): void;
  };
}
interface NodeIncoming {
  method?: string;
  url?: string;
  rawHeaders: string[];
  on(event: 'data', cb: (chunk: Uint8Array) => void): void;
  on(event: 'end', cb: () => void): void;
}
interface NodeOutgoing {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: Uint8Array): void;
}
