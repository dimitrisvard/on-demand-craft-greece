// T2 harness profile 'jobs' (workers/site/test/integration/harness.mjs, Phase 5), checked without starting workerd:
// two Workers; every Phase 5 binding kept; the T2-only vars of PHASE5_SPEC §5.4 pointing at the stub (the same list
// as src/ports/p5.ts); AI, Vectorize, browser, routes, Analytics Engine and containers removed; the consumers scrapes,
// translations, outbound-mail and cad-jobs kept; the Phase 5 secret names appended with their values; the stub
// mounts the Phase 5 stub modules; the profiles 'api' and 'agents' keep their shape; the jobs config collects only
// test/t2-jobs/**/*.jobs.ts and neither earlier T2 config collects those files.

import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../../../shared/src/compat/vercel-node';
import { P5_T2_ONLY_VARS } from '../../../src/ports/p5';

interface Part {
  dir: string;
  config: Record<string, unknown> & { name: string; vars?: Record<string, string>; secrets?: { required?: string[] }; queues?: { consumers?: Array<{ queue: string }>; producers?: Array<{ binding: string }> } };
  devVars: Record<string, string>;
}
interface Generated {
  profile: string;
  site: Part;
  ops: Part;
  mail?: Part;
}
interface Harness {
  PROFILES: string[];
  AGENT_SECRET_NAMES: string[];
  JOBS_SECRET_NAMES: string[];
  JOBS_SITE_SECRET_NAMES: string[];
  JOBS_PROFILE_CONSUMERS: string[];
  JOBS_STUB_VARS: Record<string, string>;
  generateConfigs(o: Record<string, unknown>): Generated;
  jobsSecretValues(): Record<string, string>;
  urlsFile(profile?: string): string;
  parseJsonc(text: string): Record<string, unknown>;
}
interface StubServer {
  JOBS_STUB_MODULES: string[];
  AGENT_STUB_MODULES: string[];
  jobsStubModules(): Promise<Array<{ name: string; prefixes: string[] }>>;
}

const h = (await import(/* @vite-ignore */ new URL('../../../../site/test/integration/harness.mjs', import.meta.url).href)) as Harness;
const server = (await import(/* @vite-ignore */ new URL('../../../../site/test/integration/stub-server.mjs', import.meta.url).href)) as StubServer;
const STUB = 'http://127.0.0.1:9999';
const base = { stubUrl: STUB, tmp: '/tmp/t2-test', assetsDir: '/tmp/t2-test/assets' };
const secrets = { INDEXNOW_KEY: 'a1'.repeat(16), XOMETRY_TOKEN: 't2-xometry-x', CAD_COMPAT_TOKEN: 'c3'.repeat(24) };
const production = h.parseJsonc(readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8')) as Part['config'] & { queues: { consumers: Array<{ queue: string }> } };

describe('generated configs, profile jobs', () => {
  const g = h.generateConfigs({ ...base, profile: 'jobs', approvalSecret: 'b'.repeat(64), jobsSecrets: secrets });

  it('two Workers (site primary, no mail Worker)', () => {
    expect(h.PROFILES).toEqual(['api', 'agents', 'jobs']);
    expect([g.site.config.name, g.ops.config.name]).toEqual(['microns-site', 'microns-ops']);
    expect(g.mail).toBeUndefined();
    expect(h.urlsFile('jobs')).toMatch(/urls\.jobs\.json$/);
  });

  it('every Phase 5 T2-only var points at the stub; the Phase 4 stub vars as in profile agents; CAD_INPUT_HOSTS = the stub host', () => {
    const vars = g.ops.config.vars ?? {};
    // every base-URL override points at the stub; the content wait override stays unset in the shared harness (a T2
    // file that runs the timeout path starts its own harness with it, so the other files keep the 6 h wait)
    const baseUrlVars = P5_T2_ONLY_VARS.filter((name) => name !== 'CONTENT_WAIT_TIMEOUT_S');
    expect(Object.keys(h.JOBS_STUB_VARS)).toEqual(baseUrlVars);
    for (const name of baseUrlVars) expect(vars[name], name).toMatch(new RegExp(`^${STUB}/`));
    expect(vars.CONTENT_WAIT_TIMEOUT_S).toBeUndefined();
    expect(vars).toMatchObject({
      SUPABASE_URL: STUB,
      AGENT_STUBS: 'llm,embed,vector,browser',
      AGENT_LLM_BASE_URL: `${STUB}/anthropic`,
      TELEGRAM_API_BASE: `${STUB}/telegram`,
      GMAIL_API_BASE: `${STUB}/gmail`,
      AGENT_GEMINI_BASE_URL: `${STUB}/google-ai-studio`,
      CAD_CONTAINER_BASE_URL: `${STUB}/cad-container`,
      CAD_INPUT_HOSTS: '127.0.0.1,127.0.0.1:9999',
      // Production values of the Phase 5 vars are kept.
      MARKETING_FOLLOWUPS_ENABLED: 'false',
      OUTBOUND_MAIL_PAUSED: 'false',
      CAD_BACKEND_DEFAULT: 'vps',
    });
  });

  it('remote-only bindings, Analytics Engine and the containers stanza are removed; every Phase 5 binding stays', () => {
    for (const key of ['ai', 'vectorize', 'browser', 'routes', 'analytics_engine_datasets', 'containers']) expect(g.ops.config[key], key).toBeUndefined();
    const workflows = (g.ops.config.workflows as Array<{ binding: string }>).map((w) => w.binding);
    expect(workflows).toEqual(expect.arrayContaining(['CONTENT_DAILY', 'SITEMAP', 'OPS_DIGEST']));
    const dos = ((g.ops.config.durable_objects as { bindings: Array<{ name: string }> }).bindings).map((b) => b.name);
    expect(dos).toEqual(expect.arrayContaining(['SENDER_LIMITER', 'CAD_CONTAINER']));
    expect((g.ops.config.queues?.producers ?? []).map((p) => p.binding)).toEqual(expect.arrayContaining(['TRANSLATIONS', 'OUTBOUND_MAIL', 'SCRAPES']));
    expect((g.ops.config.kv_namespaces as Array<{ binding: string }>).map((k) => k.binding)).toEqual(expect.arrayContaining(['FLAGS', 'SEO_CACHE']));
  });

  it('consumers scrapes, translations, outbound-mail and cad-jobs kept with their production settings; agent-events dropped', () => {
    expect(h.JOBS_PROFILE_CONSUMERS).toEqual(['scrapes', 'translations', 'outbound-mail', 'cad-jobs']);
    const kept = g.ops.config.queues?.consumers ?? [];
    expect(kept.map((c) => c.queue).sort()).toEqual(['cad-jobs', 'outbound-mail', 'scrapes', 'translations']);
    for (const c of kept) expect(c).toEqual(production.queues.consumers.find((p) => p.queue === c.queue));
  });

  it('secret names appended to the generated secrets.required with their values (random per run); site gets the compat token', () => {
    expect(h.JOBS_SECRET_NAMES).toEqual(['INDEXNOW_KEY', 'XOMETRY_TOKEN']);
    const required = g.ops.config.secrets?.required ?? [];
    expect(required.slice(0, (production.secrets?.required ?? []).length)).toEqual(production.secrets?.required);
    expect(required.slice(-6)).toEqual([...h.AGENT_SECRET_NAMES, ...h.JOBS_SECRET_NAMES]);
    expect(g.ops.devVars).toMatchObject({ INDEXNOW_KEY: secrets.INDEXNOW_KEY, XOMETRY_TOKEN: secrets.XOMETRY_TOKEN, CAD_UNFOLD_URL: STUB, AGENT_APPROVAL_SECRET: 'b'.repeat(64) });
    expect(g.site.config.secrets?.required?.slice(-2)).toEqual(h.JOBS_SITE_SECRET_NAMES);
    expect(g.site.devVars).toMatchObject({ CAD_COMPAT_TOKEN: secrets.CAD_COMPAT_TOKEN, AGENT_APPROVAL_SECRET: 'b'.repeat(64) });
    const values = h.jobsSecretValues();
    expect(values.INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
    expect(values.CAD_COMPAT_TOKEN).toMatch(/^[0-9a-f]{48}$/);
    expect(h.jobsSecretValues().CAD_COMPAT_TOKEN).not.toBe(values.CAD_COMPAT_TOKEN);
  });

  it('opsVars override the defaults (a test that needs another value starts its own harness)', () => {
    const custom = h.generateConfigs({ ...base, profile: 'jobs', approvalSecret: 'x', jobsSecrets: secrets, opsVars: { CAD_INPUT_HOSTS: 'files.test' } });
    expect(custom.ops.config.vars?.CAD_INPUT_HOSTS).toBe('files.test');
  });
});

describe('the earlier profiles keep their shape with the Phase 5 production config', () => {
  it("profile 'agents': the Phase 4 consumers only, no Phase 5 T2 var, no containers", () => {
    const g = h.generateConfigs({ ...base, profile: 'agents', approvalSecret: 'x' });
    expect(g.ops.config.queues?.consumers?.map((c) => c.queue)).toEqual(['cad-jobs', 'agent-events']);
    for (const name of P5_T2_ONLY_VARS) expect(g.ops.config.vars?.[name], name).toBeUndefined();
    expect(g.ops.config.containers).toBeUndefined();
  });

  it("profile 'api': no consumer, no stub var, Phase 2 secrets only", () => {
    const g = h.generateConfigs({ ...base, profile: 'api' });
    expect(g.ops.config.queues?.consumers).toBeUndefined();
    expect(g.ops.config.secrets?.required).toEqual(production.secrets?.required);
    expect(g.site.config.secrets?.required).not.toContain('CAD_COMPAT_TOKEN');
  });
});

describe('stub modules of the profile jobs', () => {
  it('the seven Phase 5 modules load with their prefixes; the agents list is unchanged', async () => {
    expect(server.AGENT_STUB_MODULES).toEqual(['anthropic', 'resend', 'telegram', 'gmail', 'google-token', 'unfold', 'postgrest']);
    expect(server.JOBS_STUB_MODULES).toEqual(['pullpush', 'hn', 'xometry', 'indexnow', 'google-ai-studio', 'storage', 'cad-container']);
    const modules = await server.jobsStubModules();
    expect(modules.map((m) => m.name)).toEqual(server.JOBS_STUB_MODULES);
    for (const m of modules) expect(m.prefixes.length, m.name).toBeGreaterThan(0);
  });
});

// The tender handler api/tender-scan.js reaches its portals by country code (no base URL the stub can replace), and
// the profile 'jobs' keeps the scrapes consumer: every T2 file of the profile seeds only codes the handler refuses
// before any I/O, and the kernel file keeps the tenders flag in shadow.
describe('tender connectors seeded by the T2 files of the profile jobs', () => {
  const t2Dir = new URL('../../t2-jobs/', import.meta.url);
  const t2Files = readdirSync(t2Dir).filter((name) => name.endsWith('.jobs.ts')).sort();
  const kernelFile = readFileSync(new URL('p5-kernel.jobs.ts', t2Dir), 'utf8');
  const handlerFile = readFileSync(new URL('../../../../../api/tender-scan.js', import.meta.url), 'utf8');
  const codesOf = (text: string) => [...text.matchAll(/country_code:\s*'([A-Za-z]{2})'/g)].map((m) => (m[1] ?? '').toUpperCase());
  const seededBy = Object.fromEntries(t2Files.map((name) => [name, codesOf(readFileSync(new URL(name, t2Dir), 'utf8'))]));
  const seeded = [...new Set(Object.values(seededBy).flat())];
  const tableStart = handlerFile.indexOf('const CONNECTORS = {');
  const table = handlerFile.slice(tableStart, handlerFile.indexOf('};', tableStart));
  const connectorCodes = [...table.matchAll(/^\s*([A-Z]{2}):/gm)].map((m) => m[1] ?? '');

  it('every code seeded by any T2 file is absent from the connector table of api/tender-scan.js', () => {
    expect(connectorCodes.length).toBeGreaterThanOrEqual(20);
    expect(connectorCodes).toEqual(expect.arrayContaining(['NL', 'DE', 'FR', 'IT', 'EU']));
    expect(t2Files).toEqual(expect.arrayContaining(['p5-kernel.jobs.ts', 'p5-collectors.jobs.ts']));
    expect(seededBy['p5-kernel.jobs.ts']?.length).toBeGreaterThanOrEqual(2);
    expect(seededBy['p5-collectors.jobs.ts']?.length).toBeGreaterThanOrEqual(2);
    const real = Object.entries(seededBy).flatMap(([name, codes]) => codes.filter((c) => connectorCodes.includes(c)).map((c) => `${name}: ${c}`));
    expect(real).toEqual([]);
  });

  it('the tenders flag of the kernel file is in shadow', () => {
    expect(kernelFile).toMatch(/'agent\.growth\.tenders':\s*\{\s*enabled:\s*true,\s*mode:\s*'shadow'/);
  });

  describe('the real handler, in-process', () => {
    let network: string[];
    beforeEach(() => {
      network = [];
      vi.stubEnv('SUPABASE_URL', 'https://project.supabase.test');
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-value');
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        network.push(String(input instanceof Request ? input.url : input));
        throw new Error('network is not allowed in this test');
      }));
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('answers 400 for each seeded code and makes no request', async () => {
      const { default: handler } = (await import(/* @vite-ignore */ new URL('../../../../../api/tender-scan.js', import.meta.url).href)) as { default: VercelHandler };
      for (const code of seeded) {
        const response = await runNodeHandler(handler, {
          request: new Request('https://microns-ops.internal/api/tender-scan', { method: 'POST', headers: { 'content-type': 'application/json' } }),
          functionUrl: '/api/tender-scan',
          body: new TextEncoder().encode(JSON.stringify({ country_code: code })),
          timeoutMs: 5_000,
          logPrefix: '[microns-ops]',
        });
        expect(response.status, code).toBe(400);
        expect(await response.json(), code).toEqual({ error: `No connector for country: ${code}` });
      }
      expect(network).toEqual([]);
    });
  });
});

describe('T2 configs: which files each one collects', () => {
  const read = (name: string) => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');

  it('the jobs config collects exactly test/t2-jobs/**/*.jobs.ts; the Phase 2 and Phase 4 T2 configs and T1 never collect that name', () => {
    expect(read('vitest.t2.jobs.config.ts')).toContain("include: ['test/t2-jobs/**/*.jobs.ts']");
    // Neither earlier include matches a .jobs.ts file name.
    expect(read('vitest.t2.config.ts')).toMatch(/test\/\*\*\/\*\.t2\.ts/);
    expect(read('vitest.t2.agents.config.ts')).toMatch(/test\/t2\/\*\.t2\.ts/);
    expect(read('vitest.config.ts')).toMatch(/test\/\*\*\/\*\.test\.ts/);
    expect(read('vitest.t2.config.ts')).toMatch(/exclude:.*test\/t2\/\*\*/);
    expect(JSON.parse(read('package.json')).scripts['test:integration:jobs']).toBe('T2_PROFILE=jobs vitest run -c vitest.t2.jobs.config.ts');
  });
});
