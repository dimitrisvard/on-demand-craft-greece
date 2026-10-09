// Domain-name helpers. Canonical form everywhere: lower case, no trailing dot, absolute (zone suffix included).

export function canonName(name) {
  let n = String(name).trim().toLowerCase();
  while (n.endsWith('.')) n = n.slice(0, -1);
  return n;
}

/** '@' -> zone; 'www' -> 'www.<zone>'; 'www.<zone>.' -> 'www.<zone>'. */
export function absolute(name, zone) {
  const z = canonName(zone);
  const raw = String(name).trim();
  if (raw === '@' || raw === '') return z;
  if (raw.endsWith('.')) return canonName(raw);
  const n = canonName(raw);
  if (n === z || n.endsWith(`.${z}`)) return n;
  return `${n}.${z}`;
}

/** 'www.micronshub.eu' -> 'www'; apex -> '@'. */
export function relative(name, zone) {
  const n = canonName(name);
  const z = canonName(zone);
  if (n === z) return '@';
  return n.endsWith(`.${z}`) ? n.slice(0, -(z.length + 1)) : n;
}

export function inZone(name, zone) {
  const n = canonName(name);
  const z = canonName(zone);
  return n === z || n.endsWith(`.${z}`);
}

/** Ancestors from the parent up to and including the zone apex: 'a.b.z' (zone z) -> ['b.z', 'z']. */
export function ancestors(name, zone) {
  const n = canonName(name);
  const z = canonName(zone);
  const out = [];
  let cur = n;
  while (cur !== z && cur.includes('.')) {
    cur = cur.slice(cur.indexOf('.') + 1);
    out.push(cur);
    if (cur === z) break;
  }
  return out;
}

/** Deterministic probe labels from a seed (FNV-1a), so a report can be re-run with the same names. */
export function probeLabel(seed, salt) {
  let h = 0x811c9dc5;
  for (const ch of `${seed}:${salt}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
