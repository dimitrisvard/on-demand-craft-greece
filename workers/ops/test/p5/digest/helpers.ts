// T1 harness of the ops digest (unit O5): OpsEnv with the Phase 4 fakes, MemoryDb seeded from the shared digest
// vectors (supabase/tests/phase5/vectors/digest.json, also run against scripts/phase5/parity.sql Q12b on PGlite),
// the Phase 4 test ports (FakeLlm, RecordingMailer) and the Phase 5 fakes (TelegramTextRecorder). Synthetic data only.

import { readFileSync } from 'node:fs';
import type { Row } from '../../../src/db/postgrest';
import type { OpsEnv } from '../../../src/env';
import { makeTestP5Ports, type TestP5Ports } from '../../../src/ports/p5-stub/index';
import { agentBindings, agentPorts, FakeClock, FakeKV, type AgentTestPorts } from '../../helpers/agent-env';
import { MemoryDb } from '../../helpers/memory-db';
import { opsEnv } from '../../helpers/ops';

export interface DigestVectors {
  iso_week: string;
  now: string;
  window: { report_week: string; start: string; end: string };
  seed: Record<string, Row[]>;
  expected_figures: Array<{ section: string; figure: string; value: string }>;
}

export const VECTORS: DigestVectors = JSON.parse(
  readFileSync(new URL('../../../../../supabase/tests/phase5/vectors/digest.json', import.meta.url), 'utf8'),
) as DigestVectors;

/** The digest recipient of the tests (an example domain; built at runtime). */
export const RECIPIENT = ['owner', 'example.test'].join('@');
export const DIGEST_FROM = 'MicronsHub Ops <info@micronshub.eu>';

export interface DigestHarness {
  env: OpsEnv;
  ports: AgentTestPorts;
  p5: TestP5Ports;
  db: MemoryDb;
  clock: FakeClock;
  flags: FakeKV;
  setFlag(f: { enabled?: boolean; mode?: 'shadow' | 'assist' | 'auto'; value?: Record<string, unknown> } | null): void;
}

export function digestHarness(o: { now?: string; seed?: boolean; env?: Partial<OpsEnv> } = {}): DigestHarness {
  const clock = new FakeClock(Date.parse(o.now ?? VECTORS.now));
  const db = new MemoryDb({ clock: () => clock.now() });
  if (o.seed !== false) for (const [table, rows] of Object.entries(VECTORS.seed)) db.seed(table, structuredClone(rows));
  const ports = agentPorts({ db, clock });
  const p5 = makeTestP5Ports();
  const flags = new FakeKV();
  const env = opsEnv({ ...agentBindings({ FLAGS: flags as unknown as KVNamespace }), DIGEST_FROM, ...o.env });
  const h: DigestHarness = {
    env,
    ports,
    p5,
    db,
    clock,
    flags,
    setFlag(f) {
      if (f === null) {
        flags.store.delete('agent.ops_digest');
        return;
      }
      const mode = f.mode ?? 'assist';
      flags.setJson('agent.ops_digest', { enabled: f.enabled ?? true, mode, value: { mode, recipient: RECIPIENT, ads_upload: false, purge: true, ...f.value } });
    },
  };
  h.setFlag({});
  return h;
}

export function runByKey(h: DigestHarness, key: string): Row | undefined {
  return h.db.rows('agent_runs').find((r) => r.idempotency_key === key);
}

/** Messages API body of a structured answer (the FakeLlm fixture format). */
export function llmAnswer(json: unknown, o: { stop?: string; model?: string } = {}): Record<string, unknown> {
  return {
    id: 'msg_digest_fixture',
    type: 'message',
    role: 'assistant',
    model: o.model ?? 'claude-sonnet-5-5',
    content: [{ type: 'text', text: JSON.stringify(json) }],
    stop_reason: o.stop ?? 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}
