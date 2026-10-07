// Audit and deduplication of remote MCP tool calls: one agent_runs row per tools/call (agent 'mcp', trigger 'mcp').
//
// Rules
//   - output = {tool, actor: 'user:<uid>', ok, ms, args_sha256, result_summary}; result_summary is the first line
//     of the answer (at most 300 characters, e-mail addresses masked, every string argument of 3 or more characters
//     that the answer echoes replaced by '[arg]'). Raw arguments are never stored (they may hold personal data);
//     args_sha256 is the SHA-256 of their canonical JSON.
//   - Read tools (class R): idempotency key 'mcp:r:<uuid>'; the row is opened and closed after the answer, in
//     ctx.waitUntil; a failed audit write is logged and does not change the answer.
//   - Write and external-effect tools (W, X): idempotency key
//     'mcp:w:<tool>:<first 32 hex of SHA-256(canonical JSON [uid, tool, args])>:<floor(now / 600 s)>'; the row is
//     opened through rpc/agent_run_begin BEFORE the effect. When the key exists: 'succeeded' -> the stored
//     output.result_text (at most 4 KiB) is answered again without a second effect; 'failed' -> an error answer
//     (the same call can be retried in the next 10-minute bucket); otherwise -> "already running". A write whose
//     audit row cannot be opened is not run.
//   - The row is closed 'succeeded' or 'failed' (error 'tool_error') with cost 0 (no LLM call).

import { canonicalJson, sha256hex } from '../agents/ids';
import { EMPTY_USAGE, closeRun, openRun } from '../agents/runs';
import { getRun } from '../db/repos/agent-runs';
import { formatLogLine } from '../../../shared/src/http/log';
import { LOG_PREFIX } from '../env';
import type { McpContext } from './context';
import { runBounded, type ToolDef, type ToolResult } from './registry';

export const WRITE_BUCKET_MS = 600_000;
export const RESULT_TEXT_MAX = 4096;
export const SUMMARY_MAX = 300;

const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function stringArgs(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringArgs(v, out);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) stringArgs(v, out);
  return out;
}

/** First line of a result, argument echoes replaced, e-mail addresses masked, at most 300 characters. */
export function summaryOf(text: string, args: Record<string, unknown> = {}): string {
  let first = text.split('\n').find((l) => l.trim() !== '') ?? '';
  for (const value of stringArgs(args).filter((v) => v.length >= 3).sort((a, b) => b.length - a.length)) first = first.split(value).join('[arg]');
  return first.replace(EMAIL_RE, (_m, a: string, domain: string) => `${a}***@${domain.toLowerCase()}`).slice(0, SUMMARY_MAX);
}

/** Idempotency key of a write call (see the rules above). */
export async function writeKey(uid: string, tool: string, args: Record<string, unknown>, nowMs: number): Promise<string> {
  const digest = (await sha256hex(canonicalJson([uid, tool, args]))).slice(0, 32);
  return `mcp:w:${tool}:${digest}:${Math.floor(nowMs / WRITE_BUCKET_MS)}`;
}

function cut(text: string, max: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return text;
  return new TextDecoder().decode(bytes.slice(0, max)).replace(/�$/, '');
}

const FIXED_EMPTY = () => ({ ...EMPTY_USAGE, by_step: {} });

async function closeQuietly(ctx: McpContext, runId: string, ok: boolean, output: Record<string, unknown>): Promise<void> {
  try {
    await closeRun(ctx.ports().db, runId, { status: ok ? 'succeeded' : 'failed', error: ok ? undefined : 'tool_error', output }, FIXED_EMPTY());
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'mcp audit close failed', { run_id: runId }));
  }
}

/** Runs one tools/call with its audit row (see the rules above). */
export async function auditedCall(d: ToolDef, args: Record<string, unknown>, ctx: McpContext): Promise<ToolResult> {
  const started = ctx.deps.now().getTime();
  const argsSha = await sha256hex(canonicalJson(args));
  const base = { tool: d.name, actor: ctx.actor, args_sha256: argsSha };

  if (d.cls === 'R') {
    const result = await runBounded(d, args, ctx);
    const ms = ctx.deps.now().getTime() - started;
    const output = { ...base, ok: !result.isError, ms, result_summary: summaryOf(result.text, args) };
    ctx.exec.waitUntil((async () => {
      try {
        const opened = await openRun(ctx.ports().db, { agent: 'mcp', trigger: 'mcp', idempotency_key: `mcp:r:${crypto.randomUUID()}`, tenant_id: ctx.tenantId });
        await closeQuietly(ctx, opened.run_id, !result.isError, output);
      } catch {
        console.error(formatLogLine(LOG_PREFIX, 'mcp audit failed', { tool: d.name }));
      }
    })());
    return result;
  }

  const key = await writeKey(ctx.principal.uid, d.name, args, started);
  let opened: { run_id: string; created: boolean };
  try {
    opened = await openRun(ctx.ports().db, { agent: 'mcp', trigger: 'mcp', idempotency_key: key, tenant_id: ctx.tenantId });
  } catch {
    console.error(formatLogLine(LOG_PREFIX, 'mcp audit failed', { tool: d.name }));
    return { text: 'Error: the call could not be recorded, so it was not run. Try again later.', isError: true };
  }
  if (!opened.created) {
    const row = await getRun(ctx.ports().db, opened.run_id).catch(() => null);
    const stored = row?.output && typeof row.output.result_text === 'string' ? row.output.result_text : null;
    if (row?.status === 'succeeded') return { text: stored ?? 'Already done: the same call ran in the last 10 minutes.' };
    if (row?.status === 'failed') {
      return { text: `Error: the same call failed in the current 10-minute window${stored ? ` (${summaryOf(stored, args)})` : ''}; retry after the window ends.`, isError: true };
    }
    return { text: 'Error: the same call is already running; wait for it to finish.', isError: true };
  }
  const result = await runBounded(d, args, ctx);
  const ms = ctx.deps.now().getTime() - started;
  await closeQuietly(ctx, opened.run_id, !result.isError, { ...base, ok: !result.isError, ms, result_summary: summaryOf(result.text, args), result_text: cut(result.text, RESULT_TEXT_MAX) });
  return result;
}
