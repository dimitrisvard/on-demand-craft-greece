// Translation backlog: the missing (English article, language) pairs, oldest English article first, at most
// `cap` per language per day (flag value backfill_per_language_per_day, default 5).
//
// Rules
//   - Candidates are the published English articles with a translation_id; a pair is missing when no article of
//     that translation_id exists in the language (any status, as the live existence check).
//   - The group of today's new article is left out (it gets its 13 'daily' messages).
//   - Outcomes of the last BACKFILL_HOLD_DAYS days (content_daily.translate runs closed 'failed'):
//       slug_conflict (the translated slug belongs to another article of that language) -> the pair is not planned
//         until the hold has passed (a new attempt would end the same way);
//       any other failure -> the pair is planned after every pair without such a failure, so pairs that keep
//         failing never take the whole daily quota of a language, and they are still retried when there is room.
//   - Reads are paged; the result is a list of compact messages, never article text.

import type { Db } from '../db/postgrest';
import type { TargetLang, TranslationMessageV1 } from '../queues/messages';
import { TARGET_LANGS } from './languages';
import { selectAll } from './paged';
import { instantKey } from './sitemap-xml';

export const DEFAULT_BACKFILL_PER_LANGUAGE = 5;
/** Days a failed translation outcome counts for planning (from the content-daily date). */
export const BACKFILL_HOLD_DAYS = 7;
/** Run error of a translation whose slug is already used by another article of the language. */
export const SLUG_CONFLICT = 'slug_conflict' as const;

/** Recent outcome of a (translation_id, language) pair: 'conflict' = held, 'failed' = planned last. */
export type PairOutcome = 'conflict' | 'failed';

export function pairKey(translationId: string, language: string): string {
  return `${translationId}:${language}`;
}

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

/** The UTC day `days` before a YYYY-MM-DD day. */
function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Failed content_daily.translate runs started within BACKFILL_HOLD_DAYS before `forDate`, by pair; a slug conflict
 * wins over any other failure of the same pair.
 */
export async function recentPairOutcomes(db: Db, forDate: string): Promise<Map<string, PairOutcome>> {
  const rows = await selectAll<{ id: string; idempotency_key: string | null; error: string | null }>(db, 'agent_runs', {
    columns: 'idempotency_key,error',
    filters: [
      ['agent', 'eq', 'content_daily.translate'],
      ['status', 'eq', 'failed'],
      ['started_at', 'gte', `${daysBefore(forDate, BACKFILL_HOLD_DAYS)}T00:00:00Z`],
    ],
  });
  const out = new Map<string, PairOutcome>();
  for (const r of rows) {
    // content_daily.translate:<translation_id>:<lang>:<for_date>
    const parts = (r.idempotency_key ?? '').split(':');
    if (parts.length !== 4 || parts[0] !== 'content_daily.translate') continue;
    const key = pairKey(parts[1], parts[2]);
    if (r.error === SLUG_CONFLICT) out.set(key, 'conflict');
    else if (!out.has(key)) out.set(key, 'failed');
  }
  return out;
}

/** Pure: the backfill messages for the masters and present languages. */
export function planBackfill(
  masters: readonly EnglishArticleRef[],
  present: ReadonlyMap<string, ReadonlySet<string>>,
  o: {
    cap: number;
    exclude: ReadonlySet<string>;
    for_date: string;
    parent_run_id: string;
    langs?: readonly TargetLang[];
    /** recentPairOutcomes(): held pairs are left out, failed pairs go last. */
    recent?: ReadonlyMap<string, PairOutcome>;
  },
): TranslationMessageV1[] {
  const out: TranslationMessageV1[] = [];
  if (o.cap <= 0) return out;
  for (const language of o.langs ?? TARGET_LANGS) {
    const first: EnglishArticleRef[] = [];
    const last: EnglishArticleRef[] = [];
    for (const m of masters) {
      if (first.length >= o.cap) break;
      if (o.exclude.has(m.translation_id)) continue;
      if (present.get(m.translation_id)?.has(language)) continue;
      const outcome = o.recent?.get(pairKey(m.translation_id, language));
      if (outcome === 'conflict') continue;
      if (outcome === 'failed') last.push(m);
      else first.push(m);
    }
    for (const m of [...first, ...last].slice(0, o.cap)) {
      out.push({ v: 1, translation_id: m.translation_id, en_article_id: m.id, language, origin: 'backfill', for_date: o.for_date, parent_run_id: o.parent_run_id });
    }
  }
  return out;
}

/** The flag's cap when it is a non-negative integer, else the default. */
export function backfillCap(value: Record<string, unknown>): number {
  const cap = value.backfill_per_language_per_day;
  return typeof cap === 'number' && Number.isSafeInteger(cap) && cap >= 0 ? cap : DEFAULT_BACKFILL_PER_LANGUAGE;
}
