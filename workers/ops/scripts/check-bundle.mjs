// Bundle check of microns-ops, run after `wrangler deploy --dry-run --outdir .wrangler/dry --metafile
// .wrangler/dry/meta.json` (npm run build:dry runs both).
//
// Rules
//   - Every `qrcode` import in the bundle resolves to qrcode's server build (lib/server.js, which has toBuffer):
//     the inventory label code needs it, and without the wrangler alias the bundler resolves the package's
//     browser build. qrcode's server build itself re-exports toCanvas from lib/browser.js, so that file may be in
//     the bundle, but only as an import of lib/server.js.
//   - The bundle and its gzip size are printed for the size report.
//
//   node scripts/check-bundle.mjs [path/to/meta.json]   exit 0 = pass, 1 = fail

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const metaPath = path.resolve(root, process.argv[2] ?? '.wrangler/dry/meta.json');

const QRCODE_SERVER = /(^|\/)node_modules\/qrcode\/lib\/server\.js$/;
const QRCODE_BROWSER = /(^|\/)node_modules\/qrcode\/lib\/browser\.js$/;

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
    console.log(`check-bundle: ${output} ${kib(size)} / gzip ${kib(gzipSync(readFileSync(file)).length)}`);
  }
  console.log(`check-bundle: ${Object.keys(meta.inputs ?? {}).length} inputs`);
  if (problems.length) {
    for (const problem of problems) console.error(`check-bundle: FAIL ${problem}`);
    process.exit(1);
  }
  console.log("check-bundle: ok ('qrcode' resolves to lib/server.js)");
}
