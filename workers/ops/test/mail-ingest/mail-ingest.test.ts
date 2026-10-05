// IN-2 / M-2: MailIngest (the named entrypoint microns-mail calls): shape validation, the row check, flag off,
// "already exists" -> exists, reply queued; no address or subject in any log line.

import { describe, expect, it } from 'vitest';
import { MailIngest, ingestReplyFor, isIngestReplyInput, isStartIntakeInput, startIntakeFor } from '../../src/entrypoints/mail-ingest';
import type { OpsEnv } from '../../src/env';
import { agentBindings, FakeKV, FakeQueue, FakeWorkflow } from '../helpers/agent-env';
import { MemoryDb } from '../helpers/memory-db';
import { opsEnv, testContext } from '../helpers/ops';
import { RecordingLogger, assertNoSecretsLogged } from '../helpers/recorders';

const TENANT = '00000000-0000-0000-0000-000000000001';
const SHA = 'c'.repeat(64);
const ID = '7d0f8f4e-1b2c-4d3e-8f9a-0b1c2d3e4f50';
const REPLY_ID = '8e1a9b5f-2c3d-4e5f-9a0b-1c2d3e4f5a61';

function setup(o: { flag?: unknown; rows?: Array<Record<string, unknown>> } = {}) {
  const db = new MemoryDb();
  db.seed('inbound_emails', o.rows ?? [
    { id: ID, message_id: '<a@mail.example.com>', message_id_sha256: SHA, mailbox: 'rfq', from_email: 'buyer@example.com', subject: 'RFQ brackets', received_at: '2026-10-05T08:00:00Z' },
    { id: REPLY_ID, message_id: '<b@mail.example.com>', message_id_sha256: 'd'.repeat(64), mailbox: 'replies', from_email: 'buyer@example.com', received_at: '2026-10-05T08:00:00Z' },
  ]);
  const env = opsEnv({ ...agentBindings() }) as OpsEnv;
  const kv = env.FLAGS as unknown as FakeKV;
  if (o.flag !== undefined) kv.setJson('agent.rfq_intake', o.flag);
  return { db, env, kv, workflow: env.RFQ_INTAKE as unknown as FakeWorkflow, events: env.AGENT_EVENTS as unknown as FakeQueue };
}

const START = { v: 1, inbound_email_id: ID, message_id_sha256: SHA, tenant_id: TENANT } as const;

describe('input shapes', () => {
  it.each([
    ['ok', START, true],
    ['v 2', { ...START, v: 2 }, false],
    ['id not a uuid', { ...START, inbound_email_id: 'x' }, false],
    ['upper-case sha', { ...START, message_id_sha256: 'C'.repeat(64) }, false],
    ['short sha', { ...START, message_id_sha256: 'c'.repeat(63) }, false],
    ['tenant missing', { v: 1, inbound_email_id: ID, message_id_sha256: SHA }, false],
    ['null', null, false],
    ['array', [START], false],
  ])('startIntake %s', (_name, input, ok) => {
    expect(isStartIntakeInput(input)).toBe(ok);
  });

  it('ingestReply needs mailbox replies or gmail', () => {
    expect(isIngestReplyInput({ ...START, mailbox: 'replies' })).toBe(true);
    expect(isIngestReplyInput({ ...START, mailbox: 'gmail' })).toBe(true);
    expect(isIngestReplyInput({ ...START, mailbox: 'rfq' })).toBe(false);
    expect(isIngestReplyInput(START)).toBe(false);
  });
});

describe('startIntake', () => {
  it('flag off (missing, malformed or disabled) -> flag_off, no instance', async () => {
    for (const flag of [undefined, 'not json', { enabled: false }]) {
      const s = setup({ flag: flag === 'not json' ? undefined : flag });
      if (flag === 'not json') s.kv.store.set('agent.rfq_intake', '{broken');
      expect(await startIntakeFor(s.env, START, { db: s.db })).toEqual({ status: 'flag_off' });
      expect(s.workflow.created).toEqual([]);
    }
  });

  it('flag on -> one instance rfq-intake-<32 hex> with ids only; a second call -> exists', async () => {
    const s = setup({ flag: { enabled: true, value: { mode: 'shadow' } } });
    const instance_id = `rfq-intake-${SHA.slice(0, 32)}`;
    expect(await startIntakeFor(s.env, START, { db: s.db })).toEqual({ status: 'started', instance_id });
    expect(await startIntakeFor(s.env, START, { db: s.db })).toEqual({ status: 'exists', instance_id });
    expect(s.workflow.created).toEqual([{ id: instance_id, params: { v: 1, inbound_email_id: ID, message_id_sha256: SHA, tenant_id: TENANT } }]);
  });

  it('extra input fields never reach the params; the row is read and must match', async () => {
    const s = setup({ flag: { enabled: true } });
    const res = await startIntakeFor(s.env, { ...START, subject: 'x', from: 'buyer@example.com' }, { db: s.db });
    expect(res.status).toBe('started');
    expect(s.workflow.created[0].params).toEqual({ v: 1, inbound_email_id: ID, message_id_sha256: SHA, tenant_id: TENANT });
    for (const bad of [
      { ...START, inbound_email_id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f' },
      { ...START, message_id_sha256: 'e'.repeat(64) },
      { ...START, tenant_id: '11111111-1111-4111-8111-111111111111' },
      { ...START, inbound_email_id: REPLY_ID, message_id_sha256: 'd'.repeat(64) },
    ]) {
      expect(await startIntakeFor(s.env, bad, { db: s.db })).toEqual({ status: 'rejected', reason: 'bad_input' });
    }
    expect(s.workflow.created).toHaveLength(1);
  });

  it('in-process callers may allow the replies mailbox (unmatched replies start an intake)', async () => {
    const s = setup({ flag: { enabled: true } });
    const res = await startIntakeFor(s.env, { ...START, inbound_email_id: REPLY_ID, message_id_sha256: 'd'.repeat(64) }, { db: s.db, mailboxes: ['rfq', 'replies'] });
    expect(res.status).toBe('started');
  });

  it('a Workflow error other than "already exists" and a missing binding are thrown (mail logs them; the dispatcher retries)', async () => {
    const s = setup({ flag: { enabled: true } });
    s.workflow.create = async () => {
      throw new Error('internal error');
    };
    await expect(startIntakeFor(s.env, START, { db: s.db })).rejects.toThrow('internal error');
    const t = setup({ flag: { enabled: true } });
    delete (t.env as Partial<OpsEnv>).RFQ_INTAKE;
    await expect(startIntakeFor(t.env, START, { db: t.db })).rejects.toMatchObject({ code: 'config_missing', names: ['RFQ_INTAKE'] });
  });
});

describe('ingestReply', () => {
  it('queues one inbound-reply message with ids only', async () => {
    const s = setup();
    const input = { v: 1, inbound_email_id: REPLY_ID, message_id_sha256: 'd'.repeat(64), tenant_id: TENANT, mailbox: 'replies' } as const;
    expect(await ingestReplyFor(s.env, input, { db: s.db })).toEqual({ status: 'queued' });
    expect(s.events.sent).toEqual([{ body: { v: 1, type: 'inbound-reply', inbound_email_id: REPLY_ID, tenant_id: TENANT }, options: { contentType: 'json' } }]);
  });

  it('a mailbox or sha that does not match the row is rejected', async () => {
    const s = setup();
    expect(await ingestReplyFor(s.env, { ...START, mailbox: 'replies' }, { db: s.db })).toEqual({ status: 'rejected', reason: 'bad_input' });
    expect(await ingestReplyFor(s.env, { v: 1, inbound_email_id: REPLY_ID, message_id_sha256: 'd'.repeat(64), tenant_id: TENANT, mailbox: 'gmail' }, { db: s.db })).toEqual({ status: 'rejected', reason: 'bad_input' });
    expect(s.events.sent).toEqual([]);
  });
});

describe('MailIngest entrypoint', () => {
  it('has exactly the two RPC methods and reads the database through the service-role PostgREST client', async () => {
    const methods = Object.getOwnPropertyNames(MailIngest.prototype).filter((m) => m !== 'constructor').sort();
    expect(methods).toEqual(['ingestReply', 'startIntake']);
    const s = setup({ flag: { enabled: true } });
    const requests: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify(s.db.rows('inbound_emails').filter((r) => r.id === ID)), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const logger = new RecordingLogger();
    const restore = logger.start();
    try {
      const entry = new MailIngest(testContext(), s.env);
      expect(await entry.startIntake(START)).toMatchObject({ status: 'started' });
    } finally {
      restore();
      globalThis.fetch = realFetch;
    }
    expect(requests).toEqual([`https://project.supabase.test/rest/v1/inbound_emails?select=*&id=eq.${ID}&limit=1`]);
    expect(logger.lines).toEqual([`log [microns-ops] mail ingest start sha=${SHA.slice(0, 16)} outcome=started`]);
    assertNoSecretsLogged(logger.lines, ['RFQ brackets', SHA]);
  });
});
