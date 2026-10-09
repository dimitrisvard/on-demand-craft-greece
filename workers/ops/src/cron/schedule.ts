// Schedule table of the Phase 5 jobs, evaluated by the Phase 4 '* * * * *' tick (no new Cron Trigger). Pure: no
// I/O here; src/cron/run-schedule.ts reads the gates and starts the work.
//
// Rules
//   - Expressions are 5-field UTC cron (minute hour day-of-month month day-of-week; day of week 0 = Sunday …
//     6 = Saturday), read by this module's own matcher: '*', '*/n', 'a,b', 'a-b'.
//   - A slot is the minute an entry is due, written 'YYYY-MM-DDTHH:MMZ'; it is part of every run key and instance id,
//     so each slot runs at most once.
//   - Catch-up: an entry whose interval is at least 120 minutes also fires on any tick at most CATCH_UP_MIN minutes
//     after its slot when that slot has not fired; every other entry fires only in its own minute.
//   - Gates: a flag (enabled, plus the entry's own `when` on the flag) or a var that must be exactly "true".
//   - content-daily and sitemap are exclusive: sitemap runs alone only when the flag's value.steps is exactly
//     ["sitemap"] (switch-over stage S4); content-daily runs for every other steps value.

import type { FlagKey } from '../../../shared/src/agent-types';
import type { AgentFlag } from '../agents/flags';

export type JobId =
  | 'reddit-t1'
  | 'reddit-t2'
  | 'reddit-t3'
  | 'hn'
  | 'tenders'
  | 'xometry'
  | 'content-daily'
  | 'sitemap'
  | 'ops-digest'
  | 'marketing-followups'
  | 'marketing-warmup';

export interface ScheduleEntry {
  job: JobId;
  /** 5-field UTC expression. */
  cron: string;
  gate:
    | { flag: Extract<FlagKey, `agent.${string}`>; when?: (f: AgentFlag) => boolean }
    | { varName: 'MARKETING_FOLLOWUPS_ENABLED' | 'MARKETING_WARMUP_ENABLED' };
  action: 'workflow' | 'scrape' | 'inline';
}

/** True when value.steps is exactly ["sitemap"] (stage S4: the sitemap job runs alone). */
export function sitemapOnly(f: AgentFlag): boolean {
  const steps = f.value.steps;
  return Array.isArray(steps) && steps.length === 1 && steps[0] === 'sitemap';
}

export const SCHEDULE: readonly ScheduleEntry[] = Object.freeze([
  { job: 'reddit-t1', cron: '*/15 * * * *', gate: { flag: 'agent.growth.reddit' }, action: 'scrape' },
  { job: 'reddit-t2', cron: '*/30 * * * *', gate: { flag: 'agent.growth.reddit' }, action: 'scrape' },
  { job: 'reddit-t3', cron: '0 * * * *', gate: { flag: 'agent.growth.reddit' }, action: 'scrape' },
  { job: 'hn', cron: '*/30 * * * *', gate: { flag: 'agent.growth.hn' }, action: 'scrape' },
  { job: 'tenders', cron: '0 6 * * *', gate: { flag: 'agent.growth.tenders' }, action: 'scrape' },
  { job: 'xometry', cron: '0 6,8,10,12,14,16,18 * * *', gate: { flag: 'agent.growth.xometry' }, action: 'scrape' },
  { job: 'content-daily', cron: '0 7 * * *', gate: { flag: 'agent.content_daily', when: (f) => !sitemapOnly(f) }, action: 'workflow' },
  { job: 'sitemap', cron: '0 9 * * *', gate: { flag: 'agent.content_daily', when: sitemapOnly }, action: 'workflow' },
  { job: 'ops-digest', cron: '30 6 * * 1', gate: { flag: 'agent.ops_digest' }, action: 'workflow' },
  { job: 'marketing-followups', cron: '5 * * * *', gate: { varName: 'MARKETING_FOLLOWUPS_ENABLED' }, action: 'inline' },
  { job: 'marketing-warmup', cron: '5 0 * * *', gate: { varName: 'MARKETING_WARMUP_ENABLED' }, action: 'inline' },
] satisfies ScheduleEntry[]);

/** Minutes after its slot within which an entry with an interval of at least 120 minutes still fires. */
export const CATCH_UP_MIN = 60;

/** Field ranges of a 5-field expression: minute, hour, day of month, month, day of week (0 = Sunday). */
const FIELD_RANGES: ReadonlyArray<readonly [min: number, max: number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

interface ParsedCron {
  fields: ReadonlyArray<ReadonlySet<number>>;
  /** Day of month and day of week restricted (not '*'): either one matching is enough (Vixie cron rule). */
  domRestricted: boolean;
  dowRestricted: boolean;
}

const PARSED = new Map<string, ParsedCron>();

function parseField(text: string, [min, max]: readonly [number, number]): Set<number> {
  const out = new Set<number>();
  const int = (t: string): number => {
    if (!/^\d+$/.test(t)) throw new Error(`invalid cron field: ${text}`);
    const n = Number(t);
    if (n < min || n > max) throw new Error(`invalid cron field: ${text}`);
    return n;
  };
  for (const part of text.split(',')) {
    const step = /^\*\/(\d+)$/.exec(part);
    if (part === '*') {
      for (let n = min; n <= max; n++) out.add(n);
    } else if (step) {
      const every = Number(step[1]);
      if (every < 1) throw new Error(`invalid cron field: ${text}`);
      for (let n = min; n <= max; n += every) out.add(n);
    } else if (part.includes('-')) {
      const [a, b, ...rest] = part.split('-');
      if (rest.length > 0) throw new Error(`invalid cron field: ${text}`);
      const from = int(a ?? '');
      const to = int(b ?? '');
      if (from > to) throw new Error(`invalid cron field: ${text}`);
      for (let n = from; n <= to; n++) out.add(n);
    } else {
      out.add(int(part));
    }
  }
  return out;
}

function parseCron(expr: string): ParsedCron {
  const cached = PARSED.get(expr);
  if (cached) return cached;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`invalid cron expression: ${expr}`);
  const parsed: ParsedCron = {
    fields: parts.map((p, i) => parseField(p, FIELD_RANGES[i] as readonly [number, number])),
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  };
  PARSED.set(expr, parsed);
  return parsed;
}

/** True when the expression matches the UTC minute of `at` (field forms of the rules above). Throws on an invalid
 *  expression. When both day of month and day of week are restricted, either one matching is enough. */
export function cronMatches(expr: string, at: Date): boolean {
  const { fields, domRestricted, dowRestricted } = parseCron(expr);
  const [minute, hour, dom, month, dow] = fields as [ReadonlySet<number>, ReadonlySet<number>, ReadonlySet<number>, ReadonlySet<number>, ReadonlySet<number>];
  if (!minute.has(at.getUTCMinutes()) || !hour.has(at.getUTCHours()) || !month.has(at.getUTCMonth() + 1)) return false;
  const domOk = dom.has(at.getUTCDate());
  const dowOk = dow.has(at.getUTCDay());
  return domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
}

const MINUTE_MS = 60_000;

/** `at` truncated to its UTC minute. */
export function minuteOf(at: Date | number): Date {
  const t = typeof at === 'number' ? at : at.getTime();
  return new Date(Math.floor(t / MINUTE_MS) * MINUTE_MS);
}

/**
 * The slot of `expr` that a tick at `at` should fire: `at` itself when it matches (catchUp false); else, when
 * catchUpMin > 0, the latest matching minute at most catchUpMin minutes before `at` (catchUp true); else null.
 * `at` is taken at its UTC minute.
 */
export function slotFor(expr: string, at: Date, catchUpMin: number): { slot: Date; catchUp: boolean } | null {
  const tick = minuteOf(at);
  if (cronMatches(expr, tick)) return { slot: tick, catchUp: false };
  for (let back = 1; back <= catchUpMin; back++) {
    const candidate = new Date(tick.getTime() - back * MINUTE_MS);
    if (cronMatches(expr, candidate)) return { slot: candidate, catchUp: true };
  }
  return null;
}

/** Window over which the shortest interval of an expression is measured (8 days, so a weekly entry shows it). */
const INTERVAL_WINDOW_MIN = 8 * 24 * 60;
/** A fixed Monday 00:00 UTC as the start of the measuring window (the result does not depend on the date for the
 *  forms this matcher reads, except day-of-month and month entries, which only get longer intervals). */
const INTERVAL_EPOCH = Date.UTC(2026, 0, 5);
const INTERVALS = new Map<string, number>();

/** Shortest gap in minutes between two consecutive matches of `expr` (the window length when it matches at most
 *  once in the window). Walks only the matching hours and minutes of each day of the window, so the first tick of an
 *  isolate stays cheap. */
export function intervalMinutes(expr: string): number {
  const cached = INTERVALS.get(expr);
  if (cached !== undefined) return cached;
  const { fields } = parseCron(expr);
  const minutes = [...(fields[0] as ReadonlySet<number>)].sort((a, b) => a - b);
  const hours = [...(fields[1] as ReadonlySet<number>)].sort((a, b) => a - b);
  let previous: number | null = null;
  let shortest = INTERVAL_WINDOW_MIN;
  for (let day = 0; day < INTERVAL_WINDOW_MIN / (24 * 60); day++) {
    const midnight = INTERVAL_EPOCH + day * 24 * 60 * MINUTE_MS;
    // The day fields depend on the date only: one full check at the day's first candidate minute decides the day.
    if (!cronMatches(expr, new Date(midnight + ((hours[0] ?? 0) * 60 + (minutes[0] ?? 0)) * MINUTE_MS))) continue;
    for (const h of hours) {
      for (const m of minutes) {
        const at = day * 24 * 60 + h * 60 + m;
        if (previous !== null) shortest = Math.min(shortest, at - previous);
        previous = at;
      }
    }
  }
  INTERVALS.set(expr, shortest);
  return shortest;
}

/** Shortest interval (minutes) of an entry that gets the catch-up window. */
export const CATCH_UP_MIN_INTERVAL = 120;

/** The catch-up window of an entry: CATCH_UP_MIN when its interval is at least 120 minutes, else 0. */
export function catchUpWindow(entry: Pick<ScheduleEntry, 'cron'>): number {
  return intervalMinutes(entry.cron) >= CATCH_UP_MIN_INTERVAL ? CATCH_UP_MIN : 0;
}

/** 'YYYY-MM-DDTHH:MMZ' of a slot. */
export function slotKey(slot: Date): string {
  return `${slot.toISOString().slice(0, 16)}Z`;
}

/** The entries due at a tick (by scheduledTime, epoch ms), with their slot and whether it is a catch-up. */
export function dueJobs(scheduledTime: number): Array<{ job: JobId; slot: string; catchUp: boolean }> {
  const at = new Date(scheduledTime);
  const out: Array<{ job: JobId; slot: string; catchUp: boolean }> = [];
  for (const entry of SCHEDULE) {
    const due = slotFor(entry.cron, at, catchUpWindow(entry));
    if (due) out.push({ job: entry.job, slot: slotKey(due.slot), catchUp: due.catchUp });
  }
  return out;
}
