// Best-effort deletion of the SEO cache entries that a newly published article makes stale (KV SEO_CACHE, the
// namespace microns-site reads; key format "seo:v1:<kind>:<parts>" of workers/site/src/seo/cache.ts).
//
// Rules
//   - Keys: seo:v1:list:<lang> (recent articles of a language) and seo:v1:translations:<translation_id>.
//   - Never throws: a missing binding or a KV error is counted, not raised (per-isolate copies expire on their own
//     1 h TTL, so staleness never exceeds today's).

export const SEO_KV_PREFIX = 'seo:v1';

export function listKey(lang: string): string {
  return `${SEO_KV_PREFIX}:list:${lang}`;
}

export function translationsKey(translationId: string): string {
  return `${SEO_KV_PREFIX}:translations:${translationId}`;
}

export interface PurgeResult {
  deleted: number;
  failed: number;
  configured: boolean;
}

export async function purgeSeoKeys(kv: KVNamespace | undefined, keys: readonly string[]): Promise<PurgeResult> {
  const unique = [...new Set(keys)];
  if (!kv) return { deleted: 0, failed: 0, configured: false };
  let deleted = 0;
  let failed = 0;
  for (const key of unique) {
    try {
      await kv.delete(key);
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed, configured: true };
}
