// Guards of the production workflow (scripts/check-production.mjs, PLAN.md P3-3/P3-4): the production config has no
// placeholder left, only a tagged version uploaded with the production config is deployed, and production builds
// use the real Turnstile site key. The script runs as a child process exactly as the workflow runs it; fixtures are
// written to a temp folder. Turnstile test keys and real-shaped keys are built at run time.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import siteConfigText from '../wrangler.jsonc?raw';

const NODE_CHILD_PROCESS: string = 'node:child_process';
const NODE_FS: string = 'node:fs';
const NODE_OS: string = 'node:os';
const NODE_PATH: string = 'node:path';
const SCRIPT = new URL('../scripts/check-production.mjs', (import.meta as unknown as { url: string }).url);
const WORKFLOW = new URL('../../../.github/workflows/cf-site-production.yml', SCRIPT);

interface NodeFs {
  mkdtempSync(prefix: string): string;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  symlinkSync(target: string, path: string): void;
  rmSync(path: string, o: { recursive: boolean; force: boolean }): void;
}

interface ChildProcess {
  execFile(
    file: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; timeout: number },
    cb: (error: { code?: number } | null, stdout: string, stderr: string) => void,
  ): unknown;
}

interface Run {
  code: number;
  out: string;
}

let fs: NodeFs;
let join: (...parts: string[]) => string;
let tmp = '';
let fileNo = 0;

beforeAll(async () => {
  fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  join = ((await import(/* @vite-ignore */ NODE_PATH)) as { join: (...parts: string[]) => string }).join;
  const os = (await import(/* @vite-ignore */ NODE_OS)) as { tmpdir(): string };
  tmp = fs.mkdtempSync(join(os.tmpdir(), 'check-production-test-'));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Runs the script from the repository root (as the workflow does) with only PATH and `extraEnv` set; `script` is the
 * path node is given (default: the script itself).
 */
async function run(args: string[], extraEnv: Record<string, string> = {}, script: string = SCRIPT.pathname): Promise<Run> {
  const cp = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as ChildProcess;
  const proc = (globalThis as unknown as { process: { execPath: string; env: Record<string, string | undefined> } }).process;
  const repoRoot = new URL('../../..', SCRIPT).pathname;
  const env: Record<string, string> = { PATH: proc.env.PATH ?? '', ...extraEnv };
  return new Promise((resolve) => {
    cp.execFile(proc.execPath, [script, ...args], { cwd: repoRoot, env, timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? -1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

function write(name: string, content: string): string {
  const file = join(tmp, `${++fileNo}-${name}`);
  fs.writeFileSync(file, content);
  return file;
}

// ----- fixtures -----

const hex = (n: number) => '0123456789abcdef'.repeat(Math.ceil(n / 16)).slice(0, n);

function configText(o: { kvId?: string; machineHosts?: string; topAud?: string } = {}): string {
  return `// fixture config
{
  "name": "microns-site",
  "vars": { "ACCESS_AUD": "${o.topAud ?? '<ACCESS_AUD_PREVIEW>'}", "API_MACHINE_HOSTS": "" },
  "env": {
    // a comment naming <NOT_A_PLACEHOLDER> is ignored
    "production": {
      "name": "microns-site",
      "kv_namespaces": [{ "binding": "FLAGS", "id": "${o.kvId ?? hex(32)}" }],
      "vars": {
        "ACCESS_AUD": "${hex(64)},${hex(64)}",
        "API_MACHINE_HOSTS": "${o.machineHosts ?? 'api.micronshub.eu'}",
      },
    },
  },
}
`;
}

function versionJson(o: { tag?: string | null; hosts?: string | null; hostsType?: string } = {}): string {
  const annotations: Record<string, string> = { 'workers/message': 'cf-site-production upload' };
  if (o.tag !== null) annotations['workers/tag'] = o.tag ?? `prod-${hex(12)}`;
  const bindings: unknown[] = [
    { type: 'kv_namespace', name: 'FLAGS', namespace_id: hex(32) },
    { type: 'plain_text', name: 'SITE_ORIGIN', text: 'https://www.micronshub.eu' },
  ];
  if (o.hosts !== null) bindings.push({ type: o.hostsType ?? 'plain_text', name: 'API_MACHINE_HOSTS', text: o.hosts ?? 'api.micronshub.eu' });
  return JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', number: 7, annotations, resources: { bindings } }, null, 2);
}

/** The placeholders of the env block of the committed config, by an independent text scan (comments removed). */
function committedEnvPlaceholders(): string[] {
  const envPart = siteConfigText.slice(siteConfigText.indexOf('"env": {'));
  const withoutComments = envPart.split('\n').map((line) => line.replace(/^\s*\/\/.*$/, '')).join('\n');
  return [...new Set([...withoutComments.matchAll(/<[A-Z0-9_]+>/g)].map((m) => m[0]))].sort();
}

// ----- config -----

describe('check-production config', () => {
  it('the committed config: exit 1 listing exactly the placeholders of env.production, or exit 0 once all are filled in', async () => {
    const expected = committedEnvPlaceholders();
    const r = await run(['config']);
    const listed = [...r.out.matchAll(/placeholder left in env\.production: (<[A-Z0-9_]+>)/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(expected);
    expect(r.code).toBe(expected.length === 0 ? 0 : 1);
  });

  it('a production block with real IDs passes; placeholders in comments and at the top level do not count', async () => {
    const r = await run(['config', '--config', write('ok.jsonc', configText())]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('env.production has no placeholder');
  });

  it('a placeholder anywhere in env.production fails, also inside a longer value', async () => {
    const one = await run(['config', '--config', write('kv.jsonc', configText({ kvId: '<KV_ID_FLAGS>' }))]);
    expect(one.code).toBe(1);
    expect(one.out).toContain('<KV_ID_FLAGS>');
    const embedded = await run(['config', '--config', write('hosts.jsonc', configText({ machineHosts: 'api.micronshub.eu,<EXTRA_HOST>' }))]);
    expect(embedded.code).toBe(1);
    expect(embedded.out).toContain('<EXTRA_HOST>');
  });

  it('a config without env.production fails; an unreadable or malformed config is a usage error', async () => {
    expect((await run(['config', '--config', write('noenv.jsonc', '{ "name": "microns-site" }')])).code).toBe(1);
    expect((await run(['config', '--config', join(tmp, 'missing.jsonc')])).code).toBe(64);
    expect((await run(['config', '--config', write('broken.jsonc', '{ "name": ')])).code).toBe(64);
  });
});

// ----- version -----

describe('check-production version (only a tagged production-config version is deployed)', () => {
  it('a version tagged prod-<12 hex> with the production API_MACHINE_HOSTS passes (committed config)', async () => {
    const r = await run(['version', write('ok.json', versionJson())]);
    expect(r.code).toBe(0);
  });

  it('the JSON may be surrounded by log lines', async () => {
    const r = await run(['version', write('noisy.json', `wrangler 4.145.0\n${versionJson()}\n`)]);
    expect(r.code).toBe(0);
  });

  it('a version without a tag fails', async () => {
    const r = await run(['version', write('untagged.json', versionJson({ tag: null }))]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('has no tag');
  });

  it.each([
    ['a preview message as tag', 'staging'],
    ['a short hash', `prod-${hex(7)}`],
    ['13 hex digits', `prod-${hex(13)}`],
    ['upper-case hex', `prod-${hex(12).toUpperCase().replace(/[0-9]/g, 'A')}`],
    ['another prefix', `preview-${hex(12)}`],
  ])('a version tagged with %s fails', async (_label, tag) => {
    const r = await run(['version', write('badtag.json', versionJson({ tag }))]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('is not a production tag');
  });

  it('a version uploaded with the preview config (API_MACHINE_HOSTS "") fails, also when tagged', async () => {
    const r = await run(['version', write('preview.json', versionJson({ hosts: '' }))]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('not a production-config upload');
  });

  it('a version without the API_MACHINE_HOSTS binding, or with it as another binding type, fails', async () => {
    expect((await run(['version', write('nohosts.json', versionJson({ hosts: null }))])).code).toBe(1);
    expect((await run(['version', write('typed.json', versionJson({ hostsType: 'secret_text' }))])).code).toBe(1);
  });

  it('compares with env.production of the given config', async () => {
    const config = write('other.jsonc', configText({ machineHosts: 'machines.example.test' }));
    expect((await run(['version', write('v.json', versionJson()), '--config', config])).code).toBe(1);
    expect((await run(['version', write('v2.json', versionJson({ hosts: 'machines.example.test' })), '--config', config])).code).toBe(0);
  });

  it('an unreadable or non-JSON version file is a usage error', async () => {
    expect((await run(['version', join(tmp, 'missing.json')])).code).toBe(64);
    expect((await run(['version', write('text.json', 'Version ID: 1234')])).code).toBe(64);
  });
});

// ----- site-key -----

describe('check-production site-key (production builds use the real site key)', () => {
  // Cloudflare's documented test site keys, built at run time.
  const testKeys = [`1x${'0'.repeat(20)}AA`, `2x${'0'.repeat(20)}AB`, `3x${'0'.repeat(20)}FF`, `1x${'0'.repeat(20)}BB`];
  // Real-shaped: 0x + 22 characters, built at run time.
  const realShaped = `0x${'4AAAAAAA'}${'Bc9dE_f-1'}${'q'.repeat(5)}`;

  it('an unset, empty or blank key fails', async () => {
    expect((await run(['site-key'])).code).toBe(1);
    expect((await run(['site-key'], { VITE_TURNSTILE_SITE_KEY: '' })).code).toBe(1);
    expect((await run(['site-key'], { VITE_TURNSTILE_SITE_KEY: '   ' })).code).toBe(1);
  });

  it('every Cloudflare test site key fails and is never printed', async () => {
    for (const key of testKeys) {
      const r = await run(['site-key'], { VITE_TURNSTILE_SITE_KEY: key });
      expect(r.code, key.slice(0, 2)).toBe(1);
      expect(r.out).toContain('test site key');
      expect(r.out).not.toContain(key);
    }
  });

  it('a real-shaped key passes and is never printed', async () => {
    const r = await run(['site-key'], { VITE_TURNSTILE_SITE_KEY: realShaped });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(realShaped);
  });
});

// ----- workflow -----

describe('cf-site-production.yml (every wrangler command names its environment)', () => {
  it('each wrangler call and the bundle guard select env.production; only the script comparison names the top level', () => {
    const commands = fs
      .readFileSync(WORKFLOW.pathname, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .filter((line) => /\bnpx wrangler\b|\bcheck-bundle\b/.test(line));
    expect(commands.length).toBeGreaterThanOrEqual(8);
    expect(commands.filter((line) => !/--env production\b|--env=""|^CLOUDFLARE_ENV=production /.test(line))).toEqual([]);
    expect(commands.filter((line) => line.includes('--env=""'))).toHaveLength(1);
    // The bundle guard builds the environment that is uploaded (check-bundle.mjs runs wrangler without --env).
    expect(commands.filter((line) => line.includes('check-bundle'))).toEqual(['CLOUDFLARE_ENV=production npm run check-bundle -- --build']);
  });
});

// ----- usage -----

describe('check-production entry point', () => {
  it('started through a symlinked path, it runs its checks like the script itself', async () => {
    const link = join(tmp, 'linked-check-production.mjs');
    fs.symlinkSync(SCRIPT.pathname, link);
    const config = write('linked.jsonc', configText({ kvId: '<KV_ID_FLAGS>' }));
    const r = await run(['config', '--config', config], {}, link);
    expect(r.code).toBe(1);
    expect(r.out).toContain('placeholder left in env.production: <KV_ID_FLAGS>');
    expect((await run([], {}, link)).code).toBe(64);
  });
});

describe('check-production usage', () => {
  it.each([
    [[]],
    [['deploy']],
    [['version']],
    [['version', 'a.json', 'b.json']],
    [['config', 'extra']],
    [['config', '--bogus']],
    [['config', '--config']],
    [['site-key', '--config', 'x.jsonc']],
  ])('%j exits 64 with the usage text', async (args) => {
    const r = await run(args);
    expect(r.code).toBe(64);
    expect(r.out).toContain('usage:');
  });
});
