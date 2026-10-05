// The OPS RPC contract is types only; these assertions are checked by `npm run typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import type { EndpointId, OpsApiRpc, OpsCall, Principal, PrincipalClass } from '../../src/http/rpc';

describe('OPS RPC contract', () => {
  it('names every routed endpoint', () => {
    expectTypeOf<EndpointId>().toEqualTypeOf<
      | 'emails' | 's3' | 'marketing' | 'notifications' | 'gsc' | 'tenders' | 'tender-scan'
      | 'funded-startups' | 'scrape-website' | 'scrape-company-profile' | 'scan-directory'
      | 'agent'
    >();
  });

  it('has six principal classes and a machine name only as an optional field', () => {
    expectTypeOf<PrincipalClass>().toEqualTypeOf<'ANON' | 'CUSTOMER' | 'PARTNER' | 'STAFF' | 'ADMIN' | 'MACHINE'>();
    expectTypeOf<Principal>().toEqualTypeOf<{
      class: PrincipalClass;
      uid?: string;
      email?: string;
      roles?: string[];
      machine?: 'collector' | 'mcp' | 'telegram';
    }>();
  });

  it('carries version 1, the request id, the resolution, the function URL and the principal', () => {
    expectTypeOf<OpsCall>().toEqualTypeOf<{
      v: 1;
      requestId: string;
      endpoint: EndpointId;
      action: string;
      functionUrl: string;
      principal: Principal;
      openerOrigin?: string;
    }>();
  });

  it('exposes one RPC method, handle(request, call)', () => {
    expectTypeOf<OpsApiRpc['handle']>().toEqualTypeOf<(request: Request, call: OpsCall) => Promise<Response>>();
  });
});
