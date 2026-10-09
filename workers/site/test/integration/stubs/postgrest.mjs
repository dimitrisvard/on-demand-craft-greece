// Mini-PostgREST of the T2 profile 'agents' (PHASE4_SPEC.md §6.3): the Supabase REST API over in-memory tables, so
// microns-ops and microns-mail run their real Db code against SUPABASE_URL = the stub origin. The rows, the column
// defaults, the triggers, the CHECK and unique constraints and the RPCs come from workers/ops/test/helpers/
// memory-rpc.ts, the same code T1's MemoryDb uses and the SQL parity vectors compare with the SQL functions.
//
// REST surface (/rest/v1)
//   GET|HEAD /<table>   filters eq, neq, gt, gte, lt, lte, like, ilike (* or % any, _ one, \ escapes), in, is, cs, cd,
//                       ov, not.<op>; select (column list, alias:column, ::cast ignored), order (col.asc|desc
//                       [.nullsfirst|.nullslast]), limit, offset, Range header, Prefer count=exact,
//                       Accept application/vnd.pgrst.object+json (exactly one row, else 406 PGRST116)
//   POST /<table>       one object or an array (every object with the same keys, else 400 PGRST102); on_conflict with
//                       Prefer resolution=ignore-duplicates | merge-duplicates (without on_conflict: the primary key);
//                       Prefer return=representation | minimal; select for the returned rows
//   PATCH /<table>      filters as GET; Prefer return=representation | minimal
//   DELETE /<table>     filters as GET (feature_flags refuses, as the table's trigger does)
//   POST /rpc/<fn>      named JSON arguments; GET /rpc/<fn>?arg=value for argument-less or text arguments
//   Every request needs an apikey header (401 otherwise); one request = one transaction (a failing row rolls the
//   request back); errors use PostgREST's JSON shape {code, message, details, hint} and the status its error table
//   gives each code (PostgREST docs (fetched 2026-10-03) https://docs.postgrest.org/en/stable/references/errors.html).
//   Tables: the tables of the agent layer and the business tables its agents read and write (TABLES below); any
//   other table answers 404 PGRST205 until a seed creates it.
//   Phase 5 (PHASE5_SPEC §5.10): the business tables of the consolidated jobs (P5_TABLES) are served too; inserts and
//   upserts into them keep their unique keys (articles (slug, language), leads source_url and (source, external_id),
//   gsc_monitored_urls url, xometry_offers code, tenders (country_code, tender_reference): 23505, ignore- and
//   merge-duplicates on those keys, 42P10 for another conflict target) and fill the live time defaults; the
//   article-queue RPCs (enqueue_next_article, get_next_queue_job, mark_queue_job_completed, mark_queue_job_failed)
//   answer from workers/ops/src/ports/p5-stub/memory-rpc-p5.ts, the code T1's P5MemoryDb uses. Nothing else changes.
//
// Control API
//   POST /__stub/seed            {tables?: {<table>: [rows]}, replace?: boolean, flags?: 'migration'}: rows as
//                                existing data (defaults filled, no trigger, no check); flags 'migration' adds the 13
//                                feature_flags rows exactly as the migration inserts them
//   GET  /__stub/rows/<table>    the current rows
//   POST /__stub/postgrest/reset forget every row
//
// Module contract (for stub-server.mjs): `prefixes`, `handle(req, res, url, body) -> Promise<boolean>` (true when it
// answered), `reset()`, plus `createPostgrest()` for a separate instance and `startPostgrestServer()` to run alone:
//   node workers/site/test/integration/stubs/postgrest.mjs [port]

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomically,
  callRpc,
  deleteRow,
  insertRow,
  jsonEqual,
  MemoryRpcError,
  resetSequences,
  rowsOf,
  seededFlagsFromMigration,
  seedRows,
  TABLE_SPECS,
  UNIQUE_KEYS,
  updateRow,
  upsertRow,
} from '../../../../ops/test/helpers/memory-rpc.ts';
import { isP5Table, P5_MEMORY_RPCS, P5_UNIQUE_KEYS, p5WriteRow } from '../../../../ops/src/ports/p5-stub/memory-rpc-p5.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, '../../../../../supabase/migrations');

/** Tables the REST surface serves before any seed (PHASE4_SPEC.md §6.3). */
export const TABLES = [
  'agent_runs', 'feature_flags', 'inbound_emails', 'rfqs', 'rfq_files', 'cad_jobs', 'quote_workflows', 'pricing_rules',
  'catalog_materials', 'customers', 'orders', 'order_items', 'production_partners', 'materials', 'stock_items',
  'stock_reservations', 'marketing_sender_accounts', 'company_leads', 'scan_logs', 'saved_searches', 'user_roles',
  'stock_transactions', 'nesting_sessions',
];

/** Business tables of the Phase 5 jobs (PHASE5_SPEC §5.10), served before any seed as well. */
export const P5_TABLES = Object.keys(P5_UNIQUE_KEYS);

export const prefixes = ['/rest/v1/', '/__stub/seed', '/__stub/rows/', '/__stub/postgrest/'];

class RestError extends Error {
  constructor(status, code, message, details = null, hint = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTs = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(v);
const isUuid = (v) => typeof v === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);

/** Compares a row value with a filter operand given as text (PostgREST casts the text to the column type). */
function compare(rowValue, text) {
  if (typeof rowValue === 'number') {
    const n = Number(text);
    if (Number.isNaN(n)) throw new RestError(400, '22P02', `invalid input syntax for type numeric: "${text}"`);
    return rowValue - n;
  }
  if (typeof rowValue === 'boolean') {
    const b = /^(t|true|yes|on|1)$/i.test(text) ? true : /^(f|false|no|off|0)$/i.test(text) ? false : null;
    if (b === null) throw new RestError(400, '22P02', `invalid input syntax for type boolean: "${text}"`);
    return Number(rowValue) - Number(b);
  }
  if (isTs(rowValue) && !Number.isNaN(Date.parse(text))) return Date.parse(rowValue) - Date.parse(text);
  const a = isUuid(rowValue) ? rowValue.toLowerCase() : typeof rowValue === 'string' ? rowValue : JSON.stringify(rowValue);
  const b = isUuid(text) ? text.toLowerCase() : text;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Items of an in.(...) list or a {...} array literal; double quotes and backslash escapes honoured. */
function parseList(text, open, close) {
  if (!text.startsWith(open) || !text.endsWith(close)) throw new RestError(400, 'PGRST100', `failed to parse list ${text}`);
  const body = text.slice(1, -1);
  const out = [];
  let cur = '';
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '\\') cur += body[++i] ?? '';
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ',') {
      out.push(wasQuoted ? cur : cur.trim());
      cur = '';
      wasQuoted = false;
    } else {
      cur += ch;
    }
  }
  if (body.length > 0 || wasQuoted) out.push(wasQuoted ? cur : cur.trim());
  return out;
}

function likeRegex(pattern, flags) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%' || ch === '*') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, flags);
}

/** jsonb @> containment. */
function contains(a, b) {
  if (Array.isArray(b)) return Array.isArray(a) && b.every((x) => a.some((y) => contains(y, x) || jsonEqual(y, x)));
  if (isObject(b)) return isObject(a) && Object.keys(b).every((k) => k in a && contains(a[k], b[k]));
  return jsonEqual(a, b);
}

/**
 * One `column=op.value` query parameter as a row predicate, with SQL's three-valued logic: every operator except
 * `is` compares a NULL column as unknown, `not.` keeps unknown unknown, and only true keeps the row.
 */
function predicate(table, column, expr) {
  const cols = TABLE_SPECS[table]?.columns;
  if (cols && !cols.includes(column)) throw new RestError(400, '42703', `column ${table}.${column} does not exist`);
  let negate = false;
  let rest = expr;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  if (dot < 0) throw new RestError(400, 'PGRST100', `failed to parse filter (${expr})`);
  const op = rest.slice(0, dot);
  const operand = rest.slice(dot + 1);
  let test;
  switch (op) {
    case 'eq': test = (v) => compare(v, operand) === 0; break;
    case 'neq': test = (v) => compare(v, operand) !== 0; break;
    case 'gt': test = (v) => compare(v, operand) > 0; break;
    case 'gte': test = (v) => compare(v, operand) >= 0; break;
    case 'lt': test = (v) => compare(v, operand) < 0; break;
    case 'lte': test = (v) => compare(v, operand) <= 0; break;
    case 'like': { const re = likeRegex(operand, ''); test = (v) => typeof v === 'string' && re.test(v); break; }
    case 'ilike': { const re = likeRegex(operand, 'i'); test = (v) => typeof v === 'string' && re.test(v); break; }
    case 'in': { const items = parseList(operand, '(', ')'); test = (v) => items.some((x) => compare(v, x) === 0); break; }
    case 'is': {
      const want = operand.toLowerCase();
      if (!['null', 'true', 'false', 'unknown'].includes(want)) throw new RestError(400, 'PGRST100', `failed to parse filter (${expr})`);
      const is = (v) => (want === 'null' || want === 'unknown' ? v === null || v === undefined : v === (want === 'true'));
      return (row) => (negate ? !is(row[column]) : is(row[column]));
    }
    case 'cs':
    case 'cd':
    case 'ov': {
      let json = null;
      try { json = JSON.parse(operand); } catch { json = null; }
      if (op !== 'ov' && json !== null && (isObject(json) || Array.isArray(json))) {
        test = (v) => (op === 'cs' ? contains(v, json) : contains(json, v));
        break;
      }
      const items = parseList(operand, '{', '}');
      const has = (arr, x) => arr.some((y) => compare(y, x) === 0);
      if (op === 'cs') test = (v) => Array.isArray(v) && items.every((x) => has(v, x));
      else if (op === 'cd') test = (v) => Array.isArray(v) && v.every((y) => items.some((x) => compare(y, x) === 0));
      else test = (v) => Array.isArray(v) && items.some((x) => has(v, x));
      break;
    }
    default:
      throw new RestError(400, 'PGRST100', `unsupported filter operator ${op} in the stub`);
  }
  return (row) => {
    const v = row[column];
    if (v === null || v === undefined) return false;             // unknown, negated or not
    return negate ? !test(v) : test(v);
  };
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function filtersOf(table, params) {
  const preds = [];
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    if (k === 'or' || k === 'and') throw new RestError(400, 'PGRST100', 'or/and filters are not supported by the stub');
    preds.push(predicate(table, k, v));
  }
  return (row) => preds.every((p) => p(row));
}

/** select=a,b:c,d::text -> [{out, col}] ('*' -> null = every column). */
function selectList(text) {
  if (!text || text.trim() === '*') return null;
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
    if (item.includes('(')) throw new RestError(400, 'PGRST100', 'embedded resources are not supported by the stub');
    if (item === '*') return { star: true };
    const [left, right] = item.includes(':') && !item.includes('::') ? item.split(':') : [null, item];
    const col = right.split('::')[0].trim();
    return { out: (left ?? col).trim(), col };
  });
}

function project(row, list) {
  if (list === null) return { ...row };
  const out = {};
  for (const item of list) {
    if (item.star) Object.assign(out, row);
    else out[item.out] = row[item.col] === undefined ? null : row[item.col];
  }
  return out;
}

function sortRows(rows, orderText) {
  if (!orderText) return rows;
  const keys = orderText.split(',').map((part) => {
    const [col, ...mods] = part.trim().split('.');
    const desc = mods.includes('desc');
    const nullsFirst = mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : desc;
    return { col, desc, nullsFirst };
  });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = a[k.col] ?? null;
      const y = b[k.col] ?? null;
      if (x === null && y === null) continue;
      if (x === null) return k.nullsFirst ? -1 : 1;
      if (y === null) return k.nullsFirst ? 1 : -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : compare(x, typeof y === 'string' ? y : String(y));
      if (c !== 0) return k.desc ? -c : c;
    }
    return 0;
  });
}

function preferOf(headers) {
  const out = {};
  for (const part of String(headers.prefer ?? '').split(',')) {
    const [k, v] = part.trim().split('=');
    if (k) out[k.trim()] = (v ?? '').trim();
  }
  return out;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const reply = (status, body, headers = {}) => ({ status, headers: { 'content-type': JSON_TYPE, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const errorReply = (e) => reply(e.status ?? 500, { code: e.code ?? null, message: e.message, details: e.details ?? null, hint: e.hint ?? null });

/** A separate stub instance with its own rows. */
export function createPostgrest(options = {}) {
  const tables = {};
  const clock = options.clock ?? (() => new Date());
  const known = new Set([...TABLES, ...P5_TABLES]);

  function migrationFlags() {
    const hits = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('_agent_layer.sql'));
    if (hits.length !== 1) throw new Error(`expected exactly one supabase/migrations/*_agent_layer.sql, found ${hits.length}`);
    return seededFlagsFromMigration(fs.readFileSync(path.join(MIGRATIONS, hits[0]), 'utf8'));
  }

  function seed(body) {
    const now = clock();
    if (body.replace) for (const t of Object.keys(body.tables ?? {})) delete tables[t];
    if (body.flags === 'migration') {
      if (body.replace) delete tables.feature_flags;
      for (const row of migrationFlags()) insertRow(tables, 'feature_flags', row, now);
      known.add('feature_flags');
    }
    for (const [t, rows] of Object.entries(body.tables ?? {})) {
      seedRows(tables, t, Array.isArray(rows) ? rows : [rows], now);
      known.add(t);
    }
  }

  function tableRequest(method, table, params, headers, body) {
    if (!known.has(table)) throw new RestError(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`);
    const prefer = preferOf(headers);
    const list = selectList(params.get('select'));
    const representation = prefer.return === 'representation';
    const now = clock();
    if (method === 'GET' || method === 'HEAD') {
      const match = filtersOf(table, params);
      let rows = sortRows(rowsOf(tables, table).filter(match), params.get('order'));
      const total = rows.length;
      let offset = Number(params.get('offset') ?? 0);
      let limit = params.has('limit') ? Number(params.get('limit')) : Infinity;
      const range = /^(\d+)-(\d*)$/.exec(String(headers.range ?? ''));
      if (range) {
        offset = Number(range[1]);
        if (range[2] !== '') limit = Math.min(limit, Number(range[2]) - offset + 1);
      }
      rows = rows.slice(offset, offset + limit).map((r) => project(r, list));
      const contentRange = `${rows.length ? `${offset}-${offset + rows.length - 1}` : '*'}/${prefer.count === 'exact' ? total : '*'}`;
      if (String(headers.accept ?? '').includes('application/vnd.pgrst.object+json')) {
        if (rows.length !== 1) {
          throw new RestError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${rows.length} rows`);
        }
        return reply(200, method === 'HEAD' ? undefined : rows[0], { 'content-range': contentRange });
      }
      return reply(200, method === 'HEAD' ? undefined : rows, { 'content-range': contentRange });
    }
    if (method === 'POST') {
      const items = Array.isArray(body) ? body : [body];
      if (!items.every(isObject)) throw new RestError(400, 'PGRST102', 'Invalid body: each item must be an object');
      const keys = JSON.stringify(Object.keys(items[0] ?? {}).sort());
      if (!items.every((r) => JSON.stringify(Object.keys(r).sort()) === keys)) throw new RestError(400, 'PGRST102', 'All object keys must match');
      const resolution = prefer.resolution;
      const target = params.get('on_conflict')?.split(',').map((s) => s.trim())
        ?? (resolution ? (UNIQUE_KEYS[table]?.[0] ?? ['id']) : null);
      const written = atomically(tables, () => items.flatMap((r) => {
        if (isP5Table(table)) {
          try {
            const row = p5WriteRow(tables, table, r, now, resolution && target ? { onConflict: target, merge: resolution === 'merge-duplicates' } : {});
            return row ? [row] : [];
          } catch (e) {
            if (e && typeof e.status === 'number' && typeof e.code === 'string') throw new RestError(e.status, e.code, e.message, e.details ?? null);
            throw e;
          }
        }
        if (resolution && target) {
          const res = upsertRow(tables, table, r, now, { onConflict: target, merge: resolution === 'merge-duplicates' });
          return res.inserted || res.updated ? [res.row] : [];
        }
        return [insertRow(tables, table, r, now)];
      }));
      return representation ? reply(201, written.map((r) => project(r, list))) : reply(201, undefined);
    }
    if (method === 'PATCH') {
      if (!isObject(body)) throw new RestError(400, 'PGRST102', 'Invalid body: expected an object');
      const match = filtersOf(table, params);
      const written = atomically(tables, () => rowsOf(tables, table).flatMap((r, i) => (match(r) ? [updateRow(tables, table, i, body, now)] : [])));
      return representation ? reply(200, written.map((r) => project(r, list))) : reply(204, undefined);
    }
    if (method === 'DELETE') {
      const match = filtersOf(table, params);
      const removed = atomically(tables, () => {
        const out = [];
        for (;;) {
          const i = rowsOf(tables, table).findIndex(match);
          if (i < 0) return out;
          out.push(deleteRow(tables, table, i, now));
        }
      });
      return representation ? reply(200, removed.map((r) => project(r, list))) : reply(204, undefined);
    }
    throw new RestError(405, 'PGRST117', `Unsupported HTTP method: ${method}`);
  }

  function rpcRequest(method, name, params, headers, body) {
    let args;
    if (method === 'POST') args = body === undefined || body === null ? {} : body;
    else if (method === 'GET' || method === 'HEAD') args = Object.fromEntries([...params].filter(([k]) => !RESERVED.has(k)));
    else throw new RestError(405, 'PGRST117', `Unsupported HTTP method: ${method}`);
    if (!isObject(args)) throw new RestError(400, 'PGRST102', 'Invalid body: expected an object of named arguments');
    const p5 = Object.prototype.hasOwnProperty.call(P5_MEMORY_RPCS, name) ? P5_MEMORY_RPCS[name] : null;
    const result = p5 ? atomically(tables, () => p5(tables, args, clock())) : callRpc(tables, name, args, clock());
    if (Array.isArray(result) && String(headers.accept ?? '').includes('application/vnd.pgrst.object+json')) {
      if (result.length !== 1) throw new RestError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      return reply(200, result[0]);
    }
    return reply(200, result);
  }

  /**
   * Framework-free entry: request {method, path (with query), headers (lower-case names), body (string or undefined)}
   * -> response {status, headers, body (string or undefined)}, or null when the path is not this module's.
   */
  function request({ method, path: pathAndQuery, headers = {}, body }) {
    const url = new URL(pathAndQuery, 'http://stub.local');
    try {
      if (url.pathname === '/__stub/seed' && method === 'POST') {
        seed(body ? JSON.parse(body) : {});
        return { status: 204, headers: {}, body: undefined };
      }
      if (url.pathname.startsWith('/__stub/rows/') && method === 'GET') {
        return reply(200, rowsOf(tables, decodeURIComponent(url.pathname.slice('/__stub/rows/'.length))));
      }
      if (url.pathname === '/__stub/postgrest/reset' && method === 'POST') {
        reset();
        return { status: 204, headers: {}, body: undefined };
      }
      if (!url.pathname.startsWith('/rest/v1/')) return null;
      if (!headers.apikey) {
        return reply(401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' });
      }
      let parsed;
      if (body !== undefined && body !== '') {
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new RestError(400, 'PGRST102', 'Empty or invalid json');
        }
      }
      const rest = url.pathname.slice('/rest/v1/'.length);
      if (rest.startsWith('rpc/')) return rpcRequest(method, rest.slice(4), url.searchParams, headers, parsed);
      return tableRequest(method, decodeURIComponent(rest), url.searchParams, headers, parsed);
    } catch (e) {
      if (e instanceof RestError || e instanceof MemoryRpcError) return errorReply(e);
      return errorReply({ status: 500, code: 'stub', message: String(e?.message ?? e) });
    }
  }

  function reset() {
    for (const k of Object.keys(tables)) delete tables[k];
    resetSequences(tables);
    known.clear();
    for (const t of [...TABLES, ...P5_TABLES]) known.add(t);
  }

  /** Node adapter: answers and resolves true when the request is this module's. */
  async function handle(req, res, url, body) {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v]));
    const text = body === undefined || body === null ? undefined : Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    const out = request({ method: req.method, path: url.pathname + url.search, headers, body: text });
    if (out === null) return false;
    res.writeHead(out.status, out.headers);
    res.end(out.status === 204 ? undefined : out.body);
    return true;
  }

  return { tables, request, handle, reset, seed };
}

const instance = createPostgrest();

/** Module-level instance used by stub-server.mjs. */
export const handle = instance.handle;
export const reset = instance.reset;
export const request = instance.request;

/** Runs a separate instance as its own HTTP server (tests and manual runs). */
export function startPostgrestServer({ port = 0, host = '127.0.0.1', stub = createPostgrest() } = {}) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (!(await stub.handle(req, res, url, Buffer.concat(chunks)))) {
        res.writeHead(404, { 'content-type': JSON_TYPE });
        res.end(JSON.stringify({ error: 'no stub route', path: url.pathname }));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({ url: `http://${host}:${server.address().port}`, stub, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await startPostgrestServer({ port: Number(process.argv[2] ?? 0) });
  console.log(s.url);
}
