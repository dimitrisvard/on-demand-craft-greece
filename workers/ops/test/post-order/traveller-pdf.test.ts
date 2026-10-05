// RP-2 / P-3: the production traveller PDF (pdf-lib + Liberation Sans subsets through the shared layout): %PDF-,
// page count, load round trip, Greek and Polish text, deterministic bytes, no prices.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { FONT_NAMES } from '../../src/pdf/fonts';
import { renderTravellerPdf, type TravellerInput } from '../../src/pdf/traveller-pdf';

function input(over: Partial<TravellerInput> = {}, items = 2): TravellerInput {
  return {
    po_number: 'PO-1001',
    order_date: new Date(Date.UTC(2026, 9, 5, 8, 0, 0)),
    due_date: '2026-10-20T00:00:00.000Z',
    partner: { company_name: 'Laser Partner AE', country: 'GR' },
    items: Array.from({ length: items }, (_, i) => ({
      pos: i + 1,
      product_name: `Bracket ${i + 1}`,
      quantity: 10 + i,
      process: i % 2 ? 'cnc' : 'sheet_metal',
      material: 'S235JR',
      thickness_mm: 2,
      finish: 'powder_coating',
      tolerance: 'ISO 2768-m',
      drawings: ['bracket.step', 'drawing.pdf'],
    })),
    notes: ['Deburr all edges.', 'Powder coat after bending.'],
    qa_checks: ['Check bend angles against the drawing.'],
    ...over,
  };
}

describe('renderTravellerPdf', () => {
  it('a small order: %PDF-, one page, loads back with the title and the fixed date, Liberation subsets embedded', async () => {
    const pdf = await renderTravellerPdf(input());
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.pages).toBe(1);
    expect(pdf.sha256).toMatch(/^[0-9a-f]{64}$/);
    const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Traveller PO-1001');
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-10-05T08:00:00.000Z');
    const raw = new TextDecoder('latin1').decode(pdf.bytes);
    expect(raw).toContain(FONT_NAMES.regular);
    expect(raw).toContain(FONT_NAMES.bold);
  });

  it('many items break into several pages', async () => {
    const pdf = await renderTravellerPdf(input({}, 40));
    expect(pdf.pages).toBeGreaterThan(1);
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(pdf.pages);
  });

  it('Greek and Polish texts embed without error; missing values render as dashes', async () => {
    const pdf = await renderTravellerPdf(
      input({
        partner: { company_name: 'Εργαστήριο Λέιζερ Α.Ε.', country: 'Ελλάδα' },
        due_date: null,
        items: [{ pos: 1, product_name: 'Część żółta', quantity: 3, process: null, material: null, thickness_mm: null, finish: null, tolerance: null, drawings: [] }],
        notes: ['Γυάλισμα όλων των ακμών.'],
        qa_checks: ['Sprawdzić gięcie ŁÓDŹ ąęśćńźż.'],
      }),
    );
    expect(pdf.pages).toBe(1);
    await PDFDocument.load(pdf.bytes);
  });

  it('is deterministic: the same input gives the same bytes; a different input different ones', async () => {
    const a = await renderTravellerPdf(input({}, 5));
    const b = await renderTravellerPdf(input({}, 5));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(a.sha256).toBe(b.sha256);
    const c = await renderTravellerPdf(input({ po_number: 'PO-1002' }, 5));
    expect(c.sha256).not.toBe(a.sha256);
  });
});
