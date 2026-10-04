// PostgREST lookups for gate decisions. Two identities:
//   service  the service key (names SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY): RFQ, customer, partner and
//            marketing rows the gate reads on the caller's behalf
//   user     the caller's own JWT with the anon key (names SUPABASE_URL, SUPABASE_ANON_KEY): ownership is decided
//            by the database's row-level security and my_rfq_ids(), never by code here
// Every lookup answers 'unavailable' when the database could not be asked (network, timeout, 5xx).

import { filterValue, restRequest, rowsOf, type RestInit, type RestResult } from '../../../shared/src/auth/postgrest';
import type { Env } from '../env';

export const SERVICE_NAMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
export const USER_DB_NAMES = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RFQ_NUMBER_RE = /^RFQ-\d{8}-\d+$/;

export type Unavailable = 'unavailable';

export function serviceRest(env: Env, pathAndQuery: string, init?: RestInit, timeoutMs?: number): Promise<RestResult> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return restRequest({ supabaseUrl: env.SUPABASE_URL, apiKey: key, bearer: key, timeoutMs }, pathAndQuery, init);
}

export function userRest(env: Env, userJwt: string, pathAndQuery: string, init?: RestInit): Promise<RestResult> {
  return restRequest({ supabaseUrl: env.SUPABASE_URL, apiKey: env.SUPABASE_ANON_KEY, bearer: userJwt }, pathAndQuery, init);
}

function field(row: unknown, name: string): unknown {
  return row && typeof row === 'object' ? (row as Record<string, unknown>)[name] : undefined;
}

export interface RfqRow {
  id: string;
  customerId: string | null;
  createdAt: string | null;
}

/** The RFQ with this number, or null when there is none (or the lookup is refused). */
export async function rfqByNumber(env: Env, rfqNumber: string): Promise<RfqRow | null | Unavailable> {
  const result = await serviceRest(env, `rfqs?select=id,customer_id,created_at&rfq_number=eq.${filterValue(rfqNumber)}&limit=1`);
  if (result.kind === 'unavailable') return 'unavailable';
  const row = rowsOf(result)[0];
  const id = field(row, 'id');
  if (typeof id !== 'string') return null;
  const customerId = field(row, 'customer_id');
  const createdAt = field(row, 'created_at');
  return { id, customerId: typeof customerId === 'string' ? customerId : null, createdAt: typeof createdAt === 'string' ? createdAt : null };
}

/** E-mail address of a customer row. */
export async function customerEmailById(env: Env, customerId: string | null): Promise<string | null | Unavailable> {
  if (!customerId || !UUID_RE.test(customerId)) return null;
  const result = await serviceRest(env, `customers?select=email&id=eq.${customerId}&limit=1`);
  if (result.kind === 'unavailable') return 'unavailable';
  const email = field(rowsOf(result)[0], 'email');
  return typeof email === 'string' && email ? email : null;
}

/** E-mail address of the customer the RFQ with this number belongs to. */
export async function rfqCustomerEmail(env: Env, rfqNumber: string): Promise<string | null | Unavailable> {
  const rfq = await rfqByNumber(env, rfqNumber);
  if (rfq === 'unavailable') return rfq;
  if (!rfq) return null;
  return customerEmailById(env, rfq.customerId);
}

/** Same address, compared case-insensitively. */
export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** RFQ ids the caller owns as a customer (my_rfq_ids() with the caller's JWT). */
export async function myRfqIds(env: Env, userJwt: string): Promise<Set<string> | Unavailable> {
  const result = await userRest(env, userJwt, 'rpc/my_rfq_ids', { method: 'POST', body: {} });
  if (result.kind === 'unavailable') return 'unavailable';
  const ids = new Set<string>();
  for (const item of rowsOf(result)) {
    // A set-returning function of a scalar type may arrive as bare values or as one-column rows.
    const value = typeof item === 'string' ? item : field(item, 'my_rfq_ids');
    if (typeof value === 'string') ids.add(value.toLowerCase());
  }
  return ids;
}

/** Whether an rfq_files row with this file_path is visible to the caller under row-level security. */
export async function rfqFileVisible(env: Env, userJwt: string, key: string): Promise<boolean | Unavailable> {
  const result = await userRest(env, userJwt, `rfq_files?select=id&file_path=eq.${filterValue(key)}&limit=1`);
  if (result.kind === 'unavailable') return 'unavailable';
  return rowsOf(result).length > 0;
}

/** Whether an active production partner has exactly this e-mail address. */
export async function activePartnerEmail(env: Env, email: string): Promise<boolean | Unavailable> {
  const result = await serviceRest(env, `production_partners?select=id&active=eq.true&email=eq.${filterValue(email)}&limit=1`);
  if (result.kind === 'unavailable') return 'unavailable';
  return rowsOf(result).length > 0;
}
