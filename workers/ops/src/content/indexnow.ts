// IndexNow submission of a new translation (live translate-article: one POST per translated language with the
// English URL and the new language URL).
//
// Rules
//   - Without INDEXNOW_KEY nothing is sent and the result is 'not_configured' (the translation still succeeds).
//   - POST <sources.base('indexnow')>/indexnow {host, key, keyLocation: <SITE_ORIGIN>/indexnow_key.txt, urlList};
//     host is the host of the first URL.
//   - Never throws: a network error or a non-2xx answer is false. The key is never logged.

import type { SourcePort } from '../ports/p5';
import { blogSegment } from './languages';

export type IndexNowResult = boolean | 'not_configured';

/** The URLs of one new translation: English master and the new language (per-language blog segment). */
export function translationUrls(siteOrigin: string, enSlug: string, lang: string, slug: string | null): string[] {
  const origin = siteOrigin.replace(/\/+$/, '');
  const urls = [`${origin}/en/blog/${enSlug}`];
  if (slug) urls.push(`${origin}/${lang}/${blogSegment(lang)}/${slug}`);
  return urls;
}

export async function submitIndexNow(sources: SourcePort, o: { key: string | undefined; siteOrigin: string; urls: readonly string[] }): Promise<IndexNowResult> {
  if (!o.key) return 'not_configured';
  try {
    const host = new URL(o.urls[0]).hostname;
    const origin = o.siteOrigin.replace(/\/+$/, '');
    const res = await sources.fetch(`${sources.base('indexnow').replace(/\/+$/, '')}/indexnow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, key: o.key, keyLocation: `${origin}/indexnow_key.txt`, urlList: o.urls }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
