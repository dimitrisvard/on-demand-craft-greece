// scripts/r2-to-legacy-s3.mjs (owner-run rollback copy) against the fake S3 over HTTP: the AWS SDK of the root
// node_modules signs every request and the fake re-verifies it. The dry run must write nothing.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeS3, type FakeBucketConfig } from '../helpers/fake-s3';

const NODE_CHILD_PROCESS: string = 'node:child_process';
const NODE_FS: string = 'node:fs';
const NODE_OS: string = 'node:os';
const SCRIPT_DIR = new URL('../../../../scripts/', (import.meta as unknown as { url: string }).url).pathname;
const SCRIPT = `${SCRIPT_DIR}r2-to-legacy-s3.mjs`;

const R2_ID = ['r2', 'rollback', 'test', 'id'].join('-');
const R2_SECRET = ['r2', 'rollback', 'test', 'secret'].join('/');
const OWNER_ID = ['owner', 'rollback', 'test', 'id'].join('-');
const OWNER_SECRET = ['owner', 'rollback', 'test', 'secret'].join('/');

const BUCKETS: FakeBucketConfig[] = [
  { name: 'microns-private', host: 'acct.eu.r2.cloudflarestorage.com', style: 'path', region: 'auto', accessKeyId: R2_ID, secretAccessKey: R2_SECRET },
  { name: 't2-rfq', host: 't2-rfq.s3.eu-north-1.amazonaws.com', style: 'virtual', region: 'eu-north-1', accessKeyId: OWNER_ID, secretAccessKey: OWNER_SECRET },
];

const fake = createFakeS3(BUCKETS);
let endpoint = '';
let close: () => Promise<void> = async () => undefined;

interface NodeFs {
  mkdtempSync(prefix: string): string;
  symlinkSync(target: string, path: string): void;
  rmSync(path: string, o: { recursive: boolean; force: boolean }): void;
}

interface ChildProcess {
  execFile(
    file: string,
    args: string[],
    options: { env: Record<string, string>; timeout: number },
    cb: (error: { code?: number } | null, stdout: string, stderr: string) => void,
  ): unknown;
}

async function run(args: string[], extraEnv: Record<string, string> = {}, script = SCRIPT): Promise<{ code: number; stdout: string; stderr: string }> {
  const cp = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as ChildProcess;
  const proc = (globalThis as unknown as { process: { execPath: string; env: Record<string, string> } }).process;
  // Only the variables the script needs (no AWS profile, no endpoint override from the developer's shell).
  const env: Record<string, string> = {
    PATH: proc.env.PATH ?? '',
    HOME: '/nonexistent',
    AWS_CONFIG_FILE: '/nonexistent',
    AWS_SHARED_CREDENTIALS_FILE: '/nonexistent',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: R2_ID,
    R2_SECRET_ACCESS_KEY: R2_SECRET,
    LEGACY_S3_RFQ_BUCKET: 't2-rfq',
    LEGACY_S3_REGION: 'eu-north-1',
    AWS_ACCESS_KEY_ID: OWNER_ID,
    AWS_SECRET_ACCESS_KEY: OWNER_SECRET,
    ...extraEnv,
  };
  return new Promise((resolve) => {
    cp.execFile(proc.execPath, [script, ...args], { env, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
    });
  });
}

function seed(): void {
  fake.seed('microns-private', 'rfq/RFQ-01102026-1/part-a/old.step', 'old', { lastModified: new Date('2026-10-01T09:00:00Z') });
  fake.seed('microns-private', 'rfq/RFQ-03102026-2/part-a/dup.pdf', 'r2 copy', { contentType: 'application/pdf', lastModified: new Date('2026-10-03T09:00:00Z') });
  fake.seed('microns-private', 'rfq/RFQ-04102026-3/part-b/new file.dxf', 'dxf bytes', { contentType: 'application/dxf', lastModified: new Date('2026-10-04T09:00:00Z') });
  fake.seed('microns-private', 'other/not-rfq.bin', 'x', { lastModified: new Date('2026-10-04T09:00:00Z') });
  // The legacy copy of dup.pdf was written after the R2 one.
  fake.seed('t2-rfq', 'RFQ-03102026-2/part-a/dup.pdf', 'legacy copy', { contentType: 'application/pdf', lastModified: new Date('2026-10-03T10:00:00Z') });
}

beforeAll(async () => {
  const server = await fake.listen();
  endpoint = server.url;
  close = server.close;
});

afterAll(async () => {
  await close();
});

beforeEach(() => {
  fake.reset();
  seed();
});

describe('scripts/r2-to-legacy-s3.mjs', () => {
  it('--help prints the usage and exits 0', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: node scripts/r2-to-legacy-s3.mjs');
    expect(r.stdout).toContain('--dry-run');
  });

  it('runs the same when started through a symlinked directory', async () => {
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
    const os = (await import(/* @vite-ignore */ NODE_OS)) as { tmpdir(): string };
    const dir = fs.mkdtempSync(`${os.tmpdir()}/r2-rollback-link-`);
    try {
      const link = `${dir}/scripts-link`;
      fs.symlinkSync(SCRIPT_DIR.replace(/\/$/, ''), link);
      const script = `${link}/r2-to-legacy-s3.mjs`;
      const help = await run(['--help'], {}, script);
      expect(help.code).toBe(0);
      expect(help.stdout).toContain('Usage: node scripts/r2-to-legacy-s3.mjs');
      const missing = await run(['--execute'], { R2_ACCESS_KEY_ID: '' }, script);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain('missing environment: R2_ACCESS_KEY_ID');
      const dry = await run(['--endpoint', endpoint], {}, script);
      expect(dry.code).toBe(0);
      expect(dry.stdout).toContain('mode=dry-run');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses unknown options and missing environment with exit 2, naming the variables only', async () => {
    expect((await run(['--bogus'])).code).toBe(2);
    expect((await run(['--execute', '--dry-run'])).code).toBe(2);
    expect((await run(['--since', 'yesterday'])).code).toBe(2);
    const r = await run(['--endpoint', endpoint], { R2_ACCESS_KEY_ID: '' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('missing environment: R2_ACCESS_KEY_ID');
  });

  it('dry run (default) lists the keys to copy, skips existing and older ones, and writes nothing', async () => {
    const r = await run(['--since', '2026-10-02T00:00:00Z', '--endpoint', endpoint]);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('mode=dry-run');
    expect(r.stdout).toContain('would copy     rfq/RFQ-04102026-3/part-b/new file.dxf -> RFQ-04102026-3/part-b/new file.dxf (9 bytes)');
    expect(r.stdout).toContain('skip (legacy newer)  rfq/RFQ-03102026-2/part-a/dup.pdf -> RFQ-03102026-2/part-a/dup.pdf');
    expect(r.stdout).not.toContain('old.step');
    expect(r.stdout).not.toContain('not-rfq');
    expect(r.stdout).toContain('listed=3 older=1 same=0 legacy_newer=1 exists=0 would_copy=1 failed=0');
    expect(fake.writes()).toEqual([]);
    expect(fake.calls.some((c) => c.op === 'denied')).toBe(false);
    for (const secret of [R2_SECRET, OWNER_SECRET, R2_ID, OWNER_ID]) expect(r.stdout + r.stderr).not.toContain(secret);
  });

  it('--execute copies the bytes and content type to the legacy key; a newer legacy copy is kept unless --overwrite', async () => {
    const r = await run(['--execute', '--endpoint', endpoint]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('listed=3 older=0 same=0 legacy_newer=1 exists=0 copied=2 failed=0');
    const copied = fake.object('t2-rfq', 'RFQ-04102026-3/part-b/new file.dxf');
    expect(new TextDecoder().decode(copied?.body)).toBe('dxf bytes');
    expect(copied?.contentType).toBe('application/dxf');
    expect(new TextDecoder().decode(fake.object('t2-rfq', 'RFQ-03102026-2/part-a/dup.pdf')?.body)).toBe('legacy copy');
    expect(fake.keys('microns-private')).toHaveLength(4);

    const again = await run(['--execute', '--overwrite', '--prefix', 'RFQ-03102026-2/', '--endpoint', endpoint]);
    expect(again.stdout).toContain('copied=1');
    expect(new TextDecoder().decode(fake.object('t2-rfq', 'RFQ-03102026-2/part-a/dup.pdf')?.body)).toBe('r2 copy');
  });

  it('replaces an older legacy copy with the newer R2 revision by default; identical copies are skipped', async () => {
    fake.reset();
    fake.seed('t2-rfq', 'RFQ-01092026-4/drawing.pdf', 'revision A (legacy)', { contentType: 'application/pdf', lastModified: new Date('2026-09-01T00:00:00Z') });
    fake.seed('microns-private', 'rfq/RFQ-01092026-4/drawing.pdf', 'revision B', { contentType: 'application/pdf', lastModified: new Date('2026-10-03T00:00:00Z') });
    fake.seed('t2-rfq', 'RFQ-01092026-4/same.step', 'same bytes', { lastModified: new Date('2026-09-01T00:00:00Z') });
    fake.seed('microns-private', 'rfq/RFQ-01092026-4/same.step', 'same bytes', { lastModified: new Date('2026-10-03T00:00:00Z') });

    const dry = await run(['--endpoint', endpoint]);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('would replace  rfq/RFQ-01092026-4/drawing.pdf -> RFQ-01092026-4/drawing.pdf (10 bytes; legacy copy is older)');
    expect(dry.stdout).toContain('skip (same)    rfq/RFQ-01092026-4/same.step -> RFQ-01092026-4/same.step');
    expect(dry.stdout).toContain('listed=2 older=0 same=1 legacy_newer=0 exists=0 would_copy=1 failed=0');
    expect(fake.writes()).toEqual([]);

    const r = await run(['--execute', '--endpoint', endpoint]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('replaced       rfq/RFQ-01092026-4/drawing.pdf -> RFQ-01092026-4/drawing.pdf (10 bytes)');
    expect(r.stdout).toContain('listed=2 older=0 same=1 legacy_newer=0 exists=0 copied=1 failed=0');
    expect(new TextDecoder().decode(fake.object('t2-rfq', 'RFQ-01092026-4/drawing.pdf')?.body)).toBe('revision B');
  });

  it('--keep-existing skips every key the legacy bucket already holds; it excludes --overwrite', async () => {
    fake.reset();
    fake.seed('t2-rfq', 'RFQ-01092026-4/drawing.pdf', 'revision A (legacy)', { lastModified: new Date('2026-09-01T00:00:00Z') });
    fake.seed('microns-private', 'rfq/RFQ-01092026-4/drawing.pdf', 'revision B', { lastModified: new Date('2026-10-03T00:00:00Z') });
    const r = await run(['--execute', '--keep-existing', '--endpoint', endpoint]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('skip (exists)  rfq/RFQ-01092026-4/drawing.pdf -> RFQ-01092026-4/drawing.pdf');
    expect(r.stdout).toContain('listed=1 older=0 same=0 legacy_newer=0 exists=1 copied=0 failed=0');
    expect(new TextDecoder().decode(fake.object('t2-rfq', 'RFQ-01092026-4/drawing.pdf')?.body)).toBe('revision A (legacy)');
    expect((await run(['--keep-existing', '--overwrite'])).code).toBe(2);
  });

  it('reports a refused copy per key and exits 1', async () => {
    const r = await run(['--execute', '--endpoint', endpoint], { AWS_SECRET_ACCESS_KEY: 'wrong' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('failed');
    expect(fake.keys('t2-rfq')).toEqual(['RFQ-03102026-2/part-a/dup.pdf']);
  });
});
