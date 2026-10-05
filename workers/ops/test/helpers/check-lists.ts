// Reads the value lists of the CHECK constraints in the agent-layer migration (supabase/migrations/*_agent_layer.sql),
// so a unit's T1 suite can assert that its TypeScript string-literal union equals the list the database enforces
// (PHASE4_SPEC.md §5 "CHECK-LISTS"):
//
//   expect(sorted(['queued', 'running', ...] satisfies CadJobStatus[])).toEqual(sorted(checkList('cad_jobs_status_check')));
//
// Rules
//   - The migration is found by name pattern; exactly one file must match, else the read throws.
//   - checkList(name) returns the quoted values of the first `IN (...)` list inside CONSTRAINT <name> CHECK (...), in
//     file order; checkList(name, column) the list that follows `<column> IN (`. A constraint without such a list
//     throws, so a renamed constraint fails the test instead of passing with an empty list.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededFlagsFromMigration, type MemoryRow } from './memory-rpc';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');

let cached: { file: string; sql: string } | null = null;

/** Absolute path and text of the one supabase/migrations/*_agent_layer.sql file. */
export function agentLayerMigration(): { file: string; sql: string } {
  if (cached) return cached;
  const hits = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('_agent_layer.sql')).sort();
  if (hits.length !== 1) {
    throw new Error(`expected exactly one supabase/migrations/*_agent_layer.sql, found ${hits.length}: ${hits.join(', ')}`);
  }
  const file = path.join(MIGRATIONS_DIR, hits[0]);
  cached = { file, sql: readFileSync(file, 'utf8') };
  return cached;
}

/** The SQL text of the migration with `--` comments removed (string literals kept). */
function code(sql: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'" && sql[i + 1] === "'") out += sql[++i];
      else if (ch === "'") inString = false;
    } else if (ch === "'") {
      inString = true;
      out += ch;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Text between the parenthesis at `open` and its match. */
function balanced(text: string, open: number): string {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'" && text[i + 1] === "'") i++;
      else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error('unbalanced parentheses in the migration');
}

/** Body of CONSTRAINT <name> CHECK (...). */
export function checkBody(name: string): string {
  const sql = code(agentLayerMigration().sql);
  const m = new RegExp(`CONSTRAINT\\s+${name}\\s+CHECK\\s*\\(`).exec(sql);
  if (!m) throw new Error(`CHECK constraint ${name} not found in the agent-layer migration`);
  return balanced(sql, m.index + m[0].length - 1);
}

const quoted = (list: string): string[] => [...list.matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));

/** Values of the IN list of a CHECK constraint (optionally the list after `<column> IN (`). */
export function checkList(name: string, column?: string): string[] {
  const body = checkBody(name);
  const re = column ? new RegExp(`\\b${column}\\s+IN\\s*\\(`) : /\bIN\s*\(/;
  const m = re.exec(body);
  if (!m) throw new Error(`CHECK constraint ${name} has no IN list${column ? ` for ${column}` : ''}`);
  const values = quoted(balanced(body, m.index + m[0].length - 1));
  if (values.length === 0) throw new Error(`CHECK constraint ${name}: empty IN list`);
  return values;
}

/** Top-level comma-separated items of a parenthesised body (commas inside parentheses or strings do not split). */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      cur += ch;
      if (ch === "'" && body[i + 1] === "'") cur += body[++i];
      else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      items.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

/**
 * Columns the migration gives a table: the column definitions of its CREATE TABLE public.<table>, plus the columns
 * of every ALTER TABLE public.<table> ADD COLUMN.
 */
export function migrationColumns(table: string): string[] {
  const sql = code(agentLayerMigration().sql);
  const cols: string[] = [];
  const create = new RegExp(`CREATE TABLE public\\.${table}\\s*\\(`).exec(sql);
  if (create) {
    for (const item of topLevelItems(balanced(sql, create.index + create[0].length - 1))) {
      if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i.test(item)) continue;
      cols.push(item.split(/\s+/)[0]);
    }
  }
  for (const m of sql.matchAll(new RegExp(`ALTER TABLE public\\.${table}\\b([^;]*);`, 'g'))) {
    for (const add of m[1].matchAll(/ADD COLUMN\s+([a-z0-9_]+)/g)) cols.push(add[1]);
  }
  if (cols.length === 0) throw new Error(`the migration neither creates nor alters public.${table}`);
  return cols;
}

/** Sorted copy, for order-insensitive comparisons. */
export const sorted = (values: readonly string[]): string[] => [...values].sort();

/** The 13 rows the migration seeds into public.feature_flags (key, enabled, value, description, kv_seed_pending). */
export function seededFlags(): MemoryRow[] {
  return seededFlagsFromMigration(agentLayerMigration().sql);
}
