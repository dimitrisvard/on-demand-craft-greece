// Bundle check of microns-mail, run after `wrangler deploy --dry-run --outdir .wrangler/dry --metafile
// .wrangler/dry/meta.json` (npm run build:dry runs both).
//
// Rules
//   - The mail Worker parses headers only (src/headers.ts): no npm package is bundled at all, in particular neither
//     postal-mime nor @anthropic-ai/sdk.
//   - Inputs come only from workers/mail/src, workers/shared/src and the one dependency-free module it shares
//     with microns-ops, workers/ops/src/mail-in/auth-results.ts; never from a test/ folder.
//   - The bundle stays below the Workers limit of 64 MiB uncompressed; its size and gzip size are printed.
//
//   node scripts/check-bundle.mjs [path/to/meta.json]   exit 0 = pass, 1 = fail

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const metaPath = path.resolve(root, process.argv[2] ?? '.wrangler/dry/meta.json');

export const FORBIDDEN_PACKAGES = ['postal-mime', '@anthropic-ai/sdk'];
export const ALLOWED_INPUTS = [/^(\.\.\/)*src\//, /(^|\/)workers\/mail\/src\//, /(^|\/)shared\/src\//, /(^|\/)ops\/src\/mail-in\/auth-results\.ts$/];
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Problems of a metafile object; an empty array passes. */
export function bundleProblems(meta) {
  const problems = [];
  for (const input of Object.keys(meta.inputs ?? {})) {
    const p = input.replace(/\\/g, '/');
    for (const pkg of FORBIDDEN_PACKAGES) if (p.includes(`node_modules/${pkg}/`)) problems.push(`${pkg} is bundled (${p})`);
    if (p.includes('node_modules/')) problems.push(`npm package input ${p}`);
    if (/(^|\/)test\//.test(p)) problems.push(`test input ${p}`);
    if (!p.includes('node_modules/') && !ALLOWED_INPUTS.some((re) => re.test(p))) problems.push(`unexpected input ${p}`);
  }
  return problems;
}

function main() {
  if (!existsSync(metaPath)) {
    console.error(`[check-bundle] no metafile at ${metaPath}; run npm run build:dry first`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const problems = bundleProblems(meta);
  const outputs = Object.keys(meta.outputs ?? {}).filter((o) => o.endsWith('.js'));
  let bytes = 0;
  let gzip = 0;
  for (const out of outputs) {
    const file = path.resolve(root, out);
    const target = existsSync(file) ? file : path.resolve(path.dirname(metaPath), path.basename(out));
    if (!existsSync(target)) continue;
    bytes += statSync(target).size;
    gzip += gzipSync(readFileSync(target)).length;
  }
  if (bytes === 0) problems.push('no bundle output found');
  if (bytes > MAX_BUNDLE_BYTES) problems.push(`bundle ${bytes} bytes exceeds ${MAX_BUNDLE_BYTES}`);
  console.log(`[check-bundle] microns-mail bundle ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB), gzip ${gzip} bytes; ${Object.keys(meta.inputs ?? {}).length} inputs`);
  if (problems.length) {
    for (const p of problems) console.error(`[check-bundle] ${p}`);
    process.exit(1);
  }
  console.log('[check-bundle] ok');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
