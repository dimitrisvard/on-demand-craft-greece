// Types of the agent layer for the dashboard (Phase 4): the /api/agent/* contract mirrored from
// workers/shared/src/agent-api.ts, and the rows the pages read from the agent tables
// (supabase/migrations/*_agent_layer.sql) until src/integrations/supabase/types.ts is regenerated.
//
// Rules
//   - The API types and guards below are a copy of workers/shared/src/agent-api.ts (the SPA does not import Worker
//     code). tests/frontend-api/agentApi.test.ts runs every shared fixture of
//     workers/shared/test/fixtures/agent-api/ through both sets of guards and requires the same answer, so the two
//     stay in step.
//   - Row types list only the columns the pages read; columns added later are optional and read defensively.
//   - Nothing here carries a raw approval token: the dashboard decides with run_id + token_sha256 as read under
//     staff RLS.

export const AGENT_API_VERSION = 1 as const;

export type CardKind = 'intake' | 'quote' | 'reply' | 'reply_pick' | 'handoff' | 'reorder' | 'failure' | 'test';
export const CARD_KINDS: readonly CardKind[] = ['intake', 'quote', 'reply', 'reply_pick', 'handoff', 'reorder', 'failure', 'test'];

export type AgentAction = 'decision' | 'status' | 'flag' | 'start' | 'file';
export const AGENT_ACTIONS: readonly AgentAction[] = ['decision', 'status', 'flag', 'start', 'file'];

/** Verb -> Telegram code per card kind (null: dashboard only). */
export const VERB_CODES: Readonly<Record<CardKind, Readonly<Record<string, string | null>>>> = {
  intake: { confirm_sheet_metal: 'csm', confirm_cnc: 'cnc', confirm_mixed: 'mix', not_rfq: 'nrfq' },
  quote: { approve: 'ok', reject: 'rej' },
  reply: { won: 'won', lost: 'lost', counter: 'ctr', ignore: 'ign' },
  reply_pick: { attach_1: 'a1', attach_2: 'a2', attach_3: 'a3', new_rfq: 'new', ignore: 'ign' },
  handoff: { send_partner: 'sp', hold: 'hold', change_partner: null },
  reorder: { approve_draft: 'apd', dismiss: 'dis' },
  failure: { retry: 'rty', dismiss: 'dis' },
  test: { dismiss: 'dis' },
};

/** Button labels of the verbs (same texts as the Telegram buttons). */
export const VERB_LABELS: Readonly<Record<string, string>> = {
  confirm_sheet_metal: 'Confirm sheet metal',
  confirm_cnc: 'Confirm CNC',
  confirm_mixed: 'Mixed',
  not_rfq: 'Not an RFQ',
  approve: 'Approve and send',
  reject: 'Reject',
  won: 'Won',
  lost: 'Lost',
  counter: 'Counter-offer',
  ignore: 'Ignore',
  attach_1: 'Attach to 1',
  attach_2: 'Attach to 2',
  attach_3: 'Attach to 3',
  new_rfq: 'New RFQ',
  send_partner: 'Send to partner',
  hold: 'Hold',
  change_partner: 'Change partner',
  approve_draft: 'Approve draft',
  dismiss: 'Dismiss',
  retry: 'Retry',
};

export const TOKEN_RE = /^[A-Z2-7]{26}$/;
export const CODE_RE = /^[a-z0-9]{1,4}$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const VERB_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const FLAG_EDIT_KEY_RE = /^(agent\.[a-z0-9_.]+|mcp\.remote)$/;
export const NOTE_MAX = 500;
export const LABEL_MAX = 200;

export interface QuoteEdits {
  overrides?: Array<{ line_no: number; unit_price: number; note?: string }>;
  shipping?: number;
  drafts?: { subject?: string; body_text?: string };
}

export interface DecisionBodyDashboard {
  v: 1;
  run_id: string;
  token_sha256: string;
  verb: string;
  edits?: QuoteEdits;
  note?: string;
}

/** The relay's body (never sent by the dashboard; listed for the fixture check). */
export interface DecisionBodyRelay {
  v: 1;
  token: string;
  code: string;
  tg: { user_id: number; chat_id: number; message_id: number };
}

export type DecisionOutcome = 'event_sent' | 'terminated' | 'restarted' | 'dismissed';
export const DECISION_OUTCOMES: readonly DecisionOutcome[] = ['event_sent', 'terminated', 'restarted', 'dismissed'];

export interface DecisionResult {
  v: 1;
  ok: true;
  run_id: string;
  verb: string;
  outcome: DecisionOutcome;
  label: string;
}

export interface AgentStatus {
  v: 1;
  ok: true;
  actions: AgentAction[];
  principal: 'STAFF' | 'ADMIN';
}

export type FlagMode = 'shadow' | 'assist' | 'auto';

export interface FlagEditBody {
  v: 1;
  key: string;
  expected_rev: number;
  enabled: boolean;
  mode?: FlagMode;
  writes?: boolean;
}

export interface FlagEditResult {
  v: 1;
  ok: true;
  key: string;
  rev: number;
  kv: 'written' | 'pending';
}

export type StartBody =
  | { v: 1; kind: 'quote'; rfq_id: string }
  | { v: 1; kind: 'rfq_intake'; inbound_email_id: string }
  | { v: 1; kind: 'test_card' };

export interface StartResult {
  v: 1;
  ok: true;
  instance_id: string;
  created: boolean;
}

export type AgentApiError =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'already_decided'
  | 'stale'
  | 'verb_not_allowed'
  | 'flag_off'
  | 'active_quote_exists'
  | 'rate_limited';

export const AGENT_API_ERRORS: readonly AgentApiError[] = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'method_not_allowed',
  'payload_too_large',
  'already_decided',
  'stale',
  'verb_not_allowed',
  'flag_off',
  'active_quote_exists',
  'rate_limited',
];

// ----- Guards (copy of the shared guards; exact shapes of untrusted JSON) -----

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function has(x: Obj, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(x, key);
}

function hasOnlyKeys(x: Obj, required: readonly string[], optional: readonly string[] = []): boolean {
  for (const key of required) if (!has(x, key)) return false;
  for (const key of Object.keys(x)) if (!required.includes(key) && !optional.includes(key)) return false;
  return true;
}

const isStr = (x: unknown): x is string => typeof x === 'string';
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isSafeInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);

function optional<T>(x: Obj, key: string, check: (v: unknown) => v is T): boolean {
  return !has(x, key) || check(x[key]);
}

const isNote = (x: unknown): x is string => isStr(x) && x.length <= NOTE_MAX;

export function isQuoteEdits(x: unknown): x is QuoteEdits {
  if (!isObj(x) || !hasOnlyKeys(x, [], ['overrides', 'shipping', 'drafts'])) return false;
  if (has(x, 'overrides')) {
    if (!Array.isArray(x.overrides)) return false;
    for (const o of x.overrides) {
      if (!isObj(o) || !hasOnlyKeys(o, ['line_no', 'unit_price'], ['note'])) return false;
      if (!isSafeInt(o.line_no) || !isFiniteNumber(o.unit_price) || !optional(o, 'note', isStr)) return false;
    }
  }
  if (!optional(x, 'shipping', isFiniteNumber)) return false;
  if (has(x, 'drafts')) {
    const d = x.drafts;
    if (!isObj(d) || !hasOnlyKeys(d, [], ['subject', 'body_text'])) return false;
    if (!optional(d, 'subject', isStr) || !optional(d, 'body_text', isStr)) return false;
  }
  return true;
}

export function isDecisionBodyDashboard(x: unknown): x is DecisionBodyDashboard {
  if (!isObj(x) || !hasOnlyKeys(x, ['v', 'run_id', 'token_sha256', 'verb'], ['edits', 'note'])) return false;
  return (
    x.v === 1 &&
    isStr(x.run_id) &&
    UUID_RE.test(x.run_id) &&
    isStr(x.token_sha256) &&
    SHA256_HEX_RE.test(x.token_sha256) &&
    isStr(x.verb) &&
    VERB_RE.test(x.verb) &&
    optional(x, 'edits', isQuoteEdits) &&
    optional(x, 'note', isNote)
  );
}

export function isDecisionBodyRelay(x: unknown): x is DecisionBodyRelay {
  if (!isObj(x) || !hasOnlyKeys(x, ['v', 'token', 'code', 'tg'])) return false;
  if (x.v !== 1 || !isStr(x.token) || !TOKEN_RE.test(x.token) || !isStr(x.code) || !CODE_RE.test(x.code)) return false;
  const tg = x.tg;
  return isObj(tg) && hasOnlyKeys(tg, ['user_id', 'chat_id', 'message_id']) && isSafeInt(tg.user_id) && isSafeInt(tg.chat_id) && isSafeInt(tg.message_id);
}

export function isDecisionResult(x: unknown): x is DecisionResult {
  if (!isObj(x) || !hasOnlyKeys(x, ['v', 'ok', 'run_id', 'verb', 'outcome', 'label'])) return false;
  return (
    x.v === 1 &&
    x.ok === true &&
    isStr(x.run_id) &&
    UUID_RE.test(x.run_id) &&
    isStr(x.verb) &&
    VERB_RE.test(x.verb) &&
    (DECISION_OUTCOMES as readonly unknown[]).includes(x.outcome) &&
    isStr(x.label) &&
    x.label.length <= LABEL_MAX
  );
}

export function isAgentStatus(x: unknown): x is AgentStatus {
  if (!isObj(x) || !hasOnlyKeys(x, ['v', 'ok', 'actions', 'principal'])) return false;
  if (x.v !== 1 || x.ok !== true || (x.principal !== 'STAFF' && x.principal !== 'ADMIN')) return false;
  const actions = x.actions;
  return Array.isArray(actions) && actions.every((a) => (AGENT_ACTIONS as readonly unknown[]).includes(a)) && new Set(actions).size === actions.length;
}

export function isFlagEditBody(x: unknown): x is FlagEditBody {
  if (!isObj(x) || !hasOnlyKeys(x, ['v', 'key', 'expected_rev', 'enabled'], ['mode', 'writes'])) return false;
  return (
    x.v === 1 &&
    isStr(x.key) &&
    FLAG_EDIT_KEY_RE.test(x.key) &&
    isSafeInt(x.expected_rev) &&
    x.expected_rev >= 0 &&
    typeof x.enabled === 'boolean' &&
    optional(x, 'mode', (m): m is FlagMode => m === 'shadow' || m === 'assist' || m === 'auto') &&
    optional(x, 'writes', (w): w is boolean => typeof w === 'boolean')
  );
}

export function isFlagEditResult(x: unknown): x is FlagEditResult {
  if (!isObj(x) || !hasOnlyKeys(x, ['v', 'ok', 'key', 'rev', 'kv'])) return false;
  return x.v === 1 && x.ok === true && isStr(x.key) && FLAG_EDIT_KEY_RE.test(x.key) && isSafeInt(x.rev) && x.rev >= 0 && (x.kv === 'written' || x.kv === 'pending');
}

export function isStartBody(x: unknown): x is StartBody {
  if (!isObj(x) || x.v !== 1) return false;
  switch (x.kind) {
    case 'quote':
      return hasOnlyKeys(x, ['v', 'kind', 'rfq_id']) && isStr(x.rfq_id) && UUID_RE.test(x.rfq_id);
    case 'rfq_intake':
      return hasOnlyKeys(x, ['v', 'kind', 'inbound_email_id']) && isStr(x.inbound_email_id) && UUID_RE.test(x.inbound_email_id);
    case 'test_card':
      return hasOnlyKeys(x, ['v', 'kind']);
    default:
      return false;
  }
}

export function isStartResult(x: unknown): x is StartResult {
  if (!isObj(x) || !hasOnlyKeys(x, ['v', 'ok', 'instance_id', 'created'])) return false;
  return x.v === 1 && x.ok === true && isStr(x.instance_id) && x.instance_id.length > 0 && x.instance_id.length <= 100 && typeof x.created === 'boolean';
}

export function isAgentApiErrorBody(x: unknown): x is { error: AgentApiError } {
  return isObj(x) && hasOnlyKeys(x, ['error']) && (AGENT_API_ERRORS as readonly unknown[]).includes(x.error);
}

/** Type name -> guard; the same names as AGENT_API_GUARDS of workers/shared/src/agent-api.ts. */
export const AGENT_API_GUARDS = {
  QuoteEdits: isQuoteEdits,
  DecisionBodyDashboard: isDecisionBodyDashboard,
  DecisionBodyRelay: isDecisionBodyRelay,
  DecisionResult: isDecisionResult,
  AgentStatus: isAgentStatus,
  FlagEditBody: isFlagEditBody,
  FlagEditResult: isFlagEditResult,
  StartBody: isStartBody,
  StartResult: isStartResult,
  AgentApiErrorBody: isAgentApiErrorBody,
} as const;

export type AgentApiTypeName = keyof typeof AGENT_API_GUARDS;

// ----- Rows of the agent tables (columns the pages read) -----

export type RunStatus = 'running' | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
export type ParkReason = 'flag_off' | 'budget' | 'llm_unavailable' | 'failed';

/** agent_runs.output.card: business fields only (RFQ number, company, country, totals, flags; no e-mail text). */
export interface AgentCard {
  v: 1;
  kind: CardKind;
  run_id: string;
  title: string;
  lines: Array<{ label: string; value: string }>;
  flags: string[];
  allowed_verbs: string[];
  open_url: string;
}

/** The fields of agent_runs.output the dashboard reads; anything else is shown as compact JSON. */
export interface AgentRunOutput {
  card_kind?: CardKind;
  allowed_verbs?: string[];
  card?: AgentCard;
  telegram_message_id?: number | null;
  failed_step?: string | null;
  quote_workflow_id?: string;
  line_count?: number;
  [key: string]: unknown;
}

export interface AgentRunRow {
  id: string;
  agent: string;
  trigger?: string;
  status: RunStatus;
  parked_reason?: ParkReason | null;
  subject_type?: string | null;
  subject_id?: string | null;
  workflow_instance_id?: string | null;
  started_at?: string;
  updated_at?: string;
  finished_at?: string | null;
  cost_cents?: number | string;
  llm_calls?: number;
  error?: string | null;
  human_action?: Record<string, unknown> | null;
  output?: AgentRunOutput | null;
  approval_token_sha256?: string | null;
}

export type InboundStatus = 'received' | 'parsed' | 'needs_review' | 'rfq_created' | 'attached' | 'matched' | 'rejected' | 'duplicate' | 'spam' | 'failed';
export const INBOUND_STATUSES: readonly InboundStatus[] = ['received', 'parsed', 'needs_review', 'rfq_created', 'attached', 'matched', 'rejected', 'duplicate', 'spam', 'failed'];
/** Statuses from which the dashboard may start an intake again (POST /api/agent/start kind rfq_intake). */
export const RERUNNABLE_INBOUND: readonly InboundStatus[] = ['received', 'needs_review', 'failed'];
export type InboundMailbox = 'rfq' | 'replies' | 'gmail';
export const INBOUND_MAILBOXES: readonly InboundMailbox[] = ['rfq', 'replies', 'gmail'];
export type InboundKind = 'rfq' | 'techpilot' | 'reply' | 'auto_reply' | 'spam' | 'other';
export const INBOUND_KINDS: readonly InboundKind[] = ['rfq', 'techpilot', 'reply', 'auto_reply', 'spam', 'other'];

export interface InboundAttachment {
  n: number;
  r2_key: string;
  filename: string;
  content_type?: string;
  size_bytes?: number;
  kind?: string;
  inline?: boolean;
  flags?: string[];
}

export interface InboundAuthResults {
  trusted?: boolean;
  spf?: string;
  dkim?: string;
  dmarc?: string;
  dmarc_from_domain?: string | null;
}

export interface InboundEmailRow {
  id: string;
  received_at: string;
  mailbox: InboundMailbox;
  source?: string;
  from_name?: string | null;
  from_email?: string | null;
  subject?: string | null;
  kind?: InboundKind | null;
  status: InboundStatus;
  parse_confidence?: number | string | null;
  classification?: { process?: string; confidence?: number } | null;
  auth_results?: InboundAuthResults | null;
  attachments?: InboundAttachment[] | null;
  parsed?: Record<string, unknown> | null;
  raw_r2_key?: string | null;
  rfq_id?: string | null;
  agent_run_id?: string | null;
  error?: string | null;
}

export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  value: Record<string, unknown> | null;
  description?: string | null;
  updated_at?: string;
  updated_by?: string | null;
  rev: number;
  kv_synced_rev?: number | null;
  kv_seed_pending?: boolean;
}

/** One line of quote_workflows.pricing.lines (the deterministic calculator's output). */
export interface QuotePricingLine {
  line_no: number;
  product_name?: string;
  description?: string;
  process?: string;
  qty?: number;
  material?: { text?: string; grade?: string | null; thickness_mm?: number | null } | null;
  suggested_unit_price?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
  manual?: boolean;
  manual_reasons?: string[];
}

export interface QuotePricing {
  currency?: string;
  lines?: QuotePricingLine[];
  manual_lines?: number[];
  subtotal?: number;
  min_order_surcharge?: number | null;
  shipping?: number | null;
  total_net?: number | null;
  complete?: boolean;
  notes?: { summary?: string; suggestions?: Array<{ line_no: number; reason?: string }> } | null;
}

export interface QuoteWorkflowRow {
  id: string;
  rfq_id: string;
  quote_version: number;
  status: string;
  pricing?: QuotePricing | null;
  total_amount?: number | string | null;
  currency?: string;
  quote_pdf_r2_key?: string | null;
  drafts?: { subject?: string; body_text?: string; language?: string } | null;
  error?: string | null;
}

/** RFQs that can get a quote started from the dashboard. */
export interface RfqStartRow {
  id: string;
  rfq_number?: string | null;
  status?: string | null;
  company_name?: string | null;
  created_at?: string;
}
