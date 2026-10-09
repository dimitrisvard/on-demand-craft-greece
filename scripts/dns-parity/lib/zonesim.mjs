// Answer questions from a record list the way an authoritative server would, so a zone-file export or a
// Cloudflare API export can be compared with live answers name by name.
//
// Wildcard semantics (two modes):
//   'rfc4592'    BIND and other RFC 4592 servers (Papaki today): an empty non-terminal (a name that owns no
//                record but has descendants, e.g. _domainkey.<zone> when only resend._domainkey exists) answers
//                NOERROR/NODATA and stops the wildcard.
//   'cloudflare' Cloudflare standard nameservers: the wildcard still applies to an empty non-terminal
//                (CF docs dns/manage-dns-records/reference/wildcard-dns-records, "Example 2 - implicit parent",
//                fetched 2026-10-04). A name that owns any record, and everything below it, never gets the wildcard
//                in both modes.
// Cloudflare-only answer shapes: a proxied A/AAAA/CNAME answers with Cloudflare addresses (marked proxied); a
// CNAME at the apex is flattened (marked flattened with its target; CF docs dns/cname-flattening).
import { ancestors, canonName, inZone } from './names.mjs';
import { TYPES } from './types.mjs';

export class ZoneModel {
  /**
   * @param {{origin:string, records:Array<{name,type,ttl,rdata,proxied?}>}} zone
   * @param {'rfc4592'|'cloudflare'} mode
   */
  constructor(zone, mode) {
    this.origin = canonName(zone.origin);
    this.mode = mode;
    this.nodes = new Map();
    for (const rr of zone.records) {
      const n = canonName(rr.name);
      if (!this.nodes.has(n)) this.nodes.set(n, new Map());
      const node = this.nodes.get(n);
      if (!node.has(rr.type)) node.set(rr.type, []);
      node.get(rr.type).push({ ...rr, name: n });
    }
    this.ents = new Set();
    for (const n of this.nodes.keys()) {
      for (const a of ancestors(n, this.origin)) if (a !== this.origin && !this.nodes.has(a)) this.ents.add(a);
    }
  }

  /** Every owner name in the zone (enumerable source), for the name list. */
  ownerNames() {
    return [...this.nodes.keys()];
  }

  /** Empty non-terminals of this zone. */
  emptyNonTerminals() {
    return [...this.ents];
  }

  answer(qname, qtype) {
    const q = canonName(qname);
    if (!inZone(q, this.origin)) return { status: 'REFUSED', aa: false, rrs: [] };
    let node = this.nodes.get(q);
    let wildcard = null;
    if (!node && q !== this.origin) {
      if (this.mode === 'rfc4592' && this.ents.has(q)) return { status: 'NOERROR', aa: true, rrs: [], ent: true };
      let ce = this.origin;
      for (const a of ancestors(q, this.origin)) {
        if (this.nodes.has(a) || a === this.origin || (this.mode === 'rfc4592' && this.ents.has(a))) { ce = a; break; }
      }
      const wc = `*.${ce}`;
      node = this.nodes.get(wc);
      if (!node) return { status: 'NXDOMAIN', aa: true, rrs: [] };
      wildcard = wc;
    }
    node = node ?? new Map();
    const own = (list) => list.map((rr) => ({ ...rr, name: q }));
    const cname = node.get(TYPES.CNAME);
    const base = { status: 'NOERROR', aa: true, wildcard, ent: this.mode === 'cloudflare' && this.ents.has(q) };
    // A proxied hostname answers A/AAAA (and HTTPS, when Cloudflare publishes it) with Cloudflare's own data and
    // never shows its CNAME; other types of that name answer from their own records only.
    const cf = this.mode === 'cloudflare';
    const proxiedHost = cf && [TYPES.A, TYPES.AAAA, TYPES.CNAME].some((t) => (node.get(t) ?? []).some((r) => r.proxied));
    if (proxiedHost && (qtype === TYPES.A || qtype === TYPES.AAAA || qtype === TYPES.HTTPS)) return { ...base, rrs: [], proxied: true };
    if (cname && qtype !== TYPES.CNAME) {
      if (proxiedHost) return { ...base, rrs: [] };
      if (cf && q === this.origin) return { ...base, rrs: [], flattened: cname[0].rdata.target };
      return { ...base, rrs: own(cname) };
    }
    if (proxiedHost && qtype === TYPES.CNAME) return { ...base, rrs: [] };
    return { ...base, rrs: own(node.get(qtype) ?? []) };
  }

  /** Every record of this model (any type, proxied or not), for --forbid-target. */
  records() {
    const out = [];
    for (const node of this.nodes.values()) for (const list of node.values()) out.push(...list);
    return out;
  }

  /** Records proxied in this model (any type), for --expect-dns-only. */
  proxiedRecords() {
    return this.records().filter((rr) => rr.proxied);
  }
}
