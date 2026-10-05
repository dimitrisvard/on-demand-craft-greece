// Quote (offer) PDF of the quote Workflow, rendered in the Worker with pdf-lib: the blocks of the dashboard offer
// template (src/pages/RfqDetails.tsx:1134-1344): logo and seller block, OFFER title with the meta box (offer no.,
// date, inquiry date, valid until), BILL TO / SUPPLIED BY, greeting, line table, totals, pricing note, conditions,
// the VAT notice, closing and signature; the footer band and top bar on every page (pdf/layout.ts).
//
// Rules
//   - Deterministic: the document date is the quote's date (fixed per quote version), so re-rendering the same
//     version from the same data gives the same bytes and the same pdf_sha256.
//   - Valid until = offer date + 14 days; offer no. = RFQ number, plus ' v<n>' from version 2 on.
//   - Lines without a price print 'on request' (a draft for staff); a quote is only sent when every line is priced.
//   - VAT: customers outside Greece get the template's intra-Community notice and 'VAT (0%)'; customers in Greece get
//     'VAT 24 %: to be confirmed' and no intra-Community notice (no tax amount is computed here).
//   - Every text is drawn as plain text (no HTML); the customer's own contact data appears only in BILL TO.

import { sha256hex } from '../agents/ids';
import { round2 } from '../pricing/calc';
import type { PricingV1 } from '../pricing/types';
import {
  COLORS,
  MM,
  SELLER,
  addPage,
  contentBox,
  createDocument,
  drawInfoBox,
  drawKeyValueBox,
  drawParagraph,
  drawTable,
  fitText,
  gap,
  saveDocument,
  textWidth,
  type Cursor,
} from './layout';

export const VALIDITY_DAYS = 14;
const DAY_MS = 86_400_000;

/** Conditions printed today (src/pages/RfqDetails.tsx:1089-1094). */
export const DEFAULT_CONDITIONS = Object.freeze({
  delivery_time: '21 working days',
  shipping_terms: 'CIP',
  payment_terms: '14 days net',
  validity_days: '14 days',
});

/** Footer notes and terms link of the template (src/pages/RfqDetails.tsx:1095-1099). */
export const DEFAULT_FOOTER_NOTES: readonly string[] = Object.freeze([
  'This offer is subject to our general terms and conditions.',
  'All prices are net, plus VAT where applicable.',
]);
export const TERMS_URL = 'https://microns-hub.com/terms';

const INTRA_COMMUNITY_NOTICE =
  'This offer is issued as an intra-Community supply at 0% VAT, conditional on the buyer providing a valid VAT identification number prior to invoicing. All prices shown are net prices. For any clarification regarding this offer, please contact us at +30 697 007 7401 or info@micronshub.eu.';
const GREEK_VAT_NOTICE =
  'Greek VAT at the applicable rate is added to the net prices of this offer; the VAT amount will be confirmed before invoicing. For any clarification regarding this offer, please contact us at +30 697 007 7401 or info@micronshub.eu.';

export interface QuotePdfLine {
  pos: number;
  product_name: string;
  description: string;
  files: string[];
  qty: number;
  unit_price: number | null;
  total: number | null;
  note?: string | null;
}

export interface QuotePdfInput {
  offer_no: string;
  /** Offer date: also the PDF creation and modification date. */
  date: Date;
  inquiry_date: Date;
  buyer: {
    company: string | null;
    name: string | null;
    address_lines: string[];
    country: string | null;
    phone: string | null;
    email: string | null;
  };
  lines: QuotePdfLine[];
  subtotal: number;
  shipping: number | null;
  total_net: number | null;
  vat_mode: PricingV1['vat']['mode'];
  conditions?: typeof DEFAULT_CONDITIONS;
  footer_notes?: readonly string[];
}

export interface RenderedPdf {
  bytes: Uint8Array;
  pages: number;
  sha256: string;
}

/** Offer number of a quote version. */
export function offerNumber(rfqNumber: string, version: number): string {
  return version > 1 ? `${rfqNumber} v${version}` : rfqNumber;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function money(n: number | null): string {
  return n === null ? '-' : round2(n).toFixed(2);
}

/** Description lines as the template shows them (pre-line), without empty lines. */
function descriptionText(d: string): string {
  return String(d ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** The PDF lines of a pricing: one per quote line, plus the minimum-order surcharge when there is one. */
export function pdfLines(pricing: PricingV1): QuotePdfLine[] {
  const lines: QuotePdfLine[] = pricing.lines.map((l, i) => ({
    pos: i + 1,
    product_name: l.product_name,
    description: l.description,
    files: l.files,
    qty: l.qty,
    unit_price: l.unit_price,
    total: l.line_total,
    note: l.override?.note ?? null,
  }));
  if (pricing.min_order_surcharge !== null && pricing.min_order_surcharge > 0) {
    lines.push({ pos: lines.length + 1, product_name: 'Minimum order surcharge', description: 'Minimum order value', files: [], qty: 1, unit_price: pricing.min_order_surcharge, total: pricing.min_order_surcharge });
  }
  return lines;
}

function drawHeader(c: Awaited<ReturnType<typeof createDocument>>, at: Cursor): Cursor {
  const box = contentBox();
  const top = at.y;
  let logoBottom = top;
  if (c.logo) {
    const dims = c.logo.scaleToFit(55 * MM, 18 * MM);
    at.page.drawImage(c.logo, { x: box.left, y: top - dims.height, width: dims.width, height: dims.height });
    logoBottom = top - dims.height;
  }
  let y = top - 4 * MM;
  const name = SELLER.name;
  at.page.drawText(name, { x: box.right - textWidth(c.fonts.bold, name, 11.5), y, size: 11.5, font: c.fonts.bold, color: COLORS.dark });
  for (const line of SELLER.lines) {
    y -= 3.9 * MM;
    const text = fitText(c.fonts.regular, line, 8.5, 90 * MM);
    at.page.drawText(text, { x: box.right - textWidth(c.fonts.regular, text, 8.5), y, size: 8.5, font: c.fonts.regular, color: COLORS.greyText });
  }
  const bottom = Math.min(logoBottom, y - 3 * MM);
  at.page.drawRectangle({ x: box.left, y: bottom - 2 * MM, width: box.width, height: 0.7 * MM, color: COLORS.teal });
  return { page: at.page, y: bottom - 4 * MM };
}

/** Renders the offer PDF. */
export async function renderQuotePdf(i: QuotePdfInput): Promise<RenderedPdf> {
  const conditions = i.conditions ?? DEFAULT_CONDITIONS;
  const c = await createDocument({ title: `Offer ${i.offer_no}`, date: i.date });
  const box = contentBox();
  let at = drawHeader(c, addPage(c));

  // OFFER title and meta box
  const titleTop = at.y;
  at.page.drawText('OFFER', { x: box.left, y: titleTop - 10 * MM, size: 26, font: c.fonts.bold, color: COLORS.dark });
  at.page.drawText('Quotation for manufactured parts', { x: box.left, y: titleTop - 16 * MM, size: 10, font: c.fonts.bold, color: COLORS.teal });
  const validUntil = new Date(i.date.getTime() + VALIDITY_DAYS * DAY_MS);
  at = drawKeyValueBox(c, at, [
    { label: 'OFFER NO.', value: i.offer_no },
    { label: 'DATE', value: isoDate(i.date) },
    { label: 'INQUIRY DATE', value: isoDate(i.inquiry_date) },
    { label: 'VALID UNTIL', value: isoDate(validUntil) },
  ], { width_mm: 78, row_mm: 5.6 });
  at = { page: at.page, y: Math.min(at.y, titleTop - 20 * MM) };

  // BILL TO / SUPPLIED BY
  const greetingName = (i.buyer.name ?? '').trim() || 'Sir/Madam';
  const buyerTitle = (i.buyer.company ?? '').trim() || greetingName;
  const billTo = [buyerTitle];
  if (i.buyer.name?.trim() && i.buyer.company?.trim()) billTo.push(`Attn: ${greetingName}`);
  billTo.push(...i.buyer.address_lines.map((l) => l.trim()).filter(Boolean));
  if (i.buyer.country?.trim()) billTo.push(i.buyer.country.trim());
  if (i.buyer.phone?.trim()) billTo.push(`Tel: ${i.buyer.phone.trim()}`);
  if (i.buyer.email?.trim()) billTo.push(i.buyer.email.trim());
  const half = (box.width / MM - 6) / 2;
  const left = drawInfoBox(c, at, { title: 'BILL TO', lines: billTo, width_mm: half, size: 8.5 });
  const right = drawInfoBox(c, at, { title: 'SUPPLIED BY', lines: ['Microns Hub DV E.E.', ...SELLER.contact], x_mm: half + 6, width_mm: half, tinted: true, size: 8.5 });
  at = left.cursor.y < right.cursor.y ? left.cursor : right.cursor;

  // Greeting
  at = drawParagraph(c, at, `Dear ${greetingName},`);
  at = drawParagraph(c, at, `Thank you for your inquiry of ${isoDate(i.inquiry_date)}. We are pleased to submit the following quotation for the parts listed in your request.`);
  at = gap(c, at, 1);

  // Lines
  at = drawTable(c, at, {
    columns: [
      { label: '#', width_mm: 8 },
      { label: 'PART', width_mm: 28 },
      { label: 'DESCRIPTION', width_mm: 56 },
      { label: 'FILES', width_mm: 32 },
      { label: 'QTY', width_mm: 12, align: 'right' },
      { label: 'UNIT PRICE', width_mm: 22, align: 'right' },
      { label: 'TOTAL', width_mm: 22, align: 'right' },
    ],
    rows: i.lines.map((l) => [
      String(l.pos),
      l.product_name,
      descriptionText(l.description),
      l.files.length ? l.files.join('\n') : '-',
      String(l.qty),
      l.unit_price === null ? 'on request' : money(l.unit_price),
      money(l.total),
    ]),
    boldColumns: [1, 5, 6],
  });
  for (const l of i.lines.filter((x) => x.note)) at = drawParagraph(c, at, `Note (${l.pos}): ${l.note}`, { size: 8.5, color: COLORS.greyText });

  // Totals
  const vatRow = i.vat_mode === 'to_be_confirmed' ? { label: 'VAT 24 %:', value: 'to be confirmed' } : { label: 'VAT (0%):', value: money(0) };
  at = drawKeyValueBox(c, at, [
    { label: 'Subtotal:', value: money(i.subtotal) },
    { label: 'Shipping Cost:', value: i.shipping === null ? 'on request' : money(i.shipping) },
    vatRow,
    { label: 'TOTAL (EUR, net):', value: money(i.total_net), highlight: true },
  ], { width_mm: 90, row_mm: 5.8 });
  at = drawParagraph(c, at, 'Note on pricing: All prices are in EUR, net of VAT.', { size: 8.5, color: COLORS.greyText });
  at = gap(c, at, 1);

  // Conditions
  at = drawTable(c, at, {
    columns: [
      { label: 'DELIVERY TIME', width_mm: 45 },
      { label: 'INCOTERMS', width_mm: 45 },
      { label: 'PAYMENT TERMS', width_mm: 45 },
      { label: 'OFFER VALIDITY', width_mm: 45 },
    ],
    rows: [[conditions.delivery_time, conditions.shipping_terms, conditions.payment_terms, conditions.validity_days]],
    boldColumns: [0, 1, 2, 3],
  });

  // VAT notice
  at = drawInfoBox(c, at, i.vat_mode === 'to_be_confirmed'
    ? { title: 'VAT', lines: [GREEK_VAT_NOTICE], tinted: true, size: 8.5 }
    : { title: 'Intra-Community Supply (0% VAT)', lines: [INTRA_COMMUNITY_NOTICE], tinted: true, size: 8.5 }).cursor;

  // Closing
  at = drawParagraph(c, at, `We look forward to working with ${buyerTitle} and remain at your disposal for any technical or commercial questions regarding this quotation.`);
  at = drawParagraph(c, at, 'Mit freundlichen Grüßen,');
  at = drawParagraph(c, at, SELLER.signature, { bold: true });
  at = drawParagraph(c, at, SELLER.signature_title, { size: 8.5, color: COLORS.greyText });
  drawParagraph(c, at, [...(i.footer_notes ?? DEFAULT_FOOTER_NOTES), `Terms: ${TERMS_URL}`].join(' '), { size: 7, color: COLORS.greyText });

  const bytes = await saveDocument(c);
  return { bytes, pages: c.doc.getPageCount(), sha256: await sha256hex(bytes) };
}
