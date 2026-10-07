// Tool definitions, stages and registration of the remote MCP server.
//
// Stages (flag mcp.remote, read per request with readFlag; fail closed)
//   off      flag off, missing or unreadable          -> only mcp_status
//   read     enabled, value.writes not true           -> every 's1' tool (35), 3 resources, 2 prompts
//   write    enabled, value.writes true               -> 'read' + every 's2' tool (5) + each 'opt' tool named in
//                                                         value.write_tools (unknown names are ignored and logged)
// A tool that is not registered for the stage cannot be called (the server answers "tool not found").
//
// Classes and annotations
//   R  reads only                           readOnlyHint: true
//   W  writes Supabase                      readOnlyHint: false, destructiveHint: false, idempotentHint per tool
//   X  external effect (fetches third-party sites, calls Google APIs or enqueues scans)
//                                           as W plus openWorldHint: true
// Descriptions of W and X tools end with WRITE_NOTICE.
//
// Results: one text content block; at most 100 KiB of text (a tool may allow more, the CSV export 200 KiB plus its
// note); a longer text is cut with a note naming the omitted size. A tool call has a 25 s budget; past it the
// call answers an error result (long work is queued instead).

import { z } from 'zod';
import type { AgentFlag } from '../agents/flags';
import { formatLogLine } from '../../../shared/src/http/log';
import { LOG_PREFIX } from '../env';
import type { McpContext } from './context';

export const WRITE_NOTICE = 'Changes data in Microns Hub; confirm with the user before calling.';
export const RESULT_MAX_BYTES = 100 * 1024;
export const TOOL_TIMEOUT_MS = 25_000;

export type ToolClass = 'R' | 'W' | 'X';
export type ToolStage = 'status' | 's1' | 's2' | 'opt';

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  /** Description as the local server words it (WRITE_NOTICE is appended for W and X tools at registration). */
  description: string;
  shape: z.ZodRawShape;
  cls: ToolClass;
  stage: ToolStage;
  /** W/X: repeated calls with the same arguments have no further effect. */
  idempotent?: boolean;
  /** Largest result text in bytes (default RESULT_MAX_BYTES). */
  maxBytes?: number;
  run(args: Record<string, unknown>, ctx: McpContext): Promise<ToolResult>;
}

export interface McpStage {
  name: 'off' | 'read' | 'write';
  /** Opt-in tools enabled by value.write_tools (stage 'write' only). */
  writeTools: string[];
}

/** Defines a tool with typed arguments (the registry stores it untyped). */
export function tool<S extends z.ZodRawShape>(def: Omit<ToolDef, 'shape' | 'run'> & { shape: S; run(args: z.output<z.ZodObject<S>>, ctx: McpContext): Promise<ToolResult> }): ToolDef {
  return def as unknown as ToolDef;
}

/** Stage of a flag value (see the rules above). */
export function stageOf(flag: AgentFlag): McpStage {
  if (!flag.enabled) return { name: 'off', writeTools: [] };
  if (flag.value.writes !== true) return { name: 'read', writeTools: [] };
  const named = Array.isArray(flag.value.write_tools) ? flag.value.write_tools.filter((t): t is string => typeof t === 'string') : [];
  return { name: 'write', writeTools: [...new Set(named)] };
}

/** The tools of a stage; for a name defined twice ('s1' list-only and 'opt' full), the opt-in variant wins. */
export function toolsForStage(defs: readonly ToolDef[], stage: McpStage): ToolDef[] {
  if (stage.name === 'off') return defs.filter((d) => d.stage === 'status');
  const optNames = new Set(defs.filter((d) => d.stage === 'opt').map((d) => d.name));
  const enabledOpt = stage.name === 'write' ? new Set(stage.writeTools.filter((n) => optNames.has(n))) : new Set<string>();
  if (stage.name === 'write') {
    for (const unknown of stage.writeTools.filter((n) => !optNames.has(n))) {
      console.error(formatLogLine(LOG_PREFIX, 'mcp write_tools name ignored', { tool: /^[a-z0-9_]{1,64}$/.test(unknown) ? unknown : 'invalid' }));
    }
  }
  const out: ToolDef[] = [];
  for (const d of defs) {
    if (d.stage === 's1' && !enabledOpt.has(d.name)) out.push(d);
    else if (d.stage === 's2' && stage.name === 'write') out.push(d);
    else if (d.stage === 'opt' && enabledOpt.has(d.name)) out.push(d);
  }
  return out;
}

/** Every tool at its widest variant (parity view: stage 'write' with every opt-in tool). */
export function allTools(defs: readonly ToolDef[]): ToolDef[] {
  const optNames = defs.filter((d) => d.stage === 'opt').map((d) => d.name);
  return toolsForStage(defs, { name: 'write', writeTools: optNames });
}

export function annotationsOf(d: ToolDef): Record<string, boolean> {
  if (d.cls === 'R') return { readOnlyHint: true };
  const base: Record<string, boolean> = { readOnlyHint: false, destructiveHint: false, idempotentHint: d.idempotent === true };
  if (d.cls === 'X') base.openWorldHint = true;
  return base;
}

export function descriptionOf(d: ToolDef): string {
  return d.cls === 'R' ? d.description : `${d.description} ${WRITE_NOTICE}`;
}

/** Cuts a text to `maxBytes` of UTF-8 with a note naming the omitted size. */
export function capText(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  let cut = new TextDecoder().decode(bytes.slice(0, maxBytes));
  if (cut.endsWith('�')) cut = cut.slice(0, -1);
  return `${cut}\n\n[... ${bytes.length - new TextEncoder().encode(cut).length} more bytes not shown; narrow the filters]`;
}

/** Runs a tool with the 25 s budget; a throw or the deadline becomes an error result. */
export async function runBounded(d: ToolDef, args: Record<string, unknown>, ctx: McpContext, timeoutMs = TOOL_TIMEOUT_MS): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ToolResult>((resolve) => {
    timer = setTimeout(() => resolve({ text: `Error: ${d.name} did not finish within ${Math.round(timeoutMs / 1000)} s`, isError: true }), timeoutMs);
  });
  try {
    const result = await Promise.race([d.run(args, ctx), deadline]);
    return { ...result, text: capText(result.text, d.maxBytes ?? RESULT_MAX_BYTES) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatLogLine(LOG_PREFIX, 'mcp tool failed', { tool: d.name, error: error instanceof Error ? error.name : typeof error }));
    return { text: `Error: ${message.slice(0, 300)}`, isError: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
