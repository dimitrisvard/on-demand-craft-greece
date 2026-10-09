// Run-output figures of content-daily: translation status of today's group and translation lag per language.
//
//   translationStatus()   per target language: 'ok' (a row exists), 'failed' (its content_daily.translate run of
//                         this day closed failed) or 'missing'
//   lagDays()             per target language: newest published English created_at day minus the newest published
//                         created_at day of that language (the parity query's definition); null without rows

import type { Db } from '../db/postgrest';
import type { TargetLang } from '../queues/messages';
import { TARGET_LANGS } from './languages';

export type TranslationState = 'ok' | 'missing' | 'failed';

export function translateRunKey(translationId: string, lang: string, forDate: string): string {
  return `content_daily.translate:${translationId}:${lang}:${forDate}`;
}

export async function translationStatus(db: Db, translationId: string, forDate: string): Promise<Record<TargetLang, TranslationState>> {
  const rows = await db.select<{ language: string }>('articles', { columns: 'language', filters: [['translation_id', 'eq', translationId]] });
  const present = new Set(rows.map((r) => r.language));
  const keys = TARGET_LANGS.map((l) => translateRunKey(translationId, l, forDate));
  const runs = await db.select<{ idempotency_key: string; status: string }>('agent_runs', {
    columns: 'idempotency_key,status',
    filters: [['agent', 'eq', 'content_daily.translate'], ['idempotency_key', 'in', keys]],
  });
  const failed = new Set(runs.filter((r) => r.status === 'failed').map((r) => r.idempotency_key));
  const out = {} as Record<TargetLang, TranslationState>;
  for (const lang of TARGET_LANGS) {
    out[lang] = present.has(lang) ? 'ok' : failed.has(translateRunKey(translationId, lang, forDate)) ? 'failed' : 'missing';
  }
  return out;
}

async function newestDay(db: Db, language: string): Promise<string | null> {
  const rows = await db.select<{ created_at: string }>('articles', {
    columns: 'created_at',
    filters: [['language', 'eq', language], ['status', 'eq', 'published']],
    order: [{ column: 'created_at', ascending: false }],
    limit: 1,
  });
  const t = rows[0] ? Date.parse(rows[0].created_at) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

export async function lagDays(db: Db): Promise<Partial<Record<TargetLang, number | null>>> {
  const en = await newestDay(db, 'en');
  const out: Partial<Record<TargetLang, number | null>> = {};
  for (const lang of TARGET_LANGS) {
    const day = await newestDay(db, lang);
    out[lang] = en && day ? Math.round((Date.parse(`${en}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000) : null;
  }
  return out;
}
