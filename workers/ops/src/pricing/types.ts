// Types of the deterministic quote calculator: owner-entered pricing rules, catalogue materials, the line inputs
// built from the RFQ and its CAD results, and PricingV1 (stored in quote_workflows.pricing).
//
// Rules
//   - Every rate, margin, minimum and shipping amount comes from public.pricing_rules rows the owner enters; this
//     module holds no business number. A missing rule makes the affected cost component (and so the line) "manual".
//   - Amounts are EUR, rounded to cents only at the unit price and the line total; intermediates keep full precision.

import type { CadResultV1 } from '../cad/types';

/** public.pricing_rules (agent-layer migration). */
export interface PricingRuleRow {
  id: string;
  tenant_id?: string;
  process: 'cnc' | 'sheet_metal' | 'finishing' | 'shipping' | 'global';
  rule_key: string;
  /** {catalog_material_id?, category?, grade?, thickness_mm_min?, thickness_mm_max?} */
  material_match: Record<string, unknown> | null;
  qty_min: number | null;
  qty_max: number | null;
  /** numeric(12,4); PostgREST may answer it as a string. */
  value: number | string;
  unit: string;
  currency: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}

/** The catalog_materials columns the calculator reads (src/sql/20260406_create_material_catalog.sql, price_per_kg). */
export interface CatalogMaterialRow {
  id: string;
  name?: string;
  material_grade: string;
  form_factor: string;
  dimensions: Record<string, unknown> | null;
  weight_per_unit: number | string | null;
  stock_unit: string | null;
  price_per_unit: number | string | null;
  price_per_kg: number | string | null;
  currency: string | null;
  is_available: boolean | null;
}

export type LineProcess = 'sheet_metal' | 'cnc' | 'other';
export type QuoteProcess = 'sheet_metal' | 'cnc' | 'mixed' | 'other';

/** One quote line before pricing. */
export interface LineInput {
  line_no: number;
  part_id: string | null;
  product_name: string;
  description: string;
  qty: number;
  process: LineProcess;
  /** Material as written in the RFQ (web form label or e-mail text). */
  material_text: string;
  /** Canonical grade (pricing/materials.ts) or null when not recognised. */
  grade: string | null;
  family: string | null;
  /** Thickness from the CAD result, else from the RFQ. */
  thickness_mm: number | null;
  /** Finish code ([a-z0-9_]) or null for none. */
  finish_code: string | null;
  tolerance: string | null;
  geometry: CadResultV1 | null;
  cad_job_id: string | null;
  /** Why the line has no geometry ('geometry_missing', 'inline_too_large', 'cad_failed', 'cad_pending'). */
  geometry_problem: string | null;
  /** File names of the part (for the PDF). */
  files: string[];
}

export type EurPerKgSource = 'price_per_kg' | 'kg_unit' | 'unit_per_weight';

export interface PricingLineV1 {
  line_no: number;
  part_id: string | null;
  product_name: string;
  description: string;
  process: LineProcess;
  qty: number;
  material: { text: string; grade: string | null; family: string | null; thickness_mm: number | null };
  catalog_material_id: string | null;
  eur_per_kg: number | null;
  eur_per_kg_source: EurPerKgSource | null;
  density_kg_m3: number | null;
  cad_job_id: string | null;
  /** Intermediates of the formula (null = not computable). */
  blank_mm2: number | null;
  mass_kg: number | null;
  material_unit: number | null;
  cut_unit: number | null;
  bend_unit: number | null;
  finish_unit: number | null;
  machining_unit: number | null;
  setup_total: number | null;
  margin_pct: number | null;
  unit_cost: number | null;
  /** The calculator's price, also on manual lines when it could be computed (shown as a suggestion). */
  suggested_unit_price: number | null;
  /** Price on the quote: the calculator's or an approved override; null while the line is manual. */
  unit_price: number | null;
  line_total: number | null;
  manual: boolean;
  manual_reasons: string[];
  estimate_quality: 'standard' | 'rough';
  rule_ids: string[];
  override: { unit_price: number; note?: string } | null;
  files: string[];
}

export interface PricingV1 {
  v: 1;
  currency: 'EUR';
  rules_version: string;
  lines: PricingLineV1[];
  /** line_no of the lines without a price. */
  manual_lines: number[];
  /** Sum of the priced line totals. */
  subtotal: number;
  /** Minimum order surcharge (null until every line is priced or when no minimum rule exists). */
  min_order_surcharge: number | null;
  shipping: number | null;
  shipping_source: 'rule' | 'override' | null;
  vat: { mode: 'intra_community_notice' | 'to_be_confirmed'; country: string | null };
  /** subtotal + surcharge + shipping when complete, else null. */
  total_net: number | null;
  complete: boolean;
  overrides: Array<{ line_no: number; unit_price: number; note?: string }>;
  /** Active rules that can never apply (unit or currency), e.g. "bend_per_hit: unit 'EUR/m' is not ...". */
  rule_warnings: string[];
  /** Quote-level rule values the draft was priced with (approved edits are applied on the same basis). */
  basis: { min_order_value: number | null; shipping_flat: number | null };
  /** Similar past quote lines per line (Vectorize quotes-v1), shown to staff only. */
  similar?: SimilarLine[];
  /** Model review of the draft (quote.price_notes@v1): staff only, never on a card or in the customer mail. */
  notes?: PriceNotes | null;
}

export interface SimilarHit {
  quote_workflow_id: string;
  line_no: number;
  score: number;
  unit_price_eur: number;
  outcome: string;
}

export interface SimilarLine {
  line_no: number;
  hits: SimilarHit[];
}

/** Output of quote.price_notes@v1. */
export interface PriceNotes {
  assumptions: string[];
  risks: string[];
  suggestions: Array<{ line_no: number; kind: 'price' | 'lead_time' | 'process'; direction: 'up' | 'down' | 'none'; reason: string }>;
  injection_suspected: boolean;
}
