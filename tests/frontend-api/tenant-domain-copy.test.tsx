// Tenant editor custom-domain copy (PLAN.md P3-6): the instructions are true whichever platform serves
// production, so they name no hosting provider and no provider DNS target. Globals: describe/it/expect
// (tests/frontend-api/vitest.config.mjs); rendering with the repo helper (no testing-library in the root).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { CustomDomainInstructions, DOMAIN_NOT_REACHABLE } from '@/components/tenants/CustomDomainInstructions';
import { render } from './helpers';

const PROVIDER_TEXT = /vercel|cloudflare|cname\.|\.vercel-dns|workers\.dev/i;

/** A repository file, read from this test file's own path (<root>/tests/frontend-api/). */
function readRepoFile(path: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('test path unknown');
  return readFileSync(resolve(testPath, '../../..', path), 'utf8');
}

describe('tenant custom-domain copy', () => {
  it('names the working subdomain and the requested domain', async () => {
    const m = await render(createElement(CustomDomainInstructions, { slug: 'laserkritis', customDomain: 'www.laserkritis.gr' }));
    expect(m.container.textContent).toContain('https://laserkritis.micronshub.eu');
    expect(m.container.textContent).toContain('www.laserkritis.gr');
    m.unmount();
  });

  it('names no hosting provider and no provider DNS target', async () => {
    const m = await render(createElement(CustomDomainInstructions, { slug: 'x', customDomain: 'shop.example.com' }));
    expect(`${m.container.textContent} ${DOMAIN_NOT_REACHABLE}`).not.toMatch(PROVIDER_TEXT);
    m.unmount();
  });

  it('the tenant editor uses the shared copy and holds no provider-specific text', () => {
    const page = readRepoFile('src/pages/dashboard/tenants/TenantEditPage.tsx');
    expect(page).toMatch(/<CustomDomainInstructions\b/);
    expect(page).toMatch(/description: DOMAIN_NOT_REACHABLE/);
    expect(page).not.toMatch(PROVIDER_TEXT);
  });
});

describe('README Deployment section', () => {
  interface RedirectRule {
    expression: string;
    action_parameters: { from_value: { target_url: { expression: string } } };
  }

  it('describes the zone redirects as the committed rule payload configures them', () => {
    // The payload: HTTP goes to HTTPS on the same host; only the apex goes to www.
    const { rules } = JSON.parse(readRepoFile('scripts/phase3/payloads/redirect-rules.default.json')) as { rules: RedirectRule[] };
    const target = (expression: string) =>
      rules.find((r) => r.expression === expression)?.action_parameters.from_value.target_url.expression ?? '';
    expect(target('(not ssl)')).toMatch(/^concat\("https:\/\/", http\.host, /);
    expect(target('(http.host eq "micronshub.eu")')).toMatch(/^concat\("https:\/\/www\.micronshub\.eu", /);

    const readme = readRepoFile('README.md');
    const start = readme.indexOf('\n## Deployment\n');
    expect(start).toBeGreaterThan(-1);
    const section = readme.slice(start, readme.indexOf('\n---', start));
    const rows = section.split('\n').filter((line) => line.startsWith('|'));

    const httpRows = rows.filter((row) => row.includes('`http://`'));
    expect(httpRows.length).toBeGreaterThan(0);
    for (const row of httpRows) {
      expect(row).toContain('same host');
      expect(row).not.toContain('https://www.micronshub.eu');
    }
    const apexRows = rows.filter((row) => /\bapex\b/i.test(row));
    expect(apexRows.length).toBeGreaterThan(0);
    for (const row of apexRows) expect(row).toContain('`https://www.micronshub.eu`');
  });
});
