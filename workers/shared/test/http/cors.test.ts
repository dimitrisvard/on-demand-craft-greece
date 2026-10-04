import { describe, expect, it } from 'vitest';
import vercelJson from '../../../../vercel.json';
import { HEADER_RULES } from '../../../site/src/preview';
import {
  ALLOWLIST_HEADERS,
  VERCEL_API_CORS_HEADERS,
  applyAllowlistCors,
  isAllowedOrigin,
  type AllowlistConfig,
} from '../../src/http/cors';

describe('VERCEL_API_CORS_HEADERS (parity mode)', () => {
  it('equals the vercel.json headers for /api/(.*), in file order', () => {
    const rule = vercelJson.headers.find((h) => h.source === '/api/(.*)');
    expect(rule).toBeDefined();
    expect(VERCEL_API_CORS_HEADERS).toStrictEqual(rule!.headers.map((h) => [h.key, h.value]));
  });

  it('is byte-equal to the headers that microns-site finalise() sets on /api/* answers', () => {
    const siteRule = HEADER_RULES.find((r) => r.source.test('/api/emails'));
    expect(siteRule).toBeDefined();
    expect(VERCEL_API_CORS_HEADERS).toStrictEqual(siteRule!.headers);
  });
});

const PRODUCTION: AllowlistConfig = { siteOrigin: 'https://www.micronshub.eu', requestHost: 'www.micronshub.eu', requestIsPreview: false };
const PREVIEW: AllowlistConfig = {
  siteOrigin: 'https://www.micronshub.eu',
  requestHost: 'abc123-microns-site.team.workers.dev',
  requestIsPreview: true,
};

describe('isAllowedOrigin (allow-list mode)', () => {
  it('allows SITE_ORIGIN and the zone apex', () => {
    expect(isAllowedOrigin('https://www.micronshub.eu', PRODUCTION)).toBe(true);
    expect(isAllowedOrigin('https://micronshub.eu', PRODUCTION)).toBe(true);
  });

  it('allows a tenant on one sub-domain label of the zone', () => {
    for (const origin of ['https://acme.micronshub.eu', 'https://a.micronshub.eu', 'https://tenant-1.micronshub.eu', `https://${'a'.repeat(63)}.micronshub.eu`]) {
      expect(isAllowedOrigin(origin, PRODUCTION), origin).toBe(true);
    }
  });

  it('never allows api.<zone>, *.vercel.app, other hosts or look-alikes (exact host comparison)', () => {
    for (const origin of [
      'https://api.micronshub.eu',
      'https://on-demand-craft-greece.vercel.app',
      'https://a.b.micronshub.eu',
      'https://-acme.micronshub.eu',
      'https://acme-.micronshub.eu',
      `https://${'a'.repeat(64)}.micronshub.eu`,
      'https://evilmicronshub.eu',
      'https://www.micronshub.eu.evil.test',
      'https://micronshub.eu.evil.test',
      'https://evil.test',
    ]) {
      expect(isAllowedOrigin(origin, PRODUCTION), origin).toBe(false);
    }
  });

  it('accepts only canonical origins: https, lower-case host, no port, path, user info or trailing slash', () => {
    for (const origin of [
      'http://www.micronshub.eu',
      'https://WWW.micronshub.eu',
      'https://www.micronshub.eu/',
      'https://www.micronshub.eu:443',
      'https://www.micronshub.eu:8443',
      'https://acme.micronshub.eu:8443',
      'https://user@www.micronshub.eu',
      'null',
      '',
      'not a url',
    ]) {
      expect(isAllowedOrigin(origin, PRODUCTION), origin).toBe(false);
    }
  });

  it('allows preview origins only when the request host is a preview host', () => {
    const origin = 'https://abc123-microns-site.team.workers.dev';
    expect(isAllowedOrigin(origin, PREVIEW)).toBe(true);
    expect(isAllowedOrigin('https://microns-site.team.workers.dev', PREVIEW)).toBe(true);
    expect(isAllowedOrigin(origin, { ...PREVIEW, requestIsPreview: false })).toBe(false);
  });

  it('takes the workers subdomain from the config, else from a workers.dev request host', () => {
    const origin = 'https://v2-microns-site.other.workers.dev';
    expect(isAllowedOrigin(origin, PREVIEW)).toBe(false);
    expect(isAllowedOrigin(origin, { ...PREVIEW, workersSubdomain: 'other' })).toBe(true);
    const localPreview = { ...PREVIEW, requestHost: 'localhost' };
    expect(isAllowedOrigin('https://microns-site.team.workers.dev', localPreview)).toBe(false);
    expect(isAllowedOrigin('https://microns-site.team.workers.dev', { ...localPreview, workersSubdomain: 'team' })).toBe(true);
  });

  it('rejects preview look-alikes: other Workers, other subdomains, extra labels', () => {
    for (const origin of [
      'https://microns-ops.team.workers.dev',
      'https://evil-microns-site.team.workers.dev.evil.test',
      'https://x.microns-site.team.workers.dev',
      'https://microns-site.team.workers.dev:444',
      'http://microns-site.team.workers.dev',
      'https://notmicrons-site.team.workers.dev',
    ]) {
      expect(isAllowedOrigin(origin, PREVIEW), origin).toBe(false);
    }
  });

  it('allows the local dev origin http://localhost:8080 only on a preview host', () => {
    expect(isAllowedOrigin('http://localhost:8080', PREVIEW)).toBe(true);
    expect(isAllowedOrigin('http://localhost:8080', PRODUCTION)).toBe(false);
    expect(isAllowedOrigin('http://localhost:3000', PREVIEW)).toBe(false);
    expect(isAllowedOrigin('https://localhost:8080', PREVIEW)).toBe(false);
  });
});

describe('applyAllowlistCors', () => {
  const parityHeaders = () => new Headers(VERCEL_API_CORS_HEADERS.map(([name, value]) => [name, value]));

  it('reflects an allowed Origin with Vary, methods, headers incl. Authorization and X-Turnstile-Token, max-age 600', () => {
    const headers = parityHeaders();
    applyAllowlistCors(headers, 'https://acme.micronshub.eu', PRODUCTION);
    expect(Object.fromEntries(headers)).toStrictEqual({
      'access-control-allow-origin': 'https://acme.micronshub.eu',
      'access-control-allow-methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
      'access-control-allow-headers': ALLOWLIST_HEADERS,
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    expect(ALLOWLIST_HEADERS.split(', ')).toEqual(expect.arrayContaining(['Authorization', 'X-Turnstile-Token', 'Content-Type']));
  });

  it('never sends Access-Control-Allow-Credentials', () => {
    const headers = parityHeaders();
    applyAllowlistCors(headers, 'https://www.micronshub.eu', PRODUCTION);
    expect(headers.has('access-control-allow-credentials')).toBe(false);
  });

  it('a disallowed or missing Origin gets no CORS grant at all, but still Vary: Origin', () => {
    for (const origin of ['https://evil.test', null]) {
      const headers = parityHeaders();
      applyAllowlistCors(headers, origin, PRODUCTION);
      expect(Object.fromEntries(headers)).toStrictEqual({ vary: 'Origin' });
    }
  });

  it('adds Origin to an existing Vary once', () => {
    const headers = new Headers({ Vary: 'Accept-Encoding' });
    applyAllowlistCors(headers, 'https://www.micronshub.eu', PRODUCTION);
    applyAllowlistCors(headers, 'https://www.micronshub.eu', PRODUCTION);
    expect(headers.get('vary')).toBe('Accept-Encoding, Origin');
    const star = new Headers({ Vary: '*' });
    applyAllowlistCors(star, null, PRODUCTION);
    expect(star.get('vary')).toBe('*');
  });
});
