// Configuration of microns-ops: wrangler.jsonc (Phase 2 subset), the agreement between config and code (queue
// retries and delay, secret names, OpsEnv), package scripts, .dev.vars.example and .gitignore.
// Phase 4 (agent layer): the Phase 2 expectations hold as a subset, exactly as written where Phase 4 adds
// nothing; the Phase 4 additions are asserted in their own describe block below.

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
    // Phase 4: exactly the Phase 2 keys plus the Phase 4 keys.
    expect(Object.keys(config).sort()).toEqual([...allowed, ...PHASE4_KEYS].sort());
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

  // Arrays that a later phase extends (workflows, Durable Object bindings, migration tags) are checked by
  // containment, so additions need no change here; the v1 migration tag stays first and is never edited.
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
    expect(config.kv_namespaces).toEqual([{ binding: 'FLAGS', id: '<KV_ID_FLAGS>' }]);
    expect(config.r2_buckets).toEqual([{ binding: 'PRIVATE_FILES', bucket_name: 'microns-private', jurisdiction: 'eu' }]);
    expect(config.vectorize).toEqual([{ binding: 'QUOTES_INDEX', index_name: 'quotes-v1' }]);
    expect(config.ai).toEqual({ binding: 'AI' });
    expect(config.browser).toEqual({ binding: 'BROWSER' });
    expect(config.analytics_engine_datasets).toEqual([{ binding: 'EVENTS', dataset: 'microns_events' }]);
    expect(config.ratelimits).toEqual([{ name: 'MCP_RATE_LIMIT', namespace_id: '2004', simple: { limit: 60, period: 60 } }]);
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
