// Weekly figures of the ops digest (PHASE5_SPEC §6.6; AGENTS.md §3.6 step `collect`), read through the Phase 4 Db
// port with the service role. No SQL function is added: every figure is a PostgREST read of plain columns, counted
// or summed in the Worker over pages of at most 1,000 rows.
//
// Rules
//   - The digest named by iso_week (the ISO week of the Monday it is sent, = the instance id) reports the ISO week
//     before it: [Monday(iso_week) - 7 days, Monday(iso_week)) in UTC.
//   - Each figure has exactly the definition of scripts/phase5/parity.sql Q12b, so the owner's spot check reads the
//     same numbers: RFQs by created_at; quotes sent by sent_at; quote outcomes (won, lost, expired, counter_offer) by
//     last_event_at; win rate = won / (won + lost + expired); median hours from rfqs.created_at to sent_at of the
//     quotes sent; orders by created_at per currency (count, total, production costs, margin); agent_runs by
//     started_at (runs, failed, skipped, USD); articles by created_at per language (any status); translation lag
//     per language = newest published English created_at date - newest published created_at date of the language,
//     both before the end of the week; leads by discovered_at per source and UTC day; tenders by discovered_at per
//     UTC day; the newest reddit lead before the end of the week; marketing_events by created_at per event_type;
//     unprocessed article_titles (processed = false) when the digest runs (point in time).
//   - Money and cost are summed exactly (BigInt in micro units) and rounded half away from zero, as numeric round().
//   - Pages are keyed by id (the port has no offset): order id ascending, the next page starts at the last id read.
//   - The result holds figures only: no names, e-mail addresses, message text or customer data.

import type { Db, Filter, Row } from '../db/postgrest';

export const PAGE_ROWS = 1000;
const DAY_MS = 86_400_000;

/** The 13 target languages in the order of the live translation job. */
export const DIGEST_TARGET_LANGS = ['de', 'fr', 'es', 'it', 'nl', 'pt', 'sv', 'da', 'nb', 'pl', 'cs', 'hu', 'fi'] as const;
export const QUOTE_OUTCOMES = ['won', 'lost', 'expired', 'counter_offer'] as const;

export interface DigestWindow {
  /** ISO week of the Monday the digest is sent (instance id and run key). */
  iso_week: string;
  /** ISO week the figures describe (the week before iso_week). */
  report_week: string;
  /** Inclusive start, ISO timestamp (Monday 00:00 UTC of report_week). */
  start: string;
  /** Exclusive end, ISO timestamp (Monday 00:00 UTC of iso_week). */
  end: string;
}

export interface DigestMetrics {
  window: DigestWindow;
  pipeline: { rfqs: number; by_source: Record<string, number> };
  quotes: {
    sent: number;
    outcomes: Record<(typeof QUOTE_OUTCOMES)[number], number>;
    /** One decimal, or null when no quote was won, lost or expired in the week. */
    win_rate_pct: string | null;
    /** One decimal, or null when no quote was sent. */
    median_hours_rfq_to_sent: string | null;
  };
  orders: Array<{ currency: string; count: number; total: string; production_costs: string; margin_pct: string | null }>;
  agents: { total_usd: string; runs: number; by_agent: Array<{ agent: string; runs: number; failed: number; skipped: number; usd: string }> };
  content: {
    articles: number;
    articles_by_language: Record<string, number>;
    lag_days: Record<string, number | null>;
    /** Unprocessed article_titles when the digest runs (point in time). */
    titles_left: number;
  };
  collectors: {
    leads: number;
    leads_by_source_day: Array<{ source: string; day: string; count: number }>;
    tenders: number;
    tenders_by_day: Array<{ day: string; count: number }>;
    last_reddit_lead: string | null;
  };
  marketing: { events: Record<string, number> };
}

// ---------------------------------------------------------------------------------------------------------------
// ISO weeks

/** Monday 00:00 UTC of an ISO week 'YYYY-Www', or null when the text is not a week that exists. */
export function isoWeekMonday(isoWeek: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = Date.UTC(year, 0, 4);
  const dow = new Date(jan4).getUTCDay() || 7;
  const monday = new Date(jan4 - (dow - 1) * DAY_MS + (week - 1) * 7 * DAY_MS);
  return isoWeekOf(monday) === isoWeek ? monday : null;
}

/** 'YYYY-Www' of a date (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The reported window of a digest; null for an invalid week. */
export function reportWindow(isoWeek: string): DigestWindow | null {
  const monday = isoWeekMonday(isoWeek);
  if (!monday) return null;
  const start = new Date(monday.getTime() - 7 * DAY_MS);
  return { iso_week: isoWeek, report_week: isoWeekOf(start), start: start.toISOString(), end: monday.toISOString() };
}

/** True when the Monday of the ISO week is the first Monday of its month (UTC). */
export function isFirstMondayOfMonth(isoWeek: string): boolean {
  const monday = isoWeekMonday(isoWeek);
  return monday !== null && monday.getUTCDate() <= 7;
}

// ---------------------------------------------------------------------------------------------------------------
// Exact arithmetic (numeric semantics)

const MICRO = 1_000_000n;

/** A numeric column value in micro units (6 decimals, exact for the values PostgREST returns); null for no value. */
export function toMicro(v: unknown): bigint | null {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(6) : '') : String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(7, '0');
  let units = BigInt(m[2]) * MICRO + BigInt(frac.slice(0, 6));
  if (Number(frac[6]) >= 5) units += 1n;
  return m[1] === '-' ? -units : units;
}

/** n / d rounded half away from zero (d > 0), as numeric round(). */
export function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  if ((a % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}

/** An integer count of 10^-decimals as a fixed-point text ("1240.30"). */
export function fixed(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const a = (neg ? -units : units).toString().padStart(decimals + 1, '0');
  const text = decimals === 0 ? a : `${a.slice(0, a.length - decimals)}.${a.slice(a.length - decimals)}`;
  return neg ? `-${text}` : text;
}

/** micro units rounded to `decimals` places as text. */
export function microFixed(micro: bigint, decimals: number): string {
  return fixed(divRound(micro, 10n ** BigInt(6 - decimals)), decimals);
}

/** 100 * part / whole with one decimal (half away from zero), or null when whole is 0. */
export function percent1(part: bigint, whole: bigint): string | null {
  if (whole === 0n) return null;
  return fixed(divRound(1000n * part, whole), 1);
}

/** A float rounded half away from zero to one decimal, as round(x::numeric, 1). */
export function round1(x: number): string {
  const r = Math.sign(x) * Math.round(Math.abs(x) * 10);
  return (r / 10).toFixed(1);
}

/** percentile_cont(0.5) of the values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  const lo = s[Math.floor(mid)];
  const hi = s[Math.ceil(mid)];
  return lo + (hi - lo) * (mid - Math.floor(mid));
}

/** UTC date 'YYYY-MM-DD' of a timestamp value; null when it does not parse. */
export function utcDay(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function inc(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function sortedRecord(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------------------------------------------------------------------------------------------------------------
// Reads

/** Every row of `table` matching the filters, in id order, read in pages of PAGE_ROWS. */
export async function readAll<T extends Row>(db: Db, table: string, columns: string, filters: readonly Filter[], pageRows = PAGE_ROWS): Promise<T[]> {
  const cols = columns.split(',').map((c) => c.trim()).filter(Boolean);
  if (!cols.includes('id')) cols.unshift('id');
  const size = Math.max(2, pageRows);
  const out: T[] = [];
  let last: string | null = null;
  for (;;) {
    const page: Filter[] = [...filters];
    if (last !== null) page.push(['id', 'gte', last]);
    const rows = await db.select<T>(table, { columns: cols.join(','), filters: page, order: [{ column: 'id', ascending: true }], limit: size });
    const fresh = last !== null && rows.length > 0 && String(rows[0].id) === last ? rows.slice(1) : rows;
    out.push(...fresh);
    if (rows.length < size || fresh.length === 0) break;
    last = String(rows[rows.length - 1].id);
  }
  return out;
}

function inWindow(column: string, w: DigestWindow): Filter[] {
  return [[column, 'gte', w.start], [column, 'lt', w.end]];
}

/** Created_at of the newest row matching the filters (one request), or null. */
async function newest(db: Db, table: string, column: string, filters: readonly Filter[]): Promise<string | null> {
  const rows = await db.select<Row>(table, { columns: column, filters, order: [{ column, ascending: false }], limit: 1 });
  const v = rows[0]?.[column];
  return typeof v === 'string' ? v : null;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback;
}

// ---------------------------------------------------------------------------------------------------------------
// The figures

export async function collectPipeline(db: Db, w: DigestWindow): Promise<DigestMetrics['pipeline']> {
  const rows = await readAll<Row>(db, 'rfqs', 'id,source', inWindow('created_at', w));
  const by_source: Record<string, number> = {};
  for (const r of rows) inc(by_source, str(r.source, 'web'));
  return { rfqs: rows.length, by_source: sortedRecord(by_source) };
}

export async function collectQuotes(db: Db, w: DigestWindow): Promise<DigestMetrics['quotes']> {
  const sent = await readAll<Row>(db, 'quote_workflows', 'id,rfq_id,sent_at', inWindow('sent_at', w));
  const outcomeRows = await readAll<Row>(db, 'quote_workflows', 'id,status', [['status', 'in', [...QUOTE_OUTCOMES]], ...inWindow('last_event_at', w)]);
  const outcomes = { won: 0, lost: 0, expired: 0, counter_offer: 0 };
  for (const r of outcomeRows) {
    const s = String(r.status) as keyof typeof outcomes;
    if (s in outcomes) outcomes[s] += 1;
  }
  const decided = BigInt(outcomes.won + outcomes.lost + outcomes.expired);
  const win_rate_pct = percent1(BigInt(outcomes.won), decided);

  // median hours from the RFQ's creation to the quote's sending (rfqs read in chunks of 100 ids)
  const rfqIds = [...new Set(sent.map((r) => String(r.rfq_id)).filter((id) => id && id !== 'null'))];
  const created = new Map<string, number>();
  for (let i = 0; i < rfqIds.length; i += 100) {
    const rows = await db.select<Row>('rfqs', { columns: 'id,created_at', filters: [['id', 'in', rfqIds.slice(i, i + 100)]] });
    for (const r of rows) {
      const t = typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN;
      if (Number.isFinite(t)) created.set(String(r.id), t);
    }
  }
  const hours: number[] = [];
  for (const q of sent) {
    const c = created.get(String(q.rfq_id));
    const s = typeof q.sent_at === 'string' ? Date.parse(q.sent_at) : NaN;
    if (c !== undefined && Number.isFinite(s)) hours.push((s - c) / 3_600_000);
  }
  const med = median(hours);
  return { sent: sent.length, outcomes, win_rate_pct, median_hours_rfq_to_sent: med === null ? null : round1(med) };
}

export async function collectOrders(db: Db, w: DigestWindow): Promise<DigestMetrics['orders']> {
  const rows = await readAll<Row>(db, 'orders', 'id,currency,total_amount,total_production_costs', inWindow('created_at', w));
  const groups = new Map<string, { count: number; total: bigint | null; costs: bigint | null }>();
  for (const r of rows) {
    const currency = str(r.currency, '?');
    const g = groups.get(currency) ?? { count: 0, total: null, costs: null };
    g.count += 1;
    const t = toMicro(r.total_amount);
    const c = toMicro(r.total_production_costs);
    if (t !== null) g.total = (g.total ?? 0n) + t;
    if (c !== null) g.costs = (g.costs ?? 0n) + c;
    groups.set(currency, g);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, g]) => ({
      currency,
      count: g.count,
      total: microFixed(g.total ?? 0n, 2),
      production_costs: microFixed(g.costs ?? 0n, 2),
      margin_pct: g.total === null || g.total === 0n ? null : percent1(g.total - (g.costs ?? 0n), g.total),
    }));
}

export async function collectAgents(db: Db, w: DigestWindow): Promise<DigestMetrics['agents']> {
  const rows = await readAll<Row>(db, 'agent_runs', 'id,agent,status,cost_cents', inWindow('started_at', w));
  const per = new Map<string, { runs: number; failed: number; skipped: number; cents: bigint }>();
  let cents = 0n;
  for (const r of rows) {
    const agent = str(r.agent, '?');
    const a = per.get(agent) ?? { runs: 0, failed: 0, skipped: 0, cents: 0n };
    a.runs += 1;
    if (r.status === 'failed') a.failed += 1;
    if (r.status === 'skipped') a.skipped += 1;
    const c = toMicro(r.cost_cents) ?? 0n;
    a.cents += c;
    cents += c;
    per.set(agent, a);
  }
  // cost_cents is in USD cents, so USD with two decimals is the cent amount rounded to a whole cent
  const usd = (microCents: bigint) => fixed(divRound(microCents, MICRO), 2);
  return {
    total_usd: rows.length === 0 ? '0' : usd(cents),
    runs: rows.length,
    by_agent: [...per.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([agent, a]) => ({ agent, runs: a.runs, failed: a.failed, skipped: a.skipped, usd: usd(a.cents) })),
  };
}

export async function collectContent(db: Db, w: DigestWindow): Promise<DigestMetrics['content']> {
  const rows = await readAll<Row>(db, 'articles', 'id,language', inWindow('created_at', w));
  const byLang: Record<string, number> = {};
  for (const r of rows) inc(byLang, str(r.language, '?'));
  const newestDay = async (lang: string) =>
    utcDay(await newest(db, 'articles', 'created_at', [['language', 'eq', lang], ['status', 'eq', 'published'], ['created_at', 'lt', w.end]]));
  const en = await newestDay('en');
  const lag_days: Record<string, number | null> = {};
  for (const lang of DIGEST_TARGET_LANGS) {
    const d = await newestDay(lang);
    lag_days[lang] = en === null || d === null ? null : Math.round((Date.parse(`${en}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / DAY_MS);
  }
  const titles = await readAll<Row>(db, 'article_titles', 'id', [['processed', 'eq', false]]);
  return { articles: rows.length, articles_by_language: sortedRecord(byLang), lag_days, titles_left: titles.length };
}

export async function collectCollectors(db: Db, w: DigestWindow): Promise<DigestMetrics['collectors']> {
  const leads = await readAll<Row>(db, 'leads', 'id,source,discovered_at', inWindow('discovered_at', w));
  const leadKey = new Map<string, { source: string; day: string; count: number }>();
  for (const r of leads) {
    const source = str(r.source, '?');
    const day = utcDay(r.discovered_at) ?? '?';
    const k = `${source}\u0000${day}`;
    const e = leadKey.get(k) ?? { source, day, count: 0 };
    e.count += 1;
    leadKey.set(k, e);
  }
  const tenders = await readAll<Row>(db, 'tenders', 'id,discovered_at', inWindow('discovered_at', w));
  const tenderDays: Record<string, number> = {};
  for (const r of tenders) inc(tenderDays, utcDay(r.discovered_at) ?? '?');
  const lastReddit = utcDay(await newest(db, 'leads', 'discovered_at', [['source', 'eq', 'reddit'], ['discovered_at', 'lt', w.end]]));
  return {
    leads: leads.length,
    leads_by_source_day: [...leadKey.values()].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    tenders: tenders.length,
    tenders_by_day: Object.entries(sortedRecord(tenderDays)).map(([day, count]) => ({ day, count })),
    last_reddit_lead: lastReddit,
  };
}

export async function collectMarketing(db: Db, w: DigestWindow): Promise<DigestMetrics['marketing']> {
  const rows = await readAll<Row>(db, 'marketing_events', 'id,event_type', inWindow('created_at', w));
  const events: Record<string, number> = {};
  for (const r of rows) inc(events, str(r.event_type, '?'));
  return { events: sortedRecord(events) };
}

/** Every weekly figure of the digest (the `collect` step). */
export async function collectMetrics(db: Db, w: DigestWindow): Promise<DigestMetrics> {
  return {
    window: w,
    pipeline: await collectPipeline(db, w),
    quotes: await collectQuotes(db, w),
    orders: await collectOrders(db, w),
    agents: await collectAgents(db, w),
    content: await collectContent(db, w),
    collectors: await collectCollectors(db, w),
    marketing: await collectMarketing(db, w),
  };
}
