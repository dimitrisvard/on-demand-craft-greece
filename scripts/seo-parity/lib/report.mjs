// report.json, report.md (§5.5) and diffs/<id>.diff (first 200 lines).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normaliseDocument, normaliseHtmlDocument } from './extract.mjs';
import { display } from './util.mjs';

const DIFF_MAX_LINES = 200;
const MAX_EDIT_DISTANCE = 4000;

/** Myers O(ND) line diff → array of [' '|'-'|'+', line]. */
export function diffLines(a, b) {
  const n = a.length; const m = b.length; const max = n + m;
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = false;
  for (let d = 0; d <= Math.min(max, MAX_EDIT_DISTANCE); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
    if (found) break;
  }
  if (!found) return [...a.map((l) => ['-', l]), ...b.map((l) => ['+', l])];
  const ops = [];
  let x = n; let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push([' ', a[x - 1]]); x--; y--; }
    if (d > 0) {
      if (x === prevX) ops.push(['+', b[y - 1]]); else ops.push(['-', a[x - 1]]);
    }
    x = prevX; y = prevY;
  }
  return ops.reverse();
}

export function unifiedDiff(a, b, labelA, labelB, context = 3) {
  const ops = diffLines(a, b);
  const out = [`--- ${labelA}`, `+++ ${labelB}`];
  const pos = [];
  let ai = 0; let bi = 0;
  for (const op of ops) { pos.push([ai, bi]); if (op[0] !== '+') ai++; if (op[0] !== '-') bi++; }
  const changes = [];
  ops.forEach((op, i) => { if (op[0] !== ' ') changes.push(i); });
  const groups = [];
  for (const c of changes) {
    const g = groups[groups.length - 1];
    if (g && c - g.last <= 2 * context) g.last = c; else groups.push({ first: c, last: c });
  }
  for (const g of groups) {
    const s = Math.max(0, g.first - context);
    const e = Math.min(ops.length, g.last + context + 1);
    const slice = ops.slice(s, e);
    const ac = slice.filter((o) => o[0] !== '+').length;
    const bc = slice.filter((o) => o[0] !== '-').length;
    out.push(`@@ -${pos[s][0] + 1},${ac} +${pos[s][1] + 1},${bc} @@`);
    for (const [t, l] of slice) out.push(`${t}${l}`);
  }
  return out;
}

const docLines = (buf, html) => (html ? normaliseHtmlDocument : normaliseDocument)(buf.toString('utf8')).replace(/>/g, '>\n').split('\n');

export function writeDiffFile(outDir, id, baseBody, candBody, labels, families = ['html', 'html']) {
  const lines = unifiedDiff(docLines(baseBody, families[0] === 'html'), docLines(candBody, families[1] === 'html'), labels[0], labels[1]);
  const truncated = lines.length > DIFF_MAX_LINES;
  const text = `${lines.slice(0, DIFF_MAX_LINES).join('\n')}\n${truncated ? `… truncated at ${DIFF_MAX_LINES} lines (${lines.length} in total)\n` : ''}`;
  const dir = path.join(outDir, 'diffs');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.diff`);
  writeFileSync(file, text);
  return path.relative(outDir, file);
}

const fmtN = (n) => Number(n).toLocaleString('en-US');
const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const hhmm = (iso) => (iso ? iso.slice(11, 16) : '--:--');

export function renderMarkdown(r) {
  const L = [];
  L.push(`# SEO parity report ${r.started_at.slice(0, 16)}Z`);
  L.push(`Base ${r.base} · Candidate ${r.candidate} (${r.candidate_role})`);
  L.push(`Mode ${r.mode} · Profile ${r.profile} · ${fmtN(r.summary.entries)} entries · ${fmtN(r.requests_per_host_max)} requests per host · seed ${r.seed} · window ${hhmm(r.started_at)}–${hhmm(r.finished_at)} UTC`);
  const verdict = !r.valid
    ? `INVALID (${r.invalid_reasons.join('; ')})`
    : r.summary.fail > 0 ? `FAIL (${fmtN(r.summary.fail)} entr${r.summary.fail === 1 ? 'y' : 'ies'} with unexplained differences)` : 'PASS (0 unexplained differences)';
  L.push(`Result: ${verdict} · exit ${r.exit_code}`);
  L.push(`Signable: ${r.signable ? 'yes' : `NO (${r.unsignable_reasons.join('; ')})`}`);
  if (r.changed_since_capture) L.push(`Changed since the capture (--changed-since-capture): ${cell(r.changed_since_capture)}`);
  const olderSnaps = Object.entries(r.snapshots || {}).filter(([, s]) => s && s.tool_version !== r.tool_version);
  if (olderSnaps.length) L.push(`Tool ${r.tool_version}; ${olderSnaps.map(([k, s]) => `${k} snapshot captured by ${s.tool_version ?? 'an unknown version'}`).join(', ')}`);
  for (const b of r.evidence_banners || []) {
    L.push('');
    L.push(`> **${b}**`);
  }
  if (r.window.override) {
    L.push('');
    L.push('> **PARITY_IGNORE_WINDOW=1 was set: the volatile-window rule was not enforced. This run is NOT SIGNABLE.**');
  }
  const snapOverride = Object.entries(r.snapshots || {}).filter(([, s]) => s?.window_override).map(([k]) => k);
  if (snapOverride.length) {
    L.push('');
    L.push(`> **The ${snapOverride.join(' and ')} snapshot was captured with PARITY_IGNORE_WINDOW=1. This run is NOT SIGNABLE.**`);
  }
  if (r.allow_list?.pending_used?.length) {
    L.push('');
    L.push(`> **Allow-list entries pending approval were used: ${r.allow_list.pending_used.join(', ')}. The run is valid but NOT SIGNABLE until the owner records approved_on.**`);
  }
  L.push('');
  L.push('| Outcome | Entries |');
  L.push('|---|---|');
  L.push(`| pass | ${fmtN(r.summary.pass)} |`);
  L.push(`| allowed | ${fmtN(r.summary.allowed)} |`);
  L.push(`| transient (re-check equal) | ${fmtN(r.summary.transient)} |`);
  L.push(`| not-applicable (S13/S14) | ${fmtN(r.summary.not_applicable)} |`);
  L.push(`| fail | ${fmtN(r.summary.fail)} |`);
  L.push(`| error | ${fmtN(r.summary.error)} |`);
  L.push('');
  L.push('## Allowed differences');
  const allowed = r.results.filter((x) => x.outcome === 'allowed');
  if (!allowed.length) L.push('None.');
  else {
    L.push('| Entry | URL | Field | Base | Candidate | Expires |');
    L.push('|---|---|---|---|---|---|');
    const byAllow = new Map();
    for (const res of allowed) {
      for (const d of res.diffs) {
        const key = `${d.allow}\u0000${res.url}`;
        const cur = byAllow.get(key) || { allow: d.allow, url: res.url, fields: new Set(), base: null, candidate: null, status: d.allow_status };
        cur.fields.add(d.sub ? `${d.field}` : d.field);
        if (d.field === 'F1') { cur.base = d.base; cur.candidate = d.candidate; }
        if (d.field === 'F2' && Array.isArray(d.candidate) && d.candidate[0]) cur.candidate = `${cur.candidate ?? ''} → ${d.candidate[0][1]}`.trim();
        if (cur.base === null && d.field !== 'F2') { cur.base = display(d.base, 60); cur.candidate = display(d.candidate, 60); }
        byAllow.set(key, cur);
      }
    }
    for (const a of byAllow.values()) {
      const ent = r.allow_list.entries.find((e) => e.id === a.allow);
      L.push(`| ${a.allow}${a.status === 'pending' ? ' (pending)' : ''} | ${cell(a.url)} | ${[...a.fields].join('/')} | ${cell(a.base)} | ${cell(a.candidate)} | ${ent?.expires ?? ''} |`);
    }
  }
  const transient = r.results.filter((x) => x.outcome === 'transient');
  if (transient.length) {
    L.push('');
    L.push('## Transient (re-check equal)');
    L.push('| Entry | URL | Fields | Re-check |');
    L.push('|---|---|---|---|');
    for (const t of transient) L.push(`| ${t.id} | ${cell(t.url)} | ${[...new Set(t.diffs.map((d) => d.field))].join(', ')} | ${cell(t.recheck)} |`);
  }
  const relaxed = r.results.filter((x) => (x.volatile || []).some((v) => v.applied !== false));
  if (relaxed.length) {
    L.push('');
    L.push('## Volatile rules applied (§2.4)');
    L.push('| Entry | URL | Rule | Detail |');
    L.push('|---|---|---|---|');
    for (const x of relaxed) {
      for (const v of x.volatile.filter((y) => y.applied !== false)) {
        const detail = v.rule === 'blog-index-article-list'
          ? `${v.fields.join('/')}: ${v.added.length} new article${v.added.length === 1 ? '' : 's'} listed first, ${v.dropped.length} dropped off the end`
          : v.rule === 'prerender-tag-scripts'
            ? `F23 without tag scripts (base ${v.base_removed.length}, candidate ${v.candidate_removed.length})`
            : '';
        L.push(`| ${x.id} | ${cell(x.url)} | ${v.rule} | ${cell(detail)} |`);
      }
    }
  }
  const na = r.results.filter((x) => x.outcome === 'not-applicable');
  if (na.length) {
    L.push('');
    L.push('## Not applicable');
    L.push(na.map((x) => `${x.id} ${x.url} (${x.stage})`).join(' · '));
  }
  const errors = r.results.filter((x) => x.outcome === 'error');
  L.push('');
  L.push('## Errors');
  if (!errors.length) L.push('None.');
  else for (const e of errors) L.push(`- ${e.id} ${e.url}: ${cell(e.error)} (attempts: base ${e.attempts?.base ?? '-'}, candidate ${e.attempts?.candidate ?? '-'})`);
  L.push('');
  L.push('## Failures');
  const fails = r.results.filter((x) => x.outcome === 'fail');
  if (!fails.length) L.push('None.');
  for (const f of fails) {
    L.push('');
    L.push(`### ${f.id} ${f.url}`);
    L.push('| Field | Base | Candidate | Note |');
    L.push('|---|---|---|---|');
    for (const d of f.diffs.filter((x) => !x.allow || x.allow_status === 'expired')) {
      const name = `${d.field}${d.sub ? ` ${d.sub}` : ''}${d.hop ? ` (hop ${d.hop})` : ''}`;
      const len = (side) => (d[`${side}_length`] != null ? ` (${d[`${side}_length`]} B)` : '');
      const note = [d.rule, d.allow_status === 'expired' ? `allow-list ${d.allow} expired` : null, d.flag, d.examples ? `examples: ${display(d.examples, 200)}` : null].filter(Boolean).join('; ');
      L.push(`| ${cell(name)} | ${cell(display(d.base))}${len('base')} | ${cell(display(d.candidate))}${len('candidate')} | ${cell(note)} |`);
    }
    for (const v of (f.volatile || []).filter((y) => y.applied === false)) L.push(`Volatile rule ${v.rule} not applied: ${cell(v.reason)}`);
    if (f.recheck) L.push(`Re-check: ${f.recheck}`);
    if (f.diff_file) L.push(`Diff: \`${f.diff_file}\``);
  }
  if (r.new_urls?.length) {
    L.push('');
    L.push(`## New URLs (listed, not compared): ${r.new_urls.length}`);
    for (const u of r.new_urls.slice(0, 50)) L.push(`- ${u}`);
    if (r.new_urls.length > 50) L.push(`- … ${r.new_urls.length - 50} more in report.json`);
  }
  if (r.asset_hash_pairs?.length) {
    L.push('');
    L.push('## Asset hash pairs (--normalise-asset-hashes)');
    for (const [a, b] of r.asset_hash_pairs) L.push(`- ${a} ↔ ${b}`);
  }
  L.push('');
  return L.join('\n');
}

export function writeReport(outDir, report) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'report.md'), renderMarkdown(report));
}
