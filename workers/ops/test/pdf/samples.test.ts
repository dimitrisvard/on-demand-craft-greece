// CQ-4: three sample quote PDFs for a visual check, written to workers/ops/.wrangler/pdf-samples/ (git-ignored) by
// `npm run pdf:samples` (PDF_SAMPLES=1; skipped in the normal suite):
//   sample-1-line.pdf          one line, German buyer, intra-Community notice
//   sample-12-lines.pdf        twelve lines with long descriptions (more than one page), a manual line and a
//                              minimum-order surcharge line
//   sample-greek-polish.pdf    a buyer in Greece (VAT to be confirmed) with a Polish contact name and Greek address
// Each sample is rendered twice in the run (same SHA-256). When a file from an earlier run exists, the new
// rendering must be byte-equal to it, so a second `npm run pdf:samples` proves the SHA-256 is stable across runs.
// All names, addresses and prices are synthetic.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { offerNumber, renderQuotePdf, type QuotePdfInput, type QuotePdfLine } from '../../src/pdf/quote-pdf';

const OUT = new URL('../../.wrangler/pdf-samples/', import.meta.url).pathname;

const date = new Date(Date.UTC(2026, 9, 5, 9, 0, 0));
const inquiry = new Date(Date.UTC(2026, 9, 4, 8, 0, 0));
const sheet = 'Process: Sheet Metal\nMaterial: Steel (S235JR)\nThickness: 2 mm\nSurface Treatment: Powder coating RAL 9005';

function line(pos: number, over: Partial<QuotePdfLine> = {}): QuotePdfLine {
  const qty = 10 * pos;
  const unit = 5 + pos * 1.37;
  return { pos, product_name: `Bracket B-${100 + pos}`, description: sheet, files: [`bracket-b${100 + pos}.step`], qty, unit_price: Math.round(unit * 100) / 100, total: Math.round(unit * qty * 100) / 100, ...over };
}

function totals(lines: QuotePdfLine[], shipping: number | null): Pick<QuotePdfInput, 'subtotal' | 'shipping' | 'total_net'> {
  const subtotal = Math.round(lines.reduce((s, l) => s + (l.total ?? 0), 0) * 100) / 100;
  const open = lines.some((l) => l.total === null) || shipping === null;
  return { subtotal, shipping, total_net: open ? null : Math.round((subtotal + (shipping ?? 0)) * 100) / 100 };
}

const one = [line(1, { qty: 20, unit_price: 8.62, total: 172.4 })];
const twelve = Array.from({ length: 12 }, (_, i) =>
  line(i + 1, {
    description: i % 4 === 3 ? 'Process: CNC Machining\nMaterial: Aluminium (6082)\nTolerance: ISO 2768-f\nComments: anodised black, threads M6 x 4, chamfer all outer edges 0.5 x 45 degrees, deburr' : `${sheet}\nComments: deburr all edges${i % 3 === 0 ? ', laser-etched part number on the inner face, packed per 10 pieces' : ''}`,
    ...(i === 7 ? { unit_price: null, total: null, note: 'Price on request (no CAD file)' } : {}),
  }),
);
twelve.push({ pos: 13, product_name: 'Minimum order surcharge', description: '', files: [], qty: 1, unit_price: 25, total: 25 });
const greekLines = [
  line(1, { product_name: 'Γωνία στήριξης ΓΣ-20', description: 'Process: Sheet Metal\nMaterial: Stainless steel (1.4301)\nThickness: 1.5 mm', qty: 50, unit_price: 6.4, total: 320 }),
  line(2, { product_name: 'Płytka montażowa', description: 'Process: Laser cutting\nMaterial: Aluminium (5754)\nThickness: 3 mm', qty: 25, unit_price: 4.1, total: 102.5 }),
];

const SAMPLES: Array<{ file: string; input: QuotePdfInput; minPages: number }> = [
  {
    file: 'sample-1-line.pdf',
    minPages: 1,
    input: {
      offer_no: offerNumber('RFQ-05102026-7', 1),
      date,
      inquiry_date: inquiry,
      buyer: { company: 'Example Metall GmbH', name: 'Erika Beispiel', address_lines: ['Musterstrasse 1', '10115 Berlin'], country: 'DE', phone: '+49 30 0000000', email: 'erika.beispiel@example.de' },
      lines: one,
      ...totals(one, 35),
      vat_mode: 'intra_community_notice',
    },
  },
  {
    file: 'sample-12-lines.pdf',
    minPages: 2,
    input: {
      offer_no: offerNumber('RFQ-05102026-9', 2),
      date,
      inquiry_date: inquiry,
      buyer: { company: 'Example Fabrication B.V.', name: 'Jan de Voorbeeld', address_lines: ['Voorbeeldstraat 12', '1011 AB Amsterdam'], country: 'NL', phone: null, email: 'jan@example.nl' },
      lines: twelve,
      ...totals(twelve, 60),
      vat_mode: 'intra_community_notice',
    },
  },
  {
    file: 'sample-greek-polish.pdf',
    minPages: 1,
    input: {
      offer_no: offerNumber('RFQ-05102026-11', 1),
      date,
      inquiry_date: inquiry,
      buyer: { company: 'Παράδειγμα Μεταλλικά Α.Ε.', name: 'Zażółć Gęślą-Jaźń', address_lines: ['Οδός Παραδείγματος 10', '546 25 Θεσσαλονίκη'], country: 'GR', phone: '+30 2310 000000', email: 'info@example.gr' },
      lines: greekLines,
      ...totals(greekLines, 20),
      vat_mode: 'to_be_confirmed',
    },
  },
];

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe.skipIf(!process.env.PDF_SAMPLES)('quote PDF samples (npm run pdf:samples)', () => {
  it.each(SAMPLES.map((s) => [s.file, s] as const))('%s', async (_file, s) => {
    const first = await renderQuotePdf(s.input);
    const second = await renderQuotePdf(s.input);
    expect(second.sha256).toBe(first.sha256);
    expect(sha(first.bytes)).toBe(first.sha256);
    expect(first.pages).toBeGreaterThanOrEqual(s.minPages);
    const loaded = await PDFDocument.load(first.bytes);
    expect(loaded.getPageCount()).toBe(first.pages);
    mkdirSync(OUT, { recursive: true });
    const path = `${OUT}${s.file}`;
    if (existsSync(path)) expect(sha(new Uint8Array(readFileSync(path))), `${s.file} differs from the earlier run`).toBe(first.sha256);
    writeFileSync(path, first.bytes);
    writeFileSync(`${path}.sha256`, `${first.sha256}  ${s.file}\n`);
    console.log(`${s.file}: ${first.pages} page(s), sha256 ${first.sha256}`);
  });
});
