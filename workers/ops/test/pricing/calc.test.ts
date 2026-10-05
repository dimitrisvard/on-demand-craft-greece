// Q-1: the deterministic quote calculator against golden cases. Every rule value here is synthetic test data (no
// business rate is committed); the expected numbers are worked out by hand from the formulas in src/pricing/calc.ts.
import { describe, expect, it } from 'vitest';
import type { CadResultV1 } from '../../src/cad/types';
import { calculateQuote, isGreece, priceLine, round2 } from '../../src/pricing/calc';
import { eurPerKg, matchCatalog, recogniseMaterial } from '../../src/pricing/materials';
import { activeRules, findRule, normaliseUnit, ruleValue, rulesVersion, ruleWarnings } from '../../src/pricing/rules';
import type { CatalogMaterialRow, LineInput, PricingRuleRow } from '../../src/pricing/types';
import { checkList, sorted } from '../helpers/check-lists';

let ruleSeq = 0;
function rule(process: PricingRuleRow['process'], rule_key: string, value: number, unit: string, extra: Partial<PricingRuleRow> = {}): PricingRuleRow {
  ruleSeq++;
  return {
    id: `00000000-0000-4000-8000-${String(ruleSeq).padStart(12, '0')}`,
    process,
    rule_key,
    material_match: null,
    qty_min: null,
    qty_max: null,
    value,
    unit,
    currency: 'EUR',
    version: 1,
    valid_from: '2026-01-01',
    valid_to: null,
    is_active: true,
    ...extra,
  };
}

const SHEET_RULES: PricingRuleRow[] = [
  rule('sheet_metal', 'sheet_scrap_factor', 1.15, 'factor'),
  rule('sheet_metal', 'laser_cut_speed_mm_min', 3000, 'mm/min'),
  rule('sheet_metal', 'laser_pierce_s', 1, 's'),
  rule('sheet_metal', 'laser_rate_per_h', 120, 'EUR/h'),
  rule('sheet_metal', 'bend_per_hit', 1.5, 'EUR/hit'),
  rule('sheet_metal', 'bend_setup', 30, 'EUR'),
  rule('sheet_metal', 'setup_fixed', 20, 'EUR'),
  rule('sheet_metal', 'margin_pct', 25, 'pct'),
  rule('finishing', 'finish_powder_coating_per_m2', 12, 'EUR/m2'),
  rule('global', 'min_order_value', 150, 'EUR'),
  rule('shipping', 'shipping_flat', 35, 'EUR'),
];

const CATALOG: CatalogMaterialRow[] = [
  { id: 'cat-s235-2', material_grade: 'S235JR', form_factor: 'sheet', dimensions: { thickness_mm: 2 }, weight_per_unit: null, stock_unit: 'sheet', price_per_unit: null, price_per_kg: 1.2, currency: 'EUR', is_available: true },
  { id: 'cat-304-1', material_grade: '1.4301', form_factor: 'sheet', dimensions: { thickness_mm: 1.0 }, weight_per_unit: 25, stock_unit: 'sheet', price_per_unit: 100, price_per_kg: null, currency: 'EUR', is_available: true },
  { id: 'cat-5754-3', material_grade: 'AlMg3', form_factor: 'sheet', dimensions: { thickness_mm: 3 }, weight_per_unit: null, stock_unit: 'kg', price_per_unit: 4.5, price_per_kg: null, currency: 'EUR', is_available: true },
  { id: 'cat-6082-bar', material_grade: 'EN AW-6082', form_factor: 'round_bar', dimensions: { diameter_mm: 60 }, weight_per_unit: null, stock_unit: 'kg', price_per_unit: 6, price_per_kg: null, currency: 'EUR', is_available: true },
];

function geometry(over: Partial<CadResultV1> = {}): CadResultV1 {
  return {
    v: 1,
    kind: 'step',
    source: 'unfold-service',
    units: 'mm',
    thickness_mm: 2,
    flat: { width_mm: 200, height_mm: 100, area_mm2: 18000, cut_length_mm: 700, pierces: 2 },
    bends: { count: 2, items: [{ angle_deg: 90, radius_mm: 2 }, { angle_deg: 90, radius_mm: 2 }] },
    bbox_mm: null,
    volume_mm3: null,
    warnings: [],
    versions: {},
    duration_ms: 10,
    ...over,
  };
}

function line(over: Partial<LineInput> = {}): LineInput {
  return {
    line_no: 1,
    part_id: 'part-1',
    product_name: 'Part 1',
    description: 'Process: Sheet Metal\nMaterial: S235JR',
    qty: 10,
    process: 'sheet_metal',
    material_text: 'S235JR',
    grade: 'S235JR',
    family: 'steel',
    thickness_mm: 2,
    finish_code: null,
    tolerance: null,
    geometry: geometry(),
    cad_job_id: 'job-1',
    geometry_problem: null,
    files: ['bracket.step'],
    ...over,
  };
}

describe('sheet-metal line', () => {
  it('with bends: every intermediate and the rounded unit price follow the formula', () => {
    const l = priceLine(line(), SHEET_RULES, CATALOG);
    expect(l.blank_mm2).toBe(20000);
    expect(l.mass_kg).toBeCloseTo(0.314, 10);
    expect(l.material_unit).toBeCloseTo(0.314 * 1.2 * 1.15, 10);
    expect(l.cut_unit).toBeCloseTo((700 / 3000 / 60 + 2 / 3600) * 120, 10);
    expect(l.bend_unit).toBe(3);
    expect(l.finish_unit).toBe(0);
    expect(l.setup_total).toBe(50);
    expect(l.margin_pct).toBeCloseTo(0.25, 12);
    expect(l.unit_cost).toBeCloseTo(0.43332 + 0.5333333333 + 3 + 5, 6);
    expect(l.unit_price).toBe(11.21);
    expect(l.line_total).toBe(112.1);
    expect(l.manual).toBe(false);
    expect(l.catalog_material_id).toBe('cat-s235-2');
    expect(l.eur_per_kg_source).toBe('price_per_kg');
    expect(l.rule_ids.length).toBe(8);
  });

  it('without bends: no bend cost and no bend setup; a finish prices both faces of the net area', () => {
    const g = geometry({ flat: { width_mm: 100, height_mm: 50, area_mm2: null, cut_length_mm: 300, pierces: 0 }, bends: { count: 0, items: [] } });
    const l = priceLine(line({ geometry: g, finish_code: 'powder_coating', qty: 4 }), SHEET_RULES, CATALOG);
    expect(l.bend_unit).toBe(0);
    expect(l.setup_total).toBe(20);
    expect(l.finish_unit).toBeCloseTo((5000 * 2) / 1e6 * 12, 12);
    const material = 5000 * 2 * 7850e-9 * 1.2 * 1.15;
    const cut = (300 / 3000 / 60) * 120;
    expect(l.unit_price).toBe(round2((material + cut + 0.12 + 20 / 4) * 1.25));
    expect(l.manual).toBe(false);
  });

  it('a missing rule makes the line manual (never zero) and names the key; the suggestion is not computed', () => {
    const rules = SHEET_RULES.filter((r) => r.rule_key !== 'laser_rate_per_h');
    const l = priceLine(line(), rules, CATALOG);
    expect(l.manual).toBe(true);
    expect(l.manual_reasons).toContain('rule_missing:laser_rate_per_h');
    expect(l.cut_unit).toBeNull();
    expect(l.unit_price).toBeNull();
    expect(l.suggested_unit_price).toBeNull();
  });

  it('a missing finish rate makes only a finished part manual', () => {
    expect(priceLine(line({ finish_code: 'anodising' }), SHEET_RULES, CATALOG).manual_reasons).toEqual(['rule_missing:finish_anodising_per_m2']);
    expect(priceLine(line(), SHEET_RULES, CATALOG).manual).toBe(false);
  });

  it('missing geometry, thickness, quantity or material price: manual with the reason', () => {
    expect(priceLine(line({ geometry: null, geometry_problem: 'geometry_missing', cad_job_id: null }), SHEET_RULES, CATALOG).manual_reasons).toContain('geometry_missing');
    expect(priceLine(line({ geometry: geometry({ thickness_mm: null }), thickness_mm: null }), SHEET_RULES, CATALOG).manual_reasons).toContain('thickness_missing');
    expect(priceLine(line({ qty: 0 }), SHEET_RULES, CATALOG).manual_reasons).toContain('quantity_missing');
    const noPrice = CATALOG.map((c) => (c.id === 'cat-s235-2' ? { ...c, price_per_kg: null } : c));
    expect(priceLine(line(), SHEET_RULES, noPrice).manual_reasons).toContain('material_price_missing');
    expect(priceLine(line({ grade: 'S355J2', material_text: 'S355' }), SHEET_RULES, CATALOG).manual_reasons).toContain('material_not_in_catalogue');
    expect(priceLine(line({ grade: null, family: null, material_text: 'unobtainium' }), SHEET_RULES, CATALOG).manual_reasons).toContain('material_unknown');
  });

  it('an open DXF outline (no pierce count) is manual', () => {
    const g = geometry({ flat: { width_mm: 200, height_mm: 100, area_mm2: null, cut_length_mm: 700, pierces: null } });
    expect(priceLine(line({ geometry: g }), SHEET_RULES, CATALOG).manual_reasons).toContain('pierces_missing');
  });

  it('process other is never priced', () => {
    const l = priceLine(line({ process: 'other' }), SHEET_RULES, CATALOG);
    expect(l.manual_reasons).toEqual(['process_not_priced']);
  });
});

describe('margins by quantity band and rule specificity', () => {
  const rules = [
    ...SHEET_RULES.filter((r) => r.rule_key !== 'margin_pct'),
    rule('sheet_metal', 'margin_pct', 30, 'pct', { qty_min: 1, qty_max: 9 }),
    rule('sheet_metal', 'margin_pct', 20, 'pct', { qty_min: 10, qty_max: null }),
    rule('global', 'margin_pct', 50, 'pct'),
  ];
  it('the band of the quantity applies; a process rule wins over a global one', () => {
    expect(priceLine(line({ qty: 5 }), rules, CATALOG).margin_pct).toBeCloseTo(0.3, 12);
    expect(priceLine(line({ qty: 50 }), rules, CATALOG).margin_pct).toBeCloseTo(0.2, 12);
    expect(priceLine(line({ process: 'cnc', geometry: geometry({ bbox_mm: { x: 10, y: 10, z: 10 }, volume_mm3: 500 }) }), rules, CATALOG).margin_pct).toBeCloseTo(0.5, 12);
  });

  it('a grade-specific rule wins over a generic one; a rule for another grade never applies', () => {
    const scoped = [...rules, rule('sheet_metal', 'laser_rate_per_h', 150, 'EUR/h', { material_match: { grade: 'St37' } }), rule('sheet_metal', 'bend_setup', 99, 'EUR', { material_match: { grade: '1.4301' } })];
    const ctx = { process: 'sheet_metal' as const, grade: 'S235JR', family: 'steel', catalog_material_id: null, thickness_mm: 2, qty: 10 };
    expect(ruleValue(findRule(scoped, 'laser_rate_per_h', ctx) as PricingRuleRow)).toBe(150);
    expect(ruleValue(findRule(scoped, 'bend_setup', ctx) as PricingRuleRow)).toBe(30);
    expect(findRule(scoped, 'bend_setup', { ...ctx, grade: 'AISI 304', family: 'stainless' })?.value).toBe(99);
  });

  it('thickness bands, categories and catalogue ids narrow a rule', () => {
    const r = [rule('sheet_metal', 'laser_cut_speed_mm_min', 1000, 'mm/min', { material_match: { category: 'steel', thickness_mm_min: 3, thickness_mm_max: 6 } }), rule('sheet_metal', 'laser_cut_speed_mm_min', 3000, 'mm/min')];
    const base = { process: 'sheet_metal' as const, grade: 'S235JR', family: 'steel', catalog_material_id: 'cat-x', thickness_mm: 2, qty: 1 };
    expect(findRule(r, 'laser_cut_speed_mm_min', base)?.value).toBe(3000);
    expect(findRule(r, 'laser_cut_speed_mm_min', { ...base, thickness_mm: 4 })?.value).toBe(1000);
    expect(findRule(r, 'laser_cut_speed_mm_min', { ...base, thickness_mm: 4, family: 'aluminium' })?.value).toBe(3000);
    const byId = [rule('sheet_metal', 'setup_fixed', 7, 'EUR', { material_match: { catalog_material_id: 'cat-x' } }), rule('sheet_metal', 'setup_fixed', 9, 'EUR')];
    expect(findRule(byId, 'setup_fixed', base)?.value).toBe(7);
    expect(findRule(byId, 'setup_fixed', { ...base, catalog_material_id: 'cat-y' })?.value).toBe(9);
  });

  it('the highest version wins among equally specific rules; inactive and expired rules are dropped', () => {
    const r = [rule('sheet_metal', 'setup_fixed', 20, 'EUR', { version: 1 }), rule('sheet_metal', 'setup_fixed', 25, 'EUR', { version: 2 }), rule('sheet_metal', 'setup_fixed', 99, 'EUR', { version: 3, is_active: false }), rule('sheet_metal', 'setup_fixed', 98, 'EUR', { version: 4, valid_to: '2026-06-30' }), rule('sheet_metal', 'setup_fixed', 97, 'EUR', { version: 5, valid_from: '2027-01-01' })];
    const active = activeRules(r, new Date('2026-10-05T09:00:00Z'));
    expect(active.map((x) => x.value)).toEqual([20, 25]);
    expect(findRule(active, 'setup_fixed', { process: 'sheet_metal', grade: null, family: null, catalog_material_id: null, thickness_mm: null, qty: null })?.value).toBe(25);
  });

  it('a rule with a wrong unit or currency is never applied and is reported', () => {
    const r = [rule('sheet_metal', 'bend_per_hit', 1.5, 'EUR/m'), rule('sheet_metal', 'setup_fixed', 20, 'EUR', { currency: 'USD' }), rule('sheet_metal', 'laser_rate_per_h', 120, ' € per h ')];
    expect(findRule(r, 'bend_per_hit', { process: 'sheet_metal', grade: null, family: null, catalog_material_id: null, thickness_mm: null, qty: 1 })).toBeNull();
    expect(findRule(r, 'setup_fixed', { process: 'sheet_metal', grade: null, family: null, catalog_material_id: null, thickness_mm: null, qty: 1 })).toBeNull();
    expect(findRule(r, 'laser_rate_per_h', { process: 'sheet_metal', grade: null, family: null, catalog_material_id: null, thickness_mm: null, qty: 1 })?.value).toBe(120);
    expect(ruleWarnings(r)).toHaveLength(2);
    expect(normaliseUnit(' € per m² ')).toBe('eur/m2');
  });

  it('kerf_factor is read as the sheet scrap factor', () => {
    const r = [rule('sheet_metal', 'kerf_factor', 1.1, 'factor')];
    expect(findRule(r, 'sheet_scrap_factor', { process: 'sheet_metal', grade: null, family: null, catalog_material_id: null, thickness_mm: null, qty: 1 })?.value).toBe(1.1);
  });
});

describe('EUR per kg (A-17) and catalogue matching', () => {
  it('price_per_kg, else price_per_unit for kg stock, else price_per_unit / weight_per_unit; other currencies unknown', () => {
    expect(eurPerKg(CATALOG[0])).toEqual({ value: 1.2, source: 'price_per_kg' });
    expect(eurPerKg(CATALOG[1])).toEqual({ value: 4, source: 'unit_per_weight' });
    expect(eurPerKg(CATALOG[2])).toEqual({ value: 4.5, source: 'kg_unit' });
    expect(eurPerKg({ ...CATALOG[0], currency: 'USD' })).toBeNull();
    expect(eurPerKg({ ...CATALOG[1], weight_per_unit: null })).toBeNull();
  });

  it('sheet lines match grade aliases and thickness within 0.05 mm; CNC lines any form of the grade', () => {
    expect(matchCatalog(CATALOG, { grade: 'AISI 304', thickness_mm: 1.04, process: 'sheet_metal' })?.id).toBe('cat-304-1');
    expect(matchCatalog(CATALOG, { grade: 'AISI 304', thickness_mm: 1.1, process: 'sheet_metal' })).toBeNull();
    expect(matchCatalog(CATALOG, { grade: 'EN AW-5754', thickness_mm: 3, process: 'sheet_metal' })?.id).toBe('cat-5754-3');
    expect(matchCatalog(CATALOG, { grade: 'EN AW-6082', thickness_mm: null, process: 'cnc' })?.id).toBe('cat-6082-bar');
    expect(recogniseMaterial('Edelstahl V2A').grade).toBe('AISI 304');
    expect(recogniseMaterial('Stainless steel 304L').grade).toBe('AISI 304L');
    expect(recogniseMaterial('Aluminium').family).toBe('aluminium');
  });
});

describe('CNC line', () => {
  const rules = [rule('cnc', 'cnc_rate_per_h', 60, 'EUR/h'), rule('cnc', 'cnc_mrr_cm3_min', 20, 'cm3/min'), rule('cnc', 'cnc_setup', 40, 'EUR'), rule('cnc', 'margin_pct', 30, 'pct')];
  it('prices from the stock (bbox + 3 mm per side) and is always a rough manual line with a suggestion', () => {
    const g = geometry({ kind: 'step', source: 'inline-ts', flat: null, bends: null, thickness_mm: null, bbox_mm: { x: 50, y: 40, z: 20 }, volume_mm3: 30000 });
    const l = priceLine(line({ process: 'cnc', grade: 'EN AW-6082', family: 'aluminium', material_text: 'AlSi1MgMn', geometry: g, thickness_mm: null, qty: 2 }), rules, CATALOG);
    const stock = 56 * 46 * 26;
    expect(l.mass_kg).toBeCloseTo(stock * 2700e-9, 12);
    expect(l.material_unit).toBeCloseTo(stock * 2700e-9 * 6, 10);
    expect(l.machining_unit).toBeCloseTo(((stock - 30000) / 1000 / 20 / 60) * 60, 10);
    expect(l.estimate_quality).toBe('rough');
    expect(l.manual).toBe(true);
    expect(l.manual_reasons).toEqual(['cnc_rough_estimate']);
    expect(l.suggested_unit_price).toBe(round2((stock * 2700e-9 * 6 + ((stock - 30000) / 1000 / 20 / 60) * 60 + 40 / 2) * 1.3));
    expect(l.unit_price).toBeNull();
  });
});

describe('quote totals', () => {
  it('a small complete quote gets the minimum-order surcharge and the flat shipping', () => {
    const q = calculateQuote({ lines: [line()], rules: SHEET_RULES, catalog: CATALOG, rules_version: 'v-test', country: 'DE' });
    expect(q.subtotal).toBe(112.1);
    expect(q.min_order_surcharge).toBe(37.9);
    expect(q.shipping).toBe(35);
    expect(q.shipping_source).toBe('rule');
    expect(q.total_net).toBe(185);
    expect(q.complete).toBe(true);
    expect(q.vat).toEqual({ mode: 'intra_community_notice', country: 'DE' });
  });

  it('a manual line keeps the quote incomplete (no total, no surcharge) until an override prices it', () => {
    const lines = [line(), line({ line_no: 2, part_id: 'part-2', geometry: null, geometry_problem: 'cad_failed', cad_job_id: null })];
    const draft = calculateQuote({ lines, rules: SHEET_RULES, catalog: CATALOG, rules_version: 'v', country: 'DE' });
    expect(draft.manual_lines).toEqual([2]);
    expect(draft.complete).toBe(false);
    expect(draft.total_net).toBeNull();
    expect(draft.min_order_surcharge).toBeNull();
    const approved = calculateQuote({ lines, rules: SHEET_RULES, catalog: CATALOG, rules_version: 'v', country: 'DE', overrides: [{ line_no: 2, unit_price: 40, note: 'priced by hand' }], shipping_override: 50 });
    expect(approved.manual_lines).toEqual([]);
    expect(approved.lines[1].unit_price).toBe(40);
    expect(approved.lines[1].line_total).toBe(400);
    expect(approved.lines[1].override).toEqual({ unit_price: 40, note: 'priced by hand' });
    expect(approved.subtotal).toBe(512.1);
    expect(approved.min_order_surcharge).toBe(0);
    expect(approved.shipping).toBe(50);
    expect(approved.shipping_source).toBe('override');
    expect(approved.total_net).toBe(562.1);
    expect(approved.overrides).toEqual([{ line_no: 2, unit_price: 40, note: 'priced by hand' }]);
  });

  it('an override replaces a computed price too; the suggestion stays recorded', () => {
    const q = calculateQuote({ lines: [line()], rules: SHEET_RULES, catalog: CATALOG, rules_version: 'v', country: 'AT', overrides: [{ line_no: 1, unit_price: 10 }] });
    expect(q.lines[0].unit_price).toBe(10);
    expect(q.lines[0].suggested_unit_price).toBe(11.21);
  });

  it('without a shipping rule the quote is not complete; Greek customers get VAT to be confirmed', () => {
    const q = calculateQuote({ lines: [line()], rules: SHEET_RULES.filter((r) => r.rule_key !== 'shipping_flat'), catalog: CATALOG, rules_version: 'v', country: 'Ελλάδα' });
    expect(q.shipping).toBeNull();
    expect(q.complete).toBe(false);
    expect(q.vat.mode).toBe('to_be_confirmed');
    expect(['GR', 'Greece', 'hellas', 'Ελλάς'].map(isGreece)).toEqual([true, true, true, true]);
    expect(['DE', 'Germany', null].map(isGreece)).toEqual([false, false, false]);
  });

  it('is deterministic: the same input gives the same PricingV1', () => {
    const a = calculateQuote({ lines: [line(), line({ line_no: 2, qty: 3 })], rules: SHEET_RULES, catalog: CATALOG, rules_version: 'v', country: 'DE' });
    const b = calculateQuote({ lines: [line(), line({ line_no: 2, qty: 3 })], rules: [...SHEET_RULES].reverse(), catalog: [...CATALOG].reverse(), rules_version: 'v', country: 'DE' });
    expect(b).toEqual(a);
  });
});

describe('rules_version', () => {
  it('ignores row order, changes with a value, and carries the highest version', async () => {
    const a = await rulesVersion(SHEET_RULES);
    expect(a).toMatch(/^[0-9a-f]{12}\.v1$/);
    expect(await rulesVersion([...SHEET_RULES].reverse())).toBe(a);
    expect(await rulesVersion(SHEET_RULES.map((r, i) => (i === 0 ? { ...r, value: 1.2 } : r)))).not.toBe(a);
    expect(await rulesVersion([...SHEET_RULES, rule('global', 'min_order_value', 200, 'EUR', { version: 3 })])).toMatch(/\.v3$/);
    expect(await rulesVersion([])).toBe('none');
  });
});

describe('lists against the migration', () => {
  it('pricing_rules.process equals the CHECK list', () => {
    const processes: Array<PricingRuleRow['process']> = ['cnc', 'sheet_metal', 'finishing', 'shipping', 'global'];
    expect(sorted(processes)).toEqual(sorted(checkList('pricing_rules_process_check')));
  });
});
