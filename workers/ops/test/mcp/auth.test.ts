// Callers of the remote MCP: the Access assertion of the MCP application is verified again in the Worker and the
// e-mail is mapped to a staff role; anything else is refused before the MCP handler runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessKeyPair, mintAccessJwt } from '../../../shared/test/helpers/jwt';
import { authenticate, PrincipalCache, staffForEmail } from '../../src/mcp/auth';
import { handleMcp } from '../../src/mcp/index';
import { AUD, STAFF_EMAIL, STAFF_UID, TEAM, connectV1, mcpHarness, rpcRequest } from './helpers';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function status(res: Response): Promise<{ status: number; body: unknown; cache: string | null }> {
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cache: res.headers.get('cache-control') };
}

describe('X-1 caller check', () => {
  it('no assertion -> 401', async () => {
    const h = await mcpHarness();
    expect(await status(await h.call(rpcRequest()))).toEqual({ status: 401, body: { error: 'unauthorized' }, cache: 'no-store' });
  });

  it('invalid, wrong audience, wrong issuer key and expired assertions -> 401', async () => {
    const h = await mcpHarness();
    const other = await accessKeyPair('other-kid');
    const bad = [
      'not.a.jwt',
      await h.token({ aud: 'another-application-aud' }),
      await h.token({ key: other }),
      await h.token({ exp: Math.floor(Date.now() / 1000) - 60 }),
      await mintAccessJwt(h.key, { iss: 'https://other-team.example.test', aud: [AUD], email: STAFF_EMAIL }),
    ];
    for (const token of bad) expect((await h.call(rpcRequest({ token }))).status).toBe(401);
  });

  it('a service-token assertion (no e-mail) -> 401, even with a staff e-mail in other headers', async () => {
    const h = await mcpHarness();
    const token = await h.token({ email: null, commonName: 'mcp-client.access' });
    const res = await h.call(rpcRequest({ token, headers: { 'cf-access-authenticated-user-email': STAFF_EMAIL, 'x-microns-principal': 'ADMIN' } }));
    expect(await status(res)).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
  });

  it('an e-mail without a staff role -> 403; a tenant or customer role is not staff', async () => {
    const h = await mcpHarness({ roles: ['customer'] });
    expect(await status(await h.call(rpcRequest({ token: await h.token() })))).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const unknown = await mcpHarness();
    expect((await unknown.call(rpcRequest({ token: await unknown.token({ email: 'stranger@example.com' }) }))).status).toBe(403);
    const buyer = await mcpHarness();
    expect((await buyer.call(rpcRequest({ token: await buyer.token({ email: 'buyer@example.com' }) }))).status).toBe(403);
  });

  it('staff -> principal {class, uid, roles} without the e-mail; e-mail matched case-insensitively', async () => {
    const h = await mcpHarness({ roles: ['sales_rep'] });
    const outcome = await authenticate(new Headers({ 'Cf-Access-Jwt-Assertion': await h.token({ email: 'Owner@Example.COM' }) }), {
      teamDomain: TEAM, audience: AUD, db: h.ports.db, cache: new PrincipalCache(),
      fetchImpl: (async () => new Response(JSON.stringify({ keys: [h.key.publicJwk] }))) as typeof fetch,
    });
    expect(outcome).toEqual({ ok: true, principal: { class: 'STAFF', uid: STAFF_UID, roles: ['sales_rep'] } });
    expect(JSON.stringify(outcome)).not.toContain('@');
    const admin = await mcpHarness({ roles: ['admin', 'accountant'] });
    expect(await staffForEmail(admin.ports.db, STAFF_EMAIL)).toEqual({ uid: STAFF_UID, roles: ['accountant', 'admin'] });
  });

  it('a staff caller reaches the MCP handler: initialize and tools/list work, identity headers do not change the principal', async () => {
    const h = await mcpHarness({ roles: ['production_manager'] });
    const client = await connectV1(h, await h.token(), { 'x-microns-principal': 'ADMIN' });
    const tools = await client.listTools();
    expect(tools.tools.length).toBe(35);
    await client.close();
  });

  it('the lookup is cached per assertion for 60 s; the signature is checked on every request', async () => {
    const h = await mcpHarness();
    const token = await h.token();
    const rpc = vi.spyOn(h.ports.db, 'rpc');
    expect((await h.call(rpcRequest({ token }))).status).toBe(200);
    expect((await h.call(rpcRequest({ token }))).status).toBe(200);
    expect(rpc.mock.calls.filter((c) => c[0] === 'agent_staff_for_email')).toHaveLength(1);
    // A tampered token with the same payload but a broken signature is refused even after a cached success.
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect((await h.call(rpcRequest({ token: tampered }))).status).toBe(401);
  });

  it('a failing staff lookup -> 503 auth_unavailable (not cached)', async () => {
    const h = await mcpHarness();
    vi.spyOn(h.ports.db, 'rpc').mockRejectedValueOnce(new Error('db down'));
    expect(await status(await h.call(rpcRequest({ token: await h.token() })))).toMatchObject({ status: 503, body: { error: 'auth_unavailable' } });
    expect((await h.call(rpcRequest({ token: await h.token() }))).status).toBe(200);
  });

  it('missing configuration -> 500 for this request only, nothing verified', async () => {
    const h = await mcpHarness();
    for (const name of ['ACCESS_TEAM_DOMAIN', 'MCP_ACCESS_AUD', 'MCP_RATE_LIMIT', 'MCP_ROUTE'] as const) {
      const env = { ...h.env, [name]: undefined };
      const res = await handleMcp(rpcRequest({ token: await h.token() }), env, h.ctx, { deps: h.deps, principalCache: new PrincipalCache() });
      expect(res.status, name).toBe(500);
    }
    // The placeholder team domain of the committed config fails closed.
    const placeholder = await handleMcp(rpcRequest({ token: await h.token() }), { ...h.env, ACCESS_TEAM_DOMAIN: '<ACCESS_TEAM_DOMAIN>' }, h.ctx, { deps: h.deps, principalCache: new PrincipalCache() });
    expect(placeholder.status).toBe(401);
  });

  it('rate limit: key mcp:<uid>, over the limit -> 429 rate_limited', async () => {
    const keys: string[] = [];
    const h = await mcpHarness({ env: { MCP_RATE_LIMIT: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: keys.length < 2 }; } } as unknown as RateLimit } });
    const token = await h.token();
    expect((await h.call(rpcRequest({ token }))).status).toBe(200);
    expect(await status(await h.call(rpcRequest({ token })))).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(keys).toEqual([`mcp:${STAFF_UID}`, `mcp:${STAFF_UID}`]);
  });

  it('wrong Host -> 403, wrong path -> 404, a browser Origin -> 403 (after the caller check)', async () => {
    const h = await mcpHarness();
    const token = await h.token();
    expect((await h.call(rpcRequest({ token, host: 'evil.example.com' }))).status).toBe(403);
    expect((await h.call(rpcRequest({ token, path: '/other' }))).status).toBe(404);
    expect((await h.call(rpcRequest({ token, origin: 'https://evil.example' }))).status).toBe(403);
    const ok = await h.call(rpcRequest({ token }));
    expect(ok.status).toBe(200);
    expect([...ok.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
  });
});
