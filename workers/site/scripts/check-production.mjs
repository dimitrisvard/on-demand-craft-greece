#!/usr/bin/env node
// Guards of the production workflow of microns-site (.github/workflows/cf-site-production.yml). No dependency.
//
//   node workers/site/scripts/check-production.mjs config [--config <path>]
//     exit 0 when env.production of wrangler.jsonc holds no "<NAME>" placeholder; 1 listing every placeholder left
//     (the owner fills them in at runbook S11).
//   node workers/site/scripts/check-production.mjs version <version.json> [--config <path>]
//     <version.json> is the output of `wrangler versions view <id> --env production --json`. exit 0 when the
//     version carries a production tag (prod-<first 12 hex of the commit>) and its API_MACHINE_HOSTS binding equals
//     env.production.vars.API_MACHINE_HOSTS, i.e. it was uploaded with the production config; else 1 with the reason.
//   node workers/site/scripts/check-production.mjs site-key
//     exit 0 when VITE_TURNSTILE_SITE_KEY is set and is not a Cloudflare test site key: production builds use the
//     real site key. The value is never printed.
//
// exit 64: usage error, or an input that cannot be read or parsed. --config defaults to the wrangler.jsonc next to
// this script's folder, so the commands work from any working directory.

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 64;

export const DEFAULT_CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.jsonc');

/** Tag every production upload carries: `prod-` + the first 12 hex digits of the commit SHA. */
export const PRODUCTION_TAG = /^prod-[0-9a-f]{12}$/;

/** Cloudflare's Turnstile test site keys (always pass, always block, force an interactive challenge, ...). */
export const TEST_SITE_KEY = /^[123]x0{20}[A-F]{2}$/i;

/** A placeholder the owner replaces with an ID or name, e.g. <KV_ID_FLAGS>. */
const PLACEHOLDER = /<[A-Z0-9_]+>/g;

const USAGE = `usage:
  node workers/site/scripts/check-production.mjs config [--config <path>]
  node workers/site/scripts/check-production.mjs version <version.json> [--config <path>]
  node workers/site/scripts/check-production.mjs site-key`;

class UsageError extends Error {}

/** JSONC as wrangler reads it: comments outside strings and trailing commas removed, then JSON.parse. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
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

/** Every placeholder in the string values of `value`, in order of first appearance, without duplicates. */
export function placeholdersIn(value) {
  const found = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(PLACEHOLDER)) if (!found.includes(m[0])) found.push(m[0]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return found;
}

function productionOf(config) {
  const prod = config?.env?.production;
  return prod && typeof prod === 'object' && !Array.isArray(prod) ? prod : null;
}

/** config check: { ok, problems } for a parsed wrangler.jsonc. */
export function checkConfig(config) {
  const prod = productionOf(config);
  if (!prod) return { ok: false, problems: ['wrangler.jsonc has no env.production block'] };
  const left = placeholdersIn(prod);
  return left.length === 0
    ? { ok: true, problems: [] }
    : { ok: false, problems: left.map((p) => `placeholder left in env.production: ${p}`) };
}

/** version check: { ok, problems } for the parsed `wrangler versions view --json` output and the parsed config. */
export function checkVersion(version, config) {
  const problems = [];
  const prod = productionOf(config);
  const expected = prod?.vars?.API_MACHINE_HOSTS;
  if (typeof expected !== 'string') problems.push('env.production.vars.API_MACHINE_HOSTS is not set in wrangler.jsonc');

  const tag = version?.annotations?.['workers/tag'];
  if (typeof tag !== 'string' || tag === '') {
    problems.push('the version has no tag: production versions are uploaded by cf-site-production.yml with a prod-<commit> tag');
  } else if (!PRODUCTION_TAG.test(tag)) {
    problems.push(`the version tag ${JSON.stringify(tag)} is not a production tag (prod- and 12 hex digits of the commit)`);
  }

  const bindings = version?.resources?.bindings;
  if (!Array.isArray(bindings)) {
    problems.push('the version lists no bindings (resources.bindings)');
  } else {
    const hosts = bindings.filter((b) => b && b.name === 'API_MACHINE_HOSTS');
    if (hosts.length !== 1) {
      problems.push(`the version has ${hosts.length} API_MACHINE_HOSTS bindings, expected 1`);
    } else if (hosts[0].type !== 'plain_text' || typeof hosts[0].text !== 'string') {
      problems.push('the API_MACHINE_HOSTS binding of the version is not a plain-text var');
    } else if (typeof expected === 'string' && hosts[0].text !== expected) {
      problems.push(`API_MACHINE_HOSTS of the version is ${JSON.stringify(hosts[0].text)}, env.production has ${JSON.stringify(expected)}: not a production-config upload`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** site-key check: { ok, problems }; the problems never contain the value. */
export function checkSiteKey(value) {
  const key = (value ?? '').trim();
  if (key === '') return { ok: false, problems: ['VITE_TURNSTILE_SITE_KEY is empty: production builds use the real site key'] };
  if (TEST_SITE_KEY.test(key)) {
    return { ok: false, problems: ['VITE_TURNSTILE_SITE_KEY is a Cloudflare test site key: production builds use the real site key'] };
  }
  return { ok: true, problems: [] };
}

function readText(file, what) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${what} ${file}: ${err.code ?? err.message}`);
  }
}

function readConfig(file) {
  const text = readText(file, 'config');
  try {
    return parseJsonc(text);
  } catch (err) {
    throw new UsageError(`cannot parse ${file}: ${err.message}`);
  }
}

/** `wrangler versions view --json` prints one JSON object; lines around it (logs) are ignored. */
function readVersion(file) {
  const text = readText(file, 'version file');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new UsageError(`${file} is not the JSON output of wrangler versions view --json`);
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  let config = DEFAULT_CONFIG;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--config') {
      if (i + 1 >= rest.length) throw new UsageError('--config needs a path');
      config = path.resolve(rest[++i]);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (command === 'config' || command === 'site-key') {
    if (positional.length > 0) throw new UsageError(`${command} takes no argument`);
    if (command === 'site-key' && config !== DEFAULT_CONFIG) throw new UsageError('site-key takes no --config');
  } else if (command === 'version') {
    if (positional.length !== 1) throw new UsageError('version needs exactly one <version.json>');
  } else {
    throw new UsageError(command ? `unknown command ${command}` : 'no command');
  }
  return { command, positional, config };
}

function report(label, result, okText) {
  if (result.ok) {
    console.log(`check-production ${label}: ${okText}`);
    return EXIT_OK;
  }
  for (const p of result.problems) console.error(`check-production ${label}: ${p}`);
  return EXIT_FAIL;
}

export function main(argv, env = process.env) {
  try {
    const { command, positional, config } = parseArgs(argv);
    if (command === 'config') {
      return report('config', checkConfig(readConfig(config)), 'env.production has no placeholder');
    }
    if (command === 'version') {
      const version = readVersion(path.resolve(positional[0]));
      return report('version', checkVersion(version, readConfig(config)), 'tagged production version with the production config');
    }
    return report('site-key', checkSiteKey(env.VITE_TURNSTILE_SITE_KEY), 'VITE_TURNSTILE_SITE_KEY is set and is not a test site key');
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`check-production: ${err.message}`);
      console.error(USAGE);
      return EXIT_USAGE;
    }
    throw err;
  }
}

/** True when Node started this file, also through a symlinked path (Node runs the resolved file). */
function startedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (startedDirectly()) {
  process.exitCode = main(process.argv.slice(2));
}
