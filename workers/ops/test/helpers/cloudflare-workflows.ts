// Node stand-in for the runtime module 'cloudflare:workflows' (aliased in vitest.config.ts): NonRetryableError,
// which a Workflow step throws to stop its retries. Type checking uses @cloudflare/workers-types.

export class NonRetryableError extends Error {
  constructor(message: string, name = 'NonRetryableError') {
    super(message);
    this.name = name;
  }
}
