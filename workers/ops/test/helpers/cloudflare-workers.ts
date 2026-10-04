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
