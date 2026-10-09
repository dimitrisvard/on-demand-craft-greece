// Persistence of the Xometry scanner (public.xometry_offers), ported from xometry-bot/xometry_bot/db.py: PostgREST
// through the Phase 4 Db port with the service role (PHASE5_SPEC X-1), plus the in-memory stores of the tests and of
// shadow mode.
//
// Rules (the contract of db.py's upsert)
//   - A code is stored once. A re-scan refreshes only REFRESH_COLS (+ updated_at); status, tags, flags, spec and
//     computed prices are kept. Rows in a terminal status (submitted, skipped) are never touched.
//   - PostgrestOfferStore.upsertOffer, per offer:
//       1. POST xometry_offers?on_conflict=code&select=code,status, Prefer resolution=ignore-duplicates,
//          return=representation, body = the 30 insert columns -> a returned row is new (its status is reported)
//       2. only when 1 returned nothing: PATCH xometry_offers?code=eq.<code>&status=in.(<non-terminal statuses>)
//          &select=status with the refresh columns and updated_at (the table has no trigger for it); the status
//          list is every value of the table's status CHECK except the two terminal ones, which equals
//          "status not in (submitted, skipped)" for a NOT NULL, checked column
//       3. only when 2 returned nothing: GET xometry_offers?code=eq.<code>&select=status -> the terminal status
//          (none -> the built row's status)
//   - updateFields writes only ALLOWED_UPDATE_COLS (+ updated_at) and refuses any other column before any request.
//   - listByStatus orders by publication_end ascending (nulls last, PostgreSQL's default) and then code.
//   - MemoryOfferStore mirrors xometry-bot/tests/fakes.py FakeStore; DryRunOfferStore (shadow mode) is a memory
//     store that also records every write it would have made and never touches the database.

import type { ClockPort } from '../ports/index';
import type { Db, Row } from '../db/postgrest';
import type { OfferRow } from './types';

export const OFFERS_TABLE = 'xometry_offers';
export const TERMINAL_STATUSES: readonly string[] = Object.freeze(['submitted', 'skipped']);
/** The non-terminal values of the xometry_offers status CHECK (xometry-bot/schema.sql). */
export const NON_TERMINAL_STATUSES: readonly string[] = Object.freeze(['new', 'priced', 'ready', 'needs_manual', 'needs_review', 'excluded_secondary_ops', 'submitting', 'error']);

/** Columns the scanner may update after the insert (db.py ALLOWED_UPDATE_COLS). */
export const ALLOWED_UPDATE_COLS: ReadonlySet<string> = new Set([
  'status',
  'flags',
  'tags',
  'local_files',
  'buyer_price',
  'buyer_quote_id',
  'suggested_price',
  'suggested_leadtime',
  'threads_present',
  'excluded_reason',
  'tolerance',
  'roughness',
  'finish',
  'inspection_needed',
  'final_price',
  'final_leadtime',
  'submitted_at',
  'submit_screenshot',
]);

export const INSERT_COLS = Object.freeze([
  'code',
  'offer_id',
  'is_urgent',
  'process_type',
  'material',
  'quantity',
  'dimensions',
  'weight_kg',
  'volume_mm3',
  'tags',
  'tolerance',
  'roughness',
  'finish',
  'threads_present',
  'inspection_needed',
  'excluded_reason',
  'part_files',
  'local_files',
  'production_remark',
  'partner_cost',
  'allow_counter_from',
  'buyer_price',
  'buyer_quote_id',
  'suggested_price',
  'xo_leadtime',
  'publication_end',
  'suggested_leadtime',
  'status',
  'flags',
  'raw',
] as const satisfies ReadonlyArray<keyof OfferRow>);

/** Columns refreshed on a re-scan. */
export const REFRESH_COLS = Object.freeze(['is_urgent', 'partner_cost', 'allow_counter_from', 'xo_leadtime', 'publication_end', 'part_files', 'raw'] as const satisfies ReadonlyArray<keyof OfferRow>);

export type OfferRecord = Record<string, unknown>;

export interface OfferStore {
  /** Inserts or refreshes by code; returns the resulting status (a terminal row's own status). */
  upsertOffer(row: OfferRow): Promise<string>;
  get(code: string): Promise<OfferRecord | null>;
  listByStatus(statuses: readonly string[]): Promise<OfferRecord[]>;
  updateFields(code: string, fields: OfferRecord): Promise<void>;
  /** Rows this store inserted (codes seen for the first time). */
  readonly insertedCount: number;
}

/** Error of a write outside the whitelist (thrown before any request). */
export function checkUpdateCols(fields: OfferRecord): void {
  const bad = Object.keys(fields).filter((k) => !ALLOWED_UPDATE_COLS.has(k)).sort();
  if (bad.length > 0) throw new Error(`refusing to update non-whitelisted columns: [${bad.map((k) => `'${k}'`).join(', ')}]`);
}

function pick(row: OfferRow, cols: readonly (keyof OfferRow)[]): Row {
  const out: Row = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

export class PostgrestOfferStore implements OfferStore {
  private inserted = 0;

  constructor(
    private readonly db: Db,
    private readonly clock: ClockPort,
  ) {}

  get insertedCount(): number {
    return this.inserted;
  }

  async upsertOffer(row: OfferRow): Promise<string> {
    const created = await this.db.insert<{ code: string; status: string }>(OFFERS_TABLE, pick(row, INSERT_COLS), {
      onConflict: ['code'],
      ignoreDuplicates: true,
      returning: 'code,status',
    });
    if (created.length > 0) {
      this.inserted += 1;
      return String(created[0].status);
    }
    const refreshed = await this.db.update<{ status: string }>(
      OFFERS_TABLE,
      { ...pick(row, REFRESH_COLS), updated_at: this.clock.now().toISOString() },
      {
        filters: [
          ['code', 'eq', row.code],
          ['status', 'in', NON_TERMINAL_STATUSES],
        ],
        returning: 'status',
      },
    );
    if (refreshed.length > 0) return String(refreshed[0].status);
    const existing = await this.db.select<{ status: string }>(OFFERS_TABLE, { columns: 'status', filters: [['code', 'eq', row.code]], limit: 1 });
    return existing.length > 0 ? String(existing[0].status) : row.status;
  }

  async get(code: string): Promise<OfferRecord | null> {
    const rows = await this.db.select(OFFERS_TABLE, { filters: [['code', 'eq', code]], limit: 1 });
    return rows[0] ?? null;
  }

  async listByStatus(statuses: readonly string[]): Promise<OfferRecord[]> {
    return this.db.select(OFFERS_TABLE, {
      filters: [['status', 'in', [...statuses]]],
      order: [{ column: 'publication_end' }, { column: 'code' }],
    });
  }

  async updateFields(code: string, fields: OfferRecord): Promise<void> {
    checkUpdateCols(fields);
    if (Object.keys(fields).length === 0) return;
    await this.db.update(OFFERS_TABLE, { ...fields, updated_at: this.clock.now().toISOString() }, { filters: [['code', 'eq', code]] });
  }
}

function instantOf(v: unknown): number {
  if (typeof v !== 'string' || v === '') return Number.POSITIVE_INFINITY;
  const t = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}Z`);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** In memory with the upsert contract above (port of tests/fakes.py FakeStore). */
export class MemoryOfferStore implements OfferStore {
  readonly rows = new Map<string, OfferRecord>();
  private inserted = 0;

  get insertedCount(): number {
    return this.inserted;
  }

  async upsertOffer(row: OfferRow): Promise<string> {
    const data = structuredClone(row) as unknown as OfferRecord;
    const existing = this.rows.get(row.code);
    if (!existing) {
      this.rows.set(row.code, data);
      this.inserted += 1;
      return String(data.status);
    }
    if (TERMINAL_STATUSES.includes(String(existing.status))) return String(existing.status);
    for (const col of REFRESH_COLS) existing[col] = structuredClone(data[col]);
    return String(existing.status);
  }

  async get(code: string): Promise<OfferRecord | null> {
    const row = this.rows.get(code);
    return row ? structuredClone(row) : null;
  }

  async listByStatus(statuses: readonly string[]): Promise<OfferRecord[]> {
    const rows = [...this.rows.values()].filter((r) => statuses.includes(String(r.status)));
    rows.sort((a, b) => {
      const d = instantOf(a.publication_end) - instantOf(b.publication_end);
      if (d !== 0 && !Number.isNaN(d)) return d;
      const ca = String(a.code);
      const cb = String(b.code);
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    });
    return structuredClone(rows);
  }

  async updateFields(code: string, fields: OfferRecord): Promise<void> {
    checkUpdateCols(fields);
    const row = this.rows.get(code);
    if (!row) throw new Error(`no xometry_offers row for ${code}`);
    Object.assign(row, structuredClone(fields));
  }
}

export interface DryRunWrite {
  op: 'upsert' | 'update';
  code: string;
  status?: string;
  columns: string[];
}

/** Shadow mode: the scan runs against an empty memory store and records what it would have written. */
export class DryRunOfferStore extends MemoryOfferStore {
  readonly writes: DryRunWrite[] = [];

  override async upsertOffer(row: OfferRow): Promise<string> {
    this.writes.push({ op: 'upsert', code: row.code, status: row.status, columns: [...INSERT_COLS] });
    return super.upsertOffer(row);
  }

  override async updateFields(code: string, fields: OfferRecord): Promise<void> {
    this.writes.push({ op: 'update', code, columns: Object.keys(fields).sort() });
    return super.updateFields(code, fields);
  }
}
