// RPC contract between microns-site and microns-ops (service binding OPS, named entrypoint OpsApi).
// The site resolves the endpoint and action, verifies the caller and sends the result in `call`; the verified
// principal and the function URL travel only in `call`, never in request headers, so a client cannot supply them.
// A breaking change adds a new version number (`v`), and ops accepts both versions for one release.

export type EndpointId =
  | 'emails' | 's3' | 'marketing' | 'notifications' | 'gsc' | 'tenders' | 'tender-scan'
  | 'funded-startups' | 'scrape-website' | 'scrape-company-profile' | 'scan-directory'
  // Phase 4: /api/agent/* (decision, status, flag, start, file), served by microns-ops.
  | 'agent'
  // Phase 5: /api/cad/<token>/flat-pattern (CAD compat path of the untouched edge functions), served by microns-ops.
  | 'cad-compat';

export type PrincipalClass = 'ANON' | 'CUSTOMER' | 'PARTNER' | 'STAFF' | 'ADMIN' | 'MACHINE';

export interface Principal {
  /** Highest class: ADMIN > STAFF > PARTNER > CUSTOMER; ADMIN implies STAFF. */
  class: PrincipalClass;
  /** Supabase user id. */
  uid?: string;
  /** Supabase user e-mail address; never logged. */
  email?: string;
  /** user_roles.role values as read (array). */
  roles?: string[];
  /** MACHINE only: the machine caller's name ('telegram' = the approval relay, Phase 4; 'cad-compat' = the CAD
   *  compat path, Phase 5). */
  machine?: 'collector' | 'mcp' | 'telegram' | 'cad-compat';
}

export interface OpsCall {
  v: 1;
  /** crypto.randomUUID(), logged by both Workers. */
  requestId: string;
  endpoint: EndpointId;
  /** Normalised action; a value starting with '#' is a sentinel that the handler answers itself, ungated. */
  action: string;
  /** Path + query the handler sees (rewrite merged). */
  functionUrl: string;
  principal: Principal;
  /** marketing google-auth authorize only: origin of the request URL, validated by the site gate. */
  openerOrigin?: string;
}

export interface OpsApiRpc {
  handle(request: Request, call: OpsCall): Promise<Response>;
}
