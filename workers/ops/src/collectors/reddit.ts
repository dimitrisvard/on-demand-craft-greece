// Reddit collector (Phase 5, unit G5): handler of the scrapes kind 'reddit-tier' (one message per tier tick, at most
// 40 due subreddits), ported from the batch scan of the live reddit-collector (version 15; the repo copy equals it).
// The dispatcher opened the run growth.reddit:t<N>:<slot>; this handler fills and closes it.
//
// Per message (assist / auto)
//   1. the run: missing -> ack; already final (a redelivery) -> ack
//   2. flag agent.growth.reddit re-read: off -> run 'skipped' {reason: 'flag_off'}, ack
//   3. monitored_subreddits with is_active, source 'reddit', tier <= N, ordered by tier (one read); due = never
//      scanned, or now - last_scanned_at >= (scan_interval_minutes or 30) minutes; the first `max` (40) due ones
//   4. the active lead_keywords (one read)
//   5. per due subreddit, one after another:
//      a. re-check: its row is read again and skipped when no longer due (another tier tick of the same minute
//         scanned it meanwhile)
//      b. GET <pullpush>/reddit/search/submission?subreddit=<name>&sort=new&sort_type=created_utc&size=100
//         [&after=<epoch seconds of last_scanned_at>] with User-Agent MicronsHubLeadMonitor/1.0; a non-2xx answer
//         is 0 posts (status counted in pullpush_status)
//      c. per post: live keyword scoring (reddit variant); noise is skipped; the live leads row is upserted with
//         on_conflict=source_url, ignore-duplicates, return=representation; an upsert error is counted and the
//         next post follows; the live Telegram text is sent for a 'high' row only when the upsert inserted it
//         (D-14: a re-read post never alerts twice)
//      d. monitored_subreddits.last_scanned_at = now; then a 500 ms pause
//      A subreddit whose fetch, answer or re-check throws is counted in errors; its last_scanned_at stays as it was
//      (as live).
//   6. close 'succeeded' with {tier, due, scanned, fetched, matched, leads_new, high, errors, pullpush_status}; ack.
//   Any other throw closes the run 'failed' with a fixed code and the counts so far, and acks: the next slot is the
//   retry, as with pg_cron.
// Wall-time budget (REDDIT_WALL_STOP_MS, 10 min from the start of the message, as the Xometry tick): no subreddit
// starts and no post of a fetched answer is processed after it. The run then closes 'succeeded' with partial: true
// and the counts so far; the subreddit in progress and those not reached keep their last_scanned_at, so they stay
// due for the next tick. With the 30 s source timeout, one message thus ends well inside the 15-minute consumer
// limit and is always acked.
// shadow: steps 1-5b and the scoring run; nothing is written (no lead, no last_scanned_at) and no text is sent;
// the output counts matched posts and carries shadow: true.
// Dropped from live: the call to the RPC increment_keyword_match_count (the function does not exist live).

import { readFlag } from '../agents/flags';
import type { Db } from '../db/postgrest';
import { DbError } from '../db/postgrest';
import type { ClockPort } from '../ports/index';
import type { P5Ports } from '../ports/p5';
import type { RedditTierParams } from '../queues/messages';
import type { P5ScrapeHandler } from '../queues/scrapes-p5';
import {
  closeQuietly,
  CollectorError,
  countStatus,
  errorCode,
  isRedditTierParams,
  logCollector,
  portsOf,
  realSleep,
  runState,
  SOURCE_TIMEOUT_MS,
  type CollectorOptions,
} from './common';
import { loadKeywords, matchKeywords, type Keyword } from './keywords';
import { redditLeadAlert } from './telegram-lead';

export const REDDIT_FLAG = 'agent.growth.reddit' as const;
/** User-Agent of the live PullPush requests. */
export const PULLPUSH_USER_AGENT = 'MicronsHubLeadMonitor/1.0';
/** Pause after each scanned subreddit (live). */
export const REDDIT_PAUSE_MS = 500;
/** scan_interval_minutes when the row has none (live). */
export const DEFAULT_SCAN_INTERVAL_MIN = 30;
/** Wall-time budget of one tier message (the queue consumer may run for at most 15 minutes). */
export const REDDIT_WALL_STOP_MS = 10 * 60_000;

/** A PullPush submission (the fields the live collector reads). */
export interface RedditPost {
  id: unknown;
  title: unknown;
  selftext: unknown;
  author: unknown;
  permalink: unknown;
  url?: unknown;
  score: unknown;
  num_comments: unknown;
  created_utc: unknown;
  subreddit: unknown;
}

interface SubredditRow {
  subreddit: string;
  tier: number | null;
  scan_interval_minutes: number | null;
  last_scanned_at: string | null;
}

export interface RedditTierOutput {
  tier: number;
  due: number;
  scanned: number;
  fetched: number;
  matched: number;
  leads_new: number;
  high: number;
  errors: number;
  pullpush_status: Record<string, number>;
  /** Set when the wall-time budget ended the scan before every due subreddit was done. */
  partial?: true;
  shadow?: true;
}

/** Pure: the live due rule (never scanned, or the interval has passed). */
export function isDue(row: Pick<SubredditRow, 'last_scanned_at' | 'scan_interval_minutes'>, nowMs: number): boolean {
  if (!row.last_scanned_at) return true;
  const intervalMs = (row.scan_interval_minutes || DEFAULT_SCAN_INTERVAL_MIN) * 60 * 1000;
  return nowMs - new Date(row.last_scanned_at).getTime() >= intervalMs;
}

/** Pure: the PullPush search URL of the live collector. */
export function pullpushUrl(base: string, subreddit: string, lastScannedAt: string | null): string {
  const params = new URLSearchParams({ subreddit, sort: 'new', sort_type: 'created_utc', size: '100' });
  if (lastScannedAt) params.set('after', String(Math.floor(new Date(lastScannedAt).getTime() / 1000)));
  return `${base}/reddit/search/submission?${params.toString()}`;
}

/** Pure: the leads row the live collector upserts for a scored post. */
export function redditLeadRow(post: RedditPost, m: ReturnType<typeof matchKeywords>): Record<string, unknown> {
  const permalink = (post.permalink as string) || `/r/${post.subreddit}/comments/${post.id}/`;
  const sourceUrl = `https://reddit.com${permalink}`;
  const postCreatedAt = new Date((post.created_utc as number) * 1000).toISOString();
  return {
    source: 'reddit',
    external_id: post.id,
    source_url: sourceUrl,
    source_id: post.id,
    subreddit: `r/${post.subreddit}`,
    title: post.title,
    body: (post.selftext as string) || null,
    url: sourceUrl,
    author: post.author,
    author_url: `https://reddit.com/u/${post.author}`,
    score: post.score,
    num_comments: post.num_comments,
    upvotes: post.score,
    comments_count: post.num_comments,
    lead_score: m.score,
    auto_score: m.score,
    matched_keywords: m.matched,
    matched_categories: m.categories,
    post_created_at: postCreatedAt,
    posted_at: postCreatedAt,
  };
}

interface ScanContext {
  db: Db;
  p5: P5Ports;
  clock: ClockPort;
  shadow: boolean;
  sleep: (ms: number) => Promise<void>;
  keywords: Keyword[];
  out: RedditTierOutput;
  /** Epoch ms after which no subreddit starts and no post is processed. */
  stopAt: number;
}

/** Thrown inside a subreddit when the wall-time budget has passed (never counted as an error). */
class WallTimeStop extends Error {
  constructor() {
    super('wall_time');
    this.name = 'WallTimeStop';
  }
}

const pastBudget = (c: ScanContext): boolean => c.clock.now().getTime() >= c.stopAt;

/** Fetch, score and (unless shadow) store one subreddit's new posts; the live collectSubreddit. */
async function collectSubreddit(c: ScanContext, subreddit: string, lastScannedAt: string | null): Promise<void> {
  const url = pullpushUrl(c.p5.sources.base('pullpush'), subreddit, lastScannedAt);
  let response: Response;
  try {
    response = await c.p5.sources.fetch(url, { headers: { 'User-Agent': PULLPUSH_USER_AGENT }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  } catch {
    countStatus(c.out.pullpush_status, 'error');
    throw new CollectorError('pullpush_unreachable');
  }
  countStatus(c.out.pullpush_status, response.status);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return;
  }
  const json = (await response.json()) as { data?: unknown };
  const posts = (json.data ?? []) as Iterable<RedditPost>;
  for (const post of posts) {
    // shadow writes nothing, so only the writing modes check the budget per post
    if (!c.shadow && pastBudget(c)) throw new WallTimeStop();
    c.out.fetched++;
    const text = `${post.title} ${(post.selftext as string) || ''}`;
    const m = matchKeywords(text, c.keywords, 'reddit');
    if (m.score === 'noise') continue;
    c.out.matched++;
    const row = redditLeadRow(post, m);
    if (c.shadow) continue;
    let inserted: unknown[];
    try {
      inserted = await c.db.insert('leads', row, { onConflict: ['source_url'], ignoreDuplicates: true, returning: 'id' });
    } catch (e) {
      if (!(e instanceof DbError)) throw e;
      c.out.errors++;
      continue;
    }
    if (inserted.length === 0) continue; // already stored: no count, no alert (D-14)
    c.out.leads_new++;
    if (m.score === 'high') {
      c.out.high++;
      await c.p5.telegramText.send(redditLeadAlert(post, m, c.clock.now().getTime()), { disableWebPagePreview: true });
    }
  }
}

/** The tier scan (steps 3-5); fills c.out. */
async function scanTier(c: ScanContext, params: RedditTierParams): Promise<void> {
  const rows = await c.db.select<SubredditRow & Record<string, unknown>>('monitored_subreddits', {
    columns: 'subreddit,tier,scan_interval_minutes,last_scanned_at',
    filters: [
      ['is_active', 'eq', true],
      ['source', 'eq', 'reddit'],
      // tier <= N (integer column)
      ['tier', 'lt', params.tier + 1],
    ],
    order: [{ column: 'tier', ascending: true }],
  });
  const now = c.clock.now().getTime();
  const due = rows.filter((r) => isDue(r, now)).slice(0, params.max);
  c.out.due = due.length;
  c.keywords = await loadKeywords(c.db);

  for (const sub of due) {
    if (pastBudget(c)) {
      c.out.partial = true;
      break;
    }
    try {
      const fresh = await c.db.select<Pick<SubredditRow, 'last_scanned_at' | 'scan_interval_minutes'> & Record<string, unknown>>('monitored_subreddits', {
        columns: 'last_scanned_at,scan_interval_minutes',
        filters: [['subreddit', 'eq', sub.subreddit]],
        limit: 1,
      });
      if (fresh[0] && !isDue(fresh[0], c.clock.now().getTime())) continue;
      await collectSubreddit(c, sub.subreddit, sub.last_scanned_at);
      if (!c.shadow) {
        await c.db.update('monitored_subreddits', { last_scanned_at: c.clock.now().toISOString() }, { filters: [['subreddit', 'eq', sub.subreddit]] });
      }
      c.out.scanned++;
      await c.sleep(REDDIT_PAUSE_MS);
    } catch (e) {
      if (e instanceof WallTimeStop) {
        c.out.partial = true;
        break;
      }
      c.out.errors++;
    }
  }
}

export function makeRedditTierHandler(o: CollectorOptions = {}): P5ScrapeHandler {
  const sleep = o.sleep ?? realSleep;
  return async (msg, env, _ctx, deps) => {
    const runId = msg.body.run_id;
    const { ports, p5 } = portsOf(env, deps);
    const stopAt = ports.clock.now().getTime() + REDDIT_WALL_STOP_MS;
    const db = ports.db;
    if (msg.body.kind !== 'reddit-tier' || !isRedditTierParams(msg.body.params)) {
      await closeQuietly(db, runId, { status: 'failed', error: 'invalid_params' }, 'reddit');
      logCollector('reddit', { run_id: runId, outcome: 'invalid_params' });
      msg.ack();
      return;
    }
    const params = msg.body.params;
    const state = await runState(db, runId);
    if (state !== 'running') {
      logCollector('reddit', { tier: params.tier, run_id: runId, outcome: state === 'final' ? 'already_closed' : 'run_missing' });
      msg.ack();
      return;
    }
    const flag = await readFlag(env, REDDIT_FLAG);
    if (!flag.enabled) {
      await closeQuietly(db, runId, { status: 'skipped', output: { reason: 'flag_off', tier: params.tier } }, 'reddit');
      logCollector('reddit', { tier: params.tier, run_id: runId, outcome: 'flag_off' });
      msg.ack();
      return;
    }
    const shadow = flag.mode === 'shadow';
    const out: RedditTierOutput = { tier: params.tier, due: 0, scanned: 0, fetched: 0, matched: 0, leads_new: 0, high: 0, errors: 0, pullpush_status: {} };
    if (shadow) out.shadow = true;
    const c: ScanContext = { db, p5, clock: ports.clock, shadow, sleep, keywords: [], out, stopAt };
    try {
      await scanTier(c, params);
    } catch (e) {
      const code = errorCode(e);
      await closeQuietly(db, runId, { status: 'failed', error: code, output: out }, 'reddit');
      logCollector('reddit', { tier: params.tier, run_id: runId, outcome: 'failed', error: code });
      msg.ack();
      return;
    }
    await closeQuietly(db, runId, { status: 'succeeded', output: out }, 'reddit');
    logCollector('reddit', {
      tier: params.tier,
      run_id: runId,
      outcome: 'succeeded',
      shadow: shadow || undefined,
      partial: out.partial,
      due: out.due,
      scanned: out.scanned,
      fetched: out.fetched,
      leads_new: out.leads_new,
      high: out.high,
      errors: out.errors,
    });
    msg.ack();
  };
}

export const handleRedditTier: P5ScrapeHandler = makeRedditTierHandler();
