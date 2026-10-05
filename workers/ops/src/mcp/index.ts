// Remote MCP on mcp.micronshub.eu: requests whose host is MCP_HOSTNAME reach handleMcp() from the default fetch.
// Stateless handler (Agents SDK createMcpHandler) around the server factory createMicronsMcpServer(); callers are
// checked with the Cloudflare Access assertion and mapped to a staff role; flag mcp.remote sets the stage.

import type { OpsEnv } from '../env';

export async function handleMcp(req: Request, env: OpsEnv, ctx: ExecutionContext): Promise<Response> {
  throw new Error('not implemented: XZ');
}
