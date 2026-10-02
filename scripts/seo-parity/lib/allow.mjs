// Allow-list scripts/seo-parity.allow.json (SEO_PARITY.md §5.6).
//
// Approval states:
//   approved_on = "YYYY-MM-DD"  approved; expires ≤ approved_on + 120 days.
//   approved_on = "pending"     written but not yet approved by the owner.
//                               A difference it matches is `allowed`, the run
//                               stays valid, but the run is NOT SIGNABLE until
//                               the owner records the approval date. Its
//                               expires must be ≤ today + 120 days, so that
//                               approving it today would be valid.
// An expired entry (expires < today, UTC) turns its differences into `fail`.

import { readFileSync } from 'node:fs';
import { ALLOW_MAX_DAYS, APPROVER, FIELD_IDS } from './constants.mjs';
import { addDays, deepEqual, sha256, UsageError } from './util.mjs';

const LANG_RE = /^\/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)(\/|$)/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = new Set(['id', 'url', 'match', 'host', 'field', 'sub', 'expected', 'justification', 'applies_to', 'expires', 'approver', 'approved_on', 'notes']);
const ROLES = new Set(['preview', 'production']);

const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Paths the Vercel middleware matcher sends to the SEO handler (middleware.ts config). */
export const isSeoPath = (p) => LANG_RE.test(p);

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function fieldsOf(e) {
  return Array.isArray(e.field) ? e.field : [e.field];
}

export function validateAllowList(doc, today) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['allow-list is not a JSON object'];
  if (doc.version !== 1) errors.push('version must be 1');
  if (!Array.isArray(doc.entries)) return [...errors, 'entries must be an array'];
  const ids = new Set();
  doc.entries.forEach((e, i) => {
    const where = `entries[${i}]${e && e.id ? ` (${e.id})` : ''}`;
    const err = (m) => errors.push(`${where}: ${m}`);
    if (!e || typeof e !== 'object') { err('not an object'); return; }
    for (const k of Object.keys(e)) if (!KEYS.has(k)) err(`unknown key "${k}"`);
    if (typeof e.id !== 'string' || !/^AL-\d{3}$/.test(e.id)) err('id must look like AL-001');
    else if (ids.has(e.id)) err('duplicate id'); else ids.add(e.id);
    if (typeof e.url !== 'string' || !e.url) err('url is required (entries without a URL are forbidden)');
    if (!['exact', 'glob', 'regex'].includes(e.match)) err('match must be exact, glob or regex');
    if (e.match === 'regex' && typeof e.url === 'string') { try { new RegExp(`^(?:${e.url})$`); } catch { err('url is not a valid regex'); } }
    if (e.host !== undefined && (typeof e.host !== 'string' || !e.host)) err('host must be a non-empty string when present');
    const fields = e.field === undefined ? [] : fieldsOf(e);
    if (!fields.length) err('field is required');
    for (const f of fields) {
      if (f === '*') err('field "*" is forbidden');
      else if (f !== 'response' && !FIELD_IDS.includes(f)) err(`unknown field "${f}"`);
    }
    if (fields.includes('response') && fields.length > 1) err('"response" cannot be combined with other fields');
    if (!e.expected || typeof e.expected !== 'object') err('expected is required');
    else if (fields.includes('response')) {
      const b = e.expected.base; const c = e.expected.candidate;
      if (!b || !Number.isInteger(b.status) || !c || !Number.isInteger(c.status)) err('response entries need expected.base.status and expected.candidate.status');
      else if (b.status === c.status) err('field "response" is allowed only when the expected candidate status differs from the base status');
      for (const side of [b, c]) {
        if (side && Object.keys(side).some((k) => !['status', 'location'].includes(k))) err('response expected values may only hold status and location');
      }
    } else if (Array.isArray(e.field)) {
      for (const f of fields) {
        const x = e.expected[f];
        if (!x || !('base' in x) || !('candidate' in x)) err(`expected.${f} needs base and candidate`);
      }
    } else if (!('base' in e.expected) || !('candidate' in e.expected)) err('expected needs base and candidate');
    const mayBeSeo = !(e.match === 'exact' && typeof e.url === 'string' && !isSeoPath(e.url));
    for (const f of fields) {
      if (!mayBeSeo) continue;
      if (f === 'F6' || f === 'F9') err(`field-level entries on ${f} are forbidden for SEO paths (only an exact non-SEO path may carry one)`);
      // F4 (HEAD) and F12 (OPTIONS) carry the F5–F11 header set: an entry on
      // them must name a sub, and that sub must not be F6 or F9, or it would
      // cover the HEAD Cache-Control / X-Seo-Source the brief requires equal.
      if (f === 'F4' || f === 'F12') {
        if (e.sub === undefined) err(`field-level entries on ${f} need a "sub" for SEO paths (without one they would also cover F6 and F9)`);
        else if (/^F(6|9)(:|$)/.test(String(e.sub))) err(`field-level entries on ${f} with sub ${e.sub} are forbidden for SEO paths (F6 and F9 must be identical)`);
      }
    }
    if (typeof e.justification !== 'string' || !e.justification.trim()) err('justification is required');
    if (e.approver !== APPROVER) err(`approver must be "${APPROVER}"`);
    if (!validDate(e.expires)) err('expires must be a YYYY-MM-DD date');
    if (e.approved_on === 'pending') {
      if (validDate(e.expires) && e.expires > addDays(today, ALLOW_MAX_DAYS)) err(`pending entry: expires must be at most ${ALLOW_MAX_DAYS} days after today (${addDays(today, ALLOW_MAX_DAYS)})`);
    } else if (!validDate(e.approved_on)) err('approved_on must be a YYYY-MM-DD date or "pending"');
    else {
      if (e.approved_on > today) err('approved_on is in the future');
      if (validDate(e.expires) && e.expires > addDays(e.approved_on, ALLOW_MAX_DAYS)) err(`expires must be at most ${ALLOW_MAX_DAYS} days after approved_on (${addDays(e.approved_on, ALLOW_MAX_DAYS)})`);
    }
    if (!Array.isArray(e.applies_to) || !e.applies_to.length || e.applies_to.some((r) => !ROLES.has(r))) err('applies_to must be a non-empty subset of ["preview","production"]');
  });
  return errors;
}

export function loadAllowList(file, today) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new UsageError(`allow-list ${file}: unreadable (${e.message})`); }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new UsageError(`allow-list ${file}: not JSON (${e.message})`); }
  const errors = validateAllowList(doc, today);
  if (errors.length) throw new UsageError(`allow-list ${file} does not validate:\n  - ${errors.join('\n  - ')}`);
  const entries = doc.entries.map((e) => ({
    ...e,
    fields: fieldsOf(e),
    expired: e.expires < today,
    pending: e.approved_on === 'pending',
    urlRe: e.match === 'regex' ? new RegExp(`^(?:${e.url})$`) : e.match === 'glob' ? globToRegExp(e.url) : null,
  }));
  return {
    file,
    sha256: sha256(text),
    entries,
    pending: entries.filter((e) => e.pending).map((e) => e.id),
    expired: entries.filter((e) => e.expired).map((e) => e.id),
  };
}

function urlMatches(a, entryUrl) {
  let pathPart = entryUrl;
  let host = null;
  if (/^https?:\/\//.test(entryUrl)) {
    const u = new URL(entryUrl);
    host = u.host;
    pathPart = `${u.pathname}${u.search}`;
  }
  if (a.host !== undefined && a.host !== host) return false;
  if (a.match === 'exact') return a.url === pathPart;
  return a.urlRe.test(pathPart);
}

function valueMatches(expected, actual, side, diff, ctx) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && 'same_as_url' in expected) {
    const ref = ctx.lookup(expected.same_as_url, side, diff.field, diff.sub);
    return ref !== undefined && deepEqual(ref, actual);
  }
  return deepEqual(expected, actual);
}

const relLocation = (loc, baseOrigin) => (loc && loc.startsWith(`${baseOrigin}/`) ? loc.slice(baseOrigin.length) : loc);

/**
 * Annotate `diffs` with allow-list matches. Mutates each diff: `allow`
 * (entry id) and `allow_status` ('approved' | 'pending' | 'expired').
 * @param ctx { role, baseOrigin, lookup(url, side, field, sub),
 *   facts: { base: { GET?: {status, location}, HEAD?: {...}, OPTIONS?: {...} }, candidate: { ... } } }
 */
export function applyAllow(allowList, entry, diffs, ctx) {
  if (!allowList || !diffs.length) return;
  const candidates = allowList.entries.filter((a) => a.applies_to.includes(ctx.role) && urlMatches(a, entry.url));
  const status = (a) => (a.expired ? 'expired' : a.pending ? 'pending' : 'approved');
  // Response-level entries cover every field of the URL when the statuses and
  // locations are exactly the expected ones.
  // Every method requested for the URL (GET first hop, HEAD, OPTIONS) must
  // show the expected status and Location on both sides: a candidate that
  // redirects GET but answers HEAD 200 is a half-applied redirect, not the
  // documented deviation.
  for (const a of candidates.filter((x) => x.fields[0] === 'response')) {
    const ok = ['base', 'candidate'].every((side) => {
      const exp = a.expected[side];
      const perMethod = ctx.facts[side];
      const list = perMethod ? Object.values(perMethod) : [];
      if (!list.length) return false;
      return list.every((f) => {
        if (!f || f.status !== exp.status) return false;
        const loc = relLocation(f.location, ctx.baseOrigin);
        return (exp.location === undefined ? loc === null || loc === undefined : exp.location === loc);
      });
    });
    if (ok) {
      for (const d of diffs) { d.allow = a.id; d.allow_status = status(a); }
      return;
    }
  }
  for (const d of diffs) {
    // F4 is "the header set of F5–F12 on HEAD, as for GET": a HEAD diff with
    // sub "F5" (or "F11:<name>") is covered by an entry for that header field
    // with the same values. A field-level F4 entry still matches directly.
    let field = d.field;
    let sub = d.sub;
    if (d.field === 'F4' && typeof d.sub === 'string' && /^F(5|6|7|8|9|10|11|12)(:|$)/.test(d.sub)) {
      const i = d.sub.indexOf(':');
      field = i === -1 ? d.sub : d.sub.slice(0, i);
      sub = i === -1 ? undefined : d.sub.slice(i + 1);
    }
    for (const a of candidates) {
      if (a.fields[0] === 'response') continue;
      const direct = a.fields.includes(d.field) && (a.sub === undefined || a.sub === d.sub);
      const viaHead = field !== d.field && a.fields.includes(field) && (a.sub === undefined || a.sub === sub);
      if (!direct && !viaHead) continue;
      const exp = Array.isArray(a.field) ? a.expected[direct ? d.field : field] : a.expected;
      const ref = direct ? d : { ...d, field, sub };
      if (valueMatches(exp.base, d.base, 'base', ref, ctx) && valueMatches(exp.candidate, d.candidate, 'candidate', ref, ctx)) {
        d.allow = a.id;
        d.allow_status = status(a);
        break;
      }
    }
  }
}
