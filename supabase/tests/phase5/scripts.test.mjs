// Tests for the owner's read-only and template SQL of Phase 5 (PHASE5_SPEC.md §6.8, §10.2, §10.3):
//   scripts/phase5/parity.sql      the blocks the spec gives verbatim equal its text (normalised SHA-256 pins); every
//                                  statement runs on the Phase 4 schema plus stand-ins of the live tables; Q12b
//                                  equals the hand-computed digest figures of vectors/digest.json (the same vectors
//                                  the Worker's digest code is tested with), Q8 limits per agent, Q11 with
//                                  'not_configured', Q13 slots
//   scripts/phase5/flag-values.sql every template UPDATE applies to the migration's feature_flags rows and the mode
//                                  check, each step leaves the value its runbook step needs (shadow days S4 (a) and
//                                  S8 (a) stay shadow), and the digest template never returns the recipient
// Schema: supabase/tests/agent_layer/live_min.sql + supabase/migrations/*_agent_layer.sql + mock_cron.sql +
// parity_schema.sql, on PGlite 0.5.8 (Postgres 18) and 0.2.17 (Postgres 16). "now()" in parity.sql is replaced by a
// fixed instant so every figure is deterministic.
//   node scripts.test.mjs [--engine=pglite|pglite16]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

function onlyFile(dir, suffix) {
  const abs = path.resolve(ROOT, dir);
  const hits = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith(suffix)).sort() : [];
  if (hits.length !== 1) {
    console.error(`expected exactly one ${dir}/*${suffix}, found ${hits.length}`);
    process.exit(1);
  }
  return path.join(abs, hits[0]);
}

const LIVE = fs.readFileSync(path.join(ROOT, 'supabase/tests/agent_layer/live_min.sql'), 'utf8');
const AGENT_LAYER = fs.readFileSync(onlyFile('supabase/migrations', '_agent_layer.sql'), 'utf8');
const MOCK_CRON = fs.readFileSync(path.join(HERE, 'mock_cron.sql'), 'utf8');
const STANDINS = fs.readFileSync(path.join(HERE, 'parity_schema.sql'), 'utf8');
const PARITY = fs.readFileSync(path.join(ROOT, 'scripts/phase5/parity.sql'), 'utf8');
const FLAG_VALUES = fs.readFileSync(path.join(ROOT, 'scripts/phase5/flag-values.sql'), 'utf8');
const CONTENT_FLAG_SOURCE = fs.readFileSync(path.join(ROOT, 'workers/ops/src/content/flag.ts'), 'utf8');
const SITEMAP_WORKFLOW_SOURCE = fs.readFileSync(path.join(ROOT, 'workers/ops/src/workflows/sitemap.ts'), 'utf8');
const VECTORS = JSON.parse(fs.readFileSync(path.join(HERE, 'vectors/digest.json'), 'utf8'));

const ENGINES = ['pglite', 'pglite16'];
const arg = process.argv.find((a) => a.startsWith('--engine='))?.slice('--engine='.length) || process.env.ENGINE || 'all';
const selected = arg === 'all' ? ENGINES : [arg];
if (!selected.every((e) => ENGINES.includes(e))) {
  console.error(`unknown engine ${arg}`);
  process.exit(1);
}

const NOW = "'2026-10-12 06:30:00+00'::timestamptz";
const S_SWITCH = '2026-10-05 00:00+00';
const S8_SWITCH = '2026-10-11 07:30+00';

let passed = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) passed++;
  else failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
/** JSON with object keys sorted (jsonb orders keys by length, so key order is not compared). */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
function eq(actual, expected, name) {
  ok(JSON.stringify(canon(actual)) === JSON.stringify(canon(expected)), name, { actual, expected });
}
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const text = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : String(v)]));

/** A block's SQL text with comments removed and whitespace collapsed (placeholders kept). */
export function normalisedBlocks(text) {
  const out = {};
  for (const block of text.split(/^(?=-- Q\d+[a-z]?\b)/m).filter((b) => /^-- Q\d/.test(b))) {
    out[/^-- (Q\d+[a-z]?)\b/.exec(block)[1]] = block.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  }
  return out;
}

// SHA-256 of the normalised text of each parity block that the spec gives verbatim (PHASE5_SPEC.md §6.8: jobs.md §10
// Q1-Q10 and Q12 unchanged, Q8 and Q13 as written in §6.8). The pass rules live in this text (source names, time
// windows, job lists, limits per agent), so a change to any of these blocks must come with a spec change and a new
// pin. Q11 (text compare of output.indexnow) and Q12b (the digest figures) are checked by value below instead.
const SPEC_BLOCK_SHA256 = {
  Q1: '1fba871572efa2ee5396ca3abbeb905aceb92c949de66043f756534e5af7a111',
  Q2: 'ac9e1651ed254aea905cb840ebaaa375dffc86239d074c0993f4cbf9bcdc6546',
  Q2b: '6350f7caee606dff7e406c0b78e02a29328fd9c7b79cd955415bf4d2f42f3639',
  Q3: 'ca71c8e08e9dd44d63ef374f415f50701fc733c915fcf1714f26fb79c11cd1bf',
  Q4: '79be36d39e4637e1d89446826a5bdc2c51efbce101ee7bc9c26523cd868f273a',
  Q5: '8be8f8c8356ab291705b0e35b7bc5404c23acbc15e956a8832f0e249d758fc39',
  Q6: '771839efae85ee48fd534eaffddf0e9c247731e8f95f70b6429aac2dd2f25513',
  Q8: 'df35fe95f1e307521c71d86e8e3a6468aaa7ab4a0dd2fa567d50b17662bb9e46',
  Q9: 'fb3c67cf3897780def99509683d6b4f3bd8b7688a59051168df8a4bada8efa72',
  Q10: '3534ad4efd53435dff7a051f88667851802b283faac43684e4852c0295094c62',
  Q12: '5348dc983d1cab9b4df03efa9993b468a91d9f1f69dd5127942ab40a190f8e3e',
  Q13: 'eab875798d75b146789c9347a2a024578e66202a243a2408f6ed06e5a7b27465',
};

/** parity.sql as labelled statements: {label: 'Q12b', sql} with comments removed and placeholders filled in. */
export function parityStatements(text, o = {}) {
  const blocks = text.split(/^(?=-- Q\d+[a-z]?\b)/m).slice(1);
  const out = [];
  for (const block of blocks) {
    const label = /^-- (Q\d+[a-z]?)\b/.exec(block)[1];
    const sql = block
      .replace(/--[^\n]*/g, '')
      .replaceAll('<S_SWITCH_UTC>', o.s ?? S_SWITCH)
      .replaceAll('<S8_SWITCH_UTC>', o.s8 ?? S8_SWITCH)
      .replace(/\bnow\(\)/g, o.now ?? NOW);
    const parts = sql.split(';').map((s) => s.trim()).filter(Boolean);
    parts.forEach((p, i) => out.push({ label: parts.length > 1 ? `${label}.${i + 1}` : label, sql: p }));
  }
  return out;
}

async function openDb(engine) {
  const { PGlite } = await import(engine === 'pglite16' ? 'pglite-pg16' : '@electric-sql/pglite');
  const db = new PGlite();
  await db.waitReady;
  const version = (await db.query('show server_version')).rows[0].server_version;
  return { db, name: `${engine} (Postgres ${version})` };
}

async function insertRows(db, table, rows) {
  for (const row of rows) {
    const cols = Object.keys(row);
    const values = cols.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]));
    await db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, values);
  }
}

const key = (r) => `${r.section}\u0000${r.figure}`;
const sortRows = (rows) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

async function scenario(engine) {
  const { db, name } = await openDb(engine);
  const tag = (s) => `[${name}] ${s}`;
  try {
    await db.exec(LIVE);
    await db.exec(AGENT_LAYER);
    await db.exec(MOCK_CRON);
    await db.exec(STANDINS);
    await db.exec("SET TimeZone = 'UTC';");
    // seed the shared vectors (insertion order respects the foreign keys)
    for (const table of ['rfqs', 'quote_workflows', 'orders', 'agent_runs', 'cad_jobs', 'articles', 'article_titles', 'leads', 'tenders', 'marketing_events']) {
      await insertRows(db, table, VECTORS.seed[table]);
    }
    await insertRows(db, 'storage.objects', [{ bucket_id: 'sitemaps', name: 'sitemap-complete.xml', metadata: { size: 6303090 }, updated_at: '2026-10-11T09:00:04Z' }]);

    const statements = parityStatements(PARITY);
    eq(statements.map((s) => s.label), ['Q1', 'Q2', 'Q2b', 'Q3', 'Q4', 'Q5.1', 'Q5.2', 'Q6', 'Q8', 'Q9', 'Q10', 'Q11', 'Q12', 'Q12b', 'Q13'], tag('parity.sql holds Q1-Q13 (Q8 per agent, Q12b, Q13)'));
    ok(statements.every((s) => /^(WITH|SELECT)\b/i.test(s.sql)), tag('every parity statement is a read (WITH / SELECT)'));
    const results = {};
    for (const s of statements) {
      try {
        results[s.label] = (await db.query(s.sql)).rows;
        passed++;
      } catch (e) {
        failures.push(tag(`${s.label} failed: ${e.message}`));
      }
    }

    // Q12 and Q12b: the digest figures of the vectors
    eq(results.Q12?.map(text), [{ rfqs: '3', en_articles: '2', leads: '4', tenders: '3', agent_cost_usd: '0.21' }], tag('Q12 spot check'));
    eq(sortRows(results.Q12b ?? []), sortRows(VECTORS.expected_figures), tag('Q12b equals the hand-computed digest figures (vectors/digest.json)'));

    // Q4: expected URLs = published rows + 252; storage freshness read
    const q4 = results.Q4?.[0] ?? {};
    eq([Number(q4.expected_sitemap_urls), Number(q4.sitemap_bytes)], [9 + 252, 6303090], tag('Q4 expected URL count and object size'));

    // Q8: limits per agent (rows running 9 h / 2 h are stuck; 7 h content_daily and 30 h marketing.send are not)
    const at = (h) => new Date(Date.parse('2026-10-12T06:30:00Z') - h * 3_600_000).toISOString();
    const run = (n, agent, status, started, output = null, trigger = 'cron', idem = `${agent}:extra-${n}`) => ({
      agent, trigger, idempotency_key: idem, status, started_at: started, finished_at: ['running', 'waiting_human'].includes(status) ? null : started, output,
    });
    await insertRows(db, 'agent_runs', [
      run(1, 'content_daily', 'running', at(9)),
      run(2, 'content_daily', 'running', at(7)),
      run(3, 'growth.hn', 'running', at(2)),
      run(4, 'marketing.send', 'running', at(30)),
      run(5, 'content_daily.translate', 'succeeded', '2026-10-11T08:00:00Z', { indexnow: true }, 'queue'),
      run(6, 'content_daily.translate', 'succeeded', '2026-10-11T08:01:00Z', { indexnow: 'not_configured' }, 'queue'),
      run(7, 'content_daily.translate', 'succeeded', '2026-10-11T08:02:00Z', { indexnow: false }, 'queue'),
      run(8, 'growth.xometry', 'succeeded', '2026-10-11T08:00:05Z', { auth: 'ok', scanned: 12 }, 'cron', 'growth.xometry:2026-10-11T08:00Z'),
      run(9, 'growth.xometry', 'skipped', '2026-10-11T10:00:05Z', { auth: 'rejected' }, 'cron', 'growth.xometry:2026-10-11T10:00Z'),
    ]);
    const q = async (label) => (await db.query(statements.find((s) => s.label === label).sql)).rows;
    const q8 = await q('Q8');
    const stuckOf = (agent, d) => Number(q8.find((r) => r.agent === agent && day(r.day) === d)?.stuck ?? -1);
    const cd = q8.find((r) => r.agent === 'content_daily' && day(r.day) === '2026-10-11');
    eq(cd && [Number(cd.runs), Number(cd.stuck)], [2, 1], tag('Q8: of two content_daily rows running 9 h and 7 h only the first is stuck (8 h limit)'));
    eq(stuckOf('growth.hn', '2026-10-12'), 1, tag('Q8: growth.hn running 2 h is stuck (1 h limit)'));
    eq(stuckOf('marketing.send', '2026-10-11'), 0, tag('Q8: marketing.send running 30 h is not stuck (48 h limit)'));
    ok(!q8.some((r) => r.agent === 'quote' || r.agent === 'rfq_intake'), tag('Q8 lists only the Phase 5 agents of its limit table'));

    const q11 = await q('Q11');
    const q11day = q11.find((r) => day(r.day) === '2026-10-11');
    eq(q11day && [Number(q11day.indexnow_ok), Number(q11day.indexnow_not_configured), Number(q11day.translations)], [1, 1, 3], tag("Q11 counts true, 'not_configured' and all succeeded translations"));
    let castFailed = false;
    try {
      await db.query(`SELECT count(*) FILTER (WHERE (output->>'indexnow')::boolean) FROM agent_runs WHERE agent = 'content_daily.translate' AND status = 'succeeded'`);
    } catch {
      castFailed = true;
    }
    ok(castFailed, tag("Q11: the analysis form (boolean cast) fails on 'not_configured', which is why the text compare is used"));

    const q13 = await q('Q13');
    eq(q13.map((r) => [new Date(r.slot).toISOString().slice(0, 16), r.status, r.auth, r.scanned === null ? null : Number(r.scanned)]), [
      ['2026-10-11T08:00', 'succeeded', 'ok', 12],
      ['2026-10-11T10:00', 'skipped', 'rejected', null],
      ['2026-10-11T12:00', null, null, null],
      ['2026-10-11T14:00', null, null, null],
      ['2026-10-11T16:00', null, null, null],
      ['2026-10-11T18:00', null, null, null],
      ['2026-10-12T06:00', null, null, null],
    ], tag('Q13: slots after the switch (not 06:00 of the switch day), the current slot after 5 min, runs joined by key'));
    const early = parityStatements(PARITY, { now: "'2026-10-12 06:03:00+00'::timestamptz" }).find((s) => s.label === 'Q13');
    const q13early = (await db.query(early.sql)).rows;
    eq(new Date(q13early[q13early.length - 1].slot).toISOString().slice(0, 16), '2026-10-11T18:00', tag('Q13: three minutes after 06:00 the 06:00 slot is not listed yet'));

    // flag-values.sql: every template applies; final values; the digest template hides the recipient
    const updates = FLAG_VALUES.split('\n').filter((l) => !l.startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
    const returned = [];
    for (const u of updates) {
      try {
        returned.push((await db.query(u)).rows);
        passed++;
      } catch (e) {
        failures.push(tag(`flag-values statement failed: ${e.message}: ${u.slice(0, 80)}`));
      }
    }
    eq(updates.length, 11, tag('flag-values.sql: 10 template UPDATEs and one check query'));
    // each template, applied in runbook order, leaves the value the runbook step needs (shadow days stay shadow)
    const steps = [
      ['S1', 'agent.growth.hn', { mode: 'assist' }],
      ['S2', 'agent.growth.reddit', { mode: 'assist' }],
      ['S3 (a)', 'agent.growth.tenders', { mode: 'assist', llm_cap: 20, countries: ['NL', 'DE'], relevance: false }],
      ['S3 (b)', 'agent.growth.tenders', { mode: 'assist', llm_cap: 20, relevance: false }],
      ['S4 (a)', 'agent.content_daily', { mode: 'shadow', steps: ['sitemap'] }],
      ['S4 (b)', 'agent.content_daily', { mode: 'assist', steps: ['sitemap'] }],
      ['S5', 'agent.content_daily', { mode: 'assist', model: 'claude-sonnet-5', steps: ['generate', 'translate', 'fix_links', 'sitemap'], shadow_generate: false, backfill_per_language_per_day: 5 }],
      ['S7', 'agent.ops_digest', { mode: 'assist', purge: true, ads_upload: false }],
      ['S8 (a)', 'agent.growth.xometry', { mode: 'shadow', notify_new: false, borderline_exclude: [], token_reminder_hours: 24 }],
      ['S8 (b)', 'agent.growth.xometry', { mode: 'assist', notify_new: false, borderline_exclude: [], token_reminder_hours: 24 }],
    ];
    steps.forEach(([step, key, value], i) => {
      const row = returned[i]?.[0] ?? {};
      eq([row.key, row.enabled, row.value], [key, false, value], tag(`flag-values.sql ${step}: ${key} value after the template`));
    });
    ok(updates.slice(0, 10).every((u) => /^UPDATE feature_flags SET value = /.test(u) && /tenant_id = '00000000-0000-0000-0000-000000000001'/.test(u)), tag('every template merges into value of the default tenant'));
    ok(returned.slice(0, 10).every((rows) => rows.length === 1), tag('every template updates exactly one row'));
    const digestRow = returned[7]?.[0] ?? {};
    eq([digestRow.key, digestRow.recipient_set, 'recipient' in (digestRow.value ?? {})], ['agent.ops_digest', true, false], tag('the digest template never returns the recipient'));
    const flags = Object.fromEntries((await db.query(`SELECT key, enabled, value FROM feature_flags WHERE key LIKE 'agent.%'`)).rows.map((r) => [r.key, r]));
    eq(flags['agent.growth.tenders'].value, { mode: 'assist', llm_cap: 20, relevance: false }, tag('S3 (b) removes the canary countries'));
    eq(flags['agent.content_daily'].value, { mode: 'assist', model: 'claude-sonnet-5', steps: ['generate', 'translate', 'fix_links', 'sitemap'], shadow_generate: false, backfill_per_language_per_day: 5 }, tag('S5 value'));
    eq(flags['agent.ops_digest'].value, { mode: 'assist', purge: true, recipient: '<RECIPIENT>', ads_upload: false }, tag('S7 value (placeholder recipient)'));
    eq(flags['agent.growth.xometry'].value, { mode: 'assist', notify_new: false, borderline_exclude: [], token_reminder_hours: 24 }, tag('S8 value'));
    ok(Object.values(flags).every((f) => f.enabled === false), tag('templates never switch a flag on (the dashboard or the enable line does)'));
    // the commented drop-acceptance template: the key the content unit reads, merged into the S5 value only
    const dropLines = FLAG_VALUES.split('\n').filter((l) => /^--\s+UPDATE .*sitemap_accept_drop_on/.test(l));
    eq(dropLines.length, 1, tag('flag-values.sql: one commented sitemap_accept_drop_on template'));
    ok(CONTENT_FLAG_SOURCE.includes('f.value.sitemap_accept_drop_on') && SITEMAP_WORKFLOW_SOURCE.includes('set sitemap_accept_drop_on to'), tag('the template key is the one the content unit reads and its alert names'));
    const dropSql = (dropLines[0] ?? '').replace(/^--\s+/, '').replace(/;\s*$/, '').replace('<YYYY-MM-DD>', '2026-10-20');
    const dropRows = dropLines.length === 1 ? (await db.query(dropSql + ' RETURNING key, enabled, value')).rows : [];
    eq(dropRows.map((r) => [r.key, r.enabled, r.value]), [['agent.content_daily', false, { mode: 'assist', model: 'claude-sonnet-5', steps: ['generate', 'translate', 'fix_links', 'sitemap'], shadow_generate: false, backfill_per_language_per_day: 5, sitemap_accept_drop_on: '2026-10-20' }]], tag('sitemap_accept_drop_on template: one row, the day added, the S5 value kept'));
    passed++;
    let modeRefused = false;
    try {
      await db.query(`UPDATE feature_flags SET value = value || '{"mode":"on"}'::jsonb WHERE key = 'agent.growth.hn'`);
    } catch {
      modeRefused = true;
    }
    ok(modeRefused, tag('a mistyped mode is refused by the table'));
    console.log(`ran ${name}`);
  } catch (e) {
    failures.push(tag(`scenario threw: ${e && e.message}`));
  } finally {
    await db.close();
  }
}

// parity.sql: the blocks the spec gives verbatim are unchanged (independent of the engine)
{
  const blocks = normalisedBlocks(PARITY);
  for (const [label, expected] of Object.entries(SPEC_BLOCK_SHA256)) {
    const actual = blocks[label] === undefined ? null : crypto.createHash('sha256').update(blocks[label]).digest('hex');
    ok(actual === expected, `parity.sql ${label} equals the spec text (normalised SHA-256)`, actual);
  }
}

for (const engine of selected) await scenario(engine);
if (failures.length) {
  console.error(`${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log(`all ${passed} assertions passed`);
