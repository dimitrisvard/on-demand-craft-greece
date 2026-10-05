// Production partners of the post-order hand-off (public.production_partners, read only, service role).
//
// Rules
//   - Active partners are those whose `active` is not false.
//   - Suggestion order: the partner already set on the order; else the active partners whose specializations name
//     the order's processes (sheet metal: sheet, laser, bend, punch, metal; CNC: cnc, mill, turn, machin), first by
//     company name; else the only active partner when there is exactly one; else none.
//   - The partner's language for the traveller notes follows its country (ISO code or English name); English when
//     unknown.
//   - A partner's e-mail address is read only by the step that sends the hand-off mail; it is never put on a card,
//     in a step result or in a log line.

import type { Db } from '../postgrest';

export interface PartnerRow {
  id: string;
  company_name: string;
  country: string | null;
  specializations: string[] | null;
  active: boolean | null;
}

const PARTNER_COLUMNS = 'id,company_name,country,specializations,active';

export async function activePartners(db: Db): Promise<PartnerRow[]> {
  const rows = await db.select<PartnerRow & Record<string, unknown>>('production_partners', {
    columns: PARTNER_COLUMNS,
    order: [{ column: 'company_name', ascending: true }],
    limit: 200,
  });
  return rows.filter((p) => p.active !== false);
}

export async function getPartner(db: Db, id: string): Promise<PartnerRow | null> {
  const rows = await db.select<PartnerRow & Record<string, unknown>>('production_partners', { columns: PARTNER_COLUMNS, filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] ?? null;
}

/** The partner's e-mail address (the hand-off send step only). */
export async function partnerAddress(db: Db, id: string): Promise<string | null> {
  const rows = await db.select<{ email: string | null }>('production_partners', { columns: 'email', filters: [['id', 'eq', id]], limit: 1 });
  const email = rows[0]?.email?.trim() ?? '';
  return /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(email) ? email : null;
}

const PROCESS_WORDS: Readonly<Record<'sheet_metal' | 'cnc', RegExp>> = Object.freeze({
  sheet_metal: /sheet|laser|bend|punch|metal/,
  cnc: /cnc|mill|turn|machin/,
});

export type PartnerMatch = 'order' | 'specialisation' | 'only_partner';

export function suggestPartner(partners: readonly PartnerRow[], o: { order_partner_id: string | null; processes: ReadonlyArray<'sheet_metal' | 'cnc' | 'mixed' | 'other'> }): { partner: PartnerRow; matched_by: PartnerMatch } | null {
  if (o.order_partner_id) {
    const set = partners.find((p) => p.id === o.order_partner_id);
    if (set) return { partner: set, matched_by: 'order' };
  }
  const wanted = new Set<'sheet_metal' | 'cnc'>();
  for (const p of o.processes) {
    if (p === 'sheet_metal' || p === 'mixed') wanted.add('sheet_metal');
    if (p === 'cnc' || p === 'mixed') wanted.add('cnc');
  }
  const fits = partners.filter((p) => {
    const words = (p.specializations ?? []).map((s) => String(s).toLowerCase());
    return [...wanted].some((proc) => words.some((w) => PROCESS_WORDS[proc].test(w)));
  });
  const sorted = [...fits].sort((a, b) => a.company_name.localeCompare(b.company_name) || a.id.localeCompare(b.id));
  if (sorted.length > 0) return { partner: sorted[0], matched_by: 'specialisation' };
  if (partners.length === 1) return { partner: partners[0], matched_by: 'only_partner' };
  return null;
}

const LANGUAGE_BY_COUNTRY: ReadonlyArray<[RegExp, string]> = [
  [/^(gr|grc|greece|el|hellas|cy|cyp|cyprus|ελλάδα|ελλαδα|κύπρος|κυπρος)$/i, 'el'],
  [/^(de|deu|germany|deutschland|at|aut|austria|österreich|ch|che|switzerland|schweiz)$/i, 'de'],
  [/^(pl|pol|poland|polska)$/i, 'pl'],
  [/^(it|ita|italy|italia)$/i, 'it'],
  [/^(fr|fra|france)$/i, 'fr'],
  [/^(es|esp|spain|españa|espana)$/i, 'es'],
  [/^(bg|bgr|bulgaria)$/i, 'bg'],
  [/^(ro|rou|romania)$/i, 'ro'],
  [/^(nl|nld|netherlands)$/i, 'nl'],
  [/^(cz|cze|czechia|czech republic)$/i, 'cs'],
];

/** ISO 639-1 language of a partner's country ('en' when unknown). */
export function partnerLanguage(country: string | null | undefined): string {
  const c = String(country ?? '').trim();
  if (!c) return 'en';
  for (const [re, lang] of LANGUAGE_BY_COUNTRY) if (re.test(c)) return lang;
  return 'en';
}
