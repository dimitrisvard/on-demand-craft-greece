// /api/agent/* contract (Phase 4): request bodies, results, error codes and the verb/code table of approval cards.
// The site gate (microns-site), the ops handlers (microns-ops), the Telegram relay and the dashboard
// (src/types/agent.ts mirrors these shapes; shared JSON fixtures in workers/shared/test/fixtures/agent-api/ keep the
// two in step) all code against this file.
//
// Rules
//   - Every body and result carries v: 1; a breaking change adds a new version number.
//   - The dashboard decides with run_id + token_sha256 under a staff JWT; only the relay sends a raw token, with a
//     button code. The database stores token hashes only.
//   - A verb without a Telegram code (null) is dashboard-only; codes are unique per card kind, 1-4 characters of
//     [a-z0-9], so callback_data 'ap:<26-char token>:<code>' stays within 34 bytes (Telegram allows 1-64).
//   - There is no 'edit' verb: a quote is approved with optional edits (dashboard only).
//   - The type guards check the exact shape of untrusted JSON: v === 1, no keys beyond the declared ones, the
//     declared JSON types, and the identifier formats (uuid, 64-hex hash, base32 token, code). Business limits on
//     edits (line numbers, amounts, text lengths) are checked by decide() in microns-ops, which knows the card.
//
// Fixtures (workers/shared/test/fixtures/agent-api/): '<TypeName>.<case>.json' holds one value its guard accepts,
// '<TypeName>.reject-<case>.json' one value its guard refuses. TypeName is one of the keys of AGENT_API_GUARDS.

export const AGENT_API_VERSION = 1 as const;

export type CardKind = 'intake' | 'quote' | 'reply' | 'reply_pick' | 'handoff' | 'reorder' | 'failure' | 'test';

export const CARD_KINDS: readonly CardKind[] = ['intake', 'quote', 'reply', 'reply_pick', 'handoff', 'reorder', 'failure', 'test'];

/** Path segment after /api/agent/. */
export type AgentAction = 'decision' | 'status' | 'flag' | 'start' | 'file';

export const AGENT_ACTIONS: readonly AgentAction[] = ['decision', 'status', 'flag', 'start', 'file'];

/** Verb -> Telegram code per card kind. A verb without a code is dashboard-only. */
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

/** Button labels of the verbs (Telegram and dashboard). */
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

/** Telegram callback_data of an approval button: 'ap:' + base32 token (26 chars) + ':' + code. */
export const CALLBACK_DATA_RE = /^ap:([A-Z2-7]{26}):([a-z0-9]{1,4})$/;

export const TOKEN_RE = /^[A-Z2-7]{26}$/;
export const CODE_RE = /^[a-z0-9]{1,4}$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Verb names: lower-case words joined by '_' (the keys of VERB_CODES). */
export const VERB_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** Agent flag keys that /api/agent/flag may edit. */
export const FLAG_EDIT_KEY_RE = /^(agent\.[a-z0-9_.]+|mcp\.remote)$/;

export const NOTE_MAX = 500;
export const LABEL_MAX = 200;

export interface QuoteEdits {
  overrides?: Array<{ line_no: number; unit_price: number; note?: string }>;
  shipping?: number;
  drafts?: { subject?: string; body_text?: string };
}

/** Dashboard decision (staff JWT): the page echoes agent_runs.approval_token_sha256 as read under staff RLS. */
export interface DecisionBodyDashboard {
  v: 1;
  run_id: string;
  token_sha256: string;
  verb: string;
  edits?: QuoteEdits;
  note?: string;
}

/** Relay decision (signed request of the Telegram relay): the raw token and the button code. */
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
  /** At most 200 characters, e.g. 'Approved'. */
  label: string;
}

export interface AgentStatus {
  v: 1;
  ok: true;
  actions: AgentAction[];
  principal: 'STAFF' | 'ADMIN';
}

export interface FlagEditBody {
  v: 1;
  key: string;
  /** feature_flags.rev as read (optimistic concurrency). */
  expected_rev: number;
  enabled: boolean;
  mode?: 'shadow' | 'assist' | 'auto';
  /** Only for 'mcp.remote'. */
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

/** Value of {"error": …} in every /api/agent/* error answer. */
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

/** The verb a Telegram code stands for on a card kind, or null when the code is unknown for that kind. */
export function verbForCode(kind: CardKind, code: string): string | null {
  const table = VERB_CODES[kind];
  if (!table) return null;
  for (const [verb, verbCode] of Object.entries(table)) {
    if (verbCode !== null && verbCode === code) return verb;
  }
  return null;
}

/** The Telegram code of a verb on a card kind, or null when the verb is dashboard-only or unknown. */
export function codeForVerb(kind: CardKind, verb: string): string | null {
  const table = VERB_CODES[kind];
  if (!table || !Object.prototype.hasOwnProperty.call(table, verb)) return null;
  return table[verb] ?? null;
}

/** callback_data for a button: 'ap:<token>:<code>'; throws when token or code has the wrong shape. */
export function callbackData(token: string, code: string): string {
  if (!TOKEN_RE.test(token)) throw new Error('callbackData: token must be 26 base32 characters');
  if (!CODE_RE.test(code)) throw new Error('callbackData: code must be 1-4 characters of [a-z0-9]');
  return `ap:${token}:${code}`;
}

/** Token and code of a callback_data value, or null when it is not an approval button. */
export function parseCallbackData(data: string): { token: string; code: string } | null {
  const match = CALLBACK_DATA_RE.exec(data);
  return match ? { token: match[1], code: match[2] } : null;
}

// ----- Type guards -----

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** True when every key of x is one of the allowed keys and every required key is present. */
function hasOnlyKeys(x: Obj, required: readonly string[], optional: readonly string[] = []): boolean {
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(x, key)) return false;
  for (const key of Object.keys(x)) if (!required.includes(key) && !optional.includes(key)) return false;
  return true;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isSafeInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

function optional<T>(x: Obj, key: string, check: (v: unknown) => v is T): boolean {
  return !Object.prototype.hasOwnProperty.call(x, key) || check(x[key]);
}

function isNote(x: unknown): x is string {
  return isStr(x) && x.length <= NOTE_MAX;
}

export function isQuoteEdits(x: unknown): x is QuoteEdits {
  if (!isObj(x) || !hasOnlyKeys(x, [], ['overrides', 'shipping', 'drafts'])) return false;
  if (Object.prototype.hasOwnProperty.call(x, 'overrides')) {
    const overrides = x.overrides;
    if (!Array.isArray(overrides)) return false;
    for (const o of overrides) {
      if (!isObj(o) || !hasOnlyKeys(o, ['line_no', 'unit_price'], ['note'])) return false;
      if (!isSafeInt(o.line_no) || !isFiniteNumber(o.unit_price) || !optional(o, 'note', isStr)) return false;
    }
  }
  if (!optional(x, 'shipping', isFiniteNumber)) return false;
  if (Object.prototype.hasOwnProperty.call(x, 'drafts')) {
    const drafts = x.drafts;
    if (!isObj(drafts) || !hasOnlyKeys(drafts, [], ['subject', 'body_text'])) return false;
    if (!optional(drafts, 'subject', isStr) || !optional(drafts, 'body_text', isStr)) return false;
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
    optional(x, 'mode', (m): m is FlagEditBody['mode'] => m === 'shadow' || m === 'assist' || m === 'auto') &&
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

/** {"error": <AgentApiError>} with nothing else. */
export function isAgentApiErrorBody(x: unknown): x is { error: AgentApiError } {
  return isObj(x) && hasOnlyKeys(x, ['error']) && (AGENT_API_ERRORS as readonly unknown[]).includes(x.error);
}

/** Type name -> guard, for the shared fixtures and the mirror in src/types/agent.ts. */
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
