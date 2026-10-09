// Phase 5 contracts fixed in Wave 0 (unit K5): the 11 Phase 5 agent keys of AgentKey (type and table check), the
// Phase 5 envelope check on the queue "scrapes", the schedule table of PHASE5_SPEC §5.2 and the prompt registry entry
// of the ops digest narrative.

import { describe, expect, it } from 'vitest';
import { FLAG_OFF, type AgentFlag } from '../../../src/agents/flags';
import { PROMPTS } from '../../../src/agents/prompts/registry';
import type { AgentKey } from '../../../src/agents/runs';
import { CATCH_UP_MIN, SCHEDULE, sitemapOnly, type JobId } from '../../../src/cron/schedule';
import { isP5ScrapeMessage, P5_SCRAPE_KINDS, type P5ScrapeMessage } from '../../../src/queues/messages';

// Compile-time: the union accepts every Phase 5 key and still refuses an unknown one (npm run typecheck).
const PHASE5_AGENT_KEYS = [
  'content_daily',
  'content_daily.translate',
  'content_daily.sitemap',
  'growth.reddit',
  'growth.hn',
  'growth.tenders',
  'growth.xometry',
  'marketing.send',
  'marketing.followups',
  'marketing.warmup',
  'ops_digest',
] as const satisfies readonly AgentKey[];
// @ts-expect-error an agent key outside the union
const UNKNOWN_KEY: AgentKey = 'content_daily.unknown';
void UNKNOWN_KEY;
const PHASE4_KEYS_STILL_ACCEPTED: AgentKey[] = ['rfq_intake', 'quote', 'post_order', 'post_order.stock', 'quote.reply_poller', 'cad', 'eval', 'mcp', 'flags', 'growth.scrapers'];
void PHASE4_KEYS_STILL_ACCEPTED;

/** agent_runs.agent CHECK of the agent-layer migration. */
const AGENT_KEY_CHECK = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

describe('AgentKey', () => {
  it('holds the 11 distinct Phase 5 keys, each allowed by the agent_runs.agent CHECK', () => {
    expect(PHASE5_AGENT_KEYS).toHaveLength(11);
    expect(new Set(PHASE5_AGENT_KEYS).size).toBe(11);
    for (const key of PHASE5_AGENT_KEYS) expect(key).toMatch(AGENT_KEY_CHECK);
  });
});

describe('P5ScrapeMessage', () => {
  const message: P5ScrapeMessage = {
    v: 1,
    kind: 'hn-scan',
    params: { slot: '2026-10-08T07:00Z' },
    run_id: '5e0c3f4a-1b2c-4d3e-8f9a-0b1c2d3e4f5a',
    enqueued_at: '2026-10-08T07:00:00.000Z',
    requested_by: 'schedule',
  };

  it('kinds are exactly reddit-tier, hn-scan, tender-scheduled, xometry-scan', () => {
    expect([...P5_SCRAPE_KINDS]).toEqual(['reddit-tier', 'hn-scan', 'tender-scheduled', 'xometry-scan']);
  });

  it('isP5ScrapeMessage accepts v 1 with a Phase 5 kind only', () => {
    for (const kind of P5_SCRAPE_KINDS) expect(isP5ScrapeMessage({ ...message, kind })).toBe(true);
    for (const kind of ['tender-scan', 'funded-scan', 'directory-scan', 'HN-SCAN', '']) expect(isP5ScrapeMessage({ ...message, kind })).toBe(false);
    expect(isP5ScrapeMessage({ ...message, v: 2 })).toBe(false);
    expect(isP5ScrapeMessage({ ...message, v: '1' })).toBe(false);
    for (const body of [null, undefined, 'hn-scan', 1, [], [message]]) expect(isP5ScrapeMessage(body)).toBe(false);
  });
});

describe('schedule table (PHASE5_SPEC §5.2)', () => {
  const byJob = new Map(SCHEDULE.map((e) => [e.job, e]));
  const flag = (value: Record<string, unknown>): AgentFlag => ({ enabled: true, mode: 'assist', value });

  it('one entry per job with the expression, gate and action of the spec table', () => {
    const expected: Array<[JobId, string, string, string]> = [
      ['reddit-t1', '*/15 * * * *', 'agent.growth.reddit', 'scrape'],
      ['reddit-t2', '*/30 * * * *', 'agent.growth.reddit', 'scrape'],
      ['reddit-t3', '0 * * * *', 'agent.growth.reddit', 'scrape'],
      ['hn', '*/30 * * * *', 'agent.growth.hn', 'scrape'],
      ['tenders', '0 6 * * *', 'agent.growth.tenders', 'scrape'],
      ['xometry', '0 6,8,10,12,14,16,18 * * *', 'agent.growth.xometry', 'scrape'],
      ['content-daily', '0 7 * * *', 'agent.content_daily', 'workflow'],
      ['sitemap', '0 9 * * *', 'agent.content_daily', 'workflow'],
      ['ops-digest', '30 6 * * 1', 'agent.ops_digest', 'workflow'],
      ['marketing-followups', '5 * * * *', 'MARKETING_FOLLOWUPS_ENABLED', 'inline'],
      ['marketing-warmup', '5 0 * * *', 'MARKETING_WARMUP_ENABLED', 'inline'],
    ];
    expect(SCHEDULE.map((e) => e.job)).toEqual(expected.map(([job]) => job));
    for (const [job, cron, gate, action] of expected) {
      const entry = byJob.get(job);
      expect(entry?.cron, job).toBe(cron);
      expect(entry?.action, job).toBe(action);
      expect(entry && ('flag' in entry.gate ? entry.gate.flag : entry.gate.varName), job).toBe(gate);
    }
    expect(CATCH_UP_MIN).toBe(60);
  });

  it('content-daily and sitemap are exclusive: sitemap only when value.steps is exactly ["sitemap"]', () => {
    const contentWhen = (f: AgentFlag) => {
      const g = byJob.get('content-daily')?.gate;
      return g && 'flag' in g && g.when ? g.when(f) : true;
    };
    const sitemapWhen = (f: AgentFlag) => {
      const g = byJob.get('sitemap')?.gate;
      return g && 'flag' in g && g.when ? g.when(f) : true;
    };
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{ steps: ['sitemap'] }, true],
      [{ steps: ['generate', 'translate', 'fix_links', 'sitemap'] }, false],
      [{ steps: ['sitemap', 'sitemap'] }, false],
      [{ steps: [] }, false],
      [{ steps: 'sitemap' }, false],
      [{}, false],
    ];
    for (const [value, only] of cases) {
      expect(sitemapOnly(flag(value)), JSON.stringify(value)).toBe(only);
      expect(sitemapWhen(flag(value)), JSON.stringify(value)).toBe(only);
      expect(contentWhen(flag(value)), JSON.stringify(value)).toBe(!only);
    }
    expect(sitemapOnly(FLAG_OFF)).toBe(false);
  });

  it('every other flag-gated entry has no extra condition', () => {
    for (const entry of SCHEDULE) {
      if (entry.job === 'content-daily' || entry.job === 'sitemap' || !('flag' in entry.gate)) continue;
      expect(entry.gate.when, entry.job).toBeUndefined();
    }
  });
});

describe('prompt registry', () => {
  it('registers ops_digest.narrative@v1 (route extract, 800 tokens, effort low) in the Phase 4 convention', () => {
    expect(PROMPTS['ops_digest.narrative@v1']).toEqual({
      file: 'ops_digest/narrative.v1.md',
      schema: 'ops_digest/narrative.v1.schema.json',
      route: 'extract',
      max_tokens: 800,
      effort: 'low',
    });
  });

  it('registers no content prompt (they live in src/content/prompts/ with their own lock)', () => {
    expect(Object.keys(PROMPTS).filter((id) => id.startsWith('content_daily.'))).toEqual([]);
  });
});
