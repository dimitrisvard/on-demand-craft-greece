// T2 harness profile 'agents' (workers/site/test/integration/harness.mjs), checked without starting workerd: the
// generated configs (stub tokens and base URLs only in the generated ops config, Phase 4 secret names appended to
// the generated secrets.required with their .dev.vars values, consumers kept or removed, three Workers, the
// production wrangler.jsonc files untouched), the binding-table parser of the start-up assertion, and that the
// profile 'api' output is the Phase 2 shape.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Part {
  dir: string;
  config: Record<string, unknown> & { name: string; vars?: Record<string, string>; secrets?: { required?: string[] }; queues?: { consumers?: Array<{ queue: string }> } };
  devVars: Record<string, string>;
}
interface Generated {
  profile: string;
  site: Part;
  ops: Part;
  mail?: Part;
}
interface Harness {
  AGENT_SECRET_NAMES: string[];
  OPS_REMOTE_ONLY_KEYS: string[];
  generateConfigs(o: Record<string, unknown>): Generated;
  hiddenBindingsByWorker(log: string): Map<string, Set<string>>;
  missingSecretBindings(generated: Generated, log: string): string[];
  parseJsonc(text: string): Record<string, unknown>;
  urlsFile(profile?: string): string;
}

const HARNESS: string = new URL('../../../site/test/integration/harness.mjs', import.meta.url).href;
const h = (await import(/* @vite-ignore */ HARNESS)) as Harness;
const STUB = 'http://127.0.0.1:9999';
const base = { stubUrl: STUB, tmp: '/tmp/t2-test', assetsDir: '/tmp/t2-test/assets' };

describe('generated configs, profile agents', () => {
  const g = h.generateConfigs({ ...base, profile: 'agents', approvalSecret: 'a'.repeat(64) });

  it('three Workers; the ops config points every provider at the stub and keeps the agent consumers', () => {
    expect([g.site.config.name, g.ops.config.name, g.mail?.config.name]).toEqual(['microns-site', 'microns-ops', 'microns-mail']);
    expect(g.ops.config.vars).toMatchObject({
      AGENT_STUBS: 'llm,embed,vector,browser',
      AGENT_LLM_BASE_URL: `${STUB}/anthropic`,
      RESEND_API_BASE: `${STUB}/resend`,
      TELEGRAM_API_BASE: `${STUB}/telegram`,
      GMAIL_API_BASE: `${STUB}/gmail`,
      GOOGLE_TOKEN_URL: `${STUB}/oauth2/token`,
      ACCESS_TEAM_DOMAIN: STUB,
      MCP_ACCESS_AUD: 't2-aud-mcp',
      MCP_HOSTNAME: 'mcp.micronshub.eu',
      SUPABASE_URL: STUB,
    });
    for (const key of h.OPS_REMOTE_ONLY_KEYS) expect(g.ops.config).not.toHaveProperty(key);
    expect(g.ops.config.queues?.consumers?.map((c) => c.queue)).toEqual(['cad-jobs', 'agent-events']);
    const scrapers = h.generateConfigs({ ...base, profile: 'agents', approvalSecret: 'x', keepScrapesConsumer: true });
    expect(scrapers.ops.config.queues?.consumers?.map((c) => c.queue)).toEqual(['scrapes', 'cad-jobs', 'agent-events']);
  });

  it('Phase 4 secret names are appended to the generated secrets.required with their values', () => {
    expect(h.AGENT_SECRET_NAMES).toEqual(['AI_GATEWAY_TOKEN', 'CAD_UNFOLD_URL', 'CAD_SHARED_SECRET', 'AGENT_APPROVAL_SECRET']);
    expect(g.ops.config.secrets?.required?.slice(-4)).toEqual(h.AGENT_SECRET_NAMES);
    expect(g.ops.devVars).toMatchObject({ AI_GATEWAY_TOKEN: 'dummy-not-a-secret', CAD_SHARED_SECRET: 'dummy-not-a-secret', CAD_UNFOLD_URL: STUB, AGENT_APPROVAL_SECRET: 'a'.repeat(64) });
    expect(g.site.config.secrets?.required).toContain('AGENT_APPROVAL_SECRET');
    expect(g.site.devVars.AGENT_APPROVAL_SECRET).toBe('a'.repeat(64));
    expect(g.mail?.config.secrets?.required).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(g.mail?.config.vars?.SUPABASE_URL).toBe(STUB);
    expect(g.mail?.config).toMatchObject({ services: [{ binding: 'OPS', service: 'microns-ops', entrypoint: 'MailIngest' }] });
    const withCopy = h.generateConfigs({ ...base, profile: 'agents', approvalSecret: 'x', mailSecrets: { MAIL_COPY_TO: 'copy@example.com' } });
    expect(withCopy.mail?.config.secrets?.required).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'MAIL_COPY_TO']);
    expect(withCopy.mail?.devVars.MAIL_COPY_TO).toBe('copy@example.com');
  });

  it('the production wrangler.jsonc files keep their secrets.required and have no T2 var', () => {
    const ops = h.parseJsonc(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')) as Part['config'];
    expect(ops.secrets?.required).toHaveLength(10);
    expect(Object.keys(ops.vars ?? {}).filter((k) => k === 'AGENT_STUBS' || k.endsWith('_API_BASE'))).toEqual([]);
    const site = h.parseJsonc(readFileSync(new URL('../../../site/wrangler.jsonc', import.meta.url), 'utf8')) as Part['config'];
    expect(site.secrets?.required).not.toContain('AGENT_APPROVAL_SECRET');
  });
});

describe('generated configs, profile api (Phase 2 shape)', () => {
  it('two Workers, no consumer, no stub vars, Phase 2 secrets only, urls.json', () => {
    const g = h.generateConfigs(base);
    expect(g.mail).toBeUndefined();
    expect(g.ops.config.queues?.consumers).toBeUndefined();
    expect(g.ops.config.vars).not.toHaveProperty('AGENT_STUBS');
    expect(g.ops.config.secrets?.required).toHaveLength(10);
    expect(g.site.config.secrets?.required).not.toContain('AGENT_APPROVAL_SECRET');
    expect(h.urlsFile('api').endsWith('/.wrangler/t2/urls.json')).toBe(true);
    expect(h.urlsFile('agents').endsWith('/.wrangler/t2/urls.agents.json')).toBe(true);
    expect(() => h.generateConfigs({ ...base, profile: 'nope' })).toThrow(/unknown T2 profile/);
  });
});

describe('start-up assertion on wrangler binding tables', () => {
  const log = [
    '\u001b[33m▲ warning\u001b[0m',
    'microns-site has access to the following bindings:',
    'Binding                                   Resource                  Mode',
    'env.SUPABASE_URL ("http://127.0.0.1:1")   Environment Variable      local',
    'env.AGENT_APPROVAL_SECRET ("(hidden)")    Environment Variable      local',
    '',
    'microns-ops has access to the following bindings:',
    'env.AI_GATEWAY_TOKEN ("(hidden)")         Environment Variable      local',
    'env.CAD_UNFOLD_URL ("(hidden)")           Environment Variable      local',
    '',
  ].join('\n');

  it('collects hidden names per Worker', () => {
    const seen = h.hiddenBindingsByWorker(log);
    expect([...(seen.get('microns-site') ?? [])]).toEqual(['AGENT_APPROVAL_SECRET']);
    expect([...(seen.get('microns-ops') ?? [])]).toEqual(['AI_GATEWAY_TOKEN', 'CAD_UNFOLD_URL']);
  });

  it('reports every generated secret name that wrangler did not load', () => {
    const g = h.generateConfigs({ ...base, profile: 'agents', approvalSecret: 'x' });
    const missing = h.missingSecretBindings(g, log);
    expect(missing).toContain('microns-ops: CAD_SHARED_SECRET');
    expect(missing).toContain('microns-mail: SUPABASE_SERVICE_ROLE_KEY');
    expect(missing).not.toContain('microns-ops: AI_GATEWAY_TOKEN');
  });
});
