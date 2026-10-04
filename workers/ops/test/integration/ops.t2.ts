// T2: microns-ops over real workerd, entered through the site Worker (site -> OPS RPC -> OpsApi -> Hono route ->
// unchanged handler), with Supabase answered by the local upstream stub.
//   - inv-label: qrcode resolves to its server build in the bundle (alias), so the label is a real PDF
//   - nest with the 80-instance fixture answers 200 with material groups
//   - a machine tender-scan (Access assertion minted at the stub) is queued: 200 with every key of the scan
//     answer at zero plus queued and run_id (the generated T2 ops config has no consumer, so no portal is called)
//   - a STAFF call crosses the RPC boundary with its principal (the handler's GET branch reaches the stub DB)
// The stub client (workers/site/test/integration/stub-client.ts) is loaded at run time by file URL, so this file
// type-checks without it.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore -- plain .mjs script without types; buildNestPayload(instances, level) returns the JSON body
import { buildNestPayload } from '../../scripts/nest-fixture.mjs';

interface StubRoute { method: string; path: string; status: number; headers?: Record<string, string>; body?: unknown }
interface StubClient {
  stubRoute(route: StubRoute): Promise<void>;
  stubReset(): Promise<void>;
  stubCalls(): Promise<Array<{ method: string; path: string; headers?: Record<string, string> }>>;
  mintSupabaseJwt(claims: { sub: string; email?: string; exp?: number }): Promise<string>;
  mintAccessJwt(claims: { commonName: string }): Promise<string>;
}

const SITE = (process.env.T2_SITE_URL as string | undefined) ?? '';
// Client id the harness maps to the collector machine in its generated ACCESS_MACHINE_CLIENT_IDS.
const COLLECTOR_CLIENT_ID = (process.env.T2_COLLECTOR_CLIENT_ID as string | undefined) ?? 't2-collector';
const UID = '3c2b1a0f-8e7d-4c6b-9a5f-4e3d2c1b0a9f';
const STOCK_ITEM_ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let stub: StubClient;

// The specifier is a file URL relative to this file: vitest resolves a bare relative variable specifier against
// the module id under the package root (workers/ops), and the stub client lives outside that root.
async function loadStubClient(): Promise<StubClient> {
  const specifier = new URL('../../../site/test/integration/stub-client.ts', (import.meta as unknown as { url: string }).url).href;
  return (await import(/* @vite-ignore */ specifier)) as StubClient;
}

async function asStaff(): Promise<string> {
  const token = await stub.mintSupabaseJwt({ sub: UID, email: 't2-staff@example.test', exp: Math.floor(Date.now() / 1000) + 600 });
  await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: UID, email: 't2-staff@example.test' } });
  await stub.stubRoute({ method: 'GET', path: '^/rest/v1/user_roles', status: 200, body: [{ role: 'admin' }] });
  return token;
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SITE}${path}`, { redirect: 'manual', ...init });
}

beforeAll(async () => {
  expect(SITE, 'T2_SITE_URL is set by the T2 harness (vitest.t2.config.ts globalSetup)').not.toBe('');
  stub = await loadStubClient();
});

beforeEach(async () => {
  await stub.stubReset();
});

describe('microns-ops through the site Worker', () => {
  it('inv-label with a stubbed stock row answers a PDF (qrcode server build in the bundle)', async () => {
    const token = await asStaff();
    await stub.stubRoute({
      method: 'GET',
      path: '^/rest/v1/stock_items',
      status: 200,
      body: {
        id: STOCK_ITEM_ID, qr_code: 'RMN-T2-0001', origin: 'remnant', width_mm: 500, height_mm: 300,
        remaining_area_mm2: 150000, location: 'Rack A', received_date: '2026-10-01',
        material: { id: 'm1', name: 'Steel', grade: 'S235', thickness_mm: 2 },
      },
    });
    const response = await api(`/api/notifications?action=inv-label&stockItemId=${STOCK_ITEM_ID}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('inline; filename="label-RMN-T2-0001.pdf"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('nest with the 80-instance fixture answers 200 with groups', async () => {
    const token = await asStaff();
    const response = await api('/api/notifications', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildNestPayload(80, 'balanced')),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { success: boolean; groups: unknown[]; summary: { totalParts: number } };
    expect(result.success).toBe(true);
    expect(result.groups.length).toBe(2);
    expect(result.summary.totalParts).toBe(80);
  });

  it('a machine tender-scan is queued: 200 with the exact keys', async () => {
    const assertion = await stub.mintAccessJwt({ commonName: COLLECTOR_CLIENT_ID });
    const response = await api('/api/tender-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Cf-Access-Jwt-Assertion': assertion },
      body: JSON.stringify({ country_code: 'nl' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toStrictEqual([
      'success', 'country_code', 'tenders_found', 'tenders_new', 'tenders_relevant', 'errors', 'duration_ms', 'queued', 'run_id',
    ]);
    expect(body).toMatchObject({ success: true, country_code: 'NL', tenders_found: 0, tenders_new: 0, tenders_relevant: 0, errors: [], duration_ms: 0, queued: true });
    expect(body.run_id).toMatch(UUID_RE);
    // Nothing of the scan ran: no connector state was written.
    const calls = await stub.stubCalls();
    expect(calls.some((c) => c.path.startsWith('/rest/v1/tender_connectors'))).toBe(false);
  });

  it('a STAFF call reaches the ops handler with its principal (site -> OPS RPC round trip)', async () => {
    const token = await asStaff();
    await stub.stubRoute({ method: 'GET', path: '^/rest/v1/tenders', status: 200, headers: { 'content-range': '0-0/1' }, body: [{ id: 't1', title: 'T2 tender' }] });
    const response = await api('/api/tenders?id=t1', { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBeLessThan(500);
    const calls = await stub.stubCalls();
    expect(calls.some((c) => c.method === 'GET' && c.path.startsWith('/rest/v1/tenders'))).toBe(true);
  });
});
