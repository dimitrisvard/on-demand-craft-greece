// T1 harness of the content pipeline (unit C5): OpsEnv with the Phase 4 fakes plus the content bindings (queue
// translations, Workflows content-daily and sitemap, KV SEO_CACHE), P5MemoryDb (article tables, unique keys and the
// article-queue RPCs), the Phase 4 test ports and the Phase 5 fakes. Synthetic data only.

import { readFlag } from '../../../src/agents/flags';
import type { OpsEnv } from '../../../src/env';
import type { Row } from '../../../src/db/postgrest';
import { makeTestP5Ports, P5MemoryDb, type TestP5Ports } from '../../../src/ports/p5-stub/index';
import type { TranslationMessageV1 } from '../../../src/queues/messages';
import { agentBindings, agentPorts, FakeClock, FakeKV, FakeQueue, FakeWorkflow, type AgentTestPorts } from '../../helpers/agent-env';
import { FakeStep } from '../../helpers/fake-step';
import { opsEnv } from '../../helpers/ops';

/** FakeStep that runs a test hook once before the named step starts (e.g. to switch the flag between two steps). */
export class HookedStep extends FakeStep {
  readonly before = new Map<string, () => void>();
  override do<T>(name: string, ...args: unknown[]): Promise<T> {
    const hook = this.before.get(name);
    if (hook) {
      this.before.delete(name);
      hook();
    }
    return super.do<T>(name, ...args);
  }
}

export const DATE = '2026-10-08';
export const T0 = Date.UTC(2026, 9, 8, 7, 0, 0);
export const SITE = 'https://www.micronshub.eu';
/** A non-secret test value for INDEXNOW_KEY (built at runtime). */
export const INDEXNOW_TEST_KEY = ['indexnow', 't1', 'value'].join('-');

export interface ContentHarness {
  env: OpsEnv;
  ports: AgentTestPorts & { db: P5MemoryDb };
  p5: TestP5Ports;
  db: P5MemoryDb;
  clock: FakeClock;
  flags: FakeKV;
  seo: FakeKV;
  translations: FakeQueue<TranslationMessageV1>;
  contentDaily: FakeWorkflow;
  sitemap: FakeWorkflow;
  setFlag(f: { enabled?: boolean; mode?: 'shadow' | 'assist' | 'auto'; value?: Record<string, unknown> } | null): void;
}

export function contentHarness(o: { now?: number; env?: Partial<OpsEnv>; indexnow?: boolean } = {}): ContentHarness {
  const clock = new FakeClock(o.now ?? T0);
  const db = new P5MemoryDb({ clock: () => clock.now() });
  const ports = agentPorts({ db, clock }) as AgentTestPorts & { db: P5MemoryDb };
  const p5 = makeTestP5Ports();
  const flags = new FakeKV();
  const seo = new FakeKV();
  const translations = new FakeQueue<TranslationMessageV1>();
  const contentDaily = new FakeWorkflow();
  const sitemap = new FakeWorkflow();
  const env = opsEnv({
    ...agentBindings({ FLAGS: flags as unknown as KVNamespace }),
    TRANSLATIONS: translations as unknown as Queue<TranslationMessageV1>,
    CONTENT_DAILY: contentDaily as unknown as OpsEnv['CONTENT_DAILY'],
    SITEMAP: sitemap as unknown as OpsEnv['SITEMAP'],
    SEO_CACHE: seo as unknown as KVNamespace,
    ...(o.indexnow === false ? {} : { INDEXNOW_KEY: INDEXNOW_TEST_KEY }),
    ...o.env,
  });
  const h: ContentHarness = {
    env,
    ports,
    p5,
    db,
    clock,
    flags,
    seo,
    translations,
    contentDaily,
    sitemap,
    setFlag(f) {
      if (f === null) {
        flags.store.delete('agent.content_daily');
        return;
      }
      flags.setJson('agent.content_daily', { enabled: f.enabled ?? true, mode: f.mode ?? 'assist', value: { mode: f.mode ?? 'assist', ...f.value } });
    },
  };
  h.setFlag({ value: { steps: ['generate', 'translate', 'fix_links', 'sitemap'], model: 'claude-sonnet-5', backfill_per_language_per_day: 5 } });
  return h;
}

/** Sanity: the flag the harness wrote reads back enabled. */
export async function flagOn(h: ContentHarness): Promise<boolean> {
  return (await readFlag(h.env, 'agent.content_daily')).enabled;
}

/** Deterministic UUID from a prefix digit and a number. */
export function uuid(prefix: string, n: number): string {
  return `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** A queue Message stand-in that records ack/retry. */
export interface TestMessage<T> extends Message<T> {
  acked: boolean;
  retried: Array<{ delaySeconds?: number } | undefined>;
}

export function message<T>(body: T, attempts = 1, id = 'msg-1'): TestMessage<T> {
  const m = {
    id,
    timestamp: new Date(T0),
    body,
    attempts,
    acked: false,
    retried: [] as Array<{ delaySeconds?: number } | undefined>,
    ack() {
      m.acked = true;
    },
    retry(o?: { delaySeconds?: number }) {
      m.retried.push(o);
    },
  };
  return m as unknown as TestMessage<T>;
}

export function batchOf<T>(queue: string, ...messages: Array<Message<T>>): MessageBatch<T> {
  return { queue, messages, ackAll() {}, retryAll() {} } as unknown as MessageBatch<T>;
}

/** Rows of a table (copies). */
export function rows(h: ContentHarness, table: string): Row[] {
  return h.db.rows(table);
}

/** The agent_runs row with this idempotency key. */
export function runByKey(h: ContentHarness, key: string): Row | undefined {
  return h.db.rows('agent_runs').find((r) => r.idempotency_key === key);
}
