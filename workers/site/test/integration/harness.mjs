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
//   3 uses ../../dist when dist/index.html exists, else a one-line shell in the temp dir (API tests need no build)
//   4 runs `wrangler dev -c site -c ops --local --persist-to <tmp>/state --port <free port>` with the wrangler of
//     workers/site/node_modules, and waits until the site answers and its OPS binding reaches microns-ops
//   5 publishes {site, stub, tmp} in workers/site/.wrangler/t2/urls.json (removed on exit) and, for processes it
//     starts, in T2_SITE_URL / T2_STUB_URL / T2_TMP
// No CPU limits apply locally; nothing calls production except Turnstile's siteverify (Cloudflare test keys).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub } from './stub-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(HERE, '..', '..');
const OPS_DIR = path.resolve(SITE_DIR, '..', 'ops');
const REPO_ROOT = path.resolve(SITE_DIR, '..', '..');
export const URLS_FILE = path.join(SITE_DIR, '.wrangler', 't2', 'urls.json');

const READY_TIMEOUT_MS = 120_000;
const DUMMY = 'dummy-not-a-secret';
// Cloudflare's documented always-pass Turnstile test secret (a public value).
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
// Access client ids the generated ACCESS_MACHINE_CLIENT_IDS maps to the two machine callers.
export const T2_COLLECTOR_CLIENT_ID = 't2-collector';
export const T2_MCP_CLIENT_ID = 't2-mcp';

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
export function generateConfigs({ stubUrl, tmp, assetsDir, omitSiteSecrets = [], siteVars = {} }) {
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
  if (ops.queues) ops.queues = { ...ops.queues, consumers: undefined };
  const opsSecrets = {};
  for (const name of ops.secrets?.required ?? []) opsSecrets[name] = DUMMY;

  return {
    site: { dir: path.join(tmp, 'site'), config: site, devVars: siteSecrets },
    ops: { dir: path.join(tmp, 'ops'), config: ops, devVars: opsSecrets },
  };
}

function writeConfigs(generated) {
  for (const part of [generated.site, generated.ops]) {
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

async function waitUntilReady(siteUrl, child, logFile) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited with ${child.exitCode} before it was ready (log: ${logFile})`);
    try {
      // OPTIONS on an ops endpoint is answered by the ops handler itself: 200 proves site, OPS binding and ops.
      const res = await fetch(`${siteUrl}/api/gsc`, { method: 'OPTIONS', signal: AbortSignal.timeout(5_000) });
      last = `status ${res.status}`;
      await res.arrayBuffer();
      if (res.status === 200) return;
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
export async function startHarness({ omitSiteSecrets = [], siteVars = {}, publish = true, quiet = false } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'microns-t2-'));
  const stub = await startStub();
  const generated = generateConfigs({ stubUrl: stub.url, tmp, assetsDir: assetsDirectory(tmp), omitSiteSecrets, siteVars });
  writeConfigs(generated);

  const port = await freePort();
  const inspectorPort = await freePort();
  const siteUrl = `http://127.0.0.1:${port}`;
  const wrangler = path.join(SITE_DIR, 'node_modules', '.bin', 'wrangler');
  if (!existsSync(wrangler)) throw new Error('wrangler is not installed in workers/site (npm --prefix workers/site ci)');
  const logFile = path.join(tmp, 'wrangler.log');
  const log = createWriteStream(logFile);
  const args = [
    'dev',
    '-c', path.join(generated.site.dir, 'wrangler.jsonc'),
    '-c', path.join(generated.ops.dir, 'wrangler.jsonc'),
    '--local',
    '--persist-to', path.join(tmp, 'state'),
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--inspector-port', String(inspectorPort),
    '--show-interactive-dev-session=false',
  ];
  const child = spawn(wrangler, args, {
    cwd: generated.site.dir,
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
    if (publish) rmSync(URLS_FILE, { force: true });
    if (!keepTmp) rmSync(tmp, { recursive: true, force: true });
  };

  try {
    await waitUntilReady(siteUrl, child, logFile);
  } catch (err) {
    const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n') : '';
    keepTmp = true;
    await stop();
    throw new Error(`${err.message}\n--- wrangler log (last lines) ---\n${tail}`);
  }

  const urls = { site: siteUrl, stub: stub.url, tmp };
  if (publish) {
    mkdirSync(path.dirname(URLS_FILE), { recursive: true });
    writeFileSync(URLS_FILE, `${JSON.stringify(urls, null, 2)}\n`);
    process.env.T2_SITE_URL = siteUrl;
    process.env.T2_STUB_URL = stub.url;
    process.env.T2_TMP = tmp;
    process.env.T2_COLLECTOR_CLIENT_ID = T2_COLLECTOR_CLIENT_ID;
  }
  if (!quiet) console.log(`[t2] site ${siteUrl}  stub ${stub.url}  tmp ${tmp}`);
  return { ...urls, stub, logFile, stop };
}

/** Polls urls.json until a harness has published its URLs (max `timeoutMs`). */
export async function waitForUrls(timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(URLS_FILE)) {
      try {
        return JSON.parse(readFileSync(URLS_FILE, 'utf8'));
      } catch { /* being written */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function cli(command) {
  if (command === 'wait') {
    const urls = await waitForUrls();
    if (!urls) {
      console.error(`[t2] no harness published ${path.relative(process.cwd(), URLS_FILE)} within ${READY_TIMEOUT_MS / 1000} s`);
      process.exit(1);
    }
    console.log(urls.site);
    return;
  }
  if (command === 'up') {
    const harness = await startHarness();
    const shutdown = async () => {
      await harness.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    console.log('[t2] running; Ctrl-C stops the harness');
    return;
  }
  console.error('usage: node test/integration/harness.mjs up|wait');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cli(process.argv[2]).catch((err) => {
    console.error(`[t2] ${err.message}`);
    process.exit(1);
  });
}
