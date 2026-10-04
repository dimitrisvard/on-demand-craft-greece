// Node cannot load the runtime module 'cloudflare:workers'; vitest.config.ts resolves it to
// test/helpers/cloudflare-workers.ts so that modules extending WorkerEntrypoint can be imported in unit tests.
import { describe, expect, it } from 'vitest';
import { WorkerEntrypoint } from 'cloudflare:workers';
import * as stub from './helpers/cloudflare-workers';

class Probe extends WorkerEntrypoint<{ NAME: string }> {
  read(): { env: { NAME: string }; ctx: ExecutionContext } {
    return { env: this.env, ctx: this.ctx };
  }
}

describe("'cloudflare:workers' in Node tests", () => {
  it('resolves to the test stub', () => {
    expect(WorkerEntrypoint).toBe(stub.WorkerEntrypoint);
  });

  it('WorkerEntrypoint stores ctx and env as the runtime does', () => {
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const probe = new Probe(ctx, { NAME: 'ops' });
    expect(probe.read().env).toStrictEqual({ NAME: 'ops' });
    expect(probe.read().ctx).toBe(ctx);
  });
});
