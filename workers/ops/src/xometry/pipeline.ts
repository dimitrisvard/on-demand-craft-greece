// Scan pipeline of the Xometry port: board -> preset filter -> exclusion -> upsert -> compute pass, ported from
// xometry-bot/xometry_bot/pipeline.py (build_row, run_scan, run_compute_pass). File downloads and Playwright buyer
// pricing are not ported (off in the GitHub Action today, PHASE5_SPEC Q8).
//
// Rules
//   - An offer outside every active preset is counted and not stored. An offer with a secondary op is stored with
//     status excluded_secondary_ops, its reason and a 'secondary_op:<op>' flag (store, don't delete) and is not
//     counted as upserted. An offer whose files cannot be instant-quoted is stored as needs_manual with a
//     'files:<kind>' flag.
//   - A failure while handling one offer is recorded as '<code>: <message>' and the scan goes on with the next
//     offer; a failure of the board itself (authentication, page, network) ends the scan and is thrown, with the
//     counts so far kept in the stats object the caller passed.
//   - shouldStop() is checked before each offer: when it answers true the scan stops fetching and writing
//     (stats.stopped), so a tick stays inside its subrequest and wall-time budget.
//   - The compute pass prices every 'priced' row (none reach that status without buyer pricing today).

import { dedupe, extractSpec, fileKind, findSecondaryOp, matchesAnyActivePreset } from './filters';
import { compute, estimateCost } from './pricing';
import type { OfferStore } from './store';
import type { JobOffer, OfferRow, PartFileRef, Spec } from './types';

export interface ScanStats {
  scanned: number;
  preset_rejected: number;
  excluded_secondary: number;
  upserted: number;
  needs_manual: number;
  errors: string[];
  /** True when shouldStop() ended the scan early. */
  stopped: boolean;
}

export interface ScanSettings {
  /** Lower-cased keywords that turn a borderline op into an exclusion. */
  borderlineExclude: Iterable<string>;
  shouldStop?: () => boolean;
}

export interface OfferSource {
  scan(): AsyncIterable<JobOffer>;
}

export function newScanStats(): ScanStats {
  return { scanned: 0, preset_rejected: 0, excluded_secondary: 0, upserted: 0, needs_manual: 0, errors: [], stopped: false };
}

/** Flattens an offer and its spec into a xometry_offers row. */
export function buildRow(offer: JobOffer, spec: Spec): OfferRow {
  const p0 = offer.parts[0] ?? null;
  const tags = dedupe(offer.parts.flatMap((p) => p.tags.map((t) => (t.context ? `${t.context}/${t.name}` : t.name))));
  const part_files: PartFileRef[] = offer.parts.flatMap((p) => p.files.map((f) => ({ name: f.name, downloadUrl: f.download_url })));
  return {
    code: offer.code,
    offer_id: String(offer.id),
    is_urgent: offer.is_urgent,
    process_type: p0 ? p0.process_type : null,
    material: p0 ? p0.material : null,
    quantity: p0 ? p0.quantity : null,
    dimensions: p0 ? p0.dimensions : null,
    weight_kg: p0 ? p0.weight_kg : null,
    volume_mm3: p0 ? p0.volume_mm3 : null,
    tags,
    tolerance: spec.tolerance,
    roughness: spec.roughness,
    finish: spec.finish !== null ? spec.finish : p0 ? p0.finish : null,
    threads_present: null,
    inspection_needed: spec.inspection_needed,
    excluded_reason: null,
    part_files,
    local_files: [],
    production_remark: p0 ? p0.production_remark : null,
    partner_cost: offer.cost ? offer.cost.amount : null,
    allow_counter_from: offer.allow_counteroffer_from,
    buyer_price: null,
    buyer_quote_id: null,
    suggested_price: null,
    xo_leadtime: offer.leadtime,
    publication_end: offer.publication_end,
    suggested_leadtime: null,
    status: 'new',
    flags: [...spec.flags],
    raw: offer.raw,
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function processOffer(store: OfferStore, offer: JobOffer, borderline: readonly string[], stats: ScanStats): Promise<void> {
  if (!matchesAnyActivePreset(offer)) {
    stats.preset_rejected += 1;
    return;
  }
  const spec = extractSpec(offer);
  const row = buildRow(offer, spec);
  const hit = findSecondaryOp(offer, { borderlineExclude: borderline });
  if (hit) {
    row.status = 'excluded_secondary_ops';
    row.excluded_reason = hit.op_name;
    row.flags = dedupe([...row.flags, `secondary_op:${hit.op_name}`]);
    await store.upsertOffer(row);
    stats.excluded_secondary += 1;
    return;
  }
  const kind = fileKind(offer.parts.flatMap((p) => p.files.map((f) => f.name)));
  if (kind !== 'instant') {
    row.status = 'needs_manual';
    row.flags = dedupe([...row.flags, `files:${kind}`]);
    stats.needs_manual += 1;
  }
  await store.upsertOffer(row);
  stats.upserted += 1;
  // Nothing follows the upsert: the Worker never keeps local CAD copies (XB_DOWNLOAD_FILES=0 in the Action), and
  // the dashboard links to Xometry's own downloadUrl.
}

/** Fetches the board, filters, dedupes and upserts (see the rules above); stats is filled in place. */
export async function runScan(store: OfferStore, client: OfferSource, s: ScanSettings, stats: ScanStats = newScanStats()): Promise<ScanStats> {
  const borderline = [...s.borderlineExclude];
  for await (const offer of client.scan()) {
    if (s.shouldStop?.()) {
      stats.stopped = true;
      break;
    }
    stats.scanned += 1;
    try {
      await processOffer(store, offer, borderline, stats);
    } catch (e) {
      stats.errors.push(`${offer.code}: ${messageOf(e)}`);
    }
  }
  return stats;
}

function toFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : Number(v);
}

function toDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, 10);
}

/** Suggested price and lead time for every 'priced' row -> ready / needs_review; returns the rows computed. */
export async function runComputePass(store: OfferStore, todayIso: string, o: { shouldStop?: () => boolean } = {}): Promise<number> {
  let computed = 0;
  for (const row of await store.listByStatus(['priced'])) {
    if (o.shouldStop?.()) break;
    const code = String(row.code);
    const result = compute({
      buyer_price: toFloat(row.buyer_price),
      partner_cost: toFloat(row.partner_cost),
      your_cost: estimateCost(row),
      xo_leadtime: toDate(row.xo_leadtime),
      today: todayIso,
    });
    const flags = Array.isArray(row.flags) ? (row.flags as string[]) : [];
    await store.updateFields(code, {
      status: result.status,
      suggested_price: result.suggested_price,
      suggested_leadtime: result.suggested_leadtime,
      flags: dedupe([...flags, ...result.flags]),
    });
    computed += 1;
  }
  return computed;
}
