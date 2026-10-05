// Quote cards (approval, reply confirmation, notices): business fields only, within the card limits, Telegram
// buttons for approve/reject and won/lost/counter/ignore; and reprice() of approved edits on the draft's basis.
import { describe, expect, it } from 'vitest';
import { renderTelegram } from '../../src/agents/cards/index';
import { quoteCard, quoteNotice, quoteReplyCard } from '../../src/agents/cards/quote';
import { calculateQuote, reprice } from '../../src/pricing/calc';
import type { CatalogMaterialRow, LineInput, PricingRuleRow } from '../../src/pricing/types';
import { CALLBACK_DATA_RE } from '../../../shared/src/agent-api';
import { BRACKET_RESULT, seedRows } from './seed';

const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const rows = seedRows();
const rules = rows.pricing_rules as unknown as PricingRuleRow[];
const catalog = rows.catalog_materials as unknown as CatalogMaterialRow[];

function line(over: Partial<LineInput> = {}): LineInput {
  return {
    line_no: 1, part_id: 'p1', product_name: 'Part 1', description: 'd', qty: 20, process: 'sheet_metal', material_text: 'S235JR', grade: 'S235JR', family: 'steel',
    thickness_mm: 2, finish_code: null, tolerance: null, geometry: BRACKET_RESULT, cad_job_id: 'j1', geometry_problem: null, files: ['a.step'], ...over,
  };
}

const draft = calculateQuote({ lines: [line(), line({ line_no: 2, part_id: 'p2', geometry: null, geometry_problem: 'cad_failed' })], rules, catalog, rules_version: 'v', country: 'GR' });

describe('quote approval card', () => {
  const card = quoteCard({ run_id: '11111111-2222-4333-8444-555555555555', site_origin: 'https://www.micronshub.eu', rfq_number: 'RFQ-05102026-7', version: 2, company: 'Example Metall GmbH', country: 'DE', pricing: draft, notes: { assumptions: 2, risks: 1, suggestions: 0, injection_suspected: true }, similar: { lines: 4, won: 1, lost: 2 }, pdf_pages: 1 });

  it('shows business fields, flags and approve/reject buttons', () => {
    expect(card.title).toBe('Quote draft RFQ-05102026-7 v2 · Example Metall GmbH (DE)');
    expect(card.allowed_verbs).toEqual(['approve', 'reject']);
    expect(card.flags).toEqual(['manual_lines', 'injection_suspected']);
    const values = Object.fromEntries(card.lines.map((l) => [l.label, l.value]));
    expect(values).toMatchObject({ Offer: 'RFQ-05102026-7 v2', Lines: '2 (1 without price)', 'Total net': 'open (prices missing)', 'Similar quote lines': '4 (won 1, lost 2)', Geometry: '1 line(s) without CAD result', VAT: 'to be confirmed (customer in Greece)', Margin: '25 %' });
    expect(card.lines.length).toBeLessThanOrEqual(12);
    expect(card.open_url).toBe('https://www.micronshub.eu/dashboard/approvals?run=11111111-2222-4333-8444-555555555555');
    const tg = renderTelegram(card, TOKEN);
    const buttons = tg.reply_markup.inline_keyboard[0] as Array<{ text: string; callback_data: string }>;
    expect(buttons.map((b) => b.callback_data)).toEqual([`ap:${TOKEN}:ok`, `ap:${TOKEN}:rej`]);
    for (const b of buttons) expect(b.callback_data).toMatch(CALLBACK_DATA_RE);
    expect(tg.text.length).toBeLessThanOrEqual(4096);
  });

  it('reminder and incomplete variants', () => {
    expect(quoteCard({ ...cardInput(), variant: 'reminder' }).title.startsWith('Reminder: quote draft')).toBe(true);
    const incomplete = quoteCard({ ...cardInput(), variant: 'incomplete' });
    expect(incomplete.title.startsWith('Quote incomplete')).toBe(true);
    expect(incomplete.lines.some((l) => l.label === 'Action')).toBe(true);
  });

  function cardInput() {
    return { run_id: '11111111-2222-4333-8444-555555555555', site_origin: 'https://www.micronshub.eu', rfq_number: 'RFQ-1', version: 1, company: null, country: null, pricing: draft, notes: null, similar: { lines: 0, won: 0, lost: 0 }, pdf_pages: 1 };
  }
});

describe('reply card and notices', () => {
  it('reply card: masked sender, outcome and confidence, won/lost/counter/ignore codes', () => {
    const card = quoteReplyCard({ run_id: '11111111-2222-4333-8444-555555555555', site_origin: 'https://www.micronshub.eu', rfq_number: 'RFQ-1', version: 1, sender_masked: 'e***@example.de', outcome: 'counter_offer', confidence: 0.97 });
    expect(card.kind).toBe('reply');
    expect(card.title).toBe('RFQ-1 reply · classified counter_offer (97 %)');
    expect(card.flags).toEqual([]);
    const codes = (renderTelegram(card, TOKEN).reply_markup.inline_keyboard[0] as Array<{ callback_data: string }>).map((b) => b.callback_data.split(':')[2]);
    expect(codes).toEqual(['won', 'lost', 'ctr', 'ign']);
  });

  it('a notice has no buttons except Open', () => {
    const n = quoteNotice({ run_id: '11111111-2222-4333-8444-555555555555', site_origin: 'https://www.micronshub.eu', rfq_number: 'RFQ-1', version: 1, company: 'X', country: 'DE', text: 'Draft ready (shadow mode): nothing was sent' });
    expect(n.allowed_verbs).toEqual([]);
    expect(renderTelegram(n, null).reply_markup.inline_keyboard).toEqual([[{ text: 'Open', url: n.open_url }]]);
  });
});

describe('reprice', () => {
  it('applies overrides and shipping on the draft basis, keeps notes and similar, and can be applied twice', () => {
    const noShip = calculateQuote({ lines: [line(), line({ line_no: 2, part_id: 'p2', geometry: null, geometry_problem: 'cad_failed' })], rules: rules.filter((r) => r.rule_key !== 'shipping_flat'), catalog, rules_version: 'v', country: 'DE' });
    const withExtras = { ...noShip, notes: { assumptions: ['a'], risks: [], suggestions: [], injection_suspected: false }, similar: [{ line_no: 1, hits: [] }] };
    expect(withExtras.complete).toBe(false);
    const first = reprice(withExtras, { overrides: [{ line_no: 2, unit_price: 10 }] });
    expect(first.complete).toBe(false);
    expect(first.manual_lines).toEqual([]);
    expect(first.shipping).toBeNull();
    const second = reprice(first, { shipping: 20 });
    expect(second).toMatchObject({ complete: true, shipping: 20, shipping_source: 'override', overrides: [{ line_no: 2, unit_price: 10 }] });
    expect(second.lines[1]).toMatchObject({ unit_price: 10, line_total: 200 });
    expect(second.notes).toEqual(withExtras.notes);
    expect(second.similar).toEqual(withExtras.similar);
    expect(second.basis).toEqual(noShip.basis);
    // an override of a computed line wins; the surcharge follows the basis minimum
    const overridden = reprice(second, { overrides: [{ line_no: 1, unit_price: 1 }] });
    expect(overridden.lines[0].unit_price).toBe(1);
    expect(overridden.min_order_surcharge).toBe(0);
    expect(overridden.subtotal).toBe(220);
  });
});
