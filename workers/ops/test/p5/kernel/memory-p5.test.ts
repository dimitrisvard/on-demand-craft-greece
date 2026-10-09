// The Phase 5 tables and RPCs of the test databases (src/ports/p5-stub/memory-rpc-p5.ts, P5MemoryDb): the four
// article-queue functions with the semantics of supabase/migrations/20250103_create_article_queue_system.sql, and the
// unique keys the content, collector and Xometry writes rely on (23505, ignore- and merge-duplicates, 42P10).

import { describe, expect, it } from 'vitest';
import { DbError } from '../../../src/db/postgrest';
import { P5_MEMORY_RPCS, P5MemoryDb, p5WriteRow } from '../../../src/ports/p5-stub/index';

const T0 = new Date('2026-10-08T07:00:00.000Z');

function db() {
  return new P5MemoryDb({ clock: () => T0 });
}

describe('article-queue RPCs', () => {
  it('enqueue -> claim -> complete: the oldest unprocessed title, pending first, processed afterwards', async () => {
    const d = db();
    d.seed('article_titles', [
      { id: 't-new', title: 'Newer', silo_category: 'cnc', processed: false, created_at: '2026-10-02T00:00:00Z' },
      { id: 't-old', title: 'Older', silo_category: 'sheet', processed: false, created_at: '2026-10-01T00:00:00Z' },
      { id: 't-done', title: 'Done', processed: true, created_at: '2026-09-01T00:00:00Z' },
    ]);
    const queueId = await d.rpc<string>('enqueue_next_article', {});
    expect(d.rows('article_generation_queue')).toEqual([
      { id: queueId, title_id: 't-old', status: 'pending', error_message: null, retry_count: 0, started_at: null, completed_at: null, created_at: T0.toISOString() },
    ]);
    const job = await d.rpc<unknown[]>('get_next_queue_job', {});
    expect(job).toEqual([{ queue_id: queueId, title_id: 't-old', title: 'Older', silo_category: 'sheet', retry_count: 0 }]);
    expect(d.rows('article_generation_queue')[0]).toMatchObject({ status: 'processing', started_at: T0.toISOString() });
    expect(await d.rpc('get_next_queue_job', {})).toEqual([]);
    expect(await d.rpc('mark_queue_job_completed', { queue_job_id: queueId, article_id: 'a-1' })).toBeNull();
    expect(d.rows('article_generation_queue')[0]).toMatchObject({ status: 'completed', completed_at: T0.toISOString() });
    expect(d.rows('article_titles').find((t) => t.id === 't-old')).toMatchObject({ processed: true, processed_at: T0.toISOString() });
  });

  it('no unprocessed title: enqueue answers null and adds nothing', async () => {
    const d = db();
    expect(await d.rpc('enqueue_next_article', {})).toBeNull();
    expect(d.rows('article_generation_queue')).toEqual([]);
  });

  it('a failed job is claimed again while retry_count < 3, after any pending job; then never', async () => {
    const d = db();
    d.seed('article_titles', [{ id: 't1', title: 'A', processed: false, created_at: '2026-10-01T00:00:00Z' }, { id: 't2', title: 'B', processed: false, created_at: '2026-10-02T00:00:00Z' }]);
    d.seed('article_generation_queue', [
      { id: 'q-failed', title_id: 't1', status: 'failed', retry_count: 2, created_at: '2026-10-01T07:00:00Z' },
      { id: 'q-pending', title_id: 't2', status: 'pending', retry_count: 0, created_at: '2026-10-08T07:00:00Z' },
    ]);
    expect(await d.rpc('get_next_queue_job', {})).toMatchObject([{ queue_id: 'q-pending' }]);
    expect(await d.rpc('get_next_queue_job', {})).toMatchObject([{ queue_id: 'q-failed', retry_count: 2 }]);
    await d.rpc('mark_queue_job_failed', { queue_job_id: 'q-failed', error_msg: 'too short' });
    expect(d.rows('article_generation_queue').find((q) => q.id === 'q-failed')).toMatchObject({ status: 'failed', retry_count: 3, error_message: 'too short' });
    expect(await d.rpc('get_next_queue_job', {})).toEqual([]);
  });

  it('the RPC table names exactly the four live functions', () => {
    expect(Object.keys(P5_MEMORY_RPCS).sort()).toEqual(['enqueue_next_article', 'get_next_queue_job', 'mark_queue_job_completed', 'mark_queue_job_failed']);
  });
});

describe('unique keys of the Phase 5 tables', () => {
  it('articles (slug, language): a second insert answers 23505 and writes nothing; another language is fine', async () => {
    const d = db();
    await d.insert('articles', { slug: 'laser-cutting', language: 'en', title: 'A' });
    await d.insert('articles', { slug: 'laser-cutting', language: 'de', title: 'B' });
    const error = await d.insert('articles', [{ slug: 'x', language: 'en' }, { slug: 'laser-cutting', language: 'en' }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ status: 409, code: '23505' });
    expect(d.rows('articles').map((r) => `${r.slug}/${r.language}`)).toEqual(['laser-cutting/en', 'laser-cutting/de']);
    expect(d.rows('articles')[0]).toMatchObject({ created_at: T0.toISOString(), updated_at: T0.toISOString() });
  });

  it('leads: ignore-duplicates on source_url returns only inserted rows; HN key (source, external_id) likewise', async () => {
    const d = db();
    const first = await d.insert('leads', [{ source: 'reddit', source_url: 'https://reddit.com/r/a/1', title: 'one' }], { onConflict: ['source_url'], ignoreDuplicates: true, returning: true });
    const again = await d.insert('leads', [{ source: 'reddit', source_url: 'https://reddit.com/r/a/1', title: 'changed' }, { source: 'reddit', source_url: 'https://reddit.com/r/a/2' }], { onConflict: ['source_url'], ignoreDuplicates: true, returning: 'source_url' });
    expect(first).toHaveLength(1);
    expect(again).toEqual([{ source_url: 'https://reddit.com/r/a/2' }]);
    expect(d.rows('leads').find((r) => r.source_url === 'https://reddit.com/r/a/1')?.title).toBe('one');
    const hn = await d.insert('leads', [{ source: 'hackernews', external_id: '42', source_url: 'https://news.ycombinator.com/item?id=42' }], { onConflict: ['source', 'external_id'], returning: true });
    expect(hn).toHaveLength(1);
    expect(await d.insert('leads', [{ source: 'hackernews', external_id: '42', source_url: 'https://other' }], { onConflict: ['external_id', 'source'], returning: true })).toEqual([]);
  });

  it('merge-duplicates updates the given columns; an unknown conflict target is 42P10', async () => {
    const d = db();
    await d.insert('gsc_monitored_urls', { url: 'https://www.micronshub.eu/en/blog/a', status: 'submitted', note: 'kept' });
    const merged = await d.insert('gsc_monitored_urls', { url: 'https://www.micronshub.eu/en/blog/a', status: 'pending' }, { onConflict: ['url'], ignoreDuplicates: false, returning: true });
    expect(merged).toMatchObject([{ url: 'https://www.micronshub.eu/en/blog/a', status: 'pending', note: 'kept' }]);
    expect(d.rows('gsc_monitored_urls')).toHaveLength(1);
    await expect(d.insert('gsc_monitored_urls', { url: 'x' }, { onConflict: ['status'] })).rejects.toMatchObject({ status: 400, code: '42P10' });
  });

  it('xometry_offers code and tenders (country_code, tender_reference); NULL keys never conflict', () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    p5WriteRow(tables, 'xometry_offers', { code: 'X-1', status: 'new' }, T0);
    expect(p5WriteRow(tables, 'xometry_offers', { code: 'X-1', status: 'seen' }, T0, { onConflict: ['code'] })).toBeNull();
    expect(() => p5WriteRow(tables, 'xometry_offers', { code: 'X-1' }, T0)).toThrow(/duplicate key/);
    p5WriteRow(tables, 'tenders', { country_code: 'NL', tender_reference: 'R1' }, T0);
    p5WriteRow(tables, 'tenders', { country_code: 'NL', tender_reference: null }, T0);
    p5WriteRow(tables, 'tenders', { country_code: 'NL', tender_reference: null }, T0);
    expect(tables.tenders).toHaveLength(3);
    expect(tables.tenders?.[0]).toMatchObject({ discovered_at: T0.toISOString() });
  });

  it('every other table keeps the MemoryDb behaviour', async () => {
    const d = db();
    await d.insert('agent_runs', { agent: 'growth.hn', trigger: 'cron', idempotency_key: 'growth.hn:2026-10-08T07:00Z' });
    await expect(d.insert('agent_runs', { agent: 'growth.hn', trigger: 'cron', idempotency_key: 'growth.hn:2026-10-08T07:00Z' })).rejects.toMatchObject({ code: '23505' });
  });
});
