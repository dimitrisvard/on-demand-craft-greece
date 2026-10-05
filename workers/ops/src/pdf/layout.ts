// Shared page layout of the generated PDFs (quote offer and production traveller), ported from the dashboard offer
// template (src/pages/RfqDetails.tsx:1100-1340, palette of scripts/generate_offer_pdf.py): A4 portrait, 15 mm
// margins, top bar (8 mm teal + 1 mm dark stripe), a footer band with four columns (company, trade register,
// management, bank) on every page, tables with row-level page breaks and a repeated header. pdf-lib resolves from
// the repository root install (one copy in the bundle); Liberation Sans Regular and Bold (SIL OFL 1.1) are embedded
// as subsets, so Greek and Polish text renders.
//
// Rules
//   - Deterministic output: creation and modification dates are fixed to the document date, the subset font names
//     are fixed and no random value enters the file, so the same input gives the same bytes.
//   - Every text is drawn as given (no HTML); values longer than a cell wrap inside it, words longer than a line are
//     broken.
//   - The seller, bank and condition texts below are the ones the dashboard offer template prints today
//     (src/pages/RfqDetails.tsx:1036-1045, :1083-1098, :1310-1340).

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { embedFonts, embedLogo, pdfSafe, type PdfFonts } from './fonts';

export type { PdfFonts } from './fonts';

/** 1 mm in PDF points. */
export const MM = 72 / 25.4;
export const A4_PORTRAIT = { width: 595.28, height: 841.89 } as const;
export const MARGIN_MM = 15;

export interface DocContext {
  doc: PDFDocument;
  fonts: PdfFonts;
  logo: PDFImage | null;
  /** Document date (also its creation and modification date). */
  date: Date;
  title: string;
}

/** A position on a page; y counts down from the top margin. */
export interface Cursor {
  page: PDFPage;
  y: number;
}

export interface TableColumn {
  label: string;
  width_mm: number;
  align?: 'left' | 'right';
}

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Brand palette of the offer template. */
export const COLORS = Object.freeze({
  teal: hex('#1FB8B8'),
  tealLight: hex('#E6F7F7'),
  dark: hex('#2A2A2A'),
  greyText: hex('#555555'),
  greyLine: hex('#D8D8D8'),
  greyBg: hex('#F5F7F8'),
  white: rgb(1, 1, 1),
});

/** Seller block of the offer template. */
export const SELLER = Object.freeze({
  name: 'MICRONS HUB DV E.E.',
  lines: ['Industrial Area Street B, No. 4', '71601 Heraklion, Crete, Greece', 'Tel: +30 697 007 7401', 'info@micronshub.eu · www.micronshub.eu', 'VAT ID: EL803129638'],
  contact: ['Attn: Mr. Dimitris Vardalachakis', 'Founder & Managing Director', 'Industrial Area Street B, No. 4', '71601 Heraklion, Crete, Greece', 'Tel: +30 697 007 7401', 'info@micronshub.eu'],
  signature: 'Dimitris Vardalachakis',
  signature_title: 'Founder & Managing Director, Microns Hub DV E.E.',
});

/** Footer band columns of the offer template (printed on every page). */
export const FOOTER_COLUMNS: ReadonlyArray<{ title: string; lines: readonly string[] }> = Object.freeze([
  { title: 'COMPANY', lines: ['MICRONS HUB DV E.E.', 'Industrial Area Street B No. 4', '71601 Heraklion, Greece'] },
  { title: 'TRADE REGISTER', lines: ['Greece', 'VAT ID: EL803129638', 'GEMI: 169893827000'] },
  { title: 'MANAGEMENT', lines: ['Dimitris Vardalachakis', 'Founder & Managing Director', 'info@micronshub.eu'] },
  { title: 'BANK ACCOUNT', lines: ['National Bank of Greece', 'GR49 0110 2040 0000 2040 0891 170', 'SWIFT/BIC: ETHNGRAA'] },
]);

const TOP_BAR_MM = 8;
const TOP_STRIPE_MM = 1;
const FOOTER_MM = 24;
const BODY_SIZE = 9.5;
const LINE_GAP = 1.25;

/** Content box of a page in points: left, right, top y (PDF coordinates grow upwards), bottom y. */
export function contentBox(): { left: number; right: number; top: number; bottom: number; width: number } {
  const left = MARGIN_MM * MM;
  const right = A4_PORTRAIT.width - MARGIN_MM * MM;
  const top = A4_PORTRAIT.height - (TOP_BAR_MM + TOP_STRIPE_MM + 8) * MM;
  const bottom = (FOOTER_MM + 6) * MM;
  return { left, right, top, bottom, width: right - left };
}

/** A new document with the embedded fonts and logo. */
export async function createDocument(o: { title: string; date: Date }): Promise<DocContext> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(pdfSafe(o.title).replace(/\n/g, ' '));
  doc.setAuthor('Microns Hub');
  doc.setCreator('microns-ops');
  doc.setProducer('microns-ops (pdf-lib)');
  doc.setCreationDate(o.date);
  doc.setModificationDate(o.date);
  const fonts = await embedFonts(doc);
  const logo = await embedLogo(doc);
  return { doc, fonts, logo, date: o.date, title: o.title };
}

function drawFooter(c: DocContext, page: PDFPage): void {
  const width = A4_PORTRAIT.width;
  page.drawRectangle({ x: 0, y: 0, width, height: FOOTER_MM * MM, color: COLORS.dark });
  page.drawRectangle({ x: 0, y: FOOTER_MM * MM, width, height: 0.7 * MM, color: COLORS.teal });
  const colWidth = (width - 2 * MARGIN_MM * MM) / FOOTER_COLUMNS.length;
  FOOTER_COLUMNS.forEach((col, i) => {
    const x = MARGIN_MM * MM + i * colWidth;
    let y = FOOTER_MM * MM - 6 * MM;
    page.drawText(col.title, { x, y, size: 6.5, font: c.fonts.bold, color: COLORS.teal });
    for (const line of col.lines) {
      y -= 3.6 * MM;
      page.drawText(fitText(c.fonts.regular, line, 7, colWidth - 2 * MM), { x, y, size: 7, font: c.fonts.regular, color: COLORS.white });
    }
  });
}

/** A new page with the top bar and the footer band; returns the cursor below the header. */
export function addPage(c: DocContext): Cursor {
  const page = c.doc.addPage([A4_PORTRAIT.width, A4_PORTRAIT.height]);
  const { height, width } = A4_PORTRAIT;
  page.drawRectangle({ x: 0, y: height - TOP_BAR_MM * MM, width, height: TOP_BAR_MM * MM, color: COLORS.teal });
  page.drawRectangle({ x: 0, y: height - (TOP_BAR_MM + TOP_STRIPE_MM) * MM, width, height: TOP_STRIPE_MM * MM, color: COLORS.dark });
  drawFooter(c, page);
  return { page, y: contentBox().top };
}

/** Width of a text in points. */
export function textWidth(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

/** The longest prefix of a single line that fits, with an ellipsis when cut. */
export function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const t = pdfSafe(text).replace(/\n/g, ' ');
  if (textWidth(font, t, size) <= maxWidth) return t;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(font, `${t.slice(0, mid)}…`, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${t.slice(0, lo)}…`;
}

/** Lines of a text wrapped to maxWidth (explicit line breaks kept; long words broken). */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of pdfSafe(text).split('\n')) {
    const words = paragraph.split(/ +/).filter((w, i, all) => w !== '' || all.length === 1);
    let line = '';
    for (let word of words) {
      // A word wider than the line is broken into pieces that fit.
      while (textWidth(font, word, size) > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && textWidth(font, word.slice(0, cut), size) > maxWidth) cut--;
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(font, candidate, size) <= maxWidth) line = candidate;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** The cursor, or a new page's cursor when `needed` points do not fit above the footer. */
export function ensureSpace(c: DocContext, at: Cursor, needed: number): Cursor {
  return at.y - needed < contentBox().bottom ? addPage(c) : at;
}

/** A wrapped paragraph; starts a new page when it does not fit. */
export function drawParagraph(c: DocContext, at: Cursor, text: string, o?: { bold?: boolean; size?: number; color?: RGB; indent_mm?: number }): Cursor {
  const size = o?.size ?? BODY_SIZE;
  const font = o?.bold ? c.fonts.bold : c.fonts.regular;
  const box = contentBox();
  const x = box.left + (o?.indent_mm ?? 0) * MM;
  const lineHeight = size * LINE_GAP;
  let cursor = at;
  for (const line of wrapText(font, text, size, box.right - x)) {
    cursor = ensureSpace(c, cursor, lineHeight);
    cursor = { page: cursor.page, y: cursor.y - lineHeight };
    if (line) cursor.page.drawText(line, { x, y: cursor.y + size * 0.25, size, font, color: o?.color ?? COLORS.dark });
  }
  return { page: cursor.page, y: cursor.y - size * 0.4 };
}

/** Vertical space. */
export function gap(c: DocContext, at: Cursor, mm: number): Cursor {
  const next = { page: at.page, y: at.y - mm * MM };
  return next.y < contentBox().bottom ? addPage(c) : next;
}

const CELL_PAD = 1.6 * MM;
const TABLE_SIZE = 8.5;

function cellLines(c: DocContext, text: string, width: number, bold: boolean): string[] {
  return wrapText(bold ? c.fonts.bold : c.fonts.regular, text, TABLE_SIZE, Math.max(width - 2 * CELL_PAD, 10));
}

function drawHeaderRow(c: DocContext, at: Cursor, columns: TableColumn[], widths: number[]): Cursor {
  const box = contentBox();
  const lines = columns.map((col, i) => cellLines(c, col.label, widths[i], true));
  const height = Math.max(...lines.map((l) => l.length)) * TABLE_SIZE * LINE_GAP + 2 * CELL_PAD;
  at.page.drawRectangle({ x: box.left, y: at.y - height, width: box.width, height, color: COLORS.dark });
  let x = box.left;
  columns.forEach((col, i) => {
    lines[i].forEach((line, k) => {
      const w = textWidth(c.fonts.bold, line, TABLE_SIZE);
      const tx = col.align === 'right' ? x + widths[i] - CELL_PAD - w : x + CELL_PAD;
      at.page.drawText(line, { x: tx, y: at.y - CELL_PAD - (k + 1) * TABLE_SIZE * LINE_GAP + TABLE_SIZE * 0.3, size: TABLE_SIZE, font: c.fonts.bold, color: COLORS.white });
    });
    x += widths[i];
  });
  return { page: at.page, y: at.y - height };
}

/** A table with row-level page breaks and the header repeated on every page. */
export function drawTable(c: DocContext, at: Cursor, t: { columns: TableColumn[]; rows: string[][]; boldColumns?: number[] }): Cursor {
  const box = contentBox();
  const total = t.columns.reduce((s, col) => s + col.width_mm, 0);
  const widths = t.columns.map((col) => (col.width_mm / total) * box.width);
  const bold = new Set(t.boldColumns ?? []);
  const headerHeight = TABLE_SIZE * LINE_GAP * 2 + 2 * CELL_PAD;
  let cursor = ensureSpace(c, at, headerHeight + TABLE_SIZE * LINE_GAP * 2 + 2 * CELL_PAD);
  cursor = drawHeaderRow(c, cursor, t.columns, widths);
  t.rows.forEach((row, r) => {
    const lines = t.columns.map((_, i) => cellLines(c, row[i] ?? '', widths[i], bold.has(i)));
    const height = Math.max(1, ...lines.map((l) => l.length)) * TABLE_SIZE * LINE_GAP + 2 * CELL_PAD;
    if (cursor.y - height < box.bottom) {
      cursor = addPage(c);
      cursor = drawHeaderRow(c, cursor, t.columns, widths);
    }
    if (r % 2 === 1) cursor.page.drawRectangle({ x: box.left, y: cursor.y - height, width: box.width, height, color: COLORS.greyBg });
    cursor.page.drawLine({ start: { x: box.left, y: cursor.y - height }, end: { x: box.right, y: cursor.y - height }, thickness: 0.5, color: COLORS.greyLine });
    let x = box.left;
    t.columns.forEach((col, i) => {
      const font = bold.has(i) ? c.fonts.bold : c.fonts.regular;
      lines[i].forEach((line, k) => {
        const w = textWidth(font, line, TABLE_SIZE);
        const tx = col.align === 'right' ? x + widths[i] - CELL_PAD - w : x + CELL_PAD;
        cursor.page.drawText(line, { x: tx, y: cursor.y - CELL_PAD - (k + 1) * TABLE_SIZE * LINE_GAP + TABLE_SIZE * 0.3, size: TABLE_SIZE, font, color: COLORS.dark });
      });
      x += widths[i];
    });
    cursor = { page: cursor.page, y: cursor.y - height };
  });
  return { page: cursor.page, y: cursor.y - 2 * MM };
}

/** Label/value rows in a shaded box (e.g. totals), right-aligned values; the last row can be highlighted. */
export function drawKeyValueBox(c: DocContext, at: Cursor, rows: Array<{ label: string; value: string; highlight?: boolean }>, o?: { width_mm?: number; row_mm?: number }): Cursor {
  const box = contentBox();
  const width = (o?.width_mm ?? 80) * MM;
  const rowHeight = (o?.row_mm ?? 6.5) * MM;
  let cursor = ensureSpace(c, at, rows.length * rowHeight + 2 * MM);
  const x = box.right - width;
  for (const row of rows) {
    const font = row.highlight ? c.fonts.bold : c.fonts.regular;
    const color = row.highlight ? COLORS.white : COLORS.dark;
    cursor.page.drawRectangle({ x, y: cursor.y - rowHeight, width, height: rowHeight, color: row.highlight ? COLORS.teal : COLORS.greyBg, borderColor: COLORS.greyLine, borderWidth: 0.5 });
    const label = fitText(font, row.label, 9, width / 2);
    const value = fitText(font, row.value, 9, width / 2 - 4 * MM);
    const baseline = cursor.y - rowHeight / 2 - 1.1 * MM;
    cursor.page.drawText(label, { x: x + 3 * MM, y: baseline, size: 9, font, color });
    cursor.page.drawText(value, { x: x + width - 3 * MM - textWidth(font, value, 9), y: baseline, size: 9, font, color });
    cursor = { page: cursor.page, y: cursor.y - rowHeight };
  }
  return { page: cursor.page, y: cursor.y - 3 * MM };
}

/** A shaded box with a small coloured title and wrapped lines (BILL TO / SUPPLIED BY, notices). */
export function drawInfoBox(c: DocContext, at: Cursor, b: { title?: string; lines: string[]; x_mm?: number; width_mm?: number; tinted?: boolean; size?: number }): { cursor: Cursor; height: number } {
  const box = contentBox();
  const x = box.left + (b.x_mm ?? 0) * MM;
  const width = (b.width_mm ?? (box.width / MM)) * MM;
  const size = b.size ?? 9;
  const lineHeight = size * LINE_GAP;
  const inner = width - 6 * MM;
  const wrapped = b.lines.flatMap((l, i) => wrapText(i === 0 && b.title ? c.fonts.bold : c.fonts.regular, l, size, inner).map((text) => ({ text, bold: i === 0 && Boolean(b.title) })));
  const height = (b.title ? 6 * MM : 2 * MM) + wrapped.length * lineHeight + 3 * MM;
  const cursor = ensureSpace(c, at, height);
  cursor.page.drawRectangle({ x, y: cursor.y - height, width, height, color: b.tinted ? COLORS.tealLight : COLORS.greyBg, borderColor: b.tinted ? COLORS.teal : COLORS.greyLine, borderWidth: 0.6 });
  let y = cursor.y - 2 * MM;
  if (b.title) {
    y -= 3 * MM;
    cursor.page.drawText(b.title, { x: x + 3 * MM, y, size: 7.5, font: c.fonts.bold, color: COLORS.teal });
    y -= 1 * MM;
  }
  for (const line of wrapped) {
    y -= lineHeight;
    if (line.text) cursor.page.drawText(line.text, { x: x + 3 * MM, y: y + size * 0.25, size, font: line.bold ? c.fonts.bold : c.fonts.regular, color: COLORS.dark });
  }
  return { cursor: { page: cursor.page, y: cursor.y - height - 3 * MM }, height };
}

/** The finished PDF bytes. */
export async function saveDocument(c: DocContext): Promise<Uint8Array> {
  return c.doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
