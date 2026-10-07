// Prompts of the remote MCP server, ported from mcp-server/src/index.ts:1056-1145 (same names, descriptions and
// arguments). They are registered in stages 'read' and 'write' only.

import { z } from 'zod';
import type { McpContext } from './context';
import { formatLead } from './format';
import { todayStart } from './tools/leads';

export interface PromptDef {
  name: string;
  description: string;
  args?: z.ZodRawShape;
  render(args: Record<string, string>, ctx: McpContext): Promise<string>;
}

export const PROMPTS: readonly PromptDef[] = [
  {
    name: 'draft_lead_response',
    description: 'Draft a helpful, non-salesy response to a lead post on behalf of Microns Hub',
    args: { lead_id: z.string().describe('The lead UUID to respond to') },
    async render({ lead_id }, ctx) {
      const { data: lead } = await ctx.sb().from('leads').select('*').eq('id', lead_id).single();
      if (!lead) return `Lead not found: ${lead_id}`;
      return `Draft a response to this post on behalf of Microns Hub:

POST DETAILS:
Title: ${lead.title}
Source: ${lead.subreddit || lead.source}
Body: ${lead.body || '(no body)'}
Keywords matched: ${(lead.matched_keywords || []).join(', ')}

MICRONS HUB INFO:
- European on-demand manufacturing platform (micronshub.eu)
- Based in Heraklion, Greece - ships across all of Europe
- Services: CNC machining (3/4/5-axis), sheet metal fabrication (laser, plasma, waterjet, bending), 3D printing (FDM, SLA, SLS, MJF, DMLS/metal), injection molding, vacuum casting, die casting, surface finishing, rapid prototyping
- 200+ materials: aluminum (6061, 7075), stainless (304, 316L), titanium, PEEK, Delrin, Inconel and many more
- Certifications & inspection reports available
- Special: educational discounts and sponsorships for Formula Student / student teams

RESPONSE GUIDELINES:
1. Be genuinely helpful, not salesy
2. Answer their specific question or address their specific need first
3. Only mention Microns Hub if it's naturally relevant
4. If they're students/competition teams, mention our educational sponsorship program
5. Keep it under 200 words
6. Sound like a knowledgeable professional, not a sales pitch
7. Include a subtle mention of micronshub.eu at the end if appropriate

Draft the response now:`;
    },
  },
  {
    name: 'daily_lead_review',
    description: "Review today's leads and suggest actions for each high-intent lead",
    async render(_args, ctx) {
      const { data: leads } = await ctx.sb()
        .from('leads')
        .select('*')
        .gte('discovered_at', todayStart(ctx.deps.now()))
        .in('auto_score', ['high', 'medium'])
        .eq('status', 'new')
        .order('auto_score');
      const leadsText = leads?.map(formatLead).join('\n\n') || 'No unreviewed leads today.';
      return `Review today's unreviewed leads for Microns Hub and suggest the best actions:

${leadsText}

For each lead:
1. Assess how strong the buying intent is and why
2. Suggest whether to: respond, contact, save for later, or dismiss
3. If responding, suggest the key points to mention
4. Prioritize European leads and competition/student teams

Provide a concise, actionable review:`;
    },
  },
];
