// CadRouter Phase 5 additions (src/do/cad-router.ts): named container slots, priorities (batch keeps one slot free
// for the compat path), recycle on release and by hand (the slot stays held until the destroy call returned), the
// snapshot's container slots, the Phase 4 accounting without CAD_SLOTS, and no active probe of the container.

import { describe, expect, it } from 'vitest';
import { ContainerBackend } from '../../../src/cad/backends/container';
import { configuredSlotCount, DEFAULT_CAD_SLOTS, slotCount, slotIndex, slotName, slotNames } from '../../../src/cad-container/slots';
import { LEASE_GRACE_S, RECYCLE_HOLD_MS, RETRY_AFTER_S } from '../../../src/do/cad-router';
import { ScriptedContainer } from '../../../src/ports/p5-stub/index';
import type { ContainerPort } from '../../../src/ports/p5';
import { TEST_KEY, TestCadRouter, testRouter } from './helpers';

const T0 = Date.UTC(2026, 9, 8, 9, 0, 0);
const C = { CAD_SLOTS: '3' };
const cand = ['container'] as const;

function at(ms: number): void {
  TestCadRouter.clock = ms;
}

describe('slot helpers', () => {
  it('names cad-0 … cad-<n-1>; CAD_SLOTS 1-20, anything else counts as not configured (3)', () => {
    expect(slotName(0)).toBe('cad-0');
    expect(slotName(2)).toBe('cad-2');
    expect(() => slotName(-1)).toThrow(RangeError);
    expect(() => slotName(1.5)).toThrow(RangeError);
    expect(slotCount({ CAD_SLOTS: '3' })).toBe(3);
    expect(slotCount({ CAD_SLOTS: ' 5 ' })).toBe(5);
    expect(slotCount({ CAD_SLOTS: '20' })).toBe(20);
    for (const bad of [undefined, '', '0', '21', '3.5', '-1', 'x', '03']) {
      expect(configuredSlotCount({ CAD_SLOTS: bad }), String(bad)).toBeNull();
      expect(slotCount({ CAD_SLOTS: bad }), String(bad)).toBe(DEFAULT_CAD_SLOTS);
    }
    expect(slotNames(C)).toEqual(['cad-0', 'cad-1', 'cad-2']);
    expect(slotIndex('cad-2', C)).toBe(2);
    expect(slotIndex('cad-3', C)).toBeNull();
    expect(slotIndex('cad-01', C)).toBeNull();
    expect(slotIndex('vps', C)).toBeNull();
  });
});

describe('CadRouter container slots and priorities', () => {
  it('batch holds at most CAD_SLOTS - 1 container leases; interactive takes the last free slot', async () => {
    at(T0);
    const { router } = testRouter(C);
    const a = await router.acquire({ job_id: 'job-a', backend_candidates: [...cand], deadline_s: 300 });
    const b = await router.acquire({ job_id: 'job-b', backend_candidates: [...cand], deadline_s: 300, priority: 'batch' });
    expect(a).toMatchObject({ granted: true, backend: 'container', slot: 'cad-0' });
    expect(b).toMatchObject({ granted: true, backend: 'container', slot: 'cad-1' });
    // a third batch job (default priority) waits: one slot stays free for the compat path
    expect(await router.acquire({ job_id: 'job-c', backend_candidates: [...cand], deadline_s: 300 })).toEqual({ granted: false, retry_after_s: RETRY_AFTER_S });
    const i = await router.acquire({ job_id: 'compat:1', backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' });
    expect(i).toMatchObject({ granted: true, slot: 'cad-2' });
    expect(await router.acquire({ job_id: 'compat:2', backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' })).toMatchObject({ granted: false });
    // the lowest free slot is handed out again after a release
    if (!b.granted) throw new Error('no lease');
    await router.release(b.lease_id, { ok: true });
    expect(await router.acquire({ job_id: 'compat:3', backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' })).toMatchObject({ granted: true, slot: 'cad-1' });
  });

  it("batch's share counts batch leases only: an interactive lease never lowers it", async () => {
    at(T0);
    const { router } = testRouter(C);
    expect(await router.acquire({ job_id: 'compat:1', backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' })).toMatchObject({ slot: 'cad-0' });
    expect(await router.acquire({ job_id: 'b1', backend_candidates: [...cand], deadline_s: 300 })).toMatchObject({ granted: true, slot: 'cad-1' });
    expect(await router.acquire({ job_id: 'b2', backend_candidates: [...cand], deadline_s: 300 })).toMatchObject({ granted: true, slot: 'cad-2' });
    expect(await router.acquire({ job_id: 'b3', backend_candidates: [...cand], deadline_s: 300 })).toMatchObject({ granted: false });
  });

  it('interactive calls may use every slot; batch then still waits', async () => {
    at(T0);
    const { router } = testRouter(C);
    for (const [n, slot] of [[1, 'cad-0'], [2, 'cad-1'], [3, 'cad-2']] as const) {
      expect(await router.acquire({ job_id: `compat:${n}`, backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' })).toMatchObject({ granted: true, slot });
    }
    expect(await router.acquire({ job_id: 'job-a', backend_candidates: [...cand], deadline_s: 300 })).toMatchObject({ granted: false });
  });

  it('a batch job falls through to the next candidate when only the reserved slot is free', async () => {
    at(T0);
    const { router } = testRouter(C);
    await router.acquire({ job_id: 'j1', backend_candidates: [...cand], deadline_s: 300 });
    await router.acquire({ job_id: 'j2', backend_candidates: [...cand], deadline_s: 300 });
    expect(await router.acquire({ job_id: 'j3', backend_candidates: ['container', 'vps'], deadline_s: 300 })).toMatchObject({ granted: true, backend: 'vps' });
    expect((await router.acquire({ job_id: 'j3', backend_candidates: ['container', 'vps'], deadline_s: 300 })) as { slot?: string }).not.toHaveProperty('slot');
  });

  it('a redelivered job gets its lease and slot back; expiry frees the slot', async () => {
    at(T0);
    const { router, state } = testRouter(C);
    const a = await router.acquire({ job_id: 'job-a', backend_candidates: [...cand], deadline_s: 100 });
    expect(await router.acquire({ job_id: 'job-a', backend_candidates: [...cand], deadline_s: 100 })).toEqual(a);
    at(T0 + (100 + LEASE_GRACE_S) * 1000 + 1);
    await state.runAlarm();
    const snap = await router.snapshot();
    expect(snap.leases).toEqual([]);
    expect(snap.container_slots).toEqual([{ slot: 'cad-0' }, { slot: 'cad-1' }, { slot: 'cad-2' }]);
    expect(await router.acquire({ job_id: 'job-b', backend_candidates: [...cand], deadline_s: 100 })).toMatchObject({ slot: 'cad-0' });
  });

  it('snapshot lists every slot with its lease and start time, and the container max = CAD_SLOTS', async () => {
    at(T0);
    const { router } = testRouter({ CAD_SLOTS: '2' });
    const a = await router.acquire({ job_id: 'compat:1', backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' });
    if (!a.granted) throw new Error('no lease');
    const snap = await router.snapshot();
    expect(snap.slots.container).toEqual({ max: 2, used: 1 });
    expect(snap.container_slots).toEqual([{ slot: 'cad-0', lease: a.lease_id, since: new Date(T0).toISOString() }, { slot: 'cad-1' }]);
    // with 2 slots batch holds at most 1
    expect(await router.acquire({ job_id: 'j1', backend_candidates: [...cand], deadline_s: 300 })).toMatchObject({ granted: true, slot: 'cad-1' });
    expect(await router.acquire({ job_id: 'j2', backend_candidates: [...cand], deadline_s: 300 })).toMatchObject({ granted: false });
  });

  it('without CAD_SLOTS the Phase 4 accounting applies: three container leases, no reservation', async () => {
    at(T0);
    const { router } = testRouter({});
    for (const [id, slot] of [['c1', 'cad-0'], ['c2', 'cad-1'], ['c3', 'cad-2']] as const) {
      expect(await router.acquire({ job_id: id, backend_candidates: [...cand], deadline_s: 60 })).toMatchObject({ granted: true, slot });
    }
    expect(await router.acquire({ job_id: 'c4', backend_candidates: [...cand], deadline_s: 60, priority: 'interactive' })).toMatchObject({ granted: false });
  });

  it('non-container leases carry no slot and use no container slot', async () => {
    at(T0);
    const { router } = testRouter(C);
    const v = await router.acquire({ job_id: 'v1', backend_candidates: ['vps'], deadline_s: 60 });
    expect(v).toMatchObject({ granted: true, backend: 'vps' });
    expect(v).not.toHaveProperty('slot');
    expect((await router.snapshot()).container_slots.every((s) => s.lease === undefined)).toBe(true);
  });
});

describe('CadRouter recycle', () => {
  class GatedPort implements ContainerPort {
    readonly destroyed: string[] = [];
    release: () => void = () => undefined;
    gate: Promise<void> = Promise.resolve();
    fail = false;
    hold(): void {
      this.gate = new Promise((resolve) => (this.release = resolve));
    }
    async fetch(): Promise<Response> {
      throw new Error('not used');
    }
    async destroy(slot: string): Promise<void> {
      this.destroyed.push(slot);
      await this.gate;
      if (this.fail) throw new Error('destroy failed');
    }
  }

  it('release with recycle destroys that slot; the slot stays taken until the destroy call returned', async () => {
    at(T0);
    const port = new GatedPort();
    const { router } = testRouter(C, port);
    const a = await router.acquire({ job_id: 'compat:1', backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' });
    if (!a.granted) throw new Error('no lease');
    port.hold();
    const releasing = router.release(a.lease_id, { ok: false, retryable: true, recycle: true });
    await Promise.resolve();
    // while cad-0 is being destroyed it is not handed out
    expect(await router.acquire({ job_id: 'compat:2', backend_candidates: [...cand], deadline_s: 110, priority: 'interactive' })).toMatchObject({ granted: true, slot: 'cad-1' });
    const during = await router.snapshot();
    expect(during.container_slots[0].lease).toBeDefined();
    expect(during.leases.some((l) => l.job_id.startsWith('recycle:cad-0:'))).toBe(true);
    port.release();
    await releasing;
    expect(port.destroyed).toEqual(['cad-0']);
    const after = await router.snapshot();
    expect(after.container_slots[0]).toEqual({ slot: 'cad-0' });
    expect(after.leases.some((l) => l.job_id.startsWith('recycle:'))).toBe(false);
  });

  it('a failed destroy still frees the slot; an interrupted one frees it within RECYCLE_HOLD_MS', async () => {
    at(T0);
    const port = new GatedPort();
    port.fail = true;
    const { router, state } = testRouter(C, port);
    const a = await router.acquire({ job_id: 'job-a', backend_candidates: [...cand], deadline_s: 300 });
    if (!a.granted) throw new Error('no lease');
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (l: unknown) => void errors.push(l);
    try {
      await router.release(a.lease_id, { ok: false, recycle: true });
    } finally {
      console.error = original;
    }
    expect(port.destroyed).toEqual(['cad-0']);
    expect((await router.snapshot()).container_slots[0]).toEqual({ slot: 'cad-0' });
    expect(String(errors[0])).toBe('[microns-ops] cad slot recycle failed slot=cad-0 reason=release error=Error');

    // a destroy that never returns (isolate gone): the hold row expires
    const stuck = new GatedPort();
    stuck.hold();
    const second = testRouter(C, stuck);
    const b = await second.router.acquire({ job_id: 'job-b', backend_candidates: [...cand], deadline_s: 300 });
    if (!b.granted) throw new Error('no lease');
    void second.router.release(b.lease_id, { ok: false, recycle: true });
    await Promise.resolve();
    at(T0 + RECYCLE_HOLD_MS + 1);
    await second.state.runAlarm();
    expect((await second.router.snapshot()).container_slots[0]).toEqual({ slot: 'cad-0' });
    void state;
  });

  it('release without recycle never destroys; recycle of a vps lease is ignored', async () => {
    at(T0);
    const port = new ScriptedContainer();
    const { router } = testRouter(C, port);
    const a = await router.acquire({ job_id: 'job-a', backend_candidates: [...cand], deadline_s: 300 });
    const v = await router.acquire({ job_id: 'job-v', backend_candidates: ['vps'], deadline_s: 300 });
    if (!a.granted || !v.granted) throw new Error('no lease');
    await router.release(a.lease_id, { ok: true });
    await router.release(v.lease_id, { ok: false, recycle: true });
    expect(port.destroyed).toEqual([]);
  });

  it('recycle(slot) destroys a slot by hand; an unknown slot is refused', async () => {
    at(T0);
    const port = new ScriptedContainer();
    const { router } = testRouter(C, port);
    const quiet = console.log;
    console.log = () => undefined;
    try {
      await router.recycle('cad-2');
      await expect(router.recycle('cad-3')).rejects.toThrow('unknown CAD slot');
      await expect(router.recycle('vps')).rejects.toThrow('unknown CAD slot');
    } finally {
      console.log = quiet;
    }
    expect(port.destroyed).toEqual(['cad-2']);
    expect((await router.snapshot()).container_slots[2]).toEqual({ slot: 'cad-2' });
  });
});

describe('no active container probe', () => {
  it('the configured container backend reports healthy without any request; the router never probes', async () => {
    const port = new ScriptedContainer();
    const backend = new ContainerBackend({ port, apiKey: TEST_KEY, maxConcurrency: 3 });
    expect(await backend.health()).toBe(true);
    expect(await new ContainerBackend().health()).toBe(false);
    at(T0);
    const { router } = testRouter(C, port);
    await router.acquire({ job_id: 'j', backend_candidates: [...cand], deadline_s: 60 });
    await router.snapshot();
    await router.alarm();
    expect(port.requests).toEqual([]);
    expect(port.destroyed).toEqual([]);
  });
});
