// RfqThread: one Durable Object per RFQ (idFromName(rfq_id)). Serialises the fan-in of CAD jobs and the mapping of
// outbound and inbound mail of the RFQ; Supabase stays the record, and an empty object rebuilds itself from it.
//
// Rules
//   - cad-done is sent to the bound quote instance exactly once, when every registered job is final (also when the
//     quote binds after the jobs finished, and with an empty job list when the RFQ has no CAD file). The send is
//     claimed in storage before the event goes out; a failed send releases the claim and an alarm retries it every
//     30 s, at most 5 times.
//   - customer-reply ({inbound_email_id}) is forwarded to the bound quote instance once per inbound e-mail after
//     reply attribution, and only while that quote waits for the customer's answer: its quote_workflows row is
//     'sent' or 'follow_up' and the mail was received at or after the quote's sent_at. Any other mail (no bound
//     quote, a quote not sent yet, a quote that has ended, a mail older than the quote) is only recorded and is
//     never forwarded later. A failed status read throws, so the caller retries the same mail.
//   - A job reported final before it was registered is recorded as final; registering it later keeps that status.
//   - Storage: SQLite tables cad(job_id, status), meta(key, value), msgid(id, direction, quote_workflow_id,
//     inbound_email_id, sent). Message ids are kept trimmed with their brackets.
//   - Rebuild: on the first call of an empty object whose name is an RFQ id, the state is read back from
//     cad_jobs, quote_workflows and inbound_emails (a rebuild failure is logged; the call goes on).
//   - Workflow events carry ids only.

import { DurableObject } from 'cloudflare:workers';
import { formatLogLine } from '../../../shared/src/http/log';
import type { CadFinalStatus } from '../cad/types';
import { PostgrestDb, type Db } from '../db/postgrest';
import { LOG_PREFIX, type OpsEnv } from '../env';

export interface RfqThreadState {
  rfq_id: string;
  quote: { instance_id: string; quote_workflow_id: string } | null;
  cad: Array<{ job_id: string; status: 'pending' | CadFinalStatus }>;
  cad_done_sent: boolean;
  outbound_message_ids: string[];
  inbound: Array<{ inbound_email_id: string; message_id: string }>;
}

export const CAD_FINAL_STATUSES: readonly CadFinalStatus[] = ['succeeded', 'failed', 'timed_out', 'dead_letter', 'cancelled'];
export const CAD_DONE_RETRY_MS = 30_000;
export const CAD_DONE_MAX_ATTEMPTS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUOTE_FINAL = ['won', 'lost', 'expired', 'rejected', 'failed', 'cancelled'];
/** quote_workflows statuses in which the quote waits for the customer's answer (its follow-up waits). */
export const QUOTE_AWAITING_REPLY: readonly string[] = ['sent', 'follow_up'];

type Row = Record<string, SqlStorageValue>;

export class RfqThread extends DurableObject<OpsEnv> {
  /** Database of the rebuild (set by tests; the service-role PostgREST client otherwise). */
  protected dbInstance?: Db;

  constructor(ctx: DurableObjectState, env: OpsEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS cad (job_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS msgid (id TEXT PRIMARY KEY, direction TEXT NOT NULL, quote_workflow_id TEXT, inbound_email_id TEXT, sent INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);`,
    );
  }

  // ----- storage helpers -----

  private rows(query: string, ...bindings: unknown[]): Row[] {
    return this.ctx.storage.sql.exec<Row>(query, ...bindings).toArray();
  }

  private meta(key: string): string | null {
    const row = this.rows('SELECT value FROM meta WHERE key = ?', key)[0];
    return row ? String(row.value) : null;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
  }

  private rfqId(): string {
    const name = this.ctx.id.name ?? this.meta('rfq_id') ?? '';
    return name;
  }

  private db(): Db {
    return (this.dbInstance ??= new PostgrestDb({ url: this.env.SUPABASE_URL, serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY }));
  }

  /** Reads the state back from Supabase once, when the object is empty (no other call runs meanwhile). */
  private async ensureLoaded(): Promise<void> {
    if (this.meta('loaded') === '1') return;
    await this.ctx.blockConcurrencyWhile(() => this.rebuild());
  }

  private async rebuild(): Promise<void> {
    if (this.meta('loaded') === '1') return;
    const rfqId = this.rfqId();
    this.setMeta('loaded', '1');
    if (!UUID.test(rfqId)) return;
    this.setMeta('rfq_id', rfqId);
    try {
      const db = this.db();
      const [jobs, quotes, inbound] = await Promise.all([
        db.select<{ id: string; status: string }>('cad_jobs', { columns: 'id,status', filters: [['rfq_id', 'eq', rfqId]], limit: 500 }),
        db.select<{ id: string; workflow_instance_id: string; status: string; outbound_message_ids: string[] | null }>('quote_workflows', {
          columns: 'id,workflow_instance_id,status,outbound_message_ids',
          filters: [['rfq_id', 'eq', rfqId]],
          order: [{ column: 'quote_version', ascending: false }],
          limit: 20,
        }),
        db.select<{ id: string; message_id: string }>('inbound_emails', { columns: 'id,message_id', filters: [['rfq_id', 'eq', rfqId]], limit: 500 }),
      ]);
      const now = new Date().toISOString();
      if (jobs.length > 0) this.setMeta('cad_expected', '1');
      for (const job of jobs) {
        const status = (CAD_FINAL_STATUSES as readonly string[]).includes(job.status) ? job.status : 'pending';
        this.ctx.storage.sql.exec('INSERT INTO cad (job_id, status, updated_at) VALUES (?, ?, ?) ON CONFLICT (job_id) DO NOTHING', job.id, status, now);
      }
      for (const q of quotes) {
        for (const id of q.outbound_message_ids ?? []) {
          this.ctx.storage.sql.exec('INSERT INTO msgid (id, direction, quote_workflow_id, sent, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING', id.trim(), 'out', q.id, now);
        }
      }
      const active = quotes.find((q) => !QUOTE_FINAL.includes(q.status));
      if (active) {
        this.setMeta('quote_instance_id', active.workflow_instance_id);
        this.setMeta('quote_workflow_id', active.id);
        // A quote that left the CAD wait has had its cad-done.
        if (!['started', 'cad_pending'].includes(active.status)) this.setMeta('cad_done_sent', '1');
      }
      for (const m of inbound) {
        this.ctx.storage.sql.exec('INSERT INTO msgid (id, direction, inbound_email_id, sent, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING', m.message_id.trim(), 'in', m.id, now);
      }
    } catch {
      console.error(formatLogLine(LOG_PREFIX, 'rfq thread rebuild failed', { rfq_id: rfqId }));
    }
  }

  private quote(): { instance_id: string; quote_workflow_id: string } | null {
    const instance_id = this.meta('quote_instance_id');
    const quote_workflow_id = this.meta('quote_workflow_id');
    return instance_id && quote_workflow_id ? { instance_id, quote_workflow_id } : null;
  }

  private jobs(): Array<{ job_id: string; status: 'pending' | CadFinalStatus }> {
    return this.rows('SELECT job_id, status FROM cad ORDER BY job_id').map((r) => ({ job_id: String(r.job_id), status: String(r.status) as 'pending' | CadFinalStatus }));
  }

  private async sendEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    const quote = this.quote();
    if (!quote) throw new Error('no quote bound');
    if (!this.env.QUOTE) throw new Error('QUOTE binding missing');
    const instance = await this.env.QUOTE.get(quote.instance_id);
    await instance.sendEvent({ type, payload });
  }

  /** Sends cad-done when a quote is bound, CAD jobs were expected, none is pending and it was not sent yet. */
  private async maybeSendCadDone(): Promise<void> {
    if (!this.quote() || this.meta('cad_expected') !== '1' || this.meta('cad_done_sent') === '1') return;
    const jobs = this.jobs();
    if (jobs.some((j) => j.status === 'pending')) return;
    this.setMeta('cad_done_sent', '1');
    try {
      await this.sendEvent('cad-done', { jobs: jobs.map((j) => ({ job_id: j.job_id, status: j.status })) });
      this.setMeta('cad_done_attempts', '0');
    } catch {
      this.setMeta('cad_done_sent', '0');
      const attempts = Number(this.meta('cad_done_attempts') ?? '0') + 1;
      this.setMeta('cad_done_attempts', String(attempts));
      if (attempts < CAD_DONE_MAX_ATTEMPTS) await this.ctx.storage.setAlarm(Date.now() + CAD_DONE_RETRY_MS);
      console.error(formatLogLine(LOG_PREFIX, 'cad-done send failed', { rfq_id: this.rfqId(), attempts }));
    }
  }

  // ----- RPC methods -----

  async expectCadJobs(jobIds: string[]): Promise<void> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    for (const id of jobIds) this.ctx.storage.sql.exec('INSERT INTO cad (job_id, status, updated_at) VALUES (?, ?, ?) ON CONFLICT (job_id) DO NOTHING', String(id), 'pending', now);
    this.setMeta('cad_expected', '1');
    await this.maybeSendCadDone();
  }

  async bindQuote(instanceId: string, quoteWorkflowId: string): Promise<void> {
    await this.ensureLoaded();
    const current = this.quote();
    if (current && current.instance_id !== instanceId) {
      // A new quote version: its own cad-done.
      this.setMeta('cad_done_sent', '0');
      this.setMeta('cad_done_attempts', '0');
    }
    this.setMeta('quote_instance_id', instanceId);
    this.setMeta('quote_workflow_id', quoteWorkflowId);
    await this.maybeSendCadDone();
  }

  async cadJobFinal(jobId: string, status: CadFinalStatus): Promise<void> {
    if (!CAD_FINAL_STATUSES.includes(status)) throw new Error('cadJobFinal: not a final status');
    await this.ensureLoaded();
    this.ctx.storage.sql.exec(
      'INSERT INTO cad (job_id, status, updated_at) VALUES (?, ?, ?) ON CONFLICT (job_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at',
      String(jobId),
      status,
      new Date().toISOString(),
    );
    await this.maybeSendCadDone();
  }

  async registerOutbound(messageIds: string[], quoteWorkflowId: string): Promise<void> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    for (const id of messageIds) {
      this.ctx.storage.sql.exec('INSERT INTO msgid (id, direction, quote_workflow_id, sent, at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING', String(id).trim(), 'out', quoteWorkflowId, now);
    }
  }

  async appendInbound(inboundEmailId: string, messageId: string): Promise<void> {
    await this.ensureLoaded();
    const id = String(messageId).trim();
    this.ctx.storage.sql.exec('INSERT INTO msgid (id, direction, inbound_email_id, sent, at) VALUES (?, ?, ?, 0, ?) ON CONFLICT (id) DO NOTHING', id, 'in', inboundEmailId, new Date().toISOString());
    const row = this.rows('SELECT sent, inbound_email_id FROM msgid WHERE id = ?', id)[0];
    const quote = this.quote();
    if (!row || Number(row.sent) === 1 || !quote) return;
    const inboundId = String(row.inbound_email_id ?? inboundEmailId);
    if (!(await this.awaitsReply(quote.quote_workflow_id, inboundId))) return;
    await this.sendEvent('customer-reply', { inbound_email_id: inboundId });
    this.ctx.storage.sql.exec('UPDATE msgid SET sent = 1 WHERE id = ?', id);
  }

  /** True when the quote waits for the customer's answer and the mail is not older than the quote mail. */
  private async awaitsReply(quoteWorkflowId: string, inboundEmailId: string): Promise<boolean> {
    if (!UUID.test(quoteWorkflowId) || !UUID.test(inboundEmailId)) return false;
    const db = this.db();
    const [quote] = await db.select<{ status: string; sent_at: string | null }>('quote_workflows', { columns: 'status,sent_at', filters: [['id', 'eq', quoteWorkflowId]], limit: 1 });
    if (!quote || !QUOTE_AWAITING_REPLY.includes(quote.status) || !quote.sent_at) return false;
    const [mail] = await db.select<{ received_at: string | null }>('inbound_emails', { columns: 'received_at', filters: [['id', 'eq', inboundEmailId]], limit: 1 });
    const received = Date.parse(mail?.received_at ?? '');
    const sent = Date.parse(quote.sent_at);
    return Number.isFinite(received) && Number.isFinite(sent) && received >= sent;
  }

  async state(): Promise<RfqThreadState> {
    await this.ensureLoaded();
    const msg = this.rows('SELECT id, direction, inbound_email_id FROM msgid ORDER BY at, id');
    return {
      rfq_id: this.rfqId(),
      quote: this.quote(),
      cad: this.jobs(),
      cad_done_sent: this.meta('cad_done_sent') === '1',
      outbound_message_ids: msg.filter((m) => m.direction === 'out').map((m) => String(m.id)),
      inbound: msg.filter((m) => m.direction === 'in').map((m) => ({ inbound_email_id: String(m.inbound_email_id ?? ''), message_id: String(m.id) })),
    };
  }

  /** Retries a cad-done send that failed. */
  async alarm(): Promise<void> {
    await this.maybeSendCadDone();
  }
}
