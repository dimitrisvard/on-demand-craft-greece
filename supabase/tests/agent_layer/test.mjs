// Tests for supabase/migrations/*_agent_layer.sql (contract: docs/migration/specs/PHASE4_SPEC.md §4.13) against
// a minimal recreation of the database objects it touches (live_min.sql).
//   node test.mjs --engine=pglite     PGlite 0.5.8  = Postgres 18.3 (default)
//   node test.mjs --engine=pglite16   PGlite 0.2.17 = Postgres 16.4
//   node test.mjs --engine=pg         a Postgres server named by PG_URL (creates and drops a temporary database)
// ENGINE=<name> works too. Exit code 0 = every assertion passed; 1 = failures or a missing / ambiguous file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagsSyncTick, FakeKV, readerView } from './flags-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The migration and its removal script are found by name pattern; exactly one match each.
function onlyFile(dir, suffix) {
  const abs = path.resolve(HERE, dir);
  const hits = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith(suffix)).sort() : [];
  if (hits.length !== 1) {
    console.error(`expected exactly one ${path.relative(HERE, abs)}/*${suffix}, found ${hits.length}${hits.length ? ': ' + hits.join(', ') : ''}`);
    process.exit(1);
  }
  return path.join(abs, hits[0]);
}
const UP_FILE = onlyFile('../../migrations', '_agent_layer.sql');
const DOWN_FILE = onlyFile('../../rollback', '_agent_layer_down.sql');
const LIVE = fs.readFileSync(path.join(HERE, 'live_min.sql'), 'utf8');
const UP = fs.readFileSync(UP_FILE, 'utf8');
const DOWN = fs.readFileSync(DOWN_FILE, 'utf8');

const ENGINES = ['pglite', 'pglite16', 'pg'];
const ENGINE = process.argv.find((a) => a.startsWith('--engine='))?.slice('--engine='.length) || process.env.ENGINE || 'pglite';
if (!ENGINES.includes(ENGINE)) {
  console.error(`unknown engine ${ENGINE}; use one of ${ENGINES.join(', ')}`);
  process.exit(1);
}

// ---- engine adapter ---------------------------------------------------------------
async function openDb() {
  if (ENGINE === 'pglite' || ENGINE === 'pglite16') {
    const { PGlite } = await import(ENGINE === 'pglite16' ? 'pglite-pg16' : '@electric-sql/pglite');
    const db = new PGlite();
    await db.waitReady;
    return {
      name: ENGINE + ' ' + (await db.query('show server_version')).rows[0].server_version,
      async q(sql, params = []) { const r = await db.query(sql, params); return { rows: r.rows, count: r.affectedRows ?? r.rows.length }; },
      async exec(sql) { await db.exec(sql); },
      async close() { await db.close(); },
    };
  }
  if (!process.env.PG_URL) {
    console.error('engine pg needs PG_URL');
    process.exit(1);
  }
  const pg = (await import('pg')).default;
  const admin = new pg.Client({ connectionString: process.env.PG_URL });
  await admin.connect();
  const dbname = 'agent_' + Math.random().toString(36).slice(2, 10);
  await admin.query(`create database ${dbname}`);
  const url = new URL(process.env.PG_URL); url.pathname = '/' + dbname;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  return {
    name: 'pg ' + (await c.query('show server_version')).rows[0].server_version,
    async q(sql, params = []) { const r = await c.query(sql, params); return { rows: r.rows, count: r.rowCount ?? r.rows.length }; },
    async exec(sql) { await c.query(sql); },
    async close() { await c.end(); await admin.query(`drop database ${dbname}`); await admin.end(); },
  };
}

// ---- tiny assertion kit -------------------------------------------------------------
let passed = 0; const failures = [];
function ok(cond, name, detail) {
  if (cond) passed++; else { failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
}
async function rejects(fn, re, name) {
  try { await fn(); failures.push(name + ' :: expected an error matching ' + re); }
  catch (e) { ok(re.test(e.message), name, e.message); }
}
async function section(title, fn) {
  const before = failures.length;
  try { await fn(); } catch (e) { failures.push(`${title}: unexpected error ${e.message}`); }
  console.log(`${failures.length === before ? 'ok  ' : 'FAIL'} ${title}`);
}

// ---- identities -----------------------------------------------------------------------
const U = {
  admin:    '11111111-1111-4111-8111-111111111111',  // user_roles admin
  sales:    '66666666-6666-4666-8666-666666666666',  // user_roles sales_rep
  customer: '22222222-2222-4222-8222-222222222222',  // user_roles customer + customers row
  superTen: '33333333-3333-4333-8333-333333333333',  // tenant role super_admin only (passes is_staff())
  tenAdmin: '44444444-4444-4444-8444-444444444444',  // tenant_admin of the second tenant only
  partner:  '55555555-5555-4555-8555-555555555555',  // partner_seller
  multi:    '77777777-7777-4777-8777-777777777777',  // accountant + production_manager + customer (AM-5)
};
const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = 'bb71e74e-4273-496f-a75b-319357666ebc';
const who = {
  anon: { role: 'anon' },
  service: { role: 'service_role' },
  admin: { role: 'authenticated', sub: U.admin, email: 'admin@example.test' },
  sales: { role: 'authenticated', sub: U.sales, email: 'sales@example.test' },
  customer: { role: 'authenticated', sub: U.customer, email: 'cust@example.test' },
  superTen: { role: 'authenticated', sub: U.superTen, email: 'super@example.test' },
  tenAdmin: { role: 'authenticated', sub: U.tenAdmin, email: 'tenadmin@example.test' },
  partner: { role: 'authenticated', sub: U.partner, email: 'partner@example.test' },
};

async function as(db, w, fn) {
  const claims = w.role === 'authenticated' ? { role: w.role, sub: w.sub, email: w.email } : { role: w.role };
  await db.q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`SET ROLE ${w.role}`);
  try { return await fn(); }
  finally { await db.exec('RESET ROLE'); await db.q(`select set_config('request.jwt.claims', '', false)`); }
}
const sha = (s) => s.repeat(64).slice(0, 64);       // deterministic 64-hex strings for tests
const HEX_A = sha('a'), HEX_B = sha('b'), HEX_C = sha('c'), HEX_D = sha('d');
// Deterministic text that does not compress well (size checks measure the stored value).
function noise(n) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let x = 2463534242, s = '';
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; s += abc[x & 63]; }
  return s;
}

const TABLES = ['agent_runs', 'feature_flags', 'pricing_rules', 'quote_workflows', 'inbound_emails', 'cad_jobs', 'stock_reservations'];
const SERVICE_FUNCS = [
  'public.feature_flags_kv_key(text,uuid)', 'public.feature_flags_kv_value(boolean,jsonb,timestamptz,bigint)',
  'public.feature_flags_sync_batch()', 'public.feature_flags_mark_synced(text,uuid,bigint)',
  'public.feature_flags_seed_from_kv(text,uuid,jsonb)', 'public.create_email_rfq(uuid,jsonb,text)',
  'public.agent_run_begin(text,text,text,jsonb,uuid)', 'public.agent_run_claim_approval(text,jsonb)',
  'public.stock_hold(uuid,uuid,jsonb,timestamptz,text)', 'public.stock_commit(uuid,uuid)',
  'public.stock_release(uuid,text)', 'public.agent_retention_purge(timestamptz)',
  'public.create_order_from_quote(uuid)', 'public.agent_staff_for_email(text)',
];
const CANON_FLAGS = ['seo.strict_404', 'api.forward_to_vercel', 'agent.rfq_intake', 'agent.quote', 'agent.post_order',
  'agent.growth.reddit', 'agent.growth.hn', 'agent.growth.tenders', 'agent.growth.scrapers', 'agent.growth.xometry',
  'agent.content_daily', 'agent.ops_digest', 'mcp.remote'];

// Catalogue snapshot used to prove that the removal script restores the pre-migration schema.
async function snapshot(db) {
  const parts = await Promise.all([
    db.q(`select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') d from information_schema.columns where table_schema='public' order by 1,2`),
    db.q(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace order by 1,2`),
    db.q(`select indexname, indexdef from pg_indexes where schemaname='public' order by 1`),
    db.q(`select tablename, policyname from pg_policies where schemaname='public' order by 1,2`),
    db.q(`select proname, pg_get_function_identity_arguments(oid) a from pg_proc where pronamespace='public'::regnamespace order by 1,2`),
    db.q(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal order by 1,2`),
    db.q(`select relname, relkind from pg_class where relnamespace='public'::regnamespace order by 1`),
  ]);
  return JSON.stringify(parts.map((p) => p.rows));
}

async function fixtures(db) {
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${U.admin}','admin@example.test'),('${U.sales}','sales@example.test'),('${U.customer}','cust@example.test'),
      ('${U.superTen}','super@example.test'),('${U.tenAdmin}','tenadmin@example.test'),('${U.partner}','partner@example.test'),
      ('${U.multi}','Multi.Role@Example.test');
    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${U.admin}','admin'),('${U.sales}','sales_rep'),('${U.customer}','customer'),('${U.partner}','partner_seller'),
      ('${U.multi}','production_manager'),('${U.multi}','accountant'),('${U.multi}','customer');
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role) VALUES
      ('${U.superTen}','${T1}','super_admin'),('${U.tenAdmin}','${T2}','tenant_admin');
    INSERT INTO public.customers (id, email, company_name, user_id, status) VALUES
      ('c0000000-0000-4000-8000-000000000001','cust@example.test','Cust GmbH','${U.customer}','active');
    INSERT INTO public.rfqs (id, company_name, customer_id, rfq_number, status) VALUES
      ('a0000000-0000-4000-8000-000000000001','Cust GmbH','c0000000-0000-4000-8000-000000000001','RFQ-01102026-1','draft');
    INSERT INTO public.orders (id, customer_id, rfq_id, title) VALUES
      ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','PO 1');
    INSERT INTO public.order_items (id, order_id, product_name, quantity) VALUES
      ('d0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','Part 1 RFQ-01102026-1-1',10),
      ('d0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','Part 2 RFQ-01102026-1-2',5);
    INSERT INTO public.materials (id, name, category, thickness_mm) VALUES
      ('e0000000-0000-4000-8000-000000000001','S235 2 mm','sheet_metal',2),
      ('e0000000-0000-4000-8000-000000000002','AlMg3 3 mm','sheet_metal',3);
    INSERT INTO public.stock_items (id, material_id, width_mm, height_mm) VALUES
      ('f0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',3000,1500),
      ('f0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002',2000,1000);
    INSERT INTO public.nesting_sessions (id, material_id) VALUES
      ('90000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001'),
      ('90000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001');
    INSERT INTO public.marketing_sender_accounts (id, email, display_name, provider) VALUES
      ('70000000-0000-4000-8000-000000000001','sender@example.test','Sender','google_workspace');
  `);
}

const RFQ1 = 'a0000000-0000-4000-8000-000000000001';
const OI1 = 'd0000000-0000-4000-8000-000000000001', OI2 = 'd0000000-0000-4000-8000-000000000002';
const MAT1 = 'e0000000-0000-4000-8000-000000000001', MAT2 = 'e0000000-0000-4000-8000-000000000002';
const SI1 = 'f0000000-0000-4000-8000-000000000001', SI2 = 'f0000000-0000-4000-8000-000000000002';
const NS1 = '90000000-0000-4000-8000-000000000001', NS2 = '90000000-0000-4000-8000-000000000002';
const QW1 = 'a2000000-0000-4000-8000-000000000001';

// One service-role row per new table, so that "staff read" has something to read.
async function seedAgentRows(db) {
  await as(db, who.service, async () => {
    await db.exec(`
      INSERT INTO public.agent_runs (id, agent, trigger, idempotency_key) VALUES
        ('a1000000-0000-4000-8000-000000000001','rfq_intake','email','seed-1');
      INSERT INTO public.pricing_rules (process, rule_key, value, unit) VALUES ('sheet_metal','bend_per_hit',1.5,'EUR/hit');
      INSERT INTO public.quote_workflows (id, rfq_id, workflow_instance_id) VALUES
        ('${QW1}','${RFQ1}','quote-${RFQ1}-v1');
      INSERT INTO public.inbound_emails (id, message_id, message_id_sha256, mailbox, from_email, received_at) VALUES
        ('a3000000-0000-4000-8000-000000000001','<m1@example.test>','${HEX_A}','rfq','buyer@example.test', now());
      INSERT INTO public.cad_jobs (rfq_id, idempotency_key, job_type, input_r2_key, input_sha256) VALUES
        ('${RFQ1}','${HEX_B}:analyse:${HEX_C}','analyse','rfq/${RFQ1}/x-part.step','${HEX_B}');
    `);
    await db.q(`select * from public.stock_hold($1,$2,$3::jsonb, now() + interval '14 days', $4)`,
      [OI2, MAT2, JSON.stringify([{ stock_item_id: SI2, area_mm2: 500000 }]), [T1, MAT2].join(':')]);
  });
}

// The portal's Accept Quote total (src/pages/customer/QuoteDetailPage.tsx:174-178), for comparison with AM-4.
function portalTotal(parts, shipping) {
  const subtotal = parts.reduce((sum, part) => sum + (part.total_price || 0), 0);
  const vat = (subtotal + (shipping || 0)) * 0.24;
  return subtotal + (shipping || 0) + vat;
}

// ---- shared KV vectors (also run by workers/ops/test/flags against microns-ops' flagsSyncTick) ---------------
const FLAG_VECTORS = JSON.parse(fs.readFileSync(path.join(HERE, 'vectors', 'flags-sync.json'), 'utf8'));
const vsub = (s) => (typeof s === 'string'
  ? s.replaceAll('$admin', FLAG_VECTORS.admin_user).replaceAll('$other_tenant', FLAG_VECTORS.other_tenant)
    .replace(/\$x(\d+)/g, (_m, n) => 'x'.repeat(Number(n))) : s);
const vsubAll = (o) => (Array.isArray(o) ? o.map(vsubAll)
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [vsub(k), vsubAll(v)])) : vsub(o));
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return typeof a === 'number' && typeof b === 'number' ? a === b : false;
}
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
/** null when the raw KV text matches the expectation (null = absent), else a description. */
function kvMismatch(raw, exp) {
  if (exp === null) return raw == null ? null : `expected absent, got ${raw}`;
  if (raw == null) return 'expected a record, key absent';
  const rec = JSON.parse(raw);
  if (rec.enabled !== exp.enabled) return `enabled ${rec.enabled}`;
  if (!sameJson(rec.value, exp.value)) return `value ${JSON.stringify(rec.value)}`;
  if (('mode' in exp) !== ('mode' in rec) || ('mode' in exp && rec.mode !== exp.mode)) return `mode ${rec.mode}`;
  if (typeof rec.rev !== 'number' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(rec.updated_at)) return `rev/updated_at ${raw}`;
  return null;
}

async function runFlagVectors(step, check) {
  const fresh = async () => {
    const d = await openDb();
    await d.exec(LIVE);
    await fixtures(d);
    await d.exec(UP);
    return d;
  };
  // Seed rules: one tick over the 13 seeded rows plus the pending rows of seed_rows, one KV state per key.
  const d1 = await fresh();
  const svc1 = (sql, params) => as(d1, who.service, async () => (await d1.q(sql, params)).rows);
  const cases = vsubAll(FLAG_VECTORS.seed_cases);
  for (const r of vsubAll(FLAG_VECTORS.seed_rows)) {
    await svc1(`insert into public.feature_flags (key, tenant_id, value, kv_seed_pending) values ($1, $2, $3::jsonb, true)`,
      [r.key, r.tenant, JSON.stringify(r.value)]);
  }
  const kvKeyOf = (c) => (c.tenant && c.tenant !== T1 ? `t:${c.tenant}:${c.key}` : c.key);
  const kv1 = new FakeKV(Object.fromEntries(cases.filter((c) => c.kv !== null).map((c) => [kvKeyOf(c), c.kv])));
  const t = await flagsSyncTick(svc1, kv1);
  check(t.seed_failed.length === 0, 'seed vectors: no seed import call fails', t.seed_failed);
  for (const c of cases) {
    const k = kvKeyOf(c);
    const bucket = { imported: t.imported, absent: t.absent, invalid: t.invalid }[c.result];
    check(bucket.includes(k), `seed vector "${c.name}": ${c.result}`, t);
    const [row] = await svc1(`select enabled, value, kv_seed_pending p from public.feature_flags where key = $1 and tenant_id = $2`, [c.key, c.tenant ?? T1]);
    check(row.enabled === c.row.enabled && sameJson(row.value, c.row.value), `seed vector "${c.name}": row`, row);
    check(row.p === (c.result === 'invalid'), `seed vector "${c.name}": pending only when invalid`, row);
    if ('kv_after' in c) check(kvMismatch(kv1.map.get(k), c.kv_after) === null, `seed vector "${c.name}": KV`, kvMismatch(kv1.map.get(k), c.kv_after));
    else check(kv1.map.get(k) === c.kv, `seed vector "${c.name}": KV left as it was`, kv1.map.get(k));
  }
  await d1.close();

  // A seed import call that fails for one row is reported for that row; the other rows are imported and mirrored in
  // the same tick, and the next tick imports the row.
  const d3 = await fresh();
  const svc3 = (sql, params) => as(d3, who.service, async () => (await d3.q(sql, params)).rows);
  let failOnce = true;
  const svc3FailingSeed = (sql, params) => {
    if (failOnce && /feature_flags_seed_from_kv/.test(sql) && params?.[0] === 'agent.content_daily') {
      failOnce = false;
      return Promise.reject(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
    }
    return svc3(sql, params);
  };
  const kv3 = new FakeKV({ 'agent.content_daily': '{"enabled":true}', 'seo.strict_404': '{"enabled":true}' });
  const t3 = await flagsSyncTick(svc3FailingSeed, kv3);
  check(sameSet(t3.seed_failed, ['agent.content_daily']), 'seed: a failing import call is reported for its row only', t3.seed_failed);
  check(sameSet(t3.imported, ['seo.strict_404']) && sameSet(t3.written, ['seo.strict_404']) && t3.absent.length === 11,
    'seed: the other rows are imported and mirrored in the same tick', t3);
  const [p3] = await svc3(`select kv_seed_pending p from public.feature_flags where key = 'agent.content_daily' and tenant_id = $1`, [T1]);
  check(p3.p === true, 'seed: the row whose import call failed stays pending', p3);
  const t3b = await flagsSyncTick(svc3FailingSeed, kv3);
  check(sameSet(t3b.imported, ['agent.content_daily']) && sameSet(t3b.written, ['agent.content_daily']) && t3b.seed_failed.length === 0,
    'seed: the next tick imports and mirrors that row', t3b);
  await d3.close();

  // Scenario: ticks, edits, a race between batch and mark, a failed put, another tenant.
  const d2 = await fresh();
  const svc = (sql, params) => as(d2, who.service, async () => (await d2.q(sql, params)).rows);
  const sc = vsubAll(FLAG_VECTORS.scenario);
  const kv = new FakeKV(sc.kv);
  const setSql = (set, from) => Object.keys(set).map((k, i) => `${k} = $${i + from}`).join(', ');
  for (const [i, s] of sc.steps.entries()) {
    const label = `scenario step ${i + 1} ${s.op}${s.name ? ` (${s.name})` : ''}`;
    await step(label, async () => {
      if (s.op === 'edit') {
        await svc(`update public.feature_flags set ${setSql(s.set, 3)} where key = $1 and tenant_id = $2`, [s.key, s.tenant ?? T1, ...Object.values(s.set)]);
      } else if (s.op === 'insert') {
        const cols = Object.keys(s.set);
        await svc(`insert into public.feature_flags (key, tenant_id, ${cols.join(', ')}) values ($1, $2, ${cols.map((_, j) => `$${j + 3}`).join(', ')})`,
          [s.key, s.tenant ?? T1, ...Object.values(s.set)]);
      } else if (s.op === 'kv_fail_next') {
        kv.failNext.add(s.key);
      } else if (s.op === 'race') {
        const batchRow = async () => (await svc(`select * from public.feature_flags_sync_batch()`)).find((r) => r.flag_key === s.key && r.flag_tenant_id === T1);
        await svc(`update public.feature_flags set ${setSql(s.first, 3)} where key = $1 and tenant_id = $2`, [s.key, T1, ...Object.values(s.first)]);
        const stale = await batchRow();
        await svc(`update public.feature_flags set ${setSql(s.then, 3)} where key = $1 and tenant_id = $2`, [s.key, T1, ...Object.values(s.then)]);
        if (s.newer_first) {
          // The newer rev is written and marked first (e.g. the edit's write-through); the older put lands after it.
          const newer = await batchRow();
          check(Number(newer.rev) > Number(stale.rev), `${label}: newer rev in the batch`, newer);
          await kv.put(newer.kv_key, JSON.stringify(newer.kv_value));
          const [{ m: n }] = await svc(`select public.feature_flags_mark_synced($1, $2, $3) m`, [newer.flag_key, newer.flag_tenant_id, newer.rev]);
          check(n === true, `${label}: newer rev marked`, n);
        }
        await kv.put(stale.kv_key, JSON.stringify(stale.kv_value));
        const [{ m }] = await svc(`select public.feature_flags_mark_synced($1, $2, $3) m`, [stale.flag_key, stale.flag_tenant_id, stale.rev]);
        check(m === s.expect_mark, `${label}: mark_synced answers ${s.expect_mark}`, m);
      } else if (s.op === 'tick') {
        const r = await flagsSyncTick(svc, kv);
        for (const k of ['imported', 'invalid', 'written', 'stale', 'failed']) {
          if (k in s.expect) check(sameSet(r[k], s.expect[k]), `${label}: ${k}`, r[k]);
        }
        if ('absent_count' in s.expect) check(r.absent.length === s.expect.absent_count, `${label}: absent count`, r.absent);
        for (const [key, exp] of Object.entries(s.expect.kv ?? {})) {
          check(kvMismatch(kv.map.get(key), exp) === null, `${label}: KV ${key}`, kvMismatch(kv.map.get(key), exp));
        }
      }
    });
  }
  await d2.close();
}

// =====================================================================================
async function main() {
  const db = await openDb();
  console.log(`engine: ${db.name}`);
  console.log(`migration: ${path.relative(path.resolve(HERE, '../../..'), UP_FILE)}`);
  console.log(`removal:   ${path.relative(path.resolve(HERE, '../../..'), DOWN_FILE)}`);
  await db.exec(LIVE);
  await fixtures(db);
  const before = await snapshot(db);

  await section('migration file: one transaction, COMMIT is the last statement (dry-run procedure)', async () => {
    const code = UP.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    ok((code.match(/^BEGIN;\s*$/gm) || []).length === 1, 'exactly one BEGIN;');
    ok((code.match(/^COMMIT;\s*$/gm) || []).length === 1, 'exactly one COMMIT;');
    ok(/COMMIT;\s*$/.test(code), 'COMMIT; ends the file');
    ok((UP.match(/^CREATE TABLE public\./gm) || []).length === 7, 'seven CREATE TABLE public.* statements');
  });

  await section('migration applies in one transaction', async () => {
    await db.exec(UP);
    const r = await db.q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name = any($1)`, [TABLES]);
    ok(r.rows[0].n === 7, 'seven tables created', r.rows[0]);
  });

  await section('re-applying aborts cleanly and changes nothing', async () => {
    const snap = await snapshot(db);
    await rejects(() => db.exec(UP), /already applied/, 'second apply raises');
    await db.exec('ROLLBACK').catch(() => {});
    ok(snap === await snapshot(db), 'schema unchanged after failed re-apply');
  });

  await seedAgentRows(db);

  // ---- grants and RLS ---------------------------------------------------------------
  await section('catalogue: grants on the seven tables', async () => {
    for (const t of TABLES) {
      const g = await db.q(`select grantee, string_agg(privilege_type, ',' order by privilege_type) p
                              from information_schema.role_table_grants where table_schema='public' and table_name=$1
                               and grantee in ('anon','authenticated','PUBLIC') group by 1 order by 1`, [t]);
      ok(JSON.stringify(g.rows) === JSON.stringify([{ grantee: 'authenticated', p: 'SELECT' }]), `${t}: only authenticated SELECT`, g.rows);
      const rls = await db.q(`select relrowsecurity from pg_class where oid = $1::regclass`, ['public.' + t]);
      ok(rls.rows[0].relrowsecurity === true, `${t}: RLS enabled`);
      const pol = await db.q(`select policyname, cmd, roles::text r from pg_policies where schemaname='public' and tablename=$1`, [t]);
      ok(pol.rows.length === 1 && pol.rows[0].cmd === 'SELECT' && pol.rows[0].r === '{authenticated}', `${t}: one SELECT policy for authenticated`, pol.rows);
    }
    for (const f of SERVICE_FUNCS) {
      const r = await db.q(`select has_function_privilege('anon',$1,'EXECUTE') a, has_function_privilege('authenticated',$1,'EXECUTE') u,
                                   has_function_privilege('service_role',$1,'EXECUTE') s`, [f]);
      ok(!r.rows[0].a && !r.rows[0].u && r.rows[0].s, `${f}: service_role only`, r.rows[0]);
    }
    const h = await db.q(`select has_function_privilege('anon','public.has_staff_role()','EXECUTE') a,
                                 has_function_privilege('authenticated','public.has_staff_role()','EXECUTE') u`);
    ok(!h.rows[0].a && h.rows[0].u, 'has_staff_role: authenticated yes, anon no', h.rows[0]);
    const s = await db.q(`select has_sequence_privilege('anon','public.feature_flags_rev_seq','USAGE') a,
                                 has_sequence_privilege('authenticated','public.feature_flags_rev_seq','USAGE') u`);
    ok(!s.rows[0].a && !s.rows[0].u, 'rev sequence: no client access', s.rows[0]);
    const sec = await db.q(`select proname, prosecdef, array_to_string(proconfig, ',') cfg from pg_proc
                             where pronamespace = 'public'::regnamespace and proname in ('create_order_from_quote','agent_staff_for_email')
                             order by proname`);
    ok(JSON.stringify(sec.rows) === JSON.stringify([
      { proname: 'agent_staff_for_email', prosecdef: true, cfg: 'search_path=public' },
      { proname: 'create_order_from_quote', prosecdef: false, cfg: 'search_path=public' },
    ]), 'AM-4 security invoker, AM-5 security definer, both search_path=public', sec.rows);
  });

  await section('RLS: anon has no access', async () => {
    for (const t of TABLES) {
      await as(db, who.anon, async () => {
        await rejects(() => db.q(`select count(*) from public.${t}`), /permission denied/, `anon select ${t}`);
        await rejects(() => db.q(`insert into public.${t} default values`), /permission denied/, `anon insert ${t}`);
      });
    }
    await as(db, who.anon, async () => {
      await rejects(() => db.q(`select public.has_staff_role()`), /permission denied/, 'anon has_staff_role');
      await rejects(() => db.q(`select * from public.feature_flags_sync_batch()`), /permission denied/, 'anon rpc');
    });
  });

  await section('RLS: authenticated non-staff sees nothing and cannot write', async () => {
    for (const w of ['customer', 'superTen', 'tenAdmin', 'partner']) {
      await as(db, who[w], async () => {
        const st = await db.q(`select public.has_staff_role() s, public.is_staff() i`);
        ok(st.rows[0].s === false, `${w}: has_staff_role false`, st.rows[0]);
        for (const t of TABLES) {
          const r = await db.q(`select count(*)::int n from public.${t}`);
          ok(r.rows[0].n === 0, `${w}: 0 rows in ${t}`, r.rows[0]);
          await rejects(() => db.q(`insert into public.${t} default values`), /permission denied/, `${w} insert ${t}`);
          await rejects(() => db.q(`update public.${t} set updated_at = now()`), /permission denied/, `${w} update ${t}`);
          await rejects(() => db.q(`delete from public.${t}`), /permission denied/, `${w} delete ${t}`);
        }
        await rejects(() => db.q(`select * from public.stock_release($1,'manual')`, [OI2]), /permission denied/, `${w} rpc stock_release`);
      });
    }
    const sup = await as(db, who.superTen, () => db.q(`select public.is_staff() i`));
    ok(sup.rows[0].i === true, 'agent tables use has_staff_role(): a tenant super admin who passes is_staff() is not agent staff');
  });

  await section('RLS: staff read only', async () => {
    for (const w of ['admin', 'sales']) {
      await as(db, who[w], async () => {
        for (const t of TABLES) {
          const r = await db.q(`select count(*)::int n from public.${t}`);
          ok(r.rows[0].n > 0, `${w}: reads ${t}`, r.rows[0]);
          await rejects(() => db.q(`insert into public.${t} default values`), /permission denied/, `${w} insert ${t}`);
          await rejects(() => db.q(`update public.${t} set updated_at = now()`), /permission denied/, `${w} update ${t}`);
          await rejects(() => db.q(`delete from public.${t}`), /permission denied/, `${w} delete ${t}`);
          await rejects(() => db.q(`truncate public.${t} cascade`), /permission denied/, `${w} truncate ${t}`);
        }
        await rejects(() => db.q(`select * from public.agent_run_claim_approval($1,'{}')`, [HEX_A]), /permission denied/, `${w} rpc claim`);
      });
    }
  });

  await section('RLS: service role writes', async () => {
    await as(db, who.service, async () => {
      for (const t of TABLES) {
        const r = await db.q(`update public.${t} set updated_at = updated_at`);
        ok(r.count > 0, `service updates ${t}`, r.count);
      }
    });
  });

  // ---- feature flags --------------------------------------------------------------------
  await section('feature_flags: canonical seed', async () => {
    const r = await db.q(`select key, enabled, kv_seed_pending p, jsonb_typeof(value) t, rev from public.feature_flags order by key`);
    ok(JSON.stringify(r.rows.map((x) => x.key)) === JSON.stringify([...CANON_FLAGS].sort()), 'exactly the 13 canonical keys', r.rows.map((x) => x.key));
    ok(r.rows.every((x) => x.enabled === false && x.p === true && x.t === 'object'), 'all off, pending, object values');
    ok(new Set(r.rows.map((x) => String(x.rev))).size === 13, 'distinct revs');
    const b = await as(db, who.service, () => db.q(`select * from public.feature_flags_sync_batch()`));
    ok(b.rows.length === 0, 'nothing to sync before the seed import', b.rows);
  });

  await section('feature_flags: KV mirror contract (reference cron tick, fake KV)', async () => {
    const svc = (sql, params) => as(db, who.service, async () => (await db.q(sql, params)).rows);
    // KV as set by hand in Phases 1-3: strict_404 off, forward on for preview hosts, one malformed key.
    const kv = new FakeKV({
      'seo.strict_404': '{"enabled":false}',
      'api.forward_to_vercel': '{"enabled":true,"value":{"hosts":["preview"]}}',
      'mcp.remote': '{"on":true}',
    });
    const t1 = await flagsSyncTick(svc, kv);
    ok(JSON.stringify(t1.imported.sort()) === JSON.stringify(['api.forward_to_vercel', 'seo.strict_404']), 'tick1 imports the two hand-set keys', t1);
    ok(t1.absent.length === 10 && t1.invalid.length === 1 && t1.invalid[0] === 'mcp.remote', 'tick1: 10 absent, 1 invalid', t1);
    ok(JSON.stringify(t1.written.sort()) === JSON.stringify(['api.forward_to_vercel', 'seo.strict_404']), 'tick1 writes only the imported keys', t1.written);
    const fwd = JSON.parse(kv.map.get('api.forward_to_vercel'));
    ok(fwd.enabled === true && JSON.stringify(fwd.value) === '{"hosts":["preview"]}' && typeof fwd.rev === 'number'
       && /Z$/.test(fwd.updated_at) && !('mode' in fwd), 'forward flag keeps its state and value shape', fwd);
    ok(readerView(kv.map.get('api.forward_to_vercel'), false).enabled === true, 'Phase 1/2 reader sees forward on');
    ok(!kv.map.has('agent.quote') && readerView(kv.map.get('agent.quote'), false).source === 'fallback', 'absent agent key stays absent (fail closed)');
    const row = await db.q(`select enabled, value, kv_seed_pending p from public.feature_flags where key='api.forward_to_vercel'`);
    ok(row.rows[0].enabled === true && row.rows[0].p === false, 'table now holds the imported state', row.rows[0]);

    const t2 = await flagsSyncTick(svc, kv);
    ok(t2.written.length === 0 && t2.imported.length === 0 && t2.invalid.length === 1, 'tick2: steady state (only the invalid key reported)', t2);

    // Staff switch through microns-ops (service role) -> next tick writes exactly that key.
    await svc(`update public.feature_flags set enabled = true, updated_by = $1 where key = 'agent.quote'`, [U.admin]);
    const t3 = await flagsSyncTick(svc, kv);
    ok(JSON.stringify(t3.written) === '["agent.quote"]', 'tick3 writes agent.quote only', t3.written);
    const q = JSON.parse(kv.map.get('agent.quote'));
    ok(q.enabled === true && q.mode === 'assist' && q.value.follow_up_days.length === 3, 'agent.quote KV shape carries mode and value', q);

    // Editing the malformed key replaces the pending import and mirrors the table value.
    await svc(`update public.feature_flags set updated_by = $1 where key = 'mcp.remote'`, [U.admin]);   // saved unchanged by staff
    const t4 = await flagsSyncTick(svc, kv);
    ok(t4.written.includes('mcp.remote') && JSON.parse(kv.map.get('mcp.remote')).enabled === false, 'edited malformed key is overwritten with the table value', t4);

    // Race: the row changes between batch read and mark -> mark returns false, next tick writes the new rev.
    const batch0 = await svc(`select * from public.feature_flags_sync_batch()`);
    ok(batch0.length === 0, 'no pending work', batch0);
    await svc(`update public.feature_flags set enabled = true where key = 'agent.post_order'`);
    const [stale] = await svc(`select * from public.feature_flags_sync_batch()`);
    await svc(`update public.feature_flags set enabled = false where key = 'agent.post_order'`);
    await kv.put(stale.kv_key, JSON.stringify(stale.kv_value));
    const [{ m }] = await svc(`select public.feature_flags_mark_synced($1,$2,$3) m`, [stale.flag_key, stale.flag_tenant_id, stale.rev]);
    ok(m === false, 'mark_synced refuses an outdated rev');
    const t5 = await flagsSyncTick(svc, kv);
    ok(t5.written.includes('agent.post_order') && JSON.parse(kv.map.get('agent.post_order')).enabled === false, 'next tick converges to the latest value', t5);

    // KV write failure (e.g. 429) is retried on the next tick.
    await svc(`update public.feature_flags set enabled = true where key = 'agent.growth.hn'`);
    kv.failNext.add('agent.growth.hn');
    const t6 = await flagsSyncTick(svc, kv);
    ok(t6.failed.includes('agent.growth.hn'), 'failed put reported', t6);
    const t7 = await flagsSyncTick(svc, kv);
    ok(t7.written.includes('agent.growth.hn'), 'failed put retried next tick', t7);

    // Sync bookkeeping does not count as an edit.
    const a = await db.q(`select rev, updated_at from public.feature_flags where key='agent.growth.hn'`);
    await svc(`update public.feature_flags set kv_synced_at = now() where key='agent.growth.hn'`);
    const b = await db.q(`select rev, updated_at from public.feature_flags where key='agent.growth.hn'`);
    ok(String(a.rows[0].rev) === String(b.rows[0].rev) && String(a.rows[0].updated_at) === String(b.rows[0].updated_at), 'kv_* update keeps rev and updated_at');

    // Other tenants get a prefixed key.
    await svc(`insert into public.feature_flags (key, tenant_id, enabled) values ('agent.quote', $1, true)`, [T2]);
    const t8 = await flagsSyncTick(svc, kv);
    ok(t8.written.includes(`t:${T2}:agent.quote`), 'tenant key prefixed t:<tenant>:<key>', t8);
  });

  await section('feature_flags: shared KV vectors (vectors/flags-sync.json), reference tick', async () => {
    await runFlagVectors(async (title, fn) => { await fn(); }, ok);
  });

  await section('feature_flags: constraints and immutability', async () => {
    await as(db, who.service, async () => {
      await rejects(() => db.q(`insert into public.feature_flags (key) values ('Agent.Quote')`), /feature_flags_key_check/, 'key format');
      await rejects(() => db.q(`insert into public.feature_flags (key, value) values ('x.y','[]')`), /feature_flags_value_check/, 'value must be an object');
      await rejects(() => db.q(`insert into public.feature_flags (key, value) values ('x.z','{"mode":"yolo"}')`), /feature_flags_mode_check/, 'mode enum');
      await rejects(() => db.q(`insert into public.feature_flags (key, value) values ('x.w','{"mode":null}')`), /feature_flags_mode_check/, 'mode null');
      await rejects(() => db.q(`delete from public.feature_flags where key='agent.quote'`), /not deleted/, 'delete blocked');
      await rejects(() => db.q(`truncate public.feature_flags`), /not deleted/, 'truncate blocked');
      await rejects(() => db.q(`update public.feature_flags set key='agent.quote2' where key='agent.quote' and tenant_id='${T1}'`), /immutable/, 'key immutable');
      const r0 = await db.q(`select rev from public.feature_flags where key='seo.strict_404'`);
      await db.q(`update public.feature_flags set rev = 1 where key='seo.strict_404'`);
      const r1 = await db.q(`select rev from public.feature_flags where key='seo.strict_404'`);
      ok(String(r0.rows[0].rev) === String(r1.rows[0].rev), 'rev cannot be set by callers');
    });
  });

  // ---- agent_runs ---------------------------------------------------------------------
  await section('agent_runs: begin is idempotent; approval token is single use', async () => {
    await as(db, who.service, async () => {
      const a = await db.q(`select * from public.agent_run_begin('quote','workflow','rfq-x:v1','{"workflow_name":"quote","workflow_instance_id":"quote-x-v1"}')`);
      const b = await db.q(`select * from public.agent_run_begin('quote','workflow','rfq-x:v1')`);
      ok(a.rows[0].created === true && b.rows[0].created === false && a.rows[0].run_id === b.rows[0].run_id, 'second begin returns the same run', [a.rows, b.rows]);
      const id = a.rows[0].run_id;
      await rejects(() => db.q(`select * from public.agent_run_begin('quote','sms','k')`), /agent_runs_trigger_check/, 'trigger enum');
      await rejects(() => db.q(`update public.agent_runs set status='succeeded' where id=$1`, [id]), /agent_runs_finished_check/, 'final status needs finished_at');
      await rejects(() => db.q(`update public.agent_runs set approval_token_sha256=$2 where id=$1`, [id, HEX_D]), /agent_runs_token_check/, 'token only while waiting_human');
      await db.q(`update public.agent_runs set status='waiting_human', approval_token_sha256=$2 where id=$1`, [id, HEX_D]);
      const wrong = await db.q(`select * from public.agent_run_claim_approval($1,'{}')`, [HEX_C]);
      ok(wrong.rows.length === 0, 'unknown token claims nothing');
      const c1 = await db.q(`select * from public.agent_run_claim_approval($1,'{"channel":"telegram","verb":"approve"}')`, [HEX_D]);
      const c2 = await db.q(`select * from public.agent_run_claim_approval($1,'{"channel":"dashboard","verb":"approve"}')`, [HEX_D]);
      ok(c1.rows.length === 1 && c1.rows[0].workflow_instance_id === 'quote-x-v1' && c2.rows.length === 0, 'first claim wins, second finds nothing', [c1.rows, c2.rows]);
      const h = await db.q(`select status, human_action from public.agent_runs where id=$1`, [id]);
      ok(h.rows[0].status === 'running' && h.rows[0].human_action.verb === 'approve' && /Z$/.test(h.rows[0].human_action.decided_at), 'human_action recorded', h.rows[0]);
      await rejects(() => db.q(`select * from public.agent_run_begin('quote','workflow','k2','{"workflow_instance_id":"bad id!"}')`), /agent_runs_instance_check/, 'instance id format');
      await rejects(() => db.q(`select * from public.agent_run_begin('quote','workflow','k3',$1)`, [JSON.stringify({ workflow_instance_id: 'q'.repeat(101) })]), /agent_runs_instance_check/, 'instance id length');
      await rejects(() => db.q(`select * from public.agent_run_begin('Quote','cron','k4')`), /agent_runs_agent_check/, 'agent format');
    });
  });

  // ---- create_email_rfq ------------------------------------------------------------------
  await section('create_email_rfq: exactly once, customer match by e-mail', async () => {
    await as(db, who.service, async () => {
      await db.q(`insert into public.inbound_emails (id, message_id, message_id_sha256, mailbox, from_email, received_at)
                  values ('a3000000-0000-4000-8000-000000000002','<m2@example.test>',$1,'rfq','Buyer@New.example', now())`, [HEX_B]);
      const payload = JSON.stringify({ company_name: 'New Buyer AG', contact_email: 'Buyer@New.example', parts: [{ name: 'Bracket', quantity: 4 }] });
      const a = await db.q(`select * from public.create_email_rfq('a3000000-0000-4000-8000-000000000002', $1, 'email')`, [payload]);
      const b = await db.q(`select * from public.create_email_rfq('a3000000-0000-4000-8000-000000000002', $1, 'email')`, [payload]);
      ok(a.rows[0].rfq_id === b.rows[0].rfq_id && /^RFQ-\d{8}-\d+$/.test(a.rows[0].rfq_number), 'same RFQ on retry', [a.rows, b.rows]);
      const r = await db.q(`select source, inbound_email_id, status, parts_details from public.rfqs where id=$1`, [a.rows[0].rfq_id]);
      ok(r.rows[0].source === 'email' && r.rows[0].inbound_email_id === 'a3000000-0000-4000-8000-000000000002' && r.rows[0].status === 'draft', 'rfq marked as email', r.rows[0]);
      const ie = await db.q(`select status, rfq_id, customer_id from public.inbound_emails where id='a3000000-0000-4000-8000-000000000002'`);
      ok(ie.rows[0].status === 'rfq_created' && ie.rows[0].customer_id === a.rows[0].customer_id, 'inbound row linked', ie.rows[0]);
      const n = await db.q(`select count(*)::int n from public.rfqs where inbound_email_id='a3000000-0000-4000-8000-000000000002'`);
      ok(n.rows[0].n === 1, 'one RFQ row only');
      // existing customer matched case-insensitively
      await db.q(`insert into public.inbound_emails (id, message_id, message_id_sha256, mailbox, from_email, received_at)
                  values ('a3000000-0000-4000-8000-000000000003','<m3@example.test>',$1,'rfq','CUST@example.test', now())`, [HEX_C]);
      const c = await db.q(`select * from public.create_email_rfq('a3000000-0000-4000-8000-000000000003', $1, 'techpilot')`,
        [JSON.stringify({ company_name: 'Cust GmbH', contact_email: 'CUST@example.test' })]);
      ok(c.rows[0].customer_id === 'c0000000-0000-4000-8000-000000000001', 'existing customer reused', c.rows);
      await rejects(() => db.q(`select * from public.create_email_rfq('a3000000-0000-4000-8000-000000000003', '{}', 'web')`), /source must be/, 'source enum');
      await rejects(() => db.q(`select * from public.create_email_rfq(gen_random_uuid(), '{}', 'email')`), /not found/, 'unknown e-mail');
      await db.q(`insert into public.inbound_emails (id, message_id, message_id_sha256, mailbox, from_email, received_at)
                  values ('a3000000-0000-4000-8000-000000000004','<m4@example.test>',$1,'rfq','x@example.test', now())`, [sha('e')]);
      await rejects(() => db.q(`select * from public.create_email_rfq('a3000000-0000-4000-8000-000000000004', '{"contact_email":"x@example.test"}', 'email')`), /company_name is required/, 'company required');
      const ie4 = await db.q(`select status, rfq_id from public.inbound_emails where id='a3000000-0000-4000-8000-000000000004'`);
      ok(ie4.rows[0].status === 'received' && ie4.rows[0].rfq_id === null, 'failed call leaves the row unchanged', ie4.rows[0]);
    });
  });

  // ---- agent columns guard -----------------------------------------------------------------
  await section('agent columns: only the service role and definer functions set them', async () => {
    const CUST = 'c0000000-0000-4000-8000-000000000001';
    await as(db, who.customer, async () => {
      const r = await db.q(`insert into public.rfqs (company_name, customer_id) values ('Cust GmbH', $1) returning id, source`, [CUST]);
      ok(r.rows[0].source === 'web', 'customer insert defaults to web');
      await rejects(() => db.q(`insert into public.rfqs (company_name, customer_id, source) values ('C', $1, 'email')`, [CUST]), /agent layer only/, 'customer cannot set source');
      await rejects(() => db.q(`insert into public.rfqs (company_name, customer_id, source) values ('C', $1, 'manual')`, [CUST]), /staff only/, 'customer cannot set manual');
      const u = await db.q(`update public.rfqs set title = 'renamed' where id = $1`, [RFQ1]);
      ok(u.count === 1, 'customer may still update other columns', u.count);
      await rejects(() => db.q(`update public.rfqs set source = 'techpilot' where id = $1`, [RFQ1]), /agent layer only/, 'customer cannot change source');
      await rejects(() => db.q(`update public.rfqs set inbound_email_id = 'a3000000-0000-4000-8000-000000000001' where id = $1`, [RFQ1]), /agent layer only/, 'customer cannot link inbound e-mail');
      const f = await db.q(`insert into public.rfq_files (rfq_id, file_name, file_path, file_type, file_size) values ($1,'a.step','RFQ-01102026-1/a.step','model/step',10) returning id, source`, [RFQ1]);
      ok(f.rows[0].source === 'web', 'customer file insert defaults to web');
      await rejects(() => db.q(`insert into public.rfq_files (rfq_id, file_name, file_path, file_type, file_size, sha256) values ($1,'b','b','x',1,$2)`, [RFQ1, HEX_A]), /agent layer only/, 'customer cannot set sha256');
      const fu = await db.q(`update public.rfq_files set file_name = 'renamed.step' where id = $1`, [f.rows[0].id]);
      ok(fu.count === 0, 'a customer updates no rfq_files rows (no UPDATE policy for customers): 0 rows', fu.count);
    });
    await as(db, who.admin, async () => {
      const f = await db.q(`select id from public.rfq_files where rfq_id = $1 limit 1`, [RFQ1]);
      await rejects(() => db.q(`update public.rfq_files set sha256 = $2 where id = $1`, [f.rows[0].id, HEX_A]), /agent layer only/, 'staff cannot change sha256');
      await rejects(() => db.q(`update public.rfq_files set source = 'email' where id = $1`, [f.rows[0].id]), /agent layer only/, 'staff cannot change source');
      const fu = await db.q(`update public.rfq_files set file_name = 'renamed.step' where id = $1`, [f.rows[0].id]);
      ok(fu.count === 1, 'staff may rename a file');
    });
    await as(db, who.admin, async () => {
      const r = await db.q(`insert into public.rfqs (company_name, source) values ('Manual Co','manual') returning source`);
      ok(r.rows[0].source === 'manual', 'staff may create manual RFQs');
      await rejects(() => db.q(`insert into public.rfqs (company_name, source) values ('M','techpilot')`), /agent layer only/, 'staff cannot set techpilot');
    });
    await as(db, who.superTen, async () => {
      await rejects(() => db.q(`insert into public.rfqs (company_name, source) values ('S','manual')`), /staff only/, 'tenant super admin is not staff for agent columns');
    });
    await as(db, who.anon, async () => {
      const r = await db.q(`select * from public.create_public_rfq('{"company_name":"Web Co","contact_email":"web@example.test"}')`);
      ok(r.rows.length === 1, 'anon web form (create_public_rfq) unaffected');
    });
    const web = await db.q(`select source from public.rfqs where company_name='Web Co'`);
    ok(web.rows[0].source === 'web', 'web form rows are web');
    await as(db, who.service, async () => {
      const key = `rfq/${RFQ1}/f1-part.step`;
      const a = await db.q(`insert into public.rfq_files (rfq_id, file_name, file_path, file_type, file_size, source, r2_key, sha256, content_type)
                            values ($1,'part.step',$2,'model/step',100,'email',$2,$3,'model/step') on conflict (rfq_id, sha256) do nothing returning id`, [RFQ1, key, HEX_C]);
      const b = await db.q(`insert into public.rfq_files (rfq_id, file_name, file_path, file_type, file_size, source, r2_key, sha256)
                            values ($1,'part.step',$2,'model/step',100,'email',$2,$3) on conflict (rfq_id, sha256) do nothing returning id`, [RFQ1, key, HEX_C]);
      ok(a.rows.length === 1 && b.rows.length === 0, 'same bytes once per RFQ (PostgREST on_conflict=rfq_id,sha256)');
      await rejects(() => db.q(`insert into public.rfq_files (rfq_id, file_name, file_path, file_type, file_size, r2_key) values ($1,'x','x','x',1,'rfq/00000000-0000-4000-8000-000000000000/x')`, [RFQ1]), /rfq_files_r2_key_check/, 'r2_key must sit under its own RFQ prefix');
      await db.q(`insert into public.rfq_files (rfq_id, file_name, file_path, file_type, file_size) values ($1,'n1','n1','x',1),($1,'n2','n2','x',1)`, [RFQ1]);
      passed++; // two NULL sha256 rows coexist
    });
  });

  // ---- quote_workflows / inbound_emails / cad_jobs ------------------------------------------
  await section('quote_workflows: deterministic instance, one active per RFQ', async () => {
    await as(db, who.service, async () => {
      await rejects(() => db.q(`insert into public.quote_workflows (rfq_id, quote_version, workflow_instance_id) values ($1, 2, 'quote-x-v2')`, [RFQ1]), /quote_workflows_instance_check/, 'instance id must match');
      await rejects(() => db.q(`insert into public.quote_workflows (rfq_id, quote_version, workflow_instance_id) values ($1, 2, $2)`, [RFQ1, `quote-${RFQ1}-v2`]), /quote_workflows_one_active_idx/, 'second active version refused');
      await db.q(`update public.quote_workflows set status='lost', outbound_message_ids = array['<q.1.1@rfq.micronshub.eu>'] where rfq_id=$1 and quote_version=1`, [RFQ1]);
      const v2 = await db.q(`insert into public.quote_workflows (rfq_id, quote_version, workflow_instance_id) values ($1, 2, $2) returning id`, [RFQ1, `quote-${RFQ1}-v2`]);
      ok(v2.rows.length === 1, 'v2 after v1 is final');
      const hit = await db.q(`select quote_version from public.quote_workflows where outbound_message_ids @> array['<q.1.1@rfq.micronshub.eu>']`);
      ok(hit.rows.length === 1 && hit.rows[0].quote_version === 1, 'reply lookup by Message-ID', hit.rows);
      await rejects(() => db.q(`update public.quote_workflows set quote_pdf_r2_key='quotes/x/v2/quote.pdf' where id=$1`, [v2.rows[0].id]), /quote_workflows_pdf_key_check/, 'pdf key format');
      await rejects(() => db.q(`update public.quote_workflows set approved_by='bob' where id=$1`, [v2.rows[0].id]), /quote_workflows_approved_by_check/, 'approved_by format');
    });
  });

  await section('inbound_emails: dedupe and source rules', async () => {
    await as(db, who.service, async () => {
      const d = await db.q(`insert into public.inbound_emails (message_id, message_id_sha256, mailbox, from_email, received_at)
                            values ('<m1@example.test>',$1,'replies','buyer@example.test', now()) on conflict (tenant_id, message_id_sha256) do nothing returning id`, [HEX_A]);
      ok(d.rows.length === 0, 'duplicate delivery stops (M4)');
      await rejects(() => db.q(`insert into public.inbound_emails (message_id, message_id_sha256, mailbox, source, sender_account_id, from_email, received_at)
                                values ('<g>',$1,'rfq','gmail_poller','70000000-0000-4000-8000-000000000001','a@b', now())`, [sha('1')]), /inbound_emails_source_mailbox_check/, 'gmail source needs mailbox gmail');
      await rejects(() => db.q(`insert into public.inbound_emails (message_id, message_id_sha256, mailbox, source, from_email, received_at) values ('<g>',$1,'gmail','gmail_poller','a@b', now())`, [sha('2')]), /inbound_emails_gmail_account_check/, 'gmail needs sender account');
      const g = await db.q(`insert into public.inbound_emails (message_id, message_id_sha256, mailbox, source, sender_account_id, from_email, received_at)
                            values ('<g>',$1,'gmail','gmail_poller','70000000-0000-4000-8000-000000000001','a@b', now()) returning id`, [sha('3')]);
      ok(g.rows.length === 1, 'gmail row accepted');
      await rejects(() => db.q(`insert into public.inbound_emails (message_id, message_id_sha256, mailbox, from_email, received_at, raw_r2_key) values ('<r>',$1,'rfq','a@b', now(), 'email/x/raw.eml')`, [sha('4')]), /inbound_emails_raw_key_check/, 'raw key format');
      await rejects(() => db.q(`insert into public.inbound_emails (message_id, message_id_sha256, mailbox, from_email, received_at) values ('<r>','ABC','rfq','a@b', now())`), /inbound_emails_sha_check/, 'sha format');
    });
  });

  await section('cad_jobs: idempotency key and reuse', async () => {
    await as(db, who.service, async () => {
      const key = `${HEX_B}:analyse:${HEX_C}`;
      const dup = await db.q(`insert into public.cad_jobs (rfq_id, idempotency_key, job_type, input_r2_key, input_sha256)
                              values ($1,$2,'analyse','rfq/x',$3) on conflict (rfq_id, idempotency_key) do nothing returning id`, [RFQ1, key, HEX_B]);
      ok(dup.rows.length === 0, 'same job for the same RFQ is not queued twice');
      await db.q(`insert into public.cad_jobs (idempotency_key, job_type, input_r2_key, input_sha256) values ($1,'analyse','rfq/x',$2)`, [key, HEX_B]);
      await rejects(() => db.q(`insert into public.cad_jobs (idempotency_key, job_type, input_r2_key, input_sha256) values ($1,'analyse','rfq/x',$2)`, [key, HEX_B]), /cad_jobs_idem_key/, 'jobs without RFQ dedupe too (NULLS NOT DISTINCT)');
      await rejects(() => db.q(`insert into public.cad_jobs (idempotency_key, job_type, input_r2_key, input_sha256) values ($1,'flat_dxf','rfq/x',$2)`, [key, HEX_B]), /cad_jobs_idem_check/, 'key must match job_type');
      await rejects(() => db.q(`insert into public.cad_jobs (idempotency_key, job_type, input_r2_key, input_sha256) values ('k','analyse','rfq/x',$1)`, [HEX_B]), /cad_jobs_idem_check/, 'key format');
      await db.q(`update public.cad_jobs set status='succeeded' where rfq_id=$1`, [RFQ1]);
      const reuse = await db.q(`select count(*)::int n from public.cad_jobs where idempotency_key=$1 and status='succeeded'`, [key]);
      ok(reuse.rows[0].n === 1, 'succeeded twin found for reuse');
    });
  });

  // ---- stock -----------------------------------------------------------------------------
  await section('stock_hold / commit / release: idempotent and atomic', async () => {
    await as(db, who.service, async () => {
      const holds = JSON.stringify([{ stock_item_id: SI1, area_mm2: 1200000 }, { quantity: 2 }]);
      const by = [T1, MAT1].join(':');
      const a = await db.q(`select * from public.stock_hold($1,$2,$3::jsonb, now() + interval '14 days', $4)`, [OI1, MAT1, holds, by]);
      ok(a.rows.length === 2 && a.rows.every((r) => r.status === 'held' && r.order_id === 'b0000000-0000-4000-8000-000000000001'), 'two holds, order derived', a.rows);
      const txn = await db.q(`select transaction_type::text t, area_change_mm2::float a, reference_type, reference_id from public.stock_transactions where reference_id=$1`, [OI1]);
      ok(txn.rows.length === 1 && txn.rows[0].t === 'reserve' && txn.rows[0].a === -1200000 && txn.rows[0].reference_type === 'order_item', 'one reserve transaction for the stock-item hold', txn.rows);
      const b = await db.q(`select * from public.stock_hold($1,$2,$3::jsonb, now() + interval '14 days', $4)`, [OI1, MAT1, holds, by]);
      const txn2 = await db.q(`select count(*)::int n from public.stock_transactions where reference_id=$1`, [OI1]);
      ok(b.rows.length === 2 && txn2.rows[0].n === 1, 'retry returns the same holds, writes nothing', [b.rows.length, txn2.rows]);
      const remaining = await db.q(`select remaining_area_mm2::float r from public.stock_items where id=$1`, [SI1]);
      ok(remaining.rows[0].r === 4500000, 'stock_items.remaining unchanged by a hold', remaining.rows);
      await rejects(() => db.q(`insert into public.stock_reservations (order_item_id, order_id, material_id, stock_item_id, area_mm2, expires_at)
                                values ($1,'b0000000-0000-4000-8000-000000000001',$2,$3,1,now()+interval '1 day')`, [OI1, MAT1, SI1]), /stock_reservations_item_active_idx/, 'second active hold on the same sheet refused');
      await rejects(() => db.q(`select * from public.stock_hold($1,$2,$3::jsonb, now() + interval '1 day')`, ['d0000000-0000-4000-8000-000000000009', MAT1, holds]), /order item .* not found/, 'unknown order item');
      await rejects(() => db.q(`select * from public.stock_release($1,'manual')`, [OI2]).then(() => db.q(`select * from public.stock_hold($1,$2,$3::jsonb, now() + interval '1 day')`, [OI2, MAT1, JSON.stringify([{ stock_item_id: SI2, area_mm2: 1 }])])), /does not belong to material/, 'stock item of another material refused');
      await rejects(() => db.q(`select * from public.stock_hold($1,$2,'[{"quantity":1}]'::jsonb, now() - interval '1 day')`, [OI2, MAT1]), /expires_at/, 'expiry in the past refused');

      const c = await db.q(`select * from public.stock_commit($1,$2)`, [OI1, NS1]);
      ok(c.rows.length === 2 && c.rows.every((r) => r.status === 'committed' && r.expires_at === null), 'commit moves holds to committed', c.rows);
      const c2 = await db.q(`select * from public.stock_commit($1,$2)`, [OI1, NS1]);
      ok(c2.rows.length === 2, 'commit to the same session is a no-op');
      await rejects(() => db.q(`select * from public.stock_commit($1,$2)`, [OI1, NS2]), /another nesting session/, 'commit to another session refused');

      const rel = await db.q(`select * from public.stock_release($1,'consumed')`, [OI1]);
      ok(rel.rows.length === 2 && rel.rows.every((r) => r.status === 'released' && r.release_reason === 'consumed'), 'release', rel.rows);
      const un = await db.q(`select area_change_mm2::float a from public.stock_transactions where reference_id=$1 and transaction_type='unreserve'`, [OI1]);
      ok(un.rows.length === 1 && un.rows[0].a === 1200000, 'one unreserve transaction', un.rows);
      const rel2 = await db.q(`select * from public.stock_release($1,'consumed')`, [OI1]);
      ok(rel2.rows.length === 0, 'second release is a no-op');
      const again = await db.q(`select * from public.stock_hold($1,$2,$3::jsonb, now() + interval '14 days')`, [OI1, MAT1, holds]);
      ok(again.rows.length === 2 && again.rows.every((r) => r.status === 'held'), 'new holds allowed after release');
      await rejects(() => db.q(`update public.stock_reservations set expires_at = null where order_item_id=$1 and status='held'`, [OI1]), /stock_reservations_held_check/, 'held needs expires_at');
      await rejects(() => db.q(`select * from public.stock_release($1,'lost')`, [OI1]), /unknown reason/, 'release reason enum');
    });
  });

  // ---- amendments AM-1…AM-5 (PHASE4_SPEC.md §4.13) -------------------------------------------
  await section('AM-1 cad_jobs.backend: inline, vps, container, mac_mini or NULL', async () => {
    await as(db, who.service, async () => {
      const ins = (n, backend) => db.q(`insert into public.cad_jobs (idempotency_key, job_type, input_r2_key, input_sha256, backend)
                                          values ($1,'analyse','rfq/x',$2,$3) returning backend`, [`${HEX_D}:analyse:${sha(n)}`, HEX_D, backend]);
      const inline = await ins('1', 'inline');
      ok(inline.rows[0].backend === 'inline', 'backend inline accepted', inline.rows);
      const queued = await ins('2', null);
      ok(queued.rows[0].backend === null, 'backend NULL accepted (queued job)', queued.rows);
      for (const [n, b] of [['3', 'vps'], ['4', 'container'], ['5', 'mac_mini']]) {
        const r = await ins(n, b);
        ok(r.rows[0].backend === b, `backend ${b} accepted`, r.rows);
      }
      await rejects(() => ins('6', 'other'), /cad_jobs_backend_check/, 'unknown backend refused');
      await rejects(() => ins('7', 'Inline'), /cad_jobs_backend_check/, 'backend is case-sensitive');
      await rejects(() => db.q(`update public.cad_jobs set backend = '' where input_sha256 = $1`, [HEX_D]), /cad_jobs_backend_check/, 'empty backend refused');
      const def = await db.q(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'cad_jobs_backend_check'`);
      ok(/'inline'/.test(def.rows[0].d), 'CHECK list carries inline', def.rows[0]);
    });
  });

  await section('AM-2 quote_workflows.drafts and pdf_sha256', async () => {
    const drafts = { subject: 'Angebot RFQ-01102026-1', body_text: 'Guten Tag,\nanbei unser Angebot.', follow_ups: [{ k: 1, body_text: 'Nachfrage' }] };
    await as(db, who.service, async () => {
      await db.q(`update public.quote_workflows set drafts = $2::jsonb, pdf_sha256 = $3 where id = $1`, [QW1, JSON.stringify(drafts), HEX_A]);
      const r = await db.q(`select drafts, pdf_sha256 from public.quote_workflows where id = $1`, [QW1]);
      ok(JSON.stringify(r.rows[0].drafts) === JSON.stringify(drafts) && r.rows[0].pdf_sha256 === HEX_A, 'object drafts and hex hash stored', r.rows[0]);
      await rejects(() => db.q(`update public.quote_workflows set drafts = '[]' where id = $1`, [QW1]), /quote_workflows_drafts_check/, 'drafts must be an object (array refused)');
      await rejects(() => db.q(`update public.quote_workflows set drafts = '"text"' where id = $1`, [QW1]), /quote_workflows_drafts_check/, 'drafts must be an object (string refused)');
      await rejects(() => db.q(`update public.quote_workflows set drafts = $2::jsonb where id = $1`, [QW1, JSON.stringify({ body_text: noise(70000) })]), /quote_workflows_drafts_check/, 'drafts over 64 KiB refused');
      const near = await db.q(`update public.quote_workflows set drafts = $2::jsonb where id = $1 returning pg_column_size(drafts) s`, [QW1, JSON.stringify({ body_text: noise(60000) })]);
      ok(near.rows[0].s <= 65536, 'drafts under 64 KiB accepted', near.rows[0]);
      await rejects(() => db.q(`update public.quote_workflows set pdf_sha256 = $2 where id = $1`, [QW1, HEX_A.toUpperCase()]), /quote_workflows_pdf_sha256_check/, 'pdf_sha256 is lower-case hex');
      await rejects(() => db.q(`update public.quote_workflows set pdf_sha256 = 'abc' where id = $1`, [QW1]), /quote_workflows_pdf_sha256_check/, 'pdf_sha256 is 64 hex characters');
      const cleared = await db.q(`update public.quote_workflows set drafts = null, pdf_sha256 = null where id = $1 returning drafts, pdf_sha256`, [QW1]);
      ok(cleared.rows[0].drafts === null && cleared.rows[0].pdf_sha256 === null, 'both columns nullable', cleared.rows[0]);
      await db.q(`update public.quote_workflows set drafts = $2::jsonb, pdf_sha256 = $3 where id = $1`, [QW1, JSON.stringify(drafts), HEX_A]);
    });
    await as(db, who.sales, async () => {
      const r = await db.q(`select drafts, pdf_sha256 from public.quote_workflows where id = $1`, [QW1]);
      ok(r.rows.length === 1 && r.rows[0].drafts.subject === drafts.subject && r.rows[0].pdf_sha256 === HEX_A, 'staff read drafts and pdf_sha256', r.rows);
      await rejects(() => db.q(`update public.quote_workflows set drafts = '{}' where id = $1`, [QW1]), /permission denied/, 'staff cannot write drafts');
      await rejects(() => db.q(`update public.quote_workflows set pdf_sha256 = $2 where id = $1`, [QW1, HEX_B]), /permission denied/, 'staff cannot write pdf_sha256');
    });
    await as(db, who.customer, async () => {
      const r = await db.q(`select drafts from public.quote_workflows where id = $1`, [QW1]);
      ok(r.rows.length === 0, 'customer reads no drafts', r.rows);
      await rejects(() => db.q(`update public.quote_workflows set drafts = '{}' where id = $1`, [QW1]), /permission denied/, 'customer cannot write drafts');
    });
  });

  await section('AM-3 agent_runs.parked_reason: parked runs, failure cards, claim clears it', async () => {
    await as(db, who.service, async () => {
      const begin = async (key) => (await db.q(`select * from public.agent_run_begin('quote','workflow',$1)`, [key])).rows[0].run_id;
      const park = (id, reason, token = null) => db.q(`update public.agent_runs set status = 'waiting_human', parked_reason = $2, approval_token_sha256 = $3 where id = $1`, [id, reason, token]);
      const row = async (id) => (await db.q(`select status, parked_reason, approval_token_sha256 t, error, human_action, finished_at from public.agent_runs where id = $1`, [id])).rows[0];

      // CHECK vectors
      const v = await begin('am3-vectors');
      for (const reason of ['flag_off', 'budget', 'llm_unavailable', 'failed']) {
        await park(v, reason);
        ok((await row(v)).parked_reason === reason, `parked_reason ${reason} accepted on a waiting_human run`);
      }
      await rejects(() => park(v, 'daily_cap'), /agent_runs_parked_reason_check/, 'unknown parked_reason refused');
      await rejects(() => park(v, ''), /agent_runs_parked_reason_check/, 'empty parked_reason refused');
      await rejects(() => db.q(`update public.agent_runs set status = 'running' where id = $1`, [v]), /agent_runs_parked_status_check/, 'resuming must clear parked_reason');
      await rejects(() => db.q(`update public.agent_runs set status = 'succeeded', finished_at = now() where id = $1`, [v]), /agent_runs_parked_status_check/, 'parked_reason on a succeeded row refused');
      const fresh = await begin('am3-running');
      await rejects(() => db.q(`update public.agent_runs set parked_reason = 'budget' where id = $1`, [fresh]), /agent_runs_parked_status_check/, 'parked_reason on a running row refused');
      await db.q(`update public.agent_runs set status = 'running', parked_reason = null where id = $1`, [v]);
      ok((await row(v)).status === 'running', 'resume (running, parked_reason NULL) accepted');
      await db.q(`update public.agent_runs set status = 'succeeded', finished_at = now() where id = $1`, [v]);

      // A parked run without a token is not decidable: no claim reaches it.
      const parked = await begin('am3-budget');
      await park(parked, 'budget');
      const none = await db.q(`select * from public.agent_run_claim_approval($1, '{}')`, [sha('7')]);
      ok(none.rows.length === 0, 'no claim reaches a parked run without a token');
      const p = await row(parked);
      ok(p.status === 'waiting_human' && p.parked_reason === 'budget', 'parked run unchanged', p);
      const found = await db.q(`select id from public.agent_runs where status = 'waiting_human' and parked_reason = 'budget'`);
      ok(found.rows.some((r) => r.id === parked), 'dispatcher lookup by (status, parked_reason) finds it');

      // A run behind a failure card: waiting_human, parked_reason 'failed', token -> claimable once, claim clears it.
      const failed = await begin('am3-failed');
      const tok = sha('8');
      await db.q(`update public.agent_runs set status = 'waiting_human', parked_reason = 'failed', error = 'pricing: timeout', approval_token_sha256 = $2,
                    output = $3::jsonb where id = $1`,
        [failed, tok, JSON.stringify({ card_kind: 'failure', allowed_verbs: ['retry', 'dismiss'], failed_step: 'price' })]);
      const c1 = await db.q(`select * from public.agent_run_claim_approval($1, '{"channel":"dashboard","actor":"user:${U.admin}","verb":"retry"}')`, [tok]);
      const c2 = await db.q(`select * from public.agent_run_claim_approval($1, '{"channel":"telegram","verb":"dismiss"}')`, [tok]);
      ok(c1.rows.length === 1 && c1.rows[0].run_id === failed && c1.rows[0].output.card_kind === 'failure' && c1.rows[0].output.failed_step === 'price',
        'a failed park with a token is claimable', c1.rows);
      ok(c2.rows.length === 0, 'a failed park is claimable once', c2.rows);
      const f = await row(failed);
      ok(f.status === 'running' && f.parked_reason === null && f.t === null && f.error === 'pricing: timeout' && f.human_action.verb === 'retry',
        'claim sets running, clears parked_reason and the token, keeps error', f);

      // Any parked run that carries a token is cleared by its claim.
      const flagOff = await begin('am3-flag-off');
      await park(flagOff, 'flag_off', sha('9'));
      const c3 = await db.q(`select * from public.agent_run_claim_approval($1, '{}')`, [sha('9')]);
      const fo = await row(flagOff);
      ok(c3.rows.length === 1 && fo.status === 'running' && fo.parked_reason === null, 'claim clears parked_reason flag_off', fo);

      const idx = await db.q(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'agent_runs_parked_idx'`);
      ok(idx.rows.length === 1 && /\(status, parked_reason\)/.test(idx.rows[0].indexdef) && /WHERE \(parked_reason IS NOT NULL\)/.test(idx.rows[0].indexdef),
        'partial index agent_runs_parked_idx (status, parked_reason)', idx.rows);
    });
  });

  await section('AM-3 exit gate 4 query (PHASE4_SPEC.md §10) runs on the final schema', async () => {
    await as(db, who.service, async () => {
      await db.exec(`
        INSERT INTO public.agent_runs (agent, trigger, idempotency_key, status, llm_calls, cost_cents, finished_at) VALUES
          ('eval','manual','g4-cost-ok','succeeded',2,1.5,now()), ('eval','manual','g4-cost-missing','succeeded',2,0,now());
        INSERT INTO public.agent_runs (agent, trigger, idempotency_key, status, approval_token_sha256, parked_reason) VALUES
          ('eval','manual','g4-card','waiting_human','${sha('6')}',null), ('eval','manual','g4-parked','waiting_human',null,'budget'),
          ('eval','manual','g4-orphan','waiting_human',null,null);
        INSERT INTO public.agent_runs (agent, trigger, idempotency_key, status, started_at) VALUES
          ('eval','manual','g4-stuck','running', now() - interval '2 hours');
      `);
      const r = await db.q(`select agent, status, count(*) as runs,
          count(*) filter (where llm_calls > 0 and cost_cents = 0) as llm_runs_without_cost,
          count(*) filter (where status = 'running' and coalesce((human_action->>'decided_at')::timestamptz, started_at) < now() - interval '1 hour') as stuck_running,
          count(*) filter (where status = 'waiting_human' and approval_token_sha256 is null and parked_reason is null) as waiting_without_card
        from agent_runs where started_at > now() - interval '1 day' group by 1, 2`);
      const byStatus = Object.fromEntries(r.rows.filter((x) => x.agent === 'eval').map((x) => [x.status, x]));
      ok(Number(byStatus.succeeded.llm_runs_without_cost) === 1, 'llm run without cost counted', byStatus.succeeded);
      ok(Number(byStatus.waiting_human.waiting_without_card) === 1 && Number(byStatus.waiting_human.runs) === 3, 'only the waiting run without card or park reason counted', byStatus.waiting_human);
      ok(Number(byStatus.running.stuck_running) === 1, 'stuck running run counted', byStatus.running);
    });
  });

  await section('AM-4 create_order_from_quote: the portal Accept Quote in one transaction, idempotent per RFQ', async () => {
    const CUST = 'c0000000-0000-4000-8000-000000000001';
    const R = { a: 'a0000000-0000-4000-8000-0000000000f1', b: 'a0000000-0000-4000-8000-0000000000f2',
                c: 'a0000000-0000-4000-8000-0000000000f3', d: 'a0000000-0000-4000-8000-0000000000f4' };
    const Q = { a1: 'a2000000-0000-4000-8000-0000000000f1', b1: 'a2000000-0000-4000-8000-0000000000f2',
                c1: 'a2000000-0000-4000-8000-0000000000f3', d1: 'a2000000-0000-4000-8000-0000000000f4',
                a2: 'a2000000-0000-4000-8000-0000000000f5' };
    const partsA = [
      { product_name: 'Part 1 RFQ-05102026-7-1', description: 'Bracket, S235, 2 mm', quantity: 10, unit_price: 12.5, total_price: 125 },
      { product_name: 'Part 2 RFQ-05102026-7-2', description: 'Cover, AlMg3, 3 mm', quantity: 4, unit_price: 11.375, total_price: 45.5 },
    ];
    const partsB = [   // sparse parts: the portal's fallbacks apply
      { description: 'no name, no numbers' },
      { product_name: null, description: null, quantity: null, unit_price: null, total_price: null },
      { product_name: 'Part 3', quantity: 2, unit_price: '', total_price: 7 },
    ];
    const call = (q) => db.q(`select * from public.create_order_from_quote($1)`, [q]);
    await as(db, who.service, async () => {
      await db.q(`insert into public.rfqs (id, company_name, customer_id, rfq_number, parts_details, shipping_cost, currency, tenant_id) values
          ($1,'Cust GmbH',$5,'RFQ-05102026-7',$6::jsonb,20,'EUR',$9),
          ($2,'Cust GmbH',$5,'RFQ-05102026-8',$7::jsonb,null,null,$9),
          ($3,'Cust GmbH',$5,'RFQ-05102026-9','[]'::jsonb,15.5,'GBP',$10),
          ($4,'Cust GmbH',$5,'RFQ-05102026-10',$8::jsonb,0,'EUR',$9)`,
        [R.a, R.b, R.c, R.d, CUST, JSON.stringify(partsA), JSON.stringify(partsB), JSON.stringify(partsA), T1, T2]);
      for (const [q, r] of [[Q.a1, R.a], [Q.b1, R.b], [Q.c1, R.c], [Q.d1, R.d]]) {
        await db.q(`insert into public.quote_workflows (id, rfq_id, workflow_instance_id, status) values ($1,$2,$3,'sent')`, [q, r, `quote-${r}-v1`]);
      }

      // First call creates, second call returns the same order without writing.
      const a1 = (await call(Q.a1)).rows[0];
      const a2 = (await call(Q.a1)).rows[0];
      ok(a1.created === true && a2.created === false && a1.order_id === a2.order_id && a1.po_number === a2.po_number, 'idempotent second call', [a1, a2]);
      const today = (await db.q(`select to_char(now(), 'DDMMYYYY') d`)).rows[0].d;
      ok(new RegExp(`^PO-${today}-\\d+$`).test(a1.po_number), 'PO number from next_po_number()', a1);
      const o = (await db.q(`select customer_id, rfq_id, status, total_amount::float t, currency, title, po_number, from_rfq_number, tenant_id,
                                    start_date > now() - interval '1 minute' fresh, delivery_date - start_date = interval '14 days' d14
                               from public.orders where rfq_id = $1`, [R.a])).rows;
      ok(o.length === 1, 'one order for the RFQ', o);
      ok(o[0].customer_id === CUST && o[0].status === 'new' && o[0].title === a1.po_number && o[0].po_number === a1.po_number
         && o[0].from_rfq_number === 'RFQ-05102026-7' && o[0].tenant_id === T1 && o[0].fresh && o[0].d14, 'order row as the portal writes it', o[0]);
      ok(Math.abs(o[0].t - portalTotal(partsA, 20)) < 1e-6 && o[0].t === 236.22, 'total = (sum of part totals + shipping) * 1.24, as the portal', [o[0].t, portalTotal(partsA, 20)]);
      ok(o[0].currency === 'EUR', 'currency set explicitly (the orders default is USD)', o[0].currency);
      const items = (await db.q(`select product_name, description, quantity, unit_price::float u, total_price::float t, tenant_id
                                   from public.order_items where order_id = $1 order by product_name`, [a1.order_id])).rows;
      ok(JSON.stringify(items) === JSON.stringify(partsA.map((p) => ({ product_name: p.product_name, description: p.description,
        quantity: p.quantity, u: p.unit_price, t: p.total_price, tenant_id: T1 }))), 'one order item per part', items);
      const st = (await db.q(`select status from public.rfqs where id = $1`, [R.a])).rows[0];
      ok(st.status === 'approved', 'rfqs.status approved', st);

      // A new quote version of the same RFQ finds the same order (idempotent per RFQ).
      await db.q(`update public.quote_workflows set status = 'won' where id = $1`, [Q.a1]);
      await db.q(`insert into public.quote_workflows (id, rfq_id, quote_version, workflow_instance_id, status) values ($1,$2,2,$3,'sent')`, [Q.a2, R.a, `quote-${R.a}-v2`]);
      const a3 = (await call(Q.a2)).rows[0];
      const n = (await db.q(`select (select count(*)::int from public.orders where rfq_id = $1) o,
                                    (select count(*)::int from public.order_items where order_id = $2) i`, [R.a, a1.order_id])).rows[0];
      ok(a3.created === false && a3.order_id === a1.order_id && n.o === 1 && n.i === 2, 'second quote version of the RFQ: same order, nothing written', [a3, n]);

      // Sparse parts and a NULL currency / shipping.
      const b1 = (await call(Q.b1)).rows[0];
      const ob = (await db.q(`select total_amount::float t, currency from public.orders where id = $1`, [b1.order_id])).rows[0];
      ok(b1.created === true && ob.currency === 'EUR' && Math.abs(ob.t - portalTotal(partsB, null)) < 1e-6 && ob.t === 8.68, 'NULL currency -> EUR, NULL shipping -> 0', ob);
      const ib = (await db.q(`select product_name, description, quantity, unit_price::float u, total_price::float t from public.order_items
                                where order_id = $1 order by product_name, description`, [b1.order_id])).rows;
      ok(JSON.stringify(ib) === JSON.stringify([
        { product_name: '', description: '', quantity: 0, u: 0, t: 0 },
        { product_name: '', description: 'no name, no numbers', quantity: 0, u: 0, t: 0 },
        { product_name: 'Part 3', description: '', quantity: 2, u: 0, t: 7 },
      ]), "a part without product_name, quantity or prices inserts with '' and 0", ib);

      // Other currency and tenant; no parts -> no items.
      const c1 = (await call(Q.c1)).rows[0];
      const oc = (await db.q(`select total_amount::float t, currency, tenant_id, (select count(*)::int from public.order_items where order_id = o.id) i
                                from public.orders o where o.id = $1`, [c1.order_id])).rows[0];
      ok(oc.currency === 'GBP' && oc.tenant_id === T2 && oc.i === 0 && oc.t === 19.22, 'RFQ currency and tenant kept; no parts -> no items', oc);
      const pos = new Set([a1.po_number, b1.po_number, c1.po_number]);
      ok(pos.size === 3, 'distinct PO numbers', [...pos]);

      // An order the portal already created for the RFQ is returned and nothing is written.
      await db.q(`insert into public.orders (customer_id, rfq_id, status, title, po_number, from_rfq_number, currency)
                  values ($1,$2,'new','PO-portal','PO-portal','RFQ-05102026-10','EUR')`, [CUST, R.d]);
      const d1 = (await call(Q.d1)).rows[0];
      const nd = (await db.q(`select count(*)::int n from public.orders where rfq_id = $1`, [R.d])).rows[0];
      ok(d1.created === false && d1.po_number === 'PO-portal' && nd.n === 1, 'existing portal order returned, created = false', [d1, nd]);

      await rejects(() => call('a2000000-0000-4000-8000-0000000000ff'), /quote workflow .* not found/, 'unknown quote workflow refused');
    });
    for (const w of ['anon', 'customer', 'admin']) {
      await as(db, who[w], async () => {
        await rejects(() => call(Q.a1), /permission denied/, `${w} cannot call create_order_from_quote`);
      });
    }
  });

  await section('AM-5 agent_staff_for_email: staff roles from user_roles only', async () => {
    const call = (e) => db.q(`select user_id, roles from public.agent_staff_for_email($1)`, [e]);
    await as(db, who.service, async () => {
      const a = (await call('admin@example.test')).rows;
      ok(JSON.stringify(a) === JSON.stringify([{ user_id: U.admin, roles: ['admin'] }]), 'staff e-mail -> user_id and roles', a);
      const up = (await call('ADMIN@Example.TEST')).rows;
      ok(up.length === 1 && up[0].user_id === U.admin, 'e-mail match is case-insensitive', up);
      const m = (await call('multi.role@example.test')).rows;
      ok(JSON.stringify(m) === JSON.stringify([{ user_id: U.multi, roles: ['accountant', 'production_manager'] }]), 'several staff roles, sorted, non-staff roles left out', m);
      const s = (await call('sales@example.test')).rows;
      ok(s.length === 1 && JSON.stringify(s[0].roles) === '["sales_rep"]', 'sales_rep is staff', s);
      for (const [label, e] of [['customer', 'cust@example.test'], ['tenant super admin only', 'super@example.test'],
                                ['tenant admin only', 'tenadmin@example.test'], ['partner', 'partner@example.test'],
                                ['unknown address', 'nobody@example.test'], ['empty string', ''], ['NULL', null]]) {
        const r = (await call(e)).rows;
        ok(r.length === 0, `${label}: 0 rows`, r);
      }
    });
    for (const w of ['anon', 'customer', 'admin']) {
      await as(db, who[w], async () => {
        await rejects(() => call('admin@example.test'), /permission denied/, `${w} cannot call agent_staff_for_email`);
      });
    }
  });

  // ---- retention ---------------------------------------------------------------------------
  await section('agent_retention_purge: 90 days / 24 months / 13 months', async () => {
    await as(db, who.service, async () => {
      await db.exec(`
        INSERT INTO public.agent_runs (id, agent, trigger, idempotency_key, status, started_at, finished_at, output) VALUES
          ('a1000000-0000-4000-8000-0000000000a1','quote','workflow','old-1','succeeded', now()-interval '14 months', now()-interval '14 months', '{"x":1}'),
          ('a1000000-0000-4000-8000-0000000000a2','quote','workflow','mid-1','succeeded', now()-interval '100 days', now()-interval '100 days', '{"x":1}'),
          ('a1000000-0000-4000-8000-0000000000a3','quote','workflow','old-open','waiting_human', now()-interval '14 months', null, '{"x":1}');
        INSERT INTO public.agent_runs (agent, trigger, idempotency_key, parent_run_id) VALUES
          ('quote','workflow','child-1','a1000000-0000-4000-8000-0000000000a1');
        INSERT INTO public.inbound_emails (id, message_id, message_id_sha256, mailbox, from_email, received_at, body_excerpt, agent_run_id) VALUES
          ('a3000000-0000-4000-8000-0000000000e1','<o1>','${sha('5')}','rfq','a@b', now()-interval '25 months', 'old', null),
          ('a3000000-0000-4000-8000-0000000000e2','<o2>','${sha('6')}','rfq','a@b', now()-interval '100 days', 'excerpt', 'a1000000-0000-4000-8000-0000000000a1');
        UPDATE public.rfqs SET inbound_email_id = 'a3000000-0000-4000-8000-0000000000e1' WHERE id = '${RFQ1}';
      `);
      const r = await db.q(`select public.agent_retention_purge() p`);
      const p = r.rows[0].p;
      ok(p.emails_deleted === 1 && p.excerpts_cleared === 1 && p.runs_deleted === 1 && p.run_outputs_cleared === 1, 'counts', p);
      const rfq = await db.q(`select inbound_email_id from public.rfqs where id=$1`, [RFQ1]);
      ok(rfq.rows[0].inbound_email_id === null, 'rfqs.inbound_email_id set null when the e-mail row is purged');
      const ie = await db.q(`select body_excerpt, agent_run_id from public.inbound_emails where id='a3000000-0000-4000-8000-0000000000e2'`);
      ok(ie.rows[0].body_excerpt === null && ie.rows[0].agent_run_id === null, 'excerpt cleared, run link set null', ie.rows[0]);
      const child = await db.q(`select parent_run_id from public.agent_runs where idempotency_key='child-1'`);
      ok(child.rows[0].parent_run_id === null, 'child run kept, parent link set null');
      const open = await db.q(`select output from public.agent_runs where id='a1000000-0000-4000-8000-0000000000a3'`);
      ok(open.rows.length === 1 && open.rows[0].output !== null, 'open runs are never purged');
    });
  });

  await section('removal script restores the pre-migration schema', async () => {
    const db2 = await openDb();
    await db2.exec(LIVE);
    await fixtures(db2);
    const s0 = await snapshot(db2);
    await db2.exec(UP);
    await db2.exec(DOWN);
    ok(s0 === await snapshot(db2), 'catalogue identical after up + down');
    const gone = await db2.q(`select to_regprocedure('public.create_order_from_quote(uuid)') a, to_regprocedure('public.agent_staff_for_email(text)') b`);
    ok(gone.rows[0].a === null && gone.rows[0].b === null, 'AM-4 and AM-5 functions removed', gone.rows[0]);
    await db2.close();
  });

  await section('dry run: the file with its final COMMIT replaced by ROLLBACK leaves no trace', async () => {
    const db4 = await openDb();
    await db4.exec(LIVE);
    const s0 = await snapshot(db4);
    const i = UP.lastIndexOf('COMMIT;');
    await db4.exec(UP.slice(0, i) + 'ROLLBACK;' + UP.slice(i + 'COMMIT;'.length));
    const r = await db4.q(`select to_regclass('public.agent_runs') t`);
    ok(r.rows[0].t === null, 'agent_runs absent after the dry run', r.rows[0]);
    ok(s0 === await snapshot(db4), 'catalogue unchanged after the dry run');
    await db4.exec(UP);
    const r2 = await db4.q(`select count(*)::int n from public.feature_flags`);
    ok(r2.rows[0].n === 13, 'the unchanged file applies after a dry run', r2.rows[0]);
    await db4.close();
  });

  await section('preconditions abort without the default tenant or a helper', async () => {
    const db3 = await openDb();
    await db3.exec(LIVE);
    await db3.exec(`delete from public.tenants where id='${T1}'`);
    const s0 = await snapshot(db3);
    await rejects(() => db3.exec(UP), /default tenant/, 'missing default tenant');
    await db3.exec('ROLLBACK').catch(() => {});
    ok(s0 === await snapshot(db3), 'nothing changed');
    await db3.close();
    const db5 = await openDb();
    await db5.exec(LIVE);
    await db5.exec(`drop function public.next_po_number()`);
    const s5 = await snapshot(db5);
    await rejects(() => db5.exec(UP), /helper objects are missing/, 'missing next_po_number()');
    await db5.exec('ROLLBACK').catch(() => {});
    ok(s5 === await snapshot(db5), 'nothing changed');
    await db5.close();
  });

  ok(before !== await snapshot(db), 'sanity: migration changed the catalogue');
  await db.close();
  console.log(`\n${ENGINE}: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(failures.length ? 1 : 0);
}

// =====================================================================================
// RPC parity (PHASE4_SPEC.md §5.1 DB-3): the steps of vectors/rpc.json against the SQL functions (PGlite, service
// role) and against workers/ops/test/helpers/memory-rpc.ts (loaded by Node's TypeScript type stripping); results
// and the listed tables must be equal after normalisation (generated ids by position, timestamps as whole minutes
// from the start of the run, numerics as numbers, object keys unordered).
const MEMORY_RPC_FILE = path.resolve(HERE, '../../../workers/ops/test/helpers/memory-rpc.ts');
const RPC_VECTORS = JSON.parse(fs.readFileSync(path.join(HERE, 'vectors', 'rpc.json'), 'utf8'));
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const KNOWN_IDS = new Set([...JSON.stringify(RPC_VECTORS).matchAll(UUID_G)].map((m) => m[0]).concat([T1, T2]));
const ARG_TYPES = {
  p_key: 'text', p_tenant_id: 'uuid', p_kv: 'jsonb', p_rev: 'bigint', p_enabled: 'boolean', p_value: 'jsonb', p_updated_at: 'timestamptz',
  p_inbound_email_id: 'uuid', p_payload: 'jsonb', p_source: 'text', p_agent: 'text', p_trigger: 'text', p_idempotency_key: 'text',
  p_fields: 'jsonb', p_token_sha256: 'text', p_human_action: 'jsonb', p_order_item_id: 'uuid', p_material_id: 'uuid', p_holds: 'jsonb',
  p_expires_at: 'timestamptz', p_held_by: 'text', p_nesting_session_id: 'uuid', p_reason: 'text', p_now: 'timestamptz',
  p_quote_workflow_id: 'uuid', p_email: 'text',
};

/** '$T1', '$T2' and '$now<sign><n><unit>' (m, h, d, mo) resolved against the engine clock. */
function resolveValue(v, now) {
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, now));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, now)]));
  if (v === '$T1') return T1;
  if (v === '$T2') return T2;
  const m = typeof v === 'string' ? /^\$now([+-])(\d+)(mo|m|h|d)$/.exec(v) : null;
  if (!m) return v;
  const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  const d = new Date(now.getTime());
  if (m[3] === 'mo') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  } else {
    d.setTime(d.getTime() + n * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[3]]);
  }
  return d.toISOString();
}

/** Normalised copy: Date and ISO strings -> '@<minutes from t0>', numeric text -> number, generated ids masked. */
function normalise(v, t0, ids) {
  if (v instanceof Date) return `@${Math.floor((v.getTime() - t0) / 60_000)}`;
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map((x) => normalise(x, t0, ids));
  // Keys in sorted order, so generated ids are numbered in the same order whatever the engine's column order.
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalise(v[k], t0, ids)]));
  if (typeof v !== 'string') return v;
  if (/^\d{4}-\d\d-\d\d(T\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d(:?\d\d)?)?)?$/.test(v) && !Number.isNaN(Date.parse(v))) {
    return `@${Math.floor((Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v) - t0) / 60_000)}`;
  }
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length <= 30) return Number(v);   // numeric text (PGlite); not 64-digit hex values
  return v.replace(UUID_G, (id) => {
    if (KNOWN_IDS.has(id)) return id;
    if (ids === null) return '<id>';
    if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
    return ids.get(id);
  });
}
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

function parityEngineSql() {
  let db;
  const types = new Map();
  const qname = (t) => (t.includes('.') ? t : `public.${t}`);
  async function columnTypes(table) {
    if (!types.has(table)) {
      const [schema, name] = table.includes('.') ? table.split('.') : ['public', table];
      const r = await db.q(`select column_name c, data_type t, udt_name u from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, name]);
      types.set(table, Object.fromEntries(r.rows.map((x) => [x.c, x])));
    }
    return types.get(table);
  }
  const pgArray = (a) => `{${a.map((x) => `"${String(x).replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`;
  async function param(table, col, value, params) {
    const t = (await columnTypes(table))[col];
    if (!t) throw new Error(`no column ${table}.${col}`);
    if (value === null) { params.push(null); return `$${params.length}`; }
    if (t.t === 'jsonb') { params.push(JSON.stringify(value)); return `$${params.length}::jsonb`; }
    if (t.t === 'ARRAY') { params.push(pgArray(value)); return `$${params.length}::${t.u.slice(1)}[]`; }
    params.push(value);
    return `$${params.length}`;
  }
  const svc = (fn) => as(db, who.service, fn);
  return {
    name: 'sql',
    now: () => new Date(),
    async setup() {
      db = await openDb();
      await db.exec(LIVE);
      await db.exec(UP);
    },
    async insert(table, row) {
      const params = [];
      const cols = Object.keys(row);
      const vals = [];
      for (const c of cols) vals.push(await param(table, c, row[c], params));
      await db.q(`insert into ${qname(table)} (${cols.join(', ')}) values (${vals.join(', ')})`, params);
    },
    async insertAsService(table, row) { await svc(() => this.insert(table, row)); },
    async update(table, where, set, setFrom) {
      await svc(async () => {
        const params = [];
        const sets = [];
        for (const [c, v] of Object.entries(set ?? {})) sets.push(`${c} = ${await param(table, c, v, params)}`);
        for (const [c, f] of Object.entries(setFrom ?? {})) {
          const conds = [];
          for (const [wc, wv] of Object.entries(f.where)) conds.push(`${wc} = ${await param(f.table, wc, wv, params)}`);
          sets.push(`${c} = (select ${f.column} from ${qname(f.table)} where ${conds.join(' and ')})`);
        }
        const conds = [];
        for (const [c, v] of Object.entries(where)) conds.push(`${c} = ${await param(table, c, v, params)}`);
        await db.q(`update ${qname(table)} set ${sets.join(', ')} where ${conds.join(' and ')}`, params);
      });
    },
    async rpc(name, args, scalar) {
      return svc(async () => {
        const params = [];
        const named = Object.entries(args).map(([k, v]) => {
          const type = ARG_TYPES[k];
          if (!type) throw new Error(`no type for argument ${k}`);
          params.push(v === null ? null : type === 'jsonb' ? JSON.stringify(v) : v);
          return `${k} => $${params.length}::${type}`;
        }).join(', ');
        const r = await db.q(scalar ? `select public.${name}(${named}) as result` : `select * from public.${name}(${named})`, params);
        return scalar ? r.rows[0].result : r.rows;
      });
    },
    async rows(table) { return svc(async () => (await db.q(`select * from ${qname(table)}`)).rows); },
    async close() { await db.close(); },
  };
}

function parityEngineMemory(m, start) {
  // The memory clock starts where the SQL run started, so absolute timestamps normalise to the same minutes.
  const offset = start - Date.now();
  const now = () => new Date(Date.now() + offset);
  const tables = {};
  return {
    name: 'memory',
    now,
    async setup() {
      for (const row of m.seededFlagsFromMigration(UP)) m.insertRow(tables, 'feature_flags', row, now());
    },
    async insert(table, row) { m.insertRow(tables, table, row, now()); },
    async insertAsService(table, row) { m.insertRow(tables, table, row, now()); },
    async update(table, where, set, setFrom) {
      const patch = { ...(set ?? {}) };
      for (const [c, f] of Object.entries(setFrom ?? {})) {
        const src = m.rowsOf(tables, f.table).find((r) => Object.entries(f.where).every(([k, v]) => r[k] === v));
        patch[c] = src ? src[f.column] : null;
      }
      m.atomically(tables, () => {
        m.rowsOf(tables, table).forEach((r, i) => {
          if (Object.entries(where).every(([k, v]) => r[k] === v)) m.updateRow(tables, table, i, patch, now());
        });
      });
    },
    async rpc(name, args) { return JSON.parse(JSON.stringify(m.callRpc(tables, name, args, now()) ?? null)); },
    async rows(table) { return JSON.parse(JSON.stringify(m.rowsOf(tables, table))); },
    async close() {},
  };
}

/** Runs every case on one engine; returns {case name: {results: [...], tables: {...}}} normalised. */
async function runParityEngine(engine, scalarRpcs, t0) {
  await engine.setup();
  for (const f of RPC_VECTORS.fixtures) {
    for (const row of f.rows) await engine.insert(f.table, resolveValue(row, engine.now()));
  }
  const out = {};
  for (const c of RPC_VECTORS.cases) {
    const ids = new Map();
    const results = [];
    for (const s of c.steps) {
      if (s.insert) {
        for (const row of s.insert.rows) await engine.insertAsService(s.insert.table, resolveValue(row, engine.now()));
        continue;
      }
      if (s.update) {
        const run = () => engine.update(s.update.table, s.update.where, resolveValue(s.update.set, engine.now()), s.update.set_from);
        if (!s.update.compare) { await run(); continue; }
        let u = 'ok';
        try { await run(); } catch (e) { u = { error: { code: e.code ?? null, message: String(e.message) } }; }
        results.push({ update: s.update.table, result: u });
        continue;
      }
      let r;
      try {
        r = await engine.rpc(s.rpc, resolveValue(s.args, engine.now()), scalarRpcs.includes(s.rpc));
        if (s.unordered && Array.isArray(r)) r = [...r].sort((a, b) => (canon(normalise(a, t0, null)) < canon(normalise(b, t0, null)) ? -1 : 1));
        r = normalise(r, t0, ids);
      } catch (e) {
        r = { error: { code: e.code ?? null, message: String(e.message) } };
      }
      results.push({ rpc: s.rpc, result: r });
    }
    const tables = {};
    for (const t of c.tables) tables[t] = (await engine.rows(t)).map((row) => canon(normalise(row, t0, null))).sort();
    out[c.name] = { results, tables };
  }
  await engine.close();
  return out;
}

async function rpcParity() {
  const m = await import(pathToFileURL(MEMORY_RPC_FILE).href);
  const start = Date.now();
  const sqlEngine = parityEngineSql();
  const sql = await runParityEngine(sqlEngine, m.SCALAR_RPCS, start);
  const mem = await runParityEngine(parityEngineMemory(m, start), m.SCALAR_RPCS, start);
  console.log(`engine: ${ENGINE} vs ${path.relative(path.resolve(HERE, '../../..'), MEMORY_RPC_FILE)}`);
  if (process.argv.includes('--dump')) console.log(JSON.stringify(sql, null, 1));
  for (const c of RPC_VECTORS.cases) {
    await section(`parity: ${c.name}`, async () => {
      const a = sql[c.name];
      const b = mem[c.name];
      a.results.forEach((x, i) => {
        ok(canon(x) === canon(b.results[i]), `${c.name}: step ${i + 1} ${x.rpc ?? `update ${x.update}`} result`, { sql: x.result, memory: b.results[i].result });
      });
      for (const t of c.tables) {
        const missing = a.tables[t].filter((x) => !b.tables[t].includes(x));
        const extra = b.tables[t].filter((x) => !a.tables[t].includes(x));
        ok(missing.length === 0 && extra.length === 0 && a.tables[t].length === b.tables[t].length, `${c.name}: table ${t}`,
          { sql_only: missing.map((x) => JSON.parse(x)), memory_only: extra.map((x) => JSON.parse(x)) });
      }
    });
  }
  console.log(`\nrpc parity (${ENGINE}): ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(failures.length ? 1 : 0);
}

(process.argv.includes('--rpc-parity') ? rpcParity() : main()).catch((e) => { console.error(e); process.exit(2); });
