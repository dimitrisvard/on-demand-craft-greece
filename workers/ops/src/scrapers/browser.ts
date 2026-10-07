// Browser Run rendering for client-rendered directory pages (binding BROWSER, @cloudflare/puppeteer).
//
// Rules
//   - Used only by the scraper module, only for a host named in SCRAPER_PERMITTED_HOSTS whose plain fetch answered
//     200 with no company cards on a page that needs client-side rendering; never after a 403, 429 or challenge
//     page (the caller checks; this module only renders).
//   - At most one browser per invocation (a BrowserBudget per scan) with one tab; images, media, fonts and
//     stylesheets are not loaded; the browser is closed in `finally`, also when rendering throws (an unclosed
//     session keeps running until its idle timeout).
//   - The page is loaded with our crawler User-Agent and waitUntil 'domcontentloaded', 20 s timeout.
//   - Browser Run identifies itself to the target site with headers that cannot be removed (CF docs (fetched
//     2026-10-03) https://developers.cloudflare.com/browser-rendering/reference/automatic-request-headers/).
//   - scraperBrowser(env): the BrowserPort of the module. Generated test configs (AGENT_STUBS contains 'browser')
//     get a fixture renderer that reads <SCRAPER_API_BASE>/__rendered/<host><path><query>; without the binding the
//     answer is null (no rendering).

import type { BrowserPort } from '../ports/index';
import type { ScraperEnv } from './fetch-page';

export const RENDER_TIMEOUT_MS = 20_000;
/** Resource types never loaded while rendering. */
export const BLOCKED_RESOURCE_TYPES: readonly string[] = ['image', 'media', 'font', 'stylesheet'];

// Structural subset of @cloudflare/puppeteer used here (so tests can pass a fake launcher).
export interface RenderRequest {
  resourceType(): string;
  abort(): Promise<void> | void;
  continue(): Promise<void> | void;
}
export interface RenderResponse {
  status(): number;
}
export interface RenderPage {
  setUserAgent(ua: string): Promise<void>;
  setRequestInterception(on: boolean): Promise<void>;
  on(event: 'request', handler: (request: RenderRequest) => void): unknown;
  goto(url: string, o: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<RenderResponse | null>;
  content(): Promise<string>;
}
export interface RenderBrowser {
  newPage(): Promise<RenderPage>;
  close(): Promise<void>;
}
export interface Launcher {
  launch(binding: Fetcher): Promise<RenderBrowser>;
}

/** One browser per invocation: a scan creates one budget and passes it to every render. */
export class BrowserBudget {
  private used = false;
  /** True once; every later call is false. */
  take(): boolean {
    if (this.used) return false;
    this.used = true;
    return true;
  }
  get spent(): boolean {
    return this.used;
  }
}

async function defaultLauncher(): Promise<Launcher> {
  const module = (await import('@cloudflare/puppeteer')) as unknown as { default: Launcher };
  return module.default;
}

/** Renders one page in a fresh browser (see the rules above). */
export async function renderPage(
  binding: Fetcher,
  url: string,
  o: { userAgent: string; timeoutMs?: number; launcher?: Launcher },
): Promise<{ status: number; html: string }> {
  const launcher = o.launcher ?? (await defaultLauncher());
  const browser = await launcher.launch(binding);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(o.userAgent);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (BLOCKED_RESOURCE_TYPES.includes(request.resourceType())) void request.abort();
      else void request.continue();
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: o.timeoutMs ?? RENDER_TIMEOUT_MS });
    const html = await page.content();
    return { status: response ? response.status() : 0, html };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** BrowserPort over the BROWSER binding. */
export function bindingBrowser(binding: Fetcher, launcher?: Launcher): BrowserPort {
  return {
    render: (url, o) => renderPage(binding, url, { userAgent: o.userAgent, timeoutMs: o.timeoutMs, launcher }),
  };
}

/** Fixture renderer of generated test configs: GET <SCRAPER_API_BASE>/__rendered/<host><path><query>. */
export function fixtureBrowser(env: ScraperEnv, base: typeof fetch = fetch): BrowserPort {
  return {
    async render(url, o) {
      if (!env.SCRAPER_API_BASE || !env.AGENT_STUBS) return { status: 503, html: '' };
      const target = new URL(url);
      const origin = env.SCRAPER_API_BASE.replace(/\/+$/, '');
      const response = await base(`${origin}/__rendered/${target.host}${target.pathname}${target.search}`, {
        headers: { 'User-Agent': o.userAgent },
      });
      return { status: response.status, html: await response.text() };
    },
  };
}

function hasStubToken(env: ScraperEnv, token: string): boolean {
  return (env.AGENT_STUBS ?? '').split(',').map((t) => t.trim()).includes(token);
}

/** The module's BrowserPort, or null when no rendering is possible here. */
export function scraperBrowser(env: ScraperEnv, o: { launcher?: Launcher; fetch?: typeof fetch } = {}): BrowserPort | null {
  if (hasStubToken(env, 'browser')) return fixtureBrowser(env, o.fetch);
  if (env.BROWSER) return bindingBrowser(env.BROWSER, o.launcher);
  return null;
}
