// Caller authentication for leads-api (PLAN.md P6-4, H-6): only a signed-in staff user may call it.
//
// Rules (the staff gate of the Cloudflare /api gates, PHASE 2):
//   - credential: `Authorization: Bearer <Supabase access token>` of the signed-in user, nothing else;
//   - pre-check without network: the token payload must say role "authenticated", audience "authenticated", a UUID
//     `sub` and an `exp` in the future. This turns away the public anon key (role "anon") and any other project key
//     before a network call;
//   - verification: Supabase Auth itself (GET /auth/v1/user through auth.getUser), which also rejects signed-out
//     sessions;
//   - staff = a `user_roles` row with role admin, sales_rep, production_manager or accountant (an array: one user may
//     hold several rows). Tenant roles and is_staff() are never used;
//   - answers: missing or invalid credential 401 {"error":"unauthorized"}; no staff role 403 {"error":"forbidden"};
//     Supabase Auth or the database unreachable 503 {"error":"auth_unavailable"} (fail closed).
// No imports, so it runs unchanged in Deno (the function) and in Node (tests/edge-functions).

export const STAFF_ROLES: readonly string[] = ['admin', 'sales_rep', 'production_manager', 'accountant'];

export type StaffCheck =
  | { ok: true; userId: string; roles: string[] }
  | { ok: false; status: 401 | 403 | 503; error: 'unauthorized' | 'forbidden' | 'auth_unavailable' };

/** The two lookups the check needs; 'unavailable' = the service could not answer (network, timeout, 5xx). */
export interface StaffAuthDeps {
  getUserId(token: string): Promise<string | null | 'unavailable'>;
  getRoles(userId: string): Promise<string[] | 'unavailable'>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\s*$/.exec(header ?? '');
  return match ? match[1] : null;
}

function base64UrlDecode(part: string): string | null {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

/** Payload pre-check of a user access token (no signature check; Supabase Auth verifies it afterwards). */
export function looksLikeUserToken(token: string, nowMs: number): boolean {
  const json = base64UrlDecode(token.split('.')[1] ?? '');
  if (json === null) return false;
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    payload = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  const aud = payload.aud;
  const audOk = aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated'));
  return (
    payload.role === 'authenticated' &&
    audOk &&
    typeof payload.sub === 'string' &&
    UUID.test(payload.sub) &&
    typeof payload.exp === 'number' &&
    payload.exp * 1000 > nowMs
  );
}

/** Decides whether the request comes from a signed-in staff user. */
export async function checkStaff(authorization: string | null, deps: StaffAuthDeps, nowMs = Date.now()): Promise<StaffCheck> {
  const token = bearerToken(authorization);
  if (!token || !looksLikeUserToken(token, nowMs)) return { ok: false, status: 401, error: 'unauthorized' };
  let userId: string | null | 'unavailable';
  try {
    userId = await deps.getUserId(token);
  } catch {
    userId = 'unavailable';
  }
  if (userId === 'unavailable') return { ok: false, status: 503, error: 'auth_unavailable' };
  if (!userId) return { ok: false, status: 401, error: 'unauthorized' };
  let roles: string[] | 'unavailable';
  try {
    roles = await deps.getRoles(userId);
  } catch {
    roles = 'unavailable';
  }
  if (roles === 'unavailable') return { ok: false, status: 503, error: 'auth_unavailable' };
  if (!roles.some((role) => STAFF_ROLES.includes(role))) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, userId, roles };
}

/** The part of a supabase-js client (service role) the check uses. */
export interface StaffAuthClient {
  auth: {
    getUser(jwt: string): PromiseLike<{ data: { user: { id: string } | null }; error: { status?: number } | null }>;
  };
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: Array<{ role: string }> | null; error: unknown }>;
    };
  };
}

/** Lookups against Supabase with the function's service-role client. */
export function supabaseStaffDeps(client: StaffAuthClient): StaffAuthDeps {
  return {
    async getUserId(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        // supabase-js reports a network failure with status 0 or none, and gateway errors with 5xx.
        const status = typeof error.status === 'number' ? error.status : 0;
        return status === 0 || status >= 500 ? 'unavailable' : null;
      }
      return data.user?.id ?? null;
    },
    async getRoles(userId) {
      const { data, error } = await client.from('user_roles').select('role').eq('user_id', userId);
      if (error || !Array.isArray(data)) return 'unavailable';
      return data.map((row) => String(row.role));
    },
  };
}
