// O5: the digest e-mail and the Telegram line: section order, escaping of every value (model output included), the
// fallback when the summary is missing, stuck links, the narrative input (figures only) and the line format.

import { describe, expect, it } from 'vitest';
import { collectMetrics, reportWindow, type DigestMetrics } from '../../../src/digest/collect';
import { DIGEST_SECTIONS, escapeHtml, figureRows, narrativeInput, narrativeLines, renderDigest, telegramLine } from '../../../src/digest/render';
import { collectStuck, type StuckReport } from '../../../src/digest/stuck';
import { digestHarness, VECTORS } from './helpers';

async function figures(): Promise<{ m: DigestMetrics; s: StuckReport }> {
  const h = digestHarness();
  const w = reportWindow(VECTORS.iso_week)!;
  return { m: await collectMetrics(h.db, w), s: await collectStuck(h.db, w, new Date(VECTORS.now)) };
}

const SITE = 'https://www.micronshub.eu';

describe('renderDigest', () => {
  it('subject, sections in order, every figure row in the text part', async () => {
    const { m, s } = await figures();
    const r = renderDigest({ metrics: m, stuck: s, narrative: { ok: true, lines: ['Line one.', 'Line two.', 'Line three.', 'Line four.', 'Line five.'] }, siteOrigin: SITE });
    expect(r.subject).toBe('MicronsHub ops digest 2026-W41 (2026-10-05 to 2026-10-11)');
    const titles = ['Summary', 'Pipeline', 'Quotes', 'Orders and margin', 'Agents and cost', 'Content and lag', 'Collectors', 'Marketing', 'Stuck items'];
    let at = -1;
    for (const t of titles) {
      const i = r.text.indexOf(`\n${t}\n`);
      expect(i, t).toBeGreaterThan(at);
      at = i;
      expect(r.html).toContain(`<h3>${t}</h3>`);
    }
    expect(DIGEST_SECTIONS).toHaveLength(titles.length);
    for (const row of figureRows(m, s)) expect(r.text).toContain(`  ${row.figure}: ${row.value}`);
    expect(r.text).toContain('- Line five.');
  });

  it('escapes model output and every value written into HTML', async () => {
    const { m, s } = await figures();
    const evil = '<img src=x onerror="alert(1)"> & <script>';
    const r = renderDigest({ metrics: { ...m, agents: { ...m.agents, by_agent: [{ agent: '<b>x</b>', runs: 1, failed: 0, skipped: 0, usd: '0.00' }] } }, stuck: s, narrative: { ok: true, lines: [evil] }, siteOrigin: SITE });
    expect(r.html).not.toContain('<img');
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>x</b>');
    expect(r.html).toContain(escapeHtml(evil));
    expect(escapeHtml(`a"b'c`)).toBe('a&quot;b&#39;c');
  });

  it('a missing summary is stated; the figures are complete anyway', async () => {
    const { m, s } = await figures();
    const r = renderDigest({ metrics: m, stuck: s, narrative: { ok: false, lines: [], code: 'llm_unavailable' }, siteOrigin: SITE });
    expect(r.text).toContain('Summary unavailable this week (llm_unavailable); the figures below are complete.');
    expect(r.html).toContain('Summary unavailable this week (llm_unavailable)');
  });

  it('stuck items link to the approvals page; no address, name or message text', async () => {
    const { m, s } = await figures();
    const r = renderDigest({ metrics: m, stuck: s, narrative: { ok: true, lines: ['x'] }, siteOrigin: `${SITE}/` });
    expect(r.html).toContain(`href="${SITE}/dashboard/approvals?run=d4000000-0000-4000-8000-000000000009"`);
    expect(r.html).toContain(`href="${SITE}/dashboard/approvals?run=d4000000-0000-4000-8000-000000000007"`);
    expect(r.text).toContain('quote b2000000 awaiting approval since 2026-10-11 23:59 UTC');
    for (const text of [r.text, r.html]) {
      expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(text).not.toContain('Vector One');
    }
  });
});

describe('narrative input and output', () => {
  it('the input holds figures only (no ids, names or addresses)', async () => {
    const { m, s } = await figures();
    const json = JSON.stringify(narrativeInput(m, s));
    expect(json).not.toMatch(/[0-9a-f]{8}-0000-4000-8000-/);
    expect(json).not.toContain('@');
    expect(json).not.toContain('Vector');
    expect(JSON.parse(json)).toMatchObject({ week: '2026-W41', pipeline: { rfqs: 3 }, stuck: { runs_older_than_48h: 2, quotes_awaiting_approval: 1, cad_jobs_failed: 2 } });
  });

  it('keeps at most five non-empty lines of at most 300 characters', () => {
    expect(narrativeLines({ lines: ['a', ' ', 'b\n c', 'd', 'e', 'f', 'g'] })).toEqual(['a', 'b c', 'd', 'e', 'f']);
    expect(narrativeLines({ lines: ['x'.repeat(400)] })?.[0]).toHaveLength(300);
    expect(narrativeLines({ lines: [] })).toBeNull();
    expect(narrativeLines({ lines: [1, 2] })).toBeNull();
    expect(narrativeLines({})).toBeNull();
    expect(narrativeLines(null)).toBeNull();
  });
});

describe('telegramLine', () => {
  it('names the reported week, RFQs, quotes and win rate', async () => {
    const { m } = await figures();
    expect(telegramLine(m)).toBe('Digest W41 sent: 3 RFQs, 4 quotes, win rate 33.3 %');
    expect(telegramLine({ ...m, quotes: { ...m.quotes, win_rate_pct: null } })).toBe('Digest W41 sent: 3 RFQs, 4 quotes, win rate n/a %');
  });
});
