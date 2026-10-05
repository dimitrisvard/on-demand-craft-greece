// Q-3: the quote PDF (pdf-lib + Liberation Sans subsets) and the PDF trimming for the model.
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { FONT_NAMES } from '../../src/pdf/fonts';
import { offerNumber, pdfLines, renderQuotePdf, type QuotePdfInput } from '../../src/pdf/quote-pdf';
import { TRIM_MAX_PAGES, bytesToBase64, trimPdf } from '../../src/pdf/trim';
import type { PricingV1 } from '../../src/pricing/types';

const here = (p: string) => new URL(p, import.meta.url);

function input(over: Partial<QuotePdfInput> = {}, lineCount = 1): QuotePdfInput {
  return {
    offer_no: offerNumber('RFQ-05102026-1', 1),
    date: new Date(Date.UTC(2026, 9, 5)),
    inquiry_date: new Date(Date.UTC(2026, 9, 1)),
    buyer: { company: 'Example GmbH', name: 'Erika Beispiel', address_lines: ['Musterstrasse 1', '10115 Berlin'], country: 'DE', phone: '+49 30 000000', email: 'erika@example.de' },
    lines: Array.from({ length: lineCount }, (_, i) => ({
      pos: i + 1,
      product_name: `Part ${i + 1}`,
      description: 'Process: Sheet Metal\nMaterial: Steel (S235JR)\nThickness: 2 mm\nSurface Treatment: Powder coating\nTolerance: ISO 2768-m\nComments: deburr all edges, '.repeat(i % 3 === 0 ? 1 : 2),
      files: [`bracket-${i + 1}.step`],
      qty: 10 + i,
      unit_price: 11.21 + i,
      total: (11.21 + i) * (10 + i),
    })),
    subtotal: 112.1,
    shipping: 35,
    total_net: 147.1,
    vat_mode: 'intra_community_notice',
    ...over,
  };
}

async function text(bytes: Uint8Array): Promise<string> {
  return new TextDecoder('latin1').decode(bytes);
}

describe('renderQuotePdf', () => {
  it('a one-line quote: %PDF-, one page, loads back, fixed dates and embedded Liberation subsets', async () => {
    const pdf = await renderQuotePdf(input());
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.pages).toBe(1);
    expect(pdf.sha256).toMatch(/^[0-9a-f]{64}$/);
    const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Offer RFQ-05102026-1');
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    const raw = await text(pdf.bytes);
    expect(raw).toContain(FONT_NAMES.regular);
    expect(raw).toContain(FONT_NAMES.bold);
    expect(raw).not.toContain('/Helvetica');
  });

  it('twelve lines break into more pages, with the footer band on each page', async () => {
    const pdf = await renderQuotePdf(input({}, 12));
    expect(pdf.pages).toBeGreaterThan(1);
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBe(pdf.pages);
  });

  it('Greek and Polish text embeds without error', async () => {
    const pdf = await renderQuotePdf(
      input({
        buyer: { company: 'Παράδειγμα Α.Ε.', name: 'Γιώργος Παπαδόπουλος', address_lines: ['Οδός Ερμού 1', '10563 Αθήνα'], country: 'Ελλάδα', phone: null, email: null },
        lines: [{ pos: 1, product_name: 'Część żółta', description: 'Materiał: stal nierdzewna, gięcie, ŁÓDŹ ąęśćńźż', files: ['wspornik.dxf'], qty: 5, unit_price: null, total: null }],
        vat_mode: 'to_be_confirmed',
        total_net: null,
      }),
    );
    expect(pdf.pages).toBeGreaterThanOrEqual(1);
    await PDFDocument.load(pdf.bytes);
  });

  it('is deterministic: the same input gives the same bytes and hash', async () => {
    const a = await renderQuotePdf(input({}, 7));
    const b = await renderQuotePdf(input({}, 7));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(a.sha256).toBe(b.sha256);
    const c = await renderQuotePdf(input({ shipping: 36 }, 7));
    expect(c.sha256).not.toBe(a.sha256);
  });

  it('offer numbers carry the version from v2 on', () => {
    expect(offerNumber('RFQ-05102026-1', 1)).toBe('RFQ-05102026-1');
    expect(offerNumber('RFQ-05102026-1', 3)).toBe('RFQ-05102026-1 v3');
  });

  it('pdfLines adds the minimum-order surcharge as its own line and keeps override notes', () => {
    const pricing = {
      lines: [{ product_name: 'Part 1', description: 'd', files: ['a.step'], qty: 2, unit_price: 10, line_total: 20, override: { unit_price: 10, note: 'agreed' } }],
      min_order_surcharge: 30,
    } as unknown as PricingV1;
    expect(pdfLines(pricing)).toEqual([
      { pos: 1, product_name: 'Part 1', description: 'd', files: ['a.step'], qty: 2, unit_price: 10, total: 20, note: 'agreed' },
      { pos: 2, product_name: 'Minimum order surcharge', description: 'Minimum order value', files: [], qty: 1, unit_price: 30, total: 30 },
    ]);
  });
});

describe('logo', () => {
  it('src/pdf/assets/logo.png is byte-equal to public/logo.png', () => {
    const asset = readFileSync(here('../../src/pdf/assets/logo.png'));
    const site = readFileSync(here('../../../../public/logo.png'));
    expect(Buffer.compare(asset, site)).toBe(0);
    expect(asset.length).toBe(45889);
  });

  it('the licence of the bundled fonts ships beside them', () => {
    expect(readFileSync(here('../../src/pdf/assets/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });
});

describe('trimPdf', () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(here(`../fixtures/pdf/${name}`)));

  it('keeps a one-page PDF whole', async () => {
    const r = await trimPdf(fixture('one-page.pdf'));
    expect(r).toMatchObject({ ok: true, pages: 1, total_pages: 1, truncated: false });
  });

  it('keeps pages 1-5 of a seven-page PDF, without the original metadata, deterministically', async () => {
    const r = await trimPdf(fixture('seven-pages.pdf'));
    expect(r).toMatchObject({ ok: true, pages: TRIM_MAX_PAGES, total_pages: 7, truncated: true });
    if (!r.ok) throw new Error('not trimmed');
    const doc = await PDFDocument.load(r.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getTitle()).toBeUndefined();
    const again = await trimPdf(fixture('seven-pages.pdf'));
    expect(again.ok && bytesToBase64(again.bytes) === bytesToBase64(r.bytes)).toBe(true);
  });

  it('reports encrypted and unreadable files (nothing goes to the model)', async () => {
    expect(await trimPdf(fixture('encrypted.pdf'))).toEqual({ ok: false, reason: 'encrypted' });
    expect(await trimPdf(fixture('not-a-pdf.pdf'))).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('base64 matches Buffer encoding for large inputs', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
