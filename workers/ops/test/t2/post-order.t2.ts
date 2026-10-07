// RP-3 / P-4: the post-order path in real workerd, on its own harness instance (profile 'agents', site primary) so
// the 10-minute dispatcher acts on this file's rows only:
//   - the synthetic order of test/post-order/seed-data.ts in the mini-PostgREST (a quoted RFQ with a sheet-metal
//     bracket and its succeeded CAD job, two partners, one stock sheet), agent.post_order on (assist)
//   - the dispatcher fired through the Local Explorer (POST /local/scheduled?worker=microns-ops, cron '*/10 * * * *')
//     -> agent-events 'order-created' (portal) -> 'post-order-<order_id>' -> traveller notes from the committed
//     fixture (test/fixtures/llm/post_order.traveller_notes@v1) -> traveller PDF in R2 -> MaterialStock hold (Durable
//     Object + rpc/stock_hold) -> hand-off card at the Telegram stub (send / hold buttons, no address)
//   - the dashboard's decision: claim of the card, then 'handoff-approved' through the Local Explorer -> the Resend
//     stub receives exactly one partner mail (Idempotency-Key order/<order_id>/handoff); orders.partner_id set; the
//     run succeeded with its cost
//   - a second dispatcher tick sends nothing more (the order has its run)
// The stub client of the harness is loaded at run time by file URL.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedRows, INSTANCE, MATERIAL, ORDER, PARTNER_CNC, PARTNER_CNC_EMAIL, STAFF, TENANT, ITEM_BRACKET } from '../post-order/seed-data';
import { r2Get, r2Put, resendEmails, rows, rpc, seed, sendEvent, setFlag, telegramCalls, until, type Row, type Urls } from '../quote/t2-helpers';

const ENABLED = Boolean(process.env.T2_STUB_URL) && process.env.T2_PROFILE === 'agents';

async function cron(u: Urls, expression: string): Promise<void> {
  const res = await fetch(`${u.explorer}/local/scheduled?worker=microns-ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cron: expression }) });
  if (!res.ok) throw new Error(`scheduled: ${res.status} ${await res.text()}`);
}

describe.skipIf(!ENABLED)('post-order in workerd (P-4, own harness instance)', () => {
  let own: (Urls & { stop: () => Promise<void> }) | null = null;
  let registry = '';
  const u = (): Urls => own as Urls;
  const run = async (): Promise<Row | undefined> => (await rows(u(), 'agent_runs')).find((r) => r.agent === 'post_order' && r.idempotency_key === ORDER);

  beforeAll(async () => {
    const harness = (await import(/* @vite-ignore */ new URL('../../../site/test/integration/harness.mjs', import.meta.url).href)) as {
      startHarness(o: Record<string, unknown>): Promise<{ url: string; stub: { url: string }; explorer: string; tmp: string; approvalSecret: string; stop: () => Promise<void> }>;
    };
    // The instance gets its own wrangler dev registry: the Local Explorer resolves ?worker=<name> through that
    // registry, which every wrangler session of the machine shares by default, so a cron sent to this instance's
    // Explorer would otherwise run in the microns-ops of the global harness instance.
    registry = mkdtempSync(path.join(os.tmpdir(), 'microns-t2-registry-'));
    const previous = process.env.WRANGLER_REGISTRY_PATH;
    process.env.WRANGLER_REGISTRY_PATH = registry;
    let h: Awaited<ReturnType<typeof harness.startHarness>>;
    try {
      h = await harness.startHarness({ profile: 'agents', publish: false, quiet: true });
    } finally {
      if (previous === undefined) delete process.env.WRANGLER_REGISTRY_PATH;
      else process.env.WRANGLER_REGISTRY_PATH = previous;
    }
    own = { site: h.url, stub: h.stub.url, explorer: h.explorer, tmp: h.tmp, approvalSecret: h.approvalSecret, stop: h.stop };
    const { tables, objects } = seedRows();
    // low_stock_alerts is a live inventory table outside the mini-PostgREST's default list: an empty seed creates it
    await seed(u(), { ...tables, low_stock_alerts: tables.low_stock_alerts ?? [] });
    for (const [key, text] of Object.entries(objects)) await r2Put(u(), key, new TextEncoder().encode(text));
    await setFlag(u(), 'agent.post_order', { enabled: true, value: { mode: 'assist' }, rev: 31 });
    await setFlag(u(), 'agent.quote', { enabled: false, rev: 32 });
    await setFlag(u(), 'agent.rfq_intake', { enabled: false, rev: 33 });
  }, 240_000);

  afterAll(async () => {
    await own?.stop();
    if (registry) rmSync(registry, { recursive: true, force: true });
  });

  it('dispatcher -> order-created -> traveller, stock hold, hand-off card -> handoff-approved -> one partner mail', async () => {
    // The dispatcher sends 'order-created' again on every tick while the order has no post-order run (the safety net
    // for a lost queue message); the test repeats its tick the same way when a local server reload (wrangler dev
    // reloads when a watched source file changes) dropped the message before the consumer ran.
    for (let tick = 1; ; tick++) {
      await cron(u(), '*/10 * * * *');
      const started = await until('the post-order run', async () => ((await run()) ? true : null), 20_000).catch(() => false);
      if (started) break;
      if (tick >= 5) throw new Error('no post-order run after 5 dispatcher ticks');
    }

    const waiting = await until('the post-order run waiting on its hand-off card', async () => {
      const r = await run();
      const kind = (r?.output as Row | undefined)?.card_kind;
      if (r && ['failed', 'cancelled', 'succeeded'].includes(String(r.status))) throw new Error(`post-order run ${String(r.status)}: ${String(r.error)}`);
      if (r && r.status === 'waiting_human' && kind === 'failure') throw new Error(`post-order run on a failure card: ${String(r.error)} at ${String((r.output as Row).failed_step)}`);
      return r && r.status === 'waiting_human' && kind === 'handoff' && r.approval_token_sha256 ? r : null;
    }, 120_000);
    expect(waiting).toMatchObject({ workflow_instance_id: INSTANCE, trigger: 'queue', llm_calls: 1 });

    // traveller in R2, one hold for the bracket (200 x 150 mm blank x 10)
    const pdf = await r2Get(u(), `orders/${ORDER}/traveler.pdf`);
    expect(pdf && Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const holds = (await rows(u(), 'stock_reservations')).filter((r) => r.order_id === ORDER);
    expect(holds).toEqual([expect.objectContaining({ order_item_id: ITEM_BRACKET, material_id: MATERIAL, area_mm2: 300000, status: 'held', held_by: `${TENANT}:${MATERIAL}` })]);

    // the hand-off card at the Telegram stub: send / hold buttons, no address
    const cards = (await telegramCalls(u())).filter((c) => c.method === 'sendMessage' && String(c.body.text ?? '').includes('Hand-off PO-1001'));
    expect(cards).toHaveLength(1);
    expect(String(cards[0].body.text)).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]/);
    const buttons = ((cards[0].body.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> }).inline_keyboard ?? []).flat();
    expect(buttons.filter((b) => b.callback_data).map((b) => b.callback_data?.replace(/^ap:[A-Z2-7]{26}:/, ''))).toEqual(['sp', 'hold']);

    // the dashboard's decision: claim, then the event
    const claimed = (await rpc(u(), 'agent_run_claim_approval', { p_token_sha256: waiting.approval_token_sha256, p_human_action: { channel: 'dashboard', actor: STAFF, verb: 'send_partner' } })) as Row[];
    expect(claimed).toHaveLength(1);
    await sendEvent(u(), 'post-order', INSTANCE, 'handoff-approved', { verb: 'send_partner', actor: STAFF, channel: 'dashboard' });

    const [mail] = await until('the partner mail', async () => {
      const list = (await resendEmails(u())).filter((m) => m.idempotency_key === `order/${ORDER}/handoff`);
      return list.length ? list : null;
    }, 60_000);
    expect(mail).toMatchObject({ to: [PARTNER_CNC_EMAIL], subject: 'Production order PO-1001', reply_to: null, attachments: [] });
    expect(String(mail.from)).toContain('info@micronshub.eu');

    const closed = await until('the post-order run succeeded', async () => {
      const r = await run();
      return r && r.status === 'succeeded' ? r : null;
    }, 60_000);
    expect(closed).toMatchObject({ approval_token_sha256: null, llm_calls: 1, output: expect.objectContaining({ handoff: 'sent', partner_id: PARTNER_CNC }) });
    expect(Number(closed.cost_cents)).toBeGreaterThan(0);
    expect((await rows(u(), 'orders')).find((o) => o.id === ORDER)?.partner_id).toBe(PARTNER_CNC);

    // a second tick: the order has its run, nothing more is sent
    await cron(u(), '*/10 * * * *');
    await new Promise((r) => setTimeout(r, 1500));
    expect((await resendEmails(u())).filter((m) => m.idempotency_key === `order/${ORDER}/handoff`)).toHaveLength(1);
    expect((await rows(u(), 'agent_runs')).filter((r) => r.agent === 'post_order' && r.idempotency_key === ORDER)).toHaveLength(1);
  });
});
