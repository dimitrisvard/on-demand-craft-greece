// Production traveller of an order (R2 orders/<order_id>/traveler.pdf), for the production partner: PO number,
// parts with quantities, process, material, thickness, finish and tolerance, the due date, the notes and QA checks
// of the post-order agent, and the drawing references. Uses the shared page layout of pdf/layout.ts (top bar,
// footer band, Liberation Sans subsets, so Greek and Polish text renders).
//
// Rules
//   - Deterministic: the document date is the order's date, so the same order renders to the same bytes.
//   - No customer identity and no prices: the partner sees the parts, the PO number and the dates only.
//   - Every text is drawn as given (no markup); long values wrap.

import { sha256hex } from '../agents/ids';
import { addPage, COLORS, contentBox, createDocument, drawInfoBox, drawKeyValueBox, drawParagraph, drawTable, gap, MM, saveDocument, SELLER, textWidth, type Cursor } from './layout';

export interface TravellerItem {
  pos: number;
  product_name: string;
  quantity: number;
  process: string | null;
  material: string | null;
  thickness_mm: number | null;
  finish: string | null;
  tolerance: string | null;
  /** File names of the drawings and CAD outputs that go with the item. */
  drawings: string[];
}

export interface TravellerInput {
  po_number: string;
  /** Order date (also the document date). */
  order_date: Date;
  /** ISO date or null (to be agreed). */
  due_date: string | null;
  partner: { company_name: string; country: string | null } | null;
  items: TravellerItem[];
  notes: string[];
  qa_checks: string[];
}

export interface RenderedTraveller {
  bytes: Uint8Array;
  pages: number;
  sha256: string;
}

const PROCESS_LABEL: Readonly<Record<string, string>> = Object.freeze({ sheet_metal: 'Sheet metal', cnc: 'CNC machining', mixed: 'Mixed', other: 'Other' });

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function header(c: Awaited<ReturnType<typeof createDocument>>, at: Cursor): Cursor {
  const box = contentBox();
  const top = at.y;
  let bottom = top - 14 * MM;
  if (c.logo) {
    const dims = c.logo.scaleToFit(45 * MM, 15 * MM);
    at.page.drawImage(c.logo, { x: box.left, y: top - dims.height, width: dims.width, height: dims.height });
    bottom = Math.min(bottom, top - dims.height);
  }
  const title = 'PRODUCTION TRAVELLER';
  at.page.drawText(title, { x: box.right - textWidth(c.fonts.bold, title, 16), y: top - 7 * MM, size: 16, font: c.fonts.bold, color: COLORS.dark });
  const seller = SELLER.name;
  at.page.drawText(seller, { x: box.right - textWidth(c.fonts.regular, seller, 8.5), y: top - 12 * MM, size: 8.5, font: c.fonts.regular, color: COLORS.greyText });
  at.page.drawRectangle({ x: box.left, y: bottom - 2 * MM, width: box.width, height: 0.7 * MM, color: COLORS.teal });
  return { page: at.page, y: bottom - 5 * MM };
}

export async function renderTravellerPdf(i: TravellerInput): Promise<RenderedTraveller> {
  const c = await createDocument({ title: `Traveller ${i.po_number}`, date: i.order_date });
  let at = header(c, addPage(c));
  at = drawKeyValueBox(c, at, [
    { label: 'PO NUMBER', value: i.po_number },
    { label: 'ORDER DATE', value: isoDate(i.order_date) },
    { label: 'DUE DATE', value: i.due_date ? i.due_date.slice(0, 10) : 'to be agreed' },
    { label: 'ITEMS', value: String(i.items.length), highlight: true },
  ], { width_mm: 90, row_mm: 6 });
  if (i.partner) at = drawInfoBox(c, at, { title: 'PRODUCTION PARTNER', lines: [`${i.partner.company_name}${i.partner.country ? ` (${i.partner.country})` : ''}`], size: 9 }).cursor;

  at = drawTable(c, at, {
    columns: [
      { label: '#', width_mm: 8 },
      { label: 'PART', width_mm: 34 },
      { label: 'QTY', width_mm: 12, align: 'right' },
      { label: 'PROCESS', width_mm: 24 },
      { label: 'MATERIAL', width_mm: 32 },
      { label: 'THICKNESS', width_mm: 18, align: 'right' },
      { label: 'FINISH', width_mm: 24 },
      { label: 'TOLERANCE', width_mm: 24 },
    ],
    rows: i.items.map((it) => [
      String(it.pos),
      it.product_name,
      String(it.quantity),
      it.process ? PROCESS_LABEL[it.process] ?? it.process : '-',
      it.material ?? '-',
      it.thickness_mm === null ? '-' : `${it.thickness_mm} mm`,
      it.finish ?? '-',
      it.tolerance ?? '-',
    ]),
    boldColumns: [1, 2],
  });

  if (i.notes.length) {
    at = gap(c, at, 1);
    at = drawParagraph(c, at, 'Production notes', { bold: true, size: 10 });
    for (const n of i.notes) at = drawParagraph(c, at, `• ${n}`, { indent_mm: 2 });
  }
  if (i.qa_checks.length) {
    at = gap(c, at, 1);
    at = drawParagraph(c, at, 'Quality checks', { bold: true, size: 10 });
    for (const q of i.qa_checks) at = drawParagraph(c, at, `[  ] ${q}`, { indent_mm: 2 });
  }
  const drawings = i.items.filter((it) => it.drawings.length);
  if (drawings.length) {
    at = gap(c, at, 1);
    at = drawParagraph(c, at, 'Drawings and CAD outputs', { bold: true, size: 10 });
    for (const it of drawings) at = drawParagraph(c, at, `${it.pos}. ${it.product_name}: ${it.drawings.join(', ')}`, { indent_mm: 2 });
  }
  at = gap(c, at, 2);
  drawParagraph(c, at, 'Please confirm the order and the due date. Report any deviation from the drawings before production starts.', { size: 8.5, color: COLORS.greyText });

  const bytes = await saveDocument(c);
  return { bytes, pages: c.doc.getPageCount(), sha256: await sha256hex(bytes) };
}
