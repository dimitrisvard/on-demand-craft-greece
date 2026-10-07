// New remote tools over the agent layer (default tenant only):
//   mcp_status              the only tool while flag mcp.remote is off
//   list_pending_approvals  waiting runs (approval cards and parked runs): card kind, title, allowed verbs, age
//   list_agent_runs         recent runs: agent, status, cost, error (never tokens or hashes)
//   search_similar_quotes   embeddings (bge-m3) + the quote-line index of the tenant
//   decide_approval         decide() with channel 'mcp': the run's pending card is decided with a verb from its
//                           allowed verbs (quote edits stay on the dashboard)

import { z } from 'zod';
import { decide, DECIDE_STATUS } from '../../agents/decision';
import { daysAgoIso, isoTime } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });

export const MCP_DISABLED_TEXT = 'Remote MCP is disabled (flag mcp.remote)';

export const mcpStatus = tool({
  name: 'mcp_status',
  description: 'Status of the Microns Hub remote MCP server.',
  cls: 'R',
  stage: 'status',
  shape: {},
  async run() {
    return { text: MCP_DISABLED_TEXT };
  },
});

function ageOf(from: unknown, now: Date): string {
  const t = Date.parse(String(from));
  if (!Number.isFinite(t)) return '?';
  const minutes = Math.max(0, Math.round((now.getTime() - t) / 60000));
  return minutes < 120 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`;
}

export const listPendingApprovals = tool({
  name: 'list_pending_approvals',
  description: 'List agent runs waiting for a human: approval cards (with their allowed verbs) and parked runs.',
  cls: 'R',
  stage: 's1',
  shape: {},
  async run(_args, ctx) {
    const { data, error } = await ctx.sb()
      .from('agent_runs')
      .select('id,agent,started_at,updated_at,parked_reason,output')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'waiting_human')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No runs are waiting for a decision.' };
    const now = ctx.deps.now();
    const lines = (data as Array<Record<string, any>>).map((r) => {
      const out = (r.output ?? {}) as Record<string, any>;
      const kind = out.card_kind ?? (r.parked_reason ? `parked:${r.parked_reason}` : 'unknown');
      const title = out.card?.title ? ` | ${String(out.card.title).slice(0, 120)}` : '';
      const verbs = Array.isArray(out.allowed_verbs) && out.allowed_verbs.length ? ` | verbs: ${out.allowed_verbs.join(', ')}` : '';
      return `${r.agent} [${kind}]${title}${verbs} | waiting ${ageOf(r.updated_at ?? r.started_at, now)}\n   run_id: ${r.id}`;
    });
    return { text: `${data.length} runs waiting:\n\n${lines.join('\n')}` };
  },
});

export const listAgentRuns = tool({
  name: 'list_agent_runs',
  description: 'List recent agent runs with agent, trigger, status, cost and error. Filter by agent and status.',
  cls: 'R',
  stage: 's1',
  shape: {
    agent: z.string().optional().describe('Agent key, e.g. rfq_intake, quote, post_order, mcp, growth.scrapers'),
    status: z.enum(['running', 'waiting_human', 'succeeded', 'failed', 'cancelled', 'skipped']).optional(),
    days_back: z.number().optional().default(7),
    limit: z.number().optional().default(20).describe('At most 100'),
  },
  async run({ agent, status, days_back, limit }, ctx) {
    let query = ctx.sb()
      .from('agent_runs')
      .select('id,agent,trigger,status,parked_reason,started_at,finished_at,llm_calls,cost_cents,error')
      .eq('tenant_id', ctx.tenantId)
      .gte('started_at', daysAgoIso(days_back, ctx.deps.now()))
      .order('started_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, Math.floor(limit) || 20)));
    if (agent) query = query.eq('agent', agent);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No agent runs found matching the criteria.' };
    const lines = (data as Array<Record<string, any>>).map((r) =>
      `${isoTime(r.started_at)} ${r.agent} (${r.trigger}) ${r.status}${r.parked_reason ? `/${r.parked_reason}` : ''} | llm ${r.llm_calls} | ${Number(r.cost_cents) / 100} USD${r.error ? ` | error: ${String(r.error).slice(0, 120)}` : ''}\n   run_id: ${r.id}`);
    return { text: `Found ${data.length} runs:\n\n${lines.join('\n')}` };
  },
});

export const searchSimilarQuotes = tool({
  name: 'search_similar_quotes',
  description: 'Find quote lines similar to a part description (material, process, thickness, quantity) in past quotes.',
  cls: 'R',
  stage: 's1',
  shape: {
    text: z.string().describe('Part description, e.g. "2 mm stainless 304 bracket, 4 bends, qty 50"'),
    process: z.enum(['sheet_metal', 'cnc', 'mixed', 'other']).optional(),
    top_k: z.number().optional().default(5).describe('At most 10'),
  },
  async run({ text, process, top_k }, ctx) {
    if (!text.trim()) return err('text is required');
    const ports = ctx.ports();
    const { vectors } = await ports.embed.embed([text.slice(0, 2000)], { agent: 'mcp', run_id: crypto.randomUUID(), tenant_id: ctx.tenantId, step: 'search_similar_quotes' });
    const topK = Math.max(1, Math.min(10, Math.floor(top_k) || 5));
    const matches = await ports.vector.query(ctx.tenantId, vectors[0], { topK, filter: process ? { process: { $eq: process } } : undefined });
    if (matches.length === 0) return { text: 'No similar quote lines found.' };
    const lines = matches.map((m) => {
      const md = m.metadata;
      return `${m.score.toFixed(3)} | ${md.process} ${md.material_grade || md.material_family} ${md.thickness_mm} mm x${md.qty} | unit ${md.unit_price_eur} EUR | ${md.outcome} | RFQ ${md.rfq_id} line ${md.line_no}`;
    });
    return { text: `Top ${matches.length} similar quote lines:\n\n${lines.join('\n')}` };
  },
});

export const decideApproval = tool({
  name: 'decide_approval',
  description: 'Decide a pending approval card of an agent run with one of its allowed verbs (see list_pending_approvals). Quote price edits are made on the dashboard.',
  cls: 'W',
  stage: 's2',
  shape: {
    run_id: z.string().describe('The waiting run (list_pending_approvals)'),
    verb: z.string().describe("One of the card's allowed verbs, e.g. approve, reject, dismiss"),
    note: z.string().optional().describe('Short plain-text note stored with the decision'),
  },
  async run({ run_id, verb, note }, ctx) {
    if (!UUID_RE.test(run_id)) return err('run_id must be a UUID');
    const ports = ctx.ports();
    const rows = await ports.db.select<{ approval_token_sha256: string | null }>('agent_runs', {
      columns: 'approval_token_sha256',
      filters: [['id', 'eq', run_id], ['status', 'eq', 'waiting_human'], ['tenant_id', 'eq', ctx.tenantId]],
      limit: 1,
    });
    const hash = rows[0]?.approval_token_sha256;
    if (!hash) return err(`no pending decision for run ${run_id} (decided already, parked, or not found)`);
    const decided = await decide(ctx.env, ports, { channel: 'mcp', actor: ctx.actor, run_id, token_sha256: hash, verb, ...(note ? { note } : {}) });
    if (!decided.ok) return err(`${decided.error} (${DECIDE_STATUS[decided.error]})`);
    return { text: `${decided.result.label}: run ${decided.result.run_id}, verb ${decided.result.verb}, outcome ${decided.result.outcome}` };
  },
});

export const AGENT_TOOLS: readonly ToolDef[] = [mcpStatus, listPendingApprovals, listAgentRuns, searchSimilarQuotes, decideApproval];
