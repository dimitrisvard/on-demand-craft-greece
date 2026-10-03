// Re-check of database-backed differences (SEO_PARITY.md §2.4).
//
// A failing entry whose differences include a database-backed field (F9,
// F14–F22) while X-Seo-Source is `db` on either side is fetched again after
// --recheck-after seconds (default 3900 = 65 min, longer than the 1 h
// per-isolate and KV caches). If the re-fetched pair has no unexplained
// difference, the entry is `transient`; otherwise it stays `fail`.

import { DB_BACKED_FIELDS } from './constants.mjs';
import { sleep } from './util.mjs';

export function eligibleForRecheck(unexplained, seoSourceDb) {
  return seoSourceDb && unexplained.some((d) => DB_BACKED_FIELDS.has(d.field));
}

/**
 * @param items array of { id, ... } eligible entries
 * @param o { delayS, redo: async (item) => { unexplained: [], diffs: [], volatile: [], newUrls: [] }, log }
 * @returns Map id → { equal: boolean, diffs, volatile, newUrls, error } (volatile rules applied
 *   and new URLs listed on the re-fetched pair: they are what made it equal)
 */
export async function runRecheck(items, o) {
  const out = new Map();
  if (!items.length || !(o.delayS > 0)) return out;
  o.log?.(`re-check: ${items.length} entr${items.length === 1 ? 'y' : 'ies'} with database-backed differences; waiting ${o.delayS} s`);
  await sleep(o.delayS * 1000);
  for (const item of items) {
    const r = await o.redo(item);
    out.set(item.id, { equal: r.unexplained.length === 0, diffs: r.diffs, volatile: r.volatile || [], newUrls: r.newUrls || [], error: r.error || null });
  }
  return out;
}
