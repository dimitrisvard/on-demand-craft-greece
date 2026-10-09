// Orchestration: build the name × type list, query both sources, compare, classify, summarise.
import { isIPv6 } from 'node:net';
import { compareOutcomes, FAILING, INCOMPLETE, outcome } from './compare.mjs';
import { DEFAULT_TYPES, MICRONSHUB_NAMES, probeNames } from './defaults.mjs';
import { absolute, canonName, inZone, probeLabel, relative } from './names.mjs';
import { canonical, ipv6Canonical } from './rdata.mjs';
import { INFRA_TYPES, typeName, typeNumber, TYPES } from './types.mjs';

/** --forbid-target values in comparison form: lower case, no trailing dot, IPv6 in RFC 5952 form; '' when unusable. */
export function normaliseTarget(t) {
  const n = canonName(t);
  return isIPv6(n) ? ipv6Canonical(n) : n;
}

/**
 * The listed target that one answer value points at, or null. The checked RDATA is the last field of the value
 * ("CNAME cname.example.net" -> the CNAME target, "MX 10 mx.example.net" -> the exchange, "A 192.0.2.1" -> the
 * address); it matches a target it equals or ends with.
 * @param {string|{prefix?: string, uncomparable?: string}} value an outcome value
 * @param {string[]} targets normalised targets
 */
export function forbiddenIn(value, targets) {
  const text = typeof value === 'string' ? value : value.prefix ?? value.uncomparable ?? '';
  const last = canonName(text.trim().split(/\s+/).pop() ?? '');
  if (!last) return null;
  return targets.find((t) => last === t || last.endsWith(t)) ?? null;
}

function outcomeValues(o) {
  if (!o) return [];
  if (o.kind === 'DATA') return o.values;
  if (o.kind === 'FLATTENED') return [`CNAME ${o.target}`];
  return [];
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Name list: [{ name (absolute), why, types: number[] }]. */
export function buildNameList({ zone, defaultNames = true, extra = [], types = DEFAULT_TYPES, probeSeed, sources = [], includeInfra = false }) {
  const z = canonName(zone);
  const typeNums = types.map(typeNumber);
  const map = new Map();
  const add = (rel, why, t = typeNums) => {
    const name = absolute(rel, z);
    const cur = map.get(name);
    if (cur) {
      for (const x of t) if (!cur.types.includes(x)) cur.types.push(x);
      if (!cur.why.includes(why)) cur.why.push(why);
    } else {
      map.set(name, { name, why: [why], types: [...t] });
    }
  };
  if (defaultNames) {
    const list = z === 'micronshub.eu' ? MICRONSHUB_NAMES : [['@', 'apex'], ['www', 'www'], ['*', 'wildcard']];
    for (const [n, why] of list) add(n, why);
    for (const [n, why] of probeNames(probeLabel(probeSeed ?? 'dns-parity', z))) add(n, why);
  }
  for (const e of extra) add(e.name, e.why ?? '--names', e.types ? e.types.map(typeNumber) : typeNums);
  for (const s of sources) {
    for (const o of s.owners()) if (inZone(o, z)) add(relative(o, z), `owner in ${s.spec}`);
    for (const e of s.ents()) if (inZone(e, z)) add(relative(e, z), `empty non-terminal in ${s.spec}`);
  }
  for (const entry of map.values()) {
    entry.types = entry.types.filter((t) => {
      if (INFRA_TYPES.has(t)) return includeInfra;
      if (t === TYPES.NS && entry.name === z) return includeInfra;
      return true;
    });
    if (includeInfra && entry.name === z && !entry.types.includes(TYPES.SOA)) entry.types.push(TYPES.SOA);
  }
  return [...map.values()].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

function sameOutcome(x, y) {
  return x && y && x.kind === y.kind && JSON.stringify(x.values ?? null) === JSON.stringify(y.values ?? null);
}

function matchesAllow(entry, row) {
  if (canonName(entry.nameAbs) !== row.name) return false;
  if (entry.type && entry.type !== '*' && typeNumber(entry.type) !== row.qtype) return false;
  if (entry.statuses && !entry.statuses.includes(row.status)) return false;
  return true;
}

/**
 * @param {object} o
 * @param {string} o.zone
 * @param {object} o.a source
 * @param {object} o.b source
 * @param {Array} [o.names] extra names
 * @param {boolean} [o.defaultNames]
 * @param {string[]} [o.types]
 * @param {string} [o.probeSeed]
 * @param {'ignore'|'exact'|number} [o.ttl]
 * @param {'join'|'chunks'} [o.txt]
 * @param {boolean} [o.follow]
 * @param {object} [o.flattenVia] source used to resolve a flattened apex CNAME
 * @param {string[]} [o.expectProxied] relative names; '*' = the wildcard and every name it answers
 * @param {boolean} [o.expectDnsOnly]
 * @param {Array} [o.allow] [{id, name, type, statuses, reason, expires}]
 * @param {boolean} [o.includeInfra]
 * @param {string[]} [o.forbidTargets] any answer (either side) or record of a zone/cfapi source whose RDATA equals or
 *        ends with one of these is DIFF "forbidden target", whatever its status or allow-list entry
 * @param {number} [o.concurrency]
 * @param {Date} [o.now]
 */
export async function runParity(o) {
  const zone = canonName(o.zone);
  const list = buildNameList({ zone, defaultNames: o.defaultNames !== false, extra: o.names ?? [], types: o.types ?? DEFAULT_TYPES, probeSeed: o.probeSeed, sources: [o.a, o.b], includeInfra: !!o.includeInfra });
  const questions = list.flatMap((e) => e.types.map((t) => ({ name: e.name, qtype: t, why: e.why })));
  const opts = { txt: o.txt ?? 'join', follow: !!o.follow };
  const answers = await pool(questions, o.concurrency ?? 4, async (q) => {
    const [ra, rb] = await Promise.all([o.a.query(q.name, q.qtype), o.b.query(q.name, q.qtype)]);
    return { a: outcome(ra, q.name, q.qtype, opts), b: outcome(rb, q.name, q.qtype, opts), adA: ra.ad, adB: rb.ad };
  });
  const byKey = new Map(questions.map((q, i) => [`${q.name}|${q.qtype}`, answers[i]]));
  const wild = (side, qtype) => byKey.get(`*.${zone}|${qtype}`)?.[side];
  const ents = new Set([...o.a.ents(), ...o.b.ents()].map(canonName));
  if (zone === 'micronshub.eu') ents.add(`_domainkey.${zone}`);
  const expect = new Set((o.expectProxied ?? []).map((n) => absolute(n, zone)));
  const now = o.now ?? new Date();
  const allow = (o.allow ?? []).map((e) => ({ ...e, nameAbs: absolute(e.name, zone) }))
    .filter((e) => !e.expires || new Date(e.expires) >= now);

  const rows = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const { a, b } = answers[i];
    const viaWildcard = sameOutcome(a, wild('a', q.qtype)) && q.name !== `*.${zone}`;
    const expectProxied = expect.has(q.name) || (expect.has(`*.${zone}`) && (q.name === `*.${zone}` || viaWildcard));
    let flattenedAddresses = null;
    const flat = a.kind === 'FLATTENED' ? a : b.kind === 'FLATTENED' ? b : null;
    if (flat && o.flattenVia && (q.qtype === TYPES.A || q.qtype === TYPES.AAAA)) {
      const r = outcome(await o.flattenVia.query(flat.target, q.qtype), flat.target, q.qtype, opts);
      flattenedAddresses = r.kind === 'DATA' ? r.values : [];
    }
    const ttl = o.ttl === 'exact' ? 'exact' : typeof o.ttl === 'number' ? o.ttl : 'ignore';
    let res = compareOutcomes(a, b, { qtype: q.qtype, ttl, expectProxied, proxiedSide: 'b', flattenedAddresses });
    const row = { name: q.name, rel: relative(q.name, zone), qtype: q.qtype, type: typeName(q.qtype), status: res.status, reason: res.reason, a, b };
    // Empty non-terminal: one side NODATA/NXDOMAIN, the other answers exactly what its own wildcard answers.
    const underEnt = ents.has(q.name) || [...ents].some((e) => q.name.endsWith(`.${e}`));
    if (row.status === 'DIFF' && underEnt) {
      const aWild = sameOutcome(a, wild('a', q.qtype));
      const bWild = sameOutcome(b, wild('b', q.qtype));
      const empty = (x) => x.kind === 'NODATA' || x.kind === 'NXDOMAIN' || x.kind === 'EMPTY';
      if ((aWild && empty(b)) || (bWild && empty(a))) {
        row.status = 'EXPECTED_ENT';
        row.reason = 'wildcard at an empty non-terminal: RFC 4592 vs Cloudflare standard nameservers (CF docs wildcard-dns-records, Example 2)';
      }
    }
    if (FAILING.has(row.status) || INCOMPLETE.has(row.status)) {
      const hit = allow.find((e) => matchesAllow(e, row));
      if (hit) { row.was = row.status; row.status = 'ALLOWED'; row.reason = `${hit.id}: ${hit.reason}`; }
    }
    rows.push(row);
  }
  if (o.expectDnsOnly) {
    for (const s of [o.a, o.b]) {
      if (!s.model || s.semantics !== 'cloudflare') continue;
      for (const rr of s.model.proxiedRecords()) {
        rows.push({ name: rr.name, rel: relative(rr.name, zone), qtype: rr.type, type: typeName(rr.type), status: 'DIFF', reason: `proxied record in ${s.spec} while --expect-dns-only (runbook S4: every record DNS only)`, a: null, b: null });
      }
    }
  }
  // --forbid-target: checked after the allow-list, so no entry can accept an answer that points at a listed target.
  const forbid = (o.forbidTargets ?? []).map(normaliseTarget).filter(Boolean);
  if (forbid.length) {
    const flagged = new Set();
    const extra = [];
    for (const row of rows) {
      for (const [side, out] of [['A', row.a], ['B', row.b]]) {
        const hit = outcomeValues(out).map((v) => [v, forbiddenIn(v, forbid)]).find(([, t]) => t);
        if (!hit) continue;
        const reason = `forbidden target ${hit[1]}: side ${side} answers ${typeof hit[0] === 'string' ? hit[0] : hit[0].prefix ?? hit[0].uncomparable}`;
        flagged.add(row.name);
        if (INCOMPLETE.has(row.status)) {
          extra.push({ ...row, status: 'DIFF', reason, was: row.status });
        } else {
          if (row.status !== 'DIFF') row.was = row.was ?? row.status;
          row.status = 'DIFF';
          row.reason = reason;
        }
        break;
      }
    }
    rows.push(...extra);
    // Records the simulated answers hide (a proxied CNAME, a type outside --types) are checked in the source itself.
    for (const s of [o.a, o.b]) {
      if (!s.model) continue;
      for (const rr of s.model.records()) {
        if (flagged.has(rr.name)) continue;
        let value;
        try { value = `${typeName(rr.type)} ${canonical(rr, opts)}`; } catch { continue; }
        const t = forbiddenIn(value, forbid);
        if (!t) continue;
        flagged.add(rr.name);
        rows.push({ name: rr.name, rel: relative(rr.name, zone), qtype: rr.type, type: typeName(rr.type), status: 'DIFF', reason: `forbidden target ${t}: ${rr.proxied ? 'proxied ' : ''}record in ${s.spec}: ${value}`, a: null, b: null });
      }
    }
  }
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const incomplete = rows.some((r) => INCOMPLETE.has(r.status));
  const failing = rows.some((r) => FAILING.has(r.status));
  const exitCode = incomplete ? 2 : failing ? 1 : 0;
  return { zone, a: o.a.spec, b: o.b.spec, questions: questions.length, counts, exitCode, rows, generatedAt: now.toISOString() };
}
