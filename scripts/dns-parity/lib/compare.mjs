// Normalise one answer to an outcome and compare two outcomes.
//
// Outcome kinds: DATA (values), NODATA, NXDOMAIN, EMPTY (capture "(no answer)": NODATA or NXDOMAIN),
// PROXIED (Cloudflare answers with its own addresses), FLATTENED (apex CNAME answered as A/AAAA),
// ERROR (timeout, SERVFAIL, REFUSED, non-authoritative, malformed), SKIP (source has no data for it).
// Only the RRset owned by the question name is compared: an A query for a CNAME owner compares the CNAME, not the
// addresses a recursive resolver chased (they depend on the resolver's location), unless follow is set.
import { canonical, displayText, ipv6Canonical, isUncomparable } from './rdata.mjs';
import { canonName } from './names.mjs';
import { parseZone } from './zonefile.mjs';
import { typeName, TYPES } from './types.mjs';

const LOSSY_LIMIT = 120; // doh.py cut every value at 120 characters

function captureValue(qtype, item) {
  const t = item.text;
  const truncated = t.length >= LOSSY_LIMIT;
  const tn = typeName(item.type);
  switch (item.type) {
    case TYPES.CNAME:
    case TYPES.NS:
      return `${tn} ${canonName(t)}`;
    case TYPES.A:
      return `A ${t}`;
    case TYPES.AAAA:
      return `AAAA ${ipv6Canonical(t)}`;
    case TYPES.MX: {
      const [p, x] = t.split(/\s+/);
      return `MX ${Number(p)} ${canonName(x)}`;
    }
    case TYPES.TXT: {
      if (truncated) {
        const prefix = t.replace(/^"/, '').replace(/" "/g, '');
        return { prefix: `TXT ${displayText(prefix).slice(0, -1)}` };
      }
      const z = parseZone(`x 300 IN TXT ${t}\n`, { origin: 'invalid' });
      return `TXT ${displayText(z.records[0].rdata.strings.join(''))}`;
    }
    default:
      return truncated ? { prefix: `${tn} ${t}` } : `${tn} ${t.toLowerCase()}`;
  }
}

/**
 * @param {object} answer from a source
 * @param {string} qname
 * @param {number} qtype
 * @param {{txt?: 'join'|'chunks', follow?: boolean}} opts
 */
export function outcome(answer, qname, qtype, opts = {}) {
  const q = canonName(qname);
  if (answer.status === 'SKIP') return { kind: 'SKIP', note: answer.note };
  if (answer.status === 'EMPTY') return { kind: 'EMPTY', lossy: true };
  if (answer.capture) {
    const items = answer.capture;
    const firstCname = items.find((i) => i.type === TYPES.CNAME);
    const owned = qtype !== TYPES.CNAME && firstCname ? [firstCname] : items.filter((i) => i.type === qtype);
    const values = owned.map((i) => captureValue(qtype, i));
    return values.length ? { kind: 'DATA', values: sortValues(values), lossy: true, ttl: null } : { kind: 'NODATA', lossy: true };
  }
  if (answer.status === 'NXDOMAIN') return { kind: 'NXDOMAIN', ttl: null };
  if (answer.status !== 'NOERROR') return { kind: 'ERROR', error: answer.error ?? answer.status };
  if (answer.proxied) return { kind: 'PROXIED' };
  if (answer.flattened) return { kind: 'FLATTENED', target: canonName(answer.flattened) };
  const rrs = answer.rrs ?? [];
  const own = rrs.filter((r) => canonName(r.name) === q);
  const ownCname = own.filter((r) => r.type === TYPES.CNAME);
  let set = qtype !== TYPES.CNAME && ownCname.length ? ownCname : own.filter((r) => r.type === qtype);
  if (qtype === TYPES.NS && answer.authority && !set.length) set = [];
  const values = set.map((r) => {
    const v = canonical(r, opts);
    if (isUncomparable(v)) return { uncomparable: `${typeName(r.type)} ${v}` };
    return `${typeName(r.type)} ${v}`;
  });
  if (opts.follow) {
    for (const r of rrs) {
      if (canonName(r.name) !== q && (r.type === qtype || r.type === TYPES.CNAME)) values.push(`-> ${canonName(r.name)} ${typeName(r.type)} ${canonical(r, opts)}`);
    }
  }
  const ttls = set.map((r) => r.ttl).filter((t) => t !== null && t !== undefined);
  if (!values.length) return { kind: 'NODATA', ttl: null };
  return { kind: 'DATA', values: sortValues(values), ttl: ttls.length ? Math.min(...ttls) : null };
}

function sortValues(values) {
  const key = (v) => (typeof v === 'string' ? v : v.prefix ?? v.uncomparable);
  const seen = new Set();
  return values.filter((v) => { const k = key(v); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function valuesEqual(a, b) {
  const lossyA = a.some((v) => typeof v !== 'string');
  const lossyB = b.some((v) => typeof v !== 'string');
  if (a.some((v) => v.uncomparable) || b.some((v) => v.uncomparable)) return 'uncomparable';
  if (!lossyA && !lossyB) return a.length === b.length && a.every((v, i) => v === b[i]) ? 'equal' : 'diff';
  // Lossy side: every exact value must be present on the other side; every prefix must prefix exactly one value.
  if (a.length !== b.length) return 'diff';
  const [lossy, full] = lossyA ? [a, b] : [b, a];
  const remaining = [...full];
  for (const v of lossy) {
    const idx = typeof v === 'string' ? remaining.indexOf(v) : remaining.findIndex((x) => typeof x === 'string' && x.startsWith(v.prefix));
    if (idx === -1) return 'diff';
    remaining.splice(idx, 1);
  }
  return 'prefix-equal';
}

/**
 * Compare two outcomes of one (name, type).
 * @returns {{status: string, reason?: string}} status in MATCH | DIFF | ERROR | SKIPPED | EXPECTED_PROXIED |
 *          FLATTENED_UNVERIFIED | UNCOMPARABLE | TTL_DIFF
 */
export function compareOutcomes(a, b, ctx = {}) {
  if (a.kind === 'SKIP' || b.kind === 'SKIP') return { status: 'SKIPPED', reason: a.note ?? b.note };
  if (a.kind === 'ERROR' || b.kind === 'ERROR') return { status: 'ERROR', reason: [a.error, b.error].filter(Boolean).join(' / ') };
  // A proxied name answers A/AAAA with Cloudflare addresses and HTTPS with Cloudflare's own record (or none).
  const addressQuery = ctx.qtype === TYPES.A || ctx.qtype === TYPES.AAAA || ctx.qtype === TYPES.CNAME || ctx.qtype === TYPES.HTTPS;
  if (ctx.expectProxied && addressQuery) {
    const cf = ctx.proxiedSide === 'a' ? a : b;
    const ok = cf.kind === 'PROXIED'
      || (cf.kind === 'DATA' && (ctx.qtype === TYPES.HTTPS || cf.values.every((v) => typeof v === 'string' && (v.startsWith('A ') || v.startsWith('AAAA ')))))
      || ((ctx.qtype === TYPES.CNAME || ctx.qtype === TYPES.HTTPS) && cf.kind === 'NODATA');
    return ok ? { status: 'EXPECTED_PROXIED' } : { status: 'DIFF', reason: 'expected a proxied answer (Cloudflare addresses, no CNAME)' };
  }
  if (ctx.expectProxied) {
    // Any other type of a name that was a CNAME before the flip: the CNAME answered every type, the proxied record
    // that replaced it owns none of them. Records added next to the proxied record still differ.
    const [before, cf] = ctx.proxiedSide === 'a' ? [b, a] : [a, b];
    const wasCname = before.kind === 'DATA' && before.values.every((v) => typeof v === 'string' && v.startsWith('CNAME '));
    if (wasCname && cf.kind === 'NODATA') return { status: 'EXPECTED_PROXIED', reason: 'CNAME replaced by a proxied record' };
  }
  if (a.kind === 'PROXIED' || b.kind === 'PROXIED') {
    if (a.kind === b.kind) return { status: 'MATCH' };
    return { status: 'DIFF', reason: 'proxied on one side only' };
  }
  if (a.kind === 'FLATTENED' || b.kind === 'FLATTENED') {
    const [f, other] = a.kind === 'FLATTENED' ? [a, b] : [b, a];
    if (ctx.flattenedAddresses) {
      const want = ctx.flattenedAddresses;
      const got = other.kind === 'DATA' ? other.values : [];
      return want.length === got.length && want.every((v, i) => v === got[i]) ? { status: 'MATCH', reason: `flattened ${f.target}` } : { status: 'DIFF', reason: `flattened ${f.target}` };
    }
    return { status: 'FLATTENED_UNVERIFIED', reason: `apex CNAME to ${f.target}; pass --flatten-via to resolve it` };
  }
  if (a.kind === 'EMPTY' || b.kind === 'EMPTY') {
    const other = a.kind === 'EMPTY' ? b : a;
    return other.kind === 'NODATA' || other.kind === 'NXDOMAIN' || other.kind === 'EMPTY' ? { status: 'MATCH', reason: 'lossy capture' } : { status: 'DIFF' };
  }
  if (a.kind !== b.kind) return { status: 'DIFF', reason: `${a.kind} vs ${b.kind}` };
  if (a.kind !== 'DATA') return { status: 'MATCH' };
  const eq = valuesEqual(a.values, b.values);
  if (eq === 'uncomparable') return { status: 'UNCOMPARABLE', reason: 'one side has RDATA in a form the tool cannot encode (zone-file text of an unsupported type)' };
  if (eq === 'diff') return { status: 'DIFF' };
  if (ctx.ttl === 'exact' && a.ttl != null && b.ttl != null && a.ttl !== b.ttl) return { status: 'TTL_DIFF', reason: `TTL ${a.ttl} vs ${b.ttl}` };
  if (typeof ctx.ttl === 'number') {
    const high = [a, b].filter((o) => o.ttl != null && o.ttl > ctx.ttl).map((o) => o.ttl);
    if (high.length) return { status: 'TTL_DIFF', reason: `TTL ${high.join('/')} above ${ctx.ttl}` };
  }
  return { status: 'MATCH', reason: eq === 'prefix-equal' ? 'lossy capture (prefix)' : undefined };
}

/** Statuses that fail the run (exit 1) and that make it incomplete (exit 2). */
export const FAILING = new Set(['DIFF', 'TTL_DIFF']);
export const INCOMPLETE = new Set(['ERROR', 'UNCOMPARABLE']);
