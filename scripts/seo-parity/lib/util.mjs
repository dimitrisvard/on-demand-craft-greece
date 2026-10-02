import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// ASCII whitespace only (HTML spec: TAB, LF, FF, CR, SPACE). JavaScript's \s
// would also fold U+00A0, U+FEFF (BOM), U+2028/2029, U+202F, U+3000 and the
// other Unicode spaces, hiding byte-level differences in F14, F21 and F23.
export const collapse = (s) => String(s ?? '').replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');

/**
 * Canonical form of a JSON text that sorts object keys but keeps every string,
 * number and literal token exactly as written (escapes included) and drops
 * insignificant whitespace. Used by F23 so that JSON-LD key order does not
 * fail the document while an escaping change (\u0026 vs &, \/ vs /) does.
 * Throws SyntaxError on invalid JSON.
 */
export function canonicalJsonRaw(text) {
  const s = String(text);
  let i = 0;
  const fail = () => { throw new SyntaxError(`invalid JSON at offset ${i}`); };
  const ws = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++; };
  const str = () => {
    const start = i;
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s.charCodeAt(i) < 0x20) fail();
      i += s[i] === '\\' ? 2 : 1;
    }
    if (s[i] !== '"') fail();
    i++;
    const raw = s.slice(start, i);
    try { JSON.parse(raw); } catch { fail(); }
    return raw;
  };
  const LIT = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  const val = () => {
    ws();
    const ch = s[i];
    if (ch === '{') {
      i++; ws();
      const members = [];
      if (s[i] === '}') { i++; return '{}'; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail();
        const k = str();
        ws();
        if (s[i] !== ':') fail();
        i++;
        members.push([JSON.parse(k), k, val()]);
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; break; }
        fail();
      }
      members.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
      return `{${members.map((m) => `${m[1]}:${m[2]}`).join(',')}}`;
    }
    if (ch === '[') {
      i++; ws();
      const items = [];
      if (s[i] === ']') { i++; return '[]'; }
      for (;;) {
        items.push(val());
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; break; }
        fail();
      }
      return `[${items.join(',')}]`;
    }
    if (ch === '"') return str();
    LIT.lastIndex = i;
    const m = LIT.exec(s);
    if (!m) fail();
    i += m[0].length;
    return m[0];
  };
  const out = val();
  ws();
  if (i !== s.length) fail();
  return out;
}

/** JSON with object keys sorted recursively; arrays keep their order (F20). */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function deepEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

export function runId(now = new Date()) {
  return `${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}-${randomBytes(2).toString('hex')}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bounded-concurrency map that stops picking new items once `shouldStop()` is true. */
export async function pool(items, concurrency, worker, shouldStop = () => false) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length && !shouldStop()) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Sorted copy of a multiset (array of comparable JSON values). */
export const sortedMultiset = (arr) => [...arr].map((x) => canonicalJson(x)).sort().map((s) => JSON.parse(s));

/** Multiset inclusion a ⊆ b. */
export function multisetSubset(a, b) {
  const counts = new Map();
  for (const x of b) { const k = canonicalJson(x); counts.set(k, (counts.get(k) || 0) + 1); }
  for (const x of a) {
    const k = canonicalJson(x);
    const c = counts.get(k) || 0;
    if (c === 0) return false;
    counts.set(k, c - 1);
  }
  return true;
}

/** Short display form for long values (§5.5: long values as SHA-256 plus length). */
export function display(v, max = 160) {
  if (v === undefined) return 'undefined';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.length <= max) return s;
  return `sha256:${sha256(s).slice(0, 16)}… (${s.length} chars)`;
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export class UsageError extends Error {
  constructor(msg) { super(msg); this.name = 'UsageError'; this.exitCode = 2; }
}

export class InvalidRunError extends Error {
  constructor(msg) { super(msg); this.name = 'InvalidRunError'; this.exitCode = 3; }
}
