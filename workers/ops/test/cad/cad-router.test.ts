// CadRouter (D-2) with the SQLite-backed fake Durable Object state: slot accounting (vps 1, inline 1, container 3),
// one lease per job, expiry and alarm(), backend health (down after two failures, back after 5 minutes).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CadRouter, DOWN_FOR_MS, LEASE_GRACE_S, RETRY_AFTER_S } from '../../src/do/cad-router';
import type { OpsEnv } from '../../src/env';
import { fakeNamespace } from '../helpers/fake-do';

const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);

function router() {
  const ns = fakeNamespace((state) => new CadRouter(state as unknown as DurableObjectState, {} as OpsEnv));
  return { r: ns.instance('global'), state: ns.state('global') };
}

describe('CadRouter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the vps never holds more than one lease; a busy backend answers retry_after_s', async () => {
    const { r } = router();
    const a = await r.acquire({ job_id: 'job-a', backend_candidates: ['vps'], deadline_s: 300 });
    const b = await r.acquire({ job_id: 'job-b', backend_candidates: ['vps'], deadline_s: 300 });
    expect(a).toMatchObject({ granted: true, backend: 'vps' });
    expect(b).toEqual({ granted: false, retry_after_s: RETRY_AFTER_S });
    if (!a.granted) throw new Error('no lease');
    await r.release(a.lease_id, { ok: true });
    expect(await r.acquire({ job_id: 'job-b', backend_candidates: ['vps'], deadline_s: 300 })).toMatchObject({ granted: true, backend: 'vps' });
  });

  it('never grants two inline leases at once; a second inline job falls to the next candidate', async () => {
    const { r } = router();
    const first = await r.acquire({ job_id: 'j1', backend_candidates: ['inline'], deadline_s: 300 });
    expect(first).toMatchObject({ granted: true, backend: 'inline' });
    expect(await r.acquire({ job_id: 'j2', backend_candidates: ['inline'], deadline_s: 300 })).toMatchObject({ granted: false });
    expect(await r.acquire({ job_id: 'j3', backend_candidates: ['inline', 'vps'], deadline_s: 300 })).toMatchObject({ granted: true, backend: 'vps' });
    const snap = await r.snapshot();
    expect(snap.slots.inline).toEqual({ max: 1, used: 1 });
    expect(snap.slots.vps).toEqual({ max: 1, used: 1 });
  });

  it('container has three slots', async () => {
    const { r } = router();
    for (const id of ['c1', 'c2', 'c3']) expect(await r.acquire({ job_id: id, backend_candidates: ['container'], deadline_s: 60 })).toMatchObject({ granted: true });
    expect(await r.acquire({ job_id: 'c4', backend_candidates: ['container'], deadline_s: 60 })).toMatchObject({ granted: false });
  });

  it('a job that already holds a lease gets the same lease back (redelivery)', async () => {
    const { r } = router();
    const a = await r.acquire({ job_id: 'job-a', backend_candidates: ['vps'], deadline_s: 300 });
    const again = await r.acquire({ job_id: 'job-a', backend_candidates: ['vps', 'inline'], deadline_s: 300 });
    expect(again).toEqual(a);
    expect((await r.snapshot()).leases).toHaveLength(1);
  });

  it('expired leases are reclaimed by alarm() and by acquire(); the alarm follows the earliest expiry', async () => {
    const { r, state } = router();
    await r.acquire({ job_id: 'job-a', backend_candidates: ['vps'], deadline_s: 100 });
    expect(await state.storage.getAlarm()).toBe(T0 + (100 + LEASE_GRACE_S) * 1000);
    vi.setSystemTime(T0 + (100 + LEASE_GRACE_S) * 1000 + 1);
    await state.runAlarm();
    expect((await r.snapshot()).leases).toEqual([]);
    expect(await state.storage.getAlarm()).toBeNull();
    // reclaim on acquire, without an alarm run
    await r.acquire({ job_id: 'job-b', backend_candidates: ['vps'], deadline_s: 10 });
    vi.setSystemTime(Date.now() + (10 + LEASE_GRACE_S) * 1000 + 1);
    expect(await r.acquire({ job_id: 'job-c', backend_candidates: ['vps'], deadline_s: 10 })).toMatchObject({ granted: true, backend: 'vps' });
  });

  it('two backend_down outcomes mark the backend down for 5 minutes; then it is back', async () => {
    const { r } = router();
    for (const id of ['d1', 'd2']) {
      const lease = await r.acquire({ job_id: id, backend_candidates: ['vps'], deadline_s: 300 });
      if (!lease.granted) throw new Error('no lease');
      await r.release(lease.lease_id, { ok: false, retryable: true, backend_down: true });
    }
    expect(await r.acquire({ job_id: 'd3', backend_candidates: ['vps'], deadline_s: 300 })).toMatchObject({ granted: false });
    expect(await r.acquire({ job_id: 'd3', backend_candidates: ['vps', 'inline'], deadline_s: 300 })).toMatchObject({ granted: true, backend: 'inline' });
    expect((await r.snapshot()).health.vps?.down_until).toBe(new Date(T0 + DOWN_FOR_MS).toISOString());
    vi.setSystemTime(T0 + DOWN_FOR_MS + 1);
    expect(await r.acquire({ job_id: 'd4', backend_candidates: ['vps'], deadline_s: 300 })).toMatchObject({ granted: true, backend: 'vps' });
  });

  it('one failure is not enough; a success resets the count; probes count like outcomes', async () => {
    const { r } = router();
    const a = await r.acquire({ job_id: 'h1', backend_candidates: ['vps'], deadline_s: 300 });
    if (!a.granted) throw new Error('no lease');
    await r.release(a.lease_id, { ok: false, backend_down: true });
    const b = await r.acquire({ job_id: 'h2', backend_candidates: ['vps'], deadline_s: 300 });
    expect(b).toMatchObject({ granted: true });
    if (!b.granted) throw new Error('no lease');
    await r.release(b.lease_id, { ok: true });
    expect((await r.snapshot()).health.vps).toEqual({ failures: 0, down_until: null });
    await r.report('vps', false);
    await r.report('vps', false);
    expect(await r.acquire({ job_id: 'h3', backend_candidates: ['vps'], deadline_s: 300 })).toMatchObject({ granted: false });
    // a non-retryable job failure (bad input) is not a backend failure
    vi.setSystemTime(T0 + DOWN_FOR_MS + 1);
    const c = await r.acquire({ job_id: 'h4', backend_candidates: ['vps'], deadline_s: 300 });
    if (!c.granted) throw new Error('no lease');
    await r.release(c.lease_id, { ok: false, retryable: false });
    expect((await r.snapshot()).health.vps?.down_until).toBeNull();
  });
});
