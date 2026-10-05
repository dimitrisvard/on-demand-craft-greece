// Cards of reply attribution and the Gmail poller: the "Which RFQ?" card (kind 'reply_pick': attach to one of at
// most three waiting quotes, start a new RFQ, or ignore) and the notices without buttons (reply attached by its
// subject's RFQ number, a Gmail connection that needs reconnecting).
//
// Rules
//   - Business fields only: RFQ numbers, quote versions and send dates, company names, the number of attachments,
//     the masked sender (maskEmail) or masked account. Never an e-mail text, a subject, a full address or a token.
//   - attach_<n> refers to candidate n of the card (the order is stored in the run's output.candidates).
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

/** "Which RFQ?" card of a reply whose sender is the contact of waiting quotes. */
export function replyPickCard(i: ReplyPickCardInput): CardV1 {
  const candidates = i.candidates.slice(0, 3);
  const lines: CardV1['lines'] = [{ label: 'Sender', value: i.sender_masked ?? 'unknown' }];
  candidates.forEach((c, n) => lines.push({ label: `Candidate ${n + 1}`, value: candidateText(c) }));
  lines.push({ label: 'Attachments', value: String(i.attachments) });
  return {
    v: 1,
    kind: 'reply_pick',
    run_id: i.run_id,
    title: `${i.reminder ? 'Reminder: ' : ''}Which RFQ? · reply from ${i.sender_masked ?? 'unknown sender'}`,
    lines,
    flags: ['low_confidence'],
    allowed_verbs: replyPickVerbs(candidates.length, i.allow_new_rfq !== false),
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}

/** Notice: a reply was attached to an RFQ because its subject names the RFQ number (rule 3). */
export function replyAttachedCard(i: { run_id: string; site_origin: string; rfq_number: string | null; sender_masked: string | null; attachments: number; quote_waiting: boolean }): CardV1 {
  return {
    v: 1,
    kind: 'reply',
    run_id: i.run_id,
    title: `Reply attached to ${i.rfq_number ?? 'an RFQ'} (by its subject)`,
    lines: [
      { label: 'Sender', value: i.sender_masked ?? 'unknown' },
      { label: 'Attachments', value: String(i.attachments) },
      { label: 'Quote', value: i.quote_waiting ? 'forwarded to the open quote' : 'no open quote' },
    ],
    flags: [],
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
