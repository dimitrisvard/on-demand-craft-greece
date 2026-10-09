// Configuration of microns-ops: wrangler.jsonc (Phase 2 subset), the agreement between config and code (queue
// retries and delay, secret names, OpsEnv), package scripts, .dev.vars.example and .gitignore.
// Phase 4 (agent layer): the Phase 2 expectations hold as a subset, exactly as written where Phase 4 adds
// nothing; the Phase 4 additions are asserted in their own describe block below.
// Phase 5 (consolidated compute): the same rule; the Phase 2 and Phase 4 expectations stay as written (the exact
// top-level key list gains the Phase 5 key), and the Phase 5 additions have their own describe block at the end.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OpsEnv } from '../src/env';
import { P5_T2_ONLY_VARS } from '../src/ports/p5';
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

// ----- Phase 4 (agent layer) expectations -----
const PHASE4_KEYS = [
  'kv_namespaces', 'r2_buckets', 'workflows', 'durable_objects', 'migrations', 'vectorize', 'ai', 'browser',
  'analytics_engine_datasets', 'ratelimits', 'routes', 'rules', 'triggers',
];
const PHASE4_ROUTES = [{ pattern: 'mcp.micronshub.eu', custom_domain: true }];
const PHASE4_VARS = {
  AI_GATEWAY_ID: 'microns',
  AGENT_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  QUOTE_FROM: 'MicronsHub Quotations <info@micronshub.eu>',
  QUOTE_REPLY_TO: 'replies@rfq.micronshub.eu',
  MESSAGE_ID_DOMAIN: 'rfq.micronshub.eu',
  CAD_BACKEND_DEFAULT: 'vps',
  MCP_HOSTNAME: 'mcp.micronshub.eu',
  MCP_ROUTE: '/mcp',
  ACCESS_TEAM_DOMAIN: '<ACCESS_TEAM_DOMAIN>',
  MCP_ACCESS_AUD: '<ACCESS_AUD_MCP>',
  SCRAPER_USER_AGENT: 'MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)',
  SCRAPER_PERMITTED_HOSTS: '{}',
};
// Names that only generated T2 configs may set (never production vars).
const T2_ONLY_VAR = /^(AGENT_STUBS|AGENT_LLM_BASE_URL|GOOGLE_TOKEN_URL|.*_API_BASE)$/;
const PHASE4_SECRET_NAMES = [
  'AI_GATEWAY_TOKEN', 'CAD_UNFOLD_URL', 'CAD_SHARED_SECRET', 'AGENT_APPROVAL_SECRET', 'CAD_ACCESS_CLIENT_ID', 'CAD_ACCESS_CLIENT_SECRET',
] as const;
const PHASE4_DEPENDENCIES = {
  '@anthropic-ai/sdk': '0.131.0',
  zod: '4.6.5',
  'postal-mime': '2.7.4',
  '@pdf-lib/fontkit': '1.1.1',
  agents: '0.24.0',
  '@modelcontextprotocol/server': '2.0.0',
  '@modelcontextprotocol/sdk': '1.30.0',
  '@modelcontextprotocol/client': '2.0.0',
  '@cloudflare/puppeteer': '1.4.0',
};
const PHASE4_SCRIPTS = {
  'test:integration:agents': 'T2_PROFILE=agents vitest run -c vitest.t2.agents.config.ts',
  'eval:synthetic': 'vitest run -c eval/vitest.eval.config.ts',
  'eval:live': 'EVAL_MODE=live vitest run -c eval/vitest.eval.config.ts',
  'pdf:samples': 'PDF_SAMPLES=1 vitest run test/pdf/samples.test.ts',
  'mcp:parity': 'MCP_PARITY=1 vitest run test/mcp/parity.test.ts',
};

// ----- Phase 5 (consolidated compute) expectations -----
const PHASE5_KEYS = ['containers'];
const PHASE5_VARS = {
  TRACKING_DOMAIN: 'https://micronshub.eu',
  DIGEST_FROM: 'MicronsHub Ops <info@micronshub.eu>',
  MARKETING_FOLLOWUPS_ENABLED: 'false',
  MARKETING_WARMUP_ENABLED: 'false',
  OUTBOUND_MAIL_PAUSED: 'false',
  OUTBOUND_MAIL_STOPPED: 'false',
  CAD_SLOTS: '3',
  CAD_INPUT_HOSTS: '<CAD_INPUT_HOSTS>',
  CAD_PROCESSING_TIMEOUT_S: '120',
  CAD_KEEP_WARM: 'off',
} as const;
const PHASE5_T2_ONLY_NAMES = ['PULLPUSH_API_BASE', 'HN_API_BASE', 'XOMETRY_API_BASE', 'INDEXNOW_API_BASE', 'AGENT_GEMINI_BASE_URL', 'CAD_CONTAINER_BASE_URL', 'CONTENT_WAIT_TIMEOUT_S'];
const PHASE5_SECRET_NAMES = ['INDEXNOW_KEY', 'XOMETRY_TOKEN', 'XOMETRY_COOKIE'] as const;
const PHASE5_PRODUCERS = [
  { binding: 'TRANSLATIONS', queue: 'translations' },
  { binding: 'OUTBOUND_MAIL', queue: 'outbound-mail' },
];
const PHASE5_CONSUMERS = [
  { queue: 'translations', max_batch_size: 1, max_retries: 5, retry_delay: 120, max_concurrency: 3, dead_letter_queue: 'translations-dlq' },
  { queue: 'outbound-mail', max_batch_size: 10, max_retries: 3, retry_delay: 60, max_concurrency: 2, dead_letter_queue: 'outbound-mail-dlq' },
];
const PHASE5_WORKFLOWS = [
  { name: 'content-daily', binding: 'CONTENT_DAILY', class_name: 'ContentDailyWorkflow' },
  { name: 'sitemap', binding: 'SITEMAP', class_name: 'SitemapWorkflow' },
  { name: 'ops-digest', binding: 'OPS_DIGEST', class_name: 'OpsDigestWorkflow' },
];
const PHASE5_DURABLE_OBJECTS = [
  { name: 'SENDER_LIMITER', class_name: 'SenderLimiter' },
  { name: 'CAD_CONTAINER', class_name: 'CadContainer' },
];
const PHASE5_MIGRATION = { tag: 'v2', new_sqlite_classes: ['SenderLimiter', 'CadContainer'] };
const PHASE5_CONTAINERS = [{
  name: 'microns-cad',
  class_name: 'CadContainer',
  image: 'registry.cloudflare.com/<CF_ACCOUNT_ID>/microns-cad:<IMAGE_TAG>',
  instance_type: 'standard-1',
  max_instances: 3,
}];

// Compile-time (Phase 5): every Phase 5 var, T2-only name and secret is an optional string field of OpsEnv (an
// OpsEnv literal with Phase 2 fields only stays valid), and the bindings are optional too.
type Phase5StringName = keyof typeof PHASE5_VARS | (typeof P5_T2_ONLY_VARS)[number] | (typeof PHASE5_SECRET_NAMES)[number];
const phase5Optional = {} satisfies Pick<OpsEnv, Phase5StringName>;
const phase5Strings: Partial<Record<Phase5StringName, string>> = phase5Optional as Pick<OpsEnv, Phase5StringName>;
const phase5Bindings: Pick<OpsEnv, 'TRANSLATIONS' | 'OUTBOUND_MAIL' | 'CONTENT_DAILY' | 'SITEMAP' | 'OPS_DIGEST' | 'SENDER_LIMITER' | 'CAD_CONTAINER' | 'SEO_CACHE'> = {};
void phase5Strings;
void phase5Bindings;

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
    // Phase 4: the only route is the remote MCP Custom Domain (asserted exactly in the Phase 4 block).
    expect(config.routes).toEqual(PHASE4_ROUTES);
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
    // Phase 4: the Phase 2 vars with their values are a subset; the Phase 4 vars are asserted below.
    expect(config.vars).toMatchObject({ SUPABASE_URL: 'https://cfjrtmtaitwzggzpkhxi.supabase.co', SITE_ORIGIN: 'https://www.micronshub.eu' });
  });

  it('queue scrapes: producer SCRAPES and the consumer settings the code relies on', () => {
    // Phase 4: the scrapes producer and consumer objects are unchanged and stay first; other queues follow.
    expect(config.queues.producers).toContainEqual({ binding: 'SCRAPES', queue: 'scrapes' });
    expect(config.queues.consumers).toContainEqual(
      { queue: 'scrapes', max_batch_size: 1, max_retries: 3, max_concurrency: 2, retry_delay: 300, dead_letter_queue: 'scrapes-dlq' },
    );
    expect(config.queues.consumers[0].queue).toBe('scrapes');
    expect(config.queues.consumers[0].max_retries).toBe(MAX_RETRIES);
    expect(config.queues.consumers[0].retry_delay).toBe(RETRY_DELAY_SECONDS);
  });

  it('secrets.required lists exactly the Phase 2 names', () => {
    expect(config.secrets).toEqual({ required: [...SECRET_NAMES] });
  });

  it('carries no other binding and no VITE_* name', () => {
    const allowed = ['$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls', 'observability', 'limits', 'alias', 'vars', 'queues', 'secrets'];
    // Phase 4: exactly the Phase 2 keys plus the Phase 4 keys; Phase 5: plus the Phase 5 keys.
    expect(Object.keys(config).sort()).toEqual([...allowed, ...PHASE4_KEYS, ...PHASE5_KEYS].sort());
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
    // Phase 4 script names are asserted in the Phase 4 block.
  });

  it('dependencies keep the pinned toolchain', () => {
    // Phase 4: hono is a subset; the Phase 4 pins are asserted below.
    expect(pkg.dependencies).toMatchObject({ hono: '4.13.12' });
    expect(pkg.devDependencies).toEqual({
      '@cloudflare/workers-types': '5.20260930.2', typescript: '7.0.2', vitest: '5.0.3', wrangler: '4.145.0',
    });
  });

  it('.dev.vars.example names every required secret, with dummy values only', () => {
    const entries = read('.dev.vars.example')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      .map((line) => line.split('='));
    // Phase 4: the ten Phase 2 names come first, in order; the Phase 4 names follow (asserted below).
    expect(entries.map(([name]) => name).slice(0, SECRET_NAMES.length)).toEqual([...SECRET_NAMES]);
    for (const [, value] of entries) expect(value).toBe('dummy-not-a-secret');
  });

  it('.gitignore ignores .dev.vars and .wrangler but keeps the template', () => {
    const lines = read('.gitignore').split('\n');
    expect(lines).toEqual(expect.arrayContaining(['node_modules/', '.wrangler/', '.dev.vars', '.dev.vars.*', '!.dev.vars.example']));
    expect(lines.indexOf('!.dev.vars.example')).toBeGreaterThan(lines.indexOf('.dev.vars.*'));
  });
});

describe('Phase 4 additions (agent layer)', () => {
  const pkg = JSON.parse(read('package.json'));

  it('vars: the Phase 4 vars with their values, and no T2-only override', () => {
    expect(config.vars).toMatchObject(PHASE4_VARS);
    for (const name of Object.keys(config.vars)) expect(name).not.toMatch(T2_ONLY_VAR);
  });

  it('queues cad-jobs and agent-events: producers and consumers', () => {
    expect(config.queues.producers).toEqual(expect.arrayContaining([
      { binding: 'CAD_JOBS', queue: 'cad-jobs' },
      { binding: 'AGENT_EVENTS', queue: 'agent-events' },
    ]));
    expect(config.queues.consumers).toContainEqual(
      { queue: 'cad-jobs', max_batch_size: 1, max_retries: 2, max_concurrency: 3, dead_letter_queue: 'cad-jobs-dlq' },
    );
    expect(config.queues.consumers).toContainEqual(
      { queue: 'agent-events', max_batch_size: 25, max_batch_timeout: 10, max_retries: 3, dead_letter_queue: 'agent-events-dlq' },
    );
  });

  // Arrays that a later phase extends (workflows, Durable Object bindings, migration tags, KV namespaces, R2 buckets,
  // Vectorize indexes, Analytics Engine datasets, rate limits) are checked by containment, so additions need no change
  // here; the v1 migration tag stays first and is never edited.
  it('Workflows, Durable Objects (migration tag v1) and the other agent bindings', () => {
    expect(config.workflows).toEqual(expect.arrayContaining([
      { name: 'rfq-intake', binding: 'RFQ_INTAKE', class_name: 'RfqIntakeWorkflow' },
      { name: 'quote', binding: 'QUOTE', class_name: 'QuoteWorkflow' },
      { name: 'post-order', binding: 'POST_ORDER', class_name: 'PostOrderWorkflow' },
    ]));
    expect(config.durable_objects.bindings).toEqual(expect.arrayContaining([
      { name: 'RFQ_THREAD', class_name: 'RfqThread' },
      { name: 'MATERIAL_STOCK', class_name: 'MaterialStock' },
      { name: 'CAD_ROUTER', class_name: 'CadRouter' },
    ]));
    expect(config.migrations[0]).toEqual({ tag: 'v1', new_sqlite_classes: ['RfqThread', 'MaterialStock', 'CadRouter'] });
    expect(config.kv_namespaces).toContainEqual({ binding: 'FLAGS', id: '<KV_ID_FLAGS>' });
    expect(config.r2_buckets).toContainEqual({ binding: 'PRIVATE_FILES', bucket_name: 'microns-private', jurisdiction: 'eu' });
    expect(config.vectorize).toContainEqual({ binding: 'QUOTES_INDEX', index_name: 'quotes-v1' });
    expect(config.ai).toEqual({ binding: 'AI' });
    expect(config.browser).toEqual({ binding: 'BROWSER' });
    expect(config.analytics_engine_datasets).toContainEqual({ binding: 'EVENTS', dataset: 'microns_events' });
    expect(config.ratelimits).toContainEqual({ name: 'MCP_RATE_LIMIT', namespace_id: '2004', simple: { limit: 60, period: 60 } });
    expect(config.routes).toEqual(PHASE4_ROUTES);
    expect(config.rules).toEqual([
      { type: 'Data', globs: ['**/*.ttf', '**/*.png'], fallthrough: true },
      { type: 'Text', globs: ['**/*.md'], fallthrough: true },
    ]);
    expect(config.triggers).toEqual({ crons: ['* * * * *', '*/10 * * * *'] });
  });

  it('secrets.required stays the Phase 2 list (Phase 4 secrets are optional and checked per use)', () => {
    expect(config.secrets.required).toEqual([...SECRET_NAMES]);
    for (const name of PHASE4_SECRET_NAMES) expect(config.secrets.required).not.toContain(name);
  });

  it('dependencies: the Phase 4 pins (exact versions); pdf-lib and supabase-js resolve from the root install', () => {
    expect(pkg.dependencies).toMatchObject(PHASE4_DEPENDENCIES);
    for (const version of Object.values(pkg.dependencies)) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['pdf-lib']).toBeUndefined();
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined();
  });

  it('overrides pin @types/node to the Node 22 types of the repository root install', () => {
    // The Anthropic SDK's declarations pull Node's types into this program (through undici-types); the Node 22
    // types (22.19.17, as in the root package-lock.json) stay compatible with the Workers globals the tests use.
    expect(pkg.overrides).toEqual({ '@types/node': '22.19.17' });
  });

  it('scripts: the Phase 4 names', () => {
    expect(pkg.scripts).toMatchObject(PHASE4_SCRIPTS);
  });

  it('.dev.vars.example lists the Phase 4 secret names after the Phase 2 names', () => {
    const names = read('.dev.vars.example')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      .map((line) => line.split('=')[0]);
    expect(names.slice(SECRET_NAMES.length)).toEqual([...PHASE4_SECRET_NAMES]);
  });

  it('.gitignore keeps eval recordings and reports out of git', () => {
    const lines = read('.gitignore').split('\n');
    expect(lines).toEqual(expect.arrayContaining(['eval/recordings/', 'eval/out/']));
  });
});

describe('Phase 5 additions (consolidated compute)', () => {
  const pkg = JSON.parse(read('package.json'));

  it('vars: the Phase 5 vars with their values; no Phase 4 or Phase 5 T2-only override', () => {
    expect(config.vars).toMatchObject(PHASE5_VARS);
    expect(P5_T2_ONLY_VARS).toEqual(PHASE5_T2_ONLY_NAMES);
    for (const name of Object.keys(config.vars)) {
      expect(name).not.toMatch(T2_ONLY_VAR);
      expect(PHASE5_T2_ONLY_NAMES).not.toContain(name);
    }
    // CAD_BACKEND_DEFAULT stays 'vps' in the merged file (asserted with the Phase 4 vars); the owner flips it at S9.
    expect(config.vars.CAD_BACKEND_DEFAULT).toBe('vps');
  });

  it('queues translations and outbound-mail: producers and consumers (exact objects); scrapes stays first', () => {
    expect(config.queues.producers).toEqual(expect.arrayContaining(PHASE5_PRODUCERS));
    for (const consumer of PHASE5_CONSUMERS) expect(config.queues.consumers).toContainEqual(consumer);
    expect(config.queues.consumers[0].queue).toBe('scrapes');
    const names = config.queues.consumers.map((c: { queue: string }) => c.queue);
    expect(new Set(names).size).toBe(names.length);
  });

  it('Workflows, Durable Objects and migration tag v2 (v1 unchanged and first)', () => {
    expect(config.workflows).toEqual(expect.arrayContaining(PHASE5_WORKFLOWS));
    expect(config.durable_objects.bindings).toEqual(expect.arrayContaining(PHASE5_DURABLE_OBJECTS));
    expect(config.migrations[0]).toEqual({ tag: 'v1', new_sqlite_classes: ['RfqThread', 'MaterialStock', 'CadRouter'] });
    expect(config.migrations).toContainEqual(PHASE5_MIGRATION);
    const tags = config.migrations.map((m: { tag: string }) => m.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('containers: the CAD Container by registry tag, standard-1, three instances; CAD_SLOTS equals max_instances', () => {
    expect(config.containers).toEqual(PHASE5_CONTAINERS);
    expect(config.vars.CAD_SLOTS).toBe(String(config.containers[0].max_instances));
    const classes = config.durable_objects.bindings.map((b: { class_name: string }) => b.class_name);
    expect(classes).toContain(config.containers[0].class_name);
    expect(PHASE5_MIGRATION.new_sqlite_classes).toContain(config.containers[0].class_name);
  });

  it('KV SEO_CACHE (same namespace as microns-site); no PUBLIC_FILES bucket, no Hyperdrive', () => {
    expect(config.kv_namespaces).toContainEqual({ binding: 'SEO_CACHE', id: '<KV_ID_SEO_CACHE>' });
    expect(config.r2_buckets.map((b: { binding: string }) => b.binding)).not.toContain('PUBLIC_FILES');
    expect(config.hyperdrive).toBeUndefined();
  });

  it('triggers and secrets.required are unchanged (the schedule is a table in code; Phase 5 secrets are checked per use)', () => {
    expect(config.triggers).toEqual({ crons: ['* * * * *', '*/10 * * * *'] });
    expect(config.secrets.required).toEqual([...SECRET_NAMES]);
    for (const name of PHASE5_SECRET_NAMES) expect(config.secrets.required).not.toContain(name);
    expect(read('wrangler.jsonc')).not.toMatch(/GEMINI_API_KEY/);
  });

  it('dependencies: @cloudflare/containers 0.3.7 (exact); devDependencies and .dev.vars.example unchanged', () => {
    expect(pkg.dependencies).toMatchObject({ '@cloudflare/containers': '0.3.7' });
    expect(pkg.devDependencies).toEqual({
      '@cloudflare/workers-types': '5.20260930.2', typescript: '7.0.2', vitest: '5.0.3', wrangler: '4.145.0',
    });
    const names = read('.dev.vars.example')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      .map((line) => line.split('=')[0]);
    expect(names).toEqual([...SECRET_NAMES, ...PHASE4_SECRET_NAMES]);
  });

  it('the lockfile resolves @cloudflare/containers 0.3.7 once, directly under workers/ops/node_modules', () => {
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.packages[''].dependencies['@cloudflare/containers']).toBe('0.3.7');
    const entries = Object.keys(lock.packages).filter((key) => key.endsWith('node_modules/@cloudflare/containers'));
    expect(entries).toEqual(['node_modules/@cloudflare/containers']);
    expect(lock.packages['node_modules/@cloudflare/containers'].version).toBe('0.3.7');
  });

  it('script test:integration:jobs runs the T2 profile jobs on its own config', () => {
    expect(pkg.scripts['test:integration:jobs']).toBe('T2_PROFILE=jobs vitest run -c vitest.t2.jobs.config.ts');
  });

  it('vitest.t2.jobs.config.ts collects exactly test/t2-jobs/**/*.jobs.ts with the Phase 2 globalSetup and timeouts', async () => {
    // Imported by URL so that the type program of this package does not take in vitest/config's declarations.
    const configUrl = new URL('../vitest.t2.jobs.config.ts', import.meta.url).href;
    const jobsT2Config = (await import(/* @vite-ignore */ configUrl)).default as { test?: Record<string, unknown> };
    const t = jobsT2Config.test ?? {};
    expect(t.include).toEqual(['test/t2-jobs/**/*.jobs.ts']);
    expect(t.environment).toBe('node');
    expect(t.globalSetup).toEqual([path.join(OPS_DIR, '..', 'site', 'test', 'integration', 'global-setup.mjs')]);
    expect(t.fileParallelism).toBe(false);
    expect(t.testTimeout).toBe(120_000);
    expect(t.hookTimeout).toBe(180_000);
  });
});
