// T2: startup isolation over real workerd. A second harness is started with RESEND_API_KEY left out of the generated
// site .dev.vars: /api/emails answers 500, while the SEO page /en and a tracking pixel answer 200, because no API
// handler is evaluated at startup (each is imported lazily by its route) and each route checks only its own names.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Harness {
  site: string;
  stop(): Promise<void>;
}

interface HarnessModule {
  startHarness(options: { omitSiteSecrets?: string[]; publish?: boolean; quiet?: boolean }): Promise<Harness>;
}

let harness: Harness;

beforeAll(async () => {
  const specifier = new URL('./harness.mjs', (import.meta as unknown as { url: string }).url).href;
  const mod = (await import(/* @vite-ignore */ specifier)) as HarnessModule;
  harness = await mod.startHarness({ omitSiteSecrets: ['RESEND_API_KEY'], publish: false, quiet: true });
}, 180_000);

afterAll(async () => {
  await harness?.stop();
});

describe('a Worker without RESEND_API_KEY', () => {
  it('/api/emails -> 500 text/plain', async () => {
    const res = await fetch(`${harness.site}/api/emails`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('Internal Server Error');
  });

  it('/en -> 200 (SEO path unaffected)', async () => {
    const res = await fetch(`${harness.site}/en`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it('/api/marketing?action=track&type=open -> 200 pixel', async () => {
    const res = await fetch(`${harness.site}/api/marketing?action=track&type=open`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect((await res.arrayBuffer()).byteLength).toBe(70);
  });

  it('an ops endpoint still answers (OPTIONS through OPS)', async () => {
    const res = await fetch(`${harness.site}/api/tenders`, { method: 'OPTIONS' });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });
});
