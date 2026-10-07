// The shared scrape data rules (workers/shared/src/auth/scrape-rules.ts, used by microns-ops for in-process calls)
// and the site gate's Phase 2 scrape rows (SC-1 scrape-website, SC-2 scrape-company-profile, SC-3 scan-directory)
// give the same allow/deny answer for every vector of workers/shared/test/fixtures/scrape-rules.json: once through
// the gate's exported validators and once through applyGate with a staff caller.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  directoryTargetAllowed as sharedDirectoryTargetAllowed,
  scrapeTargetAllowed as sharedScrapeTargetAllowed,
  scrapeUrlsGateAllows,
} from '../../shared/src/auth/scrape-rules';
import { applyGate, directoryTargetAllowed, scrapeTargetAllowed, type GateOutcome } from '../src/auth/gate';
import vectorFile from '../../shared/test/fixtures/scrape-rules.json';
import { apiCall, bearer, bodyText, ctx, installUpstream, makeEnv, type ApiCall, type FakeUser } from './gate-support';

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

const vectors = vectorFile as unknown as {
  site_origin: string;
  scrape_targets: Vector[];
  directory_targets: Vector[];
  scrape_url_lists: ListVector[];
};

function urlsOf(v: ListVector): unknown {
  return v.repeat ? Array.from({ length: v.repeat.count }, () => v.repeat?.value) : v.urls;
}

let staff: FakeUser;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const up = await installUpstream();
  staff = await up.addUser(['sales_rep']);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 'allow', or 'deny' for the gate's data refusal (400 url_not_allowed); anything else fails the test. */
async function decision(call: ApiCall): Promise<'allow' | 'deny'> {
  const { r, request } = apiCall({ ...call, headers: bearer(staff) });
  const outcome: GateOutcome = await applyGate(r, request, makeEnv({ SITE_ORIGIN: vectors.site_origin }), ctx);
  if (outcome.kind === 'allow') return 'allow';
  expect(outcome.kind).toBe('deny');
  if (outcome.kind !== 'deny') throw new Error(`unexpected outcome ${outcome.kind}`);
  expect(outcome.response.status).toBe(400);
  expect(JSON.parse(await bodyText(outcome.response))).toEqual({ error: 'url_not_allowed' });
  return 'deny';
}

describe('scrape rules: shared validators = site gate', () => {
  it('the vector file has every kind', () => {
    expect(vectors.site_origin).toBe('https://www.micronshub.eu');
    expect(vectors.scrape_targets.length).toBeGreaterThan(10);
    expect(vectors.directory_targets.length).toBeGreaterThan(5);
    expect(vectors.scrape_url_lists.length).toBeGreaterThan(5);
  });

  it.each(vectors.scrape_targets.map((v) => [JSON.stringify(v.value), v] as const))('scrape target %s', (_name, v) => {
    const env = makeEnv({ SITE_ORIGIN: vectors.site_origin });
    expect(scrapeTargetAllowed(v.value, env)).toBe(v.allowed);
    expect(sharedScrapeTargetAllowed(v.value, { siteOrigin: vectors.site_origin })).toBe(v.allowed);
  });

  it.each(vectors.directory_targets.map((v) => [JSON.stringify(v.value), v] as const))('directory target %s', (_name, v) => {
    expect(directoryTargetAllowed(v.value)).toBe(v.allowed);
    expect(sharedDirectoryTargetAllowed(v.value)).toBe(v.allowed);
  });

  it('SC-1 through applyGate: every URL list vector gets the shared gate-form answer', async () => {
    for (const v of vectors.scrape_url_lists) {
      const urls = urlsOf(v);
      const expected = scrapeUrlsGateAllows(urls, { siteOrigin: vectors.site_origin }) ? 'allow' : 'deny';
      expect(expected === 'allow').toBe(v.gate);
      expect(await decision({ endpoint: 'scrape-website', action: 'post', body: { urls } }), JSON.stringify(urls).slice(0, 80)).toBe(expected);
    }
    // A single-URL list per scrape-target vector: the gate's row answers the shared per-URL rule.
    for (const v of vectors.scrape_targets) {
      const expected = sharedScrapeTargetAllowed(v.value, { siteOrigin: vectors.site_origin }) ? 'allow' : 'deny';
      expect(await decision({ endpoint: 'scrape-website', action: 'post', body: { urls: [v.value] } }), JSON.stringify(v.value)).toBe(expected);
    }
  });

  it('SC-2 and SC-3 through applyGate: every directory vector with a truthy url gets the shared answer', async () => {
    const rows: Array<{ endpoint: 'scrape-company-profile' | 'scan-directory'; extra: Record<string, unknown> }> = [
      { endpoint: 'scrape-company-profile', extra: { source: 'europages' } },
      { endpoint: 'scan-directory', extra: {} },
    ];
    for (const row of rows) {
      for (const v of vectors.directory_targets) {
        const expected = sharedDirectoryTargetAllowed(v.value) ? 'allow' : 'deny';
        expect(await decision({ endpoint: row.endpoint, action: 'post', body: { url: v.value, ...row.extra } }), `${row.endpoint} ${JSON.stringify(v.value)}`).toBe(expected);
      }
    }
  });
});
