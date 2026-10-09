// Test helpers of the Xometry port: the synthetic gshJobOffers payloads of xometry-bot/tests/fixtures.py, the fake
// client of tests/fakes.py, and the golden vectors produced by scripts/xometry-golden/gen_golden.py.

import { readFileSync } from 'node:fs';
import { parseJobOffer } from '../../../src/xometry/models';
import type { OfferSource } from '../../../src/xometry/pipeline';
import type { JobOffer } from '../../../src/xometry/types';

export type Json = Record<string, unknown>;

/** Repository root (workers/ops/test/p5/xometry -> five levels up). */
export const REPO_ROOT = new URL('../../../../../', import.meta.url);

export const MILLING_TAG = { id: 14, name: 'Milling', context: 'production_methods' };
export const TURNING_TAG = { id: 10, name: 'Turning', context: 'production_methods' };
export const LASER_TAG = { id: 36, name: 'Laser Cutting', context: 'production_methods' };
export const ANODIZING_TAG = { id: 86, name: 'Anodizing type II', context: 'production_method_features' };
export const POWDER_TAG = { id: 104, name: 'Powder coating', context: 'production_method_features' };
export const TOLERANCE_TAG = { id: 500, name: 'ISO 2768: medium (mK)', context: 'production_method_features' };
export const RA_TAG = { id: 501, name: 'Ra: 3.2 (Standard)', context: 'production_method_features' };
export const GRINDING_TAG = { id: 184, name: 'Grinding flat', context: 'production_method_features' };
export const HEAT_TAG = { id: 102, name: 'Heat treatment', context: 'production_method_features' };
export const MATERIAL_TAG = { id: 700, name: 'Stainless Steel', context: 'materials' };
export const THREAD_RISK_TAG = { id: 600, name: 'Threads at risk', context: 'production_risks' };

export const STEP_FILE = { id: 1, name: 'bracket.step', downloadUrl: 'https://files.example/bracket.step', preview: null, largeUrl: null };
export const PDF_FILE = { id: 2, name: 'drawing.pdf', downloadUrl: 'https://files.example/drawing.pdf', preview: null, largeUrl: null };

export function makePart(over: Json = {}): Json {
  return {
    code: 'P-1',
    name: 'Bracket',
    material: 'Stainless Steel 316L / 1.4404',
    processType: 'cnc_milling',
    quantity: 2,
    dimensions: '290.0x290.0x125.0',
    weightKg: 1.2,
    volumeMm3: 152000.0,
    finish: '',
    productionRemark: null,
    measurementProtocolNeeded: false,
    samplesNeeded: false,
    tags: [MILLING_TAG, TOLERANCE_TAG, RA_TAG],
    files: [STEP_FILE],
    ...over,
  };
}

export function makeOffer(code = 'HJO-21991-684', over: Json = {}): Json {
  return {
    id: 684001,
    code,
    allowAutoaccept: false,
    allowCounterofferFrom: 80.0,
    cost: { amount: 100.0, currency: 'EUR' },
    leadtime: '2026-06-18',
    isUrgent: false,
    jobId: 21991,
    job: { publicComment: null, jobState: 'published' },
    parts: [makePart()],
    publicationStart: '2026-06-10T08:00:00Z',
    publicationEnd: '2026-06-14T10:00:00Z',
    ...over,
  };
}

export function gqlPage(offers: Json[], o: { hasMore?: boolean; offset?: number } = {}): Json {
  return { data: { gshJobOffers: { metadata: { hasMore: o.hasMore ?? false, limit: 20, offset: o.offset ?? 0, totalCount: offers.length }, offers } } };
}

/** An offer parsed like JobOffer.model_validate(payload) with raw = payload (tests/fakes.py FakeClient). */
export function offerOf(payload: Json): JobOffer {
  const offer = parseJobOffer(structuredClone(payload));
  offer.raw = payload;
  return offer;
}

/** Port of tests/fakes.py FakeClient (scan only; the Worker never downloads). */
export class FakeClient implements OfferSource {
  constructor(private readonly payloads: Json[]) {}
  async *scan(): AsyncGenerator<JobOffer> {
    for (const payload of this.payloads) yield offerOf(payload);
  }
}

export type Golden = Record<string, any>;

let golden: Golden | undefined;

/** test/fixtures/xometry/golden.json (parsed once). */
export function loadGolden(): Golden {
  golden ??= JSON.parse(readFileSync(new URL('../../fixtures/xometry/golden.json', import.meta.url), 'utf8')) as Golden;
  return golden;
}

/** A row with publication_end as an instant (the Python fake keeps datetimes, the port keeps pydantic's JSON form). */
export function comparableRow(row: Json): Json {
  const out = { ...row };
  if (typeof out.publication_end === 'string') out.publication_end = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(out.publication_end) ? out.publication_end : `${out.publication_end}Z`);
  return out;
}
