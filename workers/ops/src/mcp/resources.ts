// Resources of the remote MCP server, ported from mcp-server/src/index.ts:982-1054 (same names, URIs and
// descriptions). They are registered in stages 'read' and 'write' only.

import type { McpContext } from './context';
import { todayStart } from './tools/leads';

export interface ResourceDef {
  name: string;
  uri: string;
  description: string;
  read(ctx: McpContext): Promise<string>;
}

const TIER_LABEL: Record<number, string> = { 1: '15min', 2: '30min', 3: '30min', 4: '60min', 5: '2hr' };

export const RESOURCES: readonly ResourceDef[] = [
  {
    name: 'leads://today',
    uri: 'leads://today',
    description: "Summary of today's leads with counts by source and score",
    async read(ctx) {
      const now = ctx.deps.now();
      const { data } = await ctx.sb().from('leads').select('id, source, auto_score, status, title, discovered_at').gte('discovered_at', todayStart(now)).order('discovered_at', { ascending: false });
      const rows = (data ?? []) as Array<Record<string, string>>;
      const byScore: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      for (const l of rows) {
        byScore[l.auto_score] = (byScore[l.auto_score] || 0) + 1;
        bySource[l.source] = (bySource[l.source] || 0) + 1;
      }
      return `TODAY'S LEADS - ${now.toISOString().slice(0, 10)}\n\n`
        + `Total: ${rows.length}\n`
        + `High: ${byScore.high || 0} | Medium: ${byScore.medium || 0} | Low: ${byScore.low || 0}\n\n`
        + `By source: ${Object.entries(bySource).map(([s, n]) => `${s}=${n}`).join(', ')}\n\n`
        + (rows.slice(0, 5).map((l) => `- [${l.auto_score?.toUpperCase()}] ${String(l.title).slice(0, 60)}...`).join('\n') || 'No leads yet today');
    },
  },
  {
    name: 'leads://keywords',
    uri: 'leads://keywords',
    description: 'Currently active monitoring keywords by category',
    async read(ctx) {
      const { data } = await ctx.sb().from('lead_keywords').select('*').eq('is_active', true).order('category');
      const byCategory: Record<string, string[]> = {};
      for (const kw of (data ?? []) as Array<Record<string, string>>) (byCategory[kw.category] ??= []).push(kw.keyword);
      return Object.entries(byCategory).map(([cat, kws]) => `${cat.toUpperCase()}:\n${kws.map((k) => `  - ${k}`).join('\n')}`).join('\n\n');
    },
  },
  {
    name: 'leads://subreddits',
    uri: 'leads://subreddits',
    description: 'Currently monitored subreddits with scan tiers and intervals',
    async read(ctx) {
      const { data } = await ctx.sb().from('monitored_subreddits').select('*').eq('is_active', true).order('tier');
      const byTier: Record<number, string[]> = {};
      for (const s of (data ?? []) as Array<Record<string, any>>) (byTier[s.tier] ??= []).push(`r/${s.subreddit}`);
      return Object.entries(byTier).map(([t, subs]) => `TIER ${t} (every ${TIER_LABEL[parseInt(t)] || '?'}):\n${subs.join(', ')}`).join('\n\n');
    },
  },
];
