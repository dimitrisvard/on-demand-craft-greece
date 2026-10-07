// fetch over node:http with a given Host header, for the T2 files that reach the ops default fetch of a harness
// instance (test/t2/mcp.t2.ts, test/t2/scrapers.t2.ts): Node's fetch replaces a Host header with the URL's host,
// and wrangler dev takes the request URL's hostname from the Host header.

import http from 'node:http';
import { Readable } from 'node:stream';

/** fetch over node:http with the Host header set (Node's fetch replaces it with the URL's host). */
export function hostFetch(host: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    headers.host = host;
    if (body) headers['content-length'] = String(body.length);
    return new Promise<Response>((resolve, reject) => {
      const req = http.request({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: request.method, headers }, (res) => {
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const v of value) out.append(name, v);
          else if (value !== undefined) out.set(name, String(value));
        }
        const status = res.statusCode ?? 502;
        const empty = request.method === 'HEAD' || status === 204 || status === 304;
        if (empty) res.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers: out }));
      });
      req.on('error', reject);
      init?.signal?.addEventListener('abort', () => req.destroy(new Error('aborted')));
      req.end(body);
    });
  }) as typeof fetch;
}
