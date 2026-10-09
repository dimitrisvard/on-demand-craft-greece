// Shared helpers of the Phase 5 CAD tests (unit D5): a Durable Object state that the real @cloudflare/containers
// Container constructor accepts (ctx.container, the synchronous storage.kv and storage.sync on top of the Phase 4
// FakeDurableObjectState), CadRouter instances with a scripted container port and a driven clock, job builders and
// test values built at runtime.

import type { ContainerPort } from '../../../src/ports/p5';
import { CadRouter } from '../../../src/do/cad-router';
import type { OpsEnv } from '../../../src/env';
import type { CadJobMessageV1 } from '../../../src/queues/messages';
import type { CadInput } from '../../../src/cad/types';
import { cadKindOf } from '../../../src/cad/types';
import { FakeDurableObjectState, fakeNamespace } from '../../helpers/fake-do';
import { ScriptedContainer } from '../../../src/ports/p5-stub/index';

/** A test value for the shared key, built at runtime (never a real key). */
export const TEST_KEY = ['t1', 'cad', 'shared', 'value'].join('-');

/** A fake container runtime object: never running; records start, destroy and signal calls. */
export class FakeContainerRuntime {
  running = false;
  readonly calls: string[] = [];
  start(): void {
    this.calls.push('start');
  }
  async destroy(): Promise<void> {
    this.calls.push('destroy');
  }
  signal(n: number): void {
    this.calls.push(`signal:${n}`);
  }
  monitor(): Promise<void> {
    return new Promise(() => undefined);
  }
  getTcpPort(): { fetch: () => Promise<Response> } {
    return { fetch: async () => new Response('fake port', { status: 503 }) };
  }
  async interceptOutboundHttp(): Promise<void> {
    this.calls.push('interceptOutboundHttp');
  }
  async interceptAllOutboundHttp(): Promise<void> {
    this.calls.push('interceptAllOutboundHttp');
  }
}

/** FakeDurableObjectState + what the Container constructor reads (container, storage.kv, storage.sync). */
export function containerState(name = 'cad-0'): FakeDurableObjectState & { container: FakeContainerRuntime } {
  const state = new FakeDurableObjectState(name) as FakeDurableObjectState & { container: FakeContainerRuntime };
  const kv = new Map<string, unknown>();
  Object.assign(state.storage, {
    kv: {
      get: (key: string) => (kv.has(key) ? structuredClone(kv.get(key)) : undefined),
      put: (key: string, value: unknown) => {
        kv.set(key, structuredClone(value));
      },
      delete: (key: string) => kv.delete(key),
    },
    sync: async () => undefined,
  });
  state.container = new FakeContainerRuntime();
  return state;
}

/** CadRouter whose clock the test drives and whose container port is scripted. */
export class TestCadRouter extends CadRouter {
  static clock = Date.UTC(2026, 9, 8, 9, 0, 0);
  port: ContainerPort = new ScriptedContainer();

  protected override now(): number {
    return TestCadRouter.clock;
  }

  protected override containerPort(): ContainerPort {
    return this.port;
  }
}

/** One router ('global') on a fake namespace, for the env given. */
export function testRouter(env: Partial<OpsEnv> = {}, port: ContainerPort = new ScriptedContainer()) {
  const ns = fakeNamespace((state) => {
    const r = new TestCadRouter(state as unknown as DurableObjectState, env as OpsEnv);
    r.port = port;
    return r;
  });
  return { router: ns.instance('global'), state: ns.state('global'), ns, port };
}

export function job(over: Partial<CadJobMessageV1> = {}, params: Partial<CadJobMessageV1['params']> = {}): CadJobMessageV1 {
  return {
    v: 1,
    job_id: '11111111-1111-4111-8111-111111111111',
    idempotency_key: `${'a'.repeat(64)}:analyse:${'b'.repeat(64)}`,
    job_type: 'analyse',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    rfq_id: '22222222-2222-4222-8222-222222222222',
    rfq_file_id: null,
    quote_workflow_id: null,
    input: { store: 'r2', r2_key: 'rfq/x/bracket.step', sha256: 'a'.repeat(64), content_type: 'application/step', size_bytes: 10, file_name: 'bracket.step' },
    params: { material: 'steel', thickness_override: 0, k_factor_override: 0, drawing_size: 'A3', process: 'sheet_metal', ...params },
    backend: 'auto',
    deadline_s: 300,
    run_id: '33333333-3333-4333-8333-333333333333',
    ...over,
  };
}

export function inputOf(content: Uint8Array, fileName: string): CadInput {
  return {
    fileName,
    kind: cadKindOf(fileName),
    contentType: 'application/octet-stream',
    sizeBytes: content.byteLength,
    sha256: 'a'.repeat(64),
    open: async () => new Response(content).body as ReadableStream,
  };
}

/** A JSON answer of the unfold service. */
export function serviceJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
