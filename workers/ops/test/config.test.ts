// Configuration of microns-ops: wrangler.jsonc (Phase 2 subset), the agreement between config and code (queue
// retries and delay, secret names, OpsEnv), package scripts, .dev.vars.example and .gitignore.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OpsEnv } from '../src/env';
import { MAX_RETRIES, RETRY_DELAY_SECONDS } from '../src/queues/scrapes';

const OPS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (name: string) => readFileSync(path.join(OPS_DIR, name), 'utf8');

// JSON with comments: strips line and block comments outside strings.
function parseJsonc(text: string): any {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i];
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out);
}

const config = parseJsonc(read('wrangler.jsonc'));

const SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'APOLLO_API_KEY',
] as const;

// Compile-time: every secret name and var is a string field of OpsEnv, SCRAPES is the queue.
type SecretName = (typeof SECRET_NAMES)[number];
const envShape: Record<SecretName | 'SUPABASE_URL' | 'SITE_ORIGIN', string> = {} as Pick<OpsEnv, SecretName | 'SUPABASE_URL' | 'SITE_ORIGIN'>;
void envShape;

describe('wrangler.jsonc', () => {
  it('names the Worker, its entry module and the toolchain settings of the migration', () => {
    expect(config.name).toBe('microns-ops');
    expect(config.main).toBe('src/index.ts');
    expect(config.compatibility_date).toBe('2026-09-01');
    expect(config.compatibility_flags).toEqual(['nodejs_compat']);
    expect(config.$schema).toBe('./node_modules/wrangler/config-schema.json');
  });

  it('has no public surface: no workers.dev URL, no preview URLs, no routes', () => {
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.routes).toBeUndefined();
    expect(config.route).toBeUndefined();
  });

  it('raises the CPU limit to 300,000 ms and keeps full log sampling', () => {
    expect(config.limits).toEqual({ cpu_ms: 300000 });
    expect(config.observability).toEqual({ enabled: true, head_sampling_rate: 1 });
  });

  it('aliases qrcode to its server build, by a path relative to this folder that exists', () => {
    expect(config.alias).toEqual({ qrcode: './../../node_modules/qrcode/lib/server.js' });
    expect(existsSync(path.resolve(OPS_DIR, config.alias.qrcode))).toBe(true);
  });

  it('vars: SUPABASE_URL and SITE_ORIGIN only', () => {
    expect(config.vars).toEqual({ SUPABASE_URL: 'https://cfjrtmtaitwzggzpkhxi.supabase.co', SITE_ORIGIN: 'https://www.micronshub.eu' });
  });

  it('queue scrapes: producer SCRAPES and the consumer settings the code relies on', () => {
    expect(config.queues.producers).toEqual([{ binding: 'SCRAPES', queue: 'scrapes' }]);
    expect(config.queues.consumers).toEqual([
      { queue: 'scrapes', max_batch_size: 1, max_retries: 3, max_concurrency: 2, retry_delay: 300, dead_letter_queue: 'scrapes-dlq' },
    ]);
    expect(config.queues.consumers[0].max_retries).toBe(MAX_RETRIES);
    expect(config.queues.consumers[0].retry_delay).toBe(RETRY_DELAY_SECONDS);
  });

  it('secrets.required lists exactly the Phase 2 names', () => {
    expect(config.secrets).toEqual({ required: [...SECRET_NAMES] });
  });

  it('carries no other binding and no VITE_* name', () => {
    const allowed = ['$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls', 'observability', 'limits', 'alias', 'vars', 'queues', 'secrets'];
    expect(Object.keys(config).sort()).toEqual([...allowed].sort());
    expect(read('wrangler.jsonc')).not.toMatch(/VITE_/);
  });
});

describe('package, local secrets template and ignore rules', () => {
  const pkg = JSON.parse(read('package.json'));

  it('scripts: dev, test, typecheck, build:dry (dry run with metafile, then the bundle check), test:integration', () => {
    expect(pkg.scripts).toMatchObject({
      dev: 'wrangler dev --local --port 8788',
      test: 'vitest run',
      typecheck: 'tsc -p tsconfig.json --noEmit',
      'test:integration': 'vitest run -c vitest.t2.config.ts',
    });
    expect(pkg.scripts['build:dry']).toBe('wrangler deploy --dry-run --outdir .wrangler/dry --metafile .wrangler/dry/meta.json && node scripts/check-bundle.mjs');
  });

  it('dependencies keep the pinned toolchain', () => {
    expect(pkg.dependencies).toEqual({ hono: '4.13.12' });
    expect(pkg.devDependencies).toEqual({
      '@cloudflare/workers-types': '5.20260930.2', typescript: '7.0.2', vitest: '5.0.3', wrangler: '4.145.0',
    });
  });

  it('.dev.vars.example names every required secret, with dummy values only', () => {
    const entries = read('.dev.vars.example')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      .map((line) => line.split('='));
    expect(entries.map(([name]) => name)).toEqual([...SECRET_NAMES]);
    for (const [, value] of entries) expect(value).toBe('dummy-not-a-secret');
  });

  it('.gitignore ignores .dev.vars and .wrangler but keeps the template', () => {
    const lines = read('.gitignore').split('\n');
    expect(lines).toEqual(expect.arrayContaining(['node_modules/', '.wrangler/', '.dev.vars', '.dev.vars.*', '!.dev.vars.example']));
    expect(lines.indexOf('!.dev.vars.example')).toBeGreaterThan(lines.indexOf('.dev.vars.*'));
  });
});
