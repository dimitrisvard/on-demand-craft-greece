// Cards of reply attribution and the Gmail poller: the "Which RFQ?" card (kind 'reply_pick': attach to one of at
// most three waiting quotes, start a new RFQ, or ignore), its confirmation variant for a reply matched to one RFQ
// whose sender check asks for a human, and the notices without buttons (reply attached by its subject's RFQ number,
// a Gmail connection that needs reconnecting or where reconnecting is recommended, a Gmail message not imported).
//
// Rules
//   - Business fields only: RFQ numbers, quote versions and send dates, company names, the number of attachments,
//     the masked sender (maskEmail) or masked account. Never an e-mail text, a subject, a full address or a token.
//   - attach_<n> refers to candidate n of the card (the order is stored in the run's output.candidates).
//   - Every reply card shows the sender check: flag dmarc_fail unless the sender is authenticated.
//   - "Open" goes to the approvals page of the run.

import { cardOpenUrl, type CardV1 } from './index';

export interface ReplyCandidateSummary {
  rfq_number: string | null;
  company: string | null;
  version: number | null;
  /** ISO timestamp of the quote mail, or null. */
  sent_at: string | null;
}

export interface ReplyPickCardInput {
  run_id: string;
  site_origin: string;
  /** maskEmail() of the sender. */
  sender_masked: string | null;
  /** 1 to 3 candidates, in the order of attach_1 … attach_3. */
  candidates: readonly ReplyCandidateSummary[];
  attachments: number;
  /** False for a Gmail copy: 'new_rfq' is offered only for mail that reached the replies mailbox. */
  allow_new_rfq?: boolean;
  reminder?: boolean;
  /** Sender check of the reply (inbound/senderCheck); absent counts as not authenticated. */
  sender?: { authenticated: boolean; same_domain: boolean | null };
  /** Set for a reply matched to one RFQ by rule 1-3 that waits for a confirmation (one candidate). */
  confirm_rule?: 1 | 2 | 3;
}

/** Verbs of a reply_pick card with n candidates. */
export function replyPickVerbs(n: number, allowNewRfq = true): string[] {
  const verbs: string[] = [];
  for (let i = 1; i <= Math.min(Math.max(n, 0), 3); i++) verbs.push(`attach_${i}`);
  if (allowNewRfq) verbs.push('new_rfq');
  verbs.push('ignore');
  return verbs;
}

function candidateText(c: ReplyCandidateSummary): string {
  const parts = [c.rfq_number ?? 'RFQ without number'];
  if (c.version && c.version > 1) parts[0] += ` v${c.version}`;
  if (c.company?.trim()) parts.push(c.company.trim());
  if (c.sent_at) parts.push(`sent ${c.sent_at.slice(0, 10)}`);
  return parts.join(' · ');
}

function senderCheckText(s: ReplyPickCardInput['sender']): string {
  if (!s?.authenticated) return 'not authenticated';
  return s.same_domain === false ? 'authenticated, domain differs from the RFQ contact' : 'authenticated';
}

const MATCHED_BY: Readonly<Record<1 | 2 | 3, string>> = { 1: 'reply to our quote e-mail', 2: 'thread of the RFQ', 3: 'RFQ number in the subject' };

/** "Which RFQ?" card of a reply whose sender is the contact of waiting quotes, or (confirm_rule set) the
 *  confirmation card of a reply matched to one RFQ. */
export function replyPickCard(i: ReplyPickCardInput): CardV1 {
  const candidates = i.candidates.slice(0, 3);
  const lines: CardV1['lines'] = [
    { label: 'Sender', value: i.sender_masked ?? 'unknown' },
    { label: 'Sender check', value: senderCheckText(i.sender) },
  ];
  if (i.confirm_rule) lines.push({ label: 'Matched by', value: MATCHED_BY[i.confirm_rule] });
  candidates.forEach((c, n) => lines.push({ label: i.confirm_rule ? 'RFQ' : `Candidate ${n + 1}`, value: candidateText(c) }));
  lines.push({ label: 'Attachments', value: String(i.attachments) });
  const flags: CardV1['flags'] = [];
  if (!i.sender?.authenticated) flags.push('dmarc_fail');
  if (!i.confirm_rule || i.sender?.same_domain === false) flags.push('low_confidence');
  const sender = i.sender_masked ?? 'unknown sender';
  const title = i.confirm_rule ? `Confirm reply · ${candidates[0]?.rfq_number ?? 'RFQ'} · from ${sender}` : `Which RFQ? · reply from ${sender}`;
  return {
    v: 1,
    kind: 'reply_pick',
    run_id: i.run_id,
    title: `${i.reminder ? 'Reminder: ' : ''}${title}`,
    lines,
    flags,
    allowed_verbs: replyPickVerbs(candidates.length, i.allow_new_rfq !== false),
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

/** Notice: a reply was attached to an RFQ because its subject names the RFQ number (rule 3). */
export function replyAttachedCard(i: { run_id: string; site_origin: string; rfq_number: string | null; sender_masked: string | null; attachments: number; quote_waiting: boolean; authenticated?: boolean }): CardV1 {
  return {
    v: 1,
    kind: 'reply',
    run_id: i.run_id,
    title: `Reply attached to ${i.rfq_number ?? 'an RFQ'} (by its subject)`,
    lines: [
      { label: 'Sender', value: i.sender_masked ?? 'unknown' },
      { label: 'Sender check', value: i.authenticated ? 'authenticated' : 'not authenticated' },
      { label: 'Attachments', value: String(i.attachments) },
      { label: 'Quote', value: i.quote_waiting ? 'forwarded to the open quote' : 'no open quote' },
    ],
    flags: i.authenticated ? [] : ['dmarc_fail'],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

/** Notice of the Gmail poller: an account's connection needs reconnecting (one per account and UTC day). */
export function gmailReconnectCard(i: { run_id: string; site_origin: string; account_masked: string }): CardV1 {
  return {
    v: 1,
    kind: 'reply',
    run_id: i.run_id,
    title: 'Gmail connection needs reconnecting',
    lines: [
      { label: 'Account', value: i.account_masked },
      { label: 'Action', value: 'Reconnect the account on the dashboard; replies of this account are not read until then' },
    ],
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

/** Notice of the Gmail poller: Google answered a token refresh with a new grant, which the poller does not store;
 *  reconnecting the account on the dashboard is recommended (one per account and UTC day). */
export function gmailReconnectRecommendedCard(i: { run_id: string; site_origin: string; account_masked: string }): CardV1 {
  return {
    v: 1,
    kind: 'reply',
    run_id: i.run_id,
    title: 'Gmail connection: reconnect recommended',
    lines: [
      { label: 'Account', value: i.account_masked },
      { label: 'Action', value: 'Reconnect the account on the dashboard; replies are still read until then' },
    ],
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

/** Notice of the Gmail poller: a message of an account was not imported (too large, or it could not be read after
 *  repeated attempts); it stays in the account's inbox. */
export function gmailMessageSkippedCard(i: { run_id: string; site_origin: string; account_masked: string; reason: 'too_large' | 'unreadable'; size_mb?: number | null }): CardV1 {
  const reason = i.reason === 'too_large' ? `too large to import${i.size_mb ? ` (about ${i.size_mb} MB)` : ''}` : 'could not be read after repeated attempts';
  return {
    v: 1,
    kind: 'reply',
    run_id: i.run_id,
    title: 'Gmail message not imported',
    lines: [
      { label: 'Account', value: i.account_masked },
      { label: 'Reason', value: reason },
      { label: 'Action', value: 'Open the message in the account and attach it to its RFQ by hand' },
    ],
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}
