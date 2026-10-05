// Node stand-in for the runtime module 'cloudflare:workers' (aliased in vitest.config.ts). It provides only what
// microns-ops imports from it: WorkerEntrypoint, whose constructor stores ctx and env as the runtime does.
// Type checking still uses the real declarations from @cloudflare/workers-types.

export abstract class WorkerEntrypoint<Env = unknown, Props = {}> {
  protected ctx: ExecutionContext<Props>;
  protected env: Env;

  constructor(ctx: ExecutionContext<Props>, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

// ----- Phase 4 additions: the agent layer's Workflows and Durable Objects, and what the Agents SDK imports -----

/** Base of the Workflow classes; the constructor stores ctx and env as the runtime does. */
export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  protected ctx: ExecutionContext;
  protected env: Env;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  abstract run(event: unknown, step: unknown): Promise<unknown>;
}

/** Base of the Durable Object classes; the constructor stores ctx (the object state) and env. */
export abstract class DurableObject<Env = unknown, Props = {}> {
  protected ctx: DurableObjectState<Props>;
  protected env: Env;

  constructor(ctx: DurableObjectState<Props>, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

/** Marker base class for objects passed over RPC (imported by the Agents SDK). */
export class RpcTarget {}

/** Module-level env and exports of the runtime: empty in T1. */
export const env: Record<string, unknown> = {};
export const exports: Record<string, unknown> = {};

/** Module-level waitUntil of the runtime: a no-op in T1. */
export function waitUntil(promise: Promise<unknown>): void {
  void promise;
}
