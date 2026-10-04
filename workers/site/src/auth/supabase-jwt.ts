// Site adapter over the shared Supabase JWT check: reads the bearer, checks the names it needs and turns the
// verified user into a Principal. Needs SUPABASE_URL and SUPABASE_ANON_KEY (Phase 1 names) only.

import { missingNames } from '../../../shared/src/http/env-check';
import { bearerToken, classOfRoles, verifySupabaseJwt } from '../../../shared/src/auth/supabase-jwt';
import type { Principal } from '../../../shared/src/http/rpc';
import type { Env } from '../env';

export const USER_AUTH_NAMES = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const;

export type UserAuth =
  | { kind: 'none' }                                     // no bearer token
  | { kind: 'user'; principal: Principal; token: string }
  | { kind: 'invalid' }                                  // refused: 401
  | { kind: 'unavailable' }                              // Supabase unreachable: 503
  | { kind: 'config'; missing: string[] };

export async function userAuth(request: Request, env: Env): Promise<UserAuth> {
  const token = bearerToken(request.headers);
  if (!token) return { kind: 'none' };
  const missing = missingNames(env, USER_AUTH_NAMES);
  if (missing.length) return { kind: 'config', missing };
  const result = await verifySupabaseJwt(token, { supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!result.ok) return result.status === 503 ? { kind: 'unavailable' } : { kind: 'invalid' };
  const { uid, email, roles } = result.user;
  const principal: Principal = { class: classOfRoles(roles), uid, roles };
  if (email) principal.email = email;
  return { kind: 'user', principal, token };
}
