// T1 loader contract of microns-ops (vitest.config.ts): the runtime modules 'cloudflare:workers',
// 'cloudflare:workflows' and 'cloudflare:email' resolve to the stubs in test/helpers; the Agents SDK loads under
// Node; .md imports are their text and .ttf/.png imports their bytes, as the wrangler `rules` bundle them.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DurableObject, RpcTarget, WorkflowEntrypoint, env, exports, waitUntil } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { EmailMessage } from 'cloudflare:email';
import readme from '../../README.md';
import logo from '../../../../public/logo.png';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

describe('runtime module stand-ins', () => {
  it("'cloudflare:workers' provides the Phase 4 bases and the module-level values the Agents SDK imports", () => {
    class Flow extends WorkflowEntrypoint<{ NAME: string }> {
      async run(): Promise<unknown> {
        return { env: this.env, ctx: this.ctx };
      }
    }
    class Thing extends DurableObject<{ NAME: string }> {
      read(): { env: { NAME: string }; ctx: unknown } {
        return { env: this.env, ctx: this.ctx };
      }
    }
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const state = { id: { name: 'x' } } as unknown as DurableObjectState;
    expect(new Thing(state, { NAME: 'ops' }).read()).toStrictEqual({ env: { NAME: 'ops' }, ctx: state });
    return new Flow(ctx, { NAME: 'ops' }).run().then((r) => {
      expect(r).toStrictEqual({ env: { NAME: 'ops' }, ctx });
      expect(typeof RpcTarget).toBe('function');
      expect(env).toStrictEqual({});
      expect(exports).toStrictEqual({});
      expect(waitUntil(Promise.resolve())).toBeUndefined();
    });
  });

  it("'cloudflare:workflows' NonRetryableError carries the runtime's name", () => {
    const error = new NonRetryableError('schema failure');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NonRetryableError');
    expect(error.message).toBe('schema failure');
  });

  it("'cloudflare:email' EmailMessage stores from and to", () => {
    const message = new EmailMessage('a@example.com', 'b@example.com', 'raw');
    expect([message.from, message.to]).toEqual(['a@example.com', 'b@example.com']);
  });
});

describe('Agents SDK under Node', () => {
  it("import('agents/mcp') resolves and exports createMcpHandler", async () => {
    const mcp = await import('agents/mcp');
    expect(typeof mcp.createMcpHandler).toBe('function');
  });
});

describe('wrangler rules mirrored by the wrangler-rules plugin', () => {
  it('a .md import is the file text (Text module)', () => {
    expect(typeof readme).toBe('string');
    expect(readme).toBe(readFileSync(file('../../README.md'), 'utf8'));
  });

  it('a .png import is an ArrayBuffer of the file bytes (Data module)', () => {
    expect(logo).toBeInstanceOf(ArrayBuffer);
    const bytes = readFileSync(file('../../../../public/logo.png'));
    expect(logo.byteLength).toBe(bytes.byteLength);
    expect(new Uint8Array(logo)).toEqual(new Uint8Array(bytes));
  });
});

// The production assets themselves, once their units add them: the first prompt file under src/agents/prompts and
// the PDF body font. Each case runs as soon as its file exists and is skipped (with the path) until then.
const PROMPTS_DIR = file('../../src/agents/prompts');
const FONT = file('../../src/pdf/assets/LiberationSans-Regular.ttf');

function firstPrompt(dir: string): string | null {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = firstPrompt(full);
      if (found) return found;
    } else if (/\.v\d+\.md$/.test(entry.name)) {
      return full;
    }
  }
  return null;
}
const PROMPT = firstPrompt(PROMPTS_DIR);

describe('production assets through the wrangler rules', () => {
  it.skipIf(!PROMPT)(`a prompt file loads as its text (${PROMPT ?? 'no src/agents/prompts/<agent>/<step>.v<N>.md yet'})`, async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(PROMPT as string).href)) as { default: unknown };
    expect(typeof mod.default).toBe('string');
    expect(mod.default).toBe(readFileSync(PROMPT as string, 'utf8'));
  });

  it.skipIf(!existsSync(FONT))('LiberationSans-Regular.ttf loads as an ArrayBuffer of its bytes', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(FONT).href)) as { default: unknown };
    expect(mod.default).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(mod.default as ArrayBuffer)).toEqual(new Uint8Array(readFileSync(FONT)));
  });
});
