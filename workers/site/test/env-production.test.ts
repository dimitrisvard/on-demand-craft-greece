// Production environment of wrangler.jsonc (Phase 3, PLAN.md P3-3/P3-4): env.production must be the top level plus
// the two zone routes and a short list of production vars. wrangler does not inherit bindings or vars into an
// environment and only warns when one is missing, so a binding added to the top level and not to env.production
// would be absent in production. This test resolves both environments with wrangler's own reader (the pinned
// wrangler of this package) and compares every resolved key.
//
// Effect on later changes: a binding, secret or var added to the site's top level only fails this test; add it to
// env.production in the same change (vars listed in MAY_DIFFER may carry a production value).

import { beforeAll, describe, expect, it } from 'vitest';

const CONFIG_PATH = new URL('../wrangler.jsonc', (import.meta as unknown as { url: string }).url).pathname;
// A variable specifier keeps wrangler's own type declarations out of the type program.
const WRANGLER: string = 'wrangler';
/**
 * Budget for loading wrangler and reading the config once, before the first test. The wrangler bundle takes seconds
 * to import on a busy CI runner, so it runs in a hook with this budget, not inside a test with the 5 s test default.
 */
const LOAD_TIMEOUT_MS = 60_000;

/** The only vars env.production may set differently from the top level. */
const MAY_DIFFER = ['ACCESS_AUD', 'API_GATES_MODE', 'API_MACHINE_HOSTS', 'HSTS_VALUE', 'ARTICLES_STORE', 'API_CORS_MODE'] as const;
/** Resolved keys that legitimately differ between the two environments (routes, vars, wrangler's own bookkeeping). */
const DIFFERENT_KEYS = new Set(['routes', 'vars', 'targetEnvironment', 'definedEnvironments', 'topLevelName']);
/** Keys env.production may write itself; everything else must come from the top level by inheritance. */
const OWN_KEYS = new Set(['name', 'routes', 'vars', 'secrets', 'kv_namespaces', 'services', 'r2_buckets', 'ratelimits',
  // bindings a later phase may add to the site; each one is compared with the top level once present
  'd1_databases', 'queues', 'durable_objects', 'analytics_engine_datasets', 'ai', 'browser', 'vectorize', 'hyperdrive', 'workflows', 'send_email']);

type Resolved = Record<string, any>;

type Wrangler = {
  unstable_readConfig(args: { config: string; env?: string }, opts?: { hideWarnings?: boolean }): Resolved;
  experimental_readRawConfig(args: { config: string }): { rawConfig: Resolved };
};

/** The top level, env.production (both resolved by wrangler) and the raw file, read once for every test. */
let top: Resolved;
let prod: Resolved;
let rawConfig: Resolved;

beforeAll(async () => {
  // Imported lazily: the wrangler bundle is large and only this file needs it.
  const wrangler = (await import(/* @vite-ignore */ WRANGLER)) as Wrangler;
  top = wrangler.unstable_readConfig({ config: CONFIG_PATH }, { hideWarnings: true });
  prod = wrangler.unstable_readConfig({ config: CONFIG_PATH, env: 'production' }, { hideWarnings: true });
  rawConfig = wrangler.experimental_readRawConfig({ config: CONFIG_PATH }).rawConfig;
}, LOAD_TIMEOUT_MS);

describe('wrangler.jsonc env.production (Phase 3 production config)', () => {
  it('targets the same Worker: its own name, equal to the top level', () => {
    expect(prod.name).toBe('microns-site');
    expect(prod.name).toBe(top.name);
  });

  it('the top level has no routes; production has exactly the www and wildcard routes on the zone', () => {
    expect(top.routes ?? []).toEqual([]);
    expect(prod.routes).toEqual([
      { pattern: 'www.micronshub.eu/*', zone_name: 'micronshub.eu' },
      { pattern: '*.micronshub.eu/*', zone_name: 'micronshub.eu' },
    ]);
    // Never a Custom Domain on the site hosts: a rollback is a DNS record change.
    expect(prod.routes.some((r: Resolved) => r.custom_domain)).toBe(false);
  });

  it('env.production writes only its own keys; main, assets, compatibility and workers_dev come from the top level', () => {
    const env = rawConfig.env?.production ?? {};
    expect(Object.keys(env).filter((k) => !OWN_KEYS.has(k))).toEqual([]);
  });

  it('every resolved key except routes and vars is identical (bindings, secrets, assets, observability)', () => {
    const keys = new Set([...Object.keys(top), ...Object.keys(prod)]);
    const differing = [...keys].filter((k) => !DIFFERENT_KEYS.has(k) && JSON.stringify(top[k]) !== JSON.stringify(prod[k]));
    expect(differing).toEqual([]);
  });

  it('vars: same names and values except the production list', () => {
    const allowed = new Set<string>(MAY_DIFFER);
    const names = new Set([...Object.keys(top.vars), ...Object.keys(prod.vars)]);
    expect([...names].filter((k) => !allowed.has(k) && top.vars[k] !== prod.vars[k])).toEqual([]);
    expect(Object.keys(top.vars).filter((k) => !(k in prod.vars))).toEqual([]);
  });

  it('production values: machine host, both gate classes in report mode, both Access audiences, switches', () => {
    const vars = prod.vars;
    expect(vars.API_MACHINE_HOSTS).toBe('api.micronshub.eu');
    expect(vars.API_GATES_MODE.split(',').sort()).toEqual(['recipient=report', 'redirect=report']);
    expect(vars.ACCESS_AUD.split(',')).toHaveLength(2);
    expect(vars.ACCESS_AUD.split(',')).toContain(top.vars.ACCESS_AUD);
    expect(vars.SEO_STRICT_404).toBe('false');
    expect(['legacy', 'r2']).toContain(vars.ARTICLES_STORE);
    expect(['parity', 'allowlist']).toContain(vars.API_CORS_MODE);
    // Never a placeholder: whatever string is configured is sent as the header.
    if ('HSTS_VALUE' in vars) expect(vars.HSTS_VALUE).toMatch(/^max-age=\d+(; ?includeSubDomains)?(; ?preload)?$/);
  });

  it('the preview top level keeps the Phase 2 values and the switches off', () => {
    const vars = top.vars;
    expect(vars.API_MACHINE_HOSTS).toBe('');
    expect(vars.ARTICLES_STORE).toBe('legacy');
    expect(['parity', 'allowlist']).toContain(vars.API_CORS_MODE);
    expect(vars).not.toHaveProperty('HSTS_VALUE');
  });
});
