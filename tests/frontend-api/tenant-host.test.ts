// Tenant host classification of src/utils/tenantApi.ts (resolveTenantIdentifier). Platform-neutral: the same
// frontend runs on every host that serves the site, so each served host keeps its class. Globals:
// describe/it/expect (tests/frontend-api/vitest.config.mjs).
import { resolveTenantIdentifier, type TenantIdentifier } from '@/utils/tenantApi';

const DEFAULT: TenantIdentifier = { type: 'default' };
const sub = (slug: string): TenantIdentifier => ({ type: 'subdomain', slug });
const custom = (hostname: string): TenantIdentifier => ({ type: 'custom_domain', hostname });

const CASES: Array<[string, TenantIdentifier]> = [
  ['www.micronshub.eu', DEFAULT],
  ['micronshub.eu', DEFAULT],
  ['api.micronshub.eu', DEFAULT],
  ['acme.micronshub.eu', sub('acme')],
  ['acme.micronshub.eu.', sub('acme')],
  // Matching ignores case; a custom domain is returned exactly as given.
  ['ACME.MicronsHub.EU', sub('acme')],
  ['Shop.Example.com.', custom('Shop.Example.com.')],
  ['micronshub.eu.example.com', custom('micronshub.eu.example.com')],
  ['x-micronshub.eu.example.com', custom('x-micronshub.eu.example.com')],
  ['notmicronshub.eu', custom('notmicronshub.eu')],
  ['localhost', DEFAULT],
  ['127.0.0.1', DEFAULT],
  ['microns-site.preview-account.workers.dev', custom('microns-site.preview-account.workers.dev')],
  ['on-demand-craft-greece.vercel.app', custom('on-demand-craft-greece.vercel.app')],
];

describe('tenant hosts match only the exact micronshub.eu suffix', () => {
  it.each(CASES)('%s', (hostname, expected) => {
    expect(resolveTenantIdentifier(hostname)).toEqual(expected);
  });
});
