// Deterministic quote calculator: prices the lines of a quote from CAD geometry, catalogue material prices and the
// owner's pricing rules. Pure (no I/O, no clock): the same inputs always give the same PricingV1.
//
// Sheet-metal line (per part, quantity q; mm and EUR)
//   blank_mm2     = flat.width_mm * flat.height_mm                      (bounding rectangle; nesting is not modelled)
//   mass_kg       = blank_mm2 * thickness_mm * density_kg_m3 * 1e-9
//   material_unit = mass_kg * eur_per_kg * sheet_scrap_factor
//   cut_unit      = (cut_length_mm / laser_cut_speed_mm_min / 60 + pierces * laser_pierce_s / 3600) * laser_rate_per_h
//   bend_unit     = bends.count * bend_per_hit
//   finish_unit   = (area_mm2 ?? blank_mm2) * 2 / 1e6 * finish_<code>_per_m2            (both faces)
//   setup_total   = setup_fixed + (bends.count > 0 ? bend_setup : 0)
//   unit_cost     = material_unit + cut_unit + bend_unit + finish_unit + setup_total / q
//   unit_price    = round2(unit_cost * (1 + margin_pct(q)));  line_total = round2(unit_price * q)
// CNC line: stock = bbox_mm + 3 mm per side; material_unit from the stock mass; machining_unit =
//   (stock_volume - volume_mm3) / 1000 / cnc_mrr_cm3_min / 60 * cnc_rate_per_h; setup cnc_setup; always a manual line
//   with estimate_quality 'rough' (the computed price is only a suggestion).
// Quote: subtotal = sum of line totals; when every line is priced and a min_order_value rule exists, a surcharge brings
//   the subtotal up to it; shipping = the approved override, else the shipping_flat rule; VAT 0 with the
//   intra-Community notice, except for customers in Greece (VAT "to be confirmed").
//
// Rules
//   - No business number lives here: every rate, margin, minimum and shipping amount is a pricing_rules row. A
//     missing rule, material price, geometry, thickness or quantity makes the component (and so the line) manual,
//     never zero. A manual line keeps the computed suggestion when one exists.
//   - An approved override (line_no, unit_price) prices that line; the calculator's suggestion stays recorded.
//   - The quote is complete when every line has a price and shipping is known; only then is total_net set.
//   - reprice() applies approved overrides and shipping to a stored draft without the rules: the minimum order value
//     and the shipping amount the draft was priced with travel in PricingV1.basis, and earlier overrides, notes and
//     similar-quote hits are kept.

import { DENSITY_KG_M3, eurPerKg, matchCatalog, type MaterialFamily } from './materials';
import { findRule, ruleValue, ruleWarnings, type RuleContext, type RuleKey } from './rules';
import type { CatalogMaterialRow, LineInput, PricingLineV1, PricingRuleRow, PricingV1 } from './types';

/** Stock allowance per side of a CNC blank (mm). */
export const CNC_STOCK_ALLOWANCE_MM = 3;

export interface CalcInput {
  lines: readonly LineInput[];
  /** Active rules of the tenant on the pricing date (pricing/rules.ts activeRules). */
  rules: readonly PricingRuleRow[];
  catalog: readonly CatalogMaterialRow[];
  rules_version: string;
  /** Customer country as written on the RFQ (only Greece changes the VAT mode). */
  country: string | null;
  overrides?: ReadonlyArray<{ line_no: number; unit_price: number; note?: string }>;
  /** Approved shipping amount (replaces the shipping_flat rule). */
  shipping_override?: number | null;
}

/** Rounds half away from zero to cents. */
export function round2(x: number): number {
  const r = Math.round(Math.abs(x) * 100 + 1e-7) / 100;
  return x < 0 ? -r : r;
}

/** True for the customer countries whose quotes carry Greek VAT (written as code, English, Greek or 'Hellas'). */
export function isGreece(country: string | null | undefined): boolean {
  const c = String(country ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ['gr', 'el', 'grc', 'greece', 'hellas', 'ellada', 'ελλαδα', 'ελλας'].includes(c);
}

interface Component {
  rule_ids: string[];
  missing: string[];
}

function missing(...why: string[]): Component {
  return { rule_ids: [], missing: why };
}

type Lookup = (key: RuleKey) => { value: number; id: string } | null;

function lookupFor(rules: readonly PricingRuleRow[], c: RuleContext): Lookup {
  return (key) => {
    const rule = findRule(rules, key, c);
    return rule ? { value: ruleValue(rule), id: rule.id } : null;
  };
}

/** The values of the keys when every one has a rule (else null), and the component recording ids or missing keys. */
function need(get: Lookup, keys: RuleKey[]): { values: number[] | null; comp: Component } {
  const found = keys.map((k) => get(k));
  const absent = keys.filter((_, i) => found[i] === null).map((k) => `rule_missing:${k}`);
  if (absent.length) return { values: null, comp: missing(...absent) };
  const hits = found as Array<{ value: number; id: string }>;
  return { values: hits.map((h) => h.value), comp: { rule_ids: hits.map((h) => h.id), missing: [] } };
}

function emptyLine(l: LineInput): PricingLineV1 {
  return {
    line_no: l.line_no,
    part_id: l.part_id,
    product_name: l.product_name,
    description: l.description,
    process: l.process,
    qty: l.qty,
    material: { text: l.material_text, grade: l.grade, family: l.family, thickness_mm: l.thickness_mm },
    catalog_material_id: null,
    eur_per_kg: null,
    eur_per_kg_source: null,
    density_kg_m3: null,
    cad_job_id: l.cad_job_id,
    blank_mm2: null,
    mass_kg: null,
    material_unit: null,
    cut_unit: null,
    bend_unit: null,
    finish_unit: null,
    machining_unit: null,
    setup_total: null,
    margin_pct: null,
    unit_cost: null,
    suggested_unit_price: null,
    unit_price: null,
    line_total: null,
    manual: true,
    manual_reasons: [],
    estimate_quality: 'standard',
    rule_ids: [],
    override: null,
    files: [...l.files],
  };
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Material price and density of a line (shared by both processes). */
function materialOf(l: LineInput, catalog: readonly CatalogMaterialRow[], process: 'sheet_metal' | 'cnc'): { row: CatalogMaterialRow | null; perKg: ReturnType<typeof eurPerKg>; density: number | null; problems: string[] } {
  const problems: string[] = [];
  const density = l.family && l.family in DENSITY_KG_M3 ? DENSITY_KG_M3[l.family as MaterialFamily] : null;
  if (!l.grade) problems.push(l.family ? 'material_grade_unknown' : 'material_unknown');
  const row = l.grade ? matchCatalog(catalog, { grade: l.grade, thickness_mm: l.thickness_mm, process }) : null;
  if (l.grade && !row) problems.push('material_not_in_catalogue');
  const perKg = row ? eurPerKg(row) : null;
  if (row && !perKg) problems.push('material_price_missing');
  return { row, perKg, density, problems };
}

function setMaterial(out: PricingLineV1, mat: ReturnType<typeof materialOf>): void {
  out.catalog_material_id = mat.row?.id ?? null;
  out.eur_per_kg = mat.perKg?.value ?? null;
  out.eur_per_kg_source = mat.perKg?.source ?? null;
  out.density_kg_m3 = mat.density;
}

function priceSheetMetal(l: LineInput, out: PricingLineV1, get: Lookup, catalog: readonly CatalogMaterialRow[]): Component[] {
  const g = l.geometry;
  const comps: Component[] = [];
  const mat = materialOf(l, catalog, 'sheet_metal');
  setMaterial(out, mat);
  if (mat.problems.length) comps.push(missing(...mat.problems));
  const flat = g?.flat ?? null;
  const blank = flat && positive(flat.width_mm) && positive(flat.height_mm) ? flat.width_mm * flat.height_mm : null;
  out.blank_mm2 = blank;
  if (blank === null) comps.push(missing(l.geometry_problem ?? 'flat_size_missing'));
  if (l.thickness_mm === null) comps.push(missing('thickness_missing'));

  // Material
  if (blank !== null && l.thickness_mm !== null && mat.density !== null) out.mass_kg = blank * l.thickness_mm * mat.density * 1e-9;
  const scrap = need(get, ['sheet_scrap_factor']);
  comps.push(scrap.comp);
  if (out.mass_kg !== null && mat.perKg && scrap.values) out.material_unit = out.mass_kg * mat.perKg.value * scrap.values[0];

  // Cutting
  const cutLength = flat?.cut_length_mm ?? null;
  const pierces = flat?.pierces ?? null;
  if (blank !== null && cutLength === null) comps.push(missing('cut_length_missing'));
  if (blank !== null && pierces === null) comps.push(missing('pierces_missing'));
  const cut = need(get, ['laser_cut_speed_mm_min', 'laser_pierce_s', 'laser_rate_per_h']);
  comps.push(cut.comp);
  if (cut.values && cutLength !== null && pierces !== null) {
    const [speed, pierceS, rate] = cut.values;
    if (speed > 0) out.cut_unit = (cutLength / speed / 60 + (pierces * pierceS) / 3600) * rate;
    else comps.push(missing('rule_invalid:laser_cut_speed_mm_min'));
  }

  // Bending
  // Without geometry the bend count is unknown; the geometry reason above already makes the line manual.
  const bends = g ? (g.bends?.count ?? 0) : null;
  if (bends !== null && bends > 0) {
    const bend = need(get, ['bend_per_hit']);
    comps.push(bend.comp);
    if (bend.values) out.bend_unit = bends * bend.values[0];
  } else if (bends === 0) out.bend_unit = 0;

  // Finish (both faces of the net area, else of the blank)
  if (l.finish_code) {
    const area = flat?.area_mm2 ?? blank;
    const finish = need(get, [`finish_${l.finish_code}_per_m2`]);
    comps.push(finish.comp);
    if (finish.values && area !== null) out.finish_unit = ((area * 2) / 1e6) * finish.values[0];
  } else out.finish_unit = 0;

  // Setup
  const setup = need(get, bends !== null && bends > 0 ? ['setup_fixed', 'bend_setup'] : ['setup_fixed']);
  comps.push(setup.comp);
  if (setup.values) out.setup_total = setup.values.reduce((s, v) => s + v, 0);
  return comps;
}

function priceCnc(l: LineInput, out: PricingLineV1, get: Lookup, catalog: readonly CatalogMaterialRow[]): Component[] {
  const g = l.geometry;
  const comps: Component[] = [missing('cnc_rough_estimate')];
  out.estimate_quality = 'rough';
  const mat = materialOf(l, catalog, 'cnc');
  setMaterial(out, mat);
  if (mat.problems.length) comps.push(missing(...mat.problems));
  const bbox = g?.bbox_mm ?? null;
  const volume = g?.volume_mm3 ?? null;
  if (!bbox || !positive(bbox.x) || !positive(bbox.y) || !positive(bbox.z) || !positive(volume)) {
    comps.push(missing(l.geometry_problem ?? 'bbox_or_volume_missing'));
    return comps;
  }
  const a = 2 * CNC_STOCK_ALLOWANCE_MM;
  const stock = (bbox.x + a) * (bbox.y + a) * (bbox.z + a);
  if (mat.density !== null) out.mass_kg = stock * mat.density * 1e-9;
  if (out.mass_kg !== null && mat.perKg) out.material_unit = out.mass_kg * mat.perKg.value;
  const machining = need(get, ['cnc_mrr_cm3_min', 'cnc_rate_per_h']);
  comps.push(machining.comp);
  if (machining.values) {
    const [mrr, rate] = machining.values;
    if (mrr > 0) out.machining_unit = (Math.max(stock - volume, 0) / 1000 / mrr / 60) * rate;
    else comps.push(missing('rule_invalid:cnc_mrr_cm3_min'));
  }
  if (l.finish_code) {
    const surface = 2 * (bbox.x * bbox.y + bbox.y * bbox.z + bbox.x * bbox.z);
    const finish = need(get, [`finish_${l.finish_code}_per_m2`]);
    comps.push(finish.comp);
    if (finish.values) out.finish_unit = (surface / 1e6) * finish.values[0];
  } else out.finish_unit = 0;
  const setup = need(get, ['cnc_setup']);
  comps.push(setup.comp);
  if (setup.values) out.setup_total = setup.values[0];
  return comps;
}

/** Prices one line (before overrides). */
export function priceLine(l: LineInput, rules: readonly PricingRuleRow[], catalog: readonly CatalogMaterialRow[]): PricingLineV1 {
  const out = emptyLine(l);
  const qty = Number.isSafeInteger(l.qty) && l.qty > 0 ? l.qty : null;
  const ctxFor = (process: RuleContext['process'], catalogId: string | null): RuleContext => ({
    process,
    grade: l.grade,
    family: l.family,
    catalog_material_id: catalogId,
    thickness_mm: l.thickness_mm,
    qty,
  });
  const comps: Component[] = [];
  if (qty === null) comps.push(missing('quantity_missing'));

  if (l.process === 'sheet_metal' || l.process === 'cnc') {
    const process = l.process;
    // The catalogue row is known only after matching; rules may name it, so match first with a provisional context.
    const provisional = matchCatalog(catalog, { grade: l.grade, thickness_mm: l.thickness_mm, process });
    const get = lookupFor(rules, ctxFor(process, provisional?.id ?? null));
    const finishGet = lookupFor(rules, ctxFor('finishing', provisional?.id ?? null));
    const routed: Lookup = (key) => (key.startsWith('finish_') ? finishGet(key) : get(key));
    comps.push(...(process === 'sheet_metal' ? priceSheetMetal(l, out, routed, catalog) : priceCnc(l, out, routed, catalog)));
    const margin = need(get, ['margin_pct']);
    comps.push(margin.comp);
    out.margin_pct = margin.values ? margin.values[0] : null;

    const parts = [out.material_unit, out.process === 'cnc' ? out.machining_unit : out.cut_unit, out.process === 'cnc' ? 0 : out.bend_unit, out.finish_unit];
    if (qty !== null && out.setup_total !== null && parts.every((p) => p !== null && Number.isFinite(p))) {
      out.unit_cost = (parts as number[]).reduce((s, p) => s + p, 0) + out.setup_total / qty;
      if (out.margin_pct !== null) out.suggested_unit_price = round2(out.unit_cost * (1 + out.margin_pct));
    }
  } else {
    comps.push(missing('process_not_priced'));
  }

  out.rule_ids = [...new Set(comps.flatMap((c) => c.rule_ids))].sort();
  out.manual_reasons = [...new Set(comps.flatMap((c) => c.missing))];
  out.manual = out.manual_reasons.length > 0 || out.suggested_unit_price === null;
  if (!out.manual && qty !== null) {
    out.unit_price = out.suggested_unit_price;
    out.line_total = round2((out.unit_price as number) * qty);
  }
  if (out.manual && out.manual_reasons.length === 0) out.manual_reasons.push('price_not_computable');
  return out;
}

type Overrides = ReadonlyArray<{ line_no: number; unit_price: number; note?: string }>;

/** A priced line with the override applied (or without one: back to the calculator's price or manual). */
function withOverride(line: PricingLineV1, o: { unit_price: number; note?: string } | undefined): PricingLineV1 {
  const out: PricingLineV1 = { ...line, override: null };
  if (o && Number.isFinite(o.unit_price) && o.unit_price >= 0 && out.qty > 0) {
    out.override = o.note ? { unit_price: o.unit_price, note: o.note } : { unit_price: o.unit_price };
    out.unit_price = round2(o.unit_price);
    out.line_total = round2(out.unit_price * out.qty);
    out.manual = false;
    return out;
  }
  const computed = out.manual_reasons.length === 0 && out.suggested_unit_price !== null && out.qty > 0;
  out.unit_price = computed ? out.suggested_unit_price : null;
  out.line_total = computed ? round2((out.suggested_unit_price as number) * out.qty) : null;
  out.manual = !computed;
  return out;
}

/** Totals of priced lines on a rule basis (see the header). */
function totals(
  lines: PricingLineV1[],
  t: { basis: PricingV1['basis']; overrides: Overrides; shipping_override?: number | null; country: string | null; rules_version: string; rule_warnings: string[] },
): PricingV1 {
  const manual_lines = lines.filter((l) => l.unit_price === null).map((l) => l.line_no);
  const subtotal = round2(lines.reduce((s, l) => s + (l.line_total ?? 0), 0));
  const allPriced = manual_lines.length === 0 && lines.length > 0;
  const min_order_surcharge = allPriced && t.basis.min_order_value !== null ? round2(Math.max(t.basis.min_order_value - subtotal, 0)) : null;
  let shipping: number | null = null;
  let shipping_source: PricingV1['shipping_source'] = null;
  if (t.shipping_override !== undefined && t.shipping_override !== null && Number.isFinite(t.shipping_override) && t.shipping_override >= 0) {
    shipping = round2(t.shipping_override);
    shipping_source = 'override';
  } else if (t.basis.shipping_flat !== null) {
    shipping = round2(t.basis.shipping_flat);
    shipping_source = 'rule';
  }
  const complete = allPriced && shipping !== null;
  return {
    v: 1,
    currency: 'EUR',
    rules_version: t.rules_version,
    lines,
    manual_lines,
    subtotal,
    min_order_surcharge,
    shipping,
    shipping_source,
    vat: { mode: isGreece(t.country) ? 'to_be_confirmed' : 'intra_community_notice', country: t.country ?? null },
    total_net: complete ? round2(subtotal + (min_order_surcharge ?? 0) + (shipping as number)) : null,
    complete,
    overrides: t.overrides.map((o) => (o.note ? { line_no: o.line_no, unit_price: o.unit_price, note: o.note } : { line_no: o.line_no, unit_price: o.unit_price })),
    rule_warnings: t.rule_warnings,
    basis: { ...t.basis },
  };
}

/** Prices every line, applies overrides and builds the quote totals. */
export function calculateQuote(input: CalcInput): PricingV1 {
  const overrides = new Map((input.overrides ?? []).map((o) => [o.line_no, o]));
  const lines = input.lines.map((l) => withOverride(priceLine(l, input.rules, input.catalog), overrides.get(l.line_no)));
  const global = (key: RuleKey, process: RuleContext['process']): number | null => {
    const rule = findRule(input.rules, key, { process, grade: null, family: null, catalog_material_id: null, thickness_mm: null, qty: null });
    return rule ? ruleValue(rule) : null;
  };
  return totals(lines, {
    basis: { min_order_value: global('min_order_value', 'global'), shipping_flat: global('shipping_flat', 'shipping') },
    overrides: input.overrides ?? [],
    shipping_override: input.shipping_override,
    country: input.country,
    rules_version: input.rules_version,
    rule_warnings: ruleWarnings(input.rules),
  });
}

/**
 * Applies approved edits to a draft: line overrides (an override replaces the line's price; lines without one keep
 * the calculator's price or stay manual) and an approved shipping amount, on the draft's own rule basis. Pure.
 */
export function reprice(draft: PricingV1, edits: { overrides?: Overrides; shipping?: number | null }): PricingV1 {
  const merged = new Map(draft.overrides.map((o) => [o.line_no, o]));
  for (const o of edits.overrides ?? []) merged.set(o.line_no, o);
  const overrides = [...merged.values()].sort((a, b) => a.line_no - b.line_no);
  const byLine = new Map(overrides.map((o) => [o.line_no, o]));
  const lines = draft.lines.map((l) => withOverride(l, byLine.get(l.line_no)));
  const shipping = edits.shipping !== undefined && edits.shipping !== null ? edits.shipping : draft.shipping_source === 'override' ? draft.shipping : null;
  const out = totals(lines, { basis: draft.basis, overrides, shipping_override: shipping, country: draft.vat.country, rules_version: draft.rules_version, rule_warnings: draft.rule_warnings });
  if (draft.similar) out.similar = draft.similar;
  if (draft.notes !== undefined) out.notes = draft.notes;
  return out;
}
