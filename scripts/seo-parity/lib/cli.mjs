// Command line of scripts/seo-parity.mjs (SEO_PARITY.md §5).
//
// Exit codes (§5.4): 0 valid run, 0 unexplained differences; 1 valid run with
// at least one fail; 2 usage or input error; 3 invalid run (challenge from the
// base, Access login from the candidate, error rate > 0.5 %, volatile window).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { parseArgs } from 'node:util';
import {
  DEFAULT_CONCURRENCY, DEFAULT_MAX_HOPS, DEFAULT_RECHECK_AFTER_S, DEFAULT_SEED, DEFAULT_TIMEOUT_MS,
  ERROR_RATE_LIMIT, GROUPS, PRODUCTION_ORIGIN, PROFILES, TOOL_NAME, TOOL_VERSION, USER_AGENT,
} from './constants.mjs';
import { applyAllow, loadAllowList } from './allow.mjs';
import { compareEntry, fieldValue, originNormaliser } from './compare.mjs';
import { evidenceCheck, sidePlatforms } from './evidence.mjs';
import { accessTransportOk, HttpClient, isChallenge } from './fetch.mjs';
import { writeDiffFile, writeReport } from './report.mjs';
import { eligibleForRecheck, runRecheck } from './recheck.mjs';
import { captureSide, maxAttempts, recordError } from './run.mjs';
import { BodyStore, loadSnapshot, SnapshotWriter } from './snapshot.mjs';
import { loadSources } from './sources.mjs';
import { buildUrlSet, entryInProfile, fetchInputs, GeneratorError } from './urls.mjs';
import { InvalidRunError, isoDate, pool, runId, sha256, UsageError } from './util.mjs';
import { blogIndexPaths, VOLATILE_RULES } from './volatile.mjs';
import { checkEnd, checkStart, OVERRIDE_BANNER } from './window.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DEFAULT_ALLOW = path.join(REPO_ROOT, 'scripts', 'seo-parity.allow.json');

const OPTIONS = {
  'generate-urls': { type: 'boolean' },
  capture: { type: 'boolean' },
  base: { type: 'string' },
  candidate: { type: 'string' },
  'candidate-role': { type: 'string' },
  urls: { type: 'string' },
  snapshot: { type: 'string' },
  allow: { type: 'string' },
  concurrency: { type: 'string' },
  'access-client-id': { type: 'string' },
  'access-client-secret': { type: 'string' },
  out: { type: 'string' },
  profile: { type: 'string' },
  only: { type: 'string' },
  seed: { type: 'string' },
  'recheck-after': { type: 'string' },
  'normalise-asset-hashes': { type: 'boolean' },
  'max-hops': { type: 'string' },
  timeout: { type: 'string' },
  'sitemap-file': { type: 'string' },
  'shell-file': { type: 'string' },
  vantage: { type: 'string' },
  'bypass-method': { type: 'string' },
  'changed-since-capture': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const HELP = `${TOOL_NAME} ${TOOL_VERSION} — SEO parity diff (docs/migration/SEO_PARITY.md §5)

Modes
  --generate-urls --base <origin> [--profile gate|full] [--seed <s>] --out <file>
                  [--sitemap-file <path>] [--shell-file <path>]   (local inputs instead of the base)
  --capture --base <origin> --urls <file> --snapshot <dir> [--vantage <v>] [--bypass-method <m>]
  --base <origin> --candidate <origin> --urls <file> [--out <dir>]          live vs live
  --snapshot <dir> --candidate <origin> [--out <dir>]                       snapshot vs live
  --snapshot <dir> --candidate snapshot:<dir> [--out <dir>]                 snapshot vs snapshot

Flags
  --candidate-role preview|production  default: preview for *.workers.dev or PREVIEW_HOSTNAMES
  --allow <file>            default scripts/seo-parity.allow.json
  --concurrency <n>         default ${DEFAULT_CONCURRENCY}
  --access-client-id, --access-client-secret
                            default env CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (prefer the env)
  --profile gate|full|sitemaps|redirects|variants|api   default gate
  --only <group>            G1…G10 or sitemaps|redirects|variants|api
  --seed <s>                default ${DEFAULT_SEED}
  --recheck-after <s>       default ${DEFAULT_RECHECK_AFTER_S}; 0 disables
  --normalise-asset-hashes  F25
  --max-hops <n>            default ${DEFAULT_MAX_HOPS}
  --timeout <ms>            default ${DEFAULT_TIMEOUT_MS}
  --changed-since-capture <text>
                            snapshot vs live only: what changed on the platform since the capture
                            (e.g. the Phase 7 data backend switch); recorded in the report

Environment
  SUPABASE_URL, SUPABASE_ANON_KEY   URL generator (G2, G3)
  PARITY_IGNORE_WINDOW=1            ignore the 06:55–10:05 / 09:00 / 00:00 UTC window rule; run NOT SIGNABLE

Exit codes: 0 pass · 1 fail · 2 usage/input error · 3 invalid run
Never signable (the run still executes; report.json "signable": false): a self-diff (same origin
live vs live; the same snapshot or a copy; a Vercel snapshot vs its own origin still on Vercel),
every snapshot-vs-snapshot run (B6 noise floor, or captures of two origins), a snapshot vs its
own origin on the same non-Vercel platform unless --changed-since-capture states what changed, and
a live candidate that answers from Vercel only (every §1 candidate is a Cloudflare deployment).`;

function intFlag(v, name, def, min = 0) {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} must be an integer >= ${min}`);
  return n;
}

function origin(v, name) {
  let u;
  try { u = new URL(v); } catch { throw new UsageError(`--${name} must be an origin such as https://www.micronshub.eu`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new UsageError(`--${name} must be http(s)`);
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) throw new UsageError(`--${name} must be an origin without a path`);
  return u.origin;
}

export function autoRole(candOrigin, env = process.env) {
  const host = new URL(candOrigin).hostname;
  const preview = (env.PREVIEW_HOSTNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return host.endsWith('.workers.dev') || preview.includes(host.toLowerCase()) ? 'preview' : 'production';
}

function selectEntries(urlsDoc, profile, only) {
  let list = urlsDoc.entries.filter((e) => entryInProfile(e, profile));
  if (only) {
    const g = { sitemaps: 'G5', redirects: 'G6', variants: 'G9', api: 'G10' }[only] || only;
    if (!GROUPS.includes(g)) throw new UsageError(`--only must be one of ${GROUPS.join(', ')} or sitemaps|redirects|variants|api`);
    list = list.filter((e) => e.group === g);
  }
  // An empty selection would be a vacuous, signable pass: refuse it.
  if (!list.length) throw new UsageError(`no entries selected (profile ${profile}${only ? `, --only ${only}` : ''}, ${urlsDoc.entries.length} entries in the URL set)`);
  return list;
}

const isAbsolute = (u) => /^https?:\/\//.test(u);

/**
 * An absolute entry (G9 apex, http://, tenant and wildcard hosts) is requested
 * as written, whatever the side's origin. It tests a side only when that side
 * is the production origin; otherwise both sides would fetch production.
 */
function absoluteNotApplicable(entry, liveOrigins) {
  if (!isAbsolute(entry.url)) return null;
  const other = liveOrigins.filter((o) => o !== PRODUCTION_ORIGIN);
  if (!other.length) return null;
  return `${entry.na_preview || 'not-applicable'}: ${new URL(entry.url).host} is not served by ${other.join(', ')}`;
}

/** Check that snapshot records join the selected entries by id, URL and method set. */
function checkSnapshotJoin(snap, label, entries) {
  const problems = [];
  for (const e of entries) {
    const rec = snap.records.get(e.id);
    if (!rec) continue; // reported per entry as an error ("missing in the … snapshot")
    if (rec.url !== undefined && rec.url !== e.url) problems.push(`${e.id}: --urls has ${e.url}, the ${label} snapshot has ${rec.url}`);
    else if (!rec.not_requested) {
      const missing = e.methods.filter((m) => !rec.methods[m]);
      if (missing.length) problems.push(`${e.id} ${e.url}: method${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not in the ${label} snapshot`);
    }
  }
  if (problems.length) {
    throw new UsageError(`the URL set does not match the ${label} snapshot ${snap.dir} (${problems.length} entr${problems.length === 1 ? 'y' : 'ies'}; use the snapshot's own urls.json):\n  - ${problems.slice(0, 20).join('\n  - ')}`);
  }
}

/** A snapshot used as a base or candidate must come from a valid capture. */
function snapshotState(snap, label) {
  const m = snap.manifest || {};
  if (m.valid !== true) {
    const why = Array.isArray(m.invalid_reasons) && m.invalid_reasons.length ? m.invalid_reasons.join('; ') : 'manifest.valid is not true';
    throw new InvalidRunError(`the ${label} snapshot ${snap.dir} is from an invalid capture (${why}); an invalid capture is repeated, never used`);
  }
  return { dir: snap.dir, valid: true, tool_version: m.tool_version ?? null, window_override: Boolean(m.window?.override), started_at: m.started_at ?? null, finished_at: m.finished_at ?? null, base: m.base ?? null };
}

function readUrls(file) {
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new UsageError(`--urls ${file}: unreadable (${e.message})`); }
  if (!doc || !Array.isArray(doc.entries)) throw new UsageError(`--urls ${file}: no entries array`);
  for (const e of doc.entries) {
    if (!e.id || !e.url || !Array.isArray(e.methods)) throw new UsageError(`--urls ${file}: malformed entry ${JSON.stringify(e).slice(0, 80)}`);
    for (const m of e.methods) if (!['GET', 'HEAD', 'OPTIONS'].includes(m)) throw new UsageError(`--urls ${file}: entry ${e.id} lists method ${m}; only GET, HEAD and OPTIONS are ever sent`);
  }
  return doc;
}

function accessFromArgs(a, env, log) {
  const id = a['access-client-id'] ?? env.CF_ACCESS_CLIENT_ID;
  const secret = a['access-client-secret'] ?? env.CF_ACCESS_CLIENT_SECRET;
  if (a['access-client-secret'] !== undefined) log('warning: --access-client-secret on the command line is visible in the process list; prefer CF_ACCESS_CLIENT_SECRET');
  if ((id && !secret) || (!id && secret)) throw new UsageError('Access needs both the client id and the client secret');
  return id && secret ? { id, secret } : null;
}

const CHANGED_ONLY = '--changed-since-capture applies only to snapshot vs live (--snapshot <dir> --candidate <origin>)';

/** Main entry; returns the exit code. */
export async function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, err: console.error }) {
  try {
    return await mainInner(argv, env, io);
  } catch (e) {
    if (e instanceof UsageError || e instanceof GeneratorError) { io.err(`error: ${e.message}`); return 2; }
    if (e instanceof InvalidRunError) { io.err(`INVALID RUN: ${e.message}`); return 3; }
    io.err(`error: ${e.stack || e.message}`);
    return 2;
  }
}

async function mainInner(argv, env, io) {
  let a;
  try { ({ values: a } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false })); } catch (e) { throw new UsageError(e.message); }
  if (a.help) { io.log(HELP); return 0; }
  const profile = a.profile ?? 'gate';
  if (!PROFILES.includes(profile)) throw new UsageError(`--profile must be one of ${PROFILES.join(', ')}`);
  const common = {
    profile,
    seed: a.seed ?? DEFAULT_SEED,
    concurrency: intFlag(a.concurrency, 'concurrency', DEFAULT_CONCURRENCY, 1),
    maxHops: intFlag(a['max-hops'], 'max-hops', DEFAULT_MAX_HOPS, 0),
    timeoutMs: intFlag(a.timeout, 'timeout', DEFAULT_TIMEOUT_MS, 1),
    recheckAfter: intFlag(a['recheck-after'], 'recheck-after', DEFAULT_RECHECK_AFTER_S, 0),
    retryBaseMs: env.PARITY_RETRY_BASE_MS ? Number(env.PARITY_RETRY_BASE_MS) : 1000,
  };
  if (a['changed-since-capture'] !== undefined && (a['generate-urls'] || a.capture)) throw new UsageError(CHANGED_ONLY);
  if (a['generate-urls']) return generate(a, common, env, io);
  if (a.capture) return capture(a, common, env, io);
  return compare(a, common, env, io);
}

function startWindow(io, env, live) {
  const started = new Date();
  if (!live) return { started, override: false };
  const w = checkStart(started, env);
  if (w.override) io.err(OVERRIDE_BANNER);
  if (w.refuse) throw new InvalidRunError(w.refuse);
  return { started, override: w.override };
}

async function generate(a, c, env, io) {
  if (!a.out) throw new UsageError('--generate-urls needs --out <file>');
  if (!a.base && !(a['sitemap-file'] && a['shell-file'])) throw new UsageError('--generate-urls needs --base (or both --sitemap-file and --shell-file)');
  const base = a.base ? origin(a.base, 'base') : null;
  const { started } = startWindow(io, env, true);
  const src = await loadSources(REPO_ROOT);
  const client = new HttpClient({ side: 'base', timeoutMs: c.timeoutMs, retryBaseMs: c.retryBaseMs });
  const inputs = await fetchInputs({
    base, sitemapFile: a['sitemap-file'], shellFile: a['shell-file'], client, env,
    onResponse: (res) => { const ch = isChallenge(res.status, res.headers); if (ch) throw new InvalidRunError(`challenge from the base (${ch})`); },
  });
  const doc = buildUrlSet({ root: REPO_ROOT, src, base, profile: c.profile, seed: c.seed, ...inputs, now: started });
  const end = checkEnd(started, new Date(), env);
  if (end.invalid) throw new InvalidRunError(`the generator run crossed ${end.crossed.join(', ')}`);
  mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
  writeFileSync(a.out, `${JSON.stringify(doc, null, 2)}\n`);
  io.log(`urls: ${doc.entries.length} entries (profile ${c.profile}) written to ${a.out}`);
  io.log(`per group (selected): ${JSON.stringify(doc.counts.per_group)}`);
  io.log(`per group (all):      ${JSON.stringify(doc.counts.all_per_group)}`);
  io.log(`sources: service_pages ${doc.sources.service_pages} rows, content_pages ${doc.sources.content_pages} rows, sitemap ${doc.sources.sitemap_locs} <loc> (${doc.sources.sitemap_source})`);
  for (const w of doc.warnings) io.log(`warning: ${w}`);
  return 0;
}

async function capture(a, c, env, io) {
  if (!a.base || !a.urls || !a.snapshot) throw new UsageError('--capture needs --base, --urls and --snapshot');
  if (a.candidate) throw new UsageError('--capture takes no --candidate');
  const base = origin(a.base, 'base');
  const urlsDoc = readUrls(a.urls);
  const entries = selectEntries(urlsDoc, c.profile, a.only);
  if (existsSync(path.join(a.snapshot, 'manifest.json'))) throw new UsageError(`--snapshot ${a.snapshot} already holds a snapshot`);
  const { started, override } = startWindow(io, env, true);
  const writer = new SnapshotWriter(a.snapshot);
  const urlsUsed = { ...urlsDoc, profile: c.profile, only: a.only ?? null, entries };
  const urlsSha = writer.writeUrls(urlsUsed);
  const client = new HttpClient({ side: 'base', timeoutMs: c.timeoutMs, retryBaseMs: c.retryBaseMs });
  const invalid = [];
  let errors = 0;
  await pool(entries, c.concurrency, async (entry) => {
    const na = absoluteNotApplicable(entry, [base]);
    if (na) { writer.writeEntry(entry, { methods: {}, not_requested: na }); return; }
    const rec = await captureSide(entry, { client, origin: base, baseOrigin: base, side: 'base', maxHops: c.maxHops, store: writer.store });
    for (const i of rec.issues) if (i.kind === 'challenge') invalid.push(`challenge from the base at ${i.url} (${i.detail})`);
    if (recordError(rec)) errors += 1;
    writer.writeEntry(entry, rec);
  }, () => invalid.length > 0);
  const finished = new Date();
  const end = checkEnd(started, finished, env);
  if (end.invalid) invalid.push(`the run crossed ${end.crossed.join(', ')} (volatile window)`);
  if (entries.length && errors / entries.length > ERROR_RATE_LIMIT) invalid.push(`error rate ${(100 * errors / entries.length).toFixed(2)} % > 0.5 %`);
  const manifest = {
    tool: TOOL_NAME, tool_version: TOOL_VERSION, kind: 'capture',
    started_at: started.toISOString(), finished_at: finished.toISOString(),
    base, user_agent: USER_AGENT, vantage: a.vantage ?? 'unspecified', bypass_method: a['bypass-method'] ?? 'unspecified',
    urls_sha256: urlsSha, profile: c.profile, only: a.only ?? null, seed: urlsDoc.seed ?? null,
    entries: entries.length, request_lines: writer.lines, errors,
    requests_per_host: Object.fromEntries(client.requestsPerHost),
    valid: invalid.length === 0, invalid_reasons: invalid,
    window: { override, crossed: end.crossed },
    node: process.version,
  };
  await writer.close(manifest);
  io.log(`capture: ${entries.length} entries, ${writer.lines} request lines, ${errors} errors → ${a.snapshot}`);
  if (invalid.length) { io.err(`INVALID CAPTURE: ${invalid.join('; ')}`); return 3; }
  return 0;
}

async function compare(a, c, env, io) {
  if (!a.candidate) throw new UsageError('nothing to do: give --generate-urls, --capture or --candidate (see --help)');
  if (a.base && a.snapshot) throw new UsageError('give either --base (live) or --snapshot (stored base), not both');
  if (!a.base && !a.snapshot) throw new UsageError('compare needs --base <origin> or --snapshot <dir>');
  const log = io.log;
  const baseSnap = a.snapshot ? loadSnapshot(a.snapshot) : null;
  const candSnap = a.candidate.startsWith('snapshot:') ? loadSnapshot(a.candidate.slice('snapshot:'.length)) : null;
  const snapshots = {
    base: baseSnap ? snapshotState(baseSnap, 'base') : null,
    candidate: candSnap ? snapshotState(candSnap, 'candidate') : null,
  };
  const baseOrigin = baseSnap ? origin(baseSnap.manifest.base, 'snapshot base') : origin(a.base, 'base');
  const candOrigin = candSnap ? origin(candSnap.manifest.base, 'candidate snapshot base') : origin(a.candidate, 'candidate');
  const mode = baseSnap ? (candSnap ? 'snapshot-vs-snapshot' : 'snapshot-vs-live') : (candSnap ? null : 'live-vs-live');
  if (!mode) throw new UsageError('a snapshot candidate needs a snapshot base (--snapshot)');
  let changedSinceCapture = null;
  if (a['changed-since-capture'] !== undefined) {
    if (mode !== 'snapshot-vs-live') throw new UsageError(CHANGED_ONLY);
    changedSinceCapture = a['changed-since-capture'].replace(/\s+/g, ' ').trim();
    if (!changedSinceCapture) throw new UsageError('--changed-since-capture needs a description of what changed since the capture');
  }
  let role = a['candidate-role'] ?? autoRole(candOrigin, env);
  if (!['preview', 'production'].includes(role)) throw new UsageError('--candidate-role must be preview or production');
  const urlsDoc = a.urls ? readUrls(a.urls) : baseSnap ? baseSnap.urls : null;
  if (!urlsDoc) throw new UsageError('live vs live needs --urls');
  const entries = selectEntries(urlsDoc, c.profile, a.only);
  if (baseSnap) checkSnapshotJoin(baseSnap, 'base', entries);
  if (candSnap) checkSnapshotJoin(candSnap, 'candidate', entries);
  const today = isoDate(new Date());
  const allowList = loadAllowList(a.allow ?? DEFAULT_ALLOW, today);
  const access = accessFromArgs(a, env, io.err);
  if (access && candSnap) throw new UsageError('Access credentials are only used with a live candidate');
  if (access && !accessTransportOk(candOrigin)) throw new UsageError(`Access credentials are sent only over https (or http to a loopback host); the candidate is ${candOrigin}`);
  const id = runId();
  const outDir = a.out ?? path.join('parity-out', id.replace(/:/g, ''));
  mkdirSync(outDir, { recursive: true });
  const live = mode !== 'snapshot-vs-snapshot';
  const { started, override } = startWindow(io, env, live);
  const liveStore = new BodyStore(path.join(outDir, 'raw'));
  const stores = { base: baseSnap ? baseSnap.store : liveStore, candidate: candSnap ? candSnap.store : liveStore };
  const baseClient = baseSnap ? null : new HttpClient({ side: 'base', timeoutMs: c.timeoutMs, retryBaseMs: c.retryBaseMs });
  const candClient = candSnap ? null : new HttpClient({ side: 'candidate', timeoutMs: c.timeoutMs, retryBaseMs: c.retryBaseMs, access: access ? { origin: candOrigin, ...access } : null });
  const invalid = [];
  const assetPairs = [];
  // Rule blog-index-article-list (volatile.mjs) applies in snapshot mode to
  // the blog index URLs of the handler's slug table only.
  let blogPaths = null;
  if (baseSnap && entries.some((e) => e.kind === 'blog-index')) {
    try { blogPaths = blogIndexPaths(await loadSources(REPO_ROOT)); } catch (e) { io.err(`warning: slug table not loaded (${e.message}); blog index pages compare exactly`); }
  }
  // The whole base snapshot (records and URL set, not only the selected
  // entries) tells that rule which articles were already published at capture.
  const baseCapture = baseSnap ? { records: baseSnap.records, urls: baseSnap.urls } : null;
  const ctx = { role, baseOrigin, candOrigin, snapshotMode: Boolean(baseSnap), normaliseAssetHashes: Boolean(a['normalise-asset-hashes']), bodies: stores, assetPairs, blogIndexPaths: blogPaths, baseCapture };

  const captureBase = async (entry) => (baseSnap
    ? baseSnap.records.get(entry.id) || { methods: {}, missing: true, issues: [] }
    : captureSide(entry, { client: baseClient, origin: baseOrigin, baseOrigin, side: 'base', maxHops: c.maxHops, store: liveStore }));
  const captureCand = async (entry) => (candSnap
    ? candSnap.records.get(entry.id) || { methods: {}, missing: true, issues: [] }
    : captureSide(entry, { client: candClient, origin: candOrigin, baseOrigin, side: 'candidate', maxHops: c.maxHops, store: liveStore }));
  const noteIssues = (rec) => {
    for (const i of rec.issues || []) {
      if (i.kind === 'challenge') invalid.push(`challenge from the ${i.side} at ${i.url} (${i.detail})`);
      if (i.kind === 'access-login') invalid.push(`Access login redirect from the candidate at ${i.url}`);
    }
  };

  const liveOrigins = [baseSnap ? null : baseOrigin, candSnap ? null : candOrigin].filter(Boolean);
  const items = await pool(entries, c.concurrency, async (entry) => {
    if (role === 'preview' && entry.na_preview) return { entry, outcome: 'not-applicable', stage: entry.na_preview };
    const na = absoluteNotApplicable(entry, liveOrigins);
    if (na) return { entry, outcome: 'not-applicable', stage: na };
    for (const [label, snap] of [['base', baseSnap], ['candidate', candSnap]]) {
      const rec = snap?.records.get(entry.id);
      if (rec?.not_requested) return { entry, outcome: 'not-applicable', stage: `not requested in the ${label} snapshot (${rec.not_requested})` };
    }
    // Pairing: base and candidate back to back (§2.3).
    const b = await captureBase(entry);
    noteIssues(b);
    const cr = await captureCand(entry);
    noteIssues(cr);
    return { entry, b, c: cr };
  }, () => invalid.length > 0);

  const byUrl = new Map();
  for (const it of items) if (it && it.b && it.entry.methods.includes('GET')) byUrl.set(it.entry.url, it);
  const lookup = (u, side, field) => { const it = byUrl.get(u); return it ? fieldValue(side === 'base' ? it.b : it.c, field, { normaliseAssetHashes: ctx.normaliseAssetHashes }) : undefined; };
  const n = originNormaliser(baseOrigin, candOrigin);
  // Status and Location of the first response of every requested method
  // (response-level allow-list entries must hold for each of them).
  const facts = (rec, side) => {
    const out = {};
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      const h = rec.methods[m]?.hops?.[0];
      if (h) out[m] = { status: h.status, location: n(side, h.location) };
    }
    return out;
  };
  const newUrls = [];
  const evaluate = (it) => {
    const r = compareEntry(it.entry, it.b, it.c, ctx);
    applyAllow(allowList, it.entry, r.diffs, { role, baseOrigin, lookup, facts: { base: facts(it.b, 'base'), candidate: facts(it.c, 'candidate') } });
    const unexplained = r.diffs.filter((d) => !d.allow || d.allow_status === 'expired');
    return { ...r, unexplained };
  };

  const results = [];
  for (const it of items) {
    if (!it) continue; // not reached: the run stopped early
    if (it.outcome === 'not-applicable') { results.push({ id: it.entry.id, group: it.entry.group, url: it.entry.url, outcome: 'not-applicable', stage: it.stage }); continue; }
    const attempts = { base: maxAttempts(it.b), candidate: maxAttempts(it.c) };
    const err = it.b.missing ? 'missing in the base snapshot' : it.c.missing ? 'missing in the candidate snapshot' : recordError(it.b) || recordError(it.c);
    if (err) { results.push({ id: it.entry.id, group: it.entry.group, url: it.entry.url, outcome: 'error', error: err, attempts }); continue; }
    const r = evaluate(it);
    newUrls.push(...r.newUrls);
    const outcome = r.diffs.length === 0 ? 'pass' : r.unexplained.length === 0 ? 'allowed' : 'fail';
    results.push({ id: it.entry.id, group: it.entry.group, url: it.entry.url, outcome, diffs: r.diffs, ...(r.volatile.length ? { volatile: r.volatile } : {}), attempts, _it: it, _seoDb: r.seoSourceDb, _unexplained: r.unexplained });
  }

  // Re-check database-backed differences (§2.4).
  const eligible = invalid.length ? [] : results.filter((x) => x.outcome === 'fail' && eligibleForRecheck(x._unexplained, x._seoDb));
  if (eligible.length && !candClient) for (const x of eligible) x.recheck = 'not possible in snapshot-vs-snapshot mode';
  else if (eligible.length && c.recheckAfter === 0) for (const x of eligible) x.recheck = 'disabled (--recheck-after 0)';
  else if (eligible.length) {
    const rc = await runRecheck(eligible, {
      delayS: c.recheckAfter,
      log,
      redo: async (x) => {
        const it2 = { entry: x._it.entry, b: baseSnap ? x._it.b : await captureBase(x._it.entry) };
        noteIssues(it2.b);
        it2.c = await captureCand(x._it.entry);
        noteIssues(it2.c);
        const err = recordError(it2.b) || recordError(it2.c);
        if (err) return { unexplained: [{ field: 'error' }], diffs: [], volatile: [], newUrls: [], error: err };
        return evaluate(it2);
      },
    });
    for (const x of eligible) {
      const r = rc.get(x.id);
      if (!r) continue;
      if (r.equal) {
        x.outcome = 'transient'; x.recheck = `equal after ${c.recheckAfter} s`;
        for (const d of x.diffs) d.recheck = `equal after ${c.recheckAfter} s`;
        // The re-fetched pair decided the outcome: report its volatile rules
        // and the new URLs they listed (first fetch kept for the record).
        if (x.volatile) x.volatile_first_fetch = x.volatile;
        if (r.volatile.length) x.volatile = r.volatile; else delete x.volatile;
        newUrls.push(...r.newUrls);
      } else {
        x.recheck = r.error ? `error on re-check: ${r.error}` : `still different after ${c.recheckAfter} s`; x.recheck_diffs = r.diffs;
        if (r.volatile.length) x.recheck_volatile = r.volatile;
      }
    }
  }

  // Diff files for failures (F23/F24 bodies).
  for (const x of results.filter((r) => r.outcome === 'fail')) {
    if (x._it.entry.secret_body) continue;
    if (!x.diffs.some((d) => d.field === 'F23' || d.field === 'F24')) continue;
    const bl = x._it.b.methods.GET?.hops?.at(-1); const cl = x._it.c.methods.GET?.hops?.at(-1);
    const bb = stores.base.get(bl?.body_sha256); const cb = stores.candidate.get(cl?.body_sha256);
    if (bb && cb) x.diff_file = writeDiffFile(outDir, x.id, bb, cb, [`base ${x.url}`, `candidate ${x.url}`], [bl.family, cl.family]);
  }

  const finished = new Date();
  const end = live ? checkEnd(started, finished, env) : { crossed: [], invalid: false };
  if (end.invalid) invalid.push(`the run crossed ${end.crossed.join(', ')} (volatile window, §2.4)`);
  const counted = results.filter((r) => r.outcome !== 'not-applicable').length;
  const errorCount = results.filter((r) => r.outcome === 'error').length;
  if (counted && errorCount / counted > ERROR_RATE_LIMIT) invalid.push(`error rate ${(100 * errorCount / counted).toFixed(2)} % > 0.5 %`);
  if (results.length < entries.length) invalid.push(`stopped after ${results.length} of ${entries.length} entries`);

  const summary = { entries: entries.length, pass: 0, allowed: 0, transient: 0, not_applicable: 0, fail: 0, error: 0 };
  for (const r of results) summary[r.outcome === 'not-applicable' ? 'not_applicable' : r.outcome] += 1;
  const pendingUsed = [...new Set(results.flatMap((r) => (r.diffs || []).filter((d) => d.allow_status === 'pending').map((d) => d.allow)))];
  const valid = invalid.length === 0;
  const exitCode = !valid ? 3 : summary.fail > 0 ? 1 : 0;
  // Gate evidence (evidence.mjs): a self-diff or a snapshot-vs-snapshot run
  // is never signable; the run itself still executes and reports.
  const platforms = { base: sidePlatforms(items, 'b'), candidate: sidePlatforms(items, 'c') };
  const evidence = evidenceCheck({ mode, baseOrigin, candOrigin, baseDir: baseSnap?.dir, candDir: candSnap?.dir, platforms, changedSinceCapture });
  const unsignable = [...evidence.reasons];
  if (!valid) unsignable.push('invalid run');
  if (override) unsignable.push('PARITY_IGNORE_WINDOW=1');
  for (const [label, st] of Object.entries(snapshots)) if (st?.window_override) unsignable.push(`${label} snapshot captured with PARITY_IGNORE_WINDOW=1`);
  if (pendingUsed.length) unsignable.push(`allow-list entries pending approval: ${pendingUsed.join(', ')}`);
  if (summary.error > 0) unsignable.push(`${summary.error} error entr${summary.error === 1 ? 'y' : 'ies'} to re-run`);
  const rph = {};
  for (const cl of [baseClient, candClient]) if (cl) for (const [h, k] of cl.requestsPerHost) rph[h] = (rph[h] || 0) + k;
  const report = {
    run_id: id,
    tool_version: TOOL_VERSION,
    mode,
    base: baseSnap ? `snapshot:${baseSnap.dir} (${baseOrigin})` : baseOrigin,
    candidate: candSnap ? `snapshot:${candSnap.dir} (${candOrigin})` : candOrigin,
    candidate_role: role,
    profile: c.profile,
    only: a.only ?? null,
    seed: urlsDoc.seed ?? c.seed,
    urls_sha256: sha256(JSON.stringify(urlsDoc)),
    base_snapshot_manifest_sha256: baseSnap ? sha256(readFileSync(path.join(baseSnap.dir, 'manifest.json'))) : null,
    snapshots,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    window: { override, crossed: end.crossed },
    access_headers: candClient?.hasAccess ? 'sent to the candidate origin only' : 'none',
    valid,
    invalid_reasons: invalid,
    signable: unsignable.length === 0,
    unsignable_reasons: unsignable,
    self_diff: evidence.selfDiff,
    changed_since_capture: changedSinceCapture,
    evidence_banners: evidence.banners,
    platforms,
    exit_code: exitCode,
    summary,
    requests_per_host: rph,
    requests_per_host_max: Math.max(0, ...Object.values(rph)),
    allow_list: {
      file: path.relative(process.cwd(), allowList.file) || allowList.file,
      sha256: allowList.sha256,
      pending: allowList.pending,
      pending_used: pendingUsed,
      expired: allowList.expired,
      entries: allowList.entries.map((e) => ({ id: e.id, url: e.url, field: e.field, expires: e.expires, approved_on: e.approved_on })),
    },
    normalise_asset_hashes: ctx.normaliseAssetHashes,
    asset_hash_pairs: [...new Map(assetPairs.map((p) => [p.join(' '), p])).values()],
    new_urls: [...new Set(newUrls)],
    volatile_rules: VOLATILE_RULES.map(({ id, mode: m, fields }) => ({ id, mode: m, fields })),
    results: results.map(({ _it, _seoDb, _unexplained, ...r }) => r),
  };
  writeReport(outDir, report);
  log(`report: ${path.join(outDir, 'report.md')}`);
  log(`summary: ${JSON.stringify(summary)} · valid ${valid} · signable ${report.signable} · exit ${exitCode}`);
  for (const b of evidence.banners) io.err(`!!! ${b}`);
  if (!valid) io.err(`INVALID RUN: ${invalid.join('; ')}`);
  return exitCode;
}
