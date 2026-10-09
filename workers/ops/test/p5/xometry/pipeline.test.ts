// Port of xometry-bot/tests/test_pipeline.py: 9 of 13 test functions against MemoryOfferStore (the port of
// tests/fakes.py FakeStore); titles keep the Python names. Downloads are never made by the Worker, so the download
// assertions become "nothing is downloaded"; test_one_bad_offer_does_not_kill_run is adapted to a store failure on
// one offer. The four TestPricingPass tests are not applicable (Playwright buyer pricing is not ported,
// port-map.test.ts).

import { describe, expect, it } from 'vitest';
import { runComputePass, runScan } from '../../../src/xometry/pipeline';
import { MemoryOfferStore, type OfferStore } from '../../../src/xometry/store';
import type { OfferRow } from '../../../src/xometry/types';
import { ANODIZING_TAG, FakeClient, GRINDING_TAG, LASER_TAG, makeOffer, makePart, MILLING_TAG, PDF_FILE } from './helpers';

const TODAY = '2026-06-11';
const settings = (borderlineExclude: string[] = []) => ({ borderlineExclude });

describe('TestRunScan', () => {
  it('test_keeps_milonk_drops_laser_stores_excluded', async () => {
    const store = new MemoryOfferStore();
    const client = new FakeClient([
      makeOffer('HJO-CNC'),
      makeOffer('HJO-LASER', { parts: [makePart({ tags: [LASER_TAG] })] }),
      makeOffer('HJO-COATED', { parts: [makePart({ tags: [MILLING_TAG, ANODIZING_TAG] })] }),
    ]);
    const stats = await runScan(store, client, settings());
    expect(stats.scanned).toBe(3);
    expect(stats.preset_rejected).toBe(1);
    expect(stats.excluded_secondary).toBe(1);
    expect([...store.rows.keys()].sort()).toEqual(['HJO-CNC', 'HJO-COATED']);
    const kept = store.rows.get('HJO-CNC') as Record<string, unknown>;
    expect(kept.status).toBe('new');
    expect(kept.partner_cost).toBe(100.0);
    expect(kept.tolerance).toBe('ISO 2768: medium (mK)');
    expect(kept.roughness).toBe('Ra: 3.2 (Standard)');
    expect(kept.local_files).toEqual([]); // adapted: the Worker never downloads
    expect((kept.raw as Record<string, unknown>).code).toBe('HJO-CNC');
    const excluded = store.rows.get('HJO-COATED') as Record<string, unknown>;
    expect(excluded.status).toBe('excluded_secondary_ops');
    expect(excluded.excluded_reason).toBe('Anodizing type II');
  });

  it('test_pdf_only_goes_needs_manual', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-PDF', { parts: [makePart({ files: [PDF_FILE] })] })]), settings());
    const row = store.rows.get('HJO-PDF') as Record<string, unknown>;
    expect(row.status).toBe('needs_manual');
    expect(row.flags).toContain('files:manual');
  });

  it('test_rescan_is_idempotent_and_refreshes', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-1')]), settings());
    expect(store.rows.get('HJO-1')?.partner_cost).toBe(100.0);
    (store.rows.get('HJO-1') as Record<string, unknown>).status = 'priced';
    await runScan(store, new FakeClient([makeOffer('HJO-1', { cost: { amount: 110.0, currency: 'EUR' } })]), settings());
    expect(store.rows.size).toBe(1);
    expect(store.rows.get('HJO-1')?.partner_cost).toBe(110.0);
    expect(store.rows.get('HJO-1')?.status).toBe('priced');
    expect(store.insertedCount).toBe(1);
  });

  it('test_terminal_rows_never_touched', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-1')]), settings());
    (store.rows.get('HJO-1') as Record<string, unknown>).status = 'submitted';
    await runScan(store, new FakeClient([makeOffer('HJO-1', { cost: { amount: 999.0, currency: 'EUR' } })]), settings());
    expect(store.rows.get('HJO-1')?.status).toBe('submitted');
    expect(store.rows.get('HJO-1')?.partner_cost).toBe(100.0);
  });

  it('test_borderline_exclude_flips', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-G', { parts: [makePart({ tags: [MILLING_TAG, GRINDING_TAG] })] })]), settings(['grinding']));
    expect(store.rows.get('HJO-G')?.status).toBe('excluded_secondary_ops');
    expect(store.rows.get('HJO-G')?.excluded_reason).toBe('Grinding flat');
  });

  it('test_download_files_disabled_skips_local_copies', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-CNC')]), settings());
    expect(store.rows.get('HJO-CNC')?.status).toBe('new');
    expect(store.rows.get('HJO-CNC')?.local_files).toEqual([]);
  });

  it('test_one_bad_offer_does_not_kill_run (adapted: a store failure on one offer)', async () => {
    const memory = new MemoryOfferStore();
    const store: OfferStore = {
      get insertedCount() {
        return memory.insertedCount;
      },
      upsertOffer: async (row: OfferRow) => {
        if (row.code === 'HJO-BAD') throw new Error('postgrest POST xometry_offers: 500');
        return memory.upsertOffer(row);
      },
      get: (code) => memory.get(code),
      listByStatus: (s) => memory.listByStatus(s),
      updateFields: (code, f) => memory.updateFields(code, f),
    };
    const stats = await runScan(store, new FakeClient([makeOffer('HJO-BAD'), makeOffer('HJO-OK')]), settings());
    expect(memory.rows.has('HJO-OK')).toBe(true);
    expect(stats.errors).toEqual(['HJO-BAD: postgrest POST xometry_offers: 500']);
    expect(stats.scanned).toBe(2);
    expect(stats.upserted).toBe(1);
  });
});

describe('TestComputePass', () => {
  it('test_priced_becomes_ready', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-1')]), settings());
    await store.updateFields('HJO-1', { status: 'priced', buyer_price: 1000.0 });
    expect(await runComputePass(store, TODAY)).toBe(1);
    const row = store.rows.get('HJO-1') as Record<string, unknown>;
    expect(row.status).toBe('needs_review');
    expect(row.suggested_price).toBe(800.0);
    expect(row.suggested_leadtime).toBe('2026-06-25');
  });

  it('test_plausible_ratio_ready', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-2', { cost: { amount: 700.0, currency: 'EUR' } })]), settings());
    await store.updateFields('HJO-2', { status: 'priced', buyer_price: 1000.0 });
    await runComputePass(store, TODAY);
    const row = store.rows.get('HJO-2') as Record<string, unknown>;
    expect(row.status).toBe('ready');
    expect(row.suggested_price).toBe(805.0);
  });
});

describe('budget stop of the TypeScript scan', () => {
  it('shouldStop() ends the scan before the next offer and marks it stopped; the compute pass honours it too', async () => {
    const store = new MemoryOfferStore();
    let calls = 0;
    const stats = await runScan(store, new FakeClient([makeOffer('A'), makeOffer('B'), makeOffer('C')]), { borderlineExclude: [], shouldStop: () => ++calls > 2 });
    expect(stats.scanned).toBe(2);
    expect(stats.stopped).toBe(true);
    expect([...store.rows.keys()]).toEqual(['A', 'B']);
    await store.updateFields('A', { status: 'priced', buyer_price: 10 });
    expect(await runComputePass(store, TODAY, { shouldStop: () => true })).toBe(0);
  });

  it('numeric columns read back as strings (PostgREST numeric) are converted like float()', async () => {
    const store = new MemoryOfferStore();
    await runScan(store, new FakeClient([makeOffer('HJO-2', { cost: { amount: 700.0, currency: 'EUR' } })]), settings());
    await store.updateFields('HJO-2', { status: 'priced', buyer_price: '1000' });
    (store.rows.get('HJO-2') as Record<string, unknown>).partner_cost = '700';
    await runComputePass(store, TODAY);
    expect(store.rows.get('HJO-2')?.status).toBe('ready');
    expect(store.rows.get('HJO-2')?.suggested_price).toBe(805.0);
  });
});
