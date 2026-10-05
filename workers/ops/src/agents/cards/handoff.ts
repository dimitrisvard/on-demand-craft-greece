// Cards of the post-order Workflow's partner hand-off: the approval card (verbs send_partner, hold; change_partner
// on the dashboard), its reminder, and the notices without buttons (shadow mode, sent, held).
//
// Rules
//   - Business fields only: PO number, company and country of the order, the suggested partner's company name and
//     country, item counts, unmatched items, stock status counts, due date, traveller page count. Never a partner's
//     or customer's e-mail address, a signed link, a model note text or a token.
//   - 'send_partner' is offered only when a partner is suggested; 'change_partner' (dashboard only) re-reads the
//     order's partner and issues a new card.
//   - "Open" goes to the approvals page of the run.

import { cardOpenUrl, type CardFlag, type CardV1 } from './index';

export interface HandoffCardInput {
  run_id: string;
  site_origin: string;
  po_number: string | null;
  company: string | null;
  country: string | null;
  partner: { company_name: string; country: string | null; matched_by: 'order' | 'specialisation' | 'only_partner' } | null;
  items: number;
  unmatched_items: number;
  stock: { held: number; shortfall: number; not_stocked: number };
  /** Stock items whose holds exceed the remaining stock. */
  over_held: number;
  due_date: string | null;
  traveller_pages: number;
  injection_suspected: boolean;
  variant?: 'first' | 'reminder' | 'changed';
}

export const HANDOFF_VERBS = ['send_partner', 'hold', 'change_partner'] as const;

export function handoffVerbs(hasPartner: boolean): string[] {
  return hasPartner ? [...HANDOFF_VERBS] : ['hold', 'change_partner'];
}

function title(prefix: string, po: string | null, company: string | null, country: string | null): string {
  const name = (company ?? '').trim() || 'unknown company';
  const c = (country ?? '').trim();
  return `${prefix} ${po ?? 'order'} · ${c ? `${name} (${c})` : name}`;
}

export function handoffCard(i: HandoffCardInput): CardV1 {
  const prefix = i.variant === 'reminder' ? 'Reminder: hand-off' : i.variant === 'changed' ? 'Hand-off (partner changed)' : 'Hand-off';
  const partner = i.partner
    ? `${i.partner.company_name}${i.partner.country ? ` (${i.partner.country})` : ''}${i.partner.matched_by === 'order' ? ', set on the order' : i.partner.matched_by === 'specialisation' ? ', by specialisation' : ''}`
    : 'none suggested: set a partner on the order, then Change partner';
  const lines: CardV1['lines'] = [
    { label: 'Order', value: i.po_number ?? 'without PO number' },
    { label: 'Partner', value: partner },
    { label: 'Items', value: `${i.items}${i.unmatched_items ? ` (${i.unmatched_items} without quote line)` : ''}` },
    { label: 'Stock', value: `${i.stock.held} held, ${i.stock.shortfall} short, ${i.stock.not_stocked} not stocked` },
  ];
  if (i.over_held > 0) lines.push({ label: 'Stock check', value: `${i.over_held} stock item(s) held above their remaining stock` });
  if (i.due_date) lines.push({ label: 'Due', value: i.due_date.slice(0, 10) });
  lines.push({ label: 'Traveller', value: `${i.traveller_pages} page(s)` });
  const flags: CardFlag[] = [];
  if (i.injection_suspected) flags.push('injection_suspected');
  if (i.unmatched_items > 0) flags.push('manual_lines');
  return {
    v: 1,
    kind: 'handoff',
    run_id: i.run_id,
    title: title(prefix, i.po_number, i.company, i.country),
    lines,
    flags,
    allowed_verbs: handoffVerbs(i.partner !== null),
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

/** A hand-off notice without buttons. */
export function handoffNotice(i: { run_id: string; site_origin: string; po_number: string | null; company: string | null; country: string | null; text: string; lines?: CardV1['lines'] }): CardV1 {
  return {
    v: 1,
    kind: 'handoff',
    run_id: i.run_id,
    title: title('Order', i.po_number, i.company, i.country),
    lines: [{ label: 'Status', value: i.text }, ...(i.lines ?? [])],
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}
