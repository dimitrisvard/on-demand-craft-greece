// IN-3 (M-3, M-4): microns-mail in real workerd as a secondary Worker of the 'agents' harness. Mail goes in through
// the Local Explorer (POST .../local/email/routing/send?worker=microns-mail: the runtime composes the message and
// sets its own Message-ID, returned as result.messageId; In-Reply-To, References and Authentication-Results pass as
// given). Checks:
//   - the raw MIME in R2 microns-private under email/<sha>/raw.eml, one inbound_emails row built from the headers in
//     the mini-PostgREST, status 'received'; with agent.rfq_intake off no Workflow instance (MailIngest flag_off);
//   - with the flag on, one rfq-intake instance 'rfq-intake-<32 hex>' whose params are ids only (Local Explorer),
//     and a second start for the same message creates no second instance;
//   - replies@ goes to MailIngest.ingestReply (one agent-events message, logged 'queued'); with agent.quote on (the
//     consumer acts only then) the reply consumer (unit RP) takes the row out of 'received' (skipped with that reason
//     until the consumer is present); the flag is switched off again afterwards;
//   - an unknown recipient is rejected before anything is stored; log lines carry no address and no subject;
//   - M-4, own harness instance with MAIL_COPY_TO in the generated .dev.vars: the shadow copy is forwarded to it with
//     X-Microns-Inbound: <first 16 hex of the sha>, as the local e-mail capture records.
// A redelivery with the same Message-ID cannot be produced through the Local Explorer (send and resend both set a
// new Message-ID), so the duplicate stop is covered in T1 (workers/mail/test/mail.test.ts, M4 duplicate).

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  capturedMails,
  globalUrls,
  instance,
  JSON_HEADERS,
  logLines,
  rows,
  sendMail,
  setFlag,
  stepFile,
  TENANT,
  until,
  type Row,
  type Urls,
} from '../intake/t2-helpers';

const U = globalUrls();
const RP_PRESENT = !readFileSync(new URL('../../src/queues/agent-events.ts', import.meta.url), 'utf8').includes('not implemented: RP');

async function rowOf(u: Urls, sha: string): Promise<Row> {
  return until(`inbound_emails row ${sha.slice(0, 16)}`, async () => (await rows(u, 'inbound_emails')).find((r) => r.message_id_sha256 === sha));
}

describe.skipIf(!U.site || !U.stub)('microns-mail in workerd (M-3)', () => {
  beforeAll(async () => {
    await setFlag(U, 'agent.rfq_intake', null);
  });

  it('rfq@ with the flag off: raw MIME in R2, one row from the headers, no instance (flag_off), row stays received', async () => {
    const step = stepFile('bracket');
    const sent = await sendMail(U, { from: 'anna.becker@example.com', to: 'rfq@rfq.micronshub.eu', subject: 'RFQ T2 flag off', text: 'Please quote 50 brackets, S235JR, 2 mm.', attachments: [{ filename: 'bracket.step', type: 'application/step', content: step }] });
    expect(sent.outcome).toBe('ok');
    expect(sent.messageId).toMatch(/^<[^<>\s]+>$/);
    const row = await rowOf(U, sent.sha);
    expect(row).toMatchObject({
      tenant_id: TENANT,
      message_id: sent.messageId,
      message_id_sha256: sent.sha,
      mailbox: 'rfq',
      source: 'email_routing',
      from_email: 'anna.becker@example.com',
      to_email: 'rfq@rfq.micronshub.eu',
      subject: 'RFQ T2 flag off',
      in_reply_to: null,
      references_ids: [],
      raw_r2_key: `email/${sent.sha}/raw.eml`,
      status: 'received',
      auth_results: { v: 1, trusted: false, dmarc: 'none' },
    });
    const object = await call(`${U.explorer}/r2/buckets/microns-private/objects/${encodeURIComponent(`email/${sent.sha}/raw.eml`)}`);
    expect(object.status).toBe(200);
    expect((await object.arrayBuffer()).byteLength).toBe(row.raw_size_bytes);
    expect((await instance(U, 'rfq-intake', `rfq-intake-${sent.sha.slice(0, 32)}`)).status).toBe(404);
    await until('the mail log line', async () => logLines(U, '[microns-mail]').some((l) => l.includes(`mail rfq ${sent.sha.slice(0, 16)} flag_off`)));
  });

  it('In-Reply-To, References and Authentication-Results reach the row as given (nothing trusted until pinned)', async () => {
    const sent = await sendMail(U, {
      from: 'anna.becker@example.com',
      to: 'rfq@rfq.micronshub.eu',
      subject: 'RFQ T2 headers',
      text: 'Additional details for our request.',
      headers: {
        'In-Reply-To': '<q.11111111-2222-4333-8444-555555555555.0@rfq.example.com>',
        References: '<first@mail.example.com> <q.11111111-2222-4333-8444-555555555555.0@rfq.example.com>',
        'Authentication-Results': 'mx.example.net; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
      },
    });
    const row = await rowOf(U, sent.sha);
    expect(row).toMatchObject({
      in_reply_to: '<q.11111111-2222-4333-8444-555555555555.0@rfq.example.com>',
      references_ids: ['<first@mail.example.com>', '<q.11111111-2222-4333-8444-555555555555.0@rfq.example.com>'],
      auth_results: { v: 1, trusted: false, authserv_id: 'mx.example.net', dmarc: 'none', raw_count: 1 },
    });
  });

  it('flag on: one rfq-intake instance with ids only; a second start for the same message creates none', async () => {
    await setFlag(U, 'agent.rfq_intake', { enabled: true, value: { mode: 'assist' }, rev: 1 });
    const sent = await sendMail(U, { from: 'laura.wilson@example.com', to: 'rfq@rfq.micronshub.eu', subject: 'Automatic reply: T2', text: 'I am out of the office.', headers: { 'Auto-Submitted': 'auto-replied' } });
    const row = await rowOf(U, sent.sha);
    const id = `rfq-intake-${sent.sha.slice(0, 32)}`;
    const done = await until('the intake instance to complete', async () => {
      const i = await instance(U, 'rfq-intake', id);
      return i.result && i.result.status === 'complete' ? i.result : null;
    });
    expect(done.params).toEqual({ v: 1, inbound_email_id: row.id, message_id_sha256: sent.sha, tenant_id: TENANT });
    expect(done.output).toMatchObject({ outcome: 'auto_reply' });
    expect(await rowOf(U, sent.sha)).toMatchObject({ status: 'rejected', kind: 'auto_reply' });
    // The dispatcher's retry path: create() with the same id is refused, so no second instance exists.
    const again = await fetch(`${U.explorer}/workflows/rfq-intake/instances`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, params: done.params }) });
    expect(again.ok).toBe(false);
    const list = await (await call(`${U.explorer}/workflows/rfq-intake/instances`)).json() as { result: Array<{ id: string }> };
    expect(list.result.filter((x) => x.id === id)).toHaveLength(1);
    await until('the mail log line', async () => logLines(U, '[microns-mail]').some((l) => l.includes(`mail rfq ${sent.sha.slice(0, 16)} started`)));
  });

  it('replies@: the row has mailbox replies and MailIngest queues one agent-events message', async () => {
    const sent = await sendMail(U, { from: 'anna.becker@example.com', to: 'replies@rfq.micronshub.eu', subject: 'Re: Quotation RFQ-05102026-1', text: 'We accept the quotation.', headers: { 'In-Reply-To': '<q.11111111-2222-4333-8444-555555555555.0@rfq.example.com>' } });
    expect(await rowOf(U, sent.sha)).toMatchObject({ mailbox: 'replies', status: 'received' });
    await until('the queued log lines', async () =>
      logLines(U, '[microns-mail]').some((l) => l.includes(`mail replies ${sent.sha.slice(0, 16)} queued`)) &&
      logLines(U, '[microns-ops]').some((l) => l.includes('mail ingest reply') && l.includes(`sha=${sent.sha.slice(0, 16)}`) && l.includes('outcome=queued')),
    );
  });

  it.skipIf(!RP_PRESENT)('replies@ with agent.quote on: the agent-events consumer (unit RP) takes the row out of received', async () => {
    await setFlag(U, 'agent.quote', { enabled: true, value: { mode: 'assist' }, rev: 1 });
    try {
      const sent = await sendMail(U, { from: 'anna.becker@example.com', to: 'replies@rfq.micronshub.eu', subject: 'Re: Quotation T2 consumed', text: 'Thank you.' });
      await until('the reply consumer', async () => (await rowOf(U, sent.sha)).status !== 'received', 30_000);
    } finally {
      await setFlag(U, 'agent.quote', null);
    }
  });

  it('an unknown recipient is rejected before anything is stored', async () => {
    const sent = await sendMail(U, { from: 'someone@example.com', to: 'sales@rfq.micronshub.eu', subject: 'T2 unknown recipient', text: 'Hello' });
    const captured = await until('the capture', async () => (await capturedMails(U)).find((m) => m.messageId === sent.messageId));
    expect(captured.rejectReason).toBe('Unknown recipient');
    expect((captured.events as Array<{ type: string }>).map((e) => e.type)).toEqual(['received', 'reject']);
    expect((await rows(U, 'inbound_emails')).some((r) => r.message_id_sha256 === sent.sha)).toBe(false);
  });

  it('log lines of microns-mail carry no address and no subject', () => {
    const lines = logLines(U, '[microns-mail]');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/);
      expect(line).not.toMatch(/RFQ T2|Automatic reply|Quotation/);
    }
  });
});

describe.skipIf(!U.site || !U.stub)('shadow copy with MAIL_COPY_TO (M-4, own harness instance)', () => {
  const COPY = 'copy-desk@example.com';
  let own: (Urls & { stop: () => Promise<void> }) | null = null;

  beforeAll(async () => {
    const harness = (await import(/* @vite-ignore */ new URL('../../../site/test/integration/harness.mjs', import.meta.url).href)) as {
      startHarness(o: Record<string, unknown>): Promise<{ url: string; stub: { url: string }; explorer: string; tmp: string; approvalSecret: string; stop: () => Promise<void> }>;
    };
    const h = await harness.startHarness({ profile: 'agents', publish: false, quiet: true, mailSecrets: { MAIL_COPY_TO: COPY } });
    own = { site: h.url, stub: h.stub.url, explorer: h.explorer, tmp: h.tmp, approvalSecret: h.approvalSecret, stop: h.stop };
  });

  afterAll(async () => {
    await own?.stop();
  });

  it('every accepted mail is forwarded to MAIL_COPY_TO with X-Microns-Inbound', async () => {
    const u = own as Urls;
    const sent = await sendMail(u, { from: 'anna.becker@example.com', to: 'rfq@rfq.micronshub.eu', subject: 'RFQ T2 copy', text: 'Please quote.' });
    await rowOf(u, sent.sha);
    const captured = await until('the forward', async () => {
      const m = (await capturedMails(u)).find((x) => x.messageId === sent.messageId);
      return m && (m.forwards ?? []).length > 0 ? m : null;
    });
    expect(captured.forwards).toHaveLength(1);
    expect(captured.forwards?.[0].recipient).toBe(COPY);
    expect(captured.forwards?.[0].headers.map(([k, v]) => [k.toLowerCase(), v])).toContainEqual(['x-microns-inbound', sent.sha.slice(0, 16)]);
    await until('the copy log line', async () => logLines(u, '[microns-mail]').some((l) => l.includes(`mail rfq ${sent.sha.slice(0, 16)} flag_off+copy`)));
  });
});
