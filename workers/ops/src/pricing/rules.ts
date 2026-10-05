// Rule selection for the quote calculator: which owner-entered public.pricing_rules row applies to a cost component
// of a line, and the version stamp of the rule set a quote was priced with.
//
// Rules
//   - A rule applies when it is active, valid on the pricing date (valid_from <= date, valid_to empty or >= date), has
//     the rule key, belongs to the component's process (or to 'global'), its material_match fields all match the
//     line (catalog_material_id, category = material family, grade = canonical grade, thickness_mm_min/_max) and the
//     quantity lies in [qty_min, qty_max] (an empty bound is open).
//   - Among applicable rules the most specific wins: the component's own process before 'global', more matched
//     material fields before fewer, a quantity band before none; then the highest version, then the id.
//   - Every key has the units it may be entered in (compared after normalising case, spaces, '€' and 'per'); money
//     rules must be in EUR. A rule with another unit or currency is never applied; it is listed in the quote's
//     rule warnings, so a typo shows up instead of silently changing a price.
//   - Percentages: a margin entered in 'pct' (or '%') is divided by 100; one entered as 'fraction' is used as it is.
//   - rules_version = first 12 hex of the SHA-256 of the canonical JSON of the active rules (sorted by id) + '.v' +
//     the highest version among them ('none' without rules).

import { canonicalJson, sha256hex } from '../agents/ids';
import { recogniseMaterial } from './materials';
import type { PricingRuleRow } from './types';

/** Rule keys read by the calculator (finish keys are finish_<code>_per_m2). */
export type RuleKey =
  | 'sheet_scrap_factor'
  | 'laser_cut_speed_mm_min'
  | 'laser_pierce_s'
  | 'laser_rate_per_h'
  | 'bend_per_hit'
  | 'bend_setup'
  | 'setup_fixed'
  | 'cnc_rate_per_h'
  | 'cnc_mrr_cm3_min'
  | 'cnc_setup'
  | 'margin_pct'
  | 'min_order_value'
  | 'shipping_flat'
  | `finish_${string}_per_m2`;

/** Units accepted per key (normalised by normaliseUnit). */
const UNITS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  sheet_scrap_factor: ['factor', 'x', 'ratio'],
  laser_cut_speed_mm_min: ['mm/min'],
  laser_pierce_s: ['s', 'sec', 'second', 'seconds'],
  laser_rate_per_h: ['eur/h', 'eur/hour'],
  bend_per_hit: ['eur/hit', 'eur/bend', 'eur'],
  bend_setup: ['eur'],
  setup_fixed: ['eur'],
  cnc_rate_per_h: ['eur/h', 'eur/hour'],
  cnc_mrr_cm3_min: ['cm3/min'],
  cnc_setup: ['eur'],
  margin_pct: ['pct', '%', 'percent', 'fraction'],
  min_order_value: ['eur'],
  shipping_flat: ['eur'],
  finish: ['eur/m2', 'eur/sqm'],
});

/** Keys whose value is an amount of money (the rule's currency must be EUR). */
const MONEY_KEYS = new Set(['laser_rate_per_h', 'bend_per_hit', 'bend_setup', 'setup_fixed', 'cnc_rate_per_h', 'cnc_setup', 'min_order_value', 'shipping_flat']);

/** Older names an owner may have used for a key (the migration's table comment names kerf_factor). */
const KEY_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  sheet_scrap_factor: ['kerf_factor', 'kerf_scrap_factor'],
});

/** Process of the rules for a component; 'global' rules apply to every process. */
export type RuleProcess = PricingRuleRow['process'];

export interface RuleContext {
  process: RuleProcess;
  /** Canonical grade of the line (pricing/materials.ts). */
  grade: string | null;
  family: string | null;
  catalog_material_id: string | null;
  thickness_mm: number | null;
  qty: number | null;
}

export function normaliseUnit(unit: string): string {
  return String(unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/€/g, 'eur')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\s+per\s+/g, '/')
    .replace(/\s+/g, '');
}

function unitKey(key: string): string {
  return /^finish_[a-z0-9_]+_per_m2$/.test(key) ? 'finish' : key;
}

function isMoneyKey(key: string): boolean {
  return MONEY_KEYS.has(key) || unitKey(key) === 'finish';
}

/** Why a rule can never be applied (unit or currency), or null. */
export function ruleProblem(rule: PricingRuleRow): string | null {
  const canonical = Object.entries(KEY_ALIASES).find(([, aliases]) => aliases.includes(rule.rule_key))?.[0] ?? rule.rule_key;
  const accepted = UNITS[unitKey(canonical)];
  if (!accepted) return null;
  if (!accepted.includes(normaliseUnit(rule.unit))) return `${rule.rule_key}: unit '${rule.unit}' is not one of ${accepted.join(', ')}`;
  if (isMoneyKey(canonical) && String(rule.currency ?? 'EUR').toUpperCase() !== 'EUR') return `${rule.rule_key}: currency ${rule.currency} is not EUR`;
  const value = numberOf(rule.value);
  if (value === null || value < 0) return `${rule.rule_key}: value is not a non-negative number`;
  return null;
}

export function numberOf(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD of a date (UTC). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Rules active and valid on the day. */
export function activeRules(rules: readonly PricingRuleRow[], at: Date): PricingRuleRow[] {
  const day = isoDay(at);
  return rules.filter((r) => r.is_active !== false && String(r.valid_from ?? '').slice(0, 10) <= day && (r.valid_to === null || r.valid_to === undefined || String(r.valid_to).slice(0, 10) >= day));
}

/** Number of material_match fields that match the line, or -1 when one of them does not. */
function materialScore(match: Record<string, unknown> | null, c: RuleContext): number {
  if (!match || typeof match !== 'object') return 0;
  let score = 0;
  for (const [field, expected] of Object.entries(match)) {
    if (expected === null || expected === undefined || expected === '') continue;
    switch (field) {
      case 'catalog_material_id':
        if (c.catalog_material_id === null || String(expected) !== c.catalog_material_id) return -1;
        break;
      case 'category':
        if (c.family === null || String(expected).toLowerCase() !== c.family.toLowerCase()) return -1;
        break;
      case 'grade': {
        const grade = recogniseMaterial(String(expected)).grade ?? String(expected);
        if (c.grade === null || grade !== c.grade) return -1;
        break;
      }
      case 'thickness_mm_min': {
        const min = numberOf(expected);
        if (min === null || c.thickness_mm === null || c.thickness_mm < min - 1e-9) return -1;
        break;
      }
      case 'thickness_mm_max': {
        const max = numberOf(expected);
        if (max === null || c.thickness_mm === null || c.thickness_mm > max + 1e-9) return -1;
        break;
      }
      default:
        // An unknown match field never matches: the owner meant to narrow the rule.
        return -1;
    }
    score++;
  }
  return score;
}

function qtyMatches(r: PricingRuleRow, qty: number | null): { ok: boolean; banded: boolean } {
  const min = numberOf(r.qty_min);
  const max = numberOf(r.qty_max);
  if (min === null && max === null) return { ok: true, banded: false };
  if (qty === null) return { ok: false, banded: true };
  return { ok: (min === null || qty >= min) && (max === null || qty <= max), banded: true };
}

/** The rule for a key and line (see the rules above), or null. `rules` are the active rules. */
export function findRule(rules: readonly PricingRuleRow[], key: RuleKey, c: RuleContext): PricingRuleRow | null {
  const names = [key, ...(KEY_ALIASES[key] ?? [])];
  let best: { rule: PricingRuleRow; rank: number[] } | null = null;
  for (const rule of rules) {
    if (!names.includes(rule.rule_key)) continue;
    if (rule.process !== c.process && rule.process !== 'global') continue;
    if (ruleProblem(rule) !== null) continue;
    const material = materialScore(rule.material_match, c);
    if (material < 0) continue;
    const qty = qtyMatches(rule, c.qty);
    if (!qty.ok) continue;
    const rank = [rule.process === c.process ? 1 : 0, material, qty.banded ? 1 : 0, numberOf(rule.version) ?? 1, rule.rule_key === key ? 1 : 0];
    if (!best || compareRank(rank, best.rank) > 0 || (compareRank(rank, best.rank) === 0 && rule.id < best.rule.id)) best = { rule, rank };
  }
  return best?.rule ?? null;
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Value of a rule as used in the formulas (percent units divided by 100). */
export function ruleValue(rule: PricingRuleRow): number {
  const value = numberOf(rule.value) ?? 0;
  const unit = normaliseUnit(rule.unit);
  return unitKey(rule.rule_key) === 'margin_pct' && unit !== 'fraction' ? value / 100 : value;
}

/** Warnings for active rules that can never apply (unit or currency). */
export function ruleWarnings(rules: readonly PricingRuleRow[]): string[] {
  return rules.map(ruleProblem).filter((p): p is string => p !== null);
}

/** Version stamp of a rule set (see the rules above). */
export async function rulesVersion(rules: readonly PricingRuleRow[]): Promise<string> {
  if (rules.length === 0) return 'none';
  const canonical = [...rules]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({
      id: r.id,
      process: r.process,
      rule_key: r.rule_key,
      material_match: r.material_match ?? null,
      qty_min: numberOf(r.qty_min),
      qty_max: numberOf(r.qty_max),
      value: numberOf(r.value),
      unit: r.unit,
      currency: r.currency,
      version: numberOf(r.version),
      valid_from: String(r.valid_from ?? '').slice(0, 10),
      valid_to: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
    }));
  const maxVersion = Math.max(...rules.map((r) => numberOf(r.version) ?? 1));
  return `${(await sha256hex(canonicalJson(canonical))).slice(0, 12)}.v${maxVersion}`;
}
