// /api/notifications through OpsApi with the real api/notifications.js (nesting and inventory code included):
// `nest` with the 80-instance fixture, `inv-label` returning a PDF, and the nest fixture builder itself. Supabase is
// a fake on the global fetch; nothing reaches the network.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore -- plain .mjs script without types
import { NEST_FIXTURE_SIZES, buildNestPayload, closedOutlineDxf } from '../scripts/nest-fixture.mjs';
import { invoke, jsonPost, opsCall, STAFF, SUPABASE_URL } from './helpers/ops';

type IndexModule = typeof import('../src/index');

const STOCK_ITEM_ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

let OpsApi: IndexModule['OpsApi'];
let dbCalls: string[];

beforeAll(async () => {
  // api/notifications.js and lib/inventory read these at module scope.
  vi.stubEnv('RESEND_API_KEY', 'resend-test-value');
  vi.stubEnv('SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-value');
  vi.resetModules();
  ({ OpsApi } = await import('../src/index'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  dbCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    dbCalls.push(`${request.method} ${url.pathname}`);
    if (url.origin !== SUPABASE_URL) throw new Error(`network is not allowed in this test: ${url.origin}`);
    if (url.pathname === '/rest/v1/stock_items' && url.searchParams.get('id') === `eq.${STOCK_ITEM_ID}`) {
      return new Response(JSON.stringify({
        id: STOCK_ITEM_ID, qr_code: 'RMN-T1-0001', origin: 'remnant', width_mm: 500, height_mm: 300,
        remaining_area_mm2: 150000, location: 'Rack A', received_date: '2026-10-01',
        material: { id: 'm1', name: 'Steel', grade: 'S235', thickness_mm: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'not found' }), { status: 406, headers: { 'content-type': 'application/json' } });
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('nest fixture', () => {
  it('builds the body the RFQ page sends, with exactly the requested number of part instances', () => {
    expect(NEST_FIXTURE_SIZES).toEqual([80, 400, 800, 1200]);
    for (const size of NEST_FIXTURE_SIZES) {
      for (const level of ['balanced', 'best']) {
        const body = buildNestPayload(size, level);
        expect(Object.keys(body)).toEqual(['action', 'files', 'metadata']);
        expect(body.action).toBe('nest');
        expect(body.metadata.config).toEqual({ gap: 3, edgeMargin: 5, rotationMode: '90deg', optimizationLevel: level });
        const parts = body.metadata.parts as Array<{ fileIndex: number; name: string; material: string; thickness: number; quantity: number }>;
        expect(parts.reduce((sum, p) => sum + p.quantity, 0)).toBe(size);
        for (const part of parts) {
          expect(Object.keys(part)).toEqual(['fileIndex', 'name', 'material', 'thickness', 'quantity']);
          expect(typeof body.files[part.fileIndex]).toBe('string');
          expect(part.thickness).toBeGreaterThan(0);
        }
      }
    }
  });

  it('spreads a count that does not divide by the number of shapes', () => {
    for (const size of [81, 402, 803]) {
      const parts = buildNestPayload(size, 'best').metadata.parts as Array<{ quantity: number }>;
      expect(parts.reduce((sum, p) => sum + p.quantity, 0)).toBe(size);
      expect(Math.max(...parts.map((p) => p.quantity)) - Math.min(...parts.map((p) => p.quantity))).toBeLessThanOrEqual(1);
    }
  });

  it('refuses sizes and levels it cannot build', () => {
    expect(() => buildNestPayload(3, 'balanced')).toThrow(RangeError);
    expect(() => buildNestPayload(80.5, 'balanced')).toThrow(RangeError);
    expect(() => buildNestPayload(80, 'fast')).toThrow(RangeError);
  });

  it('writes a closed LWPOLYLINE outline', () => {
    expect(closedOutlineDxf([[0, 0], [10, 0], [0, 10]])).toBe(
      ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '0', '20', '10', '0', 'ENDSEC', '0', 'EOF', ''].join('\n'),
    );
  });
});

describe('/api/notifications on microns-ops (real handler)', () => {
  it('nest with the 80-instance fixture answers 200 with both material groups and every part placed', async () => {
    const call = opsCall({ endpoint: 'notifications', action: 'nest', functionUrl: '/api/notifications', principal: STAFF });
    const response = await invoke(OpsApi, call, jsonPost(buildNestPayload(80, 'balanced')));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const result = (await response.json()) as { success: boolean; groups: Array<{ material: string }>; summary: { totalParts: number; materialGroups: number } };
    expect(result.success).toBe(true);
    expect(result.groups.map((g) => g.material).sort()).toEqual(['Aluminium 5754', 'Steel S235']);
    expect(result.summary).toMatchObject({ totalParts: 80, materialGroups: 2 });
    expect(dbCalls).toEqual([]);
  });

  it('inv-label (GET, as the label link opens it) answers the PDF of the stock row', async () => {
    const functionUrl = `/api/notifications?action=inv-label&stockItemId=${STOCK_ITEM_ID}`;
    const call = opsCall({ endpoint: 'notifications', action: 'inv-label', functionUrl, principal: STAFF });
    const response = await invoke(OpsApi, call);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('inline; filename="label-RMN-T1-0001.pdf"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(dbCalls).toEqual(['GET /rest/v1/stock_items']);
  });

  it('OPTIONS is answered by the handler itself (200, its CORS headers)', async () => {
    const call = opsCall({ endpoint: 'notifications', action: '#options', functionUrl: '/api/notifications', principal: { class: 'ANON' } });
    const response = await invoke(OpsApi, call, { method: 'OPTIONS' });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,OPTIONS,PATCH,DELETE,POST,PUT');
    expect(await response.text()).toBe('');
  });
});
