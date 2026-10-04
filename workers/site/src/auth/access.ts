// Site adapter for machine callers (Cloudflare Access service tokens). A machine principal is accepted only on a
// preview host or on a host listed in API_MACHINE_HOSTS (comma list, exact lower-case match), and only when the
// assertion verifies and its client id is mapped in ACCESS_MACHINE_CLIENT_IDS. Any other Access identity (the CI
// token, a person signed in to Access) is not an API credential. Needs ACCESS_TEAM_DOMAIN, ACCESS_AUD and
// ACCESS_MACHINE_CLIENT_IDS, checked only when an assertion is present on an allowed host.

import { ACCESS_ASSERTION_HEADER, parseMachineMap, verifyAccessAssertion } from '../../../shared/src/auth/access-jwt';
import { missingNames } from '../../../shared/src/http/env-check';
import type { Principal } from '../../../shared/src/http/rpc';
import type { Env } from '../env';
import { isPreviewHost } from '../preview';

export const MACHINE_AUTH_NAMES = ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_MACHINE_CLIENT_IDS'] as const;

export type MachineAuth =
  | { kind: 'none' }                                         // no assertion, or a host that never accepts machines
  | { kind: 'machine'; name: 'collector' | 'mcp'; principal: Principal }
  | { kind: 'not_machine' }                                  // a valid Access identity that is not a mapped machine
  | { kind: 'invalid' }
  | { kind: 'config'; missing: string[] };

export function machineHostAllowed(hostname: string, env: Env): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (isPreviewHost(host, env)) return true;
  return (env.API_MACHINE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(host);
}

export async function machineAuth(request: Request, env: Env, url: URL): Promise<MachineAuth> {
  if (!request.headers.get(ACCESS_ASSERTION_HEADER)) return { kind: 'none' };
  if (!machineHostAllowed(url.hostname, env)) return { kind: 'none' };
  const missing = missingNames(env, MACHINE_AUTH_NAMES);
  if (missing.length) return { kind: 'config', missing };
  const result = await verifyAccessAssertion(request.headers, {
    teamDomain: env.ACCESS_TEAM_DOMAIN as string,
    audiences: (env.ACCESS_AUD as string).split(','),
  });
  if (!result.ok) {
    console.log(`[microns-site] gate access_invalid ${result.reason}`);
    return { kind: 'invalid' };
  }
  const name = result.commonName ? parseMachineMap(env.ACCESS_MACHINE_CLIENT_IDS).get(result.commonName) : undefined;
  if (!name) return { kind: 'not_machine' };
  return { kind: 'machine', name, principal: { class: 'MACHINE', machine: name } };
}
