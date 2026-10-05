// Sender authentication of inbound mail from the Authentication-Results header (RFC 8601). Used by microns-mail
// (the inbound_emails.auth_results column) and by the intake Workflow (the decision whether a human confirms).
// No imports: workers/mail bundles this file as it is.
//
// Rules
//   - Only an Authentication-Results instance whose authserv-id equals CF_AUTHSERV_ID is trusted: the topmost such
//     instance (headers are listed top to bottom, the receiving infrastructure adds its instance on top). Every
//     other instance is ignored, whatever it says.
//   - CF_AUTHSERV_ID is pinned after the first real message on rfq.micronshub.eu (owner step OW-9); while it is
//     null, no instance is trusted and every verdict reads 'none', so every message goes to a human.
//   - From and Reply-To are never authentication. DMARC passes only for the trusted instance's dmarc=pass with a
//     header.from equal to the domain of the From header (fromDomainMismatch()).
//   - The record keeps the topmost instance's authserv-id (for pinning) and the number of instances, never the
//     header text.

/** authserv-id of the receiving infrastructure; null until pinned (owner step OW-9). */
export const CF_AUTHSERV_ID: string | null = null;

export type AuthVerdict = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'policy';

/** inbound_emails.auth_results */
export interface AuthResults {
  v: 1;
  /** True when a trusted instance (pinned authserv-id) was found. */
  trusted: boolean;
  /** authserv-id of the topmost instance (whether trusted or not), for pinning. */
  authserv_id: string | null;
  spf: AuthVerdict;
  dkim: AuthVerdict;
  dmarc: AuthVerdict;
  /** header.from of the trusted dmarc result (lower case), else null. */
  dmarc_from_domain: string | null;
  /** Number of Authentication-Results instances in the message. */
  raw_count: number;
}

const VERDICTS: ReadonlySet<string> = new Set(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy']);

/** The header value without RFC 5322 comments (nested parentheses), quoted strings kept. */
export function stripComments(value: string): string {
  let out = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quoted) {
      out += ch;
      if (ch === '\\' && i + 1 < value.length) out += value[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (depth > 0) {
      if (ch === '\\') i++;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      continue;
    }
    if (ch === '(') depth = 1;
    else if (ch === '"') {
      quoted = true;
      out += ch;
    } else out += ch;
  }
  return out;
}

export interface AuthInstance {
  authserv_id: string;
  results: Array<{ method: string; result: string; props: Record<string, string> }>;
}

/** Parses one Authentication-Results value; null when it has no authserv-id. */
export function parseInstance(value: string): AuthInstance | null {
  const parts = stripComments(value.replace(/\r?\n[ \t]+/g, ' ')).split(';').map((p) => p.trim());
  const head = parts.shift() ?? '';
  const authservId = head.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!authservId || authservId.includes('=')) return null;
  const results: AuthInstance['results'] = [];
  for (const part of parts) {
    if (!part) continue;
    const tokens = part.split(/\s+/).filter(Boolean);
    const first = /^([A-Za-z0-9_-]+)(?:\/[0-9]+)?=([A-Za-z]+)$/.exec(tokens[0] ?? '');
    if (!first) continue;
    const props: Record<string, string> = {};
    for (const token of tokens.slice(1)) {
      const kv = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(token);
      if (kv) props[kv[1].toLowerCase()] = kv[2].replace(/^"|"$/g, '');
    }
    results.push({ method: first[1].toLowerCase(), result: first[2].toLowerCase(), props });
  }
  return { authserv_id: authservId, results };
}

function verdictOf(instance: AuthInstance, method: string): AuthVerdict {
  const hits = instance.results.filter((r) => r.method === method).map((r) => r.result);
  if (hits.length === 0) return 'none';
  if (hits.includes('pass')) return 'pass';
  const first = hits[0];
  return (VERDICTS.has(first) ? first : 'permerror') as AuthVerdict;
}

/** The auth record of a message's Authentication-Results values (top to bottom). */
export function authResultsOf(values: readonly string[], pinned: string | null = CF_AUTHSERV_ID): AuthResults {
  const instances = values.map(parseInstance);
  const topmost = instances.find((i): i is AuthInstance => i !== null) ?? null;
  const record: AuthResults = {
    v: 1,
    trusted: false,
    authserv_id: topmost?.authserv_id ?? null,
    spf: 'none',
    dkim: 'none',
    dmarc: 'none',
    dmarc_from_domain: null,
    raw_count: values.length,
  };
  if (!pinned) return record;
  const trusted = instances.find((i): i is AuthInstance => i !== null && i.authserv_id === pinned.toLowerCase());
  if (!trusted) return record;
  const dmarc = trusted.results.find((r) => r.method === 'dmarc');
  return {
    ...record,
    trusted: true,
    spf: verdictOf(trusted, 'spf'),
    dkim: verdictOf(trusted, 'dkim'),
    dmarc: verdictOf(trusted, 'dmarc'),
    dmarc_from_domain: dmarc?.props['header.from']?.toLowerCase() ?? null,
  };
}

/** Lower-case domain of an address, or null. */
export function domainOf(address: string | null | undefined): string | null {
  const value = String(address ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return null;
  return value.slice(at + 1).replace(/[>\s]+$/, '');
}

/** True when the From domain differs from the domain the trusted DMARC result authenticated. */
export function fromDomainMismatch(auth: AuthResults, fromAddress: string | null | undefined): boolean {
  if (!auth.trusted || !auth.dmarc_from_domain) return false;
  return domainOf(fromAddress) !== auth.dmarc_from_domain;
}

/** True when the sender is authenticated: trusted DMARC pass whose header.from is the From domain. */
export function dmarcPass(auth: AuthResults | null | undefined, fromAddress: string | null | undefined): boolean {
  if (!auth || !auth.trusted || auth.dmarc !== 'pass' || !auth.dmarc_from_domain) return false;
  return domainOf(fromAddress) === auth.dmarc_from_domain;
}
