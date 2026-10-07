// Shared scrape data rules against the vector file (also run against the site gate rows SC-1 to SC-3 by
// workers/site/test/scrape-rules-crosscheck.test.ts).

import { describe, expect, it } from 'vitest';
import {
  SCRAPE_URLS_MAX,
  countryCodeShapeAllowed,
  directoryTargetAllowed,
  isScrapeUrlList,
  parsedHttpUrl,
  scrapeTargetAllowed,
  scrapeUrlsAllowed,
  scrapeUrlsGateAllows,
} from '../src/auth/scrape-rules';
import vectorFile from './fixtures/scrape-rules.json';

interface Vector {
  value: unknown;
  allowed: boolean;
}

interface ListVector {
  urls?: unknown;
  repeat?: { value: string; count: number };
  strict: boolean;
  gate: boolean;
}

export interface ScrapeRuleVectors {
  site_origin: string;
  scrape_targets: Vector[];
  directory_targets: Vector[];
  scrape_url_lists: ListVector[];
  country_codes: Vector[];
}

const vectors = vectorFile as unknown as ScrapeRuleVectors;

function urlsOf(v: ListVector): unknown {
  return v.repeat ? Array.from({ length: v.repeat.count }, () => v.repeat?.value) : v.urls;
}

describe('scrape-rules vectors', () => {
  it('has vectors of every kind, both outcomes each', () => {
    for (const list of [vectors.scrape_targets, vectors.directory_targets, vectors.country_codes]) {
      expect(list.some((v) => v.allowed)).toBe(true);
      expect(list.some((v) => !v.allowed)).toBe(true);
    }
    expect(vectors.scrape_url_lists.some((v) => v.strict !== v.gate)).toBe(true);
  });

  it.each(vectors.scrape_targets.map((v) => [JSON.stringify(v.value), v] as const))('scrape target %s', (_name, v) => {
    expect(scrapeTargetAllowed(v.value, { siteOrigin: vectors.site_origin })).toBe(v.allowed);
  });

  it.each(vectors.directory_targets.map((v) => [JSON.stringify(v.value), v] as const))('directory target %s', (_name, v) => {
    expect(directoryTargetAllowed(v.value)).toBe(v.allowed);
  });

  it.each(vectors.scrape_url_lists.map((v, i) => [i, v] as const))('url list #%i: strict and gate forms', (_i, v) => {
    const urls = urlsOf(v);
    expect(scrapeUrlsAllowed(urls, { siteOrigin: vectors.site_origin })).toBe(v.strict);
    expect(scrapeUrlsGateAllows(urls, { siteOrigin: vectors.site_origin })).toBe(v.gate);
  });

  it.each(vectors.country_codes.map((v) => [JSON.stringify(v.value), v] as const))('country code %s', (_name, v) => {
    expect(countryCodeShapeAllowed(v.value)).toBe(v.allowed);
  });
});

describe('scrape-rules details', () => {
  it('only http and https parse as targets', () => {
    expect(parsedHttpUrl('https://example.com/a')?.hostname).toBe('example.com');
    expect(parsedHttpUrl('data:text/html,x')).toBeNull();
    expect(parsedHttpUrl('not a url')).toBeNull();
  });

  it('the own zone follows SITE_ORIGIN, and micronshub.eu stays refused whatever it is', () => {
    expect(scrapeTargetAllowed('https://preview.example-zone.test/x', { siteOrigin: 'https://www.example-zone.test' })).toBe(false);
    expect(scrapeTargetAllowed('https://preview.example-zone.test/x', { siteOrigin: 'https://www.micronshub.eu' })).toBe(true);
    expect(scrapeTargetAllowed('https://www.micronshub.eu/', { siteOrigin: 'https://www.example-zone.test' })).toBe(false);
    // An unparsable or missing origin falls back to micronshub.eu.
    expect(scrapeTargetAllowed('https://www.micronshub.eu/', { siteOrigin: 'not a url' })).toBe(false);
    expect(scrapeTargetAllowed('https://www.micronshub.eu/')).toBe(false);
  });

  it('a list has 1 to 25 entries', () => {
    expect(SCRAPE_URLS_MAX).toBe(25);
    expect(isScrapeUrlList([])).toBe(false);
    expect(isScrapeUrlList(['a'])).toBe(true);
    expect(isScrapeUrlList(new Array(25).fill('a'))).toBe(true);
    expect(isScrapeUrlList(new Array(26).fill('a'))).toBe(false);
    expect(isScrapeUrlList({ length: 1 })).toBe(false);
  });
});
