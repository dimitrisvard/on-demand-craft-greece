// Translation backlog: the missing (English article, language) pairs, oldest English article first, at most
// `cap` per language per day (flag value backfill_per_language_per_day, default 5).
//
// Rules
//   - Candidates are the published English articles with a translation_id; a pair is missing when no article of
//     that translation_id exists in the language (any status, as the live existence check).
//   - The group of today's new article is left out (it gets its 13 'daily' messages).
//   - Reads are paged; the result is a list of compact messages, never article text.

import type { Db } from '../db/postgrest';
import type { TargetLang, TranslationMessageV1 } from '../queues/messages';
import { TARGET_LANGS } from './languages';
import { selectAll } from './paged';
import { instantKey } from './sitemap-xml';

export const DEFAULT_BACKFILL_PER_LANGUAGE = 5;

export interface EnglishArticleRef {
  id: string;
  translation_id: string;
  slug: string;
  created_at: string;
}

/** Published English articles with a translation_id, oldest first. */
export async function englishMasters(db: Db): Promise<EnglishArticleRef[]> {
  const rows = await selectAll<{ id: string; translation_id: string | null; slug: string; created_at: string }>(db, 'articles', {
    columns: 'translation_id,slug,created_at',
    filters: [['language', 'eq', 'en'], ['status', 'eq', 'published']],
  });
  return rows
    .filter((r): r is EnglishArticleRef => typeof r.translation_id === 'string' && r.translation_id.length > 0)
    .sort((a, b) => (instantKey(a.created_at) ?? 0) - (instantKey(b.created_at) ?? 0));
}

/** translation_id -> languages present (every non-English row). */
export async function presentLanguages(db: Db): Promise<Map<string, Set<string>>> {
  const rows = await selectAll<{ id: string; translation_id: string | null; language: string }>(db, 'articles', { columns: 'translation_id,language' });
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.translation_id || r.language === 'en') continue;
    let set = map.get(r.translation_id);
    if (!set) {
      set = new Set();
      map.set(r.translation_id, set);
    }
    set.add(r.language);
  }
  return map;
}

/** Pure: the backfill messages for the masters and present languages. */
export function planBackfill(
  masters: readonly EnglishArticleRef[],
  present: ReadonlyMap<string, ReadonlySet<string>>,
  o: { cap: number; exclude: ReadonlySet<string>; for_date: string; parent_run_id: string; langs?: readonly TargetLang[] },
): TranslationMessageV1[] {
  const out: TranslationMessageV1[] = [];
  if (o.cap <= 0) return out;
  for (const language of o.langs ?? TARGET_LANGS) {
    let n = 0;
    for (const m of masters) {
      if (n >= o.cap) break;
      if (o.exclude.has(m.translation_id)) continue;
      if (present.get(m.translation_id)?.has(language)) continue;
      out.push({ v: 1, translation_id: m.translation_id, en_article_id: m.id, language, origin: 'backfill', for_date: o.for_date, parent_run_id: o.parent_run_id });
      n++;
    }
  }
  return out;
}

/** The flag's cap when it is a non-negative integer, else the default. */
export function backfillCap(value: Record<string, unknown>): number {
  const cap = value.backfill_per_language_per_day;
  return typeof cap === 'number' && Number.isSafeInteger(cap) && cap >= 0 ? cap : DEFAULT_BACKFILL_PER_LANGUAGE;
}
