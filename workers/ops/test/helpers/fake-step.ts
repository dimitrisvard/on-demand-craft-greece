// FakeStep: a WorkflowStep for T1 tests of the agent Workflows.
//   - do(name, cfg?, fn) caches results by (name, occurrence) so a replay returns cached results, applies the retry
//     config on a virtual clock and honours NonRetryableError;
//   - waitForEvent(name, {type, timeout}) resolves from a test-controlled buffer (events sent before the wait are
//     buffered, as in production) or throws Error('Execution timed out after <ms>ms');
//   - sleep / sleepUntil advance the virtual clock;
//   - crashAt(stepName) makes that step throw once, to prove replay idempotency.
// Defaults as the runtime: retries limit 5, delay 10 s exponential; a waitForEvent without timeout waits 24 h.
// Step results must be structured-cloneable (they are stored), as Workflows requires.

import type { WorkflowStep, WorkflowStepEvent, WorkflowTimeoutDuration } from 'cloudflare:workers';

export interface FakeStepCall {
  kind: 'do' | 'waitForEvent' | 'sleep' | 'sleepUntil';
  name: string;
  occurrence: number;
  attempts?: number;
  outcome: 'ok' | 'cached' | 'threw' | 'timed_out';
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/** Milliseconds of a Workflow duration ('7 days', '30 seconds' or a number of ms). */
export function durationMs(d: WorkflowTimeoutDuration | number | undefined, fallback: number): number {
  if (d === undefined) return fallback;
  if (typeof d === 'number') return d;
  const match = /^(\d+(?:\.\d+)?)\s+(second|minute|hour|day|week|month|year)s?$/.exec(d.trim());
  if (!match) throw new Error(`FakeStep: unsupported duration ${d}`);
  return Number(match[1]) * UNIT_MS[match[2]];
}

interface RetryConfig {
  retries?: { limit: number; delay: WorkflowTimeoutDuration | number | ((...a: unknown[]) => unknown); backoff?: 'constant' | 'linear' | 'exponential' };
  timeout?: WorkflowTimeoutDuration | number;
}

interface Shared {
  cache: Map<string, unknown>;
  events: Array<{ type: string; payload: unknown; at: number }>;
  crash: Set<string>;
}

export class FakeStep implements WorkflowStep {
  /** Every step call in order. */
  readonly calls: FakeStepCall[] = [];
  /** Virtual clock (ms since the epoch). */
  now: number;
  /** Called at the start of every waitForEvent with its type (a test can sendEvent from here). */
  onWait?: (type: string, name: string) => void;
  private readonly shared: Shared;
  private readonly occurrences = new Map<string, number>();

  constructor(o?: { now?: number; cache?: Map<string, unknown> }) {
    this.now = o?.now ?? Date.UTC(2026, 9, 5, 9, 0, 0);
    this.shared = { cache: o?.cache ?? new Map(), events: [], crash: new Set() };
  }

  /** The stored results (name#occurrence -> value). */
  get cache(): Map<string, unknown> {
    return this.shared.cache;
  }

  private occurrence(kind: string, name: string): number {
    const key = `${kind}:${name}`;
    const n = (this.occurrences.get(key) ?? 0) + 1;
    this.occurrences.set(key, n);
    return n;
  }

  /** do(name, callback) or do(name, config, callback), as WorkflowStep. */
  do<T>(name: string, ...args: unknown[]): Promise<T> {
    const callback = (typeof args[0] === 'function' ? args[0] : args[1]) as (ctx: unknown) => Promise<T>;
    const config = (typeof args[0] === 'function' ? undefined : args[0]) as RetryConfig | undefined;
    return this.runDo(name, config, callback);
  }

  private async runDo<T>(name: string, config: RetryConfig | undefined, callback: (ctx: unknown) => Promise<T>): Promise<T> {
    const occurrence = this.occurrence('do', name);
    const key = `${name}#${occurrence}`;
    if (this.shared.cache.has(key)) {
      this.calls.push({ kind: 'do', name, occurrence, outcome: 'cached' });
      return structuredClone(this.shared.cache.get(key)) as T;
    }
    if (this.shared.crash.delete(name)) {
      this.calls.push({ kind: 'do', name, occurrence, attempts: 0, outcome: 'threw' });
      throw new Error(`FakeStep crash at ${name}`);
    }
    const limit = config?.retries?.limit ?? 5;
    const delay = config?.retries?.delay;
    const baseDelay = typeof delay === 'function' ? 10_000 : durationMs(delay as WorkflowTimeoutDuration | number | undefined, 10_000);
    const backoff = config?.retries?.backoff ?? 'exponential';
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await callback({ step: { name, count: occurrence }, attempt, config: config ?? {} });
        const stored = result === undefined ? undefined : structuredClone(result);
        this.shared.cache.set(key, stored);
        this.calls.push({ kind: 'do', name, occurrence, attempts: attempt, outcome: 'ok' });
        return structuredClone(stored) as T;
      } catch (error) {
        const nonRetryable = error instanceof Error && error.name === 'NonRetryableError';
        if (nonRetryable || attempt > limit) {
          this.calls.push({ kind: 'do', name, occurrence, attempts: attempt, outcome: 'threw' });
          throw error;
        }
        const factor = backoff === 'exponential' ? 2 ** (attempt - 1) : backoff === 'linear' ? attempt : 1;
        this.now += baseDelay * factor;
      }
    }
  }

  sleep = async (name: string, duration: WorkflowTimeoutDuration): Promise<void> => {
    const occurrence = this.occurrence('sleep', name);
    this.now += durationMs(duration, 0);
    this.calls.push({ kind: 'sleep', name, occurrence, outcome: 'ok' });
  };

  sleepUntil = async (name: string, timestamp: Date | number): Promise<void> => {
    const occurrence = this.occurrence('sleepUntil', name);
    const target = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
    this.now = Math.max(this.now, target);
    this.calls.push({ kind: 'sleepUntil', name, occurrence, outcome: 'ok' });
  };

  async waitForEvent<T>(name: string, options: { type: string; timeout?: WorkflowTimeoutDuration | number }): Promise<WorkflowStepEvent<T>> {
    const occurrence = this.occurrence('waitForEvent', name);
    const key = `wait:${name}#${occurrence}`;
    if (this.shared.cache.has(key)) {
      this.calls.push({ kind: 'waitForEvent', name, occurrence, outcome: 'cached' });
      const cached = structuredClone(this.shared.cache.get(key)) as { payload: T; at: number; type: string };
      return { payload: cached.payload, timestamp: new Date(cached.at), type: cached.type };
    }
    this.onWait?.(options.type, name);
    const index = this.shared.events.findIndex((e) => e.type === options.type);
    if (index >= 0) {
      const [event] = this.shared.events.splice(index, 1);
      this.shared.cache.set(key, structuredClone({ payload: event.payload, at: this.now, type: event.type }));
      this.calls.push({ kind: 'waitForEvent', name, occurrence, outcome: 'ok' });
      return { payload: structuredClone(event.payload) as T, timestamp: new Date(this.now), type: event.type };
    }
    const ms = durationMs(options.timeout, 86_400_000);
    this.now += ms;
    this.calls.push({ kind: 'waitForEvent', name, occurrence, outcome: 'timed_out' });
    throw new Error(`Execution timed out after ${ms}ms`);
  }

  /** Buffers an event for a current or later waitForEvent of the same type. */
  sendEvent(type: string, payload: unknown): void {
    this.shared.events.push({ type, payload: structuredClone(payload), at: this.now });
  }

  /** The named step throws once (before its callback runs). */
  crashAt(stepName: string): void {
    this.shared.crash.add(stepName);
  }

  /** A new FakeStep that shares this one's cache, event buffer and clock (a replay of the same instance). */
  replay(): FakeStep {
    const next = new FakeStep({ now: this.now, cache: this.shared.cache });
    (next as unknown as { shared: Shared }).shared.events = this.shared.events;
    (next as unknown as { shared: Shared }).shared.crash = this.shared.crash;
    next.onWait = this.onWait;
    return next;
  }

  /** Names of the steps in order with their outcome, e.g. ['open-run:ok', 'wait-x:timed_out']. */
  trace(): string[] {
    return this.calls.map((c) => `${c.name}:${c.outcome}`);
  }
}
