// RR type and rcode tables (RFC 1035, 3596, 2782, 4034, 8659, 9460). Only the types the parity check
// names; any other type is handled through the RFC 3597 generic form.

export const TYPES = Object.freeze({
  A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, OPT: 41,
  DS: 43, RRSIG: 46, NSEC: 47, DNSKEY: 48, NSEC3: 50, SVCB: 64, HTTPS: 65, CAA: 257,
});

const BY_NUMBER = new Map(Object.entries(TYPES).map(([k, v]) => [v, k]));

/** 'A' | 'TYPE65' | 65 -> 65; throws on an unknown mnemonic. */
export function typeNumber(t) {
  if (typeof t === 'number') return t;
  const u = String(t).toUpperCase();
  if (u in TYPES) return TYPES[u];
  const m = /^TYPE(\d{1,5})$/.exec(u);
  if (m) return Number(m[1]);
  throw new Error(`unknown RR type ${t}`);
}

/** 65 -> 'HTTPS'; 999 -> 'TYPE999'. */
export function typeName(n) {
  return BY_NUMBER.get(n) ?? `TYPE${n}`;
}

export const RCODES = Object.freeze({ 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' });

export function rcodeName(n) {
  return RCODES[n] ?? `RCODE${n}`;
}

/** Types whose RDATA carries domain names that compare case-insensitively without the trailing dot. */
export const NAME_TYPES = new Set([TYPES.NS, TYPES.CNAME, TYPES.PTR]);

/** Zone infrastructure and DNSSEC types: excluded unless --include-infra (runbook S4: NS, SOA, DNSSEC excepted). */
export const INFRA_TYPES = new Set([TYPES.SOA, TYPES.DS, TYPES.RRSIG, TYPES.NSEC, TYPES.NSEC3, TYPES.DNSKEY]);
