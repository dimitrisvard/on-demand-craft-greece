// Test support for the scraper module: synthetic page fixtures, the saved robots.txt files, a routing fetch stub
// that records every request, and ScraperDeps with fakes (no network, virtual sleep).

import { readFileSync } from 'node:fs';
import { HostPauses, type ScraperDeps } from '../../src/scrapers/context';
import { RobotsCache } from '../../src/scrapers/robots';

const PAGES = new URL('../fixtures/scrapers/pages/', import.meta.url);
const ROBOTS = new URL('../fixtures/scrapers/robots/', import.meta.url);

export const UA = 'MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)';

/** A synthetic HTML page of test/fixtures/scrapers/pages. */
export function page(name: string): string {
  return readFileSync(new URL(name, PAGES), 'utf8');
}

/** A robots.txt file saved from the directory sites on 2026-10-03 (test/fixtures/scrapers/robots). */
export function savedRobots(host: string): string {
  return readFileSync(new URL(`${host}_robots.txt`, ROBOTS), 'utf8');
}

export interface Route {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Thrown instead of answering. */
  error?: Error;
}

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  redirect?: RequestInit['redirect'];
}

/** fetch stub answering by exact URL (else 404); every request is recorded. */
export function routedFetch(routes: Record<string, Route | ((url: string) => Route)>): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    requests.push({ url, headers, redirect: init?.redirect });
    const entry = routes[url];
    const route = typeof entry === 'function' ? entry(url) : entry;
    if (!route) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    if (route.error) throw route.error;
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers } });
  }) as typeof fetch;
  return { fetch: impl, requests };
}

export interface TestDeps extends ScraperDeps {
  sleeps: number[];
  logs: Array<{ event: string; fields: Record<string, unknown> }>;
}

/** ScraperDeps with fresh caches, a fixed clock, recorded sleeps and logs. */
export function testDeps(fetchImpl: typeof fetch, o: Partial<ScraperDeps> = {}): TestDeps {
  const sleeps: number[] = [];
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  let now = Date.UTC(2026, 9, 5, 9, 0, 0);
  return {
    fetch: fetchImpl,
    userAgent: UA,
    permitted: new Map(),
    browser: null,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    robotsCache: new RobotsCache(),
    pauses: new HostPauses(),
    log: (event, fields) => logs.push({ event, fields }),
    ...o,
    sleeps,
    logs,
  };
}
