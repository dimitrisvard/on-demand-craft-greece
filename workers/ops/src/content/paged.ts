// Paged reads of the content pipeline through the Phase 4 Db port (PostgREST answers at most 1,000 rows per
// request, and the port has no offset, so pages are keyed by id).
//
// Rules
//   - Order is id ascending; the next page starts at the last id read (gte) and that row is dropped, so no row is
//     skipped or read twice while rows are only added or changed (never when ids are re-used).
//   - The select list always includes id.
//   - A page shorter than the page size ends the read.

import type { Db, Filter, Row } from '../db/postgrest';

export const PAGE_ROWS = 1000;

function withId(columns: string): string {
  const cols = columns.split(',').map((c) => c.trim()).filter(Boolean);
  return cols.includes('id') || cols.includes('*') ? cols.join(',') : ['id', ...cols].join(',');
}

/** Calls onPage for every page of rows matching the filters, in id order. */
export async function forEachPage<T extends Row & { id: string }>(
  db: Db,
  table: string,
  o: { columns: string; filters?: readonly Filter[]; pageSize?: number },
  onPage: (rows: T[]) => Promise<void> | void,
): Promise<number> {
  // at least 2: every page after the first repeats the boundary row
  const pageSize = Math.max(2, o.pageSize ?? PAGE_ROWS);
  const columns = withId(o.columns);
  let last: string | null = null;
  let total = 0;
  for (;;) {
    const filters: Filter[] = [...(o.filters ?? [])];
    if (last !== null) filters.push(['id', 'gte', last]);
    const rows = await db.select<T>(table, { columns, filters, order: [{ column: 'id', ascending: true }], limit: pageSize });
    const fresh = last !== null && rows.length > 0 && String(rows[0].id) === last ? rows.slice(1) : rows;
    if (fresh.length > 0) {
      await onPage(fresh);
      total += fresh.length;
    }
    if (rows.length < pageSize || fresh.length === 0) break;
    last = String(rows[rows.length - 1].id);
  }
  return total;
}

/** Every row matching the filters (id order). */
export async function selectAll<T extends Row & { id: string }>(db: Db, table: string, o: { columns: string; filters?: readonly Filter[]; pageSize?: number }): Promise<T[]> {
  const out: T[] = [];
  await forEachPage<T>(db, table, o, (rows) => {
    out.push(...rows);
  });
  return out;
}

/** The bytes of a view as an ArrayBuffer of exactly that length (R2 put bodies). */
export function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
