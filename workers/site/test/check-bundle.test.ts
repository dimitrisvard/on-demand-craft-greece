// Bundle guard of microns-site (scripts/check-bundle.mjs, exit gate 9): which metafile inputs count as forbidden,
// and the exit status of the script on small fixture metafiles. The fixtures name files that need not exist: the
// guard reads only the metafile.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NODE_CHILD_PROCESS: string = 'node:child_process';
const NODE_FS: string = 'node:fs';
const NODE_OS: string = 'node:os';
const NODE_PATH: string = 'node:path';
const SCRIPT = new URL('../scripts/check-bundle.mjs', (import.meta as unknown as { url: string }).url);

type ForbiddenReason = (repoPath: string) => string | null;

interface NodeFs {
  mkdtempSync(prefix: string): string;
  writeFileSync(path: string, data: string): void;
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

let forbiddenReason: ForbiddenReason;
let fs: NodeFs;
let join: (...parts: string[]) => string;
let tmp = '';

beforeAll(async () => {
  // A variable specifier: the guard is a plain .mjs script without type declarations.
  forbiddenReason = ((await import(/* @vite-ignore */ SCRIPT.href)) as { forbiddenReason: ForbiddenReason }).forbiddenReason;
  fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  join = ((await import(/* @vite-ignore */ NODE_PATH)) as { join: (...parts: string[]) => string }).join;
  const os = (await import(/* @vite-ignore */ NODE_OS)) as { tmpdir(): string };
  tmp = fs.mkdtempSync(join(os.tmpdir(), 'check-bundle-test-'));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

async function runGuard(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const cp = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as ChildProcess;
  const proc = (globalThis as unknown as { process: { execPath: string; env: Record<string, string | undefined> } }).process;
  const siteDir = new URL('..', SCRIPT).pathname;
  // Only PATH: no GITHUB_STEP_SUMMARY, so a CI run of this suite never writes fixture reports into the job summary.
  const env: Record<string, string> = { PATH: proc.env.PATH ?? '' };
  return new Promise((resolve) => {
    cp.execFile(proc.execPath, [SCRIPT.pathname, ...args], { cwd: siteDir, env, timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? -1) : 0, stdout, stderr });
    });
  });
}

function writeMetafile(name: string, inputs: string[], outputs: Record<string, { bytes: number }> = {}): string {
  const file = join(tmp, name);
  const meta = { inputs: Object.fromEntries(inputs.map((input, i) => [input, { bytes: 1000 + i, imports: [] }])), outputs };
  fs.writeFileSync(file, JSON.stringify(meta));
  return file;
}

describe('forbiddenReason: code that belongs to microns-ops or to the legacy S3 handler', () => {
  it.each([
    'node_modules/@aws-sdk/client-s3/dist-es/index.js',
    'node_modules/@smithy/signature-v4/dist-es/SignatureV4.js',
    'node_modules/pdf-lib/es/index.js',
    'node_modules/@pdf-lib/standard-fonts/es/index.js',
    'node_modules/qrcode/lib/server.js',
    'node_modules/pngjs/lib/png.js',
    'node_modules/makerjs/dist/index.js',
    'node_modules/dxf-parser/dist/dxf-parser.js',
    'node_modules/clipper-lib/clipper.js',
    'node_modules/resend/node_modules/@smithy/util-utf8/dist-es/index.js',
    'workers/site/node_modules/qrcode/lib/browser.js',
  ])('%s is an ops-only package', (input) => {
    expect(forbiddenReason(input)).toBe('ops-only package');
  });

  it.each(['lib/nesting/index.js', 'lib/nesting/geometry/clip.js', 'lib/inventory/labels.js'])('%s is ops-only lib code', (input) => {
    expect(forbiddenReason(input)).toBe('ops-only lib');
  });

  it.each([
    'api/s3.js',
    'api/notifications.js',
    'api/gsc.js',
    'api/tenders.js',
    'api/tender-scan.js',
    'api/funded-startups.js',
    'api/scrape-website.js',
    'api/scrape-company-profile.js',
    'api/scan-directory.js',
    'api/scrape-anything-new.mjs',
  ])('%s is a handler outside the site', (input) => {
    expect(forbiddenReason(input)).toBe('handler outside the site');
  });

  it.each([
    'api/emails.js',
    'api/marketing.js',
    'api/sitemap.js',
    'api/_lib/admin-auth.js',
    'workers/site/src/index.ts',
    'workers/site/src/api/router.ts',
    'workers/shared/src/compat/vercel-node.ts',
    'node_modules/@supabase/supabase-js/dist/module/index.js',
    'node_modules/@supabase/postgrest-js/dist/esm/wrapper.mjs',
    'node_modules/resend/dist/index.mjs',
    'node_modules/qrcode-terminal/lib/main.js',
    'node_modules/pdf-lib-extras/index.js',
    'node_modules/some-package/lib/nesting/index.js',
  ])('%s is allowed', (input) => {
    expect(forbiddenReason(input)).toBeNull();
  });
});

describe('the script on a metafile', () => {
  it('exits 1 and lists every forbidden input, with the reason, when the bundle holds ops code', async () => {
    const metafile = writeMetafile('forbidden.json', [
      'src/index.ts',
      '../../api/emails.js',
      '../../api/s3.js',
      '../../node_modules/@aws-sdk/client-s3/dist-es/index.js',
      '../../lib/nesting/index.js',
      '../../node_modules/qrcode/lib/server.js',
    ]);
    const run = await runGuard(['--metafile', metafile]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('check-bundle: FAIL, 4 forbidden input(s) in the microns-site bundle');
    expect(run.stdout).toContain('inputs: 6, forbidden: 4');
    for (const line of [
      'api/s3.js (handler outside the site)',
      'node_modules/@aws-sdk/client-s3/dist-es/index.js (ops-only package)',
      'lib/nesting/index.js (ops-only lib)',
      'node_modules/qrcode/lib/server.js (ops-only package)',
    ]) {
      expect(run.stdout).toContain(`  ${line}\n`);
    }
    expect(run.stdout).not.toContain('api/emails.js (');
    expect(run.stdout).not.toContain('check-bundle: OK');
  });

  it('exits 0 with the size report when every input is allowed', async () => {
    const metafile = writeMetafile(
      'clean.json',
      ['src/index.ts', '../../api/emails.js', '../../api/marketing.js', '../shared/src/compat/vercel-node.ts', '../../node_modules/@supabase/supabase-js/dist/module/index.js'],
      { [join(tmp, 'missing-output.js')]: { bytes: 2048 } },
    );
    const run = await runGuard(['--metafile', metafile]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('inputs: 5, forbidden: 0');
    expect(run.stdout).toContain(': 2.00 KiB / gzip n/a (output file missing)');
    expect(run.stdout).toContain('largest inputs by package:');
    expect(run.stdout).toContain('check-bundle: OK, no forbidden input');
    expect(run.stderr).toBe('');
  });

  it('exits 2 without building when a named metafile does not exist', async () => {
    const run = await runGuard(['--metafile', join(tmp, 'absent.json')]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('check-bundle: metafile not found');
    expect(run.stdout).not.toContain('wrangler deploy --dry-run');
  });
});
