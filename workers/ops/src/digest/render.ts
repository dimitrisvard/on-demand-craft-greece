// The ops digest as an e-mail and a Telegram line (PHASE5_SPEC §6.6; AGENTS.md §3.6 "Human view").
//
// Rules
//   - Sections, in order: Summary (the narrative), Pipeline, Quotes, Orders and margin, Agents and cost, Content and
//     lag, Collectors, Marketing, Stuck items (with dashboard links).
//   - figureRows() lists every figure as (section, figure, value) with exactly the labels and number formats of
//     scripts/phase5/parity.sql Q12b, so the owner can compare the e-mail with the SQL spot check row by row; the
//     plain-text part of the e-mail is made of these rows.
//   - Every value written into HTML is escaped; narrative lines are model output and are escaped like any value.
//   - Nothing here contains the recipient address, customer names or message text: the inputs are figures, ids and
//     times only.
//   - Telegram: one plain line "Digest W<ww> sent: <n> RFQs, <m> quotes, win rate <x> %" (ww = the reported week).

import { DIGEST_TARGET_LANGS, type DigestMetrics } from './collect';
import type { StuckReport } from './stuck';

export const DIGEST_SECTIONS = ['summary', 'pipeline', 'quotes', 'orders', 'agents', 'content', 'collectors', 'marketing', 'stuck'] as const;
export type DigestSection = (typeof DIGEST_SECTIONS)[number];

export interface FigureRow {
  section: Exclude<DigestSection, 'summary'>;
  figure: string;
  value: string;
}

export interface NarrativeResult {
  ok: boolean;
  /** Up to five lines when ok. */
  lines: string[];
  /** Failure code when not ok (e.g. 'llm_unavailable', 'schema'). */
  code?: string;
}

export interface RenderedDigest {
  subject: string;
  text: string;
  html: string;
}

const NA = 'n/a';

/** Every figure of the digest in the layout of parity.sql Q12b (same labels and number formats). */
export function figureRows(m: DigestMetrics, s: StuckReport): FigureRow[] {
  const rows: FigureRow[] = [];
  const add = (section: FigureRow['section'], figure: string, value: string | number) => rows.push({ section, figure, value: String(value) });
  for (const [source, n] of Object.entries(m.pipeline.by_source)) add('pipeline', `rfqs ${source}`, n);
  add('quotes', 'sent', m.quotes.sent);
  for (const [status, n] of Object.entries(m.quotes.outcomes)) if (n > 0) add('quotes', `outcome ${status}`, n);
  add('quotes', 'win rate % (won / (won + lost + expired))', m.quotes.win_rate_pct ?? NA);
  add('quotes', 'median hours rfq to sent', m.quotes.median_hours_rfq_to_sent ?? NA);
  for (const o of m.orders) {
    add('orders', `orders ${o.currency}: count / total / production costs / margin %`, `${o.count} / ${o.total} / ${o.production_costs} / ${o.margin_pct ?? NA}`);
  }
  for (const a of m.agents.by_agent) add('agents', `${a.agent}: runs / failed / skipped / usd`, `${a.runs} / ${a.failed} / ${a.skipped} / ${a.usd}`);
  add('agents', 'total usd', m.agents.total_usd);
  for (const [lang, n] of Object.entries(m.content.articles_by_language)) add('content', `articles ${lang}`, n);
  for (const lang of DIGEST_TARGET_LANGS) add('content', `lag days ${lang}`, m.content.lag_days[lang] ?? NA);
  add('content', 'titles left (now)', m.content.titles_left);
  for (const l of m.collectors.leads_by_source_day) add('collectors', `leads ${l.source} ${l.day}`, l.count);
  for (const t of m.collectors.tenders_by_day) add('collectors', `tenders ${t.day}`, t.count);
  add('collectors', 'last reddit lead (before the week end)', m.collectors.last_reddit_lead ?? 'none');
  for (const [type, n] of Object.entries(m.marketing.events)) add('marketing', `events ${type}`, n);
  for (const [agent, n] of Object.entries(s.queue_failures)) add('stuck', `queue final failures ${agent}`, n);
  add('stuck', 'cad jobs failed, timed out or dead-lettered', s.cad_failed);
  add('stuck', 'runs running or waiting > 48 h (now)', s.stale_runs.count);
  add('stuck', 'quotes awaiting approval (now)', s.quotes_awaiting_approval.count);
  return rows;
}

/** The input of the narrative prompt: the figures only (counts, rates, amounts), no ids and no customer text. */
export function narrativeInput(m: DigestMetrics, s: StuckReport): Record<string, unknown> {
  return {
    week: m.window.report_week,
    period_utc: { from: m.window.start, to_exclusive: m.window.end },
    pipeline: m.pipeline,
    quotes: m.quotes,
    orders: m.orders,
    agents: m.agents,
    content: m.content,
    collectors: {
      leads: m.collectors.leads,
      tenders: m.collectors.tenders,
      leads_by_source: m.collectors.leads_by_source_day.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + l.count }), {}),
      last_reddit_lead: m.collectors.last_reddit_lead,
    },
    marketing: m.marketing,
    stuck: {
      runs_older_than_48h: s.stale_runs.count,
      quotes_awaiting_approval: s.quotes_awaiting_approval.count,
      queue_final_failures: s.queue_failures,
      cad_jobs_failed: s.cad_failed,
    },
  };
}

/** At most five non-empty lines of at most 300 characters from a model answer (anything else is dropped). */
export function narrativeLines(value: unknown): string[] | null {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { lines?: unknown }).lines)) return null;
  const lines = ((value as { lines: unknown[] }).lines)
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .map((l) => (l.length > 300 ? `${l.slice(0, 299)}…` : l));
  return lines.length > 0 ? lines.slice(0, 5) : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function weekNumber(isoWeek: string): string {
  return isoWeek.slice(isoWeek.indexOf('-W') + 1);
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** The last day of the reported week (the day before the exclusive end). */
function lastDay(m: DigestMetrics): string {
  return new Date(Date.parse(m.window.end) - 86_400_000).toISOString().slice(0, 10);
}

export function digestSubject(m: DigestMetrics): string {
  return `MicronsHub ops digest ${m.window.report_week} (${dayOf(m.window.start)} to ${lastDay(m)})`;
}

/** "Digest W41 sent: 3 RFQs, 2 quotes, win rate 50.0 %". */
export function telegramLine(m: DigestMetrics): string {
  return `Digest ${weekNumber(m.window.report_week)} sent: ${m.pipeline.rfqs} RFQs, ${m.quotes.sent} quotes, win rate ${m.quotes.win_rate_pct ?? NA} %`;
}

const SECTION_TITLES: Record<DigestSection, string> = {
  summary: 'Summary',
  pipeline: 'Pipeline',
  quotes: 'Quotes',
  orders: 'Orders and margin',
  agents: 'Agents and cost',
  content: 'Content and lag',
  collectors: 'Collectors',
  marketing: 'Marketing',
  stuck: 'Stuck items',
};

function narrativeText(n: NarrativeResult): string[] {
  return n.ok && n.lines.length > 0 ? n.lines : [`Summary unavailable this week (${n.code ?? 'unknown'}); the figures below are complete.`];
}

/** Links of the stuck lists (dashboard pages of the agent layer). */
function stuckLinks(s: StuckReport, origin: string): { runs: Array<{ label: string; href: string }>; quotes: Array<{ label: string; href: string }> } {
  return {
    runs: s.stale_runs.items.map((r) => ({
      label: `${r.agent} ${r.status} since ${r.started_at.slice(0, 16).replace('T', ' ')} UTC`,
      href: `${origin}/dashboard/approvals?run=${encodeURIComponent(r.run_id)}`,
    })),
    quotes: s.quotes_awaiting_approval.items.map((q) => ({
      label: `quote ${q.quote_workflow_id.slice(0, 8)} awaiting approval since ${q.since.slice(0, 16).replace('T', ' ')} UTC`,
      href: `${origin}/dashboard/approvals`,
    })),
  };
}

export function renderDigest(i: { metrics: DigestMetrics; stuck: StuckReport; narrative: NarrativeResult; siteOrigin: string }): RenderedDigest {
  const { metrics: m, stuck: s } = i;
  const origin = i.siteOrigin.replace(/\/+$/, '');
  const rows = figureRows(m, s);
  const summary = narrativeText(i.narrative);
  const links = stuckLinks(s, origin);
  const subject = digestSubject(m);
  const period = `${dayOf(m.window.start)} to ${lastDay(m)} (UTC)`;

  // ----- text -----
  const text: string[] = [subject, `Week ${m.window.report_week}: ${period}`, '', SECTION_TITLES.summary, ...summary.map((l) => `- ${l}`)];
  for (const section of DIGEST_SECTIONS.slice(1) as Array<FigureRow['section']>) {
    text.push('', SECTION_TITLES[section]);
    for (const r of rows.filter((x) => x.section === section)) text.push(`  ${r.figure}: ${r.value}`);
    if (section === 'stuck') {
      for (const l of [...links.runs, ...links.quotes]) text.push(`  - ${l.label}: ${l.href}`);
      if (s.stale_runs.count > links.runs.length) text.push(`  (${s.stale_runs.count - links.runs.length} more runs not listed)`);
      if (s.quotes_awaiting_approval.count > links.quotes.length) text.push(`  (${s.quotes_awaiting_approval.count - links.quotes.length} more quotes not listed)`);
    }
  }
  text.push('', 'Figures follow scripts/phase5/parity.sql Q12b (point-in-time figures are marked "now").');

  // ----- html -----
  const h: string[] = [];
  h.push('<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a">');
  h.push(`<h2 style="margin:0 0 4px 0">${escapeHtml(subject)}</h2>`);
  h.push(`<p style="margin:0 0 12px 0;color:#555">Week ${escapeHtml(m.window.report_week)}: ${escapeHtml(period)}</p>`);
  h.push(`<h3>${SECTION_TITLES.summary}</h3><ul>${summary.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`);
  for (const section of DIGEST_SECTIONS.slice(1) as Array<FigureRow['section']>) {
    h.push(`<h3>${escapeHtml(SECTION_TITLES[section])}</h3>`);
    const sectionRows = rows.filter((x) => x.section === section);
    h.push('<table cellpadding="4" cellspacing="0" style="border-collapse:collapse">');
    for (const r of sectionRows) {
      h.push(`<tr><td style="border-bottom:1px solid #eee">${escapeHtml(r.figure)}</td><td style="border-bottom:1px solid #eee;text-align:right">${escapeHtml(r.value)}</td></tr>`);
    }
    h.push('</table>');
    if (section === 'stuck' && (links.runs.length > 0 || links.quotes.length > 0)) {
      h.push('<ul>');
      for (const l of [...links.runs, ...links.quotes]) h.push(`<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`);
      h.push('</ul>');
    }
  }
  h.push('<p style="color:#777;font-size:12px">Figures follow scripts/phase5/parity.sql Q12b (point-in-time figures are marked &quot;now&quot;).</p>');
  h.push('</body></html>');

  return { subject, text: text.join('\n'), html: h.join('\n') };
}
