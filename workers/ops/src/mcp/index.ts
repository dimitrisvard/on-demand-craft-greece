// Remote MCP on mcp.micronshub.eu: requests whose host is MCP_HOSTNAME reach handleMcp() from the default fetch.
// Stateless handler (Agents SDK createMcpHandler) around the server factory createMicronsMcpServer(); callers are
// checked with the Cloudflare Access assertion and mapped to a staff role; flag mcp.remote sets the stage.
//
// Order of checks for every request
//   1 configuration: MCP_HOSTNAME, MCP_ROUTE, ACCESS_TEAM_DOMAIN, MCP_ACCESS_AUD, MCP_RATE_LIMIT, SUPABASE_URL and
//     SUPABASE_SERVICE_ROLE_KEY must be set (else 500, logged with the missing names only)
//   2 caller (auth.ts): 401 {"error":"unauthorized"} / 403 {"error":"forbidden"} / 503 {"error":"auth_unavailable"}
//   3 rate limit: MCP_RATE_LIMIT with key 'mcp:<uid>' (60 per 60 s) -> 429 {"error":"rate_limited"}
//   4 stage: readFlag(env, 'mcp.remote') (fail closed -> only mcp_status)
//   5 the SDK handler: route MCP_ROUTE only (else 404), Host must be MCP_HOSTNAME (else 403), a browser Origin is
//     refused (else 403), no CORS headers; JSON-RPC over Streamable HTTP without sessions
// Answers of steps 1-3 are JSON with Cache-Control: no-store. Log lines carry status and reason, never identity.

import { createMcpHandler } from 'agents/mcp/server';
import { jsonResponse } from '../../../shared/src/http/json';
import { configError, missingNames } from '../../../shared/src/http/env-check';
import { formatLogLine } from '../../../shared/src/http/log';
import { readFlag } from '../agents/flags';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { authenticate, principalCache, type PrincipalCache } from './auth';
import { createContext, defaultDeps, type McpDeps } from './context';
import { callInProcess } from './inprocess';
import { stageOf } from './registry';
import { createMicronsMcpServer } from './server';

export const MCP_CONFIG_NAMES = ['MCP_HOSTNAME', 'MCP_ROUTE', 'ACCESS_TEAM_DOMAIN', 'MCP_ACCESS_AUD', 'MCP_RATE_LIMIT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

const NO_STORE = { 'Cache-Control': 'no-store' };

export interface HandleMcpOptions {
  deps?: Partial<McpDeps>;
  /** fetch for the Access certificates (tests). */
  certsFetch?: typeof fetch;
  principalCache?: PrincipalCache;
  nowSec?: () => number;
}

export async function handleMcp(req: Request, env: OpsEnv, ctx: ExecutionContext, o: HandleMcpOptions = {}): Promise<Response> {
  const missing = missingNames(env, MCP_CONFIG_NAMES as unknown as string[]);
  if (missing.length > 0) return configError(LOG_PREFIX, missing);
  const deps: McpDeps = { ...defaultDeps(callInProcess), ...o.deps };

  const auth = await authenticate(req.headers, {
    teamDomain: env.ACCESS_TEAM_DOMAIN as string,
    audience: env.MCP_ACCESS_AUD as string,
    db: deps.ports(env).db,
    fetchImpl: o.certsFetch,
    nowSec: o.nowSec,
    cache: o.principalCache ?? principalCache,
  });
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error }, NO_STORE);

  const limited = await (env.MCP_RATE_LIMIT as RateLimit).limit({ key: `mcp:${auth.principal.uid}` });
  if (!limited.success) {
    console.error(formatLogLine(LOG_PREFIX, 'mcp rate limited', { status: 429 }));
    return jsonResponse(429, { error: 'rate_limited' }, { ...NO_STORE, 'Retry-After': '60' });
  }

  const stage = stageOf(await readFlag(env, 'mcp.remote'));
  const mcpCtx = createContext({ env, exec: ctx, principal: auth.principal, stage, deps });
  const handler = createMcpHandler(() => createMicronsMcpServer(mcpCtx), {
    route: env.MCP_ROUTE,
    allowedHostnames: [env.MCP_HOSTNAME as string],
    corsOptions: false,
    authContext: { props: { uid: auth.principal.uid, roles: auth.principal.roles, class: auth.principal.class, stage: stage.name } },
  });
  return handler(req, env, ctx);
}
