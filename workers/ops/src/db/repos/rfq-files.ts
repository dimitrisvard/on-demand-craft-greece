// public.rfq_files rows written by the agent layer for files that arrived by e-mail.
//
// Rules
//   - id (file_id) = UUIDv5(rfq_id, sha256 of the bytes): stable across retries.
//   - file_path = '<rfq_id>/<file_id>-<safe name>' (the Phase 2 files API prefixes 'rfq/' and the RFQ page presigns
//     file_path); r2_key = 'rfq/' + file_path; source 'email' or 'techpilot'; sha256, content_type set.
//   - One row per (rfq_id, sha256): insert with on_conflict=rfq_id,sha256 and ignore-duplicates, then read the rows
//     back by sha256 (an ignored duplicate is not returned by the insert).

import type { Db } from '../postgrest';
import { rfqFileLocation, uuidV5 } from '../../mail-in/safe-name';

/** = rfq_files_source_check */
export type RfqFileSource = 'web' | 'email' | 'techpilot' | 'manual';

export interface AgentRfqFile {
  rfq_id: string;
  /** Display name of the file (the sender's name, cleaned). */
  name: string;
  sha256: string;
  size_bytes: number;
  content_type: string;
  source: 'email' | 'techpilot';
  part_id: string | null;
  tenant_id: string;
}

export interface RfqFileRow {
  id: string;
  rfq_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  part_id: string | null;
  source: RfqFileSource;
  r2_key: string | null;
  sha256: string | null;
  content_type: string | null;
  tenant_id: string;
}

/** id, file_path and r2_key of an agent file. */
export async function agentFileLocation(f: Pick<AgentRfqFile, 'rfq_id' | 'sha256' | 'name'>): Promise<{ id: string; file_path: string; r2_key: string }> {
  const id = await uuidV5(f.rfq_id, f.sha256);
  return { id, ...rfqFileLocation(f.rfq_id, id, f.name) };
}

/** The rfq_files row of an agent file (as inserted). */
export async function agentFileRow(f: AgentRfqFile): Promise<RfqFileRow> {
  const loc = await agentFileLocation(f);
  return {
    id: loc.id,
    rfq_id: f.rfq_id,
    file_name: f.name,
    file_path: loc.file_path,
    file_type: f.content_type,
    file_size: f.size_bytes,
    part_id: f.part_id,
    source: f.source,
    r2_key: loc.r2_key,
    sha256: f.sha256,
    content_type: f.content_type,
    tenant_id: f.tenant_id,
  };
}

/** Inserts the rows (existing (rfq_id, sha256) pairs are left as they are) and returns the stored rows by sha256. */
export async function insertAgentFiles(db: Db, rfqId: string, rows: readonly RfqFileRow[]): Promise<RfqFileRow[]> {
  if (rows.length === 0) return [];
  // One row per sha256 within the call: PostgREST refuses a batch that conflicts with itself.
  const unique = [...new Map(rows.map((r) => [r.sha256, r])).values()];
  await db.insert('rfq_files', unique as unknown as Array<Record<string, unknown>>, { onConflict: ['rfq_id', 'sha256'], ignoreDuplicates: true });
  return db.select<RfqFileRow & Record<string, unknown>>('rfq_files', {
    filters: [['rfq_id', 'eq', rfqId], ['sha256', 'in', unique.map((r) => r.sha256 as string)]],
    limit: unique.length,
  });
}
