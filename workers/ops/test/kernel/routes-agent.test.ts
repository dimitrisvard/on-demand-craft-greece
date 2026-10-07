// K-2 /api/agent/* in microns-ops: decision by principal (relay MACHINE 'telegram' with the relay body, STAFF/ADMIN
// with the dashboard body; anything else refused), method 405 with Allow, body 413, invalid JSON 400, decide()
// errors mapped to HTTP; signed partner file links (sign/verify, expiry window, key patterns, partner order
// required, attachment headers). Also one request through OpsApi.handle to prove the route is registered.

import { createHmac, hkdfSync } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { isDecisionResult } from '../../../shared/src/agent-api';
import type { OpsCall, Principal } from '../../../shared/src/http/rpc';
import { request } from '../../src/agents/approval';
import { testCard } from '../../src/agents/cards/test';
import { sha256hex } from '../../src/agents/ids';
import { openRun } from '../../src/agents/runs';
import type { OpsEnv, OpsHono } from '../../src/env';
import { OpsApi } from '../../src/index';
import { AGENT_ROUTE, createAgentHandler, fileLinkSignature, signedFileUrl, verifyFileLink } from '../../src/routes/agent';
import { agentBindings, agentPorts, type AgentTestPorts } from '../helpers/agent-env';
import { invoke, opsCall, opsEnv, STAFF } from '../helpers/ops';

const SECRET = 'approval-test-value';
const ORDER = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
const RFQ = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const JOB = '8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e';
const RELAY: Principal = { class: 'MACHINE', machine: 'telegram' };
const ADMIN: Principal = { class: 'ADMIN', uid: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', roles: ['admin'] };

function app(ports: AgentTestPorts, principal: Principal, action: string) {
  const a = new Hono<OpsHono>();
  a.use('*', async (c, next) => {
    c.set('call', opsCall({ endpoint: 'agent', functionUrl: `/api/agent/${action}`, action, principal }) as OpsCall);
    await next();
  });
  a.all(AGENT_ROUTE, createAgentHandler(() => ports));
  return a;
}

function setup() {
  const env = opsEnv({ ...agentBindings(), AGENT_APPROVAL_SECRET: SECRET });
  const ports = agentPorts();
  return { env, ports };
}

async function testRun(env: OpsEnv, ports: AgentTestPorts) {
  const run = await openRun(ports.db, { agent: 'eval', trigger: 'manual', idempotency_key: `t-${Math.random()}` });
  const { token } = await request(env, ports, { run_id: run.run_id, card: testCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN }) });
  return { runId: run.run_id, token, hash: await sha256hex(token) };
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('decision', () => {
  it('relay principal + relay body -> 200 DecisionResult with no-store', async () => {
    const { env, ports } = setup();
    const t = await testRun(env, ports);
    const res = await app(ports, RELAY, 'decision').request('https://www.micronshub.eu/api/agent/decision', post({ v: 1, token: t.token, code: 'dis', tg: { user_id: 42, chat_id: 42, message_id: 1 } }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = await res.json();
    expect(isDecisionResult(body)).toBe(true);
    expect(body).toMatchObject({ run_id: t.runId, verb: 'dismiss', outcome: 'dismissed' });
    expect(ports.db.rows('agent_runs', ['id', 'eq', t.runId])[0].human_action).toMatchObject({ channel: 'telegram', actor: 'telegram:42' });
  });

  it('staff principal + dashboard body -> 200 as user:<uid>; a repeat answers 409 already_decided', async () => {
    const { env, ports } = setup();
    const t = await testRun(env, ports);
    const body = { v: 1, run_id: t.runId, token_sha256: t.hash, verb: 'dismiss' };
    const first = await app(ports, ADMIN, 'decision').request('https://x/api/agent/decision', post(body), env);
    expect(first.status).toBe(200);
    expect(ports.db.rows('agent_runs', ['id', 'eq', t.runId])[0].human_action).toMatchObject({ channel: 'dashboard', actor: `user:${ADMIN.uid}` });
    const again = await app(ports, ADMIN, 'decision').request('https://x/api/agent/decision', post(body), env);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already_decided' });
  });

  it('wrong body for the principal -> 400; other principals -> 403', async () => {
    const { env, ports } = setup();
    const t = await testRun(env, ports);
    const relayBody = { v: 1, token: t.token, code: 'dis', tg: { user_id: 1, chat_id: 1, message_id: 1 } };
    const dashBody = { v: 1, run_id: t.runId, token_sha256: t.hash, verb: 'dismiss' };
    expect((await app(ports, STAFF, 'decision').request('https://x/api/agent/decision', post(relayBody), env)).status).toBe(400);
    expect((await app(ports, RELAY, 'decision').request('https://x/api/agent/decision', post(dashBody), env)).status).toBe(400);
    expect((await app(ports, { class: 'CUSTOMER', uid: ADMIN.uid }, 'decision').request('https://x/api/agent/decision', post(dashBody), env)).status).toBe(403);
    expect((await app(ports, { class: 'MACHINE', machine: 'mcp' }, 'decision').request('https://x/api/agent/decision', post(dashBody), env)).status).toBe(403);
    expect((await app(ports, { class: 'STAFF', roles: ['sales_rep'] }, 'decision').request('https://x/api/agent/decision', post(dashBody), env)).status).toBe(403);
    expect(ports.db.rows('agent_runs', ['id', 'eq', t.runId])[0].status).toBe('waiting_human');
  });

  it('decide() errors map to 404 / 422; invalid JSON 400; body over 64 KiB 413; GET 405 with Allow', async () => {
    const { env, ports } = setup();
    const t = await testRun(env, ports);
    const other = '9a9b9c9d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
    const notFound = await app(ports, ADMIN, 'decision').request('https://x/api/agent/decision', post({ v: 1, run_id: other, token_sha256: t.hash, verb: 'dismiss' }), env);
    expect([notFound.status, await notFound.json()]).toEqual([404, { error: 'not_found' }]);
    const notAllowed = await app(ports, ADMIN, 'decision').request('https://x/api/agent/decision', post({ v: 1, run_id: t.runId, token_sha256: t.hash, verb: 'approve' }), env);
    expect([notAllowed.status, await notAllowed.json()]).toEqual([422, { error: 'verb_not_allowed' }]);
    expect((await app(ports, ADMIN, 'decision').request('https://x/api/agent/decision', post('{"v":1,'), env)).status).toBe(400);
    const big = await app(ports, ADMIN, 'decision').request('https://x/api/agent/decision', post({ v: 1, note: 'x'.repeat(70_000) }), env);
    expect([big.status, await big.json()]).toEqual([413, { error: 'payload_too_large' }]);
    const get = await app(ports, ADMIN, 'decision').request('https://x/api/agent/decision', { method: 'GET' }, env);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await app(ports, ADMIN, 'nope').request('https://x/api/agent/nope', { method: 'GET' }, env)).status).toBe(404);
  });

  it('the route is registered in the ops app (through OpsApi.handle)', async () => {
    const env = opsEnv({ ...agentBindings() });
    const res = await invoke(OpsApi, opsCall({ endpoint: 'agent', functionUrl: '/api/agent/decision', action: 'decision', principal: ADMIN }), { method: 'GET', env });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });
});

describe('signed partner file links', () => {
  const now = new Date('2026-10-05T09:00:00Z');
  const key = `orders/${ORDER}/traveler.pdf`;

  it('sign and verify; expiry in the future and at most 7 days ahead; key patterns only', async () => {
    const url = await signedFileUrl({ AGENT_APPROVAL_SECRET: SECRET, SITE_ORIGIN: 'https://www.micronshub.eu' }, key, new Date(now.getTime() + 3 * 86_400_000), now);
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://www.micronshub.eu/api/agent/file?')).toBe(true);
    expect(q.get('k')).toBe(key);
    expect(q.get('sig')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyFileLink(SECRET, key, q.get('exp') as string, q.get('sig') as string, now)).toBe(true);
    expect(await verifyFileLink('other-secret', key, q.get('exp') as string, q.get('sig') as string, now)).toBe(false);
    expect(await verifyFileLink(SECRET, `orders/${ORDER}/other.pdf`, q.get('exp') as string, q.get('sig') as string, now)).toBe(false);
    expect(await verifyFileLink(SECRET, key, q.get('exp') as string, q.get('sig') as string, new Date(now.getTime() + 4 * 86_400_000))).toBe(false);
    const far = Math.floor(now.getTime() / 1000) + 8 * 86_400;
    expect(await verifyFileLink(SECRET, key, String(far), await fileLinkSignature(SECRET, key, far), now)).toBe(false);
    await expect(signedFileUrl({ AGENT_APPROVAL_SECRET: SECRET, SITE_ORIGIN: 'https://x' }, 'email/x/raw.eml', new Date(now.getTime() + 1000), now)).rejects.toThrow();
    await expect(signedFileUrl({ AGENT_APPROVAL_SECRET: SECRET, SITE_ORIGIN: 'https://x' }, key, new Date(now.getTime() + 8 * 86_400_000), now)).rejects.toThrow(/7 days/);
  });

  it('derivation equals an independent HKDF-SHA256 (empty salt, info microns-file-link-v1, 32 bytes) + HMAC-SHA256 base64url', async () => {
    const k = 'orders/00000000-0000-0000-0000-000000000000/traveler.pdf';
    const exp = 1790000000;
    const derived = Buffer.from(hkdfSync('sha256', 'vector-secret', Buffer.alloc(0), 'microns-file-link-v1', 32));
    const expected = createHmac('sha256', derived).update(`${k}|${exp}`).digest('base64url');
    expect(await fileLinkSignature('vector-secret', k, exp)).toBe(expected);
    expect(await fileLinkSignature('vector-secret', k, exp + 1)).not.toBe(expected);
  });

  it('a valid link to a partner order streams the object as an attachment; anything else answers 403 without detail', async () => {
    const { env, ports } = setup();
    ports.clock.set(now);
    ports.db.seed('orders', [{ id: ORDER, partner_id: '5a5b5c5d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', rfq_id: RFQ }]);
    await ports.bucket.put(key, 'PDF-BYTES', { httpMetadata: { contentType: 'application/pdf' } });
    const exp = Math.floor(now.getTime() / 1000) + 3600;
    const sig = await fileLinkSignature(SECRET, key, exp);
    const fileApp = app(ports, { class: 'ANON' }, 'file');
    const ok = await fileApp.request(`https://x/api/agent/file?k=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`, { method: 'GET' }, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toBe('attachment; filename="traveler.pdf"');
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('x-robots-tag')).toBe('noindex');
    expect(await ok.text()).toBe('PDF-BYTES');

    const bad = await fileApp.request(`https://x/api/agent/file?k=${encodeURIComponent(key)}&exp=${exp}&sig=${sig.slice(0, -2)}AA`, { method: 'GET' }, env);
    expect([bad.status, await bad.json()]).toEqual([403, { error: 'forbidden' }]);

    // A CAD drawing of an RFQ that has no order yet (the object exists).
    const cadKey = `cad/${JOB}/output/drawing.pdf`;
    ports.db.seed('cad_jobs', [{ id: JOB, rfq_id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', idempotency_key: 'k', job_type: 'drawing_pdf', input_r2_key: 'rfq/x', input_sha256: 'a'.repeat(64) }]);
    await ports.bucket.put(cadKey, 'DRAWING', { httpMetadata: { contentType: 'application/pdf' } });
    const cadSig = await fileLinkSignature(SECRET, cadKey, exp);
    expect((await fileApp.request(`https://x/api/agent/file?k=${encodeURIComponent(cadKey)}&exp=${exp}&sig=${cadSig}`, { method: 'GET' }, env)).status).toBe(403);

    const noSecret = { ...env, AGENT_APPROVAL_SECRET: undefined };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await fileApp.request(`https://x/api/agent/file?k=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`, { method: 'GET' }, noSecret)).status).toBe(403);
    errors.mockRestore();
  });

  it('a signed CAD file link answers only once an order of the job\'s RFQ has a production partner', async () => {
    const { env, ports } = setup();
    ports.clock.set(now);
    const CAD_RFQ = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const CAD_ORDER = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
    const cadKey = `cad/${JOB}/output/flat.dxf`;
    ports.db.seed('cad_jobs', [{ id: JOB, rfq_id: CAD_RFQ, idempotency_key: 'k', job_type: 'flat_dxf', input_r2_key: 'rfq/x', input_sha256: 'a'.repeat(64) }]);
    ports.db.seed('orders', [{ id: CAD_ORDER, rfq_id: CAD_RFQ, partner_id: null }]);
    await ports.bucket.put(cadKey, 'DXF-BYTES', { httpMetadata: { contentType: 'application/dxf' } });
    const exp = Math.floor(now.getTime() / 1000) + 3600;
    const url = `https://x/api/agent/file?k=${encodeURIComponent(cadKey)}&exp=${exp}&sig=${await fileLinkSignature(SECRET, cadKey, exp)}`;
    const fileApp = app(ports, { class: 'ANON' }, 'file');
    const refused = await fileApp.request(url, { method: 'GET' }, env);
    expect([refused.status, await refused.json()]).toEqual([403, { error: 'forbidden' }]);
    // A second order of the same RFQ that has a production partner.
    ports.db.seed('orders', [{ id: '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f', rfq_id: CAD_RFQ, partner_id: '5a5b5c5d-1e2f-4a3b-8c4d-5e6f7a8b9c0d' }]);
    const ok = await fileApp.request(url, { method: 'GET' }, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toBe('attachment; filename="flat.dxf"');
    expect(await ok.text()).toBe('DXF-BYTES');
  });

  it('a signed traveller link answers only when its order has a production partner', async () => {
    const { env, ports } = setup();
    ports.clock.set(now);
    const PARTNER_ORDER = '4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a';
    ports.db.seed('orders', [
      { id: ORDER, rfq_id: RFQ, partner_id: null },
      { id: PARTNER_ORDER, rfq_id: RFQ, partner_id: '5a5b5c5d-1e2f-4a3b-8c4d-5e6f7a8b9c0d' },
    ]);
    const partnerKey = `orders/${PARTNER_ORDER}/traveler.pdf`;
    await ports.bucket.put(key, 'PDF-BYTES', { httpMetadata: { contentType: 'application/pdf' } });
    await ports.bucket.put(partnerKey, 'PDF-BYTES', { httpMetadata: { contentType: 'application/pdf' } });
    const exp = Math.floor(now.getTime() / 1000) + 3600;
    const link = async (k: string) => `https://x/api/agent/file?k=${encodeURIComponent(k)}&exp=${exp}&sig=${await fileLinkSignature(SECRET, k, exp)}`;
    const fileApp = app(ports, { class: 'ANON' }, 'file');
    const refused = await fileApp.request(await link(key), { method: 'GET' }, env);
    expect([refused.status, await refused.json()]).toEqual([403, { error: 'forbidden' }]);
    expect((await fileApp.request(await link(partnerKey), { method: 'GET' }, env)).status).toBe(200);
  });

  it('a link signed for a key outside the partner file patterns answers 403, even for a partner order whose object exists', async () => {
    const { env, ports } = setup();
    ports.clock.set(now);
    ports.db.seed('orders', [{ id: ORDER, rfq_id: RFQ, partner_id: '5a5b5c5d-1e2f-4a3b-8c4d-5e6f7a8b9c0d' }]);
    ports.db.seed('cad_jobs', [{ id: JOB, rfq_id: RFQ, idempotency_key: 'k', job_type: 'analyse', input_r2_key: 'rfq/x', input_sha256: 'a'.repeat(64) }]);
    const exp = Math.floor(now.getTime() / 1000) + 3600;
    const fileApp = app(ports, { class: 'ANON' }, 'file');
    const outside = [
      `orders/${ORDER}/other.pdf`,
      `orders/${ORDER}/traveler.pdf.bak`,
      `cad/${JOB}/output/result.json`,
      `cad/${JOB}/output/log.txt`,
      `quotes/${RFQ}/v1/quote.pdf`,
    ];
    for (const k of outside) {
      await ports.bucket.put(k, 'BYTES', { httpMetadata: { contentType: 'application/octet-stream' } });
      const res = await fileApp.request(`https://x/api/agent/file?k=${encodeURIComponent(k)}&exp=${exp}&sig=${await fileLinkSignature(SECRET, k, exp)}`, { method: 'GET' }, env);
      expect([k, res.status, await res.json()]).toEqual([k, 403, { error: 'forbidden' }]);
    }
    // The same order's traveller answers, so the refusals above come from the key rule.
    await ports.bucket.put(key, 'PDF-BYTES', { httpMetadata: { contentType: 'application/pdf' } });
    expect((await fileApp.request(`https://x/api/agent/file?k=${encodeURIComponent(key)}&exp=${exp}&sig=${await fileLinkSignature(SECRET, key, exp)}`, { method: 'GET' }, env)).status).toBe(200);
  });

  it('without sig, a non-staff principal answers 403 (staff previews go to the admin handler)', async () => {
    const { env, ports } = setup();
    expect((await app(ports, { class: 'CUSTOMER', uid: ADMIN.uid }, 'file').request('https://x/api/agent/file?k=x', { method: 'GET' }, env)).status).toBe(403);
  });
});
