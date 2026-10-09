// PostgrestOfferStore: the exact PostgREST requests of the three-step upsert (PHASE5_SPEC X-1), the whitelist and
// updated_at rules, and the same final rows as the Python fake for every golden scan scenario when it runs over the
// in-memory PostgREST (P5MemoryDb: unique key code, ignore-duplicates semantics).

import { describe, expect, it } from 'vitest';
import { PostgrestDb } from '../../../src/db/postgrest';
import { P5MemoryDb } from '../../../src/ports/p5-stub/index';
import { extractSpec } from '../../../src/xometry/filters';
import { buildRow, runScan } from '../../../src/xometry/pipeline';
import { DryRunOfferStore, INSERT_COLS, NON_TERMINAL_STATUSES, PostgrestOfferStore, REFRESH_COLS } from '../../../src/xometry/store';
import { FakeClock } from '../../helpers/agent-env';
import { comparableRow, FakeClient, loadGolden, makeOffer, offerOf, type Json } from './helpers';

const SUPABASE = 'https://db.example.test';
const T = Date.UTC(2026, 9, 8, 6, 0, 5);

interface Req {
  method: string;
  url: string;
  prefer: string | null;
  body: unknown;
}

function recordingDb(answers: unknown[][]): { db: PostgrestDb; reqs: Req[] } {
  const reqs: Req[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    reqs.push({ method: String(init?.method), url: String(input), prefer: headers.get('prefer'), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(answers.shift() ?? []);
  }) as typeof fetch;
  // A service-role-shaped value is never needed here: the store only sees the Db port.
  return { db: new PostgrestDb({ url: SUPABASE, serviceRoleKey: ['t1', 'service', 'value'].join('-'), fetch: fetchImpl }), reqs };
}

const row = () => {
  const offer = offerOf(makeOffer('HJO-1'));
  return buildRow(offer, extractSpec(offer));
};

const base = `${SUPABASE}/rest/v1/xometry_offers`;
const notTerminal = `in.(${NON_TERMINAL_STATUSES.map((s) => `"${s}"`).join(',')})`;

describe('PostgrestOfferStore requests', () => {
  it('new code: one POST with on_conflict=code, ignore-duplicates, the 30 insert columns; counted as inserted', async () => {
    const { db, reqs } = recordingDb([[{ code: 'HJO-1', status: 'new' }]]);
    const store = new PostgrestOfferStore(db, new FakeClock(T));
    expect(await store.upsertOffer(row())).toBe('new');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].url).toBe(`${base}?${new URLSearchParams({ select: 'code,status', on_conflict: 'code' })}`);
    expect(reqs[0].prefer).toBe('resolution=ignore-duplicates,return=representation');
    expect(Object.keys(reqs[0].body as Json)).toEqual([...INSERT_COLS]);
    expect(INSERT_COLS).toHaveLength(30);
    expect(store.insertedCount).toBe(1);
  });

  it('seen code: PATCH of the 7 refresh columns + updated_at, filtered to non-terminal statuses', async () => {
    const { db, reqs } = recordingDb([[], [{ status: 'priced' }]]);
    const store = new PostgrestOfferStore(db, new FakeClock(T));
    expect(await store.upsertOffer(row())).toBe('priced');
    expect(reqs.map((r) => r.method)).toEqual(['POST', 'PATCH']);
    const url = new URL(reqs[1].url);
    expect(url.pathname).toBe('/rest/v1/xometry_offers');
    expect(url.searchParams.get('code')).toBe('eq.HJO-1');
    expect(url.searchParams.get('status')).toBe(notTerminal);
    expect(url.searchParams.get('select')).toBe('status');
    expect(reqs[1].prefer).toBe('return=representation');
    expect(Object.keys(reqs[1].body as Json)).toEqual([...REFRESH_COLS, 'updated_at']);
    expect((reqs[1].body as Json).updated_at).toBe(new Date(T).toISOString());
    expect(store.insertedCount).toBe(0);
    expect(NON_TERMINAL_STATUSES).not.toContain('submitted');
    expect(NON_TERMINAL_STATUSES).not.toContain('skipped');
  });

  it('terminal row: a GET reports its status untouched; no row at all reports the built status', async () => {
    const a = recordingDb([[], [], [{ status: 'submitted' }]]);
    expect(await new PostgrestOfferStore(a.db, new FakeClock(T)).upsertOffer(row())).toBe('submitted');
    expect(a.reqs.map((r) => r.method)).toEqual(['POST', 'PATCH', 'GET']);
    expect(a.reqs[2].url).toBe(`${base}?${new URLSearchParams({ select: 'status', code: 'eq.HJO-1', limit: '1' })}`);
    const b = recordingDb([[], [], []]);
    expect(await new PostgrestOfferStore(b.db, new FakeClock(T)).upsertOffer(row())).toBe('new');
  });

  it('updateFields: whitelist enforced before any request; updated_at added; listByStatus order', async () => {
    const { db, reqs } = recordingDb([[], []]);
    const store = new PostgrestOfferStore(db, new FakeClock(T));
    await expect(store.updateFields('HJO-1', { partner_cost: 1, raw: {} })).rejects.toThrow("refusing to update non-whitelisted columns: ['partner_cost', 'raw']");
    expect(reqs).toHaveLength(0);
    await store.updateFields('HJO-1', {});
    expect(reqs).toHaveLength(0);
    await store.updateFields('HJO-1', { status: 'ready', suggested_price: 805 });
    expect(reqs[0].method).toBe('PATCH');
    expect(new URL(reqs[0].url).searchParams.get('code')).toBe('eq.HJO-1');
    expect(reqs[0].body).toEqual({ status: 'ready', suggested_price: 805, updated_at: new Date(T).toISOString() });
    await store.listByStatus(['priced']);
    const list = new URL(reqs[1].url);
    expect(list.searchParams.get('status')).toBe('in.("priced")');
    expect(list.searchParams.get('order')).toBe('publication_end.asc,code.asc');
  });
});

describe('PostgrestOfferStore over the in-memory PostgREST equals the Python fake on every golden scenario', () => {
  const columns = [...INSERT_COLS];
  const project = (r: Json) => comparableRow(Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));

  it('final rows of S1-S5 match the golden rows column by column', async () => {
    for (const sc of loadGolden().scan_scenarios) {
      const db = new P5MemoryDb({ clock: () => new Date(T) });
      const store = new PostgrestOfferStore(db, new FakeClock(T));
      for (const step of sc.steps) {
        for (const [code, fields] of Object.entries((step.set ?? {}) as Record<string, Json>)) await db.update('xometry_offers', fields, { filters: [['code', 'eq', code]] });
        const stats = await runScan(store, new FakeClient(structuredClone(step.offers)), { borderlineExclude: sc.settings?.borderline_exclude ?? [] });
        expect(stats.errors, sc.name).toEqual([]);
      }
      const rows = Object.fromEntries(db.rows('xometry_offers').map((r) => [String(r.code), project(r)]));
      const expected = Object.fromEntries(Object.entries(sc.final_rows as Record<string, Json>).map(([k, r]) => [k, project(r)]));
      expect(rows, sc.name).toEqual(expected);
    }
  });

  it('a refresh sets updated_at; a terminal row keeps it', async () => {
    const db = new P5MemoryDb({ clock: () => new Date(Date.UTC(2026, 0, 1)) });
    const store = new PostgrestOfferStore(db, new FakeClock(T));
    await runScan(store, new FakeClient([makeOffer('A'), makeOffer('B')]), { borderlineExclude: [] });
    await db.update('xometry_offers', { status: 'submitted' }, { filters: [['code', 'eq', 'B']] });
    const before = db.rows('xometry_offers', ['code', 'eq', 'B'])[0].updated_at;
    await runScan(store, new FakeClient([makeOffer('A'), makeOffer('B')]), { borderlineExclude: [] });
    expect(db.rows('xometry_offers', ['code', 'eq', 'A'])[0].updated_at).toBe(new Date(T).toISOString());
    expect(db.rows('xometry_offers', ['code', 'eq', 'B'])[0].updated_at).toBe(before);
  });
});

describe('DryRunOfferStore (shadow)', () => {
  it('records what would be written and never needs a database', async () => {
    const store = new DryRunOfferStore();
    await runScan(store, new FakeClient([makeOffer('A'), makeOffer('B', { parts: [] })]), { borderlineExclude: [] });
    expect(store.writes.map((w) => [w.op, w.code, w.status])).toEqual([['upsert', 'A', 'new']]);
    expect(store.insertedCount).toBe(1);
  });
});
