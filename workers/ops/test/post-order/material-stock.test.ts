// RP-2 / P-2: MaterialStock with a fake Durable Object state and MemoryDb RPCs: concurrent reserve calls never
// hold more than the remaining stock, reserve is idempotent per order item, stock choice order, shortfall and
// not-stocked, commit and release, the daily expiry alarm (run row under agent post_order.stock and notice card while
// agent.post_order is on, outside PostOrderWorkflow's daily cap; with the flag off expired holds are still released,
// without a run or a card), the held-above-remaining check, and the CHECK list of stock_reservations.status.

import { describe, expect, it } from 'vitest';
import { checkDailyCap, openRun } from '../../src/agents/runs';
import { allocate, availability, MaterialStock, pickOrder, ALARM_INTERVAL_MS } from '../../src/do/material-stock';
import type { ReservationStatus } from '../../src/db/repos/stock';
import { mapMaterial, stockObjectName } from '../../src/db/repos/stock';
import type { OpsEnv } from '../../src/env';
import type { AgentEventV1 } from '../../src/queues/messages';
import { agentBindings, FakeClock, FakeQueue, type FakeKV } from '../helpers/agent-env';
import { checkList } from '../helpers/check-lists';
import { fakeNamespace, type FakeDurableObjectState } from '../helpers/fake-do';
import { MemoryDb } from '../helpers/memory-db';
import { opsEnv } from '../helpers/ops';

const TENANT = '00000000-0000-0000-0000-000000000001';
const MAT = '3a000000-0000-4000-8000-00000000000a';
const MAT_EMPTY = '3b000000-0000-4000-8000-00000000000b';
const ORDER = '4a000000-0000-4000-8000-00000000000a';
const SHEET_OLD = '5a000000-0000-4000-8000-000000000001';
const SHEET_NEW = '5a000000-0000-4000-8000-000000000002';
const REMNANT_BIG = '5a000000-0000-4000-8000-000000000003';
const REMNANT_SMALL = '5a000000-0000-4000-8000-000000000004';
const item = (n: number) => `6a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(o: { stock?: boolean; postOrder?: boolean } = {}) {
  const clock = new FakeClock(Date.UTC(2026, 9, 5, 9, 0, 0));
  const db = new MemoryDb({ clock: () => clock.now() });
  db.seed('materials', [
    { id: MAT, tenant_id: TENANT, name: 'Steel sheet', category: 'sheet_metal', grade: 'S235JR', thickness_mm: 2, base_unit: 'm2', is_active: true },
    { id: MAT_EMPTY, tenant_id: TENANT, name: 'Aluminium sheet', category: 'sheet_metal', grade: 'EN AW-5754', thickness_mm: 3, base_unit: 'm2', is_active: true },
  ]);
  if (o.stock !== false) {
    db.seed('stock_items', [
      // 1,000,000 mm2 each, received in this order.
      { id: SHEET_OLD, material_id: MAT, origin: 'purchased', width_mm: 1000, height_mm: 1000, created_at: '2026-09-01T00:00:00.000Z' },
      { id: SHEET_NEW, material_id: MAT, origin: 'purchased', width_mm: 1000, height_mm: 1000, created_at: '2026-09-15T00:00:00.000Z' },
      { id: REMNANT_BIG, material_id: MAT, origin: 'remnant', width_mm: 500, height_mm: 400, created_at: '2026-09-20T00:00:00.000Z' },
      { id: REMNANT_SMALL, material_id: MAT, origin: 'remnant', width_mm: 200, height_mm: 300, created_at: '2026-09-21T00:00:00.000Z' },
    ]);
  }
  db.seed('orders', [{ id: ORDER, title: 'PO-1', status: 'new', tenant_id: TENANT }]);
  db.seed('order_items', Array.from({ length: 12 }, (_, i) => ({ id: item(i + 1), order_id: ORDER, product_name: `Part ${i + 1}`, quantity: 1, tenant_id: TENANT })));
  const events = new FakeQueue<AgentEventV1>();
  const env = opsEnv({ ...agentBindings({ AGENT_EVENTS: events as unknown as OpsEnv['AGENT_EVENTS'] }) }) as OpsEnv;
  (env.FLAGS as unknown as FakeKV).setJson('agent.post_order', { enabled: o.postOrder !== false, value: { mode: 'assist' }, rev: 1 });
  const ns = fakeNamespace((state) => {
    const s = new MaterialStock(state as unknown as DurableObjectState, env);
    (s as unknown as { dbInstance: MemoryDb }).dbInstance = db;
    (s as unknown as { clock: () => Date }).clock = () => clock.now();
    return s;
  });
  const name = stockObjectName(TENANT, MAT);
  return { db, clock, env, events, stock: ns.instance(name) as MaterialStock, state: ns.state(name) as FakeDurableObjectState, ns };
}

const active = (db: MemoryDb) => db.rows('stock_reservations').filter((r) => r.status === 'held' || r.status === 'committed');
const heldArea = (db: MemoryDb, stockItem?: string) => active(db).filter((r) => !stockItem || r.stock_item_id === stockItem).reduce((s, r) => s + Number(r.area_mm2 ?? 0), 0);
const TOTAL_AREA = 1_000_000 + 1_000_000 + 200_000 + 60_000;

describe('MaterialStock.reserve', () => {
  it('takes remnants first (smallest first), then full sheets oldest first, splitting an area over items', async () => {
    const { stock, db } = setup();
    const r = await stock.reserve(item(1), { area_mm2: 1_500_000 });
    expect(r.status).toBe('held');
    const holds = r.status === 'held' ? r.holds : [];
    // (rows come back in the database's order; the amounts per stock item show the order of choice)
    expect(Object.fromEntries(holds.map((h) => [h.stock_item_id, h.area_mm2]))).toEqual({
      [REMNANT_SMALL]: 60_000,
      [REMNANT_BIG]: 200_000,
      [SHEET_OLD]: 1_000_000,
      [SHEET_NEW]: 240_000,
    });
    expect(holds.every((h) => h.expires_at === '2026-10-19T09:00:00.000Z')).toBe(true);
    expect(heldArea(db)).toBe(1_500_000);
    expect(db.rows('stock_reservations').every((row) => row.held_by === `${TENANT}:${MAT}`)).toBe(true);
    // the reserve transactions reference the order item; stock_items are not changed
    expect(db.rows('stock_transactions').every((t) => t.transaction_type === 'reserve' && t.reference_type === 'order_item' && t.reference_id === item(1))).toBe(true);
    expect(db.rows('stock_items').map((s) => s.remaining_area_mm2)).toEqual([1_000_000, 1_000_000, 200_000, 60_000]);
  });

  it('is idempotent per order item: a second call returns the same holds and writes nothing', async () => {
    const { stock, db } = setup();
    const first = await stock.reserve(item(1), { area_mm2: 100_000 });
    const writes = db.calls.filter((c) => c.method === 'rpc').length;
    const second = await stock.reserve(item(1), { area_mm2: 100_000 });
    expect(second.status).toBe('already_held');
    expect(second.status !== 'not_stocked' && second.holds).toEqual(first.status !== 'not_stocked' && first.holds);
    expect(db.calls.filter((c) => c.method === 'rpc').length).toBe(writes);
    // 60,000 from the small remnant and 40,000 from the big one, held once
    expect(active(db)).toHaveLength(2);
    expect(heldArea(db)).toBe(100_000);
  });

  it('concurrent reserve calls never hold more than the remaining area', async () => {
    const { stock, db } = setup();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => stock.reserve(item(i + 1), { area_mm2: 400_000 })));
    expect(heldArea(db)).toBeLessThanOrEqual(TOTAL_AREA);
    for (const id of [SHEET_OLD, SHEET_NEW, REMNANT_BIG, REMNANT_SMALL]) {
      const remaining = Number(db.rows('stock_items', ['id', 'eq', id])[0].remaining_area_mm2);
      expect(heldArea(db, id)).toBeLessThanOrEqual(remaining);
    }
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 'held')).toHaveLength(5);
    expect(statuses.slice(5).every((s) => s === 'shortfall')).toBe(true);
    // 5 x 400,000 held, the sixth gets the last 260,000, the rest nothing
    expect(heldArea(db)).toBe(TOTAL_AREA);
    const sixth = results[5];
    expect(sixth.status === 'shortfall' && sixth.missing).toEqual({ area_mm2: 140_000 });
    const seventh = results[6];
    expect(seventh.status === 'shortfall' && seventh.holds).toEqual([]);
  });

  it('a material without stock items is not stocked; a quantity need uses remaining_quantity', async () => {
    const { ns, db } = setup({ stock: false });
    const stock = ns.instance(stockObjectName(TENANT, MAT_EMPTY)) as MaterialStock;
    expect(await stock.reserve(item(1), { area_mm2: 10 })).toEqual({ status: 'not_stocked' });
    db.seed('stock_items', [{ id: '5b000000-0000-4000-8000-000000000001', material_id: MAT_EMPTY, origin: 'purchased', quantity: 5, created_at: '2026-09-01T00:00:00.000Z' }]);
    const r = await stock.reserve(item(2), { quantity: 3 });
    expect(r).toMatchObject({ status: 'held', holds: [{ stock_item_id: '5b000000-0000-4000-8000-000000000001', quantity: 3, area_mm2: null }] });
    expect(await stock.reserve(item(3), { quantity: 3 })).toMatchObject({ status: 'shortfall', missing: { quantity: 1 } });
  });

  it('refuses bad input before any database call', async () => {
    const { stock, db } = setup();
    await expect(stock.reserve('not-a-uuid', { area_mm2: 1 })).rejects.toThrow(/uuid/);
    await expect(stock.reserve(item(1), {})).rejects.toThrow(/need/);
    await expect(stock.reserve(item(1), { area_mm2: -5 })).rejects.toThrow(/need/);
    expect(db.calls).toHaveLength(0);
  });

  it('records the outcome per order item in its SQLite storage and arms the daily alarm', async () => {
    const { stock, state } = setup();
    await stock.reserve(item(1), { area_mm2: 1000 });
    const rows = state.storage.sql.exec<{ order_item_id: string; status: string }>('SELECT order_item_id, status FROM holds').toArray();
    expect(rows).toEqual([{ order_item_id: item(1), status: 'held' }]);
    expect(await state.storage.getAlarm()).toBe(Date.UTC(2026, 9, 5, 9, 0, 0) + ALARM_INTERVAL_MS);
  });
});

describe('MaterialStock.commit / release / check', () => {
  it('commit moves the holds to a nesting session; release frees them with an unreserve transaction', async () => {
    const { stock, db } = setup();
    const session = '7a000000-0000-4000-8000-00000000000a';
    db.seed('nesting_sessions', [{ id: session, material_id: MAT, tenant_id: TENANT }]);
    await stock.reserve(item(1), { area_mm2: 50_000 });
    await stock.commit(item(1), session);
    expect(db.rows('stock_reservations').map((r) => [r.status, r.nesting_session_id, r.expires_at])).toEqual([['committed', session, null]]);
    await stock.release(item(1), 'consumed');
    expect(db.rows('stock_reservations').map((r) => [r.status, r.release_reason])).toEqual([['released', 'consumed']]);
    expect(db.rows('stock_transactions').map((t) => t.transaction_type)).toEqual(['reserve', 'unreserve']);
    // released stock is free again
    expect((await stock.reserve(item(2), { area_mm2: TOTAL_AREA })).status).toBe('held');
  });

  it('check reports stock items held above their remaining stock (re-read on every call)', async () => {
    const { stock, db } = setup();
    await stock.reserve(item(1), { area_mm2: 60_000 });
    expect((await stock.check()).over_held).toEqual([]);
    // remaining stock goes down outside the agent (e.g. a manual consumption)
    const i = db.tables.stock_items.findIndex((s) => s.id === REMNANT_SMALL);
    db.tables.stock_items[i] = { ...db.tables.stock_items[i], remaining_area_mm2: 10_000 };
    const check = await stock.check();
    expect(check.over_held).toEqual([REMNANT_SMALL]);
    expect(check.items.find((x) => x.stock_item_id === REMNANT_SMALL)).toMatchObject({ remaining_area_mm2: 10_000, held_area_mm2: 60_000 });
  });

  it('check also covers a held stock item that is no longer available (used up or taken out of stock)', async () => {
    const { stock, db, clock, events } = setup();
    await stock.reserve(item(1), { area_mm2: 60_000 });
    // the held remnant is used up outside the agent: status changes and nothing remains
    const i = db.tables.stock_items.findIndex((s) => s.id === REMNANT_SMALL);
    db.tables.stock_items[i] = { ...db.tables.stock_items[i], status: 'depleted', remaining_area_mm2: 0 };
    const check = await stock.check();
    expect(check.over_held).toEqual([REMNANT_SMALL]);
    expect(check.items.find((x) => x.stock_item_id === REMNANT_SMALL)).toMatchObject({ remaining_area_mm2: 0, held_area_mm2: 60_000 });
    // the daily alarm reports it on a notice card too
    clock.advance(86_400_000);
    await stock.alarm();
    expect(db.rows('agent_runs')[0]).toMatchObject({ status: 'succeeded', output: { released: 0, over_held: 1 } });
    expect(events.sent).toHaveLength(1);
  });
});

describe('MaterialStock.alarm', () => {
  it('releases expired holds as expired, records one run, posts one notice card and re-arms while holds remain', async () => {
    const { stock, db, clock, events, state } = setup();
    await stock.reserve(item(1), { area_mm2: 10_000 });
    clock.advance(10 * 86_400_000);
    await stock.reserve(item(2), { area_mm2: 10_000 });
    clock.advance(5 * 86_400_000); // item 1 is 15 days old, item 2 is 5 days old
    await stock.alarm();
    const byItem = (id: string) => db.rows('stock_reservations').filter((r) => r.order_item_id === id).map((r) => [r.status, r.release_reason]);
    expect(byItem(item(1))).toEqual([['released', 'expired']]);
    expect(byItem(item(2))).toEqual([['held', null]]);
    const runs = db.rows('agent_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agent: 'post_order.stock', trigger: 'cron', status: 'succeeded', subject_type: 'material', subject_id: MAT, output: { released: 1, over_held: 0 } });
    expect(String(runs[0].idempotency_key)).toBe(`post_order.stock:${MAT}:${clock.now().toISOString().slice(0, 16)}`);
    expect(events.sent).toHaveLength(1);
    const msg = events.sent[0].body;
    expect(msg.type === 'card' && msg.card).toMatchObject({ kind: 'reorder', allowed_verbs: [], run_id: runs[0].id });
    expect(JSON.stringify(msg)).not.toMatch(/@/);
    expect(await state.storage.getAlarm()).toBe(clock.now().getTime() + ALARM_INTERVAL_MS);
  });

  it('agent.post_order off: expired holds are still released and the alarm re-armed, but no run is written and no card sent', async () => {
    const { stock, db, clock, events, state } = setup({ postOrder: false });
    await stock.reserve(item(1), { area_mm2: 10_000 });
    clock.advance(10 * 86_400_000);
    await stock.reserve(item(2), { area_mm2: 10_000 });
    clock.advance(5 * 86_400_000);
    await stock.alarm();
    expect(db.rows('stock_reservations').filter((r) => r.order_item_id === item(1)).map((r) => [r.status, r.release_reason])).toEqual([['released', 'expired']]);
    expect(db.rows('agent_runs')).toHaveLength(0);
    expect(events.sent).toHaveLength(0);
    expect(await state.storage.getAlarm()).toBe(clock.now().getTime() + ALARM_INTERVAL_MS);
  });

  it('stock notices are runs of their own agent key: they never count toward the daily run cap of PostOrderWorkflow', async () => {
    const { stock, db, clock } = setup();
    await stock.reserve(item(1), { area_mm2: 10_000 });
    clock.advance(15 * 86_400_000);
    await stock.alarm();
    expect(db.rows('agent_runs')).toHaveLength(1);
    // The first PostOrderWorkflow run of this UTC day, with agent.post_order max_runs_per_day 1, is within its cap.
    const order = await openRun(db, { agent: 'post_order', trigger: 'queue', idempotency_key: ORDER, tenant_id: TENANT });
    expect(order.created).toBe(true);
    const cap = await checkDailyCap(db, 'post_order', { enabled: true, mode: 'assist', value: { max_runs_per_day: 1 } }, clock.now());
    expect(cap).toEqual({ reached: false, first: false, cap: 1 });
    expect(db.rows('agent_runs').map((r) => r.agent)).toEqual(['post_order.stock', 'post_order']);
  });

  it('an alarm with nothing to do writes no run and no card, and is not re-armed without held holds', async () => {
    const { stock, db, events, state } = setup();
    await stock.alarm();
    expect(db.rows('agent_runs')).toHaveLength(0);
    expect(events.sent).toHaveLength(0);
    expect(await state.storage.getAlarm()).toBeNull();
  });
});

describe('pure helpers', () => {
  it('pickOrder and allocate', () => {
    const items = availability(
      [
        { id: 'b', material_id: MAT, status: 'available', origin: 'purchased', width_mm: null, height_mm: null, remaining_area_mm2: 100, remaining_quantity: null, created_at: '2026-01-02T00:00:00Z' },
        { id: 'a', material_id: MAT, status: 'available', origin: 'purchased', width_mm: null, height_mm: null, remaining_area_mm2: 100, remaining_quantity: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 'r', material_id: MAT, status: 'available', origin: 'remnant', width_mm: null, height_mm: null, remaining_area_mm2: 50, remaining_quantity: null, created_at: '2026-01-03T00:00:00Z' },
      ],
      // a hold without a stock item uses up free area first
      [{ id: 'h', order_item_id: 'x', order_id: 'o', material_id: MAT, stock_item_id: null, area_mm2: 30, quantity: null, status: 'held', expires_at: null, nesting_session_id: null, created_at: '' }],
    );
    expect(pickOrder(items.items).map((i) => i.id)).toEqual(['r', 'a', 'b']);
    expect(allocate(items.items, items.material_level, { area_mm2: 150 })).toEqual({ holds: [{ stock_item_id: 'r', area_mm2: 20 }, { stock_item_id: 'a', area_mm2: 100 }, { stock_item_id: 'b', area_mm2: 30 }], missing: {} });
    expect(allocate(items.items, items.material_level, { area_mm2: 500 }).missing).toEqual({ area_mm2: 280 });
  });

  it('mapMaterial: exact canonical grade and thickness within 0.05 mm, exactly one active row', () => {
    const rows = [
      { id: 'm1', tenant_id: TENANT, name: 'Steel', category: 'sheet_metal', grade: 'S235', thickness_mm: '2.00', base_unit: 'm2', is_active: true },
      { id: 'm2', tenant_id: TENANT, name: 'Steel', category: 'sheet_metal', grade: 'S235JR', thickness_mm: 3, base_unit: 'm2', is_active: true },
      { id: 'm3', tenant_id: TENANT, name: 'V2A', category: 'sheet_metal', grade: null, thickness_mm: 1.5, base_unit: 'm2', is_active: true },
      { id: 'm4', tenant_id: TENANT, name: 'Inox', category: 'sheet_metal', grade: '1.4301', thickness_mm: 1.5, base_unit: 'm2', is_active: true },
    ];
    expect(mapMaterial(rows, { grade: 'S235JR', thickness_mm: 2.04 })?.id).toBe('m1');
    expect(mapMaterial(rows, { grade: 'S235JR', thickness_mm: 2.06 })).toBeNull();
    // two rows of the same grade and thickness: not stocked
    expect(mapMaterial(rows, { grade: 'AISI 304', thickness_mm: 1.5 })).toBeNull();
    expect(mapMaterial(rows, { grade: null, thickness_mm: 1.5 })).toBeNull();
  });

  it('CHECK-LISTS: stock_reservations.status and release reasons equal the migration', () => {
    const statuses: ReservationStatus[] = ['held', 'committed', 'released'];
    expect([...statuses].sort()).toEqual([...checkList('stock_reservations_status_check')].sort());
  });
});
