// T1 helpers of the reply and post-order tests: an env with the agent fakes, a fake queue batch, synthetic MIME
// (example.* addresses only) and seed rows for an RFQ with a sent quote.

import type { OpsEnv } from '../../src/env';
import type { AgentEventV1 } from '../../src/queues/messages';
import { agentBindings, agentPorts, FakeKV, FakeQueue, FakeR2Bucket, FakeWorkflow, type AgentTestPorts } from '../helpers/agent-env';
import { opsEnv } from '../helpers/ops';

export const TENANT = '00000000-0000-0000-0000-000000000001';
export const RFQ_A = '0a000000-0000-4000-8000-00000000000a';
export const RFQ_B = '0b000000-0000-4000-8000-00000000000b';
export const QW_A = '1a000000-0000-4000-8000-00000000000a';
export const QW_B = '1b000000-0000-4000-8000-00000000000b';
export const OUT_A = `<q.${QW_A}.0@rfq.micronshub.eu>`;
export const CUSTOMER = 'erika.beispiel@example.de';
export const STAFF_ACTOR = 'user:11111111-1111-4111-8111-111111111111';

export interface Harness {
  env: OpsEnv;
  ports: AgentTestPorts;
  kv: FakeKV;
  bucket: FakeR2Bucket;
  events: FakeQueue<AgentEventV1>;
  intake: FakeWorkflow;
  postOrder: FakeWorkflow;
  quote: FakeWorkflow;
  threadCalls: Array<{ name: string; method: string; args: unknown[] }>;
}

export function harness(o: { flags?: Record<string, unknown> } = {}): Harness {
  const bucket = new FakeR2Bucket();
  const env = opsEnv({ ...agentBindings({ PRIVATE_FILES: bucket as unknown as R2Bucket }), AGENT_APPROVAL_SECRET: 't1-approval-value' }) as OpsEnv;
  const kv = env.FLAGS as unknown as FakeKV;
  for (const [key, value] of Object.entries(o.flags ?? { 'agent.quote': { enabled: true, value: { mode: 'assist' } }, 'agent.rfq_intake': { enabled: true, value: { mode: 'shadow' } }, 'agent.post_order': { enabled: true, value: { mode: 'assist' } } })) {
    if (value !== null) kv.setJson(key, value);
  }
  const ports = agentPorts({ bucket });
  return {
    env,
    ports,
    kv,
    bucket,
    events: env.AGENT_EVENTS as unknown as FakeQueue<AgentEventV1>,
    intake: env.RFQ_INTAKE as unknown as FakeWorkflow,
    postOrder: env.POST_ORDER as unknown as FakeWorkflow,
    quote: env.QUOTE as unknown as FakeWorkflow,
    threadCalls: (env.RFQ_THREAD as unknown as { calls: Array<{ name: string; method: string; args: unknown[] }> }).calls,
  };
}

export interface FakeMessage<T> {
  id: string;
  body: T;
  attempts: number;
  timestamp: Date;
  acked: boolean;
  retried: boolean;
  ack(): void;
  retry(): void;
}

export function message<T>(body: T, attempts = 1, id = `m-${Math.random().toString(36).slice(2, 8)}`): FakeMessage<T> {
  const m: FakeMessage<T> = {
    id,
    body,
    attempts,
    timestamp: new Date(0),
    acked: false,
    retried: false,
    ack() {
      m.acked = true;
    },
    retry() {
      m.retried = true;
    },
  };
  return m;
}

export function batch<T>(queue: string, messages: Array<FakeMessage<T>>): MessageBatch<T> {
  return {
    queue,
    messages,
    ackAll() {
      for (const m of messages) m.ack();
    },
    retryAll() {
      for (const m of messages) m.retry();
    },
  } as unknown as MessageBatch<T>;
}

export const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

/** A synthetic reply (multipart with one STEP attachment when `step` is set). */
export function replyMime(o: { messageId: string; inReplyTo?: string | null; references?: string[]; subject?: string; from?: string; text?: string; step?: boolean }): string {
  const headers = [
    `From: Erika Beispiel <${o.from ?? CUSTOMER}>`,
    'To: replies@rfq.micronshub.eu',
    `Subject: ${o.subject ?? 'Re: Angebot'}`,
    `Message-ID: ${o.messageId}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`] : []),
    ...(o.references?.length ? [`References: ${o.references.join(' ')}`] : []),
    'Date: Wed, 07 Oct 2026 10:00:00 +0200',
    'MIME-Version: 1.0',
  ];
  const text = o.text ?? 'Danke, anbei die geaenderte Zeichnung.';
  if (!o.step) return [...headers, 'Content-Type: text/plain; charset=utf-8', '', text, '', '> quoted earlier text', ''].join('\r\n');
  const step = Buffer.from('ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'bracket\'),\'2;1\');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n').toString('base64');
  return [
    ...headers,
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '',
    '--b1',
    'Content-Type: application/octet-stream; name="bracket-rev2.step"',
    'Content-Disposition: attachment; filename="bracket-rev2.step"',
    'Content-Transfer-Encoding: base64',
    '',
    step,
    '--b1--',
    '',
  ].join('\r\n');
}

/** Two RFQs of the same customer, each with a sent quote (outbound ids of quote A stored). */
export function seedQuotes(h: Harness): void {
  h.ports.db.seed('rfqs', [
    { id: RFQ_A, company_name: 'Example GmbH', rfq_number: 'RFQ-01102026-1', contact_email: CUSTOMER, tenant_id: TENANT },
    { id: RFQ_B, company_name: 'Example GmbH', rfq_number: 'RFQ-02102026-2', contact_email: CUSTOMER, tenant_id: TENANT },
  ]);
  h.ports.db.seed('quote_workflows', [
    { id: QW_A, rfq_id: RFQ_A, quote_version: 1, workflow_instance_id: `quote-${RFQ_A}-v1`, status: 'sent', outbound_message_ids: [OUT_A], sent_at: '2026-10-01T10:00:00.000Z', tenant_id: TENANT },
    { id: QW_B, rfq_id: RFQ_B, quote_version: 1, workflow_instance_id: `quote-${RFQ_B}-v1`, status: 'follow_up', outbound_message_ids: [], sent_at: '2026-10-02T10:00:00.000Z', tenant_id: TENANT },
  ]);
}

/** Stores a reply as microns-mail does (raw MIME in R2, inbound_emails row 'received') and returns the row id. */
export async function storeReply(h: Harness, o: { n: number; mime: string; mailbox?: 'replies' | 'gmail' | 'rfq'; inReplyTo?: string | null; references?: string[]; subject?: string; messageId: string; from?: string; status?: string }): Promise<{ id: string; sha: string }> {
  const sha = String(o.n).padStart(2, '0').repeat(32);
  const key = `email/${sha}/raw.eml`;
  await h.bucket.put(key, o.mime);
  const mailbox = o.mailbox ?? 'replies';
  const [row] = h.ports.db.seed('inbound_emails', [
    {
      tenant_id: TENANT,
      message_id: o.messageId,
      message_id_sha256: sha,
      mailbox,
      source: mailbox === 'gmail' ? 'gmail_poller' : 'email_routing',
      sender_account_id: mailbox === 'gmail' ? '9a000000-0000-4000-8000-00000000000a' : null,
      from_email: o.from ?? CUSTOMER,
      subject: o.subject ?? 'Re: Angebot',
      in_reply_to: o.inReplyTo ?? null,
      references_ids: o.references ?? [],
      received_at: '2026-10-07T08:00:00.000Z',
      created_at: '2026-10-05T08:00:00.000Z',
      raw_r2_key: key,
      status: o.status ?? 'received',
    },
  ]);
  return { id: row.id as string, sha };
}
