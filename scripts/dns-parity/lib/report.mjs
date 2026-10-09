// Text report (stdout) and JSON report (--json).
const PASSING = new Set(['MATCH', 'EXPECTED_ENT', 'EXPECTED_PROXIED', 'ALLOWED', 'SKIPPED', 'FLATTENED_UNVERIFIED']);

function show(o) {
  if (!o) return '-';
  if (o.kind === 'DATA') return o.values.map((v) => (typeof v === 'string' ? v : v.prefix ? `${v.prefix}…` : v.uncomparable)).join(' ; ');
  if (o.kind === 'ERROR') return `ERROR ${o.error}`;
  if (o.kind === 'FLATTENED') return `FLATTENED -> ${o.target}`;
  return o.kind;
}

export function textReport(r, { verbose = false } = {}) {
  const lines = [];
  lines.push(`dns-parity ${r.zone}: A = ${r.a}, B = ${r.b}; ${r.questions} questions; ${r.generatedAt}`);
  lines.push(`counts: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const shown = r.rows.filter((row) => verbose || !PASSING.has(row.status) || row.status === 'ALLOWED' || row.status === 'EXPECTED_ENT' || row.status === 'FLATTENED_UNVERIFIED');
  // One line per (name, status, reason, answers): the types that share them are listed together.
  const groups = [];
  for (const row of shown) {
    const key = [row.rel, row.status, row.reason ?? '', show(row.a), show(row.b)].join('\u0000');
    const g = groups.find((x) => x.key === key);
    if (g) g.types.push(row.type);
    else groups.push({ key, row, types: [row.type] });
  }
  for (const { row, types } of groups) {
    lines.push(`${row.status.padEnd(20)} ${row.rel} ${types.join(',')}${row.reason ? `  (${row.reason})` : ''}`);
    if (row.status !== 'MATCH') {
      lines.push(`    A: ${show(row.a)}`);
      lines.push(`    B: ${show(row.b)}`);
    }
  }
  lines.push(`exit ${r.exitCode} (${r.exitCode === 0 ? 'no differences' : r.exitCode === 1 ? 'differences' : 'incomplete: some questions were not answered'})`);
  return lines.join('\n');
}

export function jsonReport(r) {
  return JSON.stringify(r, null, 2);
}
