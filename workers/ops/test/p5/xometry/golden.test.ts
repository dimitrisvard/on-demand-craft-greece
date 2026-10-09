// Golden replay: every vector that scripts/xometry-golden/gen_golden.py recorded by running the real xometry-bot
// Python modules is replayed against the TypeScript port (388 assertion units, PHASE5_SPEC X-4), and the recorded
// SHA-256 of each Python source must still match the file in the repository (a Python change forces a
// regeneration).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractSpec, fileKind, findSecondaryOp, matchesAnyActivePreset, matchesPreset, pickQuoteFile } from '../../../src/xometry/filters';
import { dumpJobOffer, parseJobOffer, parseMoney, parseScanPage } from '../../../src/xometry/models';
import { buildRow, runComputePass, runScan } from '../../../src/xometry/pipeline';
import { addBusinessDays, compute, submitGuard, suggestedLeadtime, suggestedPrice } from '../../../src/xometry/pricing';
import { pyFixed, pyPercent0, pyRound } from '../../../src/xometry/pyfmt';
import { MemoryOfferStore } from '../../../src/xometry/store';
import { XometrySchemaError } from '../../../src/xometry/types';
import { comparableRow, FakeClient, loadGolden, makeOffer, offerOf, REPO_ROOT, type Json } from './helpers';

const G = loadGolden();

/** Assertion units per section (spec count 388). */
const UNITS: Record<string, number> = {
  add_business_days: 10,
  suggested_price: 15,
  py_round: 22,
  suggested_leadtime: 5,
  compute: 15,
  submit_guard: 6,
  filters: 216,
  matches_preset_custom: 4,
  file_kind: 25,
  pick_quote_file: 9,
  money: 10,
  job_offer: 33,
  scan_page: 5,
  build_row: 7,
  scan_scenarios: 5,
  compute_pass: 1,
};

function expectSchemaError(fn: () => unknown, locs: string[][]): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(XometrySchemaError);
  expect((caught as XometrySchemaError).locs).toEqual(locs);
}

function rowsOf(store: MemoryOfferStore): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const code of [...store.rows.keys()].sort()) out[code] = comparableRow(store.rows.get(code) as Json);
  return out;
}

function expectedRows(rows: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [code, row] of Object.entries(rows)) out[code] = comparableRow(row);
  return out;
}

function statsOf(s: { stopped: boolean } & Json): Json {
  const { stopped: _stopped, ...rest } = s;
  return rest;
}

describe('golden vectors of the Python bot (388 units)', () => {
  it('the file holds exactly the sections and unit counts of the spec', () => {
    const counts: Record<string, number> = {
      add_business_days: G.add_business_days.length,
      suggested_price: G.suggested_price.length,
      py_round: G.py_round.length,
      suggested_leadtime: G.suggested_leadtime.length,
      compute: G.compute.length,
      submit_guard: G.submit_guard.length,
      filters: G.filters.length * (1 + G.filters[0].find_secondary_op.length + 1),
      matches_preset_custom: G.matches_preset_custom.cases.length,
      file_kind: G.file_kind.length,
      pick_quote_file: G.pick_quote_file.length,
      money: G.money.length,
      job_offer: G.job_offer.length,
      scan_page: G.scan_page.length,
      build_row: G.build_row.length,
      scan_scenarios: G.scan_scenarios.length,
      compute_pass: G.compute_pass.length,
    };
    expect(counts).toEqual(UNITS);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(388);
    for (const c of G.filters) expect(c.find_secondary_op).toHaveLength(4);
  });

  it('the recorded Python sources are unchanged (regenerate golden.json after any change)', () => {
    const sources = G._meta.sources as Record<string, string>;
    expect(Object.keys(sources)).toEqual(expect.arrayContaining(['xometry_bot/models.py', 'xometry_bot/filters.py', 'xometry_bot/pricing.py', 'xometry_bot/pipeline.py', 'xometry_bot/config.py', 'xometry_bot/partner_client.py', 'xometry_bot/db.py', 'tests/fixtures.py', 'tests/fakes.py']));
    for (const [path, sha] of Object.entries(sources)) {
      const bytes = readFileSync(new URL(`xometry-bot/${path}`, REPO_ROOT));
      expect(createHash('sha256').update(bytes).digest('hex'), path).toBe(sha);
    }
    expect(G._meta.python).toBe('3.11');
  });

  it('add_business_days (10)', () => {
    for (const v of G.add_business_days) {
      const run = () => addBusinessDays(v.start, v.n, new Set(v.holidays as string[]));
      if ('ok' in v.result) expect(run(), JSON.stringify(v)).toBe(v.result.ok);
      else {
        expect(v.result.error).toBe('ValueError');
        expect(run).toThrow(new RangeError(v.result.message));
      }
    }
  });

  it('suggested_price (15)', () => {
    for (const v of G.suggested_price) expect(suggestedPrice(v.buyer, v.cost), JSON.stringify(v)).toBe(v.result);
  });

  it('py_round: round(x, 2), f"{x:.2f}", f"{x:.0%}" (22)', () => {
    for (const v of G.py_round) {
      expect(pyRound(v.x, 2), `round ${v.x}`).toBe(v.round2);
      expect(pyFixed(v.x, 2), `fixed ${v.x}`).toBe(v.fixed2);
      expect(pyPercent0(v.x), `pct ${v.x}`).toBe(v.fixed0pct);
    }
  });

  it('suggested_leadtime (5)', () => {
    for (const v of G.suggested_leadtime) expect(suggestedLeadtime(v.xo, { today: v.today }), JSON.stringify(v)).toBe(v.result);
  });

  it('compute (15)', () => {
    for (const v of G.compute) expect(compute(v.input), JSON.stringify(v.input)).toEqual(v.result);
  });

  it('submit_guard (6)', () => {
    for (const v of G.submit_guard) expect(submitGuard(v.input), JSON.stringify(v.input)).toEqual(v.result);
  });

  it('filters: preset, secondary op under 4 borderline settings, spec (36 payloads x 6 = 216)', () => {
    for (const c of G.filters) {
      const offer = parseJobOffer(structuredClone(c.offer));
      expect(matchesAnyActivePreset(offer), `${c.name} preset`).toBe(c.matches_any_active_preset);
      for (const f of c.find_secondary_op) {
        expect(findSecondaryOp(offer, { borderlineExclude: f.borderline_exclude }), `${c.name} ${JSON.stringify(f.borderline_exclude)}`).toEqual(f.hit);
      }
      expect(extractSpec(offer), `${c.name} spec`).toEqual(c.extract_spec);
    }
  });

  it('matches_preset with a custom include/exclude preset (4)', () => {
    const p = G.matches_preset_custom.preset;
    const preset = { name: 'custom', include: new Set<number>(p.include), exclude: new Set<number>(p.exclude) };
    const byName = new Map<string, Json>(G.filters.map((c: Json) => [c.name, c.offer]));
    for (const c of G.matches_preset_custom.cases) expect(matchesPreset(parseJobOffer(structuredClone(byName.get(c.offer))), preset), c.offer).toBe(c.result);
  });

  it('file_kind (25) and pick_quote_file (9)', () => {
    for (const v of G.file_kind) expect(fileKind(v.names), JSON.stringify(v.names)).toBe(v.result);
    for (const v of G.pick_quote_file) expect(pickQuoteFile(v.paths), JSON.stringify(v.paths)).toBe(v.result);
  });

  it('money (10)', () => {
    for (const v of G.money) {
      if ('ok' in v.result) expect(parseMoney(structuredClone(v.input)), v.name).toEqual(v.result.ok);
      else expectSchemaError(() => parseMoney(structuredClone(v.input)), v.result.locs);
    }
  });

  it('job_offer: lax coercion, aliases, dates and error locations (33)', () => {
    for (const v of G.job_offer) {
      if ('ok' in v.result) expect(dumpJobOffer(parseJobOffer(structuredClone(v.input))), v.name).toEqual(v.result.ok);
      else expectSchemaError(() => parseJobOffer(structuredClone(v.input)), v.result.locs);
    }
  });

  it('scan_page: all or nothing (5)', () => {
    for (const v of G.scan_page) {
      if ('ok' in v.result) {
        const page = parseScanPage(structuredClone(v.input));
        expect({ metadata: page.metadata, offers: page.offers.map(dumpJobOffer) }, v.name).toEqual(v.result.ok);
      } else expectSchemaError(() => parseScanPage(structuredClone(v.input)), v.result.locs);
    }
  });

  it('build_row (7)', () => {
    for (const v of G.build_row) {
      const offer = offerOf(structuredClone(v.offer));
      expect(buildRow(offer, extractSpec(offer)), v.name).toEqual(v.row);
    }
  });

  it('scan scenarios over the memory store: stats per step and final rows (5)', async () => {
    for (const sc of G.scan_scenarios) {
      const store = new MemoryOfferStore();
      const borderlineExclude: string[] = sc.settings?.borderline_exclude ?? [];
      for (const step of sc.steps) {
        for (const [code, fields] of Object.entries((step.set ?? {}) as Record<string, Json>)) Object.assign(store.rows.get(code) as Json, fields);
        const stats = await runScan(store, new FakeClient(structuredClone(step.offers)), { borderlineExclude });
        if (step.stats) expect(statsOf(stats as unknown as { stopped: boolean } & Json), sc.name).toEqual(step.stats);
        if (step.rows_after) expect(rowsOf(store), `${sc.name} rows after`).toEqual(expectedRows(step.rows_after));
      }
      expect(rowsOf(store), `${sc.name} final rows`).toEqual(expectedRows(sc.final_rows));
    }
  });

  it('compute pass over priced rows (1)', async () => {
    const c = G.compute_pass[0];
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-1'), makeOffer('HJO-2', { cost: { amount: 700.0, currency: 'EUR' } }), makeOffer('HJO-3', { cost: null }), makeOffer('HJO-4')]), { borderlineExclude: [] });
    await store.updateFields('HJO-1', { status: 'priced', buyer_price: 1000.0 });
    await store.updateFields('HJO-2', { status: 'priced', buyer_price: 1000.0 });
    await store.updateFields('HJO-3', { status: 'priced', buyer_price: 500.0 });
    await store.updateFields('HJO-4', { status: 'new', buyer_price: 1000.0 });
    expect(await runComputePass(store, c.today)).toBe(c.computed);
    expect(rowsOf(store)).toEqual(expectedRows(c.final_rows));
  });
});
