// T2 profile 'agents' (npm run test:integration:agents), kernel: real workerd with site (primary), ops and mail
// started by the harness, which already refused to start unless every Phase 4 secret name reached each Worker's
// env (wrangler's binding tables). Checks:
//   - the Local Explorer lists the three Workers;
//   - the Local Explorer scheduled route with cron '* * * * *' reaches microns-ops as a secondary Worker and runs
//     flagsSyncTick against the mini-PostgREST (every seeded flag row mirrored, one 'flags' run recorded);
//   - through the site: GET /api/agent/status with a staff JWT answers {v: 1, ok: true}; an admin 'test_card' start
//     sends one Telegram card with ap: buttons; a relay-signed decision 'dis' closes the run 'succeeded' and edits
//     the card. These three need the site's /api/agent/* rows and the ops admin handlers (unit W): until both are
//     present the block is skipped with that reason.
// The stub client (workers/site/test/integration/stub-client.ts) is loaded at run time by file URL.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

interface StubRoute { method: string; path: string; status: number; headers?: Record<string, string>; body?: unknown }
interface StubClient {
  stubRoute(route: StubRoute): Promise<void>;
  mintSupabaseJwt(claims: { sub: string; email?: string; exp?: number }): Promise<string>;
}

const SITE = process.env.T2_SITE_URL ?? '';
const STUB = process.env.T2_STUB_URL ?? '';
const EXPLORER = process.env.T2_EXPLORER_URL ?? '';
const SECRET = process.env.T2_APPROVAL_SECRET ?? '';
const ADMIN_UID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
/** Unit W's code is present: the site resolves /api/agent/ and the ops admin handlers are implemented. */
const W_PRESENT = source('../../../site/src/api/resolve.ts').includes('/api/agent/') && !source('../../src/routes/agent-admin.ts').includes('not implemented: W');

async function loadStubClient(): Promise<StubClient> {
  const specifier = new URL('../../../site/test/integration/stub-client.ts', import.meta.url).href;
  return (await import(/* @vite-ignore */ specifier)) as StubClient;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`not JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function stubGet<T>(path: string): Promise<T> {
  return json<T>(await fetch(`${STUB}${path}`));
}

async function stubPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${STUB}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`stub ${path}: ${res.status} ${await res.text()}`);
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  let last = await read();
  while (!done(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    last = await read();
  }
  return last;
}

describe('harness (profile agents)', () => {
  it('publishes the site, stub and Local Explorer URLs and the run secret', () => {
    expect(process.env.T2_PROFILE).toBe('agents');
    expect(SITE).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(EXPLORER).toBe(`${SITE}/cdn-cgi/local/explorer/api`);
    expect(SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the Local Explorer lists microns-site, microns-ops and microns-mail', async () => {
    const res = await fetch(`${EXPLORER}/local/workers`);
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const name of ['microns-site', 'microns-ops', 'microns-mail']) expect(text).toContain(name);
  });
});

describe('cron through the Local Explorer', () => {
  it("'* * * * *' reaches microns-ops and runs flagsSyncTick: every seeded flag mirrored, one flags run", async () => {
    await stubPost('/__stub/seed', { flags: 'migration', replace: true });
    const before = await stubGet<Array<Record<string, unknown>>>('/__stub/rows/feature_flags');
    expect(before).toHaveLength(13);
    expect(before.every((r) => r.kv_synced_rev === null || r.kv_synced_rev === undefined)).toBe(true);
    const res = await fetch(`${EXPLORER}/local/scheduled?worker=microns-ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cron: '* * * * *' }) });
    expect(res.status).toBeLessThan(300);
    await res.arrayBuffer();
    const rows = await until(
      () => stubGet<Array<Record<string, unknown>>>('/__stub/rows/feature_flags'),
      (r) => r.every((x) => x.kv_synced_rev === x.rev),
    );
    expect(rows.every((x) => x.kv_synced_rev === x.rev)).toBe(true);
    const runs = await until(
      () => stubGet<Array<Record<string, unknown>>>('/__stub/rows/agent_runs'),
      (r) => r.some((x) => x.agent === 'flags' && x.status !== 'running'),
    );
    expect(runs.filter((x) => x.agent === 'flags')).toEqual([expect.objectContaining({ agent: 'flags', trigger: 'cron', status: 'succeeded' })]);
  });
});

describe.skipIf(!W_PRESENT)('/api/agent/* through the site (needs unit W: site rows and ops admin handlers)', () => {
  let stub: StubClient;
  let jwt: string;

  beforeAll(async () => {
    stub = await loadStubClient();
    jwt = await stub.mintSupabaseJwt({ sub: ADMIN_UID, email: 't2-admin@example.test' });
    await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: ADMIN_UID, email: 't2-admin@example.test' } });
    await stub.stubRoute({ method: 'GET', path: '^/rest/v1/user_roles', status: 200, body: [{ role: 'admin' }] });
  });

  it('GET /api/agent/status with a staff JWT -> {v: 1, ok: true}', async () => {
    const res = await fetch(`${SITE}/api/agent/status`, { headers: { authorization: `Bearer ${jwt}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toMatchObject({ v: 1, ok: true, principal: 'ADMIN' });
  });

  it('test_card start -> one Telegram card with ap: buttons; relay-signed dis -> run succeeded and card edited', async () => {
    const callsBefore = (await stubGet<Array<{ method: string }>>('/__stub/telegram/calls')).length;
    const start = await fetch(`${SITE}/api/agent/start`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, kind: 'test_card' }) });
    expect(start.status).toBe(200);
    expect(await json(start)).toMatchObject({ v: 1, ok: true, created: true });

    const sent = await until(
      () => stubGet<Array<{ method: string; body: { reply_markup?: { inline_keyboard: Array<Array<{ callback_data?: string }>> } } }>>('/__stub/telegram/calls'),
      (c) => c.length > callsBefore,
    );
    const card = sent.slice(callsBefore).filter((c) => c.method === 'sendMessage');
    expect(card).toHaveLength(1);
    const data = card[0].body.reply_markup?.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean) as string[];
    expect(data).toHaveLength(1);
    const match = /^ap:([A-Z2-7]{26}):dis$/.exec(data[0]);
    expect(match).not.toBeNull();

    const body = JSON.stringify({ v: 1, token: (match as RegExpExecArray)[1], code: 'dis', tg: { user_id: 4242, chat_id: 4242, message_id: 1000 } });
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
    const decision = await fetch(`${SITE}/api/agent/decision`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-microns-timestamp': ts, 'x-microns-signature': signature }, body });
    expect(decision.status).toBe(200);
    expect(await json(decision)).toMatchObject({ v: 1, ok: true, verb: 'dismiss', outcome: 'dismissed' });

    const runs = await stubGet<Array<Record<string, unknown>>>('/__stub/rows/agent_runs');
    const testRun = runs.find((r) => String(r.idempotency_key).startsWith('test-card:'));
    expect(testRun).toMatchObject({ status: 'succeeded', approval_token_sha256: null, human_action: expect.objectContaining({ channel: 'telegram', actor: 'telegram:4242' }) });
    const calls = await stubGet<Array<{ method: string }>>('/__stub/telegram/calls');
    expect(calls.slice(callsBefore).map((c) => c.method)).toContain('editMessageText');
  });
});
