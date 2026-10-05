// Helpers of the CQ T2 files (test/t2/cad.t2.ts, test/t2/quote.t2.ts), profile 'agents': rows seeded into the
// mini-PostgREST, R2 objects and Workflow instances through the Local Explorer, and the records of the unfold and
// Resend stubs. The generic helpers (URLs, polling, rows, KV flags, events) are those of the intake T2 files.
// Only pure modules are imported: the T2 config has no aliases for the runtime modules.

import { call, json, JSON_HEADERS, type Row, type Urls } from '../intake/t2-helpers';

export * from '../intake/t2-helpers';

export const BUCKET = 'microns-private';

/** Adds rows to the mini-PostgREST (tables listed in `replace` are emptied first). */
export async function seed(u: Urls, tables: Record<string, Row[]>, replace = false): Promise<void> {
  const res = await call(`${u.stub}/__stub/seed`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ tables, replace }) });
  if (res.status !== 204) throw new Error(`seed: ${res.status}`);
}

/** Only the rows whose id is not stored yet (a second run in the same harness adds nothing twice). */
export async function newRows(u: Urls, table: string, list: Row[]): Promise<Row[]> {
  const stored = new Set((await json<Row[]>(await call(`${u.stub}/__stub/rows/${table}`))).map((r) => String(r.id)));
  return list.filter((r) => !stored.has(String(r.id)));
}

function objectUrl(u: Urls, key: string): string {
  return `${u.explorer}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
}

export async function r2Put(u: Urls, key: string, bytes: Uint8Array): Promise<void> {
  await call(objectUrl(u, key), { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
}

/** The object's bytes, or null when it does not exist. */
export async function r2Get(u: Urls, key: string): Promise<Uint8Array | null> {
  const res = await call(objectUrl(u, key));
  if (res.status === 404) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** Starts a Workflow instance with a given id. */
export async function startInstance(u: Urls, workflow: string, id: string, params: unknown): Promise<void> {
  const res = await call(`${u.explorer}/workflows/${workflow}/instances`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, params }) });
  if (res.status >= 300) throw new Error(`start ${workflow}/${id}: ${res.status}`);
}

async function flagUrl(u: Urls, key: string): Promise<string> {
  const body = await json<{ result: Array<{ id: string; title?: string }> }>(await call(`${u.explorer}/storage/kv/namespaces`));
  const hit = body.result.find((n) => /FLAGS/.test(n.id) || /FLAGS/.test(n.title ?? ''));
  if (!hit) throw new Error('no FLAGS namespace');
  return `${u.explorer}/storage/kv/namespaces/${encodeURIComponent(hit.id)}/values/${encodeURIComponent(key)}`;
}

/** The raw KV value of a flag key (null when absent), so a test can put back what it found. */
export async function flagValue(u: Urls, key: string): Promise<string | null> {
  const res = await call(await flagUrl(u, key));
  return res.status === 404 ? null : res.text();
}

/** Puts a raw KV value back (null deletes the key). */
export async function restoreFlag(u: Urls, key: string, raw: string | null): Promise<void> {
  const url = await flagUrl(u, key);
  if (raw === null) await call(url, { method: 'DELETE' });
  else await call(url, { method: 'PUT', body: raw, headers: { 'content-type': 'application/octet-stream' } });
}

export interface UnfoldCall {
  method: string;
  path: string;
  api_key: 'expected' | 'other' | 'missing';
  fields?: Record<string, string>;
  part_names?: string[];
  file?: { filename: string; size: number; sha256: string } | null;
}

export async function unfoldCalls(u: Urls): Promise<UnfoldCall[]> {
  const res = await call(`${u.stub}/__stub/unfold/calls`);
  if (res.status === 404) throw new Error('the unfold stub (stubs/unfold.mjs) is not mounted');
  return json(res);
}

export interface ResendEmail {
  id: string;
  idempotency_key: string | null;
  from: string;
  to: string | string[];
  reply_to: string | string[] | null;
  subject: string;
  header_names: string[];
  message_id_header: string | null;
  attachments: string[];
}

export async function resendEmails(u: Urls): Promise<ResendEmail[]> {
  return json(await call(`${u.stub}/__stub/resend/emails`));
}
