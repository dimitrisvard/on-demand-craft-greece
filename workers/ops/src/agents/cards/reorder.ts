// Cards of material reordering: the approval card of a reorder draft (verbs approve_draft, dismiss) and the stock
// notices without buttons of MaterialStock (expired holds, holds above the remaining stock).
//
// Rules
//   - Business fields only: PO number, material labels (name, grade, thickness), missing amounts, supplier names
//     and SKUs from the catalogue. Never the draft's text (it is shown on the dashboard from the run's output), an
//     address or a token.
//   - "Open" goes to the approvals page of the run.

import { cardOpenUrl, type CardV1 } from './index';

export const REORDER_VERBS = ['approve_draft', 'dismiss'] as const;

export interface ReorderMaterial {
  label: string;
  /** e.g. '1.2 m2 missing' or 'low stock alert'. */
  need: string;
  supplier: string | null;
}

export function reorderCard(i: { run_id: string; site_origin: string; po_number: string | null; materials: readonly ReorderMaterial[]; reminder?: boolean }): CardV1 {
  const lines: CardV1['lines'] = [{ label: 'Order', value: i.po_number ?? 'without PO number' }];
  for (const m of i.materials.slice(0, 10)) lines.push({ label: m.label, value: `${m.need}${m.supplier ? ` · supplier ${m.supplier}` : ''}` });
  lines.push({ label: 'Draft', value: 'review the supplier e-mail draft on the dashboard; nothing is sent automatically' });
  return {
    v: 1,
    kind: 'reorder',
    run_id: i.run_id,
    title: `${i.reminder ? 'Reminder: ' : ''}Reorder draft · ${i.po_number ?? 'order'}`,
    lines,
    flags: [],
    allowed_verbs: [...REORDER_VERBS],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

/** Daily stock notice of a material (no buttons). */
export function stockNoticeCard(i: { run_id: string; site_origin: string; material_label: string; released: number; over_held: number }): CardV1 {
  const lines: CardV1['lines'] = [{ label: 'Material', value: i.material_label }];
  if (i.released > 0) lines.push({ label: 'Expired holds', value: `${i.released} order item(s) released after 14 days` });
  if (i.over_held > 0) lines.push({ label: 'Stock check', value: `${i.over_held} stock item(s) held above their remaining stock` });
  return {
    v: 1,
    kind: 'reorder',
    run_id: i.run_id,
    title: `Stock notice · ${i.material_label}`,
    lines,
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}
