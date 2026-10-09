// T2 (profile 'jobs', real workerd): the Xometry scan end to end. The every-minute cron is fired through the Local
// Explorer at three slots of a day no other file uses; the dispatcher (unit K5) opens 'growth.xometry:<slot>' and
// sends the 'xometry-scan' message, the local scrapes consumer hands it to handleXometryScan, which calls the
// partner stub (stubs/xometry.mjs, XOMETRY_API_BASE), writes xometry_offers through the mini-PostgREST and sends
// plain text to the Telegram stub. Checks: a two-page board is stored with the three-step upsert and the run closes
// succeeded; a 401 page closes the next run failed with auth 'rejected' and sends the alert in the same tick; the
// following slot with the same token fingerprint closes skipped (token_rejected) without any partner call.

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gqlPage, makeOffer, makePart } from '../p5/xometry/helpers';
import { call, flagValue, globalUrls, json, JSON_HEADERS, restoreFlag, rows, setFlag, until, type Row } from '../quote/t2-helpers';

const PROFILE = process.env.T2_PROFILE ?? '';
const ENABLED = Boolean(process.env.T2_STUB_URL) && PROFILE === 'jobs';

/** Wednesday 2031-03-05, slots 06:00, 08:00 and 10:00 UTC: a day no other T2 file uses. */
const DAY = '2031-03-05';
const SLOTS = ['06:00', '08:00', '10:00'].map((t) => `${DAY}T${t}Z`);
const TICKS = SLOTS.map((s) => Date.parse(s.replace('Z', ':00Z')));
const FLAG = 'agent.growth.xometry';

interface XometryCall {
  method: string;
  operationName: string | null;
  variables: { filter?: Row; offsetAttributes?: { limit: number; offset: number } } | null;
  headers: { authorization: boolean; cookie: boolean };
}

interface TelegramCall {
  method: string;
  body: { chat_id?: string; text?: string };
  raw?: string;
}

describe.skipIf(!ENABLED)('Xometry scan in workerd (T2, profile jobs)', () => {
  const u = globalUrls();
  const token = process.env.T2_XOMETRY_TOKEN ?? '';
  const fingerprint = createHash('sha256').update(`${token}\n`).digest('hex').slice(0, 12);
  let saved: string | null = null;

  const partnerCalls = async () => json<XometryCall[]>(await call(`${u.stub}/__stub/xometry/calls`));
  const alerts = async () => (await json<TelegramCall[]>(await call(`${u.stub}/__stub/telegram/calls`))).filter((c) => c.method === 'sendMessage' && /^Xometry/.test(String(c.body.text)));
  const script = async (s: unknown) => {
    const res = await call(`${u.stub}/__stub/xometry/script`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(s) });
    expect(res.status).toBe(204);
  };
  const cron = async (at: number) => {
    const res = await call(`${u.explorer}/local/scheduled?worker=microns-ops`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ cron: '* * * * *', scheduled_time: at }) });
    expect(res.status).toBe(200);
  };
  const finalRun = (slot: string) =>
    until(`the run growth.xometry:${slot}`, async () => {
      const run = (await rows(u, 'agent_runs')).find((r) => r.idempotency_key === `growth.xometry:${slot}`);
      return run && run.status !== 'running' ? run : null;
    });

  beforeAll(async () => {
    expect(token).not.toBe('');
    saved = await flagValue(u, FLAG);
    await setFlag(u, FLAG, { enabled: true, mode: 'assist', value: {}, rev: 1 });
  });

  afterAll(async () => {
    await restoreFlag(u, FLAG, saved);
  });

  it('a two-page board: offers stored in xometry_offers, run succeeded, bearer sent, no alert', async () => {
    const before = (await partnerCalls()).length;
    const alertsBefore = (await alerts()).length;
    await script({
      responses: [
        { status: 200, body: gqlPage([makeOffer('HJO-T2-CNC'), makeOffer('HJO-T2-LASER', { parts: [makePart({ tags: [{ id: 36, name: 'Laser Cutting', context: 'production_methods' }] })] })], { hasMore: true }) },
        { status: 200, body: gqlPage([makeOffer('HJO-T2-PDF', { parts: [makePart({ files: [{ id: 2, name: 'drawing.pdf', downloadUrl: 'https://files.example/drawing.pdf' }] })] })], { offset: 20 }) },
      ],
      default: { status: 500, body: { error: 'unscripted' } },
    });
    await cron(TICKS[0]);
    const run = await finalRun(SLOTS[0]);
    expect(run.status).toBe('succeeded');
    expect(run.trigger).toBe('cron');
    expect(run.output).toMatchObject({ mode: 'assist', auth: 'ok', token_fp: fingerprint, scanned: 3, preset_rejected: 1, upserted: 2, inserted_new: 2, needs_manual: 1, pages: 2, partial: false, errors: [], alerts: [] });
    const calls = (await partnerCalls()).slice(before);
    expect(calls.map((c) => [c.operationName, c.variables?.offsetAttributes?.offset])).toEqual([
      ['gshJobOffers', 0],
      ['gshJobOffers', 20],
    ]);
    expect(calls[0].variables?.filter).toEqual({ urgentStatus: 'without_urgent', responseStatus: 'empty' });
    expect(calls[0].headers).toMatchObject({ authorization: true, cookie: false });
    const stored = (await rows(u, 'xometry_offers')).filter((r) => String(r.code).startsWith('HJO-T2-'));
    expect(stored.map((r) => [r.code, r.status]).sort()).toEqual([
      ['HJO-T2-CNC', 'new'],
      ['HJO-T2-PDF', 'needs_manual'],
    ]);
    expect((await alerts()).length).toBe(alertsBefore);
  });

  it('a 401 page: run failed with auth rejected and the alert in the same tick', async () => {
    const alertsBefore = (await alerts()).length;
    await script({ responses: [{ status: 401, body: { error: 'Unauthorized' } }], default: { status: 500, body: { error: 'unscripted' } } });
    await cron(TICKS[1]);
    const run = await finalRun(SLOTS[1]);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('token_rejected');
    expect(run.output).toMatchObject({ auth: 'rejected', token_fp: fingerprint, http_status: 401, scanned: 0, alerts: ['token_rejected'] });
    const sent = (await alerts()).slice(alertsBefore);
    expect(sent).toHaveLength(1);
    expect(String(sent[0].body.text)).toMatch(/^Xometry partner API rejected the token \(HTTP 401\) at \d{2}:\d{2} UTC\. Scans are paused until XOMETRY_TOKEN changes\. /);
    expect(JSON.stringify(sent[0])).not.toContain(token);
    expect(JSON.stringify(run)).not.toContain(token);
  });

  it('the next slot with the same fingerprint: skipped token_rejected without a partner call', async () => {
    const before = (await partnerCalls()).length;
    const alertsBefore = (await alerts()).length;
    await cron(TICKS[2]);
    const run = await finalRun(SLOTS[2]);
    expect(run.status).toBe('skipped');
    expect(run.output).toMatchObject({ reason: 'token_rejected', auth: 'rejected', token_fp: fingerprint, alerts: [] });
    expect((await partnerCalls()).length).toBe(before);
    expect((await alerts()).length).toBe(alertsBefore);
  });
});
