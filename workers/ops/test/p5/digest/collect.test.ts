// O5: the weekly figures of the ops digest. The seeded rows and the hand-computed figures are the shared vectors
// (supabase/tests/phase5/vectors/digest.json) that the PGlite test also runs through scripts/phase5/parity.sql Q12b,
// so the e-mail and the owner's SQL spot check agree. Also: ISO-week windows, numeric rounding, paging.

import { describe, expect, it } from 'vitest';
import {
  collectAgents,
  collectMetrics,
  divRound,
  fixed,
  isFirstMondayOfMonth,
  isoWeekMonday,
  isoWeekOf,
  median,
  percent1,
  readAll,
  reportWindow,
  round1,
  toMicro,
  type DigestWindow,
} from '../../../src/digest/collect';
import { figureRows } from '../../../src/digest/render';
import { collectStuck } from '../../../src/digest/stuck';
import { MemoryDb } from '../../helpers/memory-db';
import { digestHarness, VECTORS } from './helpers';

const key = (r: { section: string; figure: string }) => `${r.section}\u0000${r.figure}`;
const byKey = (a: { section: string; figure: string }, b: { section: string; figure: string }) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

describe('digest window', () => {
  it('reports the ISO week before the week of the Monday it is sent', () => {
    expect(reportWindow(VECTORS.iso_week)).toEqual({ iso_week: VECTORS.iso_week, ...VECTORS.window });
    expect(reportWindow('2026-W01')).toEqual({ iso_week: '2026-W01', report_week: '2025-W52', start: '2025-12-22T00:00:00.000Z', end: '2025-12-29T00:00:00.000Z' });
    expect(reportWindow('2027-W01')).toEqual({ iso_week: '2027-W01', report_week: '2026-W53', start: '2026-12-28T00:00:00.000Z', end: '2027-01-04T00:00:00.000Z' });
  });

  it('refuses weeks that do not exist or are malformed', () => {
    for (const bad of ['2027-W53', '2026-W00', '2026-W54', '2026-42', '2026-W4', '', 'W42']) expect(reportWindow(bad), bad).toBeNull();
    expect(isoWeekMonday('2026-W53')?.toISOString()).toBe('2026-12-28T00:00:00.000Z');
  });

  it('isoWeekOf agrees with isoWeekMonday for every Monday of 2025-2028', () => {
    for (let t = Date.UTC(2024, 11, 30); t < Date.UTC(2029, 0, 1); t += 7 * 86_400_000) {
      const week = isoWeekOf(new Date(t));
      expect(isoWeekMonday(week)?.getTime(), week).toBe(t);
      expect(isoWeekOf(new Date(t + 6 * 86_400_000 + 86_399_000))).toBe(week);
    }
  });

  it('the purge runs on the first Monday of a month only', () => {
    expect(isFirstMondayOfMonth('2026-W41')).toBe(true); // Monday 2026-10-05
    expect(isFirstMondayOfMonth('2026-W42')).toBe(false); // Monday 2026-10-12
    expect(isFirstMondayOfMonth('2026-W45')).toBe(true); // Monday 2026-11-02
    expect(isFirstMondayOfMonth('2026-W44')).toBe(false); // Monday 2026-10-26
    expect(isFirstMondayOfMonth('2026-W99')).toBe(false);
  });
});

describe('numeric semantics', () => {
  it('sums exactly and rounds half away from zero, as numeric round()', () => {
    expect(toMicro('1240.305')).toBe(1_240_305_000n);
    expect(toMicro(0.0001)).toBe(100n);
    expect(toMicro('12.5000')).toBe(12_500_000n);
    expect(toMicro(null)).toBeNull();
    expect(toMicro('abc')).toBeNull();
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(-5n, 10n)).toBe(-1n);
    expect(divRound(4n, 10n)).toBe(0n);
    expect(fixed(124031n, 2)).toBe('1240.31');
    expect(fixed(-250n, 1)).toBe('-25.0');
    expect(fixed(5n, 2)).toBe('0.05');
    expect(percent1(1n, 3n)).toBe('33.3');
    expect(percent1(2n, 3n)).toBe('66.7');
    expect(percent1(1n, 0n)).toBeNull();
    expect(round1(2.25)).toBe('2.3');
    expect(round1(36)).toBe('36.0');
    expect(median([408, 10, 48, 24])).toBe(36);
    expect(median([5])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe('collectMetrics + collectStuck (shared vectors)', () => {
  it('every figure equals the hand-computed value of the vectors (and parity.sql Q12b)', async () => {
    const h = digestHarness();
    const w = reportWindow(VECTORS.iso_week)!;
    const metrics = await collectMetrics(h.db, w);
    const stuck = await collectStuck(h.db, w, new Date(VECTORS.now));
    const rows = figureRows(metrics, stuck);
    expect([...rows].sort(byKey)).toEqual([...VECTORS.expected_figures].sort(byKey));
  });

  it('window edges: a row at the start counts, a row at the end does not', async () => {
    const h = digestHarness();
    const w = reportWindow(VECTORS.iso_week)!;
    const m = await collectMetrics(h.db, w);
    expect(m.pipeline).toEqual({ rfqs: 3, by_source: { email: 2, web: 1 } });
    expect(m.collectors.leads).toBe(4);
    expect(m.collectors.tenders).toBe(3);
    expect(m.agents.runs).toBe(7);
    expect(m.quotes.outcomes).toEqual({ won: 1, lost: 1, expired: 1, counter_offer: 1 });
  });

  it('an empty week: zeros, n/a and no per-group rows', async () => {
    const db = new MemoryDb();
    const w = reportWindow(VECTORS.iso_week)!;
    const m = await collectMetrics(db, w);
    const s = await collectStuck(db, w, new Date(VECTORS.now));
    expect(m.quotes).toEqual({ sent: 0, outcomes: { won: 0, lost: 0, expired: 0, counter_offer: 0 }, win_rate_pct: null, median_hours_rfq_to_sent: null });
    expect(m.agents).toEqual({ total_usd: '0', runs: 0, by_agent: [] });
    expect(m.collectors.last_reddit_lead).toBeNull();
    const rows = figureRows(m, s).map((r) => `${r.section}|${r.figure}|${r.value}`);
    expect(rows).toContain('quotes|win rate % (won / (won + lost + expired))|n/a');
    expect(rows).toContain('agents|total usd|0');
    expect(rows).toContain('collectors|last reddit lead (before the week end)|none');
    expect(rows.filter((r) => r.startsWith('pipeline|'))).toEqual([]);
    expect(rows.filter((r) => r.startsWith('content|lag days '))).toHaveLength(13);
  });

  it('stuck: runs open longer than 48 h, oldest first, capped list with a full count', async () => {
    const h = digestHarness();
    const w = reportWindow(VECTORS.iso_week)!;
    for (let i = 0; i < 25; i++) {
      h.db.seed('agent_runs', [{ agent: 'growth.hn', trigger: 'cron', idempotency_key: `growth.hn:stale-${i}`, status: 'running', started_at: new Date(Date.UTC(2026, 8, 1, i)).toISOString() }]);
    }
    const s = await collectStuck(h.db, w, new Date(VECTORS.now));
    expect(s.stale_runs.count).toBe(27);
    expect(s.stale_runs.items).toHaveLength(20);
    expect(s.stale_runs.items[0].started_at).toBe('2026-09-01T00:00:00.000Z');
    expect(s.quotes_awaiting_approval.count).toBe(1);
    expect(s.queue_failures).toEqual({ 'content_daily.translate': 1 });
    expect(s.cad_failed).toBe(2);
  });
});

describe('paging', () => {
  it('reads more than 1,000 rows in id-keyed pages, each row once', async () => {
    const db = new MemoryDb();
    const rows = Array.from({ length: 2345 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      agent: i % 2 ? 'growth.reddit' : 'growth.hn',
      trigger: 'cron',
      idempotency_key: `k:${i}`,
      status: i % 10 === 0 ? 'failed' : 'succeeded',
      started_at: new Date(Date.UTC(2026, 9, 6) + i * 1000).toISOString(),
      cost_cents: '0.0100',
    }));
    db.seed('agent_runs', rows);
    const w: DigestWindow = reportWindow(VECTORS.iso_week)!;
    const all = await readAll(db, 'agent_runs', 'agent', [['started_at', 'gte', w.start]]);
    expect(all).toHaveLength(2345);
    expect(new Set(all.map((r) => r.id)).size).toBe(2345);
    expect(db.calls.filter((c) => c.method === 'select')).toHaveLength(3);
    const agents = await collectAgents(db, w);
    expect(agents.runs).toBe(2345);
    expect(agents.by_agent).toEqual([
      { agent: 'growth.hn', runs: 1173, failed: 235, skipped: 0, usd: '0.12' },
      { agent: 'growth.reddit', runs: 1172, failed: 0, skipped: 0, usd: '0.12' },
    ]);
    expect(agents.total_usd).toBe('0.23');
  });
});
