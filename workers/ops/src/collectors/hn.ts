// Hacker News collector (Phase 5, unit G5): handler of the scrapes kind 'hn-scan' (one message per tick), ported from
// the live hn-collector (version 7; the repo copy was re-synced from it). The dispatcher opened the run
// growth.hn:<slot>; this handler fills and closes it.
//
// Per message (assist / auto)
//   1. the run: missing -> ack; already final (a redelivery) -> ack
//   2. flag agent.growth.hn re-read: off -> run 'skipped' {reason: 'flag_off'}, ack
//   3. the active lead_keywords; then the newest 'hackernews' lead by posted_at (descending, limit 1):
//      since = its epoch seconds - 60, else now - 3600 s
//   4. the 15 live search terms, one after another with a 200 ms pause after each:
//      GET <algolia>/search_by_date?query=<term>&tags=story&numericFilters=created_at_i><since>&hitsPerPage=50,
//      then Show HN: GET <algolia>/search_by_date?tags=show_hn&numericFilters=created_at_i><since>&hitsPerPage=50;
//      a non-2xx answer is no hits (status counted in algolia_status); hits are merged by objectID (a later hit
//      replaces an earlier one, first-seen order kept)
//   5. per hit: live keyword scoring (hn variant: material_specific only); noise is skipped; the live leads row is
//      upserted with on_conflict=source,external_id, ignore-duplicates, return=representation; an upsert error is
//      counted; the live Telegram text is sent for a 'high' or 'medium' row only when the upsert inserted it (D-14)
//   6. close 'succeeded' with {scanned, matched, leads_new, high_or_medium, errors, algolia_status}; ack.
//   A request that throws (network, timeout) or an unreadable answer fails the whole tick, as live (where it
//   answered 500): the run closes 'failed' with a fixed code and the counts so far, and the message is acked; the
//   next tick reads the same window again (since comes from the newest stored lead).
// shadow: steps 1-4 and the scoring run; nothing is written and no text is sent; output with shadow: true.

import { readFlag } from '../agents/flags';
import { DbError } from '../db/postgrest';
import type { P5ScrapeHandler } from '../queues/scrapes-p5';
import {
  closeQuietly,
  CollectorError,
  countStatus,
  errorCode,
  isHnScanParams,
  logCollector,
  portsOf,
  realSleep,
  runState,
  SOURCE_TIMEOUT_MS,
  type CollectorOptions,
} from './common';
import { loadKeywords, matchKeywords } from './keywords';
import { hnLeadAlert } from './telegram-lead';

export const HN_FLAG = 'agent.growth.hn' as const;
/** Pause after each search term (live). */
export const HN_PAUSE_MS = 200;
/** The live search terms, in the live order. */
export const HN_SEARCH_TERMS: readonly string[] = Object.freeze([
  'CNC machining',
  'manufacturing',
  'prototype machining',
  '3D printing service',
  'sheet metal fabrication',
  'injection molding',
  'hardware startup manufacturing',
  'custom parts',
  'rapid prototyping',
  'metal parts',
  'machine shop',
  'precision parts',
  'Xometry',
  'Protolabs',
  'contract manufacturer',
]);

/** An Algolia hit (the fields the live collector reads). */
export interface HnHit {
  objectID: unknown;
  title: unknown;
  story_text: unknown;
  author: unknown;
  url: unknown;
  points: unknown;
  num_comments: unknown;
  created_at: unknown;
  created_at_i: unknown;
  _tags?: unknown;
}

export interface HnScanOutput {
  scanned: number;
  matched: number;
  leads_new: number;
  high_or_medium: number;
  errors: number;
  algolia_status: Record<string, number>;
  shadow?: true;
}

/** Pure: the live search URL of one term. */
export function hnSearchUrl(base: string, query: string, since: number): string {
  return `${base}/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=50`;
}

/** Pure: the live Show HN URL. */
export function hnShowUrl(base: string, since: number): string {
  return `${base}/search_by_date?tags=show_hn&numericFilters=created_at_i>${since}&hitsPerPage=50`;
}

/** Pure: the live window start (epoch seconds) from the newest stored hackernews lead's posted_at. */
export function hnSince(newestPostedAt: unknown, nowMs: number): number {
  return newestPostedAt ? Math.floor(new Date(newestPostedAt as string).getTime() / 1000) - 60 : Math.floor(nowMs / 1000) - 3600;
}

/** Pure: the leads row the live collector upserts for a scored hit. */
export function hnLeadRow(hit: HnHit, m: ReturnType<typeof matchKeywords>): Record<string, unknown> {
  const postUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const isShowHN = (hit._tags as string[] | null | undefined)?.includes('show_hn');
  const storyText = hit.story_text as string | null;
  return {
    source: 'hackernews',
    external_id: hit.objectID,
    subreddit: isShowHN ? 'Show HN' : 'Hacker News',
    title: hit.title,
    body: storyText ? storyText.replace(/<[^>]+>/g, '') : null,
    url: (hit.url as string) || postUrl,
    author: hit.author,
    score: (hit.points as number) || 0,
    num_comments: (hit.num_comments as number) || 0,
    lead_score: m.score,
    score_value: m.scoreValue,
    matched_keywords: m.matched,
    status: 'new',
    posted_at: hit.created_at,
  };
}

export function makeHnScanHandler(o: CollectorOptions = {}): P5ScrapeHandler {
  const sleep = o.sleep ?? realSleep;
  return async (msg, env, _ctx, deps) => {
    const runId = msg.body.run_id;
    const { ports, p5 } = portsOf(env, deps);
    const db = ports.db;
    if (msg.body.kind !== 'hn-scan' || !isHnScanParams(msg.body.params)) {
      await closeQuietly(db, runId, { status: 'failed', error: 'invalid_params' }, 'hn');
      logCollector('hn', { run_id: runId, outcome: 'invalid_params' });
      msg.ack();
      return;
    }
    const state = await runState(db, runId);
    if (state !== 'running') {
      logCollector('hn', { run_id: runId, outcome: state === 'final' ? 'already_closed' : 'run_missing' });
      msg.ack();
      return;
    }
    const flag = await readFlag(env, HN_FLAG);
    if (!flag.enabled) {
      await closeQuietly(db, runId, { status: 'skipped', output: { reason: 'flag_off' } }, 'hn');
      logCollector('hn', { run_id: runId, outcome: 'flag_off' });
      msg.ack();
      return;
    }
    const shadow = flag.mode === 'shadow';
    const out: HnScanOutput = { scanned: 0, matched: 0, leads_new: 0, high_or_medium: 0, errors: 0, algolia_status: {} };
    if (shadow) out.shadow = true;

    const search = async (url: string): Promise<HnHit[]> => {
      let response: Response;
      try {
        response = await p5.sources.fetch(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
      } catch {
        countStatus(out.algolia_status, 'error');
        throw new CollectorError('algolia_unreachable');
      }
      countStatus(out.algolia_status, response.status);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return [];
      }
      let data: { hits?: unknown };
      try {
        data = (await response.json()) as { hits?: unknown };
      } catch {
        throw new CollectorError('algolia_unreadable');
      }
      return ((data.hits as HnHit[] | undefined) || []) as HnHit[];
    };

    try {
      const keywords = await loadKeywords(db);
      const latest = await db.select<{ posted_at: unknown }>('leads', {
        columns: 'posted_at',
        filters: [['source', 'eq', 'hackernews']],
        order: [{ column: 'posted_at', ascending: false }],
        limit: 1,
      });
      const since = hnSince(latest[0]?.posted_at, ports.clock.now().getTime());
      const base = p5.sources.base('hn');

      const allHits = new Map<unknown, HnHit>();
      for (const term of HN_SEARCH_TERMS) {
        const hits = await search(hnSearchUrl(base, term, since));
        for (const hit of hits) allHits.set(hit.objectID, hit);
        await sleep(HN_PAUSE_MS);
      }
      for (const hit of await search(hnShowUrl(base, since))) allHits.set(hit.objectID, hit);
      out.scanned = allHits.size;

      for (const hit of allHits.values()) {
        const text = `${hit.title} ${(hit.story_text as string) || ''}`;
        const m = matchKeywords(text, keywords, 'hn');
        if (m.score === 'noise') continue;
        out.matched++;
        const row = hnLeadRow(hit, m);
        if (shadow) continue;
        let inserted: unknown[];
        try {
          inserted = await db.insert('leads', row, { onConflict: ['source', 'external_id'], ignoreDuplicates: true, returning: 'id' });
        } catch (e) {
          if (!(e instanceof DbError)) throw e;
          out.errors++;
          continue;
        }
        if (inserted.length === 0) continue; // already stored: no count, no alert (D-14)
        out.leads_new++;
        if (m.score === 'high' || m.score === 'medium') {
          out.high_or_medium++;
          await p5.telegramText.send(hnLeadAlert(hit, m, ports.clock.now().getTime()), { disableWebPagePreview: true });
        }
      }
    } catch (e) {
      const code = errorCode(e);
      await closeQuietly(db, runId, { status: 'failed', error: code, output: out }, 'hn');
      logCollector('hn', { run_id: runId, outcome: 'failed', error: code });
      msg.ack();
      return;
    }
    await closeQuietly(db, runId, { status: 'succeeded', output: out }, 'hn');
    logCollector('hn', {
      run_id: runId,
      outcome: 'succeeded',
      shadow: shadow || undefined,
      scanned: out.scanned,
      matched: out.matched,
      leads_new: out.leads_new,
      high_or_medium: out.high_or_medium,
      errors: out.errors,
    });
    msg.ack();
  };
}

export const handleHnScan: P5ScrapeHandler = makeHnScanHandler();
