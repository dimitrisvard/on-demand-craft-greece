// Material recognition for pricing: canonical grades with their common aliases (EN numbers, AISI, DIN short names,
// trade names), the material family of a grade, family densities, catalogue matching and the EUR-per-kg derivation.
//
// Rules
//   - A grade is recognised by normalised alias (upper case, spaces, hyphens, dots and slashes removed) anywhere in
//     the material text; the longest alias wins, so '304L' is not read as '304'.
//   - Family without a grade: keyword match (several languages); density comes from the family (physical constants,
//     kg/m3), never from a business table.
//   - Catalogue match for sheet metal: form_factor 'sheet', same canonical grade, dimensions.thickness_mm within
//     +/- 0.05 mm, available; for CNC: same grade, any form. Ties: a row with price_per_kg first, then by id.
//   - EUR per kg: price_per_kg, else price_per_unit when stock_unit is 'kg', else price_per_unit / weight_per_unit;
//     anything else (or a currency other than EUR) is unknown and makes the material component manual.

import type { CatalogMaterialRow, EurPerKgSource } from './types';

export type MaterialFamily = 'steel' | 'stainless' | 'aluminium' | 'copper' | 'brass' | 'titanium';

interface GradeDef {
  grade: string;
  family: MaterialFamily;
  aliases: string[];
}

const GRADES: readonly GradeDef[] = [
  { grade: 'DC01', family: 'steel', aliases: ['DC01', '1.0330', 'ST12', 'CR4'] },
  { grade: 'DC04', family: 'steel', aliases: ['DC04', '1.0338', 'ST14'] },
  { grade: 'S235JR', family: 'steel', aliases: ['S235JR', 'S235', '1.0038', '1.0037', 'ST37', 'ST37-2', 'RST37-2'] },
  { grade: 'S355J2', family: 'steel', aliases: ['S355J2', 'S355', '1.0570', '1.0577', 'ST52', 'ST52-3'] },
  { grade: 'DX51D', family: 'steel', aliases: ['DX51D', 'DX51D+Z', 'GALVANISED', 'GALVANIZED', 'VERZINKT', 'SENDZIMIR'] },
  { grade: 'C45', family: 'steel', aliases: ['C45', 'C45E', 'CK45', '1.0503', '1.1191'] },
  { grade: 'AISI 304', family: 'stainless', aliases: ['AISI 304', '304', '1.4301', 'V2A', 'X5CRNI18-10', 'X5CRNI18.10', 'SS304', 'INOX 304'] },
  { grade: 'AISI 304L', family: 'stainless', aliases: ['AISI 304L', '304L', '1.4307', 'X2CRNI18-9'] },
  { grade: 'AISI 316', family: 'stainless', aliases: ['AISI 316', '316', '1.4401', 'V4A', 'X5CRNIMO17-12-2'] },
  { grade: 'AISI 316L', family: 'stainless', aliases: ['AISI 316L', '316L', '1.4404', 'X2CRNIMO17-12-2'] },
  { grade: 'AISI 316Ti', family: 'stainless', aliases: ['AISI 316TI', '316TI', '1.4571'] },
  { grade: 'AISI 430', family: 'stainless', aliases: ['AISI 430', '1.4016', 'X6CR17'] },
  { grade: 'EN AW-1050', family: 'aluminium', aliases: ['EN AW-1050', 'AW-1050', 'AL99.5', '1050A'] },
  { grade: 'EN AW-5083', family: 'aluminium', aliases: ['EN AW-5083', 'AW-5083', '5083', 'ALMG4.5MN', 'AL-MG4.5MN', '3.3547'] },
  { grade: 'EN AW-5754', family: 'aluminium', aliases: ['EN AW-5754', 'AW-5754', '5754', 'ALMG3', 'AL-MG3', '3.3535'] },
  { grade: 'EN AW-6061', family: 'aluminium', aliases: ['EN AW-6061', 'AW-6061', '6061', 'ALMG1SICU', 'AL-MG1SICU', '3.3211'] },
  { grade: 'EN AW-6082', family: 'aluminium', aliases: ['EN AW-6082', 'AW-6082', '6082', 'ALSI1MGMN', 'AL-SI1MG', '3.2315'] },
  { grade: 'EN AW-7075', family: 'aluminium', aliases: ['EN AW-7075', 'AW-7075', '7075', 'ALZN6MGCU', 'AL-ZN6MGCU', '3.4365'] },
  { grade: 'Cu-ETP', family: 'copper', aliases: ['CU-ETP', 'CW004A', 'E-CU', 'E-CU58', 'E-CU57', '2.0060', '2.0065'] },
  { grade: 'CuZn37', family: 'brass', aliases: ['CUZN37', 'CW508L', 'MS63', '2.0321'] },
  { grade: 'CuZn39Pb3', family: 'brass', aliases: ['CUZN39PB3', 'CW614N', 'MS58', '2.0401'] },
  { grade: 'Ti Grade 2', family: 'titanium', aliases: ['TITAN GRADE 2', 'TI GRADE 2', '3.7035'] },
  { grade: 'Ti Grade 5', family: 'titanium', aliases: ['TI-6AL-4V', 'TI6AL4V', 'TITAN GRADE 5', 'TI GRADE 5', '3.7164', '3.7165'] },
];

const FAMILY_WORDS: ReadonlyArray<[MaterialFamily, RegExp]> = [
  ['stainless', /stainless|inox|edelstahl|nirosta|ανοξε[ίι]δωτ|nierdzewn/i],
  ['aluminium', /alumin|αλουμ[ίι]νι|\balu\b/i],
  ['brass', /brass|messing|ορε[ίι]χαλκ|mosi[ąa]dz/i],
  ['copper', /copper|kupfer|χαλκ[όο]ς|mied[źz]/i],
  ['titanium', /titan/i],
  ['steel', /steel|stahl|χ[άα]λυβ|σ[ίι]δηρ|stal\b|acier|acciaio|acero/i],
];

/** Density per family in kg/m3. */
export const DENSITY_KG_M3: Readonly<Record<MaterialFamily, number>> = Object.freeze({
  steel: 7850,
  stainless: 7950,
  aluminium: 2700,
  copper: 8960,
  brass: 8500,
  titanium: 4430,
});

/** Normalised form used for alias comparison. */
export function normaliseGradeText(text: string): string {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[\s\-./_()]+/g, '');
}

const ALIASES: ReadonlyArray<{ key: string; def: GradeDef }> = GRADES.flatMap((def) => def.aliases.map((a) => ({ key: normaliseGradeText(a), def }))).sort((a, b) => b.key.length - a.key.length);

/** Canonical grade and family recognised in a material text (grade null when only a family is recognised). */
export function recogniseMaterial(text: string): { grade: string | null; family: MaterialFamily | null } {
  const raw = String(text ?? '');
  const tokens = raw.toUpperCase().split(/[^A-Z0-9.\-+/]+/).filter(Boolean);
  const normTokens = new Set(tokens.map(normaliseGradeText));
  const whole = normaliseGradeText(raw);
  for (const { key, def } of ALIASES) {
    // Short numeric aliases ('304', '5754') must be a whole token; longer ones may appear inside the text.
    const hit = key.length <= 4 || /^\d+(\.\d+)?$/.test(key) ? normTokens.has(key) : whole.includes(key);
    if (hit) return { grade: def.grade, family: def.family };
  }
  for (const [family, re] of FAMILY_WORDS) if (re.test(raw)) return { grade: null, family };
  return { grade: null, family: null };
}

/** Family of a canonical grade, else null. */
export function familyOfGrade(grade: string | null): MaterialFamily | null {
  if (!grade) return null;
  return GRADES.find((g) => g.grade === grade)?.family ?? recogniseMaterial(grade).family;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** EUR per kg of a catalogue row and where it came from, or null. */
export function eurPerKg(row: CatalogMaterialRow): { value: number; source: EurPerKgSource } | null {
  if (row.currency && row.currency.toUpperCase() !== 'EUR') return null;
  const perKg = num(row.price_per_kg);
  if (perKg !== null && perKg > 0) return { value: perKg, source: 'price_per_kg' };
  const perUnit = num(row.price_per_unit);
  if (perUnit === null || perUnit <= 0) return null;
  if ((row.stock_unit ?? '').toLowerCase() === 'kg') return { value: perUnit, source: 'kg_unit' };
  const weight = num(row.weight_per_unit);
  if (weight !== null && weight > 0) return { value: perUnit / weight, source: 'unit_per_weight' };
  return null;
}

export const THICKNESS_TOLERANCE_MM = 0.05;

/** The catalogue row used for a line's material price (see the rules above), or null. */
export function matchCatalog(rows: readonly CatalogMaterialRow[], o: { grade: string | null; thickness_mm: number | null; process: 'sheet_metal' | 'cnc' | 'other' }): CatalogMaterialRow | null {
  if (!o.grade) return null;
  const candidates = rows.filter((r) => {
    if (r.is_available === false) return false;
    if (recogniseMaterial(r.material_grade).grade !== o.grade) return false;
    if (o.process !== 'sheet_metal') return true;
    if (r.form_factor !== 'sheet' || o.thickness_mm === null) return false;
    const t = num((r.dimensions ?? {}).thickness_mm);
    return t !== null && Math.abs(t - o.thickness_mm) <= THICKNESS_TOLERANCE_MM + 1e-9;
  });
  const rank = (r: CatalogMaterialRow): number => {
    const price = eurPerKg(r);
    return price === null ? 2 : price.source === 'price_per_kg' ? 0 : 1;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0] ?? null;
}
