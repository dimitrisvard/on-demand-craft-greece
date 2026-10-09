#!/usr/bin/env node
// Builds the Single Redirect ruleset for micronshub.eu (docs/migration/PLAN.md §6.2 S11/S13, SEO_PARITY.md §8 rows
// 22-23) from the P0-3/S11 baseline snapshot of scripts/seo-parity.mjs, so the apex and HTTP -> HTTPS redirects
// answer with the status codes and hop order Vercel used. Prints the payload for
//   PUT /zones/<ZONE_ID>/rulesets/phases/http_request_dynamic_redirect/entrypoint
// and a summary; never calls the Cloudflare API (the owner applies it, runbook S11).
//
//   node scripts/phase3/redirect-rules.mjs --baseline <snapshot dir> --out redirect-rules.json
//   node scripts/phase3/redirect-rules.mjs --default --out redirect-rules.json     (308 / 308, two hops)
//   add --path-field normalised only if the Rulesets API refuses raw.http.request.uri.path in a target expression
//
// Exit 0: payload written. 1: the baseline contradicts an assumption the rules rely on (a variant failed or did not
// redirect, path or query not kept, status outside 301/302/307/308, inconsistent statuses, unexpected hop order).
// 64: usage. The baseline is the snapshot of `--capture --base https://www.micronshub.eu` (SEO_PARITY.md B5).
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const APEX = 'micronshub.eu';
export const WWW = 'www.micronshub.eu';
const ALLOWED = new Set([301, 302, 307, 308]);

/** Minimal reader of a seo-parity snapshot: url -> GET record { hops, error, stop }. */
export function readSnapshotGets(dir) {
  const map = new Map();
  for (const line of readFileSync(path.join(dir, 'results.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.method === 'GET') map.set(r.url, r);
  }
  return map;
}

const redirectHops = (rec) => (rec?.hops ?? []).filter((h) => h.status >= 300 && h.status < 400);

/**
 * Read the G9 apex and http:// variants.
 * @param {Map<string, {hops: Array<{url, status, location, headers}>}>} gets
 */
export function deriveFromBaseline(gets) {
  const problems = [];
  const need = (url) => {
    const r = gets.get(url);
    if (!r) problems.push(`baseline has no GET record for ${url}`);
    else if (r.error) problems.push(`baseline GET ${url} failed: ${r.error}`);
    return r;
  };
  const apexCases = [
    ['https://micronshub.eu/', 'https://www.micronshub.eu/'],
    ['https://micronshub.eu/en/services', 'https://www.micronshub.eu/en/services'],
    ['https://micronshub.eu/logo.png', 'https://www.micronshub.eu/logo.png'],
    ['https://micronshub.eu/api/marketing?action=track&parity=1', 'https://www.micronshub.eu/api/marketing?action=track&parity=1'],
  ];
  // The redirect hops of an entry; a usable record that answered without one is a contradiction.
  const redirectsOf = (url) => {
    const r = need(url);
    const hops = redirectHops(r);
    if (r && !r.error && !hops.length) problems.push(`${url} did not redirect`);
    return hops;
  };
  const apexStatuses = new Set();
  for (const [from, to] of apexCases) {
    const first = redirectsOf(from)[0];
    if (!first) continue;
    apexStatuses.add(first.status);
    if (first.location !== to) problems.push(`${from} -> ${first.location}, expected ${to} (path and query kept)`);
  }
  if (apexStatuses.size > 1) problems.push(`apex redirects use several statuses: ${[...apexStatuses].join(', ')}`);
  const apexStatus = [...apexStatuses][0];
  const httpWww = redirectsOf(`http://${WWW}/en`);
  const httpStatus = httpWww[0]?.status;
  if (httpWww[0] && httpWww[0].location !== `https://${WWW}/en`) problems.push(`http://${WWW}/en -> ${httpWww[0].location}, expected https://${WWW}/en`);
  // http://apex: HTTPS first (to https://apex, then the apex redirect) or the apex redirect first (straight to
  // https://www). A capture with base https://www.micronshub.eu does not follow the hop to https://apex (another
  // origin), so the HTTPS-first chain is recorded as that one hop; a capture that follows it records both.
  const httpApex = redirectsOf(`http://${APEX}/en`);
  const [first, second] = httpApex;
  let order = null;
  if (first?.location === `https://${APEX}/en` && (httpApex.length === 1 || (httpApex.length === 2 && second.location === `https://${WWW}/en`))) order = 'https-first';
  else if (httpApex.length === 1 && first.location === `https://${WWW}/en`) order = 'apex-first';
  else if (httpApex.length) problems.push(`http://${APEX}/en chain ${httpApex.map((h) => `${h.status} ${h.location}`).join(' -> ')} matches neither hop order`);
  for (const [what, s] of [...[...apexStatuses].map((x) => ['apex', x]), ['http', httpStatus]]) {
    if (s !== undefined && !ALLOWED.has(s)) problems.push(`${what} status ${s} is not available in a Single Redirect (301, 302, 307, 308)`);
  }
  // Each hop of http://apex is answered by one of the two rules, so its status must be that rule's status.
  if (order === 'https-first' && httpStatus !== undefined && first.status !== httpStatus) problems.push(`HTTP -> HTTPS status differs between hosts (${first.status} vs ${httpStatus})`);
  if (order === 'https-first' && second && apexStatus !== undefined && second.status !== apexStatus) problems.push(`https://${APEX}/en answered ${second.status}, the other apex redirects ${apexStatus}`);
  if (order === 'apex-first' && apexStatus !== undefined && first.status !== apexStatus) problems.push(`http://${APEX}/en answered ${first.status} straight to www, the apex redirects ${apexStatus}`);
  // HSTS as Vercel sent it: on the www page, on the apex redirect, on a tenant host. A snapshot keys the pages of its
  // base host by path ("/en"), so pages are found by the URL of the hop that answered them, in any record.
  const header = (url, idx) => gets.get(url)?.hops?.[idx]?.headers?.['strict-transport-security'] ?? null;
  const www = pageHsts(gets, `https://${WWW}/en`);
  if (!www.found) problems.push(`baseline has no answer for https://${WWW}/en (HSTS on www unknown)`);
  const hsts = {
    www: www.value,
    apexRedirect: header(`https://${APEX}/`, 0),
    tenant: pageHsts(gets, `https://laserkritis.${APEX}/en`).value,
  };
  return { apexStatus, httpStatus, order, hsts, problems };
}

/** Strict-Transport-Security of the non-redirect answers for `url` in any GET record: { found, value }. */
export function pageHsts(gets, url) {
  let found = false;
  for (const rec of gets.values()) {
    for (const h of rec.hops ?? []) {
      if (h.url !== url || (h.status >= 300 && h.status < 400)) continue;
      found = true;
      const v = h.headers?.['strict-transport-security'];
      if (v) return { found, value: v };
    }
  }
  return { found, value: null };
}

/** Path fields a target may use: the raw path keeps the request's own percent-encoding, as Vercel's redirect does. */
export const PATH_FIELDS = Object.freeze({ raw: 'raw.http.request.uri.path', normalised: 'http.request.uri.path' });

/** The ruleset payload. `pathField` 'normalised' only if the Rulesets API refuses the raw field in a target. */
export function buildRuleset({ apexStatus = 308, httpStatus = 308, order = 'https-first', pathField = 'raw' } = {}) {
  const field = PATH_FIELDS[pathField];
  if (!field) throw new Error(`unknown path field ${pathField}`);
  const httpRule = {
    ref: 'microns_http_to_https',
    description: 'HTTP to HTTPS, same host, path and query (status from the P0-3 baseline)',
    expression: '(not ssl)',
    action: 'redirect',
    action_parameters: { from_value: { target_url: { expression: `concat("https://", http.host, ${field})` }, status_code: httpStatus, preserve_query_string: true } },
  };
  const apexRule = {
    ref: 'microns_apex_to_www',
    description: 'Apex to www, path and query kept (status from the P0-3 baseline)',
    expression: `(http.host eq "${APEX}")`,
    action: 'redirect',
    action_parameters: { from_value: { target_url: { expression: `concat("https://${WWW}", ${field})` }, status_code: apexStatus, preserve_query_string: true } },
  };
  return {
    description: 'microns: apex and HTTP redirects (docs/migration/PLAN.md S13; generated by scripts/phase3/redirect-rules.mjs)',
    rules: order === 'apex-first' ? [apexRule, httpRule] : [httpRule, apexRule],
  };
}

/** What the Worker and the zone should do about HSTS, from the baseline headers. */
export function hstsAdvice(h) {
  if (!h.www && !h.apexRedirect && !h.tenant) return { mode: 'none', note: 'Vercel sent no HSTS: leave HSTS_VALUE unset and zone HSTS off' };
  if (h.www && !h.apexRedirect && !h.tenant) return { mode: 'worker', value: h.www, note: 'set env.production vars.HSTS_VALUE to this value; zone HSTS off' };
  const values = new Set([h.www, h.apexRedirect, h.tenant].filter(Boolean));
  return { mode: 'zone', value: [...values].join(' | '), note: 'HSTS on several hosts: zone HSTS (SSL/TLS > Edge Certificates) with these values, HSTS_VALUE unset; one mechanism only, so no response carries it twice' };
}

async function main(argv) {
  let a;
  try {
    ({ values: a } = parseArgs({ args: argv, options: { baseline: { type: 'string' }, default: { type: 'boolean' }, out: { type: 'string' }, 'path-field': { type: 'string' } } }));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 64;
  }
  if (!!a.baseline === !!a.default) { process.stderr.write('use exactly one of --baseline <dir> or --default\n'); return 64; }
  const pathField = a['path-field'] ?? 'raw';
  if (!PATH_FIELDS[pathField]) { process.stderr.write('--path-field must be raw or normalised\n'); return 64; }
  let derived = { apexStatus: 308, httpStatus: 308, order: 'https-first', hsts: null, problems: [] };
  if (a.baseline) {
    let gets;
    try { gets = readSnapshotGets(a.baseline); } catch (e) { process.stderr.write(`cannot read the baseline snapshot ${a.baseline}: ${e.message}\n`); return 64; }
    derived = deriveFromBaseline(gets);
  }
  const ruleset = buildRuleset({ ...derived, pathField });
  const text = `${JSON.stringify(ruleset, null, 2)}\n`;
  if (a.out) writeFileSync(a.out, text); else process.stdout.write(text);
  process.stderr.write(`apex ${derived.apexStatus}, http ${derived.httpStatus}, order ${derived.order}${a.default ? ' (defaults, no baseline read)' : ''}${pathField === 'raw' ? '' : `, path field ${PATH_FIELDS[pathField]}`}\n`);
  if (derived.hsts) { const h = hstsAdvice(derived.hsts); process.stderr.write(`HSTS: ${h.mode}${h.value ? ` = ${h.value}` : ''}; ${h.note}\n`); }
  for (const p of derived.problems) process.stderr.write(`problem: ${p}\n`);
  process.stderr.write('apply: curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --json @<file>\n');
  return derived.problems.length ? 1 : 0;
}

/** True when Node started this file, also through a symlinked path (Node runs the resolved file). */
function startedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (startedDirectly()) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
