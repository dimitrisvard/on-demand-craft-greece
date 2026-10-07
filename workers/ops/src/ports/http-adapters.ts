// Production adapters over HTTP and Workers bindings: Telegram Bot API, Gmail API (read-only scope) with the Google
// token endpoint, R2 (microns-private) and Analytics Engine.
//
// Rules
//   - Base URLs are the providers' own unless a T2 override var is set (TELEGRAM_API_BASE, GMAIL_API_BASE,
//     GOOGLE_TOKEN_URL); the generated T2 configs are the only place that sets them.
//   - Errors name the method and the HTTP status only: never a URL (the Bot API URL holds the bot token), a token,
//     a response body or an e-mail address.
//   - Gmail: a stored access token is used while it stays valid for at least 5 more minutes; otherwise it is
//     refreshed in memory and never written back. 'invalid_grant' is reported as such; every other refresh problem
//     is 'unavailable'. A refresh answer that carries a refresh token other than the stored one is reported as
//     rotated: true, and that value goes no further than the parsing of the answer. Only read endpoints are called.
//   - Gmail history is read over at most HISTORY_MAX_PAGES pages. When pages remain after the cap, the answer is
//     truncated and its historyId is the id of the last history record read (not the mailbox's current id), so the
//     caller's next listing starts right after what it was given. Metadata answers carry Gmail's sizeEstimate.
//   - Blob: names are R2 keys; copy() is get + put for objects up to 25 MiB; a sha256 given to put() is checked by R2
//     and stored as custom metadata.

import { need } from '../agents/config';
import { renderTelegram, type CardV1 } from '../agents/cards/index';
import { writeEvent, type AgentEventPoint } from '../agents/events';
import type { OpsEnv } from '../env';
import type { BlobPort, EventsPort, GmailHeaders, GmailPort, SenderAccountRow, TelegramPort } from './index';

export const TELEGRAM_API = 'https://api.telegram.org';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const HTTP_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

async function call(fetchImpl: FetchLike, url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch {
    throw new Error(`${label}: network error`);
  }
}

// ----- Telegram -----

export class BotTelegram implements TelegramPort {
  constructor(
    private readonly env: OpsEnv,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async method(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    need(this.env, 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID');
    const base = (this.env.TELEGRAM_API_BASE ?? TELEGRAM_API).replace(/\/+$/, '');
    const res = await call(this.fetchImpl, `${base}/bot${this.env.TELEGRAM_BOT_TOKEN}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, `telegram ${name}`);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: unknown };
    if (!res.ok || data.ok !== true) {
      // An edit that changes nothing is not an error for the caller.
      if (name.startsWith('edit') && typeof data.description === 'string' && data.description.includes('message is not modified')) return {};
      throw new Error(`telegram ${name}: ${res.status}`);
    }
    return (data.result ?? {}) as Record<string, unknown>;
  }

  async sendCard(c: CardV1, token?: string | null): Promise<{ message_id: number }> {
    const message = renderTelegram(c, token ?? null);
    const result = await this.method('sendMessage', {
      chat_id: this.env.TELEGRAM_CHAT_ID,
      text: message.text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: message.reply_markup,
    });
    return { message_id: Number(result.message_id) };
  }

  async editCard(messageId: number, c: CardV1 | { text: string }): Promise<void> {
    if ('kind' in c) {
      const message = renderTelegram(c, null);
      await this.method('editMessageText', {
        chat_id: this.env.TELEGRAM_CHAT_ID,
        message_id: messageId,
        text: message.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: message.reply_markup,
      });
      return;
    }
    await this.method('editMessageText', { chat_id: this.env.TELEGRAM_CHAT_ID, message_id: messageId, text: c.text, reply_markup: { inline_keyboard: [] } });
  }

  async sendText(text: string): Promise<{ message_id: number }> {
    const result = await this.method('sendMessage', { chat_id: this.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true });
    return { message_id: Number(result.message_id) };
  }
}

// ----- Gmail -----

const METADATA_HEADERS = ['Message-ID', 'In-Reply-To', 'References', 'From', 'Subject', 'Auto-Submitted'];
const TOKEN_MIN_VALIDITY_MS = 5 * 60_000;
/** Pages of one history listing at most. */
export const HISTORY_MAX_PAGES = 20;

/** True when history id `a` (decimal digits, as Gmail sends its uint64 ids) is later than `b` (null: none yet). */
function laterHistoryId(a: string, b: string | null): boolean {
  if (!/^\d+$/.test(a)) return false;
  if (b === null) return true;
  const x = a.replace(/^0+(?=\d)/, '');
  const y = b.replace(/^0+(?=\d)/, '');
  return x.length !== y.length ? x.length > y.length : x > y;
}

/** A history id field of a Gmail answer as text (null when absent or not an id). */
function historyIdOf(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : v;
  return typeof s === 'string' && /^\d+$/.test(s) ? s : null;
}

function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class GmailApi implements GmailPort {
  constructor(
    private readonly env: OpsEnv,
    private readonly o: { fetch?: FetchLike; now?: () => Date } = {},
  ) {}

  private get fetchImpl(): FetchLike {
    return this.o.fetch ?? ((input, init) => fetch(input, init));
  }

  private base(): string {
    return (this.env.GMAIL_API_BASE ?? GMAIL_API).replace(/\/+$/, '');
  }

  async accessToken(account: SenderAccountRow): Promise<{ token: string; rotated?: boolean } | { error: 'invalid_grant' | 'unavailable' }> {
    const config = account.provider_config ?? {};
    const now = (this.o.now ?? (() => new Date()))().getTime();
    const expiry = typeof config.token_expiry === 'string' ? Date.parse(config.token_expiry) : Number.NaN;
    if (typeof config.access_token === 'string' && config.access_token && Number.isFinite(expiry) && expiry - now >= TOKEN_MIN_VALIDITY_MS) {
      return { token: config.access_token };
    }
    if (typeof config.refresh_token !== 'string' || !config.refresh_token) return { error: 'unavailable' };
    if (!this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET) return { error: 'unavailable' };
    const form = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID,
      client_secret: this.env.GOOGLE_CLIENT_SECRET,
      refresh_token: config.refresh_token,
      grant_type: 'refresh_token',
    });
    let res: Response;
    try {
      res = await call(this.fetchImpl, this.env.GOOGLE_TOKEN_URL ?? GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }, 'google token');
    } catch {
      return { error: 'unavailable' };
    }
    const data = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; error?: unknown };
    if (!res.ok) return { error: data.error === 'invalid_grant' ? 'invalid_grant' : 'unavailable' };
    if (typeof data.access_token !== 'string' || !data.access_token) return { error: 'unavailable' };
    // Only the fact of a new grant leaves this method, never its value (the poller stores nothing).
    const rotated = typeof data.refresh_token === 'string' && data.refresh_token !== '' && data.refresh_token !== config.refresh_token;
    return rotated ? { token: data.access_token, rotated: true } : { token: data.access_token };
  }

  private async get(token: string, path: string, label: string): Promise<Response> {
    return call(this.fetchImpl, `${this.base()}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, `gmail ${label}`);
  }

  async history(token: string, startHistoryId: string): Promise<{ messageIds: string[]; historyId: string; truncated?: boolean } | { error: 'stale_history' | 'unavailable' }> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    /** The mailbox's current history id, as the latest page reported it. */
    let current = startHistoryId;
    /** Id of the latest history record read so far. */
    let lastRead: string | null = null;
    for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
      const q = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX' });
      if (pageToken) q.set('pageToken', pageToken);
      let res: Response;
      try {
        res = await this.get(token, `/users/me/history?${q}`, 'history');
      } catch {
        return { error: 'unavailable' };
      }
      if (res.status === 404) return { error: 'stale_history' };
      if (!res.ok) return { error: 'unavailable' };
      const data = (await res.json()) as { history?: Array<{ id?: unknown; messagesAdded?: Array<{ message?: { id?: string } }> }>; historyId?: unknown; nextPageToken?: string };
      for (const h of data.history ?? []) {
        for (const m of h.messagesAdded ?? []) if (m.message?.id) ids.add(m.message.id);
        const id = historyIdOf(h.id);
        if (id !== null && laterHistoryId(id, lastRead)) lastRead = id;
      }
      current = historyIdOf(data.historyId) ?? current;
      if (!data.nextPageToken) return { messageIds: [...ids], historyId: current };
      pageToken = data.nextPageToken;
    }
    // Pages remain after the cap: the listing resumes right after the last record read. Without any record read
    // the start id is kept, so nothing is passed over either way.
    return { messageIds: [...ids], historyId: lastRead ?? startHistoryId, truncated: true };
  }

  async listRecent(token: string, query: string, max: number): Promise<{ messageIds: string[] }> {
    const q = new URLSearchParams({ q: query, maxResults: String(max) });
    const res = await this.get(token, `/users/me/messages?${q}`, 'list');
    if (!res.ok) throw new Error(`gmail list: ${res.status}`);
    const data = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { messageIds: (data.messages ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string') };
  }

  async profileHistoryId(token: string): Promise<string> {
    const res = await this.get(token, '/users/me/profile', 'profile');
    if (!res.ok) throw new Error(`gmail profile: ${res.status}`);
    const data = (await res.json()) as { historyId?: unknown };
    return String(data.historyId ?? '');
  }

  async metadata(token: string, id: string): Promise<GmailHeaders> {
    const q = new URLSearchParams({ format: 'metadata' });
    for (const h of METADATA_HEADERS) q.append('metadataHeaders', h);
    const res = await this.get(token, `/users/me/messages/${encodeURIComponent(id)}?${q}`, 'metadata');
    if (!res.ok) throw new Error(`gmail metadata: ${res.status}`);
    const data = (await res.json()) as { sizeEstimate?: unknown; payload?: { headers?: Array<{ name?: string; value?: string }> } };
    const header = (name: string): string | null => {
      const found = (data.payload?.headers ?? []).find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase());
      return found?.value ?? null;
    };
    const size = data.sizeEstimate;
    return {
      message_id: header('Message-ID'),
      in_reply_to: header('In-Reply-To'),
      references: (header('References') ?? '').split(/\s+/).filter(Boolean),
      from: header('From'),
      subject: header('Subject'),
      auto_submitted: header('Auto-Submitted'),
      size_estimate: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null,
    };
  }

  async raw(token: string, id: string): Promise<Uint8Array> {
    const res = await this.get(token, `/users/me/messages/${encodeURIComponent(id)}?format=raw`, 'raw');
    if (!res.ok) throw new Error(`gmail raw: ${res.status}`);
    const data = (await res.json()) as { raw?: string };
    if (typeof data.raw !== 'string') throw new Error('gmail raw: no content');
    return base64UrlToBytes(data.raw);
  }
}

// ----- R2 -----

export const COPY_MAX_BYTES = 25 * 1024 * 1024;

export class R2Blob implements BlobPort {
  constructor(private readonly env: OpsEnv) {}

  private bucket(): R2Bucket {
    need(this.env, 'PRIVATE_FILES');
    return this.env.PRIVATE_FILES;
  }

  async put(key: string, body: ArrayBuffer | ReadableStream, o: { contentType: string; sha256?: string; meta?: Record<string, string> }): Promise<void> {
    const customMetadata: Record<string, string> = { ...o.meta };
    if (o.sha256) customMetadata.sha256 = o.sha256;
    await this.bucket().put(key, body, { httpMetadata: { contentType: o.contentType }, customMetadata, ...(o.sha256 ? { sha256: o.sha256 } : {}) });
  }

  async get(key: string): Promise<{ body: ReadableStream; size: number; contentType?: string } | null> {
    const object = await this.bucket().get(key);
    if (!object) return null;
    return { body: object.body, size: object.size, contentType: object.httpMetadata?.contentType };
  }

  async getRange(key: string, offset: number, length: number): Promise<ReadableStream | null> {
    const object = await this.bucket().get(key, { range: { offset, length } });
    return object ? object.body : null;
  }

  async copy(from: string, to: string): Promise<void> {
    const object = await this.bucket().get(from);
    if (!object) throw new Error('blob copy: source missing');
    if (object.size > COPY_MAX_BYTES) {
      await object.body.cancel();
      throw new Error('blob copy: source larger than 25 MiB');
    }
    await this.bucket().put(to, await object.arrayBuffer(), { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
  }

  async head(key: string): Promise<{ size: number; sha256?: string } | null> {
    const object = await this.bucket().head(key);
    if (!object) return null;
    const sha256 = object.customMetadata?.sha256;
    return sha256 ? { size: object.size, sha256 } : { size: object.size };
  }
}

// ----- Analytics Engine -----

export class AnalyticsEvents implements EventsPort {
  constructor(private readonly dataset: AnalyticsEngineDataset | undefined) {}

  point(p: AgentEventPoint): void {
    writeEvent(this.dataset, p);
  }
}
