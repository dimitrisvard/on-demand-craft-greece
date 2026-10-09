// T2 (profile 'jobs', real workerd): the weekly ops digest end to end. An ops-digest instance is started through the
// Local Explorer for ISO week 2033-W01 (Monday 2033-01-03, the first Monday of January), so it reports 2032-W53, a
// week no other T2 file uses. The figures are read from the mini-PostgREST, the narrative comes from the Anthropic
// stub (fixture for the exact metrics the Workflow sends, computed here with the same pure modules over the same
// stub), the mail goes to the Resend stub with Idempotency-Key digest/2033-W01, the line to the Telegram stub, and
// agent_retention_purge runs through the stub's RPC. A second instance for the same week sends nothing (final run
// exists); a shadow run for 2033-W02 writes only R2 phase5-shadow/ops-digest/2033-W02/digest.html.
// Only pure modules are imported (the T2 config has no aliases for the runtime modules).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgrestDb } from '../../src/db/postgrest';
import { collectMetrics, reportWindow } from '../../src/digest/collect';
import { narrativeInput } from '../../src/digest/render';
import { collectStuck } from '../../src/digest/stuck';
import { contentSha, flagValue, globalUrls, instance, llmRequests, logLines, r2Get, registerFixture, resendEmails, restoreFlag, rows, seed, setFlag, startInstance, telegramCalls, until, type Row } from '../quote/t2-helpers';

const PROFILE = process.env.T2_PROFILE ?? '';
const ENABLED = Boolean(process.env.T2_STUB_URL) && PROFILE === 'jobs';

const FLAG = 'agent.ops_digest';
const WEEK = '2033-W01';
const SHADOW_WEEK = '2033-W02';
const PROMPT = 'ops_digest.narrative@v1';
/** Example recipient, built at runtime. */
const RECIPIENT = ['digest-owner', 'example.test'].join('@');
const LINES = ['Two RFQs arrived and one quote was sent.', 'One order in EUR with a 40.0 % margin.', 'No agent failed.', 'Content and collectors were quiet.', 'Nothing needs attention.'];

const id = (p: string, n: number) => `${p.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe.skipIf(!ENABLED)('ops digest in workerd (T2, profile jobs)', () => {
  const u = globalUrls();
  let saved: string | null = null;
  let mailsBefore = 0;
  let linesBefore = 0;

  const digestRun = (week: string) =>
    until(`the ops_digest run of ${week}`, async () => {
      const r = (await rows(u, 'agent_runs')).find((x) => x.agent === 'ops_digest' && x.idempotency_key === `ops_digest:${week}`);
      return r && r.status !== 'running' ? r : null;
    }, 120_000);
  const digestLines = async () => (await telegramCalls(u)).filter((c) => c.method === 'sendMessage' && /^Digest W/.test(String(c.body.text)));

  beforeAll(async () => {
    saved = await flagValue(u, FLAG);
    const rfq1 = id('d5a1', 1);
    const rfq2 = id('d5a1', 2);
    await seed(u, {
      rfqs: [
        { id: rfq1, company_name: 'T2 Digest One', source: 'web', created_at: '2032-12-27T08:00:00Z' },
        { id: rfq2, company_name: 'T2 Digest Two', source: 'email', created_at: '2033-01-02T23:00:00Z' },
      ],
      quote_workflows: [
        { id: id('d5b2', 1), rfq_id: rfq1, quote_version: 1, workflow_instance_id: `quote-${rfq1}-v1`, status: 'won', sent_at: '2032-12-28T08:00:00Z', last_event_at: '2032-12-30T10:00:00Z', created_at: '2032-12-27T09:00:00Z', updated_at: '2032-12-30T10:00:00Z' },
      ],
      orders: [{ id: id('d5c3', 1), title: 'PO-T2-DIGEST', currency: 'EUR', total_amount: 1000, total_production_costs: 600, created_at: '2032-12-30T11:00:00Z' }],
      leads: [{ id: id('d5d4', 1), source: 'hackernews', external_id: 't2-digest-1', source_url: 'https://example.test/t2-digest/1', title: 'T2 digest lead', discovered_at: '2032-12-29T12:00:00Z' }],
      marketing_events: [{ id: id('d5e5', 1), event_type: 'sent', created_at: '2032-12-31T09:00:00Z' }],
    });
    // the narrative fixture for exactly the metrics the Workflow will send (same pure code, same stub rows)
    const db = new PostgrestDb({ url: u.stub, serviceRoleKey: 't2' });
    const w = reportWindow(WEEK)!;
    const input = narrativeInput(await collectMetrics(db, w), await collectStuck(db, w, new Date()));
    await registerFixture(u, PROMPT, contentSha([{ type: 'text', text: `<metrics>\n${JSON.stringify(input)}\n</metrics>` }]), { lines: LINES });
    mailsBefore = (await resendEmails(u)).length;
    linesBefore = (await digestLines()).length;
    await setFlag(u, FLAG, { enabled: true, mode: 'assist', value: { mode: 'assist', recipient: RECIPIENT, ads_upload: false, purge: true }, rev: 901 });
  }, 120_000);

  afterAll(async () => {
    await restoreFlag(u, FLAG, saved);
  });

  it('assist: one mail with the idempotency key, one Telegram line, the narrative, the purge, the run row', async () => {
    await startInstance(u, 'ops-digest', `ops-digest-${WEEK}`, { iso_week: WEEK, trigger: 'manual' });
    const run = await digestRun(WEEK);
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual', workflow_name: 'ops-digest', workflow_instance_id: `ops-digest-${WEEK}`, prompt_version: PROMPT, llm_calls: 1 });
    const out = run.output as Row;
    expect(out).toMatchObject({ sent: true, recipient_set: true, report_week: '2032-W53', narrative: 'ok', telegram: true, rfqs: 2, quotes_sent: 1, win_rate_pct: '100.0', ads_upload: 'off' });
    expect(typeof out.purge).toBe('object'); // 2033-01-03 is the first Monday of January
    expect(JSON.stringify(run)).not.toContain(RECIPIENT);

    const mails = (await resendEmails(u)).slice(mailsBefore);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ idempotency_key: `digest/${WEEK}`, from: 'MicronsHub Ops <info@micronshub.eu>', subject: 'MicronsHub ops digest 2032-W53 (2032-12-27 to 2033-01-02)' });
    expect([mails[0].to].flat()).toEqual([RECIPIENT]);

    const lines = (await digestLines()).slice(linesBefore);
    expect(lines.map((c) => c.body.text)).toEqual(['Digest W53 sent: 2 RFQs, 1 quotes, win rate 100.0 %']);
    expect(lines[0].body.parse_mode).toBeUndefined();

    const llm = (await llmRequests(u)).filter((r) => r.prompt === PROMPT);
    expect(llm.length).toBeGreaterThanOrEqual(1);
    expect(llm[llm.length - 1]).toMatchObject({ x_api_key: false, cf_aig_authorization: true, cf_aig_collect_log_payload: 'false' });

    expect(logLines(u, '[microns-ops]').some((l) => l.includes(RECIPIENT))).toBe(false);
  });

  it('a second instance for the same week sends nothing: the final run exists', async () => {
    await startInstance(u, 'ops-digest', `ops-digest-${WEEK}-again`, { iso_week: WEEK, trigger: 'manual' });
    const done = await until('the second instance finished', async () => {
      const i = await instance(u, 'ops-digest', `ops-digest-${WEEK}-again`);
      return i.result && ['complete', 'completed'].includes(String((i.result as Row).status)) ? i.result : null;
    }, 60_000);
    expect(JSON.stringify(done)).toContain('exists');
    expect((await resendEmails(u)).slice(mailsBefore)).toHaveLength(1);
    expect((await digestLines()).slice(linesBefore)).toHaveLength(1);
  });

  it('shadow: the rendered digest goes to R2 phase5-shadow/ only (no mail, no line, no purge)', async () => {
    await setFlag(u, FLAG, { enabled: true, mode: 'shadow', value: { mode: 'shadow', ads_upload: false, purge: true }, rev: 902 });
    await startInstance(u, 'ops-digest', `ops-digest-${SHADOW_WEEK}`, { iso_week: SHADOW_WEEK, trigger: 'manual' });
    const run = await digestRun(SHADOW_WEEK);
    expect(run).toMatchObject({ status: 'succeeded' });
    expect(run.output).toMatchObject({ shadow: true, sent: false, purge: 'shadow', shadow_key: `phase5-shadow/ops-digest/${SHADOW_WEEK}/digest.html` });
    const html = await r2Get(u, `phase5-shadow/ops-digest/${SHADOW_WEEK}/digest.html`);
    expect(html).not.toBeNull();
    expect(new TextDecoder().decode(html!)).toContain('MicronsHub ops digest 2033-W01');
    expect((await resendEmails(u)).slice(mailsBefore)).toHaveLength(1);
    expect((await digestLines()).slice(linesBefore)).toHaveLength(1);
  }, 120_000);
});
