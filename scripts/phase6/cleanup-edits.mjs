#!/usr/bin/env node
// Text edits, path actions and the mention scan of the Phase 6 repository cleanup (docs/migration/PLAN.md P6-5,
// P6-6). Called by scripts/phase6/cleanup.sh; usable alone from the repository root:
//
//   node scripts/phase6/cleanup-edits.mjs plan --group B|G         one line per edit: TODO | DONE | BLOCKED
//   node scripts/phase6/cleanup-edits.mjs apply [--keep-forward]   applies every TODO edit (refuses if any is BLOCKED)
//   node scripts/phase6/cleanup-edits.mjs actions --group A|C|E|H|I   the moves and deletions of a group, tab-separated
//   node scripts/phase6/cleanup-edits.mjs scan [group flags]       mentions of moved or deleted paths that would break
//   node scripts/phase6/cleanup-edits.mjs gpteng                   tracked files that still name cdn.gpteng.co (report)
//   group flags: --with-statics --with-gsc-functions --with-cron-functions --keep-forward
//
// Groups: A freeze the Vercel config as a reference, B consumer and text edits, C deletions (PLAN.md §5.6 list and
// the Phase 5 hand-over), E static files (opt-in), G retire the Vercel forward (default on), H gsc-* function folders
// (opt-in), I function folders without a caller after Phase 5 (opt-in). Group D (README) is handled by cleanup.sh.
//
// Every edit is an exact string replacement with an expected count, so it is idempotent and refuses to guess:
//   TODO     `find` occurs exactly `count` times                         -> replaced on apply
//   DONE     `find` does not occur and the done check holds              -> nothing to do
//   BLOCKED  anything else (file missing, count differs, half applied)   -> nothing is changed, the line says why
// The mention scan blocks the run when a file outside docs/, reference/, *.md, scripts/phase6/ and
// supabase/migrations/ names a path that the active groups move or delete, unless the line is a known edit or is
// listed in KNOWN_MENTIONS (file + exact line text, with the reason it may stay).
// Paths are relative to the repository root (the current directory). Exit codes: 0 ok, 1 blocked, 2 usage.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REF = 'reference/vercel';
const REF_FUNCTIONS = 'reference/edge-functions';
// The Phase 5 decision ID that the Xometry port-map test cites in two lines removed by E18/E19.
const XOMETRY_ACTION_ID = ['X', '5'].join('-');
const FORWARD_ORIGIN = 'https://on-demand-craft-greece.vercel.app';

// ----- group B: consumers of the two frozen Vercel files and other text edits -----------------------------------
export const CONSUMER_EDITS = [
  {
    id: 'E1',
    group: 'B',
    file: `${REF}/middleware.ts`,
    before: 'middleware.ts', // planned against the file at its old place until the move has run
    why: 'the frozen Vercel middleware keeps importing the shared middleware/ modules from its new place',
    find: "from './middleware/",
    replace: "from '../../middleware/",
    count: 13,
  },
  {
    id: 'E2',
    group: 'B',
    file: 'workers/site/test/seo-handler.test.ts',
    why: 'route-decision test reads the frozen middleware source',
    find: "'../../../middleware.ts?raw'",
    replace: "'../../../reference/vercel/middleware.ts?raw'",
    count: 1,
  },
  {
    id: 'E3',
    group: 'B',
    file: 'workers/site/test/helpers/seo-harness.ts',
    why: 'offline document parity runs the frozen middleware',
    find: "['..', '..', '..', '..', 'middleware.ts']",
    replace: "['..', '..', '..', '..', 'reference', 'vercel', 'middleware.ts']",
    count: 1,
  },
  {
    id: 'E4',
    group: 'B',
    file: 'workers/site/test/fixtures/seo/record.mjs',
    why: 'fixture recorder bundles the frozen middleware',
    find: "path.join(ROOT, 'middleware.ts')",
    replace: "path.join(ROOT, 'reference', 'vercel', 'middleware.ts')",
    count: 1,
  },
  {
    id: 'E5',
    group: 'B',
    file: 'workers/site/test/redirects.test.ts',
    why: 'redirect table test compares with the frozen vercel.json',
    find: "'../../../vercel.json'",
    replace: "'../../../reference/vercel/vercel.json'",
    count: 1,
  },
  {
    id: 'E6',
    group: 'B',
    file: 'workers/shared/test/http/cors.test.ts',
    why: 'parity CORS constants are checked against the frozen vercel.json',
    find: "'../../../../vercel.json'",
    replace: "'../../../../reference/vercel/vercel.json'",
    count: 1,
  },
  {
    id: 'E7',
    group: 'B',
    file: 'workers/shared/test/compat/vercel-rewrite.test.ts',
    why: 'rewrite table is checked against the frozen vercel.json',
    find: "'../../../../vercel.json'",
    replace: "'../../../../reference/vercel/vercel.json'",
    count: 1,
  },
  {
    id: 'E8',
    group: 'B',
    file: 'scripts/seo-parity/lib/urls.mjs',
    why: 'the parity URL set (redirect sources) is built from the frozen vercel.json',
    find: "path.join(root, 'vercel.json')",
    replace: "path.join(root, 'reference', 'vercel', 'vercel.json')",
    count: 1,
  },
  {
    id: 'E9',
    group: 'B',
    file: 'scripts/seo-parity/test/urls-window.test.mjs',
    why: 'parity tool test reads the frozen vercel.json',
    find: "path.join(REPO_ROOT, 'vercel.json')",
    replace: "path.join(REPO_ROOT, 'reference', 'vercel', 'vercel.json')",
    count: 1,
  },
  {
    id: 'E10',
    group: 'B',
    file: 'tests/middleware/smoke.mjs',
    why: 'smoke test bundles the frozen middleware',
    find: "const MIDDLEWARE_TS = path.join(ROOT, 'middleware.ts');",
    replace: "const MIDDLEWARE_TS = path.join(ROOT, 'reference', 'vercel', 'middleware.ts');",
    count: 1,
  },
  {
    id: 'E11',
    group: 'B',
    file: 'tests/middleware/smoke.mjs',
    why: 'the onLoad copy of the frozen middleware resolves its imports from its own directory',
    find: '        resolveDir: ROOT,\n',
    replace: '        resolveDir: path.dirname(MIDDLEWARE_TS),\n',
    count: 1,
  },
  {
    id: 'E12',
    group: 'B',
    file: 'tests/middleware/smoke.mjs',
    why: 'smoke test reads the frozen vercel.json (byte check of one redirect source)',
    find: "readFile(path.join(ROOT, 'vercel.json'))",
    replace: "readFile(path.join(ROOT, 'reference', 'vercel', 'vercel.json'))",
    count: 1,
  },
];

export const OTHER_EDITS = [
  {
    id: 'E13',
    group: 'B',
    file: 'package.json',
    why: 'script of the deleted scripts/dev-server.js',
    find: '    "dev:server": "node scripts/dev-server.js",\n',
    replace: '',
    count: 1,
    done: (text) => !text.includes('scripts/dev-server.js'),
  },
  {
    id: 'E14',
    group: 'B',
    file: 'src/pages/dashboard/XometryQueuePage.tsx',
    why: 'empty-queue hint pointed at the deleted GitHub Action',
    find: "                Queue is empty. Offers appear after the scanner runs — trigger the{' '}\n                <span className=\"font-mono\">xometry-scan</span> GitHub Action (or wait for its\n                schedule). See xometry-bot/README.md.\n",
    replace: "                Queue is empty. Offers appear after the scanner runs: the{' '}\n                <span className=\"font-mono\">xometry</span> job of microns-ops (flag agent.growth.xometry),\n                every two hours from 06:00 to 18:00 UTC.\n",
    count: 1,
  },
  {
    id: 'E18',
    group: 'B',
    file: 'workers/ops/test/p5/xometry/port-map.test.ts',
    why: 'header line of the check of the deleted xometry-scan.yml workflow',
    find: `// Also checks the repository-variable guard of .github/workflows/xometry-scan.yml (${XOMETRY_ACTION_ID}).\n`,
    replace: '',
    count: 1,
    done: (text) => !text.includes('Also checks the repository-variable guard'),
  },
  {
    id: 'E19',
    group: 'B',
    file: 'workers/ops/test/p5/xometry/port-map.test.ts',
    why: 'the checks of the deleted xometry-scan.yml workflow go with it',
    find:
      '\n' +
      `describe('.github/workflows/xometry-scan.yml (${XOMETRY_ACTION_ID})', () => {\n` +
      "  const text = readFileSync(new URL('.github/workflows/xometry-scan.yml', REPO_ROOT), 'utf8');\n" +
      '\n' +
      "  it('the job skips scheduled runs when the repository variable XOMETRY_SCAN_SCHEDULE is off', () => {\n" +
      "    expect(text).toMatch(/\\njobs:\\n {2}scan:\\n(?: {4}#.*\\n)* {4}if: github\\.event_name != 'schedule' \\|\\| vars\\.XOMETRY_SCAN_SCHEDULE != 'off'\\n {4}runs-on: ubuntu-latest\\n/);\n" +
      '  });\n' +
      '\n' +
      "  it('keeps workflow_dispatch, the schedule and the scan step unchanged', () => {\n" +
      "    expect(text).toContain('  workflow_dispatch: {}\\n');\n" +
      '    expect(text).toContain(\'    - cron: "0 6,8,10,12,14,16,18 * * *"\\n\');\n' +
      "    expect(text).toContain('        run: python -m xometry_bot.pipeline');\n" +
      '    expect(text.match(/^\\s+if:/gm)).toHaveLength(4);\n' +
      '  });\n' +
      '});\n',
    replace: '',
    count: 1,
    done: (text) => !text.includes('xometry-scan.yml'),
  },
  {
    id: 'E20',
    group: 'B',
    file: 'workers/ops/test/p5/marketing/repo-oracle.ts',
    why: 'the parity oracle reads the two never-deployed functions from their frozen reference copy',
    find:
      'export function repoSourcePath(name: RepoFunction): string {\n' +
      '  return new URL(`supabase/functions/${name}/index.ts`, REPO_ROOT).pathname;\n' +
      '}\n',
    replace:
      'export function repoSourcePath(name: RepoFunction): string {\n' +
      `  // process-followups and process-warmup were never deployed; their source is kept in ${REF_FUNCTIONS}/.\n` +
      `  const dir = name === 'send-campaign' ? 'supabase/functions' : '${REF_FUNCTIONS}';\n` +
      '  return new URL(`${dir}/${name}/index.ts`, REPO_ROOT).pathname;\n' +
      '}\n',
    count: 1,
  },
];

// ----- group G: retire the Vercel forward (default on; --keep-forward skips it) -----------------------------------
// With an empty origin every forward answers 502 without an outbound request (workers/site/src/api/forward.ts).
export const FORWARD_EDITS = [
  {
    id: 'E16',
    group: 'G',
    file: 'workers/site/wrangler.jsonc',
    why: 'forward origin of the retired Vercel deployment, top level and env.production',
    find: `"API_FORWARD_ORIGIN": "${FORWARD_ORIGIN}",`,
    replace: '"API_FORWARD_ORIGIN": "",',
    count: 2,
  },
  {
    id: 'E17a',
    group: 'G',
    file: 'workers/site/test/env-api.test.ts',
    why: 'expected forward origin follows E16',
    find: `      API_FORWARD_ORIGIN: '${FORWARD_ORIGIN}',\n`,
    replace: "      API_FORWARD_ORIGIN: '',\n",
    count: 1,
  },
  {
    id: 'E17b',
    group: 'G',
    file: 'workers/site/test/env-api.test.ts',
    why: 'the host comparison becomes the empty-origin check',
    find: '    expect(new URL(site.vars.API_FORWARD_ORIGIN).host).not.toBe(new URL(site.vars.SITE_ORIGIN).host);\n',
    replace: "    expect(site.vars.API_FORWARD_ORIGIN).toBe('');\n",
    count: 1,
  },
  {
    id: 'E17c',
    group: 'G',
    file: 'workers/site/test/env-api.test.ts',
    why: 'test title follows E16',
    find: "  it('vars: forward off by default, forward origin is the Vercel deployment host, gate defaults', () => {\n",
    replace: "  it('vars: forward off by default, forward origin retired (empty), gate defaults', () => {\n",
    count: 1,
  },
];

export const ALL_EDITS = [...CONSUMER_EDITS, ...OTHER_EDITS, ...FORWARD_EDITS];

// ----- moves and deletions (groups A, C, E, H, I) ------------------------------------------------------------------
const fnNames = (name) => [new RegExp(`functions/(v1/)?${name}(?![\\w-])`), new RegExp(`['"\`]${name}(?![\\w-])`)];
const fnDelete = (group, name, why) => ({ group, op: 'rm', src: `supabase/functions/${name}`, why, names: fnNames(name), fn: name });
const fnFreeze = (name, why) => ({ group: 'C', op: 'mv', src: `supabase/functions/${name}`, dst: `${REF_FUNCTIONS}/${name}`, why, names: fnNames(name), fn: name });

export const PATH_ACTIONS = [
  { group: 'A', op: 'mv', src: 'vercel.json', dst: `${REF}/vercel.json`, why: 'redirect, rewrite and header reference', names: [/['"`/]vercel\.json['"`]/] },
  { group: 'A', op: 'mv', src: 'middleware.ts', dst: `${REF}/middleware.ts`, why: 'SEO handler reference', names: [/['"`/]middleware\.ts(\?raw)?['"`]/] },
  { group: 'A', op: 'mv', src: 'docs/migration/phase6/reference-vercel-README.md', dst: `${REF}/README.md`, why: 'what the folder is', names: [] },
  { group: 'C', op: 'rm', src: 'scripts/dev-server.js', why: 'local Vercel API emulator; script entry removed by edit E13', names: [/scripts\/dev-server\.js/] },
  { group: 'C', op: 'rm', src: 'scripts/freecad-unfold', why: 'superseded by sheet-metal-service/', names: [/freecad-unfold/] },
  { group: 'C', op: 'rm', src: '.github/workflows/auto-merge-claude.yml', why: 'merges claude/** into main; main no longer deploys by push', names: [/auto-merge-claude\.yml/] },
  { group: 'C', op: 'rm', src: '.github/workflows/xometry-scan.yml', why: 'the scan runs as the xometry job of microns-ops since Phase 5', names: [/xometry-scan\.yml/] },
  { group: 'C', op: 'rm', src: 'docs/AWS_S3_VERCEL_GUIDE.md', why: 'Vercel-era storage guide', names: [/AWS_S3_VERCEL_GUIDE/] },
  fnDelete('C', 'check-replies', 'never deployed; replaced by the Phase 4 Gmail poller'),
  fnFreeze('process-followups', 'never deployed; ported in Phase 5, kept as the frozen parity oracle of the port'),
  fnFreeze('process-warmup', 'never deployed; ported in Phase 5, kept as the frozen parity oracle of the port'),
  { group: 'C', op: 'mv', src: 'docs/migration/phase6/reference-edge-functions-README.md', dst: `${REF_FUNCTIONS}/README.md`, why: 'what the folder is', names: [] },
  fnDelete('C', 'fix-broken-tables', 'never deployed one-off maintenance function'),
  { group: 'E', op: 'rm', src: 'public/laserkritis', why: 'static tenant page; /laserkritis/ then answers the SPA shell', names: [/public\/laserkritis|(?<![\w.-])\/laserkritis\//] },
  { group: 'E', op: 'rm', src: 'public/cookie-consent.html', why: 'standalone page; /cookie-consent.html then answers the SPA shell', names: [/cookie-consent\.html/] },
  ...['gsc-sitemap-sync', 'gsc-performance', 'gsc-index-url', 'gsc-inspect-url'].map((n) =>
    fnDelete('H', n, 'deleted in Supabase after the caller check (OW6-13)'),
  ),
  ...['process-article-queue', 'auto-update-sitemap', 'auto-translate-articles', 'tender-collector'].map((n) =>
    fnDelete('I', n, 'no caller after Phase 5; deleted in Supabase after the log check (OW6-17)'),
  ),
];

// Mentions that may stay when their path moves or goes: file + exact line text (indentation ignored) + reason.
// Enumerated on the tree that closes the Phase 3/6 build; a new mention blocks the run until it is edited or listed.
export const KNOWN_MENTIONS = [
  // group C: comments citing the ported source (history)
  { file: 'workers/ops/src/cron/gmail-poller.ts', text: '//             supabase/functions/check-replies/index.ts:110-140 does; anything else is left alone (no label, no', reason: 'ported from (history)' },
  { file: 'workers/ops/src/cron/gmail-poller.ts', text: '//     the reply still counts), as supabase/functions/check-replies/index.ts:127-137 does.', reason: 'ported from (history)' },
  { file: 'workers/ops/src/db/repos/senders.ts', text: '//   - Campaign replies keep the semantics of supabase/functions/check-replies/index.ts:110-140: the subscriber is', reason: 'ported from (history)' },
  { file: 'workers/ops/src/marketing/followups.ts', text: '// supabase/functions/process-followups/index.ts:61-215. The dispatcher (src/cron/run-schedule.ts) opens the run', reason: 'ported from (source kept in reference/edge-functions/)' },
  { file: 'workers/ops/src/marketing/warmup.ts', text: '// of the sender accounts, ported from supabase/functions/process-warmup/index.ts:18-90. The dispatcher', reason: 'ported from (source kept in reference/edge-functions/)' },
  // group C: the Phase 5 parity oracle names the two functions; edit E20 points it at the reference copy
  { file: 'workers/ops/test/p5/marketing/repo-oracle.ts', text: "export type RepoFunction = 'send-campaign' | 'process-followups' | 'process-warmup';", reason: 'oracle names; source read from reference/edge-functions/ after E20' },
  { file: 'workers/ops/test/p5/marketing/repo-parity.test.ts', text: "const repo = loadRepo('process-followups', { env: { TRACKING_DOMAIN: DOMAIN }, supabase: oracleSupabase({}), random: seeded(1), exportNames: ['injectTrackingPixel', 'injectUnsubscribeLink', 'parseSpintax'] }).fns as unknown as {", reason: 'oracle call; source read from reference/edge-functions/ after E20' },
  { file: 'workers/ops/test/p5/marketing/repo-parity.test.ts', text: "const repo = loadRepo('process-followups', { env: { TRACKING_DOMAIN: DOMAIN, RESEND_API_KEY: 'resend-test-value' }, supabase: sb, random: seeded(7), exportNames: [] });", reason: 'oracle call; source read from reference/edge-functions/ after E20' },
  { file: 'workers/ops/test/p5/marketing/repo-parity.test.ts', text: "const repo = loadRepo('process-warmup', { env: {}, supabase: sb, random: seeded(1), exportNames: [] });", reason: 'oracle call; source read from reference/edge-functions/ after E20' },
  // group E: the parity URL set keeps both paths (their answer becomes the SPA shell, an explained difference)
  { file: 'scripts/seo-parity/lib/urls.mjs', text: "['/laserkritis/'], ['/laserkritis/index.html'],", reason: 'parity URL set (history)' },
  { file: 'scripts/seo-parity/lib/urls.mjs', text: "['/occt-import-js.wasm', { methods: ['HEAD'] }], ['/occt-import-js.js'], ['/index.html'], ['/cookie-consent.html'], ['/_redirects'],", reason: 'parity URL set (history)' },
  { file: 'workers/site/src/static.ts', text: '// (public/laserkritis/, public/zohoverify/) is emulated here when <dir>/index.html exists. Everything else goes', reason: 'example in a comment; the rule stays for public/zohoverify/' },
  { file: 'workers/site/wrangler.jsonc', text: "// Router step 5: serve <dir>/index.html for /dir/ and /dir (public/laserkritis/, public/zohoverify/) as Vercel's", reason: 'example in a comment; the rule stays for public/zohoverify/' },
  // group I: cron job names of the Phase 5 switch-over check (the jobs are unscheduled by then)
  { file: 'scripts/phase5/parity.sql', text: "'auto-update-sitemap', 'enqueue-daily-article', 'process-article-queue',", reason: 'job names of the Phase 5 switch-over check (history)' },
  { file: 'supabase/tests/phase5/cron-switch.test.mjs', text: "[15, 'process-article-queue', '*/5 * * * *', http('process-article-queue')],", reason: 'job names of the Phase 5 switch-over test (history)' },
  { file: 'supabase/tests/phase5/cron-switch.test.mjs', text: "[19, 'auto-update-sitemap', '0 9 * * *', http('auto-update-sitemap')],", reason: 'job names of the Phase 5 switch-over test (history)' },
  { file: 'supabase/tests/phase5/cron-switch.test.mjs', text: "[22, 'auto-translate-daily-articles', '0 8 * * *', http('auto-translate-articles')],", reason: 'job names of the Phase 5 switch-over test (history)' },
  { file: 'supabase/tests/phase5/cron-switch.test.mjs', text: "[28, 'tender-scan-daily', '0 6 * * *', http('tender-collector')],", reason: 'job names of the Phase 5 switch-over test (history)' },
];

const SCAN_EXCLUDE = [/^docs\//, /^reference\//, /\.md$/, /^scripts\/phase6\//, /^supabase\/migrations\//];
const BINARY = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|eot|pdf|stl|step|stp|dxf|glb|gltf|wasm|lockb|zip|gz|bin|mp4|webm|mp3)$/i;

export function countOf(text, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

/** State of one edit: { state: 'TODO' | 'DONE' | 'BLOCKED', detail }. */
export function editState(edit, readFile = (f) => readFileSync(f, 'utf8'), exists = existsSync) {
  let file = edit.file;
  if (!exists(file) && edit.before && exists(edit.before)) file = edit.before;
  if (!exists(file)) return { state: 'BLOCKED', detail: `${edit.file} does not exist` };
  const text = readFile(file);
  const found = countOf(text, edit.find);
  if (found === edit.count) {
    return { state: 'TODO', detail: `${found} occurrence(s)${file !== edit.file ? `, in ${file} until it is moved` : ''}` };
  }
  const done = edit.done ? edit.done(text) : countOf(text, edit.replace) >= edit.count;
  if (found === 0 && done) return { state: 'DONE', detail: 'already applied' };
  return { state: 'BLOCKED', detail: `expected ${edit.count} occurrence(s) of the old text, found ${found}; new text present: ${done}` };
}

export function applyEdit(edit) {
  const text = readFileSync(edit.file, 'utf8');
  writeFileSync(edit.file, text.split(edit.find).join(edit.replace));
}

/** Option flags of the command line as the active groups. */
export function groupsFrom(argv) {
  return {
    forward: !argv.includes('--keep-forward'),
    statics: argv.includes('--with-statics'),
    gsc: argv.includes('--with-gsc-functions'),
    cron: argv.includes('--with-cron-functions'),
  };
}

export function editsFor({ forward = true } = {}) {
  return [...CONSUMER_EDITS, ...OTHER_EDITS, ...(forward ? FORWARD_EDITS : [])];
}

export function actionsFor({ statics = false, gsc = false, cron = false } = {}) {
  const on = { A: true, C: true, E: statics, H: gsc, I: cron };
  return PATH_ACTIONS.filter((a) => on[a.group]);
}

/** True when `line` is covered by an edit text: one of its lines (multi-line text) or containing it (one line). */
function partOf(line, snippet) {
  if (!snippet || !line.trim()) return false;
  const s = snippet.endsWith('\n') ? snippet.slice(0, -1) : snippet;
  return s.includes('\n') ? s.split('\n').includes(line) : line.includes(s);
}

function isExcluded(file, action) {
  return SCAN_EXCLUDE.some((re) => re.test(file)) || BINARY.test(file) || file === action.src || file.startsWith(`${action.src}/`);
}

/**
 * Lines that name a path the active groups move or delete and are neither a known edit nor a known mention, plus
 * supabase/config.toml sections of deleted function folders. Each result is one BLOCKED reason.
 */
export function mentionScan(files, groups = {}, readFile = (f) => readFileSync(f, 'utf8')) {
  const actions = actionsFor(groups).filter((a) => a.names.length);
  const edits = editsFor(groups);
  const known = new Set(KNOWN_MENTIONS.map((m) => `${m.file}\n${m.text.trim()}`));
  const hits = [];
  for (const file of files) {
    const relevant = actions.filter((a) => !isExcluded(file, a));
    if (!relevant.length) continue;
    let text;
    try {
      text = readFile(file);
    } catch {
      continue;
    }
    if (typeof text !== 'string') continue;
    const fileEdits = edits.filter((e) => e.file === file || e.before === file);
    text.split('\n').forEach((line, i) => {
      for (const action of relevant) {
        if (!action.names.some((re) => re.test(line))) continue;
        if (known.has(`${file}\n${line.trim()}`)) continue;
        // A known edit: the line holds the edit's old text (before the run) or its new text (after it).
        if (fileEdits.some((e) => partOf(line, e.find) || partOf(line, e.replace))) continue;
        hits.push(`${file}:${i + 1} names ${action.src}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
  const config = files.includes('supabase/config.toml') ? readFile('supabase/config.toml') : '';
  for (const action of actionsFor(groups)) {
    if (action.fn && typeof config === 'string' && config.includes(`[functions.${action.fn}]`)) {
      hits.push(`supabase/config.toml has a section [functions.${action.fn}] for ${action.src}`);
    }
  }
  return hits;
}

/** Files that still name cdn.gpteng.co (reported, never edited: index.html is changed at build time). */
export function gptengMentions(files, readFile = (f) => readFileSync(f, 'utf8')) {
  const out = [];
  for (const file of files) {
    if (SCAN_EXCLUDE.some((re) => re.test(file)) || BINARY.test(file)) continue;
    let text;
    try {
      text = readFile(file);
    } catch {
      continue;
    }
    if (typeof text === 'string' && text.includes('cdn.gpteng.co')) out.push(file);
  }
  return out;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((f) => f && existsSync(f));
}

function optionValue(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  const groups = groupsFrom(rest);
  if (cmd === 'scan') {
    const hits = mentionScan(trackedFiles(), groups);
    for (const h of hits) console.log(`BLOCKED  ${h}`);
    return hits.length ? 1 : 0;
  }
  if (cmd === 'gpteng') {
    for (const f of gptengMentions(trackedFiles())) console.log(`NOTE  ${f} names cdn.gpteng.co (reported, not edited)`);
    return 0;
  }
  if (cmd === 'actions') {
    const group = optionValue(rest, '--group');
    if (!['A', 'C', 'E', 'H', 'I'].includes(group ?? '')) {
      console.error('usage: cleanup-edits.mjs actions --group A|C|E|H|I');
      return 2;
    }
    for (const a of PATH_ACTIONS.filter((x) => x.group === group)) console.log([a.op, a.src, a.dst ?? '-', a.why].join('\t'));
    return 0;
  }
  if (cmd === 'plan') {
    const group = optionValue(rest, '--group');
    if (!['B', 'G'].includes(group ?? '')) {
      console.error('usage: cleanup-edits.mjs plan --group B|G');
      return 2;
    }
    const states = ALL_EDITS.filter((e) => e.group === group).map((e) => ({ e, ...editState(e) }));
    for (const { e, state, detail } of states) console.log(`${state.padEnd(7)}  edit ${e.id} ${e.file}: ${e.why} (${detail})`);
    return states.some((s) => s.state === 'BLOCKED') ? 1 : 0;
  }
  if (cmd !== 'apply') {
    console.error('usage: cleanup-edits.mjs plan --group B|G | apply [--keep-forward] | actions --group A|C|E|H|I | scan [flags] | gpteng');
    return 2;
  }
  // apply: every edit must be TODO or DONE; prints the changed files, one per line, for `git add`.
  const edits = editsFor(groups);
  const states = edits.map((e) => ({ e, ...editState(e) }));
  const blocked = states.filter((s) => s.state === 'BLOCKED');
  for (const { e, detail } of blocked) console.error(`BLOCKED  edit ${e.id} ${e.file}: ${detail}`);
  if (blocked.length) return 1;
  const changed = new Set();
  for (const { e, state } of states) {
    if (state !== 'TODO') continue;
    applyEdit(e);
    changed.add(e.file);
  }
  const after = edits.map((e) => ({ e, ...editState(e) }));
  const notDone = after.filter((s) => s.state !== 'DONE');
  for (const { e, state, detail } of notDone) console.error(`${state}  edit ${e.id} ${e.file} after apply: ${detail}`);
  if (notDone.length) return 1;
  for (const file of changed) console.log(file);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
