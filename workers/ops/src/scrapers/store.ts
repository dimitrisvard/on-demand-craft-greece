// Writes of the scraper module (service role through the Db port).
//
// Rules
//   - company_leads: upsert on (source, source_url) with merge-duplicates, the semantics of the scan tools
//     (mcp-server/src/index.ts:674-677); only the keys a parsed company carries are written, so a new scan never
//     clears a column filled by enrichment. Rows with different key sets are written in separate requests (PostgREST
//     takes the keys of a bulk insert from its rows). Answers the number of rows written.
//   - scan_logs: one row per scan with the live columns (scan_type 'directory' or 'profile', source, keyword, url,
//     status 'completed' or 'failed', companies_found, emails_found 0, error_message, started_at, completed_at,
//     duration_ms). A paused host is recorded as error_message 'blocked:<host>' (context.ts reads it back).
//     A failed scan_logs write is logged and never fails the scan.
//   - saved_searches: last_run_at and result_count after a run of a saved search (live columns).
//   - Never logs row contents (company names, e-mail addresses, phone numbers).

import { formatLogLine } from '../../../shared/src/http/log';
import type { Db, Row } from '../db/postgrest';
import { LOG_PREFIX } from '../env';
import type { DirectoryPageBody } from './parsers/directory';

export type CompanyRow = DirectoryPageBody['companies'][number];

/** Upserts companies; answers the number of rows written. */
export async function upsertCompanies(db: Db, companies: readonly CompanyRow[]): Promise<number> {
  const groups = new Map<string, Row[]>();
  for (const company of companies) {
    const keys = Object.keys(company).sort().join(',');
    const group = groups.get(keys) ?? [];
    group.push(company as Row);
    groups.set(keys, group);
  }
  let written = 0;
  for (const rows of groups.values()) {
    const out = await db.insert('company_leads', rows, { onConflict: ['source', 'source_url'], ignoreDuplicates: false, returning: 'id' });
    written += out.length;
  }
  return written;
}

export interface ScanLogInput {
  scan_type: 'directory' | 'profile';
  source: string;
  keyword: string | null;
  url: string;
  ok: boolean;
  companies_found: number;
  error_message: string | null;
  started_at: Date;
  completed_at: Date;
}

/** Inserts one scan_logs row (see the rules above). */
export async function writeScanLog(db: Db, s: ScanLogInput): Promise<void> {
  try {
    await db.insert('scan_logs', {
      scan_type: s.scan_type,
      source: s.source,
      keyword: s.keyword,
      url: s.url,
      status: s.ok ? 'completed' : 'failed',
      companies_found: s.companies_found,
      emails_found: 0,
      error_message: s.error_message === null ? null : s.error_message.slice(0, 500),
      started_at: s.started_at.toISOString(),
      completed_at: s.completed_at.toISOString(),
      duration_ms: Math.max(0, s.completed_at.getTime() - s.started_at.getTime()),
    });
  } catch (error) {
    console.error(formatLogLine(LOG_PREFIX, 'scan_logs write failed', { code: (error as { code?: string }).code ?? 'unknown' }));
  }
}

/** last_run_at and result_count of a saved search. */
export async function markSavedSearchRun(db: Db, savedSearchId: string, resultCount: number, at: Date): Promise<void> {
  await db.update('saved_searches', { last_run_at: at.toISOString(), result_count: resultCount }, { filters: [['id', 'eq', savedSearchId]] });
}
