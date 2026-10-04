// Supabase user JWT verification: a local pre-check, then GET {SUPABASE_URL}/auth/v1/user; roles are read as an
// array from user_roles with the caller's JWT. No JWT secret is held by any Worker.

/** Roles that make a user staff (api/_lib/admin-auth.js). */
export const STAFF_ROLES: readonly ['admin', 'sales_rep', 'production_manager', 'accountant'] =
  ['admin', 'sales_rep', 'production_manager', 'accountant'];

export interface SupabaseAuthConfig {
  supabaseUrl: string;
  anonKey: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export interface VerifiedUser {
  uid: string;
  email: string | null;
  roles: string[];
}

export type JwtResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; status: 401 | 503; code: 'unauthorized' | 'auth_unavailable' };

export function bearerToken(headers: Headers): string | null {
  throw new Error('not implemented: G');
}

export function precheckSupabaseJwt(token: string, nowSec: number): { ok: true; sub: string; exp: number } | { ok: false } {
  throw new Error('not implemented: G');
}

export function verifySupabaseJwt(token: string, cfg: SupabaseAuthConfig): Promise<JwtResult> {
  throw new Error('not implemented: G');
}

export function classOfRoles(roles: string[]): 'ADMIN' | 'STAFF' | 'PARTNER' | 'CUSTOMER' {
  throw new Error('not implemented: G');
}
