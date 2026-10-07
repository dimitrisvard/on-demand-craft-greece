// Browser Run rendering: one browser, one tab, no images/media/fonts/stylesheets, closed on success and on a
// throw; the fixture renderer of generated test configs; the port is null without a binding.

import { describe, expect, it } from 'vitest';
import {
  BLOCKED_RESOURCE_TYPES,
  BrowserBudget,
  renderPage,
  scraperBrowser,
  type Launcher,
  type RenderRequest,
} from '../../src/scrapers/browser';
import { scraperFetch } from '../../src/scrapers/fetch-page';
import { opsEnv } from '../helpers/ops';
import { UA, routedFetch } from './helpers';

function fakeLauncher(o: { failAt?: 'newPage' | 'goto' | 'content'; status?: number } = {}) {
  const events: string[] = [];
  const decisions: Record<string, string> = {};
  let handler: ((r: RenderRequest) => void) | null = null;
  const launcher: Launcher = {
    async launch(binding) {
      events.push(`launch ${binding === BINDING ? 'BROWSER' : 'other'}`);
      return {
        async newPage() {
          events.push('newPage');
          if (o.failAt === 'newPage') throw new Error('newPage failed');
          return {
            async setUserAgent(ua: string) { events.push(`ua ${ua}`); },
            async setRequestInterception(on: boolean) { events.push(`intercept ${on}`); },
            on(_event: 'request', h: (r: RenderRequest) => void) { handler = h; },
            async goto(url: string, opts: { waitUntil: string; timeout: number }) {
              events.push(`goto ${url} ${opts.waitUntil} ${opts.timeout}`);
              for (const type of ['document', 'script', 'xhr', 'image', 'media', 'font', 'stylesheet']) {
                handler?.({ resourceType: () => type, abort: () => { decisions[type] = 'abort'; }, continue: () => { decisions[type] = 'continue'; } });
              }
              if (o.failAt === 'goto') throw new Error('navigation timeout');
              return { status: () => o.status ?? 200 };
            },
            async content() {
              if (o.failAt === 'content') throw new Error('content failed');
              return '<html>rendered</html>';
            },
          };
        },
        async close() { events.push('close'); },
      };
    },
  };
  return { launcher, events, decisions };
}

const BINDING = { fetch: async () => new Response('') } as unknown as Fetcher;

describe('renderPage', () => {
  it('one tab with our identity; heavy resources aborted; closed after the page', async () => {
    const fake = fakeLauncher();
    const out = await renderPage(BINDING, 'https://www.example.de/x', { userAgent: UA, launcher: fake.launcher });
    expect(out).toEqual({ status: 200, html: '<html>rendered</html>' });
    expect(fake.events).toEqual(['launch BROWSER', 'newPage', `ua ${UA}`, 'intercept true', 'goto https://www.example.de/x domcontentloaded 20000', 'close']);
    expect(BLOCKED_RESOURCE_TYPES).toEqual(['image', 'media', 'font', 'stylesheet']);
    expect(fake.decisions).toEqual({ document: 'continue', script: 'continue', xhr: 'continue', image: 'abort', media: 'abort', font: 'abort', stylesheet: 'abort' });
  });

  it.each(['newPage', 'goto', 'content'] as const)('closes the browser when %s throws', async (failAt) => {
    const fake = fakeLauncher({ failAt });
    await expect(renderPage(BINDING, 'https://www.example.de/x', { userAgent: UA, launcher: fake.launcher })).rejects.toThrow();
    expect(fake.events.at(-1)).toBe('close');
    expect(fake.events.filter((e) => e === 'close')).toHaveLength(1);
  });

  it('a budget allows one browser per invocation', () => {
    const budget = new BrowserBudget();
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    expect(budget.spent).toBe(true);
  });
});

describe('scraperBrowser and scraperFetch', () => {
  it('null without a binding; the binding renderer with one', () => {
    expect(scraperBrowser(opsEnv())).toBeNull();
    expect(scraperBrowser(opsEnv({ BROWSER: BINDING }))).not.toBeNull();
  });

  it('generated test configs: AGENT_STUBS browser -> fixture renderer reading <SCRAPER_API_BASE>/__rendered/...', async () => {
    const { fetch, requests } = routedFetch({ 'http://127.0.0.1:9999/__rendered/www.wlw.de/de/suche/x?q=1': { body: '<html>fixture</html>' } });
    const port = scraperBrowser({ ...opsEnv(), AGENT_STUBS: 'llm,browser', SCRAPER_API_BASE: 'http://127.0.0.1:9999/' }, { fetch });
    expect(await port?.render('https://www.wlw.de/de/suche/x?q=1', { timeoutMs: 1000, userAgent: UA })).toEqual({ status: 200, html: '<html>fixture</html>' });
    expect(requests[0].headers['user-agent']).toBe(UA);
  });

  it('SCRAPER_API_BASE re-addresses fetches only in generated test configs', async () => {
    const { fetch, requests } = routedFetch({ 'http://127.0.0.1:9999/www.wlw.de/robots.txt': { body: 'x' } });
    const rewritten = scraperFetch({ ...opsEnv(), AGENT_STUBS: 'browser', SCRAPER_API_BASE: 'http://127.0.0.1:9999' }, fetch);
    expect(await (await rewritten('https://www.wlw.de/robots.txt')).text()).toBe('x');
    expect(requests.map((r) => r.url)).toEqual(['http://127.0.0.1:9999/www.wlw.de/robots.txt']);
    expect(() => scraperFetch({ ...opsEnv(), SCRAPER_API_BASE: 'http://127.0.0.1:9999' }, fetch)).toThrow(/test configs only/);
    expect(scraperFetch(opsEnv(), fetch)).toBe(fetch);
  });
});
