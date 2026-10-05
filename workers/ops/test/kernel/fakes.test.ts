// Self-tests of the T1 fakes every unit builds on: FakeStep (cache by name and occurrence, retries on a virtual
// clock, NonRetryableError, buffered events, timeouts, crashAt + replay), FakeDurableObjectState (sql.exec over
// node:sqlite, alarms, storage), fakeNamespace, MemoryDb (filters, order, on_conflict, CHECK constraints from the
// migration, rpc dispatch), recorders and the secret log guard.

import { NonRetryableError } from 'cloudflare:workflows';
import { describe, expect, it } from 'vitest';
import { DbError } from '../../src/db/postgrest';
import { FakeKV, FakeQueue, FakeWorkflow, agentBindings } from '../helpers/agent-env';
import { FakeDurableObjectState, fakeNamespace } from '../helpers/fake-do';
import { FakeStep, durationMs } from '../helpers/fake-step';
import { MemoryDb } from '../helpers/memory-db';
import { RecordingLogger, RecordingMailer, assertNoSecretsLogged } from '../helpers/recorders';

describe('FakeStep', () => {
  it('caches results by (name, occurrence); a replay returns cached results without running callbacks', async () => {
    const step = new FakeStep();
    let runs = 0;
    const flow = async (s: FakeStep) => {
      const a = await s.do('copy', async () => ({ n: ++runs }));
      const b = await s.do('copy', async () => ({ n: ++runs }));
      return [a, b];
    };
    expect(await flow(step)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await flow(step.replay())).toEqual([{ n: 1 }, { n: 2 }]);
    expect(runs).toBe(2);
  });

  it('retries with exponential delays on the virtual clock and honours NonRetryableError', async () => {
    const step = new FakeStep({ now: 0 });
    let attempts = 0;
    const value = await step.do('flaky', { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } }, async () => {
      if (++attempts < 3) throw new Error('transient');
      return 'ok';
    });
    expect([value, attempts, step.now]).toEqual(['ok', 3, 10_000 + 20_000]);
    let fatal = 0;
    await expect(step.do('fatal', { retries: { limit: 5, delay: 1 } }, async () => {
      fatal++;
      throw new NonRetryableError('schema');
    })).rejects.toThrow('schema');
    expect(fatal).toBe(1);
    await expect(step.do('always', { retries: { limit: 2, delay: 1, backoff: 'constant' } }, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(step.calls.at(-1)).toMatchObject({ name: 'always', attempts: 3, outcome: 'threw' });
  });

  it('waitForEvent: buffered events, timeout error text of the local runtime, cached on replay', async () => {
    const step = new FakeStep({ now: 0 });
    step.sendEvent('quote-approved', { verb: 'approve' });
    expect((await step.waitForEvent('wait', { type: 'quote-approved', timeout: '1 hour' })).payload).toEqual({ verb: 'approve' });
    await expect(step.waitForEvent('wait-2', { type: 'quote-approved', timeout: '1 minute' })).rejects.toThrow('Execution timed out after 60000ms');
    expect(step.now).toBe(60_000);
    expect((await step.replay().waitForEvent('wait', { type: 'quote-approved' })).payload).toEqual({ verb: 'approve' });
    await step.sleep('nap', '2 days');
    expect(step.now).toBe(60_000 + 2 * 86_400_000);
    expect(durationMs('7 days', 0)).toBe(604_800_000);
    expect(() => durationMs('soon' as never, 0)).toThrow();
  });

  it('crashAt throws once before the callback; the replay then runs it', async () => {
    const step = new FakeStep();
    let ran = 0;
    step.crashAt('send');
    await expect(step.do('send', async () => ++ran)).rejects.toThrow(/crash at send/);
    expect(ran).toBe(0);
    expect(await step.replay().do('send', async () => ++ran)).toBe(1);
  });
});

describe('FakeDurableObjectState', () => {
  it('sql.exec over node:sqlite: DDL script, bindings, one(), rowsWritten, booleans as 1/0', () => {
    const state = new FakeDurableObjectState('rfq-1');
    state.storage.sql.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY, final INTEGER); CREATE TABLE x (a TEXT);');
    expect(state.storage.sql.exec('INSERT INTO jobs VALUES (?, ?) ON CONFLICT DO NOTHING', 'j1', false).rowsWritten).toBe(1);
    expect(state.storage.sql.exec('INSERT INTO jobs VALUES (?, ?) ON CONFLICT DO NOTHING', 'j1', true).rowsWritten).toBe(0);
    expect(state.storage.sql.exec('SELECT id, final FROM jobs').one()).toEqual({ id: 'j1', final: 0 });
    expect(() => state.storage.sql.exec('SELECT id FROM jobs WHERE id = ?', 'none').one()).toThrow(/exactly one/);
    expect(state.id.name).toBe('rfq-1');
  });

  it('alarms run on the owner; one instance per name in a namespace', async () => {
    class Thing {
      alarms = 0;
      constructor(readonly state: FakeDurableObjectState) {}
      async alarm() {
        this.alarms++;
      }
    }
    const ns = fakeNamespace((s) => new Thing(s));
    const a = ns.get(ns.idFromName('global')) as unknown as Thing;
    expect(ns.get(ns.idFromName('global'))).toBe(a);
    expect(ns.instance('other')).not.toBe(a);
    await a.state.storage.setAlarm(Date.now() + 1000);
    expect(await a.state.storage.getAlarm()).toEqual(expect.any(Number));
    await a.state.runAlarm();
    await a.state.runAlarm();
    expect(a.alarms).toBe(1);
    await a.state.storage.put('k', { v: 1 });
    expect(await a.state.storage.get('k')).toEqual({ v: 1 });
  });
});

describe('MemoryDb', () => {
  it('filters, order (nulls last), limit and column projection', async () => {
    const db = new MemoryDb();
    db.seed('agent_runs', [
      { agent: 'quote', trigger: 'cron', idempotency_key: 'a', started_at: '2026-10-05T01:00:00Z', parked_reason: null },
      { agent: 'quote', trigger: 'cron', idempotency_key: 'b', started_at: '2026-10-05T03:00:00Z' },
      { agent: 'cad', trigger: 'queue', idempotency_key: 'c', started_at: '2026-10-04T23:00:00Z' },
    ]);
    const rows = await db.select('agent_runs', { columns: 'idempotency_key', filters: [['agent', 'in', ['quote', 'cad']], ['started_at', 'gte', '2026-10-05T00:00:00.000Z']], order: [{ column: 'started_at', ascending: false }], limit: 5 });
    expect(rows).toEqual([{ idempotency_key: 'b' }, { idempotency_key: 'a' }]);
    expect((await db.select('agent_runs', { filters: [['parked_reason', 'is', null]] })).length).toBe(3);
    expect(await db.select('agent_runs', { filters: [['idempotency_key', 'ilike', 'A']], columns: 'agent' })).toEqual([{ agent: 'quote' }]);
    expect(await db.select('agent_runs', { filters: [['idempotency_key', 'ilike', 'a*']] })).toEqual([]);
  });

  it('insert enforces the migration CHECKs and unique keys; on_conflict ignore vs merge', async () => {
    const db = new MemoryDb();
    await expect(db.insert('agent_runs', { agent: 'Bad Agent', trigger: 'cron', idempotency_key: 'x' })).rejects.toMatchObject({ status: 400, code: '23514' });
    // A token only on a waiting run (agent_runs_token_check).
    await expect(db.insert('agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'x', approval_token_sha256: 'a'.repeat(64) })).rejects.toMatchObject({ code: '23514' });
    await expect(db.insert('agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'x' })).resolves.toEqual([]);
    await expect(db.insert('agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'x' })).rejects.toBeInstanceOf(DbError);
    const ignored = await db.insert('agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'x' }, { onConflict: ['agent', 'idempotency_key'], returning: true });
    expect(ignored).toEqual([]);
    const merged = await db.insert('agent_runs', { agent: 'quote', trigger: 'manual', idempotency_key: 'x' }, { onConflict: ['agent', 'idempotency_key'], ignoreDuplicates: false, returning: 'trigger' });
    expect(merged).toEqual([{ trigger: 'manual' }]);
    await expect(db.update('agent_runs', { status: 'succeeded' }, { filters: [['idempotency_key', 'eq', 'x']] })).rejects.toMatchObject({ code: '23514' });
    expect(db.rows('agent_runs')).toHaveLength(1);
  });

  it('rpc dispatches to the RPCs of memory-rpc.ts; unknown names answer PGRST202', async () => {
    const db = new MemoryDb();
    const begun = await db.rpc<Array<{ created: boolean }>>('agent_run_begin', { p_agent: 'eval', p_trigger: 'manual', p_idempotency_key: 'e1', p_fields: {} });
    expect(begun[0].created).toBe(true);
    await expect(db.rpc('nope', {})).rejects.toMatchObject({ code: 'PGRST202' });
  });
});

describe('binding fakes and recorders', () => {
  it('agentBindings fills every Phase 4 binding and var', async () => {
    const b = agentBindings();
    expect(b.FLAGS).toBeInstanceOf(FakeKV);
    expect(b.AGENT_EVENTS).toBeInstanceOf(FakeQueue);
    expect(b.QUOTE).toBeInstanceOf(FakeWorkflow);
    expect(b.AGENT_TENANT_ID).toBe('00000000-0000-0000-0000-000000000001');
    const wf = b.RFQ_INTAKE as unknown as FakeWorkflow;
    await wf.create({ id: 'rfq-intake-x', params: { v: 1 } });
    await expect(wf.create({ id: 'rfq-intake-x' })).rejects.toThrow(/instance\.already_exists/);
    await (b.RFQ_THREAD as unknown as { getByName(n: string): { expectCadJobs(ids: string[]): Promise<void> } }).getByName('rfq-1').expectCadJobs(['j1']);
    expect((b.RFQ_THREAD as unknown as { calls: unknown[] }).calls).toEqual([{ name: 'rfq-1', method: 'expectCadJobs', args: [['j1']] }]);
  });

  it('RecordingMailer honours the idempotency key; the log guard finds secrets and addresses', async () => {
    const mailer = new RecordingMailer();
    const mail = { from: 'a', to: ['b'], subject: 's', text: 't', idempotency_key: 'quote/1/send' };
    const first = await mailer.send(mail);
    expect(await mailer.send(mail)).toEqual(first);
    expect(mailer.sent).toHaveLength(1);
    const logger = new RecordingLogger();
    const restore = logger.start();
    console.log('[microns-ops] decision run_id=1');
    restore();
    expect(() => assertNoSecretsLogged(logger.lines, ['TOKENVALUE'])).not.toThrow();
    expect(() => assertNoSecretsLogged(['x TOKENVALUE y'], ['TOKENVALUE'])).toThrow(/secret/);
    expect(() => assertNoSecretsLogged(['to buyer@example.de'], [])).toThrow(/e-mail address/);
  });
});
