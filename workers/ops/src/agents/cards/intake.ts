// Intake cards of the rfq-intake Workflow: the confirmation card (verbs confirm_sheet_metal, confirm_cnc,
// confirm_mixed, not_rfq), its reminder, and the notices without buttons (shadow result, mail not classified as an
// RFQ, follow-up attached to an RFQ, RFQ created).
//
// Rules
//   - Business fields only: RFQ number, company, country, language, masked sender, number of parts, file kinds,
//     process and confidence, customer status, flags. Never the e-mail body, a full address, the model's notes or a
//     token.
//   - The "Open" link of an intake card goes to the inbox row (/dashboard/rfq-inbox?email=<id>); the RFQ-created
//     notice links the RFQ page (/rfq/<rfq_id>).

import { cardOpenUrl, maskEmail, type CardFlag, type CardV1 } from './index';

export const INTAKE_VERBS = ['confirm_sheet_metal', 'confirm_cnc', 'confirm_mixed', 'not_rfq'] as const;

/** Process chosen by a confirmation verb. */
export const VERB_PROCESS: Readonly<Record<string, 'sheet_metal' | 'cnc' | 'mixed'>> = Object.freeze({
  confirm_sheet_metal: 'sheet_metal',
  confirm_cnc: 'cnc',
  confirm_mixed: 'mixed',
});

const PROCESS_TEXT: Readonly<Record<string, string>> = { sheet_metal: 'sheet metal', cnc: 'CNC machining', mixed: 'sheet metal and CNC', other: 'other / unclear' };

const REASON_TEXT: Readonly<Record<string, string>> = {
  mode_shadow: 'shadow mode',
  mode_assist: 'assist mode',
  low_confidence: 'low confidence',
  process_uncertain: 'process uncertain',
  sender_not_authenticated: 'sender not authenticated',
  injection_suspected: 'instructions in the e-mail',
  no_customer_no_company: 'no customer and no company',
};

export interface IntakeCardInput {
  run_id: string;
  site_origin: string;
  inbound_email_id: string;
  /** 'rfq' or 'techpilot' (platform notification). */
  kind: 'rfq' | 'techpilot';
  company: string | null;
  country: string | null;
  language: string | null;
  /** maskEmail() of the From address (never the full address). */
  sender_masked: string | null;
  parts: number;
  file_kinds: string[];
  process: string;
  process_confidence: number;
  confidence: number;
  customer: 'existing' | 'new' | 'suggested';
  reasons: string[];
  dmarc_pass: boolean;
  injection_suspected: boolean;
  /** Attachments that could not be read (encrypted or broken PDFs, rejected archive entries). */
  unreadable: number;
}

function pct(n: number): string {
  return `${Math.round(Math.min(1, Math.max(0, n)) * 100)} %`;
}

function titleOf(prefix: string, i: Pick<IntakeCardInput, 'company' | 'country' | 'sender_masked'>): string {
  const who = i.company?.trim() || (i.sender_masked ? maskEmail(i.sender_masked) : 'unknown sender');
  return `${prefix} · ${who}${i.country ? ` (${i.country})` : ''}`;
}

function flagsOf(i: Pick<IntakeCardInput, 'dmarc_pass' | 'injection_suspected' | 'confidence' | 'reasons'>): CardFlag[] {
  const flags: CardFlag[] = [];
  if (!i.dmarc_pass) flags.push('dmarc_fail');
  if (i.injection_suspected) flags.push('injection_suspected');
  if (i.reasons.includes('low_confidence') || i.reasons.includes('process_uncertain')) flags.push('low_confidence');
  return flags;
}

function linesOf(i: IntakeCardInput): CardV1['lines'] {
  const lines: CardV1['lines'] = [
    { label: 'Source', value: i.kind === 'techpilot' ? 'platform notification' : 'e-mail' },
    { label: 'Sender', value: i.sender_masked ? maskEmail(i.sender_masked) : 'unknown' },
    { label: 'Language', value: i.language || 'unknown' },
    { label: 'Parts', value: String(i.parts) },
    { label: 'Files', value: i.file_kinds.length ? i.file_kinds.join(', ') : 'none' },
    { label: 'Process', value: `${PROCESS_TEXT[i.process] ?? i.process} (${pct(i.process_confidence)})` },
    { label: 'Confidence', value: pct(i.confidence) },
    { label: 'Customer', value: i.customer === 'existing' ? 'existing customer' : i.customer === 'suggested' ? 'new (similar customers found)' : 'new customer' },
  ];
  if (i.unreadable > 0) lines.push({ label: 'Unreadable files', value: String(i.unreadable) });
  if (i.reasons.length) lines.push({ label: 'Why a check', value: i.reasons.map((r) => REASON_TEXT[r] ?? r).join(', ') });
  return lines;
}

/** The confirmation card (or its reminder). */
export function intakeCard(i: IntakeCardInput, o: { reminder?: boolean } = {}): CardV1 {
  return {
    v: 1,
    kind: 'intake',
    run_id: i.run_id,
    title: titleOf(o.reminder ? 'Reminder: new RFQ e-mail' : 'New RFQ e-mail', i),
    lines: linesOf(i),
    flags: flagsOf(i),
    allowed_verbs: [...INTAKE_VERBS],
    open_url: cardOpenUrl(i.site_origin, i.run_id, i.inbound_email_id),
  };
}

/** Shadow mode: what the agent would have done; no buttons. */
export function shadowCard(i: IntakeCardInput, needsCard: boolean): CardV1 {
  const lines = linesOf(i);
  lines.push({ label: 'Shadow result', value: needsCard ? 'would ask for confirmation' : 'would create the RFQ' });
  return { v: 1, kind: 'intake', run_id: i.run_id, title: titleOf('Shadow: RFQ e-mail', i), lines, flags: flagsOf(i), allowed_verbs: [], open_url: cardOpenUrl(i.site_origin, i.run_id, i.inbound_email_id) };
}

/** A mail the triage did not classify as an RFQ ('other'); no buttons. */
export function notRfqCard(i: { run_id: string; site_origin: string; inbound_email_id: string; sender_email: string | null; language: string | null; file_kinds: string[] }): CardV1 {
  return {
    v: 1,
    kind: 'intake',
    run_id: i.run_id,
    title: `E-mail in the RFQ mailbox, not an RFQ · ${i.sender_email ? maskEmail(i.sender_email) : 'unknown sender'}`,
    lines: [
      { label: 'Language', value: i.language || 'unknown' },
      { label: 'Files', value: i.file_kinds.length ? i.file_kinds.join(', ') : 'none' },
      { label: 'Next', value: 'check it in the inbox; it can be started as an RFQ there' },
    ],
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id, i.inbound_email_id),
  };
}

/** A follow-up mail attached to an existing RFQ; no buttons. */
export function attachedCard(i: { run_id: string; site_origin: string; inbound_email_id: string; rfq_number: string | null; sender_email: string | null; files: number; cad_jobs: number }): CardV1 {
  return {
    v: 1,
    kind: 'intake',
    run_id: i.run_id,
    title: `Follow-up mail attached to ${i.rfq_number ?? 'an RFQ'}`,
    lines: [
      { label: 'Sender', value: i.sender_email ? maskEmail(i.sender_email) : 'unknown' },
      { label: 'Files added', value: String(i.files) },
      { label: 'CAD jobs', value: String(i.cad_jobs) },
    ],
    flags: [],
    allowed_verbs: [],
    open_url: cardOpenUrl(i.site_origin, i.run_id, i.inbound_email_id),
  };
}

/** The RFQ was created; no buttons, the link opens the RFQ page. */
export function createdCard(i: { run_id: string; site_origin: string; rfq_id: string; rfq_number: string; company: string | null; country: string | null; parts: number; files: number; cad_jobs: number; quote_started: boolean }): CardV1 {
  const origin = i.site_origin.replace(/\/+$/, '');
  return {
    v: 1,
    kind: 'intake',
    run_id: i.run_id,
    title: `RFQ created · ${i.rfq_number} · ${i.company?.trim() || 'unknown company'}${i.country ? ` (${i.country})` : ''}`,
    lines: [
      { label: 'Parts', value: String(i.parts) },
      { label: 'Files', value: String(i.files) },
      { label: 'CAD jobs', value: String(i.cad_jobs) },
      { label: 'Quote draft', value: i.quote_started ? 'started' : 'not started (quote agent off)' },
    ],
    flags: [],
    allowed_verbs: [],
    open_url: `${origin}/rfq/${encodeURIComponent(i.rfq_id)}`,
  };
}
