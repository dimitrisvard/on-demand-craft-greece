import { describe, expect, it } from 'vitest';
import { makeCadRegistry } from '../../src/cad/registry';
import type { OpsEnv } from '../../src/env';

describe('R9 plain-HTTP unfold base URL', () => {
  it('the vps backend is built for an http: CAD_UNFOLD_URL and sends X-API-Key over it', async () => {
    const seen: Array<{ url: string; key: string | null }> = [];
    const env = { CAD_UNFOLD_URL: 'http://203.0.113.10:8000', CAD_SHARED_SECRET: 'dummy-not-a-secret' } as unknown as OpsEnv;
    const reg = makeCadRegistry(env, {
      fetcher: async (req) => {
        seen.push({ url: req.url, key: req.headers.get('x-api-key') });
        return new Response(JSON.stringify({ status: 'healthy' }), { status: 200 });
      },
    });
    const vps = reg.get('vps');
    expect(vps).toBeDefined();
    await vps!.health(new AbortController().signal);
    const bytes = new TextEncoder().encode('ISO-10303-21;');
    await vps!.run(
      { v: 1, job_id: 'j', job_type: 'analyse', params: { material: 'steel', thickness_override: 0, k_factor_override: 0, drawing_size: 'A3', process: 'sheet_metal' } } as never,
      { fileName: 'a.step', kind: 'step', contentType: 'application/step', sizeBytes: bytes.byteLength, sha256: 'x', open: async () => bytes.buffer as ArrayBuffer },
      new AbortController().signal,
    );
    console.info(JSON.stringify(seen.map((s) => ({ url: s.url, key_sent: s.key !== null }))));
    expect(seen.every((s) => s.url.startsWith('http://') && s.key === 'dummy-not-a-secret')).toBe(true);
    expect(seen).toHaveLength(2);
  });
});
