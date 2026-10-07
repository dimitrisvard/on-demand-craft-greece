// Lead monitor tools, ported from mcp-server/src/index.ts:174-616 (same names, descriptions, input schemas and
// query builders). Changes: activity rows carry performed_by 'mcp:<uid>'; manage_keywords and manage_subreddits are
// list-only in stage 1 (the full tools are opt-in).

import { z } from 'zod';
import type { McpContext } from '../context';
import { daysAgoIso, formatLead, isoDate, isoTime } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

const err = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });

function performedBy(ctx: McpContext): string {
  return `mcp:${ctx.principal.uid}`;
}

export const getLeads = tool({
  name: 'get_leads',
  description: 'Get leads from the monitoring system. Filter by source, score, status, date range, or keyword.',
  cls: 'R',
  stage: 's1',
  shape: {
    source: z.enum(['reddit', 'hackernews', 'twitter', 'forum', 'all']).optional().default('all'),
    score: z.enum(['high', 'medium', 'low', 'unscored', 'all']).optional().default('all'),
    status: z.enum(['new', 'reviewed', 'contacted', 'saved', 'dismissed', 'converted', 'all']).optional().default('all'),
    industry: z.string().optional(),
    keyword: z.string().optional(),
    limit: z.number().optional().default(20),
    days_back: z.number().optional().default(1),
  },
  async run({ source, score, status, industry, keyword, limit, days_back }, ctx) {
    let query = ctx.sb().from('leads').select('*').order('discovered_at', { ascending: false }).limit(limit);
    if (source !== 'all') query = query.eq('source', source);
    if (score !== 'all') query = query.eq('auto_score', score);
    if (status !== 'all') query = query.eq('status', status);
    if (industry) query = query.contains('industry_tags', [industry]);
    if (keyword) query = query.contains('matched_keywords', [keyword]);
    if (days_back > 0) query = query.gte('discovered_at', daysAgoIso(days_back, ctx.deps.now()));
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No leads found matching the specified criteria.' };
    return { text: `Found ${data.length} leads:\n\n${data.map(formatLead).join('\n\n')}` };
  },
});

export const getLeadDetail = tool({
  name: 'get_lead_detail',
  description: 'Get full details of a specific lead including post body, matched keywords, notes, and activity history.',
  cls: 'R',
  stage: 's1',
  shape: { lead_id: z.string().describe('The lead UUID') },
  async run({ lead_id }, ctx) {
    const sb = ctx.sb();
    const [leadRes, activityRes] = await Promise.all([
      sb.from('leads').select('*').eq('id', lead_id).single(),
      sb.from('lead_activity').select('*').eq('lead_id', lead_id).order('created_at', { ascending: false }),
    ]);
    if (leadRes.error || !leadRes.data) return { text: `Lead not found: ${lead_id}` };
    const lead = leadRes.data;
    const activity = activityRes.data || [];
    const text = [
      '=== LEAD DETAIL ===',
      `ID: ${lead.id}`,
      `Title: ${lead.title}`,
      `Source: ${lead.source} - ${lead.subreddit || ''}`,
      `Author: ${lead.author || 'unknown'} (${lead.author_url || ''})`,
      `Score: ${lead.manual_score || lead.auto_score} ${lead.manual_score ? '(manual override)' : '(auto)'}`,
      `Status: ${lead.status}`,
      `Post URL: ${lead.source_url}`,
      `Upvotes: ${lead.upvotes} | Comments: ${lead.comments_count}`,
      `Posted: ${isoTime(lead.post_created_at)}`,
      `Discovered: ${isoTime(lead.discovered_at)}`,
      '',
      `Keywords matched: ${(lead.matched_keywords || []).join(', ')}`,
      `Categories: ${(lead.matched_categories || []).join(', ')}`,
      `Industry tags: ${(lead.industry_tags || []).join(', ') || 'none'}`,
      '',
      '=== POST BODY ===',
      lead.body || '(no body text)',
      '',
      lead.notes ? `=== NOTES ===\n${lead.notes}\n` : '',
      lead.suggested_response ? `=== SUGGESTED RESPONSE ===\n${lead.suggested_response}\n` : '',
      activity.length > 0
        ? `=== ACTIVITY LOG ===\n${activity.map((a: Record<string, unknown>) => `${isoTime(a.created_at)} - ${a.action}: ${a.old_value || ''} -> ${a.new_value || ''} (${a.performed_by})`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n');
    return { text };
  },
});

export const scoreLead = tool({
  name: 'score_lead',
  description: 'Manually score a lead as high, medium, or low intent. This overrides the automatic score.',
  cls: 'W',
  stage: 'opt',
  idempotent: true,
  shape: { lead_id: z.string(), score: z.enum(['high', 'medium', 'low']), notes: z.string().optional() },
  async run({ lead_id, score, notes }, ctx) {
    const updates: Record<string, unknown> = { manual_score: score, updated_at: ctx.deps.now().toISOString() };
    if (notes) updates.notes = notes;
    const sb = ctx.sb();
    const { error } = await sb.from('leads').update(updates).eq('id', lead_id);
    if (error) return err(error.message);
    await sb.from('lead_activity').insert({ lead_id, action: 'scored', new_value: score, performed_by: performedBy(ctx) });
    return { text: `Lead ${lead_id} scored as ${score.toUpperCase()}${notes ? ' with notes' : ''}.` };
  },
});

export const updateLeadStatus = tool({
  name: 'update_lead_status',
  description: 'Update the status of a lead (new, reviewed, contacted, saved, dismissed, converted).',
  cls: 'W',
  stage: 's2',
  idempotent: true,
  shape: { lead_id: z.string(), status: z.enum(['new', 'reviewed', 'contacted', 'saved', 'dismissed', 'converted']), notes: z.string().optional() },
  async run({ lead_id, status, notes }, ctx) {
    const updates: Record<string, unknown> = { status, updated_at: ctx.deps.now().toISOString() };
    if (notes) updates.notes = notes;
    const sb = ctx.sb();
    const { error } = await sb.from('leads').update(updates).eq('id', lead_id);
    if (error) return err(error.message);
    await sb.from('lead_activity').insert({ lead_id, action: 'status_changed', new_value: status, performed_by: performedBy(ctx) });
    return { text: `Lead ${lead_id} status updated to: ${status}` };
  },
});

export const saveResponseDraft = tool({
  name: 'save_response_draft',
  description: 'Save a drafted response for a lead. Claude can draft this based on the lead context and Microns Hub offerings.',
  cls: 'W',
  stage: 'opt',
  idempotent: true,
  shape: {
    lead_id: z.string(),
    response_text: z.string(),
    platform: z.enum(['reddit', 'hackernews', 'twitter', 'linkedin', 'email', 'other']).optional(),
  },
  async run({ lead_id, response_text, platform }, ctx) {
    const updates: Record<string, unknown> = { suggested_response: response_text, updated_at: ctx.deps.now().toISOString() };
    if (platform) updates.response_platform = platform;
    const sb = ctx.sb();
    const { error } = await sb.from('leads').update(updates).eq('id', lead_id);
    if (error) return err(error.message);
    await sb.from('lead_activity').insert({ lead_id, action: 'response_drafted', new_value: platform || 'unspecified platform', performed_by: performedBy(ctx) });
    return { text: `Response draft saved for lead ${lead_id}.\n\nDraft:\n${response_text}` };
  },
});

export const addLeadNote = tool({
  name: 'add_lead_note',
  description: 'Add a note or observation to a lead.',
  cls: 'W',
  stage: 'opt',
  shape: { lead_id: z.string(), note: z.string() },
  async run({ lead_id, note }, ctx) {
    const sb = ctx.sb();
    const { data: existing } = await sb.from('leads').select('notes').eq('id', lead_id).single();
    const stamp = isoTime(ctx.deps.now().toISOString());
    const existingNotes = existing?.notes || '';
    const newNotes = existingNotes ? `${existingNotes}\n\n[${stamp}] ${note}` : `[${stamp}] ${note}`;
    const { error } = await sb.from('leads').update({ notes: newNotes, updated_at: ctx.deps.now().toISOString() }).eq('id', lead_id);
    if (error) return err(error.message);
    await sb.from('lead_activity').insert({ lead_id, action: 'note_added', new_value: note.slice(0, 200), performed_by: performedBy(ctx) });
    return { text: `Note added to lead ${lead_id}.` };
  },
});

export const getLeadStats = tool({
  name: 'get_lead_stats',
  description: 'Get summary statistics: total leads, by source, by score, by status, conversion rate, and trends.',
  cls: 'R',
  stage: 's1',
  shape: { days_back: z.number().optional().default(7) },
  async run({ days_back }, ctx) {
    const now = ctx.deps.now();
    const since = daysAgoIso(days_back, now);
    const today = now.toISOString().slice(0, 10);
    const sb = ctx.sb();
    const [periodData, totalCount] = await Promise.all([
      sb.from('leads').select('source, auto_score, manual_score, status, discovered_at').gte('discovered_at', since),
      sb.from('leads').select('id', { count: 'exact', head: true }),
    ]);
    const data = (periodData.data || []) as Array<Record<string, string>>;
    const bySource: Record<string, number> = {};
    const byScore: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const daily: Record<string, number> = {};
    for (const l of data) {
      bySource[l.source] = (bySource[l.source] || 0) + 1;
      const score = l.manual_score || l.auto_score;
      byScore[score] = (byScore[score] || 0) + 1;
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      const day = l.discovered_at?.slice(0, 10);
      if (day) daily[day] = (daily[day] || 0) + 1;
    }
    const converted = byStatus.converted || 0;
    const convRate = data.length > 0 ? Math.round((converted / data.length) * 100) : 0;
    const text = [
      `LEAD STATS - Last ${days_back} Days`,
      '',
      `Total (all time): ${totalCount.count || 0}`,
      `Period total: ${data.length}`,
      `Today: ${daily[today] || 0}`,
      '',
      'BY SOURCE:',
      ...Object.entries(bySource).map(([s, n]) => `  ${s}: ${n}`),
      '',
      'BY SCORE:',
      `  High: ${byScore.high || 0}`,
      `  Medium: ${byScore.medium || 0}`,
      `  Low: ${byScore.low || 0}`,
      `  Unscored: ${byScore.unscored || 0}`,
      '',
      'BY STATUS:',
      ...Object.entries(byStatus).map(([s, n]) => `  ${s}: ${n}`),
      '',
      `Conversion rate: ${convRate}% (${converted} converted)`,
      '',
      'DAILY VOLUME (last 7 days):',
      ...Object.entries(daily).sort().slice(-7).map(([d, n]) => `  ${d}: ${n} leads`),
    ].join('\n');
    return { text };
  },
});

export const searchLeads = tool({
  name: 'search_leads',
  description: 'Full-text search across lead titles and bodies.',
  cls: 'R',
  stage: 's1',
  shape: { query: z.string(), limit: z.number().optional().default(20) },
  async run({ query, limit }, ctx) {
    const { data, error } = await ctx.sb().from('leads').select('*').or(`title.ilike.%${query}%,body.ilike.%${query}%`).order('discovered_at', { ascending: false }).limit(limit);
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: `No leads found matching: "${query}"` };
    return { text: `Found ${data.length} leads matching "${query}":\n\n${data.map(formatLead).join('\n\n')}` };
  },
});

// ----- manage_keywords / manage_subreddits (list-only in stage 1, full opt-in) -----

const KEYWORD_EXTRA = {
  keyword: z.string().optional(),
  category: z.string().optional().describe('One of: sourcing_intent, competitor_mentions, competitor_complaints, material_specific, competition_teams, geographic_europe'),
  keyword_id: z.number().optional().describe('Keyword ID for remove/toggle actions'),
  is_active: z.boolean().optional().describe('For toggle action'),
};

async function manageKeywords(args: { action: string; keyword?: string; category?: string; keyword_id?: number; is_active?: boolean }, ctx: McpContext): Promise<ToolResult> {
  const { action, keyword, category, keyword_id, is_active } = args;
  const sb = ctx.sb();
  if (action === 'list') {
    const { data } = await sb.from('lead_keywords').select('*').order('category').order('weight', { ascending: false });
    if (!data || data.length === 0) return { text: 'No keywords configured.' };
    const byCategory: Record<string, Array<Record<string, unknown>>> = {};
    for (const kw of data) (byCategory[kw.category] ??= []).push(kw);
    const text = Object.entries(byCategory)
      .map(([cat, kws]) => `${cat.toUpperCase()}:\n${kws.map((k) => `  [${k.id}] ${k.is_active ? 'on ' : 'off'} "${k.keyword}" (w${k.weight}, matched ${k.match_count}x)`).join('\n')}`)
      .join('\n\n');
    return { text: `ACTIVE KEYWORDS:\n\n${text}` };
  }
  if (action === 'add') {
    if (!keyword || !category) return { text: 'keyword and category are required for add action' };
    const { data, error } = await sb.from('lead_keywords').insert({ keyword, category, weight: 2 }).select().single();
    if (error) return err(error.message);
    return { text: `Added keyword: "${keyword}" in category "${category}" (ID: ${data.id})` };
  }
  if (action === 'remove') {
    if (!keyword_id) return { text: 'keyword_id is required for remove action' };
    const { error } = await sb.from('lead_keywords').delete().eq('id', keyword_id);
    if (error) return err(error.message);
    return { text: `Keyword ${keyword_id} removed.` };
  }
  if (action === 'toggle') {
    if (!keyword_id || is_active === undefined) return { text: 'keyword_id and is_active are required for toggle action' };
    const { error } = await sb.from('lead_keywords').update({ is_active }).eq('id', keyword_id);
    if (error) return err(error.message);
    return { text: `Keyword ${keyword_id} ${is_active ? 'enabled' : 'disabled'}.` };
  }
  return { text: 'Unknown action' };
}

export const manageKeywordsList = tool({
  name: 'manage_keywords',
  description: 'Add, remove, or list monitored keywords for lead detection.',
  cls: 'R',
  stage: 's1',
  shape: { action: z.enum(['list']), ...KEYWORD_EXTRA },
  run: (args, ctx) => manageKeywords(args, ctx),
});

export const manageKeywordsFull = tool({
  name: 'manage_keywords',
  description: 'Add, remove, or list monitored keywords for lead detection.',
  cls: 'W',
  stage: 'opt',
  shape: { action: z.enum(['list', 'add', 'remove', 'toggle']), ...KEYWORD_EXTRA },
  run: (args, ctx) => manageKeywords(args, ctx),
});

const SUBREDDIT_EXTRA = {
  subreddit: z.string().optional(),
  tier: z.number().optional().describe('1-5, where 1 scans most frequently (every 15 min)'),
  subreddit_id: z.number().optional().describe('Subreddit ID for remove/toggle actions'),
  is_active: z.boolean().optional().describe('For toggle action'),
};

const TIER_LABEL: Record<number, string> = { 1: '15min', 2: '30min', 3: '30min', 4: '60min', 5: '2hr' };
const TIER_MINUTES: Record<number, number> = { 1: 15, 2: 30, 3: 30, 4: 60, 5: 120 };

async function manageSubreddits(args: { action: string; subreddit?: string; tier?: number; subreddit_id?: number; is_active?: boolean }, ctx: McpContext): Promise<ToolResult> {
  const { action, subreddit, tier, subreddit_id, is_active } = args;
  const sb = ctx.sb();
  if (action === 'list') {
    const { data } = await sb.from('monitored_subreddits').select('*').order('tier').order('subreddit');
    if (!data || data.length === 0) return { text: 'No subreddits configured.' };
    const byTier: Record<number, Array<Record<string, unknown>>> = {};
    for (const s of data) (byTier[s.tier] ??= []).push(s);
    const text = Object.entries(byTier)
      .map(([t, subs]) => `TIER ${t} (every ${TIER_LABEL[parseInt(t)] || '?'}):\n${subs.map((s) => `  [${s.id}] ${s.is_active ? 'on ' : 'off'} r/${s.subreddit} - last scan: ${isoTime(s.last_scanned_at, 'never')}`).join('\n')}`)
      .join('\n\n');
    return { text: `MONITORED SUBREDDITS:\n\n${text}` };
  }
  if (action === 'add') {
    if (!subreddit) return { text: 'subreddit is required' };
    const cleanName = subreddit.replace(/^r\//, '');
    const scanTier = tier || 3;
    const { data, error } = await sb.from('monitored_subreddits').insert({ subreddit: cleanName, tier: scanTier, scan_interval_minutes: TIER_MINUTES[scanTier] || 30 }).select().single();
    if (error) return err(error.message);
    return { text: `Added r/${cleanName} as Tier ${scanTier} (ID: ${data.id})` };
  }
  if (action === 'remove') {
    if (!subreddit_id) return { text: 'subreddit_id is required' };
    const { error } = await sb.from('monitored_subreddits').delete().eq('id', subreddit_id);
    if (error) return err(error.message);
    return { text: `Subreddit ${subreddit_id} removed.` };
  }
  if (action === 'toggle') {
    if (!subreddit_id || is_active === undefined) return { text: 'subreddit_id and is_active are required' };
    const { error } = await sb.from('monitored_subreddits').update({ is_active }).eq('id', subreddit_id);
    if (error) return err(error.message);
    return { text: `Subreddit ${subreddit_id} ${is_active ? 'enabled' : 'disabled'}.` };
  }
  return { text: 'Unknown action' };
}

export const manageSubredditsList = tool({
  name: 'manage_subreddits',
  description: 'Add, remove, or list monitored subreddits.',
  cls: 'R',
  stage: 's1',
  shape: { action: z.enum(['list']), ...SUBREDDIT_EXTRA },
  run: (args, ctx) => manageSubreddits(args, ctx),
});

export const manageSubredditsFull = tool({
  name: 'manage_subreddits',
  description: 'Add, remove, or list monitored subreddits.',
  cls: 'W',
  stage: 'opt',
  shape: { action: z.enum(['list', 'add', 'remove', 'toggle']), ...SUBREDDIT_EXTRA },
  run: (args, ctx) => manageSubreddits(args, ctx),
});

/** Today's start (UTC) as the local resources and prompts compute it. */
export function todayStart(now: Date): string {
  return `${isoDate(now.toISOString())}T00:00:00Z`;
}

export const LEAD_TOOLS: readonly ToolDef[] = [
  getLeads, getLeadDetail, scoreLead, updateLeadStatus, saveResponseDraft, addLeadNote, getLeadStats, searchLeads,
  manageKeywordsList, manageKeywordsFull, manageSubredditsList, manageSubredditsFull,
];
