// Bundle check of microns-ops, run after `wrangler deploy --dry-run --outdir .wrangler/dry --metafile
// .wrangler/dry/meta.json` (npm run build:dry runs both).
//
// Rules
//   - Every `qrcode` import in the bundle resolves to qrcode's server build (lib/server.js, which has toBuffer):
//     the inventory label code needs it, and without the wrangler alias the bundler resolves the package's
//     browser build. qrcode's server build itself re-exports toCanvas from lib/browser.js, so that file may be in
//     the bundle, but only as an import of lib/server.js.
//   - Phase 4 (agent layer):
//       one copy each of pdf-lib, @supabase/supabase-js and zod (pdf-lib and supabase-js resolve from the root
//       install, next to api/* and lib/*; zod is pinned once for the whole package);
//       the bundle contains @anthropic-ai/sdk, postal-mime, @pdf-lib/fontkit and agents;
//       no input from a test/ or eval/ folder of this repository (fixtures and fakes never ship);
//       the production wrangler.jsonc `vars` hold none of the T2-only names (T2_ONLY_VARS, or any name ending in
//       _API_BASE): those exist only in generated test configs;
//       the bundle stays below the Workers limit of 64 MiB uncompressed.
//   - Phase 5 (consolidated compute):
//       the production `vars` hold none of the Phase 5 T2-only names either (P5_T2_ONLY_VARS: the *_API_BASE
//       overrides, AGENT_GEMINI_BASE_URL, CAD_CONTAINER_BASE_URL; the same list as src/ports/p5.ts);
//       @cloudflare/containers is bundled from exactly one copy: every input under node_modules/@cloudflare/containers/
//       resolves to workers/ops/node_modules/@cloudflare/containers/ (the only declarer), and dist/lib/container.js
//       appears exactly once (the package keeps its outbound-handler registries in module-level maps that
//       ContainerProxy reads by class name, so a second copy breaks interception).
//   - The bundle and its gzip size are printed for the size report.
//
//   node scripts/check-bundle.mjs [path/to/meta.json]   exit 0 = pass, 1 = fail
//   CHECK_BUNDLE_PHASE=2 node scripts/check-bundle.mjs  runs the Phase 2 rules only

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const metaPath = path.resolve(root, process.argv[2] ?? '.wrangler/dry/meta.json');

const QRCODE_SERVER = /(^|\/)node_modules\/qrcode\/lib\/server\.js$/;
const QRCODE_BROWSER = /(^|\/)node_modules\/qrcode\/lib\/browser\.js$/;

/** Var names that only generated T2 configs may set (Phase 5 appends its own). */
export const T2_ONLY_VARS = ['AGENT_STUBS', 'AGENT_LLM_BASE_URL', 'RESEND_API_BASE', 'TELEGRAM_API_BASE', 'GMAIL_API_BASE', 'GOOGLE_TOKEN_URL'];
/** Var names that only generated Phase 5 T2 configs may set (src/ports/p5.ts P5_T2_ONLY_VARS). */
export const P5_T2_ONLY_VARS = ['PULLPUSH_API_BASE', 'HN_API_BASE', 'XOMETRY_API_BASE', 'INDEXNOW_API_BASE', 'AGENT_GEMINI_BASE_URL', 'CAD_CONTAINER_BASE_URL'];
/** Package root of the single @cloudflare/containers copy, relative to the repository root. */
export const CONTAINERS_ROOT = 'workers/ops/node_modules/@cloudflare/containers/';
const CONTAINERS_MARKER = '/node_modules/@cloudflare/containers/';
/** Packages that must appear exactly once in the bundle (by package root). */
export const SINGLE_COPY_PACKAGES = ['pdf-lib', '@supabase/supabase-js', 'zod'];
/** Packages the Phase 4 bundle must contain. */
export const REQUIRED_PACKAGES = ['@anthropic-ai/sdk', 'postal-mime', '@pdf-lib/fontkit', 'agents'];
/** Workers script size limit (uncompressed). */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Problems found in a metafile object; an empty array passes. */
export function bundleProblems(meta) {
  const problems = [];
  const qrcodeImports = [];
  for (const [input, info] of Object.entries(meta.inputs ?? {})) {
    for (const imported of info.imports ?? []) {
      if (imported.original === 'qrcode' || (imported.original ?? '').startsWith('qrcode/')) qrcodeImports.push({ input, path: imported.path });
      if (QRCODE_BROWSER.test(imported.path) && !QRCODE_SERVER.test(input)) {
        problems.push(`${input} imports qrcode's browser build (${imported.path})`);
      }
    }
  }
  if (qrcodeImports.length === 0) problems.push('no qrcode import found (the inventory label code is missing from the bundle)');
  for (const { input, path: resolved } of qrcodeImports) {
    if (!QRCODE_SERVER.test(resolved)) problems.push(`${input}: 'qrcode' resolves to ${resolved}, not lib/server.js (wrangler alias missing?)`);
  }
  return problems;
}

/** Package name and package root of an input path under node_modules (the last node_modules segment), or null. */
export function packageOf(input) {
  const marker = 'node_modules/';
  const at = input.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = input.slice(at + marker.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return { name, root: input.slice(0, at + marker.length) + name };
}

/** Distinct package roots per package name among the metafile inputs. */
export function packageRoots(meta) {
  const roots = new Map();
  for (const input of Object.keys(meta.inputs ?? {})) {
    const pkg = packageOf(input.replace(/\\/g, '/'));
    if (!pkg) continue;
    if (!roots.has(pkg.name)) roots.set(pkg.name, new Set());
    roots.get(pkg.name).add(pkg.root);
  }
  return roots;
}

/** Var names of a wrangler config object that are T2-only. */
export function forbiddenVars(config) {
  return Object.keys(config?.vars ?? {}).filter((name) => T2_ONLY_VARS.includes(name) || /_API_BASE$/.test(name));
}

/** Phase 5 T2-only var names set in a wrangler config object. */
export function forbiddenP5Vars(config) {
  return Object.keys(config?.vars ?? {}).filter((name) => P5_T2_ONLY_VARS.includes(name));
}

/**
 * Repository-relative form of a metafile input path. Inputs are relative to the folder of the wrangler config
 * (workers/ops), so '../../x' is the repository root's x and 'node_modules/x' is workers/ops/node_modules/x; an
 * absolute path is kept with its leading '/'.
 */
export function repoRelative(input) {
  const p = input.replace(/\\/g, '/');
  if (p.startsWith('/')) return p;
  return path.posix.normalize(`workers/ops/${p}`);
}

/** Phase 5 problems of a metafile and the production wrangler config; an empty array passes. */
export function phase5Problems(meta, config) {
  const problems = [];
  const inputs = Object.keys(meta.inputs ?? {}).map((input) => ({ input, rel: repoRelative(input) }));
  const containerInputs = inputs.filter(({ rel }) => `/${rel}`.includes(CONTAINERS_MARKER));
  for (const { input, rel } of containerInputs) {
    if (!rel.startsWith(CONTAINERS_ROOT)) problems.push(`@cloudflare/containers input outside ${CONTAINERS_ROOT}: ${input}`);
  }
  const containerJs = containerInputs.filter(({ rel }) => rel.endsWith('/dist/lib/container.js'));
  if (containerJs.length !== 1) problems.push(`@cloudflare/containers dist/lib/container.js is bundled ${containerJs.length} times (expected exactly once)`);
  for (const name of forbiddenP5Vars(config)) problems.push(`production wrangler.jsonc sets the Phase 5 T2-only var ${name}`);
  return problems;
}

/** Phase 4 problems of a metafile and the production wrangler config; an empty array passes. */
export function phase4Problems(meta, config) {
  const problems = [];
  const roots = packageRoots(meta);
  for (const name of SINGLE_COPY_PACKAGES) {
    const found = roots.get(name);
    if (found && found.size > 1) problems.push(`${name} is bundled ${found.size} times (${[...found].join(', ')})`);
  }
  for (const name of REQUIRED_PACKAGES) {
    if (!roots.has(name)) problems.push(`${name} is not in the bundle`);
  }
  for (const input of Object.keys(meta.inputs ?? {})) {
    const p = input.replace(/\\/g, '/');
    if (!p.includes('node_modules/') && /(^|\/)(test|eval)\//.test(p)) problems.push(`test or eval input in the bundle: ${input}`);
  }
  for (const name of forbiddenVars(config)) problems.push(`production wrangler.jsonc sets the T2-only var ${name}`);
  return problems;
}

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

function kib(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (error) {
    console.error(`check-bundle: cannot read ${metaPath} (run the dry run first): ${error.message}`);
    process.exit(1);
  }
  const problems = bundleProblems(meta);
  const phase4 = process.env.CHECK_BUNDLE_PHASE !== '2';
  if (phase4) {
    const config = parseJsonc(readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
    problems.push(...phase4Problems(meta, config));
    problems.push(...phase5Problems(meta, config));
  }
  let largest = 0;
  for (const [output] of Object.entries(meta.outputs ?? {})) {
    if (!output.endsWith('.js')) continue;
    // Output keys are relative to the folder of the wrangler config that produced them.
    const bases = [root, process.cwd(), path.dirname(path.dirname(metaPath))];
    const file = bases.map((base) => path.resolve(base, output)).find((candidate) => existsSync(candidate));
    if (!file) {
      console.log(`check-bundle: ${output} (file not found, size not printed)`);
      continue;
    }
    const size = statSync(file).size;
    largest = Math.max(largest, size);
    console.log(`check-bundle: ${output} ${kib(size)} / gzip ${kib(gzipSync(readFileSync(file)).length)}`);
  }
  if (phase4 && largest > MAX_BUNDLE_BYTES) problems.push(`bundle is ${kib(largest)}, above the 64 MiB Workers limit`);
  console.log(`check-bundle: ${Object.keys(meta.inputs ?? {}).length} inputs`);
  if (phase4) {
    const roots = packageRoots(meta);
    console.log(`check-bundle: packages ${[...SINGLE_COPY_PACKAGES, ...REQUIRED_PACKAGES, '@cloudflare/containers'].map((n) => `${n}=${roots.get(n)?.size ?? 0}`).join(' ')}`);
  }
  if (problems.length) {
    for (const problem of problems) console.error(`check-bundle: FAIL ${problem}`);
    process.exit(1);
  }
  console.log(`check-bundle: ok ('qrcode' resolves to lib/server.js${phase4 ? '; Phase 4 and Phase 5 rules pass' : ''})`);
}
