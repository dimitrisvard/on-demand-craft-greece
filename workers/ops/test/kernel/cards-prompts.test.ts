// K-2 cards and prompts: Telegram rendering (labels and values HTML escaped, <= 4,096 chars after escaping with the
// title and the flags line always kept and no entity cut, callback buttons only for allowed verbs
// with a code, "Open" URL button, token null -> URL button only), maskEmail, failure and test cards; prompt
// selection with a flag pin; front matter; registration; LOCK.json hashes and the schema rules (N-7) for every
// prompt file present under src/agents/prompts/.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CALLBACK_DATA_RE } from '../../../shared/src/agent-api';
import { clampCard, decidedCard, maskEmail, renderTelegram, type CardV1 } from '../../src/agents/cards/index';
import { failureCard } from '../../src/agents/cards/failure';
import { testCard } from '../../src/agents/cards/test';
import {
  PROMPTS,
  frontMatterProblems,
  loadPrompt,
  parseFrontMatter,
  registerPromptSource,
  schemaRuleProblems,
  selectPrompt,
  type PromptId,
} from '../../src/agents/prompts/registry';

const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWX27';
const PROMPT_DIR = fileURLToPath(new URL('../../src/agents/prompts/', import.meta.url));

const card = (over: Partial<CardV1> = {}): CardV1 => ({
  v: 1,
  kind: 'quote',
  run_id: 'run-1',
  title: 'RFQ-20261005-1 · Example GmbH (DE)',
  lines: [{ label: 'Total', value: 'EUR 1,234.00' }],
  flags: [],
  allowed_verbs: ['approve', 'reject'],
  open_url: 'https://www.micronshub.eu/dashboard/approvals?run=run-1',
  ...over,
});

describe('renderTelegram', () => {
  it('one row of callback buttons for allowed verbs with a code, plus the Open button', () => {
    const m = renderTelegram(card(), TOKEN);
    expect(m.reply_markup.inline_keyboard).toEqual([
      [
        { text: 'Approve and send', callback_data: `ap:${TOKEN}:ok` },
        { text: 'Reject', callback_data: `ap:${TOKEN}:rej` },
      ],
      [{ text: 'Open', url: 'https://www.micronshub.eu/dashboard/approvals?run=run-1' }],
    ]);
    for (const b of m.reply_markup.inline_keyboard[0] as Array<{ callback_data: string }>) expect(b.callback_data).toMatch(CALLBACK_DATA_RE);
  });

  it('token null -> the Open button only; dashboard-only and foreign verbs never get a button', () => {
    expect(renderTelegram(card(), null).reply_markup.inline_keyboard).toEqual([[{ text: 'Open', url: card().open_url }]]);
    const handoff = renderTelegram(card({ kind: 'handoff', allowed_verbs: ['send_partner', 'change_partner', 'approve'] }), TOKEN);
    expect(handoff.reply_markup.inline_keyboard[0]).toEqual([{ text: 'Send to partner', callback_data: `ap:${TOKEN}:sp` }]);
  });

  it('every value is HTML-escaped, control characters removed, and the limits applied', () => {
    const m = renderTelegram(card({ title: '<b>x</b> & "y"', lines: [{ label: 'Note', value: 'a<script>\nb' }], flags: ['dmarc_fail', 'injection_suspected'] }), null);
    expect(m.text).toBe('<b>&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</b>\nNote: a&lt;script&gt; b\n<i>Check: sender authentication failed, instructions found in the e-mail</i>');
    const big = renderTelegram(card({ title: 't'.repeat(500), lines: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: '<'.repeat(400) })) }), null);
    expect(big.text.length).toBeLessThanOrEqual(4096);
    const clamped = clampCard(card({ title: 't'.repeat(500), lines: Array.from({ length: 30 }, () => ({ label: 'L', value: 'v'.repeat(400) })) }));
    expect(clamped.title).toHaveLength(120);
    expect(clamped.lines).toHaveLength(12);
    expect(clamped.lines[0].value).toHaveLength(200);
  });

  it('labels are HTML-escaped like values', () => {
    const m = renderTelegram(card({ lines: [{ label: 'Qty <b>&', value: '2' }] }), null);
    expect(m.text).toBe('<b>RFQ-20261005-1 \u00b7 Example GmbH (DE)</b>\nQty &lt;b&gt;&amp;: 2');
  });

  it('a card at its limits whose text grows by escaping stays within 4,096 characters, cuts no entity and keeps the title and the flags line', () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: (i % 2 ? '"' : '&').repeat(200) }));
    for (const flags of [['injection_suspected'], ['dmarc_fail', 'injection_suspected', 'low_confidence', 'flag_off', 'manual_lines']] as CardV1['flags'][]) {
      const m = renderTelegram(card({ title: '<'.repeat(120), lines, flags }), null);
      expect(m.text.length).toBeLessThanOrEqual(4096);
      expect(m.text.startsWith(`<b>${'&lt;'.repeat(120)}</b>\n`)).toBe(true);
      expect(m.text).toMatch(/\n<i>Check: [^<]*instructions found in the e-mail[^<]*<\/i>$/);
      // Every '&' starts a complete entity and the markup is exactly <b>…</b> and <i>…</i>.
      expect(m.text.replace(/&(amp|lt|gt|quot);/g, '')).not.toMatch(/&/);
      expect(m.text.match(/<[^>]*>/g)).toEqual(['<b>', '</b>', '<i>', '</i>']);
      // Lines are kept in order while they fit; the first that does not fit is shortened with an ellipsis.
      const body = m.text.split('\n').slice(1, -1);
      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThan(12);
      body.forEach((l, i) => expect(l.startsWith(`L${i}: `)).toBe(true));
      expect(body.at(-1)?.endsWith('\u2026')).toBe(true);
    }
  });

  it('a card that fits is rendered in full', () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ label: `Line ${i}`, value: 'v'.repeat(200) }));
    const m = renderTelegram(card({ lines, flags: ['low_confidence'] }), null);
    expect(m.text.split('\n')).toHaveLength(14);
    expect(m.text).not.toContain('\u2026');
  });

  it('decidedCard adds the decision line and removes the verbs', () => {
    const d = decidedCard(card(), { label: 'Approved', actor: 'telegram:42', at: new Date('2026-10-05T09:30:00Z') });
    expect(d.allowed_verbs).toEqual([]);
    expect(d.lines.at(-1)).toEqual({ label: 'Decision', value: 'Approved by telegram:42 at 2026-10-05 09:30 UTC' });
  });

  it('maskEmail keeps the first character and the domain only', () => {
    expect(maskEmail('hans.mueller@Example.DE')).toBe('h***@example.de');
    expect(maskEmail('x@example.com')).toBe('x***@example.com');
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
  });

  it('failure and test cards', () => {
    const f = failureCard({ run_id: 'r9', agent: 'quote', failed_step: 'price', error: 'schema', restartable: true, site_origin: 'https://www.micronshub.eu/' });
    expect(f).toMatchObject({ kind: 'failure', allowed_verbs: ['retry', 'dismiss'], open_url: 'https://www.micronshub.eu/dashboard/approvals?run=r9' });
    expect(failureCard({ run_id: 'r9', agent: 'quote', failed_step: null, error: 'x', restartable: true, site_origin: 'https://x' }).allowed_verbs).toEqual(['dismiss']);
    expect(testCard({ run_id: 't1', site_origin: 'https://www.micronshub.eu' })).toMatchObject({ kind: 'test', allowed_verbs: ['dismiss'] });
  });
});

describe('prompt registry', () => {
  it('selection: highest registered version unless the flag pins one', () => {
    expect(selectPrompt('rfq_intake.extract', { enabled: true, mode: 'shadow', value: {} })).toBe('rfq_intake.extract@v1');
    expect(selectPrompt('rfq_intake.extract', { enabled: true, mode: 'shadow', value: { prompts: { extract: 'v1' } } })).toBe('rfq_intake.extract@v1');
    expect(selectPrompt('rfq_intake.extract', { enabled: true, mode: 'shadow', value: { prompts: { extract: 'v9' } } })).toBe('rfq_intake.extract@v1');
    expect(() => selectPrompt('nope.step', { enabled: true, mode: 'shadow', value: {} })).toThrow(/no prompt/);
  });

  it('front matter is parsed and must equal the registry entry', () => {
    const { meta, body } = parseFrontMatter('---\nroute: extract\nmax_tokens: 4096\neffort: low\n---\nSystem text.\n');
    expect(meta).toEqual({ route: 'extract', max_tokens: 4096, effort: 'low' });
    expect(body).toBe('System text.');
    expect(frontMatterProblems('rfq_intake.extract@v1', meta)).toEqual([]);
    expect(frontMatterProblems('rfq_intake.triage@v1', { route: 'classify', max_tokens: 256, effort: 'none' })).toEqual([]);
    expect(frontMatterProblems('rfq_intake.triage@v1', { route: 'extract', max_tokens: 256 })).toEqual(['rfq_intake.triage@v1: route extract != classify']);
  });

  it('loadPrompt serves registered files only and refuses an inconsistent one', async () => {
    const schema = { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false };
    await expect(loadPrompt('post_order.reorder_draft@v1')).rejects.toThrow(/not registered/);
    registerPromptSource('post_order.reorder_draft@v1', '---\nroute: extract\nmax_tokens: 1024\neffort: low\n---\nDraft a reorder.', schema);
    expect(await loadPrompt('post_order.reorder_draft@v1')).toMatchObject({ id: 'post_order.reorder_draft@v1', system: 'Draft a reorder.', schema });
    registerPromptSource('post_order.reorder_draft@v1', '---\nroute: extract\nmax_tokens: 99\neffort: low\n---\nx', schema);
    await expect(loadPrompt('post_order.reorder_draft@v1')).rejects.toThrow(/max_tokens 99/);
    expect(() => registerPromptSource('nope.x@v1' as PromptId, 'x', schema)).toThrow(/not in PROMPTS/);
  });

  it('schema rules: additionalProperties false and every property required on every object; no numeric or length constraints', () => {
    expect(schemaRuleProblems({ type: 'object', properties: { a: { type: ['string', 'null'] } }, required: ['a'], additionalProperties: false })).toEqual([]);
    expect(schemaRuleProblems({ type: 'object', properties: { a: { type: 'string', maxLength: 3 }, b: { type: 'object', properties: {}, required: [] } }, required: ['a'] })).toEqual([
      '$: additionalProperties must be false',
      '$.b: not in required',
      '$.a: maxLength is not allowed',
      '$.b: additionalProperties must be false',
    ]);
    expect(schemaRuleProblems({ type: 'array', items: { type: 'number', minimum: 0 } })).toEqual(['$[]: minimum is not allowed']);
  });
});

/** Prompt folders present now (each unit adds its own); the rules hold for every file found. */
function promptFolders(): string[] {
  if (!existsSync(PROMPT_DIR)) return [];
  return readdirSync(PROMPT_DIR).filter((d) => statSync(PROMPT_DIR + d).isDirectory());
}

describe('prompt files present under src/agents/prompts/', () => {
  const folders = promptFolders();

  it('every agent folder has a LOCK.json whose SHA-256 values match every released file, both ways', () => {
    for (const folder of folders) {
      const dir = `${PROMPT_DIR}${folder}/`;
      const files = readdirSync(dir).filter((f) => /\.v\d+\.(md|schema\.json)$/.test(f)).sort();
      if (files.length === 0) continue;
      expect(existsSync(`${dir}LOCK.json`), `${folder}/LOCK.json`).toBe(true);
      const lock = JSON.parse(readFileSync(`${dir}LOCK.json`, 'utf8')) as Record<string, string>;
      expect(Object.keys(lock).sort(), `${folder}/LOCK.json lists exactly the released files`).toEqual(files);
      for (const f of files) expect(lock[f], `${folder}/${f}`).toBe(createHash('sha256').update(readFileSync(dir + f)).digest('hex'));
    }
  });

  it('every prompt file is registered, its front matter matches, and its schema follows the rules', () => {
    for (const folder of folders) {
      const dir = `${PROMPT_DIR}${folder}/`;
      for (const f of readdirSync(dir).filter((x) => /\.v\d+\.md$/.test(x))) {
        const [step, version] = f.replace(/\.md$/, '').split('.');
        const id = `${folder}.${step}@${version}` as PromptId;
        expect(PROMPTS[id], `${id} in PROMPTS`).toBeDefined();
        expect(frontMatterProblems(id, parseFrontMatter(readFileSync(dir + f, 'utf8')).meta), id).toEqual([]);
        const schemaFile = `${dir}${step}.${version}.schema.json`;
        expect(existsSync(schemaFile), `${id} schema file`).toBe(true);
        expect(schemaRuleProblems(JSON.parse(readFileSync(schemaFile, 'utf8'))), id).toEqual([]);
      }
    }
  });

  it('every registry entry points into its agent folder with matching file names', () => {
    for (const [id, entry] of Object.entries(PROMPTS)) {
      const [agentStep, version] = id.split('@');
      const [agent, step] = agentStep.split('.');
      expect(entry.file).toBe(`${agent}/${step}.${version}.md`);
      expect(entry.schema).toBe(`${agent}/${step}.${version}.schema.json`);
      expect(entry.route === 'classify' ? entry.effort : 'n/a').toBe(entry.route === 'classify' ? null : 'n/a');
    }
  });
});
