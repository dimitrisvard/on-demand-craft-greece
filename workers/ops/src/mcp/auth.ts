// Caller check of the remote MCP endpoint. Requests reach it only through the Cloudflare Access "MCP server"
// application (Managed OAuth) in front of mcp.micronshub.eu, which forwards a signed assertion; this module verifies
// that assertion again and maps its e-mail to a staff identity.
//
// Rules
//   - The assertion (Cf-Access-Jwt-Assertion) must verify against the team's certificates for the MCP application's
//     audience (MCP_ACCESS_AUD), RS256, iss = the team origin, exp/nbf checked (workers/shared/src/auth/access-jwt.ts).
//     Missing, invalid, expired or for another audience -> 401 {"error":"unauthorized"}.
//   - The assertion must name a person: one without an e-mail (an Access service token) -> 401.
//   - The e-mail must belong to a Supabase user with at least one of the four staff roles of user_roles
//     (rpc/agent_staff_for_email, service role); none -> 403 {"error":"forbidden"}. Tenant roles are never read.
//   - Principal: {class: 'ADMIN' when the roles contain admin, else 'STAFF'; uid; roles}. The e-mail is used for
//     the lookup only and is not kept in the principal, logged or written anywhere.
//   - Identity headers other than the assertion (x-microns-*, cf-access-authenticated-user-email, ...) are ignored.
//   - Per-isolate cache of 60 s keyed by the SHA-256 of the assertion (at most 256 entries); only successful
//     lookups are cached.
//   - Configuration (ACCESS_TEAM_DOMAIN, MCP_ACCESS_AUD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) is checked per
//     request; a missing name answers the config error of that request only.

import { ACCESS_ASSERTION_HEADER, verifyAccessAssertion } from '../../../shared/src/auth/access-jwt';
import { STAFF_ROLES, classOfRoles } from '../../../shared/src/auth/supabase-jwt';
import { formatLogLine } from '../../../shared/src/http/log';
import { sha256hex } from '../agents/ids';
import type { Db } from '../db/postgrest';
import { LOG_PREFIX } from '../env';

export interface McpPrincipal {
  class: 'STAFF' | 'ADMIN';
  uid: string;
  roles: string[];
}

export type AuthOutcome =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; status: 401 | 403 | 503; error: 'unauthorized' | 'forbidden' | 'auth_unavailable'; reason: string };

export interface AuthOptions {
  teamDomain: string;
  audience: string;
  db: Db;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  nowSec?: () => number;
  cache?: PrincipalCache;
}

export const PRINCIPAL_CACHE_TTL_MS = 60_000;
const PRINCIPAL_CACHE_MAX = 256;

/** Per-isolate cache: SHA-256 of the assertion -> principal. */
export class PrincipalCache {
  private readonly entries = new Map<string, { principal: McpPrincipal; expires: number }>();

  get(key: string, now: number): McpPrincipal | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expires <= now) {
      this.entries.delete(key);
      return null;
    }
    return { ...entry.principal, roles: [...entry.principal.roles] };
  }

  set(key: string, principal: McpPrincipal, now: number): void {
    if (this.entries.size >= PRINCIPAL_CACHE_MAX) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { principal: { ...principal, roles: [...principal.roles] }, expires: now + PRINCIPAL_CACHE_TTL_MS });
  }

  clear(): void {
    this.entries.clear();
  }
}

export const principalCache = new PrincipalCache();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deny(status: 401 | 403 | 503, error: 'unauthorized' | 'forbidden' | 'auth_unavailable', reason: string): AuthOutcome {
  console.error(formatLogLine(LOG_PREFIX, 'mcp auth denied', { status, reason }));
  return { ok: false, status, error, reason };
}

/** Staff identity of the e-mail (rpc/agent_staff_for_email), or null when there is none. */
export async function staffForEmail(db: Db, email: string): Promise<{ uid: string; roles: string[] } | null> {
  const rows = await db.rpc<unknown>('agent_staff_for_email', { p_email: email });
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  for (const row of list) {
    const r = row as { user_id?: unknown; roles?: unknown };
    if (typeof r.user_id !== 'string' || !UUID_RE.test(r.user_id) || !Array.isArray(r.roles)) continue;
    const roles = r.roles.filter((x): x is string => typeof x === 'string' && (STAFF_ROLES as readonly string[]).includes(x));
    if (roles.length > 0) return { uid: r.user_id, roles };
  }
  return null;
}

/** Verifies the caller (see the rules above). */
export async function authenticate(headers: Headers, o: AuthOptions): Promise<AuthOutcome> {
  const assertion = headers.get(ACCESS_ASSERTION_HEADER);
  if (!assertion) return deny(401, 'unauthorized', 'missing_assertion');
  const now = (o.nowMs ?? Date.now)();
  const cache = o.cache ?? principalCache;
  const key = await sha256hex(assertion);

  // The signature and expiry are checked on every request; the cache only saves the database lookup.
  const verified = await verifyAccessAssertion(headers, { teamDomain: o.teamDomain, audiences: [o.audience], fetchImpl: o.fetchImpl, nowSec: o.nowSec });
  if (!verified.ok) return deny(401, 'unauthorized', verified.reason);
  if (!verified.email) return deny(401, 'unauthorized', 'no_identity');

  const cached = cache.get(key, now);
  if (cached) return { ok: true, principal: cached };

  let staff: { uid: string; roles: string[] } | null;
  try {
    staff = await staffForEmail(o.db, verified.email);
  } catch {
    return deny(503, 'auth_unavailable', 'staff_lookup_failed');
  }
  if (!staff) return deny(403, 'forbidden', 'not_staff');
  const cls = classOfRoles(staff.roles);
  const principal: McpPrincipal = { class: cls === 'ADMIN' ? 'ADMIN' : 'STAFF', uid: staff.uid, roles: staff.roles };
  cache.set(key, principal, now);
  return { ok: true, principal };
}
