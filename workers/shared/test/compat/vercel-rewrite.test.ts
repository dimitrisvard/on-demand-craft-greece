import { describe, expect, it } from 'vitest';
import vercelJson from '../../../../vercel.json';
import { API_REWRITES } from '../../src/compat/vercel-rewrite';

describe('API_REWRITES', () => {
  it('lists exactly the vercel.json rewrites whose destination is an /api function other than the sitemap', () => {
    const fromVercelJson = vercelJson.rewrites
      .filter((r) => r.destination.startsWith('/api/') && !r.destination.startsWith('/api/sitemap'))
      .map((r) => {
        const q = r.destination.indexOf('?');
        return {
          source: r.source,
          destinationPath: q === -1 ? r.destination : r.destination.slice(0, q),
          destinationSearch: q === -1 ? '' : r.destination.slice(q),
        };
      });
    expect(API_REWRITES).toStrictEqual(fromVercelJson);
  });

  it('maps /api/track to marketing with action=track and /api/connector-status to tenders with connectors=true', () => {
    expect(API_REWRITES).toStrictEqual([
      { source: '/api/track', destinationPath: '/api/marketing', destinationSearch: '?action=track' },
      { source: '/api/connector-status', destinationPath: '/api/tenders', destinationSearch: '?connectors=true' },
    ]);
  });
});
