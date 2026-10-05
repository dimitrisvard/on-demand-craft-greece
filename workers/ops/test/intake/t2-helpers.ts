// Helpers of the IN T2 files (test/t2/mail.t2.ts, test/t2/intake.t2.ts), profile 'agents': mail injection through
// the Local Explorer (POST /cdn-cgi/local/explorer/api/local/email/routing/send?worker=microns-mail; the runtime sets
// its own Message-ID and returns it), the mini-PostgREST and provider stubs of the stub server, KV flags and
// Workflow instances through the Local Explorer, and the prediction of the intake model input (the same builders
// the Workflow uses), so LLM fixtures can be registered with the stub before a mail arrives.
// Only pure modules of src/ are imported: the T2 config has no aliases for the runtime modules.

import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { canonicalJson } from '../../src/agents/ids';
import { classifyContent, extractContent, type EmailForModel } from '../../src/mail-in/intake';
import type { AttachmentRecord } from '../../src/mail-in/attachments';
import { stripQuoted } from '../../src/mail-in/quote-strip';
import { displayName } from '../../src/mail-in/safe-name';
import { sniffKind } from '../../src/mail-in/sniff';
import type { LlmContent } from '../../src/ports/index';

export type Row = Record<string, unknown>;

export const TENANT = '00000000-0000-0000-0000-000000000001';
export const JSON_HEADERS = { 'content-type': 'application/json' };

export interface Urls {
  site: string;
  stub: string;
  explorer: string;
  tmp: string;
  approvalSecret: string;
}

export function globalUrls(): Urls {
  const site = process.env.T2_SITE_URL ?? '';
  return {
    site,
    stub: process.env.T2_STUB_URL ?? '',
    explorer: process.env.T2_EXPLORER_URL ?? `${site}/cdn-cgi/local/explorer/api`,
    tmp: process.env.T2_TMP ?? '',
    approvalSecret: process.env.T2_APPROVAL_SECRET ?? '',
  };
}

export async function call(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 404) throw new Error(`${init?.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

export async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`not JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function sha256hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

// ----- stub server -----

export async function rows(u: Urls, table: string): Promise<Row[]> {
  return json<Row[]>(await call(`${u.stub}/__stub/rows/${table}`));
}

export async function rpc(u: Urls, name: string, args: Record<string, unknown>): Promise<unknown> {
  return json(await call(`${u.stub}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...JSON_HEADERS, apikey: 't2', authorization: 'Bearer t2' }, body: JSON.stringify(args) }));
}

export async function telegramCalls(u: Urls): Promise<Array<{ method: string; body: Record<string, unknown> }>> {
  return json(await call(`${u.stub}/__stub/telegram/calls`));
}

export async function llmRequests(u: Urls): Promise<Array<{ prompt: string; sha256: string; model: string; x_api_key: boolean; cf_aig_authorization: boolean; cf_aig_metadata_keys: string[]; cf_aig_collect_log_payload: string | null; fallbacks: unknown }>> {
  return json(await call(`${u.stub}/__stub/anthropic/requests`));
}

/** Messages API response body of a structured output. */
export function messagesResponse(model: string, value: unknown): Record<string, unknown> {
  return {
    id: 'msg_t2',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: JSON.stringify(value) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

export async function registerFixture(u: Urls, prompt: string, sha: string, value: unknown): Promise<void> {
  const model = prompt.includes('extract') ? 'claude-sonnet-5-5' : 'claude-haiku-4-5-20251001';
  const res = await call(`${u.stub}/__stub/anthropic/fixtures`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ prompt, request_sha256: sha, response: messagesResponse(model, value) }) });
  if (res.status !== 204) throw new Error(`fixture registration: ${res.status}`);
}

// ----- Local Explorer -----

let flagsNamespace = '';

async function kvUrl(u: Urls, key: string): Promise<string> {
  if (!flagsNamespace) {
    const body = await json<{ result: Array<{ id: string; title?: string }> }>(await call(`${u.explorer}/storage/kv/namespaces`));
    const hit = body.result.find((n) => /FLAGS/.test(n.id) || /FLAGS/.test(n.title ?? ''));
    if (!hit) throw new Error('no FLAGS namespace');
    flagsNamespace = hit.id;
  }
  return `${u.explorer}/storage/kv/namespaces/${encodeURIComponent(flagsNamespace)}/values/${encodeURIComponent(key)}`;
}

export async function setFlag(u: Urls, key: string, value: Record<string, unknown> | null): Promise<void> {
  const url = await kvUrl(u, key);
  if (value === null) await call(url, { method: 'DELETE' });
  else await call(url, { method: 'PUT', body: JSON.stringify(value), headers: { 'content-type': 'application/octet-stream' } });
}

export interface MailAttachment {
  filename: string;
  type: string;
  content: Uint8Array;
}

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
}

/** Injects a mail into microns-mail; returns the Message-ID the runtime set and its message_id_sha256. */
export async function sendMail(u: Urls, m: OutgoingMail): Promise<{ messageId: string; sha: string; outcome: string }> {
  const body = {
    from: m.from,
    to: [m.to],
    subject: m.subject,
    text: m.text,
    ...(m.headers ? { headers: m.headers } : {}),
    ...(m.attachments ? { attachments: m.attachments.map((a) => ({ filename: a.filename, type: a.type, content: Buffer.from(a.content).toString('base64') })) } : {}),
  };
  const res = await json<{ success: boolean; result: { messageId: string; outcome: string } }>(
    await call(`${u.explorer}/local/email/routing/send?worker=microns-mail`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  );
  const messageId = res.result.messageId.trim();
  return { messageId, sha: sha256hex(messageId), outcome: res.result.outcome };
}

export async function capturedMails(u: Urls): Promise<Array<Row & { messageId: string; outcome?: string; rejectReason?: string; forwards?: Array<{ recipient: string; headers: string[][] }> }>> {
  return (await json<{ result: Array<Row & { messageId: string }> }>(await call(`${u.explorer}/local/email/routing`))).result;
}

export async function instance(u: Urls, workflow: string, id: string): Promise<{ status: number; result: Row | null }> {
  const res = await call(`${u.explorer}/workflows/${workflow}/instances/${encodeURIComponent(id)}`);
  if (res.status === 404) return { status: 404, result: null };
  const body = await json<{ success: boolean; result: Row }>(res);
  return { status: res.status, result: body.success ? body.result : null };
}

export async function sendEvent(u: Urls, workflow: string, id: string, type: string, payload: unknown): Promise<void> {
  await call(`${u.explorer}/workflows/${workflow}/instances/${encodeURIComponent(id)}/events/${type}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) });
}

export async function restartFrom(u: Urls, workflow: string, id: string, step: string): Promise<void> {
  await call(`${u.explorer}/workflows/${workflow}/instances/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'restart', from: { name: step } }) });
}

/** Lines of the harness's wrangler log that start with a Worker's log prefix. */
export function logLines(u: Urls, prefix: string): string[] {
  const file = `${u.tmp}/wrangler.log`;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(prefix));
}

/** Relay-signed decision (the Telegram relay's request shape), through the site. */
export async function relayDecision(u: Urls, token: string, code: string): Promise<Response> {
  const body = JSON.stringify({ v: 1, token, code, tg: { user_id: 4242, chat_id: 4242, message_id: 1000 } });
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', u.approvalSecret).update(`${ts}.${body}`).digest('hex');
  return fetch(`${u.site}/api/agent/decision`, { method: 'POST', headers: { ...JSON_HEADERS, 'x-microns-timestamp': ts, 'x-microns-signature': signature }, body });
}

/** The relay path exists once unit W's site rows and ops admin handlers are in the tree. */
export function relayPresent(): boolean {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  return read('../../../site/src/api/resolve.ts').includes('/api/agent/') && !read('../../src/routes/agent-admin.ts').includes('not implemented: W');
}

// ----- prediction of the model input -----

/** Attachment records as parse-and-store writes them (names, kinds and sizes; n in message order). */
export function predictedRecords(attachments: readonly MailAttachment[]): AttachmentRecord[] {
  return attachments.map((a, i) => ({
    n: i + 1,
    r2_key: '',
    filename: displayName(a.filename, `attachment-${i + 1}`),
    content_type: '',
    size_bytes: a.content.byteLength,
    sha256: '',
    kind: sniffKind(a.content, a.filename, a.type),
  }));
}

/** What the Workflow sends: the row's subject and sender, the quote-stripped body text. */
export function predictedEmail(m: OutgoingMail): EmailForModel {
  return { subject: m.subject, from_name: null, from_email: m.from.toLowerCase(), text: stripQuoted(m.text) };
}

export function contentSha(user: readonly LlmContent[]): string {
  return sha256hex(canonicalJson(user));
}

export function classifySha(m: OutgoingMail): string {
  return contentSha(classifyContent(predictedEmail(m), predictedRecords(m.attachments ?? [])));
}

export function extractSha(m: OutgoingMail): string {
  return contentSha(extractContent(predictedEmail(m), predictedRecords(m.attachments ?? []), null, []));
}

/** A small synthetic STEP file. */
export function stepFile(name = 'part'): Uint8Array {
  return new TextEncoder().encode(`ISO-10303-21;\nHEADER;\nFILE_NAME('${name}.step','2026-10-05T09:00:00',('Example'),('Example'),'','','');\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n`);
}
