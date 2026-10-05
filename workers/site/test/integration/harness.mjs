#!/usr/bin/env node
// T2 harness: both Workers in real workerd (`wrangler dev` with the site and the ops config) in front of a local
// upstream stub (./stub-server.mjs). Used by vitest (globalSetup ./global-setup.mjs, in workers/site and
// workers/ops) and by shells:
//   node test/integration/harness.mjs up     long-running; Ctrl-C (SIGINT/SIGTERM) stops it
//   node test/integration/harness.mjs wait   waits up to 120 s for a running harness, prints the site URL
//
// What `up` does
//   1 starts the stub on 127.0.0.1:<free port>
//   2 writes copies of workers/site/wrangler.jsonc and workers/ops/wrangler.jsonc into a temp dir: absolute main,
//     assets directory and alias paths; SUPABASE_URL and API_FORWARD_ORIGIN -> the stub, ACCESS_TEAM_DOMAIN ->
//     the stub origin, ACCESS_AUD t2-aud, bucket vars t2-rfq / t2-articles, R2_ACCOUNT_ID t2account; the ops
//     queue consumer is removed (no real scan runs locally); a .dev.vars beside each copy with dummy values
//     (Turnstile: Cloudflare's always-pass test secret). The developer's own .dev.vars is never read or written.
//     Phase 4: the ops bindings that have no local simulation (ai, vectorize, browser) and the MCP Custom Domain
//     (routes) are removed from the generated ops config (OPS_REMOTE_ONLY_KEYS), so `wrangler dev --local` never
//     opens a remote session; the agent code checks those bindings per use.
//   3 uses ../../dist when dist/index.html exists, else a one-line shell in the temp dir (API tests need no build)
//   4 runs `wrangler dev -c site -c ops --local --persist-to <tmp>/state --port <free port>` with the wrangler of
//     workers/site/node_modules, and waits until the site answers and its OPS binding reaches microns-ops
//   5 publishes {site, stub, tmp} in workers/site/.wrangler/t2/urls.json (removed on exit) and, for processes it
//     starts, in T2_SITE_URL / T2_STUB_URL / T2_TMP
// No CPU limits apply locally; nothing calls production except Turnstile's siteverify (Cloudflare test keys).
//
// Profile 'agents' (Phase 4; T2_PROFILE=agents, `harness.mjs up --profile agents`, or startHarness({profile})):
//   - three Workers: `wrangler dev -c site -c ops -c mail` (site primary: every /api/agent/* request enters through
//     the site, as in production); startHarness({primary: 'ops'}) puts ops first instead, so its default fetch (the
//     MCP host branch) is the HTTP surface (requests carry Host: mcp.micronshub.eu). Only the primary is served
//     over HTTP; mail injection, crons and Workflows go through the Local Explorer API (<url>/cdn-cgi/local/explorer/api)
//   - generated ops config: the Phase 2 overrides, plus AGENT_STUBS (default 'llm,embed,vector,browser'), the
//     provider base URLs pointing at the stub (AGENT_LLM_BASE_URL, RESEND_API_BASE, TELEGRAM_API_BASE,
//     GMAIL_API_BASE, GOOGLE_TOKEN_URL), ACCESS_TEAM_DOMAIN -> the stub, MCP_ACCESS_AUD t2-aud-mcp; the consumers of
//     cad-jobs and agent-events kept (scrapes only with keepScrapesConsumer); secrets.required of the generated
//     config = the production list + AGENT_SECRET_NAMES (wrangler loads only listed names from .dev.vars), with
//     dummy values except CAD_UNFOLD_URL = the stub origin and AGENT_APPROVAL_SECRET = a random value of this run
//   - generated site config: the profile 'api' config, secrets.required + AGENT_APPROVAL_SECRET (same value)
//   - generated mail config: OPS entrypoint MailIngest kept, SUPABASE_URL -> the stub, secrets.required = the
//     production list + the names of mailSecrets (each with its value in the generated .dev.vars)
//   - the stub mounts the stub modules (./stubs/*.mjs: anthropic, resend, telegram, gmail, google-token, unfold,
//     postgrest); start-up fails unless wrangler's binding table of every Worker lists every name of its generated
//     secrets.required as a hidden value
//   - published: urls.agents.json (profile 'api' keeps urls.json) and T2_SITE_URL / T2_OPS_URL, T2_STUB_URL, T2_TMP,
//     T2_EXPLORER_URL, T2_APPROVAL_SECRET, T2_PROFILE
// The production wrangler.jsonc files are never changed.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentStubModules, startStub } from './stub-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(HERE, '..', '..');
const OPS_DIR = path.resolve(SITE_DIR, '..', 'ops');
const MAIL_DIR = path.resolve(SITE_DIR, '..', 'mail');
const REPO_ROOT = path.resolve(SITE_DIR, '..', '..');
export const URLS_FILE = path.join(SITE_DIR, '.wrangler', 't2', 'urls.json');
/** urls file of a profile: urls.json for 'api' (Phase 2), urls.<profile>.json otherwise. */
export function urlsFile(profile = 'api') {
  return profile === 'api' ? URLS_FILE : path.join(SITE_DIR, '.wrangler', 't2', `urls.${profile}.json`);
}

const READY_TIMEOUT_MS = 120_000;
const DUMMY = 'dummy-not-a-secret';
// Cloudflare's documented always-pass Turnstile test secret (a public value).
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
// Access client ids the generated ACCESS_MACHINE_CLIENT_IDS maps to the two machine callers.
export const T2_COLLECTOR_CLIENT_ID = 't2-collector';
export const T2_MCP_CLIENT_ID = 't2-mcp';
// Top-level keys of workers/ops/wrangler.jsonc that are removed from every generated ops config (Phase 4).
export const OPS_REMOTE_ONLY_KEYS = ['ai', 'vectorize', 'browser', 'routes'];
export const PROFILES = ['api', 'agents'];
/** Phase 4 secret names the profile 'agents' appends to the generated ops secrets.required. */
export const AGENT_SECRET_NAMES = ['AI_GATEWAY_TOKEN', 'CAD_UNFOLD_URL', 'CAD_SHARED_SECRET', 'AGENT_APPROVAL_SECRET'];
export const AGENT_STUBS_DEFAULT = 'llm,embed,vector,browser';

/** JSONC -> object: drops comments outside strings, then trailing commas. */
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function devVars(values) {
  return `${Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
}

/** The generated site config, its .dev.vars and the ops config (pure: used by `up` and by tests of the harness). */
export function generateConfigs({
  stubUrl,
  tmp,
  assetsDir,
  omitSiteSecrets = [],
  siteVars = {},
  profile = 'api',
  approvalSecret = 'unset',
  opsVars = {},
  keepScrapesConsumer = false,
  mailSecrets = {},
}) {
  if (!PROFILES.includes(profile)) throw new Error(`unknown T2 profile ${profile}`);
  const site = parseJsonc(readFileSync(path.join(SITE_DIR, 'wrangler.jsonc'), 'utf8'));
  delete site.$schema;
  site.main = path.resolve(SITE_DIR, site.main);
  site.assets = { ...site.assets, directory: assetsDir };
  site.vars = {
    ...site.vars,
    SUPABASE_URL: stubUrl,
    API_FORWARD_ORIGIN: stubUrl,
    ACCESS_TEAM_DOMAIN: stubUrl,
    ACCESS_AUD: 't2-aud',
    LEGACY_S3_RFQ_BUCKET: 't2-rfq',
    LEGACY_S3_ARTICLES_BUCKET: 't2-articles',
    R2_ACCOUNT_ID: 't2account',
    ...siteVars,
  };
  const siteSecrets = {};
  for (const name of site.secrets?.required ?? []) {
    if (omitSiteSecrets.includes(name)) continue;
    siteSecrets[name] = name === 'TURNSTILE_SECRET_KEY' ? TURNSTILE_TEST_SECRET
      : name === 'ACCESS_MACHINE_CLIENT_IDS' ? `${T2_COLLECTOR_CLIENT_ID}=collector,${T2_MCP_CLIENT_ID}=mcp`
        : DUMMY;
  }

  const ops = parseJsonc(readFileSync(path.join(OPS_DIR, 'wrangler.jsonc'), 'utf8'));
  delete ops.$schema;
  ops.main = path.resolve(OPS_DIR, ops.main);
  if (ops.alias) {
    ops.alias = Object.fromEntries(Object.entries(ops.alias).map(([name, target]) => [name, target.startsWith('.') ? path.resolve(OPS_DIR, target) : target]));
  }
  ops.vars = { ...ops.vars, SUPABASE_URL: stubUrl };
  const productionConsumers = ops.queues?.consumers ?? [];
  if (ops.queues) ops.queues = { ...ops.queues, consumers: undefined };
  for (const key of OPS_REMOTE_ONLY_KEYS) delete ops[key];
  const opsSecrets = {};
  for (const name of ops.secrets?.required ?? []) opsSecrets[name] = DUMMY;

  if (profile === 'api') {
    return {
      profile,
      site: { dir: path.join(tmp, 'site'), config: site, devVars: siteSecrets },
      ops: { dir: path.join(tmp, 'ops'), config: ops, devVars: opsSecrets },
    };
  }

  // ----- profile 'agents' -----
  ops.vars = {
    ...ops.vars,
    AGENT_STUBS: AGENT_STUBS_DEFAULT,
    AGENT_LLM_BASE_URL: `${stubUrl}/anthropic`,
    RESEND_API_BASE: `${stubUrl}/resend`,
    TELEGRAM_API_BASE: `${stubUrl}/telegram`,
    GMAIL_API_BASE: `${stubUrl}/gmail`,
    GOOGLE_TOKEN_URL: `${stubUrl}/oauth2/token`,
    ACCESS_TEAM_DOMAIN: stubUrl,
    MCP_ACCESS_AUD: 't2-aud-mcp',
    ...opsVars,
  };
  const consumers = productionConsumers.filter((c) => c.queue !== 'scrapes' || keepScrapesConsumer);
  if (ops.queues) ops.queues = { ...ops.queues, consumers };
  ops.secrets = { ...ops.secrets, required: [...(ops.secrets?.required ?? []), ...AGENT_SECRET_NAMES.filter((n) => !(ops.secrets?.required ?? []).includes(n))] };
  for (const name of AGENT_SECRET_NAMES) opsSecrets[name] = DUMMY;
  opsSecrets.CAD_UNFOLD_URL = stubUrl;
  opsSecrets.AGENT_APPROVAL_SECRET = approvalSecret;

  if (!omitSiteSecrets.includes('AGENT_APPROVAL_SECRET')) {
    site.secrets = { ...site.secrets, required: [...(site.secrets?.required ?? []), 'AGENT_APPROVAL_SECRET'] };
    siteSecrets.AGENT_APPROVAL_SECRET = approvalSecret;
  }

  const mail = parseJsonc(readFileSync(path.join(MAIL_DIR, 'wrangler.jsonc'), 'utf8'));
  delete mail.$schema;
  mail.main = path.resolve(MAIL_DIR, mail.main);
  mail.vars = { ...mail.vars, SUPABASE_URL: stubUrl };
  mail.secrets = { ...mail.secrets, required: [...(mail.secrets?.required ?? []), ...Object.keys(mailSecrets)] };
  const mailDevVars = {};
  for (const name of mail.secrets.required) mailDevVars[name] = mailSecrets[name] ?? DUMMY;

  return {
    profile,
    site: { dir: path.join(tmp, 'site'), config: site, devVars: siteSecrets },
    ops: { dir: path.join(tmp, 'ops'), config: ops, devVars: opsSecrets },
    mail: { dir: path.join(tmp, 'mail'), config: mail, devVars: mailDevVars },
  };
}

/** Strips ANSI colour codes from wrangler's output. */
function plain(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Names listed as hidden values per Worker in wrangler's binding tables ("<worker> has access to the following
 * bindings:" followed by rows such as `env.NAME ("(hidden)")`).
 */
export function hiddenBindingsByWorker(log) {
  const out = new Map();
  let current = null;
  for (const line of plain(log).split('\n')) {
    const head = /^(\S+) has access to the following bindings:/.exec(line);
    if (head) {
      current = head[1];
      if (!out.has(current)) out.set(current, new Set());
      continue;
    }
    if (current && line.trim() === '') {
      current = null;
      continue;
    }
    const row = /^env\.([A-Za-z0-9_]+) \("\(hidden\)"\)/.exec(line.trim());
    if (current && row) out.get(current).add(row[1]);
  }
  return out;
}

/** Names of each generated secrets.required that wrangler did not report as loaded for its Worker. */
export function missingSecretBindings(generated, log) {
  const seen = hiddenBindingsByWorker(log);
  const missing = [];
  for (const part of [generated.site, generated.ops, generated.mail].filter(Boolean)) {
    const name = part.config.name;
    for (const secret of part.config.secrets?.required ?? []) {
      if (!seen.get(name)?.has(secret)) missing.push(`${name}: ${secret}`);
    }
  }
  return missing;
}

function writeConfigs(generated) {
  for (const part of [generated.site, generated.ops, generated.mail].filter(Boolean)) {
    mkdirSync(part.dir, { recursive: true });
    writeFileSync(path.join(part.dir, 'wrangler.jsonc'), `${JSON.stringify(part.config, null, 2)}\n`);
    writeFileSync(path.join(part.dir, '.dev.vars'), devVars(part.devVars));
  }
}

function assetsDirectory(tmp) {
  const dist = path.join(REPO_ROOT, 'dist');
  if (existsSync(path.join(dist, 'index.html'))) return dist;
  const dir = path.join(tmp, 'assets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>T2</title></head><body><div id="root"></div></body></html>\n');
  return dir;
}

function noProxyFor(env) {
  const list = new Set(String(env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  for (const host of ['127.0.0.1', 'localhost', '::1']) list.add(host);
  return [...list].join(',');
}

async function waitUntilReady(siteUrl, child, logFile, primary = 'site') {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited with ${child.exitCode} before it was ready (log: ${logFile})`);
    try {
      // Site primary: OPTIONS on an ops endpoint is answered by the ops handler itself: 200 proves site, OPS binding
      // and ops. Ops primary: its default fetch answers any non-MCP host with 404 and no body.
      const res = primary === 'ops'
        ? await fetch(`${siteUrl}/`, { signal: AbortSignal.timeout(5_000) })
        : await fetch(`${siteUrl}/api/gsc`, { method: 'OPTIONS', signal: AbortSignal.timeout(5_000) });
      last = `status ${res.status}`;
      const text = await res.text();
      if (primary === 'ops' ? res.status === 404 && text === '' : res.status === 200) return;
    } catch (err) {
      last = String(err?.cause?.code ?? err?.message ?? err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`wrangler dev did not become ready within ${READY_TIMEOUT_MS / 1000} s (${last}; log: ${logFile})`);
}

/**
 * Starts the stub and both Workers. Options: omitSiteSecrets (names left out of the generated site .dev.vars),
 * siteVars (extra var overrides), publish (write urls.json and set the T2_* variables; default true).
 */
export async function startHarness({
  omitSiteSecrets = [],
  siteVars = {},
  publish = true,
  quiet = false,
  profile = process.env.T2_PROFILE || 'api',
  primary = 'site',
  opsVars = {},
  keepScrapesConsumer = false,
  mailSecrets = {},
} = {}) {
  if (!PROFILES.includes(profile)) throw new Error(`unknown T2 profile ${profile}`);
  if (primary !== 'site' && primary !== 'ops') throw new Error(`primary must be 'site' or 'ops'`);
  if (primary === 'ops' && profile !== 'agents') throw new Error("primary 'ops' needs the profile 'agents'");
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'microns-t2-'));
  const stub = await startStub({ modules: profile === 'agents' ? await agentStubModules() : [] });
  const approvalSecret = profile === 'agents' ? randomBytes(32).toString('hex') : undefined;
  const generated = generateConfigs({ stubUrl: stub.url, tmp, assetsDir: assetsDirectory(tmp), omitSiteSecrets, siteVars, profile, approvalSecret, opsVars, keepScrapesConsumer, mailSecrets });
  writeConfigs(generated);
  const order = primary === 'ops' ? [generated.ops, generated.site, generated.mail] : [generated.site, generated.ops, generated.mail];

  const port = await freePort();
  const inspectorPort = await freePort();
  const siteUrl = `http://127.0.0.1:${port}`;
  const wrangler = path.join(SITE_DIR, 'node_modules', '.bin', 'wrangler');
  if (!existsSync(wrangler)) throw new Error('wrangler is not installed in workers/site (npm --prefix workers/site ci)');
  const logFile = path.join(tmp, 'wrangler.log');
  const log = createWriteStream(logFile);
  const args = [
    'dev',
    ...order.filter(Boolean).flatMap((part) => ['-c', path.join(part.dir, 'wrangler.jsonc')]),
    '--local',
    '--persist-to', path.join(tmp, 'state'),
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--inspector-port', String(inspectorPort),
    '--show-interactive-dev-session=false',
  ];
  const child = spawn(wrangler, args, {
    cwd: order[0].dir,
    env: {
      ...process.env,
      NO_PROXY: noProxyFor(process.env),
      no_proxy: noProxyFor(process.env),
      WRANGLER_SEND_METRICS: 'false',
      CI: process.env.CI ?? '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  let stopped = false;
  // Kept for inspection after a failed start, or always with T2_KEEP_TMP=1.
  let keepTmp = process.env.T2_KEEP_TMP === '1';
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      const timer = setTimeout(() => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* already gone */ }
      }, 5_000);
      await exited;
      clearTimeout(timer);
    }
    await stub.close();
    log.end();
    if (publish) rmSync(urlsFile(profile), { force: true });
    if (!keepTmp) rmSync(tmp, { recursive: true, force: true });
  };

  try {
    await waitUntilReady(siteUrl, child, logFile, primary);
    if (profile === 'agents') {
      const missing = missingSecretBindings(generated, readFileSync(logFile, 'utf8'));
      if (missing.length) throw new Error(`secrets not loaded by wrangler: ${missing.join(', ')}`);
    }
  } catch (err) {
    const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n') : '';
    keepTmp = true;
    await stop();
    throw new Error(`${err.message}\n--- wrangler log (last lines) ---\n${tail}`);
  }

  const urls = profile === 'api'
    ? { site: siteUrl, stub: stub.url, tmp }
    : {
      profile,
      primary,
      site: primary === 'site' ? siteUrl : null,
      ops: primary === 'ops' ? siteUrl : null,
      stub: stub.url,
      tmp,
      explorer: `${siteUrl}/cdn-cgi/local/explorer/api`,
      approvalSecret,
      configs: Object.fromEntries(['site', 'ops', 'mail'].map((k) => [k, path.join(generated[k].dir, 'wrangler.jsonc')])),
      state: path.join(tmp, 'state'),
    };
  if (publish) {
    const file = urlsFile(profile);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(urls, null, 2)}\n`);
    if (profile === 'api' || primary === 'site') process.env.T2_SITE_URL = siteUrl;
    if (primary === 'ops') process.env.T2_OPS_URL = siteUrl;
    process.env.T2_STUB_URL = stub.url;
    process.env.T2_TMP = tmp;
    process.env.T2_COLLECTOR_CLIENT_ID = T2_COLLECTOR_CLIENT_ID;
    if (profile === 'agents') {
      process.env.T2_PROFILE = profile;
      process.env.T2_EXPLORER_URL = urls.explorer;
      process.env.T2_APPROVAL_SECRET = approvalSecret;
    }
  }
  if (!quiet) console.log(`[t2] ${profile} ${primary} ${siteUrl}  stub ${stub.url}  tmp ${tmp}`);
  return { ...urls, url: siteUrl, stub, logFile, stop };
}

/** Polls urls.json until a harness has published its URLs (max `timeoutMs`). */
export async function waitForUrls(timeoutMs = READY_TIMEOUT_MS, profile = 'api') {
  const deadline = Date.now() + timeoutMs;
  const file = urlsFile(profile);
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch { /* being written */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function cli(command, rest = []) {
  const at = rest.indexOf('--profile');
  const profile = at >= 0 ? rest[at + 1] : process.env.T2_PROFILE || 'api';
  if (command === 'wait') {
    const urls = await waitForUrls(READY_TIMEOUT_MS, profile);
    if (!urls) {
      console.error(`[t2] no harness published ${path.relative(process.cwd(), urlsFile(profile))} within ${READY_TIMEOUT_MS / 1000} s`);
      process.exit(1);
    }
    console.log(urls.site ?? urls.ops);
    return;
  }
  if (command === 'up') {
    const harness = await startHarness({ profile });
    const shutdown = async () => {
      await harness.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    console.log('[t2] running; Ctrl-C stops the harness');
    return;
  }
  console.error('usage: node test/integration/harness.mjs up|wait [--profile api|agents]');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cli(process.argv[2], process.argv.slice(3)).catch((err) => {
    console.error(`[t2] ${err.message}`);
    process.exit(1);
  });
}
