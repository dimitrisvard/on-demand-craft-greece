// Tests for the Phase 5 switch-over files (contract: docs/migration/specs/PHASE5_SPEC.md §6.8, §10.2):
//   supabase/migrations/*_deactivate_ported_crons.sql   (P5-8, per step; no-op without both session settings)
//   supabase/migrations/*_unschedule_ported_crons.sql   (P5-9, after the signed gate; inactive ported jobs only)
// against a pg_cron 1.6 stand-in (mock_cron.sql) on PGlite.
//   node cron-switch.test.mjs                    both engines: PGlite 0.5.8 (Postgres 18) and 0.2.17 (Postgres 16)
//   node cron-switch.test.mjs --engine=pglite    one engine (pglite | pglite16)
// Exit code 0 = every assertion passed on every engine; 1 = failures, or a missing / ambiguous SQL file.
// Token-shaped values in the seeded job commands are assembled at runtime, so this file holds no such literal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function onlyFile(dir, suffix) {
  const abs = path.resolve(HERE, dir);
  const hits = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith(suffix)).sort() : [];
  if (hits.length !== 1) {
    console.error(`expected exactly one ${path.relative(HERE, abs)}/*${suffix}, found ${hits.length}${hits.length ? ': ' + hits.join(', ') : ''}`);
    process.exit(1);
  }
  return path.join(abs, hits[0]);
}

const DEACTIVATE_FILE = onlyFile('../../migrations', '_deactivate_ported_crons.sql');
const UNSCHEDULE_FILE = onlyFile('../../migrations', '_unschedule_ported_crons.sql');
const DEACTIVATE = fs.readFileSync(DEACTIVATE_FILE, 'utf8');
const UNSCHEDULE = fs.readFileSync(UNSCHEDULE_FILE, 'utf8');
const MOCK = fs.readFileSync(path.join(HERE, 'mock_cron.sql'), 'utf8');

const ENGINES = ['pglite', 'pglite16'];
const arg = process.argv.find((a) => a.startsWith('--engine='))?.slice('--engine='.length) || process.env.ENGINE || 'all';
const selected = arg === 'all' ? ENGINES : [arg];
if (!selected.every((e) => ENGINES.includes(e))) {
  console.error(`unknown engine ${arg}; use one of ${ENGINES.join(', ')} or all`);
  process.exit(1);
}

// ---- runtime-built token shapes (never a literal in this file) ------------------------
const b64u = (s) => Buffer.from(s).toString('base64url');
const TOKEN_HEAD = 'e' + 'y' + 'J';
const EXAMPLE_TOKEN = TOKEN_HEAD + b64u('{"alg":"HS256","typ":"JWT"}').slice(3) + '.' + b64u('{"role":"example","ref":"example-ref"}') + '.' + b64u('signature-not-real-0123456789');
const HOST = 'https://example-ref.supabase.co';

// The ten ported jobs with the ids, names and schedules of the live cron.job (PHASE5_SPEC F5-1). HTTP jobs call
// /functions/v1/<target>; job 17 calls the SQL function. The token value is synthetic and assembled at runtime.
function http(target, body = '{}') {
  return `SELECT net.http_post(url := '${HOST}/functions/v1/${target}', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ${EXAMPLE_TOKEN}'), body := '${body}'::jsonb) AS request_id;`;
}
const PORTED = [
  [15, 'process-article-queue', '*/5 * * * *', http('process-article-queue')],
  [17, 'enqueue-daily-article', '0 7 * * *', 'SELECT enqueue_next_article() AS queue_id;'],
  [19, 'auto-update-sitemap', '0 9 * * *', http('auto-update-sitemap')],
  [21, 'auto-fix-article-links', '30 8 * * *', http('fix-article-links', '{"fix_all": true}')],
  [22, 'auto-translate-daily-articles', '0 8 * * *', http('auto-translate-articles')],
  [23, 'reddit-tier1', '*/15 * * * *', http('reddit-collector?tier=1')],
  [24, 'reddit-tier2', '*/30 * * * *', http('reddit-collector?tier=2')],
  [25, 'hn-collector', '*/30 * * * *', http('hn-collector')],
  [28, 'tender-scan-daily', '0 6 * * *', http('tender-collector')],
  [29, 'reddit-tier3', '0 * * * *', http('reddit-collector?tier=3')],
];
// Jobs the files must never touch: one active, one inactive, one whose name looks like a ported job's.
const OTHERS = [
  [40, 'agent-retention', '0 3 * * *', 'SELECT 1;', true],
  [41, 'old-disabled-job', '0 4 * * *', 'SELECT 2;', false],
  [42, 'hn-collector-backfill', '0 5 * * *', http('hn-collector'), false],
];
const STEP_JOBS = {
  S1: [25],
  S2: [23, 24, 29],
  S3: [28],
  S4: [19],
  S5: [15, 17, 21, 22],
};
const ALL_PORTED = PORTED.map((j) => j[0]);
const OTHER_IDS = OTHERS.map((j) => j[0]);

// ---- engine -------------------------------------------------------------------------------
async function openDb(engine) {
  const { PGlite } = await import(engine === 'pglite16' ? 'pglite-pg16' : '@electric-sql/pglite');
  const db = new PGlite();
  await db.waitReady;
  const version = (await db.query('show server_version')).rows[0].server_version;
  return {
    name: `${engine} (Postgres ${version})`,
    async q(sql, params = []) { return (await db.query(sql, params)).rows; },
    /** Runs a script as the SQL editor does (one session, simple protocol); returns results and notices. */
    async run(sql) {
      const notices = [];
      const results = await db.exec(sql, { onNotice: (n) => notices.push({ severity: n.severity, message: n.message }) });
      return { results, notices };
    },
    async close() { await db.close(); },
  };
}

// ---- assertion kit --------------------------------------------------------------------------
let passed = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) passed++;
  else failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
function eq(actual, expected, name) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), name, { actual, expected });
}

// ---- helpers --------------------------------------------------------------------------------
async function seed(db) {
  await db.run('TRUNCATE cron.job, cron._calls, cron.job_run_details RESTART IDENTITY;');
  for (const [id, name, schedule, command] of PORTED) {
    await db.q('INSERT INTO cron.job (jobid, jobname, schedule, command, active) VALUES ($1, $2, $3, $4, true)', [id, name, schedule, command]);
  }
  for (const [id, name, schedule, command, active] of OTHERS) {
    await db.q('INSERT INTO cron.job (jobid, jobname, schedule, command, active) VALUES ($1, $2, $3, $4, $5)', [id, name, schedule, command, active]);
  }
}
async function activeMap(db) {
  const rows = await db.q('SELECT jobid::int AS id, active FROM cron.job ORDER BY jobid');
  return Object.fromEntries(rows.map((r) => [r.id, r.active]));
}
async function jobIds(db) {
  return (await db.q('SELECT jobid::int AS id FROM cron.job ORDER BY jobid')).map((r) => r.id);
}
async function calls(db) {
  return db.q('SELECT fn, args FROM cron._calls ORDER BY n');
}
async function settings(db) {
  const r = await db.q(`SELECT coalesce(current_setting('microns.p5_step', true), '') AS step,
                               coalesce(current_setting('microns.p5_action', true), '') AS action,
                               coalesce(current_setting('microns.p5_gate', true), '') AS gate`);
  return r[0];
}
function expectedActive(inactiveIds) {
  const m = {};
  for (const id of ALL_PORTED) m[id] = !inactiveIds.includes(id);
  for (const [id, , , , active] of OTHERS) m[id] = active;
  return Object.fromEntries(Object.entries(m).sort((a, b) => Number(a[0]) - Number(b[0])));
}
function noSecretInNotices(notices, name) {
  const text = notices.map((n) => n.message).join('\n');
  ok(!text.includes(EXAMPLE_TOKEN) && !text.includes(TOKEN_HEAD) && !text.includes('net.http_post') && !text.includes('Bearer'), name + ': notices never print a command or token');
}
function lastRows(results) {
  return results[results.length - 1]?.rows ?? [];
}

// ---- static checks on the files -------------------------------------------------------------
function staticChecks() {
  // the literal patterns of the repository scan, assembled at runtime
  const patterns = [
    new RegExp('e' + 'yJ'),
    new RegExp('wh' + 'sec_[A-Za-z0-9]'),
    new RegExp('\\bre_[A-Za-z0-9_]{24,}'),
    new RegExp('AI' + 'za[0-9A-Za-z_-]{20,}'),
    new RegExp('sk' + '-ant-'),
    new RegExp('[0-9]{8,10}:AA[0-9A-Za-z_-]{30,}'),
    new RegExp('-----BEG' + 'IN'),
  ];
  ok(patterns[0].test(EXAMPLE_TOKEN), 'scan self-test: the runtime token matches the token pattern');
  for (const [label, text] of [['deactivate', DEACTIVATE], ['unschedule', UNSCHEDULE], ['test', fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')], ['mock', MOCK]]) {
    ok(patterns.every((p) => !p.test(text)), `${label} file holds no credential-shaped literal`);
  }
  // both files address the jobs by name and never print the command column
  for (const [label, text] of [['deactivate', DEACTIVATE], ['unschedule', UNSCHEDULE]]) {
    const raises = text.split('\n').filter((l) => /RAISE (NOTICE|WARNING)/.test(l)).join('\n');
    ok(raises.length > 0 && !/command/.test(raises), `${label}: no RAISE line prints the command`);
    ok(!/\bjobid\s*=\s*\d/.test(text), `${label}: no job addressed by a numeric id`);
  }
  ok(/SET microns\.p5_step/.test(DEACTIVATE) && /SET microns\.p5_action/.test(DEACTIVATE), 'deactivate documents both settings');
  ok(/RESET microns\.p5_step;\s*\nRESET microns\.p5_action;/.test(DEACTIVATE), 'deactivate resets both settings');
  ok(/RESET microns\.p5_gate;/.test(UNSCHEDULE), 'unschedule resets the gate setting');
  ok(!/cron\.unschedule\(\s*r\.jobid/.test(UNSCHEDULE), 'unschedule removes by job name');
}

// ---- scenario ---------------------------------------------------------------------------------
async function scenario(db) {
  const tag = (s) => `[${db.name}] ${s}`;
  await db.run(MOCK);

  // 1. no settings -> nothing changes
  await seed(db);
  {
    const { notices } = await db.run(DEACTIVATE);
    eq(await activeMap(db), expectedActive([]), tag('no settings: every job keeps its state'));
    eq(await calls(db), [], tag('no settings: no pg_cron call'));
    ok(notices.some((n) => /not set; nothing changed/.test(n.message)), tag('no settings: notice says nothing changed'), notices);
    eq(await settings(db), { step: '', action: '', gate: '' }, tag('no settings: no setting left behind'));
  }

  // 2. one step: S1
  await seed(db);
  {
    const { results, notices } = await db.run("SET microns.p5_step = 'S1'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    eq(await activeMap(db), expectedActive(STEP_JOBS.S1), tag('S1: only hn-collector is deactivated'));
    eq((await calls(db)).map((c) => [c.fn, c.args.job_id, c.args.active]), [['alter_job', 25, false]], tag('S1: one alter_job(25, active := false)'));
    const checkRows = lastRows(results);
    eq(checkRows.map((r) => Number(r.jobid)), ALL_PORTED.slice().sort((a, b) => a - b), tag('S1: the check query lists the ten ported jobs'));
    ok(checkRows.every((r) => !('command' in r)), tag('S1: the check query has no command column'));
    ok(notices.some((n) => /P5-8 S1: deactivated hn-collector \(id 25\)/.test(n.message)), tag('S1: notice names the job'), notices);
    ok(notices.some((n) => /P5-8: 1 job\(s\) changed/.test(n.message)), tag('S1: summary counts one change'), notices);
    noSecretInNotices(notices, tag('S1'));
    eq(await settings(db), { step: '', action: '', gate: '' }, tag('S1: the file resets its settings'));

    // 5. re-run after RESET is a no-op (a job changed by hand in between stays as it is)
    await db.q('UPDATE cron.job SET active = true WHERE jobid = 25');
    await db.q('TRUNCATE cron._calls');
    const rerun = await db.run(DEACTIVATE);
    eq(await activeMap(db), expectedActive([]), tag('re-run after RESET: no change'));
    eq(await calls(db), [], tag('re-run after RESET: no pg_cron call'));
    ok(rerun.notices.some((n) => /not set; nothing changed/.test(n.message)), tag('re-run after RESET: notice says nothing changed'));
  }

  // 3. a comma list with a space: 'S2, S5'
  await seed(db);
  {
    const { notices } = await db.run("SET microns.p5_step = 'S2, S5'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    eq(await activeMap(db), expectedActive([...STEP_JOBS.S2, ...STEP_JOBS.S5]), tag("'S2, S5': reddit tiers and the content jobs are deactivated"));
    eq((await calls(db)).length, 7, tag("'S2, S5': seven alter_job calls"));
    ok(notices.some((n) => /P5-8: 7 job\(s\) changed \(action deactivate, steps S2, S5\)/.test(n.message)), tag("'S2, S5': summary"), notices);
    noSecretInNotices(notices, tag("'S2, S5'"));

    // the same step again: already inactive, no call
    await db.q('TRUNCATE cron._calls');
    const again = await db.run("SET microns.p5_step = 'S2'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    eq(await calls(db), [], tag('S2 twice: no second call'));
    ok(again.notices.filter((n) => /already inactive/.test(n.message)).length === 3, tag('S2 twice: three "already inactive" notices'), again.notices);
  }

  // 4. reactivate (rollback of a step); an active job is left alone
  await seed(db);
  {
    await db.run("SET microns.p5_step = 'S1,S3'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    eq(await activeMap(db), expectedActive([25, 28]), tag("'S1,S3': both deactivated"));
    await db.q('TRUNCATE cron._calls');
    const { notices } = await db.run("SET microns.p5_step = 'S1'; SET microns.p5_action = 'reactivate';\n" + DEACTIVATE);
    eq(await activeMap(db), expectedActive([28]), tag('S1 reactivate: hn-collector active again, S3 untouched'));
    eq((await calls(db)).map((c) => [c.args.job_id, c.args.active]), [[25, true]], tag('S1 reactivate: one alter_job(25, active := true)'));
    ok(notices.some((n) => /P5-8 S1: reactivated hn-collector \(id 25\)/.test(n.message)), tag('S1 reactivate: notice'), notices);
    await db.q('TRUNCATE cron._calls');
    const again = await db.run("SET microns.p5_step = 'S1'; SET microns.p5_action = 'reactivate';\n" + DEACTIVATE);
    eq(await calls(db), [], tag('reactivate an active job: no call'));
    ok(again.notices.some((n) => /already active/.test(n.message)), tag('reactivate an active job: "already active"'));
  }

  // 6. a job whose command no longer contains its target is skipped (and stays active)
  await seed(db);
  {
    await db.q('UPDATE cron.job SET command = $1 WHERE jobid = 25', [http('leads-api')]);
    await db.q('UPDATE cron.job SET command = $1 WHERE jobid = 23', [http('reddit-collector?tier=2')]);
    const { notices } = await db.run("SET microns.p5_step = 'S1,S2'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    eq(await activeMap(db), expectedActive([24, 29]), tag('changed target: hn-collector and reddit-tier1 skipped, the others deactivated'));
    ok(notices.some((n) => n.severity === 'WARNING' && /hn-collector \(id 25\) no longer targets \/functions\/v1\/hn-collector/.test(n.message)), tag('changed target: warning for hn-collector'), notices);
    ok(notices.some((n) => n.severity === 'WARNING' && /reddit-tier1 \(id 23\) no longer targets/.test(n.message)), tag('changed target: warning for reddit-tier1'), notices);
    noSecretInNotices(notices, tag('changed target'));
  }

  // a missing job is reported and skipped; an unknown action or step changes nothing
  await seed(db);
  {
    await db.q('DELETE FROM cron.job WHERE jobid = 28');
    const { notices } = await db.run("SET microns.p5_step = 'S3,S4'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    ok(notices.some((n) => n.severity === 'WARNING' && /P5-8 S3: job tender-scan-daily not found; skipped/.test(n.message)), tag('missing job: warning'), notices);
    const m = await activeMap(db);
    ok(m[19] === false && !(28 in m) && m[25] === true, tag('missing job: S4 still applied'), m);

    await seed(db);
    const bad = await db.run("SET microns.p5_step = 'S1'; SET microns.p5_action = 'disable';\n" + DEACTIVATE);
    eq(await activeMap(db), expectedActive([]), tag('unknown action: no change'));
    ok(bad.notices.some((n) => /nothing changed/.test(n.message)), tag('unknown action: notice'));
    eq(await settings(db), { step: '', action: '', gate: '' }, tag('unknown action: settings reset'));

    const unknownStep = await db.run("SET microns.p5_step = 'S9'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    eq(await activeMap(db), expectedActive([]), tag('unknown step: no change'));
    ok(unknownStep.notices.some((n) => /P5-8: 0 job\(s\) changed/.test(n.message)), tag('unknown step: zero changes'));
  }

  // 7. unschedule without the gate (or with another value) -> no change
  await seed(db);
  {
    await db.run("SET microns.p5_step = 'S1,S2,S3,S4,S5'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    await db.q('TRUNCATE cron._calls');
    const none = await db.run(UNSCHEDULE);
    eq(await jobIds(db), [...ALL_PORTED, ...OTHER_IDS].sort((a, b) => a - b), tag('unschedule without the gate: every job kept'));
    eq(await calls(db), [], tag('unschedule without the gate: no pg_cron call'));
    ok(none.notices.some((n) => /microns\.p5_gate is not 'signed'; nothing changed/.test(n.message)), tag('unschedule without the gate: notice'), none.notices);
    const jwtBefore = Number(lastRows(none.results)[0]?.jobs_with_jwt_literal);
    eq(jwtBefore, 10, tag('unschedule without the gate: the check query still counts the token-bearing jobs (9 ported + 1 other)'));

    await db.run("SET microns.p5_gate = 'yes';\n" + UNSCHEDULE);
    eq((await jobIds(db)).length, ALL_PORTED.length + OTHER_IDS.length, tag("unschedule with gate 'yes': every job kept"));
    eq(await settings(db), { step: '', action: '', gate: '' }, tag('unschedule: the file resets the gate'));
  }

  // 8. with the gate: only inactive ported jobs are removed; active ported jobs and every other job stay
  await seed(db);
  {
    await db.run("SET microns.p5_step = 'S1,S2,S3,S4'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    await db.q('TRUNCATE cron._calls');
    const { results, notices } = await db.run("SET microns.p5_gate = 'signed';\n" + UNSCHEDULE);
    const removed = [...STEP_JOBS.S1, ...STEP_JOBS.S2, ...STEP_JOBS.S3, ...STEP_JOBS.S4];
    eq(await jobIds(db), [...ALL_PORTED.filter((id) => !removed.includes(id)), ...OTHER_IDS].sort((a, b) => a - b), tag('signed: the six inactive ported jobs removed; S5 jobs (active) and other jobs kept'));
    const c = await calls(db);
    ok(c.length === 6 && c.every((x) => x.fn === 'unschedule(text)'), tag('signed: six cron.unschedule(job_name text) calls'), c);
    eq(notices.filter((n) => n.severity === 'WARNING' && /is still active; not removed/.test(n.message)).length, 4, tag('signed: a warning per still-active ported job'));
    ok(notices.some((n) => /P5-9: 6 job\(s\) removed/.test(n.message)), tag('signed: summary'), notices);
    noSecretInNotices(notices, tag('signed'));
    eq(await settings(db), { step: '', action: '', gate: '' }, tag('signed: the gate is reset'));
    const m = await activeMap(db);
    ok(m[40] === true && m[41] === false && m[42] === false, tag('signed: other jobs keep their state, including an inactive one and a look-alike name'), m);
    eq(Number(lastRows(results)[0]?.jobs_with_jwt_literal), 4, tag('signed: the token check counts what is left (3 active S5 HTTP jobs + 1 other)'));

    // the remaining step after S5 is deactivated: every ported job gone, the token count drops to the other job
    await db.run("SET microns.p5_step = 'S5'; SET microns.p5_action = 'deactivate';\n" + DEACTIVATE);
    const final = await db.run("SET microns.p5_gate = 'signed';\n" + UNSCHEDULE);
    eq(await jobIds(db), OTHER_IDS, tag('signed after S5: no ported job left'));
    eq(Number(lastRows(final.results)[0]?.jobs_with_jwt_literal), 1, tag('signed after S5: only the non-ported token job is counted'));
    const listing = final.results[final.results.length - 2]?.rows ?? [];
    eq(listing.map((r) => Number(r.jobid)), OTHER_IDS, tag('signed after S5: the listing query shows the remaining jobs'));
  }
}

// ---- main -----------------------------------------------------------------------------------
staticChecks();
for (const engine of selected) {
  const db = await openDb(engine);
  try {
    await scenario(db);
    console.log(`ran ${db.name}`);
  } catch (e) {
    failures.push(`[${engine}] scenario threw: ${e && e.message}`);
  } finally {
    await db.close();
  }
}
console.log(`files: ${path.relative(path.resolve(HERE, '../..'), DEACTIVATE_FILE)}, ${path.relative(path.resolve(HERE, '../..'), UNSCHEDULE_FILE)}`);
if (failures.length) {
  console.error(`${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log(`all ${passed} assertions passed`);
