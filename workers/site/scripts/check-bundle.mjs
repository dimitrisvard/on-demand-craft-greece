#!/usr/bin/env node
// Bundle guard of microns-site (exit gate 9 of PLAN.md §5.2): the Worker bundle must not contain the code that
// belongs to microns-ops or to the legacy S3 handler. Reads the esbuild metafile of a dry-run build and fails on any
// input that is
//   - a package under node_modules/: @aws-sdk, @smithy, pdf-lib, @pdf-lib, qrcode, pngjs, makerjs, dxf-parser,
//     clipper-lib
//   - a file under lib/nesting/ or lib/inventory/
//   - a repo-root API handler other than the site's own: api/s3, api/notifications, api/gsc, api/tenders,
//     api/tender-scan, api/funded-startups, api/scrape-*, api/scan-directory
//   - (Phase 4) an agent-layer package under node_modules/: @anthropic-ai/*, agents, @modelcontextprotocol/*,
//     postal-mime, @pdf-lib/fontkit, @cloudflare/puppeteer. postal-mime is allowed only as a dependency of resend:
//     at least one input imports it and every input outside postal-mime that imports it belongs to the resend
//     package (the dependency of the site's own mail handler, api/emails.js, which imports postal-mime at module
//     scope); any other importer, or none, fails the guard. The report names the resend importers when this applies
//   - (Phase 4) a source file of microns-ops (workers/ops/src/): the site reaches the agent layer only over the OPS
//     service binding
// and prints the size report (bundle size, gzip size, largest packages).
//
// Usage (from workers/site):
//   npm run build:dry && npm run check-bundle      build with the metafile, then check it
//   node scripts/check-bundle.mjs                  checks .wrangler/dry/meta.json; runs the dry-run build first
//                                                  when that file does not exist
//   node scripts/check-bundle.mjs --build          always runs the dry-run build first
//   node scripts/check-bundle.mjs --metafile <f>   checks another metafile (paths relative to workers/site)
// Exit status: 0 clean, 1 forbidden inputs found, 2 no metafile / build failed.
// In GitHub Actions the report is also appended to the step summary.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SITE_DIR, '..', '..');
const OUT_DIR = '.wrangler/dry';
const DEFAULT_METAFILE = `${OUT_DIR}/meta.json`;

const FORBIDDEN_PACKAGES = /(^|\/)node_modules\/(@aws-sdk|@smithy|pdf-lib|@pdf-lib|qrcode|pngjs|makerjs|dxf-parser|clipper-lib)\//;
const FORBIDDEN_LIB = /(^|\/)lib\/(nesting|inventory)\//;
const FORBIDDEN_API = /^api\/(s3|notifications|gsc|tenders|tender-scan|funded-startups|scrape-[^/]*|scan-directory)\.(js|mjs|cjs|ts)$/;
// Phase 4: packages of the agent layer (microns-ops) and the ops sources themselves.
const FORBIDDEN_AGENT_PACKAGES = /(^|\/)node_modules\/(@anthropic-ai\/[^/]+|agents|@modelcontextprotocol\/[^/]+|postal-mime|@pdf-lib\/fontkit|@cloudflare\/puppeteer)\//;
const FORBIDDEN_OPS_SOURCE = /^workers\/ops\/src\//;

function parseArgs(argv) {
  const args = { build: false, metafile: DEFAULT_METAFILE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--build') args.build = true;
    else if (argv[i] === '--metafile' && argv[i + 1]) args.metafile = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: node scripts/check-bundle.mjs [--build] [--metafile <path>]');
      process.exit(0);
    } else {
      console.error(`check-bundle: unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

function dryRun() {
  const bin = path.join(SITE_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  if (!existsSync(bin)) {
    console.error('check-bundle: wrangler is not installed in workers/site (run npm ci there)');
    process.exit(2);
  }
  console.log(`check-bundle: wrangler deploy --dry-run --outdir ${OUT_DIR} --metafile ${DEFAULT_METAFILE}`);
  const run = spawnSync(bin, ['deploy', '--dry-run', '--outdir', OUT_DIR, '--metafile', DEFAULT_METAFILE], { cwd: SITE_DIR, stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`check-bundle: dry-run build failed (exit ${run.status})`);
    process.exit(2);
  }
}

/** Repo-relative, forward slashes; esbuild metafile inputs are relative to workers/site (namespaced ones kept). */
function repoRelative(input) {
  if (/^[a-z-]+:/i.test(input)) return input;
  return path.relative(REPO_ROOT, path.resolve(SITE_DIR, input)).split(path.sep).join('/');
}

export function forbiddenReason(repoPath) {
  if (FORBIDDEN_PACKAGES.test(repoPath)) return 'ops-only package';
  if (!repoPath.includes('node_modules/') && FORBIDDEN_LIB.test(repoPath)) return 'ops-only lib';
  if (FORBIDDEN_API.test(repoPath)) return 'handler outside the site';
  if (FORBIDDEN_AGENT_PACKAGES.test(repoPath)) return 'agent-layer package';
  if (FORBIDDEN_OPS_SOURCE.test(repoPath)) return 'microns-ops source';
  return null;
}

const POSTAL_MIME = /(^|\/)node_modules\/postal-mime\//;
const RESEND = /(^|\/)node_modules\/resend\//;

/** Repo paths of the inputs outside postal-mime that import a postal-mime file (metafile import graph). */
export function postalMimeImporters(inputs) {
  const importers = new Set();
  for (const [input, info] of inputs) {
    const from = repoRelative(input);
    if (POSTAL_MIME.test(from)) continue;
    for (const imported of info.imports ?? []) {
      if (POSTAL_MIME.test(repoRelative(imported.path ?? ''))) importers.add(from);
    }
  }
  return [...importers].sort();
}

/** True when postal-mime is in the bundle only as a dependency of resend (see the header). */
export function postalMimeOnlyViaResend(importersOfPostalMime) {
  return importersOfPostalMime.length > 0 && importersOfPostalMime.every((i) => RESEND.test(i));
}

/** forbiddenReason() with the resend exception for postal-mime (see the header). */
export function forbiddenReasonInBundle(repoPath, importersOfPostalMime) {
  if (POSTAL_MIME.test(repoPath) && postalMimeOnlyViaResend(importersOfPostalMime)) return null;
  return forbiddenReason(repoPath);
}

function packageOf(repoPath) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(repoPath);
  if (match) return match[1];
  const [top, second] = repoPath.split('/');
  return top === 'workers' ? `workers/${second}` : top;
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const metafile = path.resolve(SITE_DIR, args.metafile);
  if (args.build || (!existsSync(metafile) && args.metafile === DEFAULT_METAFILE)) dryRun();
  if (!existsSync(metafile)) {
    console.error(`check-bundle: metafile not found: ${path.relative(SITE_DIR, metafile)} (run npm run build:dry)`);
    process.exit(2);
  }

  const meta = JSON.parse(readFileSync(metafile, 'utf8'));
  const inputs = Object.entries(meta.inputs ?? {});
  const forbidden = [];
  const sizes = new Map();
  const postalImporters = postalMimeImporters(inputs);
  for (const [input, info] of inputs) {
    const repoPath = repoRelative(input);
    const reason = forbiddenReasonInBundle(repoPath, postalImporters);
    if (reason) forbidden.push(`${repoPath} (${reason})`);
    const pkg = packageOf(repoPath);
    sizes.set(pkg, (sizes.get(pkg) ?? 0) + (info.bytes ?? 0));
  }

  const lines = [];
  lines.push(`metafile: ${path.relative(SITE_DIR, metafile)} (${new Date(statSync(metafile).mtimeMs).toISOString()})`);
  lines.push(`inputs: ${inputs.length}, forbidden: ${forbidden.length}`);
  for (const [output, info] of Object.entries(meta.outputs ?? {})) {
    if (!/\.m?js$/.test(output)) continue;
    const file = path.resolve(SITE_DIR, output);
    const gzip = existsSync(file) ? kib(gzipSync(readFileSync(file)).byteLength) : 'n/a (output file missing)';
    lines.push(`output ${output}: ${kib(info.bytes)} / gzip ${gzip}`);
  }
  lines.push('largest inputs by package:');
  for (const [pkg, bytes] of [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 12)) lines.push(`  ${kib(bytes).padStart(13)}  ${pkg}`);
  if (inputs.some(([input]) => POSTAL_MIME.test(repoRelative(input))) && postalMimeOnlyViaResend(postalImporters)) {
    lines.push(`postal-mime allowed as a dependency of resend only; importers: ${postalImporters.join(', ')}`);
  }
  if (forbidden.length) {
    lines.push('forbidden inputs (code that belongs to microns-ops or to the legacy S3 handler):');
    for (const entry of forbidden) lines.push(`  ${entry}`);
  }

  const report = lines.join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### microns-site bundle guard\n\`\`\`\n${report}\n\`\`\`\n`);
  }
  if (forbidden.length) {
    console.error(`check-bundle: FAIL, ${forbidden.length} forbidden input(s) in the microns-site bundle`);
    process.exit(1);
  }
  console.log('check-bundle: OK, no forbidden input');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
