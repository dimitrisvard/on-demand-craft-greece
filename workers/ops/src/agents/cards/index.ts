// Approval and notice cards (Phase 4): the business summary a human sees on Telegram and on the dashboard.
//
// Rules
//   - A card carries business fields only: RFQ/PO number, company, country, language, masked sender, parts count,
//     file kinds, totals, confidence, flags and the dashboard link. Never an e-mail body, a full e-mail address, a
//     model's free text or a token.
//   - title <= 120 characters, at most 12 lines, each value <= 200 characters; allowed_verbs is a subset of the keys
//     of VERB_CODES[kind].
//   - The Telegram rendering uses HTML parse mode with every value escaped, stays within 4,096 characters and has
//     one row of callback buttons ('ap:<token>:<code>' for every allowed verb with a code) plus an "Open" URL button.
//     Without a token (decided card, replaced reminder, relay not configured) it has the URL button only.
// Card builders per kind live beside this file (failure.ts, test.ts here; intake.ts, quote.ts, reply.ts,
// handoff.ts, reorder.ts in the units that own those flows).

import { VERB_CODES, VERB_LABELS, callbackData, type CardKind } from '../../../../shared/src/agent-api';

export type CardFlag = 'dmarc_fail' | 'injection_suspected' | 'low_confidence' | 'flag_off' | 'manual_lines';

export interface CardV1 {
  v: 1;
  kind: CardKind;
  run_id: string;
  /** At most 120 characters, e.g. 'RFQ-20261004-1 · Example GmbH (DE)'. */
  title: string;
  /** Business fields only; at most 12 lines, values at most 200 characters. */
  lines: Array<{ label: string; value: string }>;
  flags: CardFlag[];
  /** Subset of the keys of VERB_CODES[kind]. */
  allowed_verbs: string[];
  /** `${SITE_ORIGIN}/dashboard/approvals?run=<run_id>` (intake: /dashboard/rfq-inbox?email=<id>). */
  open_url: string;
}

export const CARD_TITLE_MAX = 120;
export const CARD_LINES_MAX = 12;
export const CARD_VALUE_MAX = 200;
export const TELEGRAM_TEXT_MAX = 4096;

export interface TelegramCardMessage {
  text: string;
  reply_markup: { inline_keyboard: unknown[][] };
}

/** Escapes text for Telegram's HTML parse mode (&, <, > and quotes). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function clip(text: string, max: number): string {
  const value = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
  return value.length <= max ? value : `${value.slice(0, max - 1)}\u2026`;
}

/** Pure: the card within its limits (title, lines, value lengths; verbs limited to the kind's verbs). */
export function clampCard(c: CardV1): CardV1 {
  const verbs = VERB_CODES[c.kind] ?? {};
  return {
    ...c,
    title: clip(c.title, CARD_TITLE_MAX),
    lines: c.lines.slice(0, CARD_LINES_MAX).map((l) => ({ label: clip(l.label, 60), value: clip(l.value, CARD_VALUE_MAX) })),
    flags: [...new Set(c.flags)],
    allowed_verbs: c.allowed_verbs.filter((v, i, all) => Object.prototype.hasOwnProperty.call(verbs, v) && all.indexOf(v) === i),
  };
}

const FLAG_TEXT: Record<CardFlag, string> = {
  dmarc_fail: 'sender authentication failed',
  injection_suspected: 'instructions found in the e-mail',
  low_confidence: 'low confidence',
  flag_off: 'agent switched off',
  manual_lines: 'manual price lines',
};

/** HTML-mode Telegram message for a card; token null renders the URL button only. */
export function renderTelegram(c: CardV1, token: string | null): TelegramCardMessage {
  const card = clampCard(c);
  const parts = [`<b>${escapeHtml(card.title)}</b>`];
  for (const line of card.lines) parts.push(`${escapeHtml(line.label)}: ${escapeHtml(line.value)}`);
  if (card.flags.length) parts.push(`<i>Check: ${escapeHtml(card.flags.map((f) => FLAG_TEXT[f] ?? f).join(', '))}</i>`);
  let text = parts.join('\n');
  if (text.length > TELEGRAM_TEXT_MAX) text = text.slice(0, TELEGRAM_TEXT_MAX);
  const keyboard: unknown[][] = [];
  if (token !== null) {
    const row = card.allowed_verbs
      .map((verb) => ({ verb, code: VERB_CODES[card.kind]?.[verb] ?? null }))
      .filter((b): b is { verb: string; code: string } => b.code !== null)
      .map((b) => ({ text: VERB_LABELS[b.verb] ?? b.verb, callback_data: callbackData(token, b.code) }));
    if (row.length) keyboard.push(row);
  }
  keyboard.push([{ text: 'Open', url: card.open_url }]);
  return { text, reply_markup: { inline_keyboard: keyboard } };
}

/** The card after a decision: the decision line added, no verbs (renders with the "Open" button only). */
export function decidedCard(c: CardV1, decision: { label: string; actor: string; at: Date }): CardV1 {
  const at = decision.at.toISOString().slice(0, 16).replace('T', ' ');
  const lines = c.lines.slice(0, CARD_LINES_MAX - 1);
  lines.push({ label: 'Decision', value: `${decision.label} by ${decision.actor} at ${at} UTC` });
  return { ...c, lines, allowed_verbs: [] };
}

/** Dashboard link of a card: approvals page by run, the inbox page by inbound e-mail for intake cards. */
export function cardOpenUrl(siteOrigin: string, runId: string, inboundEmailId?: string): string {
  const origin = siteOrigin.replace(/\/+$/, '');
  return inboundEmailId
    ? `${origin}/dashboard/rfq-inbox?email=${encodeURIComponent(inboundEmailId)}`
    : `${origin}/dashboard/approvals?run=${encodeURIComponent(runId)}`;
}

/** 'h***@example.de': first character of the local part, then '***', then the domain. */
export function maskEmail(addr: string): string {
  const value = String(addr ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return '***';
  return `${value[0]}***@${value.slice(at + 1).toLowerCase()}`;
}
