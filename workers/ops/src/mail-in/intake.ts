// Pure rules and builders of the intake Workflow (src/workflows/rfq-intake.ts): no I/O, no clock, no randomness, so
// every result can be cached as a step result and replayed.
//
// Rules
//   - Rule triage decides only non-RFQ kinds: Auto-Submitted other than 'no', Precedence auto_reply -> auto_reply;
//     a delivery report (multipart/report) or a MAILER-DAEMON / postmaster sender -> auto_reply; Precedence bulk,
//     junk or list, a List-Id header, or a trusted DMARC fail without any attachment -> spam. Everything else goes
//     to the triage model.
//   - Process rules: DXF files and sheet-metal words (bending, laser cutting, sheet, Blech, Abkantung, ...) count for
//     sheet metal; machining words (milling, turning, CNC, Fräsen, Drehteile, ...) and tight tolerances (0.05 mm or
//     less, ISO fits such as H7) count for CNC; both -> mixed. Combined with the model: agreement keeps the higher
//     confidence, disagreement keeps the model's process with its confidence lowered by 0.2.
//   - Overall extraction confidence = the minimum confidence of company, contact_email and every part's quantity and
//     material (0 without parts).
//   - A human confirms unless the mode is 'auto' and none of these holds: confidence below value.min_confidence
//     (default 0.7), process confidence below it, sender not authenticated (trusted DMARC pass with the From
//     domain), injection suspected, neither a known customer nor a company name.
//   - Untrusted text goes into the user turn only, inside <untrusted_email> and <attachments> / <attachment n="...">
//     blocks; tag-like text in the mail that could close or open those blocks is neutralised.
//   - The RFQ contact address is never model output alone: an e-mailed RFQ uses the From address; a platform
//     notification uses the extracted address only when it appears verbatim in the mail text.
//   - RFQ parts follow the web form's parts_details shape (src/components/quote-form/MultiStepQuoteForm.tsx), with
//     part ids passed in by the caller (stable across retries) and source 'email' or 'techpilot'.

import type { EmailRfqPayload, RfqPart } from '../db/repos/rfqs';
import type { InboundKind } from '../db/repos/inbound-emails';
import type { LlmContent } from '../ports/index';
import type { AttachmentRecord } from './attachments';
import { dmarcPass, domainOf, type AuthResults } from './auth-results';
import type { AttachmentKind, ParsedMail } from './parse';

export type Process = 'sheet_metal' | 'cnc' | 'mixed' | 'other';

/** Field<T> of the extract schema. */
export interface ExtractField<T> {
  value: T | null;
  confidence: number;
}

/** Output of rfq_intake.extract@v1 (src/agents/prompts/rfq_intake/extract.v1.schema.json). */
export interface RfqExtractV1 {
  company: ExtractField<string>;
  contact_first_name: ExtractField<string>;
  contact_last_name: ExtractField<string>;
  contact_email: ExtractField<string>;
  phone: ExtractField<string>;
  vat_id: ExtractField<string>;
  country: ExtractField<string>;
  deadline: ExtractField<string>;
  language: string;
  notes: string;
  parts: Array<{
    name: string;
    quantity: ExtractField<number>;
    material: ExtractField<string>;
    thickness_mm: ExtractField<number>;
    finish: ExtractField<string>;
    tolerance: ExtractField<string>;
    process_hint: 'sheet_metal' | 'cnc' | 'unknown';
    attachment_refs: number[];
  }>;
  injection_suspected: boolean;
}

/** Output of rfq_intake.triage@v1. */
export interface TriageV1 {
  kind: InboundKind;
  language: string;
  injection_suspected: boolean;
  confidence: number;
}

/** Output of rfq_intake.classify_process@v1. */
export interface ClassifyProcessV1 {
  process: Process;
  confidence: number;
  signals: string[];
}

export const DEFAULT_MIN_CONFIDENCE = 0.7;
/** Characters of the mail text sent to the classify prompts (subject + first 6,000 characters). */
export const CLASSIFY_TEXT_CHARS = 6000;
/** Characters of the mail text sent to the extract prompt and kept in R2 for the LLM steps. */
export const EXTRACT_TEXT_CHARS = 40_000;
/** At most this many images go to the extract prompt, each at most 3.75 MB as base64. */
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BASE64 = 3_750_000;
/** Request size guard of the extract call (bytes of base64 and text). */
export const MAX_REQUEST_BYTES = 20_000_000;

// ----- signals of a parsed mail -----

export interface MailSignals {
  auto_submitted: string | null;
  precedence: string | null;
  list_id: boolean;
  /** multipart/report (delivery status notification). */
  report: boolean;
  /** Sender local part MAILER-DAEMON or postmaster. */
  mailer_daemon: boolean;
  /** Attachments that are not inline parts. */
  attachments: number;
  /** The trusted Authentication-Results instance says dmarc=fail. */
  dmarc_fail: boolean;
  /** Trusted DMARC pass whose header.from is the From domain. */
  dmarc_pass: boolean;
  in_reply_to: boolean;
  references: number;
  /** First RFQ number (RFQ-<8 digits>-<n>) named in the subject. */
  rfq_number: string | null;
}

const RFQ_NUMBER = /RFQ-\d{8}-\d+/;

export function rfqNumberIn(subject: string | null | undefined): string | null {
  return RFQ_NUMBER.exec(String(subject ?? ''))?.[0] ?? null;
}

export function mailSignals(parsed: Pick<ParsedMail, 'headers'>, auth: AuthResults | null, attachments: readonly AttachmentRecord[]): MailSignals {
  const h = parsed.headers;
  const local = String(h.from_email ?? '').split('@')[0]?.toLowerCase() ?? '';
  return {
    auto_submitted: h.auto_submitted?.trim().toLowerCase() || null,
    precedence: h.precedence?.trim().toLowerCase() || null,
    list_id: Boolean(h.list_id),
    report: /^multipart\/report\b/i.test(h.content_type ?? ''),
    mailer_daemon: local === 'mailer-daemon' || local === 'postmaster',
    attachments: attachments.filter((a) => !a.inline && a.parent === undefined).length,
    dmarc_fail: Boolean(auth?.trusted) && auth?.dmarc === 'fail',
    dmarc_pass: dmarcPass(auth, h.from_email),
    in_reply_to: Boolean(h.in_reply_to),
    references: h.references.length,
    rfq_number: rfqNumberIn(h.subject),
  };
}

export type RuleKind = Extract<InboundKind, 'auto_reply' | 'spam'>;

/** The kind the rules decide, or null when the triage model decides. */
export function triageRules(s: MailSignals): { kind: RuleKind | null; reason: string } {
  if (s.auto_submitted && s.auto_submitted !== 'no') return { kind: 'auto_reply', reason: 'auto_submitted' };
  if (s.precedence === 'auto_reply') return { kind: 'auto_reply', reason: 'precedence_auto_reply' };
  if (s.report) return { kind: 'auto_reply', reason: 'delivery_report' };
  if (s.mailer_daemon) return { kind: 'auto_reply', reason: 'mailer_daemon' };
  if (s.precedence && ['bulk', 'junk', 'list'].includes(s.precedence)) return { kind: 'spam', reason: `precedence_${s.precedence}` };
  if (s.list_id) return { kind: 'spam', reason: 'list_id' };
  if (s.dmarc_fail && s.attachments === 0) return { kind: 'spam', reason: 'dmarc_fail_no_attachment' };
  return { kind: null, reason: 'undecided' };
}

// ----- process -----

const SHEET_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bbend(?:ing|s)?\b|\bbent\b/i, 'bending'],
  [/\bfold(?:ed|ing)?\b|\bpress brake\b/i, 'folding'],
  [/\bsheet(?:[- ]metal)?s?\b|\bplates?\b/i, 'sheet'],
  [/\blaser(?:[- ]?cut(?:ting)?|schneid\w*)?\b/i, 'laser'],
  [/abkant\w*|\bkantteil\w*|\bgekantet\b/i, 'Abkantung'],
  [/\bblech\w*/i, 'Blech'],
  [/λαμαρίν\w*|κάμψ\w*|στραντζ\w*/iu, 'λαμαρίνα'],
  [/gięci\w*|\bgięt\w*|\bblach\w*/iu, 'gięcie'],
  [/\btôlerie\b|\bpliage\b/i, 'pliage'],
];

const CNC_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bmill(?:ed|ing)\b/i, 'milling'],
  [/\bturn(?:ed|ing)\b|\blathe\b/i, 'turning'],
  [/\bcnc\b/i, 'CNC'],
  [/fräs\w*/i, 'Fräsen'],
  [/\bdreh(?:teil\w*|en|bank)\b/i, 'Drehteile'],
  [/φρεζ\w*|τόρν\w*/iu, 'φρεζάρισμα'],
  [/frezow\w*|tocz\w*/iu, 'frezowanie'],
  [/(?:±|\+\/-|\+-)\s*0[.,]0[0-5]\d*\s*mm|(?:±|\+\/-|\+-)\s*0[.,]0[0-5]\b/i, 'tolerance ≤ 0.05 mm'],
  [/\b(?:H[6-9]|[hgf][5-8])\b/, 'ISO fit'],
];

export interface ProcessRuleResult {
  process: Exclude<Process, 'other'> | null;
  confidence: number;
  signals: string[];
}

/** Process signals from the text and the attachment kinds (see the rules above). */
export function processRules(text: string, kinds: readonly AttachmentKind[]): ProcessRuleResult {
  const sheet: string[] = [];
  const cnc: string[] = [];
  if (kinds.includes('dxf')) sheet.push('DXF');
  for (const [re, label] of SHEET_WORDS) if (re.test(text)) sheet.push(label);
  for (const [re, label] of CNC_WORDS) if (re.test(text)) cnc.push(label);
  const signals = [...sheet, ...cnc];
  if (signals.length === 0) return { process: null, confidence: 0, signals };
  const process = sheet.length && cnc.length ? 'mixed' : sheet.length ? 'sheet_metal' : 'cnc';
  return { process, confidence: Math.min(0.5 + 0.1 * signals.length, 0.9), signals };
}

export interface ProcessDecision {
  process: Process;
  confidence: number;
  signals: string[];
  source: 'rules' | 'model' | 'agree';
}

function clamp01(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Rules combined with the classify_process model (null when the model was not asked). */
export function combineProcess(rules: ProcessRuleResult, model: ClassifyProcessV1 | null): ProcessDecision {
  const signals = [...new Set([...rules.signals, ...(model?.signals ?? []).map((s) => String(s).slice(0, 60))])].slice(0, 8);
  if (!model) return { process: rules.process ?? 'other', confidence: round3(rules.confidence), signals, source: 'rules' };
  const modelConfidence = clamp01(model.confidence);
  if (!rules.process) return { process: model.process, confidence: round3(modelConfidence), signals, source: 'model' };
  if (rules.process === model.process) return { process: model.process, confidence: round3(Math.max(modelConfidence, rules.confidence)), signals, source: 'agree' };
  return { process: model.process, confidence: round3(Math.max(0, modelConfidence - 0.2)), signals, source: 'model' };
}

// ----- confidence and the human decision -----

/** Minimum confidence of company, contact_email and every part's quantity and material; 0 without parts. */
export function extractConfidence(x: RfqExtractV1): number {
  if (x.parts.length === 0) return 0;
  const values = [x.company.confidence, x.contact_email.confidence];
  for (const p of x.parts) values.push(p.quantity.confidence, p.material.confidence);
  return round3(Math.min(...values.map(clamp01)));
}

/** flag.value.min_confidence when it is a number in 0..1, else 0.7. */
export function minConfidenceOf(value: Record<string, unknown>): number {
  const v = value.min_confidence;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_MIN_CONFIDENCE;
}

export type CardReason =
  | 'mode_shadow'
  | 'mode_assist'
  | 'low_confidence'
  | 'process_uncertain'
  | 'sender_not_authenticated'
  | 'injection_suspected'
  | 'no_customer_no_company';

export function decideCard(i: {
  mode: 'shadow' | 'assist' | 'auto';
  confidence: number;
  process_confidence: number;
  min_confidence: number;
  dmarc_pass: boolean;
  injection_suspected: boolean;
  customer_id: string | null;
  company: string | null;
}): { needs_card: boolean; reasons: CardReason[] } {
  const reasons: CardReason[] = [];
  if (i.mode === 'shadow') reasons.push('mode_shadow');
  if (i.mode === 'assist') reasons.push('mode_assist');
  if (i.confidence < i.min_confidence) reasons.push('low_confidence');
  if (i.process_confidence < i.min_confidence) reasons.push('process_uncertain');
  if (!i.dmarc_pass) reasons.push('sender_not_authenticated');
  if (i.injection_suspected) reasons.push('injection_suspected');
  if (!i.customer_id && !i.company) reasons.push('no_customer_no_company');
  return { needs_card: reasons.length > 0, reasons };
}

/**
 * The follow-up path (a mail matched to an existing RFQ by reply attribution): the same checks as decideCard()
 * without the extraction ones. A human confirms unless the mode is 'auto', the match confidence reaches the threshold,
 * the sender is authenticated and the mail holds no instructions to the agent.
 */
export function decideFollowUp(i: {
  mode: 'shadow' | 'assist' | 'auto';
  match_confidence: number;
  min_confidence: number;
  dmarc_pass: boolean;
  injection_suspected: boolean;
}): { needs_card: boolean; reasons: CardReason[] } {
  const reasons: CardReason[] = [];
  if (i.mode === 'shadow') reasons.push('mode_shadow');
  if (i.mode === 'assist') reasons.push('mode_assist');
  if (!(i.match_confidence >= i.min_confidence)) reasons.push('low_confidence');
  if (!i.dmarc_pass) reasons.push('sender_not_authenticated');
  if (i.injection_suspected) reasons.push('injection_suspected');
  return { needs_card: reasons.length > 0, reasons };
}

// ----- addresses -----

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value.trim());
}

/** The RFQ contact address (see the rules above); null when none qualifies. */
export function contactEmailFor(kind: 'rfq' | 'techpilot', fromEmail: string | null, extracted: string | null, text: string): string | null {
  if (kind === 'rfq') return isEmailAddress(fromEmail) ? fromEmail.trim().toLowerCase() : null;
  if (!isEmailAddress(extracted)) return null;
  const address = extracted.trim().toLowerCase();
  return text.toLowerCase().includes(address) ? address : null;
}

// ----- LLM content -----

/** Attribute-safe text of a sender-controlled name. */
function attr(value: string, max = 100): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>"&]/g, '_')
    .slice(0, max);
}

/** Mail text with tag-like sequences that could open or close the data blocks neutralised. */
export function neutralise(text: string): string {
  return String(text ?? '').replace(/<(\s*\/?\s*)(untrusted_email|attachments?)\b/gi, '‹$1$2');
}

export interface EmailForModel {
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  text: string;
}

/** <untrusted_email> block: subject, sender line and the first `maxChars` characters of the text. */
export function emailBlock(m: EmailForModel, maxChars: number): string {
  const sender = [m.from_name ? attr(m.from_name, 120) : '', m.from_email ? `<${attr(m.from_email, 254)}>` : ''].filter(Boolean).join(' ');
  const lines = [
    '<untrusted_email>',
    `Subject: ${neutralise(String(m.subject ?? '').replace(/[\r\n]+/g, ' ').slice(0, 998))}`,
    `From: ${sender || 'unknown'}`,
    '',
    neutralise(String(m.text ?? '').slice(0, maxChars)),
    '</untrusted_email>',
  ];
  return lines.join('\n');
}

/** Attachments the model is told about: every non-inline file (archive entries included). */
export function listedAttachments(records: readonly AttachmentRecord[]): AttachmentRecord[] {
  return records.filter((r) => !r.inline);
}

/** <attachments> block listing the files by n, name, kind and size. */
export function attachmentsBlock(records: readonly AttachmentRecord[]): string {
  const listed = listedAttachments(records);
  if (listed.length === 0) return '<attachments>\nnone\n</attachments>';
  const lines = listed.map((r) => {
    const parent = r.parent !== undefined ? ` from_archive="${r.parent}"` : '';
    return `<attachment n="${r.n}" name="${attr(r.filename)}" kind="${r.kind}" size_bytes="${r.size_bytes}"${parent}/>`;
  });
  return ['<attachments>', ...lines, '</attachments>'].join('\n');
}

/** User content of rfq_intake.triage@v1 and rfq_intake.classify_process@v1. */
export function classifyContent(m: EmailForModel, records: readonly AttachmentRecord[]): LlmContent[] {
  return [{ type: 'text', text: `${emailBlock(m, CLASSIFY_TEXT_CHARS)}\n${attachmentsBlock(records)}` }];
}

export interface DocumentForModel {
  n: number;
  name: string;
  base64: string;
  /** e.g. 'pages 1-5 of 7'. */
  note: string;
}

export interface ImageForModel {
  n: number;
  name: string;
  mediaType: 'image/png' | 'image/jpeg';
  base64: string;
}

/** User content of rfq_intake.extract@v1: the mail, the attachment list, one trimmed PDF and up to three images. */
export function extractContent(m: EmailForModel, records: readonly AttachmentRecord[], pdf: DocumentForModel | null, images: readonly ImageForModel[]): LlmContent[] {
  const out: LlmContent[] = [{ type: 'text', text: `${emailBlock(m, EXTRACT_TEXT_CHARS)}\n${attachmentsBlock(records)}` }];
  if (pdf) {
    out.push({ type: 'text', text: `<attachment n="${pdf.n}" name="${attr(pdf.name)}" kind="pdf">${attr(pdf.note, 60)}</attachment>` });
    out.push({ type: 'pdf', base64: pdf.base64 });
  }
  for (const image of images.slice(0, MAX_IMAGES)) {
    out.push({ type: 'text', text: `<attachment n="${image.n}" name="${attr(image.name)}" kind="image"></attachment>` });
    out.push({ type: 'image', mediaType: image.mediaType, base64: image.base64 });
  }
  return out;
}

// ----- RFQ payload -----

const PROCESS_FORM: Readonly<Record<'sheet_metal' | 'cnc', { value: string; label: string }>> = {
  sheet_metal: { value: 'sheet-metal', label: 'Sheet Metal' },
  cnc: { value: 'cnc-milling', label: 'CNC Milling' },
};

function text(v: unknown, max = 200): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return t ? t.slice(0, max) : undefined;
}

function isoDate(v: unknown): string | undefined {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined;
}

function country(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : undefined;
}

function positiveNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export interface PayloadInput {
  extract: RfqExtractV1;
  process: Process;
  source: 'email' | 'techpilot';
  /** contactEmailFor() */
  contact_email: string | null;
  /** Company name when the extract has none (the sender's domain, or a placeholder). */
  company_fallback: string;
  /** ISO timestamp written as the parts' created_at and updated_at. */
  now: string;
  /** One stable id per part (callers derive them from the inbound e-mail id). */
  part_ids: readonly string[];
  /** CAD files used as parts when the extract lists none. */
  cad_files: ReadonlyArray<Pick<AttachmentRecord, 'n' | 'filename'>>;
}

/** Number of parts the payload will hold (extract parts, else one per CAD file, else one). */
export function partCount(extract: RfqExtractV1, cadFiles: number): number {
  return extract.parts.length || cadFiles || 1;
}

/** p_payload of create_email_rfq in the web form's shape (see the rules above). */
export function rfqPayload(i: PayloadInput): EmailRfqPayload {
  const x = i.extract;
  const sourceParts: RfqExtractV1['parts'] = x.parts.length
    ? x.parts
    : (i.cad_files.length ? i.cad_files : [{ n: 0, filename: 'Part' }]).map((f) => ({
        name: f.filename,
        quantity: { value: null, confidence: 0 },
        material: { value: null, confidence: 0 },
        thickness_mm: { value: null, confidence: 0 },
        finish: { value: null, confidence: 0 },
        tolerance: { value: null, confidence: 0 },
        process_hint: 'unknown' as const,
        attachment_refs: f.n ? [f.n] : [],
      }));
  if (i.part_ids.length < sourceParts.length) throw new Error('rfqPayload: one part id per part is needed');
  const parts: RfqPart[] = sourceParts.map((p, index) => {
    const hint = p.process_hint !== 'unknown' ? p.process_hint : i.process === 'sheet_metal' || i.process === 'cnc' ? i.process : null;
    const form = hint ? PROCESS_FORM[hint] : null;
    const material = text(p.material.value, 120);
    const thickness = positiveNumber(p.thickness_mm.value);
    const tolerance = text(p.tolerance.value, 120);
    const finish = text(p.finish.value, 120);
    const name = text(p.name, 120);
    const quantity = positiveNumber(p.quantity.value);
    const description = [
      `Process: ${form?.label ?? ''}`,
      `Material: ${material ?? ''}`,
      finish ? `Surface Treatment: ${finish}` : '',
      tolerance ? `Tolerance: ${tolerance}` : '',
      thickness ? `Thickness: ${thickness} mm` : '',
      name ? `Comments: ${name}` : '',
    ].join('\n');
    return {
      id: i.part_ids[index],
      rfq_id: '',
      product_name: `Part ${index + 1}`,
      description,
      quantity: quantity ? Math.max(1, Math.round(quantity)) : 1,
      unit_price: 0,
      total_price: 0,
      created_at: i.now,
      updated_at: i.now,
      original_values: {
        process: form?.value ?? '',
        processLabel: form?.label ?? '',
        material: material ?? '',
        materialLabel: material ?? '',
        surfaceTreatment: finish ?? '',
        surfaceTreatmentLabel: finish ?? '',
        tolerance: tolerance ?? '',
        toleranceLabel: tolerance ?? '',
        comments: name ?? '',
        thickness: thickness ?? null,
        needsBending: null,
        source: i.source,
        attachment_refs: p.attachment_refs.filter((n) => Number.isSafeInteger(n) && n > 0),
        confidence: { quantity: clamp01(p.quantity.confidence), material: clamp01(p.material.confidence), thickness: clamp01(p.thickness_mm.confidence) },
      },
    };
  });
  const payload: EmailRfqPayload = {
    company_name: text(x.company.value, 200) ?? i.company_fallback,
    is_order: false,
    parts,
  };
  const set = <K extends keyof EmailRfqPayload>(key: K, value: EmailRfqPayload[K] | undefined) => {
    if (value !== undefined) payload[key] = value;
  };
  set('vat_id', text(x.vat_id.value, 40)?.replace(/\s+/g, '').toUpperCase());
  set('country', country(x.country.value));
  set('contact_first_name', text(x.contact_first_name.value, 100));
  set('contact_last_name', text(x.contact_last_name.value, 100));
  set('contact_email', i.contact_email ?? undefined);
  set('contact_phone', text(x.phone.value, 40));
  set('due_date', isoDate(x.deadline.value));
  set('description', text(x.notes, 2000));
  return payload;
}

/** Company name when the extract has none: the sender's domain for an e-mailed RFQ, else a placeholder. */
export function companyFallback(kind: 'rfq' | 'techpilot', fromEmail: string | null): string {
  const domain = kind === 'rfq' ? domainOf(fromEmail) : null;
  return domain ?? 'Unknown company';
}

/** Kinds of the attachments a mail carries (non-inline), sorted. */
export function fileKinds(records: readonly AttachmentRecord[]): AttachmentKind[] {
  return [...new Set(listedAttachments(records).map((r) => r.kind))].sort();
}
