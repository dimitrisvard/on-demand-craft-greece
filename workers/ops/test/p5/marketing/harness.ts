// T1 harness of unit M5 (marketing send queue): OpsEnv with the Phase 4 fakes, P5MemoryDb, a fixed clock, the
// Phase 4 test ports with a Gmail token fake, the Phase 5 test ports (gmailSend recorder), the real SenderLimiter on
// the fake Durable Object namespace (node:sqlite storage), a recording outbound-mail queue, a recording Resend fetch,
// queue Message fakes, and a Hono app that runs the send-campaign route as microns-ops does (call in c.var.call).
// Synthetic data only: example.test addresses, fixed UUIDs.

import { Hono } from 'hono';
import type { OpsCall, Principal } from '../../../../shared/src/http/rpc';
import { SenderLimiter } from '../../../src/do/sender-limiter';
import type { OpsEnv, OpsHono } from '../../../src/env';
import type { GmailPort, SenderAccountRow } from '../../../src/ports/index';
import { makeTestP5Ports, P5MemoryDb, type TestP5Ports } from '../../../src/ports/p5-stub/index';
import type { OutboundMailV1 } from '../../../src/queues/messages';
import { createSendCampaignHandler } from '../../../src/routes/marketing-send';
import { outboundMailConsumer } from '../../../src/queues/outbound-mail';
import { agentBindings, agentPorts, FakeClock, type AgentTestPorts } from '../../helpers/agent-env';
import { fakeNamespace, type FakeDurableObjectState } from '../../helpers/fake-do';
import { opsEnv } from '../../helpers/ops';

export const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
export const CAMPAIGN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const ACC_G = 'a1a1a1a1-0000-4000-8000-000000000001';
export const ACC_R = 'a1a1a1a1-0000-4000-8000-000000000002';
export const ACC_OFF = 'a1a1a1a1-0000-4000-8000-000000000003';
export const STAFF: Principal = { class: 'STAFF', uid: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', roles: ['sales_rep'] };

/** Subscriber ids in id order: sub(1) < sub(2) < … */
export function sub(n: number): string {
  return `5ab5c71b-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** CSV recipient row ids in id order. */
export function rec(n: number): string {
  return `3ec3ec3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export function email(n: number): string {
  return `person${n}@example.test`;
}

export interface QueueSend {
  body: OutboundMailV1;
  delaySeconds?: number;
}

/** outbound-mail producer fake: records send (with options) and sendBatch; can fail on the n-th sendBatch call. */
export class MailQueue {
  readonly sent: QueueSend[] = [];
  readonly batches: number[] = [];
  failOnBatch: number | null = null;
  failSend = false;

  async send(body: OutboundMailV1, options?: { delaySeconds?: number }): Promise<void> {
    if (this.failSend) throw new Error('queue send failed (test)');
    this.sent.push({ body: structuredClone(body), ...(options?.delaySeconds !== undefined ? { delaySeconds: options.delaySeconds } : {}) });
  }

  async sendBatch(messages: Iterable<{ body: OutboundMailV1 }>): Promise<void> {
    const list = [...messages];
    if (this.failOnBatch !== null && this.batches.length + 1 === this.failOnBatch) {
      this.batches.push(-list.length);
      throw new Error('queue sendBatch failed (test)');
    }
    this.batches.push(list.length);
    for (const m of list) this.sent.push({ body: structuredClone(m.body) });
  }

  bodies(): OutboundMailV1[] {
    return this.sent.map((s) => s.body);
  }

  clear(): void {
    this.sent.length = 0;
    this.batches.length = 0;
  }
}

export class FakeGmail implements Pick<GmailPort, 'accessToken'> {
  readonly asked: string[] = [];
  answer: { token: string } | { error: 'invalid_grant' | 'unavailable' } | null = null;

  async accessToken(account: SenderAccountRow): Promise<{ token: string } | { error: 'invalid_grant' | 'unavailable' }> {
    this.asked.push(account.id);
    return this.answer ?? { token: `gmail-token-${account.id.slice(-1)}` };
  }
}

export interface ResendCall {
  url: string;
  headers: Record<string, string>;
  body: { from: string; to: string[]; subject: string; html: string };
}

export interface TestMessage {
  id: string;
  body: OutboundMailV1;
  attempts: number;
  timestamp: Date;
  acked: boolean;
  retried: boolean;
  retryOptions?: unknown;
  ack(): void;
  retry(o?: unknown): void;
}

export function message(body: OutboundMailV1, attempts = 1): TestMessage {
  const m: TestMessage = {
    id: `msg-${Math.random().toString(16).slice(2)}`,
    body: structuredClone(body),
    attempts,
    timestamp: new Date(T0),
    acked: false,
    retried: false,
    ack() {
      m.acked = true;
    },
    retry(o?: unknown) {
      m.retried = true;
      m.retryOptions = o;
    },
  };
  return m;
}

export interface MarketingHarness {
  env: OpsEnv;
  db: P5MemoryDb;
  clock: FakeClock;
  ports: AgentTestPorts & { db: P5MemoryDb };
  p5: TestP5Ports;
  gmail: FakeGmail;
  queue: MailQueue;
  limiters: ReturnType<typeof fakeNamespace<SenderLimiter>>;
  resend: ResendCall[];
  resendScript: Array<{ status: number; body: unknown } | 'network'>;
  sleeps: number[];
  random: () => number;
  /** Runs the send-campaign route as STAFF (or the given principal) with this body. */
  route(body: unknown, o?: { principal?: Principal; method?: string; raw?: string }): Promise<Response>;
  /** Runs the consumer over the messages (one batch). */
  consume(messages: TestMessage[]): Promise<void>;
  /** Runs the consumer on every queued body (attempt 1), then clears the queue; returns the messages. */
  drain(): Promise<TestMessage[]>;
  limiter(name: string): SenderLimiter;
  limiterState(name: string): FakeDurableObjectState;
  rows(table: string): Array<Record<string, unknown>>;
}

export function marketingHarness(o: { now?: number; env?: Partial<OpsEnv>; random?: () => number } = {}): MarketingHarness {
  const clock = new FakeClock(o.now ?? T0);
  const db = new P5MemoryDb({ clock: () => clock.now() });
  const gmail = new FakeGmail();
  const ports = agentPorts({ db, clock, gmail: gmail as unknown as GmailPort }) as AgentTestPorts & { db: P5MemoryDb };
  const p5 = makeTestP5Ports();
  const queue = new MailQueue();
  const limiters = fakeNamespace<SenderLimiter>((state) => {
    const limiter = new SenderLimiter(state as unknown as DurableObjectState, {} as OpsEnv);
    (limiter as unknown as { dbInstance: P5MemoryDb }).dbInstance = db;
    (limiter as unknown as { clock: () => number }).clock = () => clock.now().getTime();
    return limiter;
  });
  const env = opsEnv({
    ...agentBindings(),
    OUTBOUND_MAIL: queue as unknown as Queue<OutboundMailV1>,
    SENDER_LIMITER: limiters as unknown as DurableObjectNamespace<SenderLimiter>,
    TRACKING_DOMAIN: 'https://micronshub.eu',
    OUTBOUND_MAIL_PAUSED: 'false',
    OUTBOUND_MAIL_STOPPED: 'false',
    ...o.env,
  });
  const resend: ResendCall[] = [];
  const resendScript: MarketingHarness['resendScript'] = [];
  const resendFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    resend.push({ url: String(input), headers, body: JSON.parse(String(init?.body ?? '{}')) as ResendCall['body'] });
    const next = resendScript.shift();
    if (next === 'network') throw new TypeError('fetch failed');
    const answer = next ?? { status: 200, body: { id: `resend-${resend.length}` } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const sleeps: number[] = [];
  const random = o.random ?? (() => 0.25);
  const handler = createSendCampaignHandler({ ports: () => ports, random: () => random() });
  const h: MarketingHarness = {
    env,
    db,
    clock,
    ports,
    p5,
    gmail,
    queue,
    limiters,
    resend,
    resendScript,
    sleeps,
    random,
    async route(body, ro = {}) {
      const app = new Hono<OpsHono>();
      const call: OpsCall = { v: 1, requestId: 'req-m5', endpoint: 'marketing', action: 'send-campaign', functionUrl: '/api/marketing?action=send-campaign', principal: ro.principal ?? STAFF };
      app.use('*', async (c, next) => {
        c.set('call', call);
        await next();
      });
      app.all('/api/marketing', (c) => handler(c));
      const method = ro.method ?? 'POST';
      const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
      if (method !== 'GET' && method !== 'HEAD') init.body = ro.raw ?? JSON.stringify(body);
      return app.fetch(new Request('https://www.micronshub.eu/api/marketing?action=send-campaign', init), env);
    },
    async consume(messages) {
      const batch = { queue: 'outbound-mail', messages, ackAll() {}, retryAll() {} } as unknown as MessageBatch<OutboundMailV1>;
      await outboundMailConsumer(batch, env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext, {
        ports,
        p5,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock.advance(ms);
        },
        random: () => random(),
        fetch: resendFetch,
      });
    },
    async drain() {
      const messages = queue.bodies().map((b) => message(b));
      queue.clear();
      await h.consume(messages);
      return messages;
    },
    limiter: (name) => limiters.instance(name),
    limiterState: (name) => limiters.state(name),
    rows: (table) => (db.tables as Record<string, Array<Record<string, unknown>>>)[table] ?? [],
  };
  return h;
}

export interface SeedOptions {
  subscribers?: number;
  inactive?: number[];
  tags?: Record<number, string[]>;
  campaign?: Partial<Record<string, unknown>>;
  senders?: Array<{ id: string; provider: 'google_workspace' | 'resend'; daily_limit?: number; warmup_enabled?: boolean; warmup_current_limit?: number; is_active?: boolean; provider_config?: Record<string, unknown> }>;
  csv?: Array<{ n: number; sub: number; custom_subject?: string | null; custom_body?: string | null; status?: string }>;
  settings?: Record<string, unknown> | null;
}

/** Seeds a campaign, its subscribers, sender accounts, CSV rows and the settings row. */
export function seedCampaign(h: MarketingHarness, o: SeedOptions = {}): void {
  const n = o.subscribers ?? 3;
  h.db.seed('marketing_subscribers', Array.from({ length: n }, (_, i) => ({
    id: sub(i + 1),
    email: email(i + 1),
    name: i === 1 ? null : `Person ${i + 1}`,
    status: (o.inactive ?? []).includes(i + 1) ? 'unsubscribed' : 'active',
    tags: o.tags?.[i + 1] ?? ['cnc'],
    replied_at: null,
  })));
  h.db.seed('marketing_campaigns', [{
    id: CAMPAIGN,
    name: 'Autumn',
    subject_a: 'Hello {{name}}',
    subject_b: 'Hi {there|again} {{name}}',
    body: '<html><body><p>Dear {{name}}, see <a href="https://www.micronshub.eu/en/cnc">CNC</a> or <a href="mailto:x@example.test">mail</a>.</p></body></html>',
    status: 'draft',
    target_tags: [],
    ab_test_config: { enabled: false },
    sender_account_ids: (o.senders ?? []).map((s) => s.id),
    sent_count: 0,
    ...o.campaign,
  }]);
  if (o.senders?.length) {
    h.db.seed('marketing_sender_accounts', o.senders.map((s, i) => ({
      id: s.id,
      email: `sender${i + 1}@example.test`,
      display_name: `Sender ${i + 1}`,
      provider: s.provider,
      provider_config: s.provider_config ?? (s.provider === 'google_workspace' ? { refresh_token: 'r' } : {}),
      daily_limit: s.daily_limit ?? 500,
      warmup_enabled: s.warmup_enabled ?? false,
      warmup_current_limit: s.warmup_current_limit ?? 10,
      warmup_daily_increment: 5,
      emails_sent_today: 0,
      is_active: s.is_active ?? true,
    })));
  }
  if (o.csv?.length) {
    h.db.seed('marketing_campaign_recipients', o.csv.map((r) => ({
      id: rec(r.n),
      campaign_id: CAMPAIGN,
      subscriber_id: sub(r.sub),
      custom_subject: r.custom_subject ?? null,
      custom_body: r.custom_body ?? null,
      sequence_number: 1,
      delay_days: 0,
      status: r.status ?? 'pending',
      sent_at: null,
    })));
  }
  if (o.settings !== null) h.db.seed('marketing_settings', [{ id: 'settings-1', unsubscribe_link_enabled: true, tracking_domain: null, delay_between_emails_seconds: 0, ...o.settings }]);
}
