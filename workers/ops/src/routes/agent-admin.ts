// Staff and admin actions of /api/agent/* served by microns-ops (called from src/routes/agent.ts):
//   status  GET   STAFF or ADMIN        AgentStatus
//   flag    POST  ADMIN                 FlagEditBody -> FlagEditResult (feature_flags row, then KV write-through)
//   start   POST  STAFF or ADMIN        StartBody -> StartResult ('test_card' ADMIN only)
//   file    GET   STAFF or ADMIN        staff preview of an R2 object under the fixed key patterns
// The principal comes from the OpsCall the site built (c.var.call), never from a request header.

import type { Context } from 'hono';
import type { OpsHono } from '../env';

export async function handleStatus(c: Context<OpsHono>): Promise<Response> {
  throw new Error('not implemented: W');
}

export async function handleFlag(c: Context<OpsHono>): Promise<Response> {
  throw new Error('not implemented: W');
}

export async function handleStart(c: Context<OpsHono>): Promise<Response> {
  throw new Error('not implemented: W');
}

export async function handleStaffFile(c: Context<OpsHono>): Promise<Response> {
  throw new Error('not implemented: W');
}
