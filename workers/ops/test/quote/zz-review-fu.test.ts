import { describe, expect, it } from 'vitest';
import { DecidingStep, decideAndDeliver, harness, runCase, waitingHash } from './harness';
import { QWID } from './seed';

describe('R11 follow-up after the kill switch', () => {
  it('flag off after the send: no follow-up mail goes out', async () => {
    const h = harness();
    const step = new DecidingStep();
    step.hook = async (type) => {
      if (type === 'quote-approved' && waitingHash(h)) await decideAndDeliver(h, step, { verb: 'approve' });
      if (type === 'customer-reply') h.kv.setJson('agent.quote', { enabled: false, value: {}, rev: 9 });
    };
    await runCase(h, { step });
    console.info('mails', JSON.stringify(h.ports.mailer.sent.map((m) => m.idempotency_key)));
    expect(h.ports.mailer.sent.map((m) => m.idempotency_key)).toEqual([`quote/${QWID}/send`]);
  });
});
