// Tests of the Phase 6 cleanup (scripts/phase6/cleanup.sh, cleanup-edits.mjs). Run: node --test scripts/phase6/test/*.test.mjs
// The end-to-end cases work on a throw-away local clone that carries this checkout's working tree as one commit, never
// on this checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_EDITS,
  CONSUMER_EDITS,
  FORWARD_EDITS,
  KNOWN_MENTIONS,
  OTHER_EDITS,
  PATH_ACTIONS,
  actionsFor,
  countOf,
  editState,
  gptengMentions,
  main,
  mentionScan,
} from '../cleanup-edits.mjs';

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' }).trim();
const ALL_GROUPS = { forward: true, statics: true, gsc: true, cron: true };
const edit = (id) => ALL_EDITS.find((e) => e.id === id);

function memFs(files) {
  return { read: (f) => files[f], exists: (f) => Object.hasOwn(files, f) };
}
const scan = (files, groups = {}) => mentionScan(Object.keys(files), groups, (f) => files[f]);

// ----- edits -------------------------------------------------------------------------------------------------------

test('editState: TODO with the expected count, DONE once applied, BLOCKED on drift or a missing file', () => {
  const e = { id: 'X', file: 'a.ts', find: "'old'", replace: "'new'", count: 2 };
  const s = (files) => {
    const fs = memFs(files);
    return editState(e, fs.read, fs.exists).state;
  };
  assert.equal(s({ 'a.ts': "'old' 'old'" }), 'TODO');
  assert.equal(s({ 'a.ts': "'new' 'new'" }), 'DONE');
  assert.equal(s({ 'a.ts': "'old' 'new'" }), 'BLOCKED');
  assert.equal(s({ 'a.ts': "'old'" }), 'BLOCKED');
  assert.equal(s({ 'a.ts': 'nothing' }), 'BLOCKED');
  assert.equal(s({}), 'BLOCKED');
});

test('editState: an edit of a moved file is planned against its old place', () => {
  const old = "import a from './middleware/a';\n".repeat(13);
  const fs = memFs({ 'middleware.ts': old });
  const r = editState(edit('E1'), fs.read, fs.exists);
  assert.equal(r.state, 'TODO');
  assert.match(r.detail, /in middleware\.ts until it is moved/);
});

test('removal edits are DONE only when the removed text is gone', () => {
  const e13 = edit('E13');
  const state = (text) => {
    const fs = memFs({ 'package.json': text });
    return editState(e13, fs.read, fs.exists).state;
  };
  assert.equal(state(`{\n  "scripts": {\n${e13.find}    "build": "vite build"\n  }\n}\n`), 'TODO');
  assert.equal(state('{\n  "scripts": {\n    "build": "vite build"\n  }\n}\n'), 'DONE');
  assert.equal(state('{ "scripts": { "dev:server": "node scripts/dev-server.js --port 3001" } }'), 'BLOCKED');
});

test('group G: the forward retirement needs exactly two origins in the site config', () => {
  const e16 = edit('E16');
  const line = (v) => `"API_FORWARD_ORIGIN": "${v}",`;
  const origin = 'https://on-demand-craft-greece.vercel.app';
  const state = (...values) => {
    const fs = memFs({ 'workers/site/wrangler.jsonc': values.map(line).join('\n') });
    return editState(e16, fs.read, fs.exists).state;
  };
  assert.equal(state(origin, origin), 'TODO');
  assert.equal(state('', ''), 'DONE');
  assert.equal(state(origin), 'BLOCKED', 'env.production without the origin');
  assert.equal(state(origin, origin, origin), 'BLOCKED', 'a third block');
  assert.equal(state(origin, ''), 'BLOCKED', 'half applied');
  assert.equal(state('https://other.example', 'https://other.example'), 'BLOCKED', 'another origin');
});

const E17_FILE = 'workers/site/test/env-api.test.ts';
const E17 = FORWARD_EDITS.filter((e) => e.file === E17_FILE);
const e17States = (text) => E17.map((e) => editState(e, () => text, () => true).state);
const applyE17 = (text) => E17.reduce((t, e) => t.split(e.find).join(e.replace), text);

/**
 * The E17 round trip on the env-api test as a checkout holds it: before the cleanup every edit is TODO; once the
 * cleanup is committed every edit is DONE, and the round trip runs on that text with E17 reverted.
 */
function e17RoundTrip(live) {
  const states = e17States(live);
  const committed = states.every((s) => s === 'DONE');
  if (committed) {
    for (const e of E17) assert.equal(countOf(live, e.replace), e.count, `${e.id}: replacement count`);
  } else {
    assert.deepEqual(states, ['TODO', 'TODO', 'TODO'], 'the env-api test holds every E17 find');
  }
  const before = committed ? E17.reduce((t, e) => t.split(e.replace).join(e.find), live) : live;
  assert.deepEqual(e17States(before), ['TODO', 'TODO', 'TODO']);
  const after = applyE17(before);
  assert.deepEqual(e17States(after), ['DONE', 'DONE', 'DONE']);
  if (committed) assert.equal(after, live, 'reverting and re-applying E17 gives the committed file back');
  assert.ok(!after.includes('vercel.app'));
  assert.match(after, /expect\(site\.vars\.API_FORWARD_ORIGIN\)\.toBe\(''\);/);
  assert.equal(countOf(after, '\n'), countOf(before, '\n'), 'line count unchanged');
}

test('group G: E17 turns the env-api expectations into the empty origin, before and after the cleanup is committed', () => {
  assert.deepEqual(E17.map((e) => e.id), ['E17a', 'E17b', 'E17c']);
  const live = readFileSync(join(REPO, E17_FILE), 'utf8');
  e17RoundTrip(live);
  e17RoundTrip(applyE17(live)); // the same file on a checkout where the cleanup is committed
});

test('the Phase 5 test consumers are repointed or trimmed with their deleted files', () => {
  const portMap = readFileSync(join(REPO, 'workers/ops/test/p5/xometry/port-map.test.ts'), 'utf8');
  const trimmed = [edit('E18'), edit('E19')].reduce((t, e) => t.split(e.find).join(e.replace), portMap);
  assert.ok(!trimmed.includes('xometry-scan.yml'), 'no read of the deleted workflow is left');
  assert.match(trimmed, /describe\('port map of the Python test suite'/, 'the port map itself stays');
  const oracle = readFileSync(join(REPO, 'workers/ops/test/p5/marketing/repo-oracle.ts'), 'utf8');
  const repointed = oracle.split(edit('E20').find).join(edit('E20').replace);
  assert.match(repointed, /name === 'send-campaign' \? 'supabase\/functions' : 'reference\/edge-functions'/);
  const moved = PATH_ACTIONS.filter((a) => a.op === 'mv' && a.src.startsWith('supabase/functions/')).map((a) => a.dst);
  assert.deepEqual(moved, ['reference/edge-functions/process-followups', 'reference/edge-functions/process-warmup']);
});

test('the README the cleanup puts in place describes the zone redirects as the committed rule payload configures them', () => {
  const prepared = 'docs/migration/phase6/root-README.md'; // moved to README.md by the cleanup
  const readme = readFileSync(join(REPO, existsSync(join(REPO, prepared)) ? prepared : 'README.md'), 'utf8');
  const { rules } = JSON.parse(readFileSync(join(REPO, 'scripts/phase3/payloads/redirect-rules.default.json'), 'utf8'));
  const target = (expression) => rules.find((r) => r.expression === expression)?.action_parameters.from_value.target_url.expression ?? '';
  assert.match(target('(not ssl)'), /^concat\("https:\/\/", http\.host, /, 'HTTP goes to HTTPS on the same host');
  assert.match(target('(http.host eq "micronshub.eu")'), /^concat\("https:\/\/www\.micronshub\.eu", /, 'the apex goes to www');

  const start = readme.indexOf('\n## Deployment\n');
  assert.ok(start > -1, 'a Deployment section');
  const end = readme.indexOf('\n## ', start + 1);
  const rows = readme.slice(start, end === -1 ? undefined : end).split('\n').filter((line) => line.startsWith('|'));
  const httpRows = rows.filter((row) => row.includes('`http://`'));
  assert.ok(httpRows.length > 0, 'a row for http:// requests');
  for (const row of httpRows) {
    assert.match(row, /same host/, row);
    assert.ok(!row.includes('https://www.micronshub.eu'), row);
  }
  const apexRows = rows.filter((row) => /\bapex\b/i.test(row));
  assert.ok(apexRows.length > 0, 'a row for the apex');
  for (const row of apexRows) assert.ok(row.includes('`https://www.micronshub.eu`'), row);
});

// ----- mention scan, one blocking case per group -------------------------------------------------------------------

test('group A: a new path reference to vercel.json or middleware.ts blocks; citations, docs and references do not', () => {
  const smokeOld = edit('E10').find;
  const smokeNew = edit('E10').replace;
  const hits = scan({
    'tools/x.mjs': "import v from '../vercel.json';\n",
    'tools/y.ts': "const p = path.join(root, 'middleware.ts');\n",
    'tools/z.ts': "// as middleware.ts's Map does; see vercel.json:59\n",
    'docs/a.md': "'vercel.json'\n",
    'reference/vercel/README.md': "'middleware.ts'\n",
    'tests/middleware/smoke.mjs': `${smokeOld}\n${smokeNew}\n`,
  });
  assert.deepEqual(hits.map((h) => h.split(':')[0]), ['tools/x.mjs', 'tools/y.ts']);
});

test('group C: a new mention of a deleted path blocks unless it is a known edit or a known mention', () => {
  const known = KNOWN_MENTIONS.find((m) => m.file === 'workers/ops/src/cron/gmail-poller.ts');
  const files = {
    'src/x.ts': '// see scripts/dev-server.js\n',
    'package.json': edit('E13').find,
    [known.file]: `    ${known.text}\n`,
    'scripts/freecad-unfold/Dockerfile': '# docker build -t freecad-unfold .\n',
    'supabase/migrations/20250101_x.sql': "select net.http_post('https://x/functions/v1/check-replies');\n",
    'workers/ops/src/y.ts': '// moved from .github/workflows/xometry-scan.yml\n',
  };
  const hits = scan(files);
  assert.deepEqual(hits.map((h) => h.split(' ')[0]), ['src/x.ts:1', 'workers/ops/src/y.ts:1']);
  assert.match(hits[0], /names scripts\/dev-server\.js/);
});

test('group C: function folders are matched by path, by URL and by quoted name, not by longer names', () => {
  const hits = scan({
    'src/a.ts': 'fetch(`${base}/functions/v1/check-replies`);\n',
    'src/b.ts': "loadRepo('process-warmup');\n",
    'src/c.ts': 'const p = "supabase/functions/fix-broken-tables/index.ts";\n',
    'src/d.ts': "call('check-replies-old'); // works as check-replies does\n",
  });
  assert.deepEqual(hits.map((h) => h.split(':')[0]), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
});

test('group H: gsc-* folders are scanned only with --with-gsc-functions; a mention or a config.toml section blocks', () => {
  const files = {
    'src/gsc.ts': "await supabase.functions.invoke('gsc-index-url');\n",
    'supabase/config.toml': '[functions.gsc-performance]\nverify_jwt = false\n',
  };
  assert.deepEqual(scan(files), []);
  const hits = scan(files, { gsc: true });
  assert.equal(hits.length, 2);
  assert.match(hits[0], /^src\/gsc\.ts:1 names supabase\/functions\/gsc-index-url/);
  assert.match(hits[1], /config\.toml has a section \[functions\.gsc-performance\]/);
});

test('group I: cron function folders are scanned only with --with-cron-functions; listed job names do not block', () => {
  const listed = KNOWN_MENTIONS.find((m) => m.file === 'supabase/tests/phase5/cron-switch.test.mjs');
  const files = {
    [listed.file]: `  ${listed.text}\n`,
    'workers/ops/src/z.ts': 'const url = `${SUPABASE_URL}/functions/v1/tender-collector`;\n',
    'supabase/config.toml': '[functions.auto-update-sitemap]\nverify_jwt = false\n',
  };
  assert.deepEqual(scan(files), []);
  const hits = scan(files, { cron: true });
  assert.equal(hits.length, 2);
  assert.match(hits[0], /^workers\/ops\/src\/z\.ts:1 names supabase\/functions\/tender-collector/);
  assert.match(hits[1], /\[functions\.auto-update-sitemap\]/);
  assert.equal(actionsFor({ cron: true }).filter((a) => a.group === 'I').length, 4);
});

test('group E (statics): site paths of the static files block only with --with-statics; social links do not', () => {
  const files = {
    'src/footer.tsx': '<a href="https://www.facebook.com/laserkritis/">\n',
    'src/pages/tenants/laserkritis/Page.tsx': "import x from './LKFooter';\n",
    'src/links.ts': "const legacy = ['/laserkritis/', '/cookie-consent.html'];\n",
  };
  assert.deepEqual(scan(files), []);
  const hits = scan(files, { statics: true });
  assert.deepEqual(hits.map((h) => h.split(' names ')[1].split(':')[0]), ['public/laserkritis', 'public/cookie-consent.html']);
  assert.ok(hits.every((h) => h.startsWith('src/links.ts:1')));
});

test('cdn.gpteng.co references are reported, never edited or blocking', () => {
  const files = {
    'index.html': '<body></body>\n',
    'workers/site/test/fixtures/seo/shell.html': '<script src="https://cdn.gpteng.co/gptengineer.js"></script>\n',
    'docs/migration/PLAN.md': 'cdn.gpteng.co\n',
    'scripts/phase6/cleanup-edits.mjs': 'cdn.gpteng.co\n',
  };
  assert.deepEqual(gptengMentions(Object.keys(files), (f) => files[f]), ['workers/site/test/fixtures/seo/shell.html']);
  assert.deepEqual(scan(files, ALL_GROUPS), []);
  assert.ok(!ALL_EDITS.some((e) => e.file === 'index.html'), 'no edit touches index.html');
});

test('action lists: opt-in groups are off by default; every path is in one group only', () => {
  const groupsOf = (on) => [...new Set(actionsFor(on).map((a) => a.group))].sort().join('');
  assert.equal(groupsOf({}), 'AC');
  assert.equal(groupsOf({ statics: true, gsc: true, cron: true }), 'ACEHI');
  const srcs = PATH_ACTIONS.map((a) => a.src);
  assert.equal(new Set(srcs).size, srcs.length);
  assert.deepEqual(
    PATH_ACTIONS.filter((a) => a.group === 'H').map((a) => a.src),
    ['gsc-sitemap-sync', 'gsc-performance', 'gsc-index-url', 'gsc-inspect-url'].map((n) => `supabase/functions/${n}`),
  );
});

test('cleanup-edits.mjs refuses unknown commands and groups (exit 2)', (t) => {
  t.mock.method(console, 'error', () => {});
  assert.equal(main(['bogus']), 2);
  assert.equal(main(['plan']), 2);
  assert.equal(main(['plan', '--group', 'C']), 2);
  assert.equal(main(['actions', '--group', 'G']), 2);
});

// ----- the current checkout ------------------------------------------------------------------------------------------

test('every edit of every group matches the current checkout (TODO or DONE, never BLOCKED)', () => {
  for (const e of [...CONSUMER_EDITS, ...OTHER_EDITS, ...FORWARD_EDITS]) {
    const r = editState(e, (f) => readFileSync(join(REPO, f), 'utf8'), (f) => existsSync(join(REPO, f)));
    assert.notEqual(r.state, 'BLOCKED', `${e.id} ${e.file}: ${r.detail}`);
  }
});

test('the mention scan of the current checkout is clean for every group', () => {
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '-z', '-c', '-o', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0')
    .filter((f) => f && existsSync(join(REPO, f)));
  const hits = mentionScan(files, ALL_GROUPS, (f) => readFileSync(join(REPO, f), 'utf8'));
  assert.deepEqual(hits, []);
});

// ----- cleanup.sh end to end (local clone) ------------------------------------------------------------------------

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
}

/** A local clone whose last commit holds this checkout's working tree (tracked changes and untracked files). */
function cloneRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'p6-cleanup-'));
  execFileSync('git', ['clone', '-q', '--local', REPO, dir]);
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'cleanup test');
  const changed = git(REPO, 'ls-files', '-z', '-m', '-o', '--exclude-standard').split('\0').filter(Boolean);
  for (const f of new Set(changed)) {
    const src = join(REPO, f);
    const dst = join(dir, f);
    if (existsSync(src)) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    } else {
      rmSync(dst, { force: true });
    }
  }
  git(dir, 'add', '-A');
  spawnSync('git', ['-C', dir, 'commit', '-qm', 'test: working tree of the checkout']);
  git(dir, 'checkout', '-q', '-B', 'cleanup-test');
  return dir;
}

function run(dir, ...args) {
  const r = spawnSync('bash', ['scripts/phase6/cleanup.sh', ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const status = (dir) => git(dir, 'status', '--porcelain', '--untracked-files=no');

test('cleanup.sh: dry run, refusals, apply, idempotency, statics (on a local clone)', { timeout: 300_000 }, (t) => {
  const dir = cloneRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (!existsSync(join(dir, 'vercel.json'))) {
    assert.match(run(dir).out, /summary: 0 to do/);
    return; // already cleaned up
  }

  const dry = run(dir);
  assert.equal(dry.code, 0, dry.err + dry.out);
  assert.equal(status(dir), '', 'a dry run changes nothing');
  assert.match(dry.out, /TODO {5}git mv vercel\.json reference\/vercel\/vercel\.json/);
  assert.match(dry.out, /summary: \d+ to do, \d+ already done, 0 BLOCKED/);
  assert.match(dry.out, /- the Phase 3 gate was signed at least 30 days ago/);
  assert.match(dry.out, /NOTE {2}\S+ names cdn\.gpteng\.co \(reported, not edited\)/);

  assert.equal(run(dir, '--apply').code, 2, '--apply needs --decommissioned');
  assert.equal(run(dir, '--bogus').code, 2, 'unknown option');
  git(dir, 'checkout', '-q', '-B', 'main');
  assert.equal(run(dir).code, 2, 'refused on main');
  const onMain = run(dir, '--allow-main');
  assert.equal(onMain.code, 0, `--allow-main runs on main: ${onMain.err}${onMain.out}`);
  assert.match(onMain.out, /note {5}running on main \(--allow-main\)/);
  assert.match(onMain.out, /summary: \d+ to do, \d+ already done, 0 BLOCKED/);
  assert.equal(status(dir), '', 'a dry run on main changes nothing');
  git(dir, 'checkout', '-q', '-B', 'cleanup-test');
  appendFileSync(join(dir, 'package.json'), '\n');
  assert.equal(run(dir, '--apply', '--decommissioned').code, 2, 'refused with uncommitted changes');
  git(dir, 'checkout', '-q', '--', 'package.json');

  const applied = run(dir, '--apply', '--decommissioned');
  assert.equal(applied.code, 0, applied.err + applied.out);
  assert.ok(!existsSync(join(dir, 'vercel.json')) && existsSync(join(dir, 'reference/vercel/vercel.json')));
  assert.ok(!existsSync(join(dir, 'middleware.ts')) && existsSync(join(dir, 'reference/vercel/middleware.ts')));
  assert.ok(existsSync(join(dir, 'reference/vercel/README.md')) && existsSync(join(dir, 'reference/edge-functions/README.md')));
  assert.ok(existsSync(join(dir, 'reference/edge-functions/process-followups/index.ts')));
  assert.ok(!existsSync(join(dir, 'supabase/functions/process-warmup')));
  assert.ok(!existsSync(join(dir, '.github/workflows/xometry-scan.yml')));
  assert.ok(existsSync(join(dir, 'middleware/types.ts')), 'middleware/ is kept');
  assert.ok(existsSync(join(dir, 'api')), 'api/ is kept');
  assert.ok(existsSync(join(dir, 'public/cookie-consent.html')), 'statics stay without --with-statics');
  assert.ok(existsSync(join(dir, 'supabase/functions/tender-collector')), 'group I stays without its flag');
  assert.equal(git(dir, 'diff', '--cached', '--name-status', '-M', '--', 'vercel.json', 'reference/vercel/vercel.json').trim(), 'R100\tvercel.json\treference/vercel/vercel.json');
  const mw = readFileSync(join(dir, 'reference/vercel/middleware.ts'), 'utf8');
  assert.equal((mw.match(/from '\.\.\/\.\.\/middleware\//g) || []).length, 13);
  const site = readFileSync(join(dir, 'workers/site/wrangler.jsonc'), 'utf8');
  assert.equal(countOf(site, '"API_FORWARD_ORIGIN": ""'), 2);
  assert.ok(!site.includes('on-demand-craft-greece.vercel.app'));
  assert.ok(!readFileSync(join(dir, 'README.md'), 'utf8').includes('Deployed_on-Vercel'));
  assert.ok(!existsSync(join(dir, 'docs/migration/phase6/root-README.md')));

  const again = run(dir);
  assert.equal(again.code, 0, again.err + again.out);
  assert.match(again.out, /summary: 0 to do/);
  git(dir, 'commit', '-qm', 'cleanup');
  const third = run(dir, '--apply', '--decommissioned');
  assert.equal(third.code, 0);
  assert.match(third.out, /nothing to do/);
  assert.equal(status(dir), '');

  const statics = run(dir, '--apply', '--decommissioned', '--with-statics');
  assert.equal(statics.code, 0, statics.err + statics.out);
  assert.match(statics.out, /static-file log check done/);
  assert.ok(!existsSync(join(dir, 'public/cookie-consent.html')));
  assert.ok(!existsSync(join(dir, 'public/laserkritis/index.html')));
});

test('cleanup.sh: --keep-forward keeps the origin; the opt-in function groups remove their folders', { timeout: 300_000 }, (t) => {
  const dir = cloneRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (!existsSync(join(dir, 'vercel.json'))) return; // already cleaned up
  const before = readFileSync(join(dir, 'workers/site/wrangler.jsonc'), 'utf8');
  const local = 'workers/site/src/static.ts';
  appendFileSync(join(dir, local), '// local note\n'); // an uncommitted change that --allow-dirty lets through
  const r = run(dir, '--apply', '--decommissioned', '--allow-dirty', '--keep-forward', '--with-gsc-functions', '--with-cron-functions');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /note {5}uncommitted changes to tracked files present/);
  assert.equal(git(dir, 'diff', '--name-only').trim(), local, 'the uncommitted change stays unstaged and is the only one');
  assert.match(r.out, /skip {5}edits E16, E17 \(--keep-forward\)/);
  assert.match(r.out, /OW6-13 done/);
  assert.match(r.out, /OW6-17 done/);
  assert.match(r.out, /no caller after Phase 5/);
  assert.equal(readFileSync(join(dir, 'workers/site/wrangler.jsonc'), 'utf8'), before);
  for (const n of ['gsc-sitemap-sync', 'gsc-performance', 'gsc-index-url', 'gsc-inspect-url', 'process-article-queue', 'auto-update-sitemap', 'auto-translate-articles', 'tender-collector']) {
    assert.ok(!existsSync(join(dir, 'supabase/functions', n)), n);
  }
  git(dir, 'commit', '-qm', 'cleanup without the forward group');
  const later = run(dir);
  assert.equal(later.code, 0);
  assert.match(later.out, /TODO {5}edit E16 /);
  assert.match(later.out, /summary: 4 to do/);
});

test('cleanup.sh: a drifted consumer blocks the run before any change', { timeout: 300_000 }, (t) => {
  const dir = cloneRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (!existsSync(join(dir, 'vercel.json'))) return; // already cleaned up
  const smoke = join(dir, 'tests/middleware/smoke.mjs');
  writeFileSync(smoke, readFileSync(smoke, 'utf8').replace("path.join(ROOT, 'middleware.ts')", "path.resolve(ROOT, 'middleware.ts')"));
  git(dir, 'commit', '-qam', 'drift');
  const r = run(dir, '--apply', '--decommissioned');
  assert.equal(r.code, 1);
  assert.match(r.out, /BLOCKED {2}edit E10/);
  assert.equal(status(dir), '');
  assert.ok(existsSync(join(dir, 'vercel.json')));
});

test('cleanup.sh: a new mention of a deleted path blocks the run and is listed', { timeout: 300_000 }, (t) => {
  const dir = cloneRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (!existsSync(join(dir, 'vercel.json'))) return; // already cleaned up
  appendFileSync(join(dir, 'workers/site/src/static.ts'), '// see scripts/dev-server.js\n');
  git(dir, 'commit', '-qam', 'new mention');
  const dry = run(dir);
  assert.equal(dry.code, 1, 'a dry run with a BLOCKED action exits 1');
  assert.match(dry.out, /summary: \d+ to do, \d+ already done, 1 BLOCKED/);
  assert.match(dry.err, /BLOCKED actions found: nothing was changed\./);
  assert.equal(status(dir), '');
  const r = run(dir, '--apply', '--decommissioned');
  assert.equal(r.code, 1);
  assert.match(r.out, /BLOCKED {2}workers\/site\/src\/static\.ts:\d+ names scripts\/dev-server\.js: \/\/ see scripts\/dev-server\.js/);
  assert.equal(status(dir), '');
  assert.ok(existsSync(join(dir, 'scripts/dev-server.js')));
});
