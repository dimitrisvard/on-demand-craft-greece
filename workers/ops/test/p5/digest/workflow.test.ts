// O5: OpsDigestWorkflow over FakeStep: the digest mail (idempotency key, sender, recipient, figures, summary), the
// Telegram line, the run row and its output, the monthly purge (first Monday only), flag off, and the flag re-read
// before each side-effecting step (send, telegram, purge: switched off, or moved to shadow during an assist run),
// shadow mode (R2 phase5-shadow/ only; a failure there sends no alert), missing configuration, a narrative that fails
// or is unavailable, a rejected or failing mail provider, an existing final run, invalid params, and that the address
// never leaves the send step.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from 'cloudflare:workflows';
import { collectMetrics, reportWindow } from '../../../src/digest/collect';
import { figureRows, narrativeInput } from '../../../src/digest/render';
import { collectStuck } from '../../../src/digest/stuck';
import type { LlmCall, LlmPort } from '../../../src/ports/index';
import { registeredPrompts } from '../../../src/agents/prompts/registry';
import { digestErrorCode, NARRATIVE_PROMPT, RECIPIENT_FIELD, runOpsDigest } from '../../../src/workflows/ops-digest';
import { FakeStep } from '../../helpers/fake-step';
import { RecordingLogger } from '../../helpers/recorders';
import { DIGEST_FROM, digestHarness, llmAnswer, RECIPIENT, runByKey, VECTORS, type DigestHarness } from './helpers';

let logger: RecordingLogger;
let restoreConsole: () => void;
beforeAll(() => {
  logger = new RecordingLogger();
  restoreConsole = logger.start();
});
afterAll(() => {
  restoreConsole();
  vi.restoreAllMocks();
});

const WEEK = VECTORS.iso_week; // 2026-W42: Monday 2026-10-12, not the first Monday of October
const FIRST_MONDAY_WEEK = '2026-W41'; // Monday 2026-10-05
const LINES = ['RFQs: 3.', 'Orders: 2 in EUR.', 'Agents cost $0.21.', 'Lag up to 30 days.', 'Two runs are stuck.'];

async function addNarrative(h: DigestHarness, isoWeek = WEEK, lines = LINES): Promise<void> {
  const w = reportWindow(isoWeek)!;
  const m = await collectMetrics(h.db, w);
  const s = await collectStuck(h.db, w, h.clock.now());
  const user: LlmCall['user'] = [{ type: 'text', text: `<metrics>\n${JSON.stringify(narrativeInput(m, s))}\n</metrics>` }];
  await h.ports.llm.add(NARRATIVE_PROMPT, user, llmAnswer({ lines }));
}

async function go(h: DigestHarness, iso_week = WEEK, trigger: 'cron' | 'manual' = 'cron') {
  const step = new FakeStep({ now: h.clock.now().getTime() });
  const r = await runOpsDigest({ iso_week, trigger }, `ops-digest-${iso_week}`, { env: h.env, ports: h.ports, p5: h.p5, step });
  return { r, step };
}

/** Runs the digest and calls `before(name)` as each step starts (the flag can be changed mid-run there). */
async function goWithHook(h: DigestHarness, before: (name: string) => void, iso_week = WEEK) {
  const step = new FakeStep({ now: h.clock.now().getTime() });
  const origDo = step.do.bind(step);
  (step as unknown as { do: typeof step.do }).do = ((name: string, ...args: unknown[]) => {
    before(name);
    return (origDo as (n: string, ...a: unknown[]) => Promise<unknown>)(name, ...args);
  }) as typeof step.do;
  const r = await runOpsDigest({ iso_week, trigger: 'cron' }, `ops-digest-${iso_week}`, { env: h.env, ports: h.ports, p5: h.p5, step });
  return { r, step };
}

const purgeCalls = (h: DigestHarness) => h.db.calls.filter((c) => c.method === 'rpc' && c.target === 'agent_retention_purge');

function addressFree(value: unknown): boolean {
  return !(JSON.stringify(value) ?? '').includes(RECIPIENT);
}

describe('OpsDigestWorkflow: assist', () => {
  it('sends one mail with the figures and the summary, one Telegram line, and closes the run', async () => {
    const h = digestHarness();
    await addNarrative(h);
    const { r, step } = await go(h);
    expect(r.outcome).toBe('sent');

    expect(h.ports.mailer.sent).toHaveLength(1);
    const mail = h.ports.mailer.sent[0];
    expect(mail).toMatchObject({ from: DIGEST_FROM, to: [RECIPIENT], idempotency_key: 'digest/2026-W42', subject: 'MicronsHub ops digest 2026-W41 (2026-10-05 to 2026-10-11)' });
    const w = reportWindow(WEEK)!;
    for (const row of figureRows(await collectMetrics(h.db, w), await collectStuck(h.db, w, h.clock.now()))) {
      expect(mail.text).toContain(`  ${row.figure}: ${row.value}`);
    }
    for (const l of LINES) expect(mail.html).toContain(`<li>${l}</li>`);
    expect(h.p5.telegramText.texts()).toEqual(['Digest W41 sent: 3 RFQs, 4 quotes, win rate 33.3 %']);

    const run = runByKey(h, 'ops_digest:2026-W42')!;
    expect(run).toMatchObject({ agent: 'ops_digest', trigger: 'cron', status: 'succeeded', workflow_name: 'ops-digest', workflow_instance_id: 'ops-digest-2026-W42', prompt_version: 'ops_digest.narrative@v1', llm_calls: 1 });
    expect(Number(run.cost_cents)).toBeGreaterThan(0);
    expect(run.output).toMatchObject({
      sent: true,
      recipient_set: true,
      sections: ['summary', 'pipeline', 'quotes', 'orders', 'agents', 'content', 'collectors', 'marketing', 'stuck'],
      purge: 'not_due',
      report_week: '2026-W41',
      narrative: 'ok',
      telegram: true,
      ads_upload: 'off',
      rfqs: 3,
      quotes_sent: 4,
      win_rate_pct: '33.3',
      stuck_runs: 2,
    });
    expect(h.ports.llm.calls).toEqual([{ prompt: NARRATIVE_PROMPT, sha256: expect.any(String), route: 'extract', step: 'narrative' }]);
    expect(h.db.calls.some((c) => c.method === 'rpc' && c.target === 'agent_retention_purge')).toBe(false);

    // the address never leaves the send step: not in step results, the run row, or a log line
    for (const [name, value] of step.cache) expect(addressFree(value), name).toBe(true);
    expect(addressFree(run)).toBe(true);
    expect(logger.lines.some((l) => l.includes('ops digest sent'))).toBe(true);
    expect(logger.lines.some((l) => l.includes(RECIPIENT))).toBe(false);
  });

  it('sends the flag request body with the metrics only (route extract, 800 tokens, no address)', async () => {
    const h = digestHarness();
    await addNarrative(h);
    await go(h);
    const body = h.ports.llm.requests[0].body as { max_tokens: number; messages: Array<{ content: Array<{ text: string }> }> };
    expect(body.max_tokens).toBe(800);
    const sentText = JSON.stringify(body.messages);
    expect(sentText).toContain('<metrics>');
    expect(sentText).not.toContain(RECIPIENT);
    expect(sentText).not.toMatch(/-0000-4000-8000-/);
  });

  it('a manual run records trigger manual', async () => {
    const h = digestHarness();
    await go(h, WEEK, 'manual');
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ trigger: 'manual', status: 'succeeded' });
  });

  it('a second instance for the same week sends nothing (final run exists)', async () => {
    const h = digestHarness();
    await go(h);
    const again = await go(h);
    expect(again.r.outcome).toBe('exists');
    expect(h.ports.mailer.sent).toHaveLength(1);
    expect(h.p5.telegramText.texts()).toHaveLength(1);
  });

  it('a replay of the instance (cached steps) sends neither the mail nor the line again', async () => {
    const h = digestHarness();
    const { step } = await go(h);
    const replay = await runOpsDigest({ iso_week: WEEK, trigger: 'cron' }, `ops-digest-${WEEK}`, { env: h.env, ports: h.ports, p5: h.p5, step: step.replay() });
    expect(replay.outcome).toBe('sent');
    expect(h.ports.mailer.sent).toHaveLength(1);
    expect(h.p5.telegramText.texts()).toHaveLength(1);
  });

  it('a send retried after the provider accepted it reuses the idempotency key (one mail)', async () => {
    const h = digestHarness();
    let first = true;
    const send = h.ports.mailer.send.bind(h.ports.mailer);
    h.ports.mailer.send = async (m) => {
      const r = await send(m);
      if (first) {
        first = false;
        throw new Error('connection reset after the provider accepted the mail');
      }
      return r;
    };
    const { r } = await go(h);
    expect(r.outcome).toBe('sent');
    expect(h.ports.mailer.sent).toHaveLength(1);
    expect(h.ports.mailer.byKey.get('digest/2026-W42')).toBe('resend-1');
  });
});

describe('OpsDigestWorkflow: purge', () => {
  it('first Monday of a month: agent_retention_purge runs once and its counts are recorded', async () => {
    const h = digestHarness({ now: '2026-10-05T06:30:00Z' });
    const { r } = await go(h, FIRST_MONDAY_WEEK);
    expect(r.outcome).toBe('sent');
    expect(h.db.calls.filter((c) => c.method === 'rpc' && c.target === 'agent_retention_purge')).toHaveLength(1);
    expect(runByKey(h, `ops_digest:${FIRST_MONDAY_WEEK}`)!.output).toMatchObject({ purge: { excerpts_cleared: 0, emails_deleted: 0, run_outputs_cleared: 0, runs_deleted: 0 } });
  });

  it('value.purge false: no purge, recorded as off', async () => {
    const h = digestHarness({ now: '2026-10-05T06:30:00Z' });
    h.setFlag({ value: { purge: false } });
    await go(h, FIRST_MONDAY_WEEK);
    expect(h.db.calls.some((c) => c.method === 'rpc' && c.target === 'agent_retention_purge')).toBe(false);
    expect(runByKey(h, `ops_digest:${FIRST_MONDAY_WEEK}`)!.output).toMatchObject({ purge: 'off' });
  });

  it('ads_upload true is recorded as not built and calls nothing', async () => {
    const h = digestHarness();
    h.setFlag({ value: { ads_upload: true } });
    await go(h);
    expect(runByKey(h, 'ops_digest:2026-W42')!.output).toMatchObject({ ads_upload: 'not_built' });
  });
});

describe('OpsDigestWorkflow: flag and configuration', () => {
  it('flag off: run skipped (flag_off), no mail, no Telegram, no LLM call', async () => {
    const h = digestHarness();
    h.setFlag({ enabled: false });
    const { r } = await go(h);
    expect(r.outcome).toBe('flag_off');
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', report_week: '2026-W41' } });
    expect(h.ports.mailer.sent).toEqual([]);
    expect(h.p5.telegramText.texts()).toEqual([]);
    expect(h.ports.llm.calls).toEqual([]);
  });

  it('missing flag record reads as off (fail closed)', async () => {
    const h = digestHarness();
    h.setFlag(null);
    expect((await go(h)).r.outcome).toBe('flag_off');
  });

  it('flag switched off before the send step: skipped, nothing sent', async () => {
    const h = digestHarness();
    const { r } = await goWithHook(h, (name) => {
      if (name === 'send') h.setFlag({ enabled: false });
    });
    expect(r.outcome).toBe('flag_off');
    expect(h.ports.mailer.sent).toEqual([]);
    expect(h.p5.telegramText.texts()).toEqual([]);
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'skipped', output: { halted_at: 'send', sent: false } });
  });

  it('an assist run whose flag moves to shadow before the send step stops there: no mail, skipped', async () => {
    const h = digestHarness();
    const { r } = await goWithHook(h, (name) => {
      if (name === 'send') h.setFlag({ mode: 'shadow' });
    });
    expect(r.outcome).toBe('flag_off');
    expect(h.ports.mailer.sent).toEqual([]);
    expect(h.p5.telegramText.texts()).toEqual([]);
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'skipped', output: { reason: 'flag_off', halted_at: 'send', sent: false } });
  });

  it('flag switched off before the telegram step: the mail went out, no line, run succeeded with telegram false', async () => {
    const h = digestHarness();
    const { r } = await goWithHook(h, (name) => {
      if (name === 'telegram') h.setFlag({ enabled: false });
    });
    expect(r.outcome).toBe('sent');
    expect(h.ports.mailer.sent).toHaveLength(1);
    expect(h.p5.telegramText.texts()).toEqual([]);
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'succeeded', output: { sent: true, telegram: false } });
  });

  it('flag switched off before the purge step (first Monday): no purge call, recorded as flag_off', async () => {
    const h = digestHarness({ now: '2026-10-05T06:30:00Z' });
    const { r } = await goWithHook(h, (name) => {
      if (name === 'purge') h.setFlag({ enabled: false });
    }, FIRST_MONDAY_WEEK);
    expect(r.outcome).toBe('sent');
    expect(purgeCalls(h)).toEqual([]);
    expect(runByKey(h, `ops_digest:${FIRST_MONDAY_WEEK}`)).toMatchObject({ status: 'succeeded', output: { purge: 'flag_off', sent: true } });
  });

  it('flag moved to shadow before the purge step (first Monday): no purge call', async () => {
    const h = digestHarness({ now: '2026-10-05T06:30:00Z' });
    await goWithHook(h, (name) => {
      if (name === 'purge') h.setFlag({ mode: 'shadow' });
    }, FIRST_MONDAY_WEEK);
    expect(purgeCalls(h)).toEqual([]);
    expect(runByKey(h, `ops_digest:${FIRST_MONDAY_WEEK}`)!.output).toMatchObject({ purge: 'flag_off' });
  });

  it('assist without a recipient: failed config_missing naming the field (never a value)', async () => {
    const h = digestHarness();
    h.setFlag({ value: { recipient: 'not an address' } });
    const { r } = await go(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'flag' });
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'failed', error: 'config_missing', output: { missing: [RECIPIENT_FIELD], recipient_set: false } });
    expect(h.ports.mailer.sent).toEqual([]);
  });

  it('assist without DIGEST_FROM: failed config_missing', async () => {
    const h = digestHarness({ env: { DIGEST_FROM: undefined } });
    await go(h);
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'failed', error: 'config_missing', output: { missing: ['DIGEST_FROM'] } });
  });

  it('invalid iso_week: NonRetryableError before any run is opened', async () => {
    const h = digestHarness({ seed: false });
    const step = new FakeStep();
    await expect(runOpsDigest({ iso_week: '2026-W60', trigger: 'cron' }, 'ops-digest-x', { env: h.env, ports: h.ports, p5: h.p5, step })).rejects.toBeInstanceOf(NonRetryableError);
    expect(h.db.rows('agent_runs')).toEqual([]);
  });
});

describe('OpsDigestWorkflow: shadow', () => {
  it('writes the rendered digest to R2 phase5-shadow/ only: no mail, no Telegram, no purge', async () => {
    const h = digestHarness({ now: '2026-10-05T06:30:00Z' });
    h.setFlag({ mode: 'shadow' });
    const { r } = await go(h, FIRST_MONDAY_WEEK);
    expect(r.outcome).toBe('shadow');
    expect(h.ports.mailer.sent).toEqual([]);
    expect(h.p5.telegramText.texts()).toEqual([]);
    expect(h.db.calls.some((c) => c.method === 'rpc' && c.target === 'agent_retention_purge')).toBe(false);
    const key = `phase5-shadow/ops-digest/${FIRST_MONDAY_WEEK}/digest.html`;
    const obj = h.ports.bucket.objects.get(key)!;
    expect(new TextDecoder().decode(obj.bytes)).toContain('MicronsHub ops digest 2026-W40');
    expect(obj.httpMetadata).toEqual({ contentType: 'text/html; charset=utf-8' });
    expect(runByKey(h, `ops_digest:${FIRST_MONDAY_WEEK}`)).toMatchObject({ status: 'succeeded', output: { shadow: true, sent: false, purge: 'shadow', shadow_key: key } });
  });

  it('shadow needs no recipient and no DIGEST_FROM', async () => {
    const h = digestHarness({ env: { DIGEST_FROM: undefined } });
    h.setFlag({ mode: 'shadow', value: { recipient: null } });
    expect((await go(h)).r.outcome).toBe('shadow');
  });

  it('shadow without PRIVATE_FILES: failed config_missing naming the binding, nothing written or sent', async () => {
    const h = digestHarness({ env: { PRIVATE_FILES: undefined } });
    h.setFlag({ mode: 'shadow' });
    const { r } = await go(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'flag' });
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'failed', error: 'config_missing', output: { missing: ['PRIVATE_FILES'] } });
    expect(h.ports.bucket.objects.size).toBe(0);
    expect(h.ports.mailer.sent).toEqual([]);
    expect(h.p5.telegramText.texts()).toEqual([]);
    expect(h.ports.llm.calls).toEqual([]);
  });

  it('a failure in shadow closes the run failed and sends no alert line', async () => {
    const h = digestHarness();
    h.setFlag({ mode: 'shadow' });
    const select = h.db.select.bind(h.db);
    h.db.select = (async (table: string, o?: unknown) => {
      if (table === 'orders') {
        const { DbError } = await import('../../../src/db/postgrest');
        throw new DbError(500, 'XX000', 'postgrest GET orders: 500');
      }
      return select(table, o as never);
    }) as typeof h.db.select;
    const { r } = await go(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'collect' });
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'failed', error: 'collect: db_error 500 XX000', output: { shadow: true, report_week: '2026-W41' } });
    expect(h.p5.telegramText.texts()).toEqual([]);
    expect(h.ports.mailer.sent).toEqual([]);
  });
});

describe('OpsDigestWorkflow: failures', () => {
  it('a narrative without a fixture (schema failure): the digest still goes out, summary marked unavailable', async () => {
    const h = digestHarness();
    const { r } = await go(h);
    expect(r.outcome).toBe('sent');
    expect(h.ports.mailer.sent[0].text).toContain('Summary unavailable this week (llm_schema)');
    expect(runByKey(h, 'ops_digest:2026-W42')!.output).toMatchObject({ narrative: 'llm_schema', sent: true });
  });

  it('a provider still failing after the step retries: the digest still goes out', async () => {
    const h = digestHarness();
    let calls = 0;
    const failing: LlmPort = { call: async () => { calls++; return { ok: false, code: 'provider_5xx', retryable: true, message: 'overloaded' }; } };
    h.ports.llm = failing as typeof h.ports.llm;
    const { r } = await go(h);
    expect(r.outcome).toBe('sent');
    expect(calls).toBe(4); // first attempt + LLM_EXTRACT retries (3)
    expect(h.ports.mailer.sent[0].text).toContain('Summary unavailable this week (llm_unavailable)');
  });

  it('an answer with no usable line counts as a schema failure', async () => {
    const h = digestHarness();
    await addNarrative(h, WEEK, ['   ']);
    await go(h);
    expect(runByKey(h, 'ops_digest:2026-W42')!.output).toMatchObject({ narrative: 'llm_schema' });
  });

  it('mail rejected (4xx): run failed at send, one alert line, no digest line', async () => {
    const h = digestHarness();
    h.ports.mailer.failWith = { status: 422, retryable: false, message: 'invalid' };
    const { r } = await go(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'send' });
    expect(runByKey(h, 'ops_digest:2026-W42')).toMatchObject({ status: 'failed', error: 'send: mail_rejected_422' });
    expect(h.p5.telegramText.texts()).toEqual(['Ops digest 2026-W41: run failed at step send (mail_rejected_422).']);
  });

  it('mail provider unavailable (5xx): retried by the step, then failed', async () => {
    const h = digestHarness();
    h.ports.mailer.failWith = { status: 503, retryable: true, message: 'busy' };
    const { r, step } = await go(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'send' });
    expect(step.calls.find((c) => c.name === 'send')?.attempts).toBe(4);
    expect(runByKey(h, 'ops_digest:2026-W42')!.error).toBe('send: mail_unavailable');
  });

  it('a database failure in collect closes the run failed with a fixed code', async () => {
    const h = digestHarness();
    const select = h.db.select.bind(h.db);
    h.db.select = (async (table: string, o?: unknown) => {
      if (table === 'orders') {
        const { DbError } = await import('../../../src/db/postgrest');
        throw new DbError(500, 'XX000', 'postgrest GET orders: 500');
      }
      return select(table, o as never);
    }) as typeof h.db.select;
    const { r } = await go(h);
    expect(r).toMatchObject({ outcome: 'failed', failed_step: 'collect' });
    expect(runByKey(h, 'ops_digest:2026-W42')!.error).toBe('collect: db_error 500 XX000');
    expect(h.ports.mailer.sent).toEqual([]);
  });

  it('error codes never carry message text', () => {
    expect(digestErrorCode(new Error(`something about ${RECIPIENT}`))).toBe('error');
    expect(digestErrorCode(new Error('mail_unavailable 503'))).toBe('mail_unavailable');
  });
});

describe('prompt registration', () => {
  it('the workflow module registers ops_digest.narrative@v1 at load', () => {
    expect(registeredPrompts()).toContain(NARRATIVE_PROMPT);
  });
});
