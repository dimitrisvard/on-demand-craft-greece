// Telegram approval buttons of the agent layer (Phase 4): the relay from a Telegram callback query to
// POST /api/agent/decision on the site (microns-site), which checks the signature and passes the decision to
// microns-ops. Contract: workers/shared/src/agent-api.ts (DecisionBodyRelay, CALLBACK_DATA_RE);
// docs/migration/specs/PHASE4_SPEC.md §4.4, §4.14.
//
// Rules
//   1. Webhook secret: once TELEGRAM_WEBHOOK_SECRET is set, every update needs the header
//      X-Telegram-Bot-Api-Secret-Token with exactly that value (constant-time comparison), else the update is
//      answered 401 and not processed. While it is unset, text commands run unchanged and callback queries are
//      ignored (answered 200 without any action): approvals need the secret.
//   2. Origin: a callback is accepted only when its message's chat and its sender are both the owner chat
//      (TELEGRAM_CHAT_ID); anything else is answered "Not allowed" and stops.
//   3. Data: callback_data must be 'ap:<26-char base32 token>:<code of 1-4 [a-z0-9]>', else "Unknown button". The
//      relay never interprets the code: microns-ops maps it to a verb with the card kind of the run.
//   4. Request: body JSON {"v":1,"token","code","tg":{"user_id","chat_id","message_id"}} (that key order);
//      headers X-Microns-Timestamp (unix seconds) and X-Microns-Signature = hex HMAC-SHA256(AGENT_APPROVAL_SECRET,
//      timestamp + "." + body); POST to AGENT_DECISION_URL with Content-Type application/json and an 8 s timeout.
//   5. Answer: exactly one answerCallbackQuery per callback, text at most 200 characters: 200 with a JSON body in
//      the DecisionResult shape (v 1, ok true, run_id a UUID, verb, a known outcome, label of at most 200
//      characters, no other keys; the same rules as isDecisionResult of workers/shared/src/agent-api.ts) -> its
//      label ("Done" when the label is blank); 409 -> "Already decided"; 422 -> "Not possible for this card";
//      401/403 -> "Relay not authorised"; a 200 with any other body (an HTML page, other JSON), any other answer,
//      a timeout, a network error or missing relay configuration -> "Could not record the decision. Use the
//      dashboard." as an alert.
//   6. The card itself is edited by microns-ops for every channel; the relay never edits it.
//   7. The webhook is always answered 200 after a callback (a failed decision must not make Telegram redeliver
//      the update; tokens are single use).
//   8. Log lines name the step and the HTTP status only; never the bot token, a URL that contains it, a token,
//      a signature, an update body or a decision body.

export const WEBHOOK_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';
export const TIMESTAMP_HEADER = 'X-Microns-Timestamp';
export const SIGNATURE_HEADER = 'X-Microns-Signature';
export const CALLBACK_DATA_RE = /^ap:([A-Z2-7]{26}):([a-z0-9]{1,4})$/;
export const DECISION_TIMEOUT_MS = 8_000;
export const ANSWER_MAX_CHARS = 200;
export const TELEGRAM_API_BASE = 'https://api.telegram.org';
/** The DecisionResult rules (copy of workers/shared/src/agent-api.ts; tests/edge checks both agree). */
export const DECISION_OUTCOMES = ['event_sent', 'terminated', 'restarted', 'dismissed'] as const;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const VERB_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const LABEL_MAX = 200;

export const ANSWERS = {
  notAllowed: 'Not allowed',
  unknownButton: 'Unknown button',
  alreadyDecided: 'Already decided',
  notPossible: 'Not possible for this card',
  notAuthorised: 'Relay not authorised',
  failed: 'Could not record the decision. Use the dashboard.',
  done: 'Done',
} as const;

const LOG_PREFIX = '[telegram-leads-bot]';

/** The parts of a Telegram CallbackQuery the relay reads. */
export interface CallbackQuery {
  id?: unknown;
  from?: { id?: unknown } | null;
  message?: { message_id?: unknown; chat?: { id?: unknown } | null } | null;
  data?: unknown;
}

export interface AgentCallbackDeps {
  /** TELEGRAM_WEBHOOK_SECRET (undefined or empty: callbacks are ignored). */
  webhookSecret: string | undefined;
  /** AGENT_APPROVAL_SECRET (signs the decision request). */
  approvalSecret: string | undefined;
  /** AGENT_DECISION_URL, e.g. https://www.micronshub.eu/api/agent/decision. */
  decisionUrl: string | undefined;
  /** TELEGRAM_BOT_TOKEN (answerCallbackQuery). */
  botToken: string | undefined;
  /** TELEGRAM_CHAT_ID: the owner chat, the only one whose buttons count. */
  ownerChatId: string | undefined;
  fetch: typeof fetch;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Bot API origin (tests point it at a recorder). */
  telegramApiBase?: string;
  /** Decision request timeout in ms (default DECISION_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Sink of the failure lines of rule 8 (default console.error). */
  log?: (line: string) => void;
}

export type CallbackOutcome =
  | 'ignored'
  | 'not_allowed'
  | 'unknown_button'
  | 'decided'
  | 'already_decided'
  | 'not_possible'
  | 'not_authorised'
  | 'failed';

const encoder = new TextEncoder();

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

/** Equality of two strings in time that depends only on their lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Rule 1 for one incoming request: true when the update may be processed (no secret configured, or the header
 * carries exactly the configured secret).
 */
export function checkWebhookSecret(req: Request, secret: string | undefined): boolean {
  if (!present(secret)) return true;
  const sent = req.headers.get(WEBHOOK_SECRET_HEADER);
  return sent !== null && constantTimeEqual(sent, secret);
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** hex HMAC-SHA256(secret, timestamp + "." + body): the X-Microns-Signature value. */
export async function signDecision(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return toHex(new Uint8Array(mac));
}

/** The decision request body (rule 4; key order fixed so the signature is reproducible). */
export function decisionBody(token: string, code: string, tg: { user_id: number; chat_id: number; message_id: number }): string {
  return JSON.stringify({ v: 1, token, code, tg: { user_id: tg.user_id, chat_id: tg.chat_id, message_id: tg.message_id } });
}

function safeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/** The decision endpoint's 200 body (rule 5); the shape of DecisionResult in workers/shared/src/agent-api.ts. */
export interface DecisionResult {
  v: 1;
  ok: true;
  run_id: string;
  verb: string;
  outcome: (typeof DECISION_OUTCOMES)[number];
  label: string;
}

const RESULT_KEYS = ['v', 'ok', 'run_id', 'verb', 'outcome', 'label'];

/** True when x is a DecisionResult: exactly its six keys, each with the value rules of rule 5. */
export function isDecisionResult(x: unknown): x is DecisionResult {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== RESULT_KEYS.length || !RESULT_KEYS.every((k) => Object.prototype.hasOwnProperty.call(o, k))) return false;
  return (
    o.v === 1 &&
    o.ok === true &&
    typeof o.run_id === 'string' &&
    UUID_RE.test(o.run_id) &&
    typeof o.verb === 'string' &&
    VERB_RE.test(o.verb) &&
    (DECISION_OUTCOMES as readonly unknown[]).includes(o.outcome) &&
    typeof o.label === 'string' &&
    o.label.length <= LABEL_MAX
  );
}

/**
 * The answer text for an answer of the decision endpoint (rule 5), with show_alert for failures. A 200 counts as
 * decided only with a DecisionResult body (`result`); a 200 without one is a failure.
 */
export function answerFor(status: number, result?: DecisionResult | null): { text: string; alert: boolean; outcome: CallbackOutcome } {
  if (status === 200) {
    if (!result) return { text: ANSWERS.failed, alert: true, outcome: 'failed' };
    const text = result.label.trim() !== '' ? result.label : ANSWERS.done;
    return { text: text.slice(0, ANSWER_MAX_CHARS), alert: false, outcome: 'decided' };
  }
  if (status === 409) return { text: ANSWERS.alreadyDecided, alert: false, outcome: 'already_decided' };
  if (status === 422) return { text: ANSWERS.notPossible, alert: false, outcome: 'not_possible' };
  if (status === 401 || status === 403) return { text: ANSWERS.notAuthorised, alert: true, outcome: 'not_authorised' };
  return { text: ANSWERS.failed, alert: true, outcome: 'failed' };
}

async function answerCallback(deps: AgentCallbackDeps, callbackId: string, text: string, alert: boolean): Promise<void> {
  const log = deps.log ?? ((line: string) => console.error(line));
  if (!present(deps.botToken)) {
    log(`${LOG_PREFIX} agent callback answer skipped: TELEGRAM_BOT_TOKEN is not set`);
    return;
  }
  const base = (deps.telegramApiBase ?? TELEGRAM_API_BASE).replace(/\/+$/, '');
  const payload: Record<string, unknown> = { callback_query_id: callbackId, text: text.slice(0, ANSWER_MAX_CHARS) };
  if (alert) payload.show_alert = true;
  try {
    const res = await deps.fetch(`${base}/bot${deps.botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) log(`${LOG_PREFIX} agent callback answer failed: HTTP ${res.status}`);
    await res.body?.cancel();
  } catch {
    log(`${LOG_PREFIX} agent callback answer failed: network error`);
  }
}

/**
 * Sends the signed decision; the HTTP status, and for a 200 the DecisionResult of its body (null when the body is
 * not one); status 0 on timeout or network error.
 */
async function postDecision(deps: AgentCallbackDeps, url: string, secret: string, body: string): Promise<{ status: number; result?: DecisionResult | null }> {
  const timestamp = String(Math.floor(deps.now() / 1000));
  const signature = await signDecision(secret, timestamp, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DECISION_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature },
      body,
      signal: controller.signal,
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      return { status: res.status };
    }
    try {
      const parsed: unknown = JSON.parse(await res.text());
      return { status: 200, result: isDecisionResult(parsed) ? parsed : null };
    } catch {
      return { status: 200, result: null };
    }
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handles one callback query (rules 1-6). Returns the outcome for tests; the caller answers the webhook 200 in
 * every case (rule 7).
 */
export async function handleAgentCallback(query: CallbackQuery, deps: AgentCallbackDeps): Promise<CallbackOutcome> {
  const log = deps.log ?? ((line: string) => console.error(line));
  // Rule 1: without the webhook secret the approval path is closed.
  if (!present(deps.webhookSecret)) return 'ignored';
  const callbackId = typeof query?.id === 'string' && query.id !== '' ? query.id : null;
  if (callbackId === null) return 'ignored';

  // Rule 2.
  const chatId = safeInt(query.message?.chat?.id);
  const userId = safeInt(query.from?.id);
  const messageId = safeInt(query.message?.message_id);
  const owner = present(deps.ownerChatId) ? deps.ownerChatId.trim() : '';
  if (owner === '' || chatId === null || userId === null || messageId === null || String(chatId) !== owner || String(userId) !== owner) {
    await answerCallback(deps, callbackId, ANSWERS.notAllowed, false);
    return 'not_allowed';
  }

  // Rule 3.
  const match = typeof query.data === 'string' ? CALLBACK_DATA_RE.exec(query.data) : null;
  if (!match) {
    await answerCallback(deps, callbackId, ANSWERS.unknownButton, false);
    return 'unknown_button';
  }

  // Rule 4.
  if (!present(deps.approvalSecret) || !present(deps.decisionUrl)) {
    const missing = [present(deps.approvalSecret) ? null : 'AGENT_APPROVAL_SECRET', present(deps.decisionUrl) ? null : 'AGENT_DECISION_URL'].filter(Boolean);
    log(`${LOG_PREFIX} agent callback config missing: ${missing.join(', ')}`);
    await answerCallback(deps, callbackId, ANSWERS.failed, true);
    return 'failed';
  }
  const body = decisionBody(match[1], match[2], { user_id: userId, chat_id: chatId, message_id: messageId });
  const result = await postDecision(deps, deps.decisionUrl, deps.approvalSecret, body);

  // Rule 5.
  const answer = answerFor(result.status, result.result);
  if (answer.outcome === 'not_authorised' || answer.outcome === 'failed') {
    const reason = result.status === 0 ? 'timeout or network error' : result.status === 200 ? 'unexpected answer' : `HTTP ${result.status}`;
    log(`${LOG_PREFIX} agent decision refused: ${reason}`);
  }
  await answerCallback(deps, callbackId, answer.text, answer.alert);
  return answer.outcome;
}
