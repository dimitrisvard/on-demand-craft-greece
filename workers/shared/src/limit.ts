// Promise limiter: at most `concurrency` tasks run at once, the rest wait in arrival order. Used for fan-out of
// outgoing fetches, because a Worker invocation keeps at most 6 connections waiting for response headers at once
// (Cloudflare Workers platform limits, "Simultaneous open connections", fetched 2026-10-02).
//
// Rules
//   - concurrency is a positive integer (default 6); anything else throws at construction.
//   - A task that throws or rejects frees its slot; its own promise rejects with that error, the others go on.
//   - Tasks start in the order they were submitted.

/** Default number of tasks running at once (the per-invocation connection limit). */
export const DEFAULT_CONCURRENCY = 6;

export interface Limiter {
  <T>(task: () => Promise<T> | T): Promise<T>;
  /** Tasks running now. */
  readonly activeCount: number;
  /** Tasks waiting for a slot. */
  readonly pendingCount: number;
}

export function limit(concurrency: number = DEFAULT_CONCURRENCY): Limiter {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  const queue: Array<() => void> = [];
  let active = 0;

  const next = (): void => {
    if (active >= concurrency) return;
    const start = queue.shift();
    if (start) {
      active += 1;
      start();
    }
  };

  const run = (<T>(task: () => Promise<T> | T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        let result: Promise<T>;
        try {
          result = Promise.resolve(task());
        } catch (error) {
          result = Promise.reject(error);
        }
        result.then(resolve, reject).finally(() => {
          active -= 1;
          next();
        });
      });
      next();
    })) as Limiter;

  Object.defineProperties(run, {
    activeCount: { get: () => active },
    pendingCount: { get: () => queue.length },
  });
  return run;
}

/** Maps `items` through `fn` with at most `concurrency` calls at once; results keep the input order. */
export async function mapLimit<I, O>(items: readonly I[], concurrency: number, fn: (item: I, index: number) => Promise<O> | O): Promise<O[]> {
  const run = limit(concurrency);
  return Promise.all(items.map((item, index) => run(() => fn(item, index))));
}
