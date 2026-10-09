// C5: sitemap-complete.xml byte-equal to the live generator (version 19, test/oracles/generate-sitemap.v19.ts) for a
// 300-article fixture (orphans, non-ASCII slugs and the Finnish service slugs, sv/nb/fi blog segments, odd language
// values), gsc_monitored_urls rows equal to the live sync, and the live query order.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  articleUrl,
  buildSitemapXml,
  countUrlElements,
  encodeSitemapUrl,
  escapeXml,
  instantKey,
  monitoredUrlRows,
  SITEMAP_LANGUAGES,
  SLUGS,
  sortLikeLive,
  STATIC_PAGES,
  STATIC_URL_COUNT,
} from '../../../src/content/sitemap-xml';
import * as oracle from '../../oracles/generate-sitemap.v19';
import { fakeSupabase } from '../../oracles/fake-supabase';
import { sitemapFixture } from './fixtures';
import { SITE } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

function published() {
  return sitemapFixture().filter((r) => r.status === 'published');
}

describe('sitemap XML against the live builders', () => {
  it('tables and constants are the live ones', () => {
    expect(SITEMAP_LANGUAGES).toEqual(oracle.LANGUAGES);
    expect(SLUGS).toEqual(oracle.SLUGS);
    expect(STATIC_PAGES.map((p) => [p.key, p.priority, p.changefreq, p.path(SLUGS.de)])).toEqual(
      oracle.STATIC_PAGES.map((p: { key: string; priority: string; changefreq: string; path: (s: Record<string, string>) => string }) => [p.key, p.priority, p.changefreq, p.path(SLUGS.de)]),
    );
    expect(STATIC_URL_COUNT).toBe(252);
  });

  it('300-article fixture: byte-equal XML (rows in live order, the same day)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T09:00:04Z'));
    const rows = sortLikeLive(published());
    expect(rows.length).toBe(300);
    const expected: string = await oracle.generateSitemap(rows as never);
    const port = buildSitemapXml(rows, { siteUrl: SITE, today: '2026-10-08' });
    expect(port.xml).toBe(expected);
    expect(port.urls).toBe(countUrlElements(expected));
    expect(port.articles).toBe(300);
    // fixture coverage: orphans, groups, non-ASCII, the three special blog segments, an unknown language dropped
    expect(port.orphans).toBeGreaterThan(5);
    expect(port.urls).toBe(252 + 299);
    expect(port.xml).toContain('/fi/palvelut/cnc-ty%C3%B6st%C3%B6');
    expect(port.xml).toContain('/sv/blogg/');
    expect(port.xml).toContain('/nb/blogg/');
    expect(port.xml).toContain('/fi/blogi/ty%C3%B6st%C3%B6-opas-');
    expect(port.xml).toContain('bl%C3%A4tter-%26-r%C3%A4nder');
    expect(port.xml).not.toContain('hreflang="xx"');
  });

  it('a different row order changes the bytes the same way in both (order is input, not chosen)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T09:00:00Z'));
    const rows = sortLikeLive(published()).reverse();
    expect(buildSitemapXml(rows, { siteUrl: SITE, today: '2026-10-08' }).xml).toBe(await oracle.generateSitemap(rows as never));
  });

  it('empty article list: static pages only, byte-equal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const port = buildSitemapXml([], { siteUrl: SITE, today: '2026-01-01' });
    expect(port.xml).toBe(await oracle.generateSitemap([]));
    expect(port.urls).toBe(252);
  });

  it('encoders equal the live ones', () => {
    for (const s of ['a&b<c>"d\'e', 'plain', '']) expect(escapeXml(s)).toBe(oracle.escapeXml(s));
    for (const u of [`${SITE}/fi/palvelut/cnc-työstö`, `${SITE}/de/blog/a%20b`, `${SITE}/x/%E0%A4%A`, 'not a url ä']) {
      expect(encodeSitemapUrl(u)).toBe(oracle.encodeSitemapUrl(u));
    }
    expect(articleUrl(SITE, ' SV ', 'x')).toBe(`${SITE}/sv/blogg/x`);
  });
});

describe('gsc_monitored_urls rows', () => {
  it('equal the rows the live sync upserts (chunks of 500 there; same rows and order)', async () => {
    const rows = sortLikeLive(published());
    const client = fakeSupabase({});
    oracle.setOracleSupabase(client);
    const result = await oracle.syncArticlesToMonitoredUrls(rows as never);
    const live = client.upserts.flatMap((u) => u.rows);
    expect(monitoredUrlRows(rows, SITE)).toEqual(live);
    expect(result.skipped).toBe(1);
    expect(client.upserts[0].options).toEqual({ onConflict: 'url', ignoreDuplicates: false });
  });
});

describe('live query order (language ascending, updated_at descending)', () => {
  it('orders by language, then by the instant including microseconds; NULL updated_at first', () => {
    const rows = [
      { slug: 'a', language: 'de', updated_at: '2026-09-01T00:00:00.1+00:00' },
      { slug: 'b', language: 'de', updated_at: '2026-09-01T00:00:00.12+00:00' },
      { slug: 'c', language: 'cs', updated_at: '2026-09-01T00:00:00+00:00' },
      { slug: 'd', language: 'de', updated_at: '2026-09-01T00:00:00.100001+00:00' },
      { slug: 'e', language: 'de', updated_at: null as unknown as string },
      { slug: 'f', language: 'de', updated_at: '2026-08-31T23:59:59.999999+00:00' },
    ];
    expect(sortLikeLive(rows).map((r) => r.slug)).toEqual(['c', 'e', 'b', 'd', 'a', 'f']);
    expect(instantKey('2026-09-01T00:00:00.000001+00:00')! - instantKey('2026-09-01T00:00:00+00:00')!).toBe(1);
  });
});
