// Phase 4 rules of the site bundle guard (scripts/check-bundle.mjs): the agent-layer packages and the microns-ops
// sources are forbidden inputs; the Phase 2 rules still hold. Run on a fixture metafile through the script itself.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NODE_CHILD_PROCESS: string = 'node:child_process';
const NODE_FS: string = 'node:fs';
const NODE_OS: string = 'node:os';
const NODE_PATH: string = 'node:path';
const SCRIPT = new URL('../scripts/check-bundle.mjs', (import.meta as unknown as { url: string }).url);

type ForbiddenReason = (repoPath: string) => string | null;

let forbiddenReason: ForbiddenReason;
let tmp = '';
let fs: { mkdtempSync(p: string): string; writeFileSync(p: string, d: string): void; rmSync(p: string, o: { recursive: boolean; force: boolean }): void };
let join: (...parts: string[]) => string;

beforeAll(async () => {
  forbiddenReason = ((await import(/* @vite-ignore */ SCRIPT.href)) as { forbiddenReason: ForbiddenReason }).forbiddenReason;
  fs = (await import(/* @vite-ignore */ NODE_FS)) as typeof fs;
  join = ((await import(/* @vite-ignore */ NODE_PATH)) as { join: typeof join }).join;
  const os = (await import(/* @vite-ignore */ NODE_OS)) as { tmpdir(): string };
  tmp = fs.mkdtempSync(join(os.tmpdir(), 'agent-check-bundle-'));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('forbiddenReason: Phase 4 inputs', () => {
  it('agent-layer packages', () => {
    for (const input of [
      'workers/ops/node_modules/@anthropic-ai/sdk/client.mjs',
      'node_modules/agents/dist/mcp/index.js',
      'workers/ops/node_modules/@modelcontextprotocol/server/dist/index.js',
      'workers/ops/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js',
      'workers/ops/node_modules/postal-mime/src/postal-mime.js',
      'workers/ops/node_modules/@pdf-lib/fontkit/dist/fontkit.es.js',
      'workers/ops/node_modules/@cloudflare/puppeteer/lib/esm/puppeteer.js',
    ]) {
      expect(forbiddenReason(input), input).not.toBeNull();
    }
  });

  it('every microns-ops source file', () => {
    for (const input of ['workers/ops/src/agents/decision.ts', 'workers/ops/src/routes/agent.ts', 'workers/ops/src/index.ts']) {
      expect(forbiddenReason(input), input).toBe('microns-ops source');
    }
  });

  it('the site, shared code and look-alike names stay allowed', () => {
    for (const input of [
      'workers/site/src/api/router.ts',
      'workers/site/src/auth/agent-hmac.ts',
      'workers/shared/src/agent-api.ts',
      'workers/site/node_modules/jose/dist/browser/index.js',
      'node_modules/agents-helper/index.js',
      'node_modules/@cloudflare/kv-asset-handler/dist/index.js',
      'workers/opsx/src/a.ts',
    ]) {
      expect(forbiddenReason(input), input).toBeNull();
    }
  });

  it('the Phase 2 rules still hold', () => {
    expect(forbiddenReason('node_modules/pdf-lib/cjs/index.js')).toBe('ops-only package');
    expect(forbiddenReason('lib/inventory/x.js')).toBe('ops-only lib');
    expect(forbiddenReason('api/gsc.js')).toBe('handler outside the site');
  });
});

describe('script exit status on a fixture metafile', () => {
  let n = 0;
  async function run(inputs: string[], imports: Array<[string, string]> = []): Promise<{ code: number; stdout: string; stderr: string }> {
    n += 1;
    const meta = join(tmp, `meta-${n}.json`);
    // Metafile inputs and import paths are relative to workers/site.
    const entries = inputs.map((i) => [`../../${i}`, { bytes: 10, imports: imports.filter(([from]) => from === i).map(([, to]) => ({ path: `../../${to}`, kind: 'import-statement' })) }]);
    fs.writeFileSync(meta, JSON.stringify({ inputs: Object.fromEntries(entries), outputs: {} }));
    const cp = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as {
      execFile(f: string, a: string[], o: { cwd: string; env: Record<string, string>; timeout: number }, cb: (e: { code?: number } | null, out: string, err: string) => void): unknown;
    };
    const proc = (globalThis as unknown as { process: { execPath: string; env: Record<string, string | undefined> } }).process;
    return new Promise((resolve) => {
      cp.execFile(proc.execPath, [SCRIPT.pathname, '--metafile', meta], { cwd: new URL('..', SCRIPT).pathname, env: { PATH: proc.env.PATH ?? '' }, timeout: 30_000 }, (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? -1) : 0, stdout, stderr });
      });
    });
  }

  it('fails (exit 1) and names the agent inputs', async () => {
    const result = await run(['workers/site/src/index.ts', 'workers/ops/src/agents/decision.ts', 'workers/ops/node_modules/@anthropic-ai/sdk/index.mjs']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('workers/ops/src/agents/decision.ts (microns-ops source)');
    expect(result.stdout).toContain('@anthropic-ai/sdk/index.mjs (agent-layer package)');
  });

  it('postal-mime reached only through resend (the site mail handler) passes; any other importer fails', async () => {
    const files = ['api/emails.js', 'node_modules/resend/dist/index.mjs', 'node_modules/postal-mime/src/postal-mime.js', 'node_modules/postal-mime/src/mime-node.js'];
    const viaResend: Array<[string, string]> = [
      ['api/emails.js', 'node_modules/resend/dist/index.mjs'],
      ['node_modules/resend/dist/index.mjs', 'node_modules/postal-mime/src/postal-mime.js'],
      ['node_modules/postal-mime/src/postal-mime.js', 'node_modules/postal-mime/src/mime-node.js'],
    ];
    const ok = await run(files, viaResend);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('postal-mime allowed as a dependency of resend only; importers: node_modules/resend/dist/index.mjs');
    const direct = await run([...files, 'workers/site/src/mail.ts'], [...viaResend, ['workers/site/src/mail.ts', 'node_modules/postal-mime/src/postal-mime.js']]);
    expect(direct.code).toBe(1);
    expect(direct.stdout).toContain('node_modules/postal-mime/src/postal-mime.js (agent-layer package)');
    expect(direct.stdout).not.toContain('postal-mime allowed');
    // Any other importer beside resend: another package, a microns-ops source, a shared module.
    for (const other of ['node_modules/agents/dist/mail.js', 'workers/ops/src/mail-in/parse.ts', 'workers/shared/src/mail.ts']) {
      const result = await run([...files, other], [...viaResend, [other, 'node_modules/postal-mime/src/mime-node.js']]);
      expect(result.code, other).toBe(1);
      expect(result.stdout, other).toContain('node_modules/postal-mime/src/mime-node.js (agent-layer package)');
    }
    // postal-mime with no importer recorded at all is not "a dependency of resend".
    const orphan = await run(['workers/site/src/index.ts', 'node_modules/postal-mime/src/postal-mime.js']);
    expect(orphan.code).toBe(1);
    expect(orphan.stdout).toContain('node_modules/postal-mime/src/postal-mime.js (agent-layer package)');
  });

  it('passes (exit 0) on site-only inputs', async () => {
    const result = await run(['workers/site/src/index.ts', 'workers/site/src/auth/agent-hmac.ts', 'workers/shared/src/agent-api.ts']);
    expect(result.code).toBe(0);
  });
});
