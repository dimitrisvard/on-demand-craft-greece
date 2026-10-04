import { describe, expect, it } from 'vitest';
import vercelJson from '../../../../vercel.json';
import { HEADER_RULES } from '../../../site/src/preview';
import { VERCEL_API_CORS_HEADERS } from '../../src/http/cors';

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
