// Node stand-in for the runtime module 'cloudflare:email' (aliased in vitest.config.ts). The Agents SDK chunk behind
// 'agents/mcp' imports EmailMessage from it; T1 never sends mail through it.

export class EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream | string;

  constructor(from: string, to: string, raw: ReadableStream | string) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}
