// Cards of the quote Workflow: the approval card of a quote draft (verbs approve, reject; edits are made on the
// dashboard and travel with 'approve'), its reminder and later rounds, the reply-confirmation card (kind 'reply',
// verbs won, lost, counter, ignore) and the notices without buttons (shadow draft, reply notice, quote sent).
//
// Rules
//   - Business fields only: RFQ number and version, company and country, number of lines and manual lines, totals,
//     margin range, similar-quote counts, the number of model notes (never their text), page count, the masked
//     sender of a reply and the classified outcome with its confidence. Never an e-mail text, a full address, the
//     model's notes or summary, or a token.
//   - "Open" goes to the approvals page of the run (/dashboard/approvals?run=<run_id>).

import type { PricingV1 } from '../../pricing/types';
import { cardOpenUrl, type CardFlag, type CardV1 } from './index';

export const QUOTE_VERBS = ['approve', 'reject'] as const;
export const REPLY_VERBS = ['won', 'lost', 'counter', 'ignore'] as const;

/** Outcome of a reply verb ('ignore' keeps the quote waiting). */
export const REPLY_VERB_OUTCOME: Readonly<Record<string, 'won' | 'lost' | 'counter_offer' | 'ignore'>> = Object.freeze({
  won: 'won',
  lost: 'lost',
  counter: 'counter_offer',
  ignore: 'ignore',
});

export interface QuoteCardInput {
  run_id: string;
  site_origin: string;
  rfq_number: string;
  version: number;
  company: string | null;
  country: string | null;
  pricing: PricingV1;
  notes: { assumptions: number; risks: number; suggestions: number; injection_suspected: boolean } | null;
  similar: { lines: number; won: number; lost: number };
  pdf_pages: number;
  /** 'reminder' after the first wait, 'incomplete' when an approval left lines without a price. */
  variant?: 'first' | 'reminder' | 'incomplete';
}

function money(n: number | null): string {
  return n === null ? 'open' : `EUR ${n.toFixed(2)}`;
}

function percentRange(values: number[]): string | null {
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const f = (x: number) => `${Math.round(x * 1000) / 10}`;
  return lo === hi ? `${f(lo)} %` : `${f(lo)}-${f(hi)} %`;
}

function companyTitle(company: string | null, country: string | null): string {
  const name = (company ?? '').trim() || 'unknown company';
  const c = (country ?? '').trim();
  return c ? `${name} (${c})` : name;
}

const GEOMETRY_REASONS = new Set(['geometry_missing', 'cad_failed', 'cad_pending', 'inline_too_large', 'flat_size_missing', 'bbox_or_volume_missing']);

/** Approval card of a quote draft. */
export function quoteCard(i: QuoteCardInput): CardV1 {
  const p = i.pricing;
  const manual = p.manual_lines.length;
  const geometryMissing = p.lines.filter((l) => l.unit_price === null && l.manual_reasons.some((r) => GEOMETRY_REASONS.has(r))).length;
  const margins = percentRange(p.lines.map((l) => l.margin_pct).filter((m): m is number => typeof m === 'number'));
  const prefix = i.variant === 'reminder' ? 'Reminder: quote draft' : i.variant === 'incomplete' ? 'Quote incomplete' : 'Quote draft';
  const lines: CardV1['lines'] = [
    { label: 'Offer', value: `${i.rfq_number} v${i.version}` },
    { label: 'Lines', value: `${p.lines.length}${manual ? ` (${manual} without price)` : ''}` },
    { label: 'Subtotal', value: money(p.subtotal) },
    { label: 'Shipping', value: money(p.shipping) },
  ];
  if (p.min_order_surcharge) lines.push({ label: 'Minimum order surcharge', value: money(p.min_order_surcharge) });
  lines.push({ label: 'Total net', value: p.complete ? money(p.total_net) : 'open (prices missing)' });
  if (margins) lines.push({ label: 'Margin', value: margins });
  lines.push({ label: 'Similar quote lines', value: `${i.similar.lines} (won ${i.similar.won}, lost ${i.similar.lost})` });
  if (i.notes) lines.push({ label: 'Model notes', value: `${i.notes.assumptions} assumptions, ${i.notes.risks} risks, ${i.notes.suggestions} suggestions` });
  if (geometryMissing) lines.push({ label: 'Geometry', value: `${geometryMissing} line(s) without CAD result` });
  if (p.vat.mode === 'to_be_confirmed') lines.push({ label: 'VAT', value: 'to be confirmed (customer in Greece)' });
  if (i.variant === 'incomplete') lines.push({ label: 'Action', value: 'Set the missing prices and shipping on the dashboard, then approve' });
  lines.push({ label: 'PDF', value: `${i.pdf_pages} page(s)` });
  const flags: CardFlag[] = [];
  if (manual || !p.complete) flags.push('manual_lines');
  if (i.notes?.injection_suspected) flags.push('injection_suspected');
  return {
    v: 1,
    kind: 'quote',
    run_id: i.run_id,
    title: `${prefix} ${i.rfq_number} v${i.version} · ${companyTitle(i.company, i.country)}`,
    lines,
    flags,
    allowed_verbs: [...QUOTE_VERBS],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

export interface ReplyCardInput {
  run_id: string;
  site_origin: string;
  rfq_number: string;
  version: number;
  /** maskEmail() of the reply's From address (never the full address). */
  sender_masked: string | null;
  outcome: string;
  confidence: number;
  reminder?: boolean;
}

function pct(n: number): string {
  return `${Math.round(Math.min(1, Math.max(0, n)) * 100)} %`;
}

/** Reply-confirmation card (kind 'reply'): a human decides what the customer's reply means. */
export function quoteReplyCard(i: ReplyCardInput): CardV1 {
  return {
    v: 1,
    kind: 'reply',
    run_id: i.run_id,
    title: `${i.reminder ? 'Reminder: ' : ''}${i.rfq_number} reply · classified ${i.outcome} (${pct(i.confidence)})`,
    lines: [
      { label: 'Offer', value: `${i.rfq_number} v${i.version}` },
      { label: 'Sender', value: i.sender_masked ?? 'unknown' },
      { label: 'Classified', value: `${i.outcome} (${pct(i.confidence)})` },
    ],
    flags: i.confidence < 0.8 ? ['low_confidence'] : [],
    allowed_verbs: [...REPLY_VERBS],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

export interface QuoteNoticeInput {
  run_id: string;
  site_origin: string;
  rfq_number: string;
  version: number;
  company: string | null;
  country: string | null;
  /** One business line, e.g. 'Draft ready (shadow mode): nothing was sent'. */
  text: string;
  /** Extra lines (label, value). */
  lines?: CardV1['lines'];
  kind?: 'quote' | 'reply';
}

/** A notice without buttons (no token is issued for it). */
export function quoteNotice(i: QuoteNoticeInput): CardV1 {
  return {
    v: 1,
    kind: i.kind ?? 'quote',
    run_id: i.run_id,
    title: `${i.rfq_number} v${i.version} · ${companyTitle(i.company, i.country)}`,
    lines: [{ label: 'Status', value: i.text }, ...(i.lines ?? [])],
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}
