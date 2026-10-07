// Promise limiter: never more than `concurrency` tasks at once, arrival order, failures free their slot.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, limit, mapLimit } from '../src/limit';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('limit', () => {
  it('runs at most 6 tasks at once by default and never more than the limit pending at once', async () => {
    expect(DEFAULT_CONCURRENCY).toBe(6);
    const run = limit();
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 20 }, () => deferred());
    const results = gates.map((g, i) =>
      run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await g.promise;
        running -= 1;
        return i;
      }),
    );
    await tick();
    expect(run.activeCount).toBe(6);
    expect(run.pendingCount).toBe(14);
    for (const g of gates) {
      g.resolve();
      await tick();
      expect(running).toBeLessThanOrEqual(6);
    }
    expect(await Promise.all(results)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(peak).toBe(6);
    expect(run.activeCount).toBe(0);
    expect(run.pendingCount).toBe(0);
  });

  it('starts tasks in submission order', async () => {
    const run = limit(2);
    const started: number[] = [];
    const gates = Array.from({ length: 5 }, () => deferred());
    const all = gates.map((g, i) => run(async () => { started.push(i); await g.promise; }));
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    for (const g of gates) g.resolve();
    await Promise.all(all);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('a failing task rejects its own promise and frees its slot', async () => {
    const run = limit(1);
    const failing = run(async () => { throw new Error('boom'); });
    const throwing = run(() => { throw new Error('sync boom'); });
    const ok = run(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(throwing).rejects.toThrow('sync boom');
    await expect(ok).resolves.toBe('ok');
    expect(run.activeCount).toBe(0);
  });

  it('accepts plain values and refuses a bad concurrency', async () => {
    await expect(limit(3)(() => 5)).resolves.toBe(5);
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity]) expect(() => limit(bad)).toThrow(RangeError);
  });

  it('mapLimit keeps the input order', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5, 1, 15, 2, 8], 3, async (ms, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running -= 1;
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
  });
});
