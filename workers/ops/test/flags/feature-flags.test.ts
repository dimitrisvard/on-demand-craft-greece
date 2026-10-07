// The feature_flags repository (src/db/repos/feature-flags.ts): KV keys, KV records, the seed argument, the
// optimistic edit by rev and the write-through order (kv_key, kv_value, put, mark_synced) the dashboard's flag
// switch uses (PHASE4_SPEC.md §4.4 FlagEditBody / FlagEditResult).

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ID,
  flagKvKey,
  getFlagRow,
  listFlags,
  parseKvRecord,
  seedArgument,
  updateFlagIfRev,
  writeThrough,
} from '../../src/db/repos/feature-flags';
import { seededFlags } from '../helpers/check-lists';
import { insertRow, type MemoryTableSet } from '../helpers/memory-rpc';
import { FakeKv, TableDb } from './table-db';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER = 'BB71E74E-4273-496F-A75B-319357666EBC';

function setup() {
  const tables: MemoryTableSet = {};
  const log: string[] = [];
  const now = new Date('2026-10-05T07:00:00.000Z');
  for (const row of seededFlags()) insertRow(tables, 'feature_flags', { ...row, kv_seed_pending: false }, now);
  return { tables, log, db: new TableDb(tables, log, () => now), kv: new FakeKv({}, log) };
}

describe('feature_flags repository', () => {
  it('KV keys: the flag key for the default tenant, t:<tenant>:<key> (lower-case) otherwise', () => {
    expect(flagKvKey('agent.quote')).toBe('agent.quote');
    expect(flagKvKey('agent.quote', DEFAULT_TENANT_ID)).toBe('agent.quote');
    expect(flagKvKey('agent.quote', OTHER)).toBe(`t:${OTHER.toLowerCase()}:agent.quote`);
  });

  it('seed argument: absent -> null; not JSON or the JSON literal null -> a record without enabled; JSON as parsed', () => {
    expect(seedArgument(null)).toBeNull();
    expect(seedArgument('on')).toEqual({ unparsable: true });
    expect(seedArgument('null')).toEqual({ unparsable: true });
    expect(seedArgument('{"enabled":true}')).toEqual({ enabled: true });
    expect(seedArgument('[]')).toEqual([]);
  });

  it('KV records: a flag record or malformed', () => {
    expect(parseKvRecord('{"enabled":true,"value":{"mode":"assist"},"updated_at":"2026-10-05T07:00:00.000Z","rev":4,"mode":"assist"}'))
      .toEqual({ enabled: true, value: { mode: 'assist' }, updated_at: '2026-10-05T07:00:00.000Z', rev: 4, mode: 'assist' });
    expect(parseKvRecord('{"enabled":false}')).toEqual({ enabled: false, value: {}, updated_at: '', rev: 0 });
    for (const bad of ['garbage', 'null', '[]', '{"enabled":"true"}', '{"enabled":true,"value":[]}', '{"enabled":true,"mode":"yolo"}']) {
      expect(parseKvRecord(bad), bad).toBe('malformed');
    }
  });

  it('optimistic edit: the rev the editor read wins once; a stale rev changes nothing', async () => {
    const { db } = setup();
    const before = (await getFlagRow(db, 'agent.quote'))!;
    const edited = await updateFlagIfRev(db, {
      key: 'agent.quote', expected_rev: before.rev, enabled: true, value: { ...before.value, mode: 'assist' }, updated_by: ADMIN,
    });
    expect(edited).toMatchObject({ key: 'agent.quote', enabled: true, updated_by: ADMIN, kv_seed_pending: false });
    expect(edited!.rev).toBeGreaterThan(before.rev);
    const stale = await updateFlagIfRev(db, { key: 'agent.quote', expected_rev: before.rev, enabled: false, value: {}, updated_by: ADMIN });
    expect(stale).toBeNull();
    expect((await getFlagRow(db, 'agent.quote'))!.enabled).toBe(true);
    expect((await listFlags(db)).map((r) => r.key)).toContain('mcp.remote');
  });

  it("optimistic edit: a rev read from another tenant's row of the same key edits neither row", async () => {
    const { db, tables } = setup();
    const other = OTHER.toLowerCase();
    insertRow(tables, 'feature_flags', { key: 'agent.quote', tenant_id: other, value: { mode: 'assist' } }, new Date('2026-10-05T07:00:00.000Z'));
    const theirs = (await getFlagRow(db, 'agent.quote', other))!;
    const ours = (await getFlagRow(db, 'agent.quote'))!;
    expect(theirs.rev).not.toBe(ours.rev);
    expect(await updateFlagIfRev(db, { key: 'agent.quote', expected_rev: theirs.rev, enabled: true, value: {}, updated_by: ADMIN })).toBeNull();
    expect(await getFlagRow(db, 'agent.quote', other)).toMatchObject({ enabled: false, rev: theirs.rev, value: { mode: 'assist' } });
    expect(await getFlagRow(db, 'agent.quote')).toMatchObject({ enabled: false, rev: ours.rev });
    const edited = await updateFlagIfRev(db, { key: 'agent.quote', tenant_id: other, expected_rev: theirs.rev, enabled: true, value: theirs.value, updated_by: ADMIN });
    expect(edited).toMatchObject({ tenant_id: other, enabled: true });
    expect(await getFlagRow(db, 'agent.quote')).toMatchObject({ enabled: false, rev: ours.rev });
  });

  it('write-through: kv_key, kv_value, put, then mark_synced; the KV record is the table row', async () => {
    const { db, kv, log } = setup();
    const before = (await getFlagRow(db, 'agent.quote'))!;
    const row = (await updateFlagIfRev(db, { key: 'agent.quote', expected_rev: before.rev, enabled: true, value: before.value, updated_by: ADMIN }))!;
    log.length = 0;
    expect(await writeThrough(db, kv, row)).toBe('written');
    expect(log).toEqual([
      'db.rpc feature_flags_kv_key agent.quote',
      'db.rpc feature_flags_kv_value',
      'kv.put agent.quote',
      'db.rpc feature_flags_mark_synced agent.quote',
    ]);
    expect(JSON.parse(kv.map.get('agent.quote') as string)).toEqual({
      enabled: true, mode: 'assist', value: before.value, updated_at: row.updated_at, rev: row.rev,
    });
    expect((await getFlagRow(db, 'agent.quote'))!.kv_synced_rev).toBe(row.rev);
  });

  it("write-through answers 'pending' and leaves the row unsynced when the put fails or the row moved on", async () => {
    const { db, kv, log } = setup();
    const r0 = (await getFlagRow(db, 'agent.post_order'))!;
    const r1 = (await updateFlagIfRev(db, { key: 'agent.post_order', expected_rev: r0.rev, enabled: true, value: r0.value, updated_by: ADMIN }))!;
    kv.failNext.add('agent.post_order');
    log.length = 0;
    expect(await writeThrough(db, kv, r1)).toBe('pending');
    expect(log.some((l) => l.startsWith('db.rpc feature_flags_mark_synced'))).toBe(false);
    expect((await getFlagRow(db, 'agent.post_order'))!.kv_synced_rev).not.toBe(r1.rev);

    const r2 = (await updateFlagIfRev(db, { key: 'agent.post_order', expected_rev: r1.rev, enabled: false, value: r0.value, updated_by: ADMIN }))!;
    expect(await writeThrough(db, kv, r1)).toBe('pending');           // r1 was overtaken by r2
    expect((await getFlagRow(db, 'agent.post_order'))!.kv_synced_rev).not.toBe(r2.rev);
  });
});
