// decide(): the one decision path for approval and failure cards, used by POST /api/agent/decision (dashboard and
// Telegram relay) and by the MCP tool decide_approval.
//
//   1 Hash    token -> SHA-256 hex (telegram only); token_sha256 is accepted only from 'dashboard' and 'mcp'
//   2 Load    agent_runs?approval_token_sha256=eq.<h>&status=eq.waiting_human; none -> already_decided;
//             run_id given and different -> not_found
//   3 Verb    telegram: verb from VERB_CODES[output.card_kind] by code; every channel: verb in output.allowed_verbs,
//             else verb_not_allowed; edits only with card kind 'quote', verb 'approve', channel 'dashboard'
//   4 Claim   rpc/agent_run_claim_approval(h, {channel, actor, verb, note?}); no row -> already_decided
//   5 Act     Workflow event, terminate (reject), restart from the failed step (retry on a failure card) or dismiss
//   6 Card    the Telegram card is edited for every channel ("<label> by <actor> at <time>", buttons removed)
// HTTP mapping: 200 DecisionResult; 400 bad_request; 404 not_found; 409 already_decided; 422 verb_not_allowed.
// Never logs tokens, hashes, edits or addresses; logs run_id, verb, outcome and channel.
//
// Step 5 in detail
//   failure + retry     restart the instance from output.failed_step ('restarted'); a restart that throws closes the
//                       run 'failed' with error 'restart_failed' ('dismissed')
//   failure + dismiss   close 'failed' keeping the stored error ('dismissed')
//   test + dismiss      close 'succeeded' ('dismissed')
//   intake + not_rfq    inbound_emails row 'rejected', instance terminated, run closed 'cancelled' ('terminated')
//   quote + reject      quote_workflows row 'rejected', instance terminated, run closed 'cancelled' ('terminated')
//   other verbs         Workflow run: the card kind's event (DECISION_EVENTS) with a DecisionEventPayload
//                       ('event_sent'); a run without a Workflow instance (cards of queue consumers): an
//                       agent-events message {type: 'decision'} for the consumer that owns the card ('event_sent');
//                       'dismiss' on such a run closes it 'cancelled' ('dismissed')
// Edits (dashboard, quote approve): line numbers 1..output.line_count (1..1,000 when the card does not say), unique;
// prices and shipping 0..10,000,000; notes <= 500 chars; draft subject <= 200 and body <= 10,000 chars; no HTML.

import {
  CARD_KINDS,
  CODE_RE,
  NOTE_MAX,
  SHA256_HEX_RE,
  TOKEN_RE,
  VERB_RE,
  isQuoteEdits,
  verbForCode,
  type CardKind,
  type DecisionOutcome,
  type DecisionResult,
  type QuoteEdits,
} from '../../../shared/src/agent-api';
import { formatLogLine } from '../../../shared/src/http/log';
import { findWaitingRunByTokenHash, type WaitingRun } from '../db/repos/agent-runs';
import { LOG_PREFIX, type OpsEnv } from '../env';
import type { AgentEventV1 } from '../queues/messages';
import type { Ports } from '../ports/index';
import { decidedCard, type CardV1 } from './cards/index';
import { sha256hex } from './ids';
import { closeRun, usageFromRow } from './runs';

export interface DecideInput {
  channel: 'dashboard' | 'telegram' | 'mcp';
  /** 'user:<uuid>' or 'telegram:<from.id>'. */
  actor: string;
  run_id?: string;
  /** Exactly one of token / token_sha256. */
  token?: string;
  token_sha256?: string;
  /** telegram: code; dashboard and mcp: verb. */
  verb?: string;
  code?: string;
  edits?: QuoteEdits;
  note?: string;
}

export type DecideError = 'bad_request' | 'not_found' | 'already_decided' | 'verb_not_allowed';

/** Workflow event sent for a decided card kind. */
export const DECISION_EVENTS: Readonly<Partial<Record<CardKind, string>>> = Object.freeze({
  intake: 'intake-confirmed',
  quote: 'quote-approved',
  reply: 'reply-confirmed',
  reply_pick: 'reply-confirmed',
  handoff: 'handoff-approved',
  reorder: 'reorder-approved',
});

/** Payload of every decision event (quote approvals also carry the edits). */
export interface DecisionEventPayload {
  verb: string;
  actor: string;
  channel: DecideInput['channel'];
  note?: string;
  /** reply_pick attach_<n>: the 1-based index into output.candidates. */
  candidate?: number;
  overrides?: QuoteEdits['overrides'];
  shipping?: number;
  drafts?: QuoteEdits['drafts'];
}

/** Text of a decision on the card and in DecisionResult.label (at most 200 characters). */
export const DECISION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  confirm_sheet_metal: 'Confirmed: sheet metal',
  confirm_cnc: 'Confirmed: CNC',
  confirm_mixed: 'Confirmed: mixed',
  not_rfq: 'Marked not an RFQ',
  approve: 'Approved',
  reject: 'Rejected',
  won: 'Marked won',
  lost: 'Marked lost',
  counter: 'Marked counter-offer',
  ignore: 'Ignored',
  attach_1: 'Attached to candidate 1',
  attach_2: 'Attached to candidate 2',
  attach_3: 'Attached to candidate 3',
  new_rfq: 'New RFQ',
  send_partner: 'Sent to partner',
  hold: 'On hold',
  change_partner: 'Partner change requested',
  approve_draft: 'Draft approved',
  dismiss: 'Dismissed',
  retry: 'Retrying',
});

const ACTOR_RE = /^(user:[0-9a-f-]{36}|telegram:-?[0-9]{1,20})$/;
const PRICE_MAX = 10_000_000;
const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;
const DEFAULT_LINE_MAX = 1000;
const HTML_RE = /<\s*[a-zA-Z!/?]/;

type Decided = { ok: true; result: DecisionResult } | { ok: false; error: DecideError };

function fail(error: DecideError): Decided {
  return { ok: false, error };
}

function inputProblem(i: DecideInput): boolean {
  if (!ACTOR_RE.test(i.actor ?? '')) return true;
  if (i.run_id !== undefined && !/^[0-9a-f-]{36}$/.test(i.run_id)) return true;
  if (i.note !== undefined && (typeof i.note !== 'string' || i.note.length > NOTE_MAX || HTML_RE.test(i.note))) return true;
  if ((i.token === undefined) === (i.token_sha256 === undefined)) return true;
  if (i.channel === 'telegram') {
    return !TOKEN_RE.test(i.token ?? '') || !CODE_RE.test(i.code ?? '') || i.verb !== undefined || i.edits !== undefined;
  }
  if (i.channel === 'dashboard' || i.channel === 'mcp') {
    return !SHA256_HEX_RE.test(i.token_sha256 ?? '') || !VERB_RE.test(i.verb ?? '') || i.code !== undefined;
  }
  return true;
}

/** Edits within the limits of the card (see the header). */
export function editsProblem(edits: QuoteEdits, lineCount: number | null): string | null {
  if (!isQuoteEdits(edits)) return 'shape';
  const maxLine = lineCount ?? DEFAULT_LINE_MAX;
  const seen = new Set<number>();
  for (const o of edits.overrides ?? []) {
    if (o.line_no < 1 || o.line_no > maxLine || seen.has(o.line_no)) return 'line_no';
    seen.add(o.line_no);
    if (o.unit_price < 0 || o.unit_price > PRICE_MAX) return 'unit_price';
    if (o.note !== undefined && (o.note.length > NOTE_MAX || HTML_RE.test(o.note))) return 'note';
  }
  if (edits.shipping !== undefined && (edits.shipping < 0 || edits.shipping > PRICE_MAX)) return 'shipping';
  const d = edits.drafts;
  if (d?.subject !== undefined && (d.subject.length > SUBJECT_MAX || HTML_RE.test(d.subject))) return 'subject';
  if (d?.body_text !== undefined && (d.body_text.length > BODY_MAX || HTML_RE.test(d.body_text))) return 'body_text';
  return null;
}

/** The Workflow binding of a run (by instance id prefix). */
function workflowOf(env: OpsEnv, instanceId: string): Workflow | undefined {
  if (instanceId.startsWith('rfq-intake-')) return env.RFQ_INTAKE as Workflow | undefined;
  if (instanceId.startsWith('quote-')) return env.QUOTE as Workflow | undefined;
  if (instanceId.startsWith('post-order-')) return env.POST_ORDER as Workflow | undefined;
  return undefined;
}

async function instanceOf(env: OpsEnv, instanceId: string): Promise<WorkflowInstance> {
  const workflow = workflowOf(env, instanceId);
  if (!workflow) throw new Error('workflow binding missing for the run');
  return workflow.get(instanceId);
}

function cardKindOf(output: Record<string, unknown>): CardKind | null {
  const kind = output.card_kind;
  return typeof kind === 'string' && (CARD_KINDS as readonly string[]).includes(kind) ? (kind as CardKind) : null;
}

function allowedVerbsOf(output: Record<string, unknown>): string[] {
  return Array.isArray(output.allowed_verbs) ? output.allowed_verbs.filter((v): v is string => typeof v === 'string') : [];
}

function label(verb: string): string {
  return (DECISION_LABELS[verb] ?? verb).slice(0, 200);
}

async function rejectBusinessRow(ports: Ports, run: WaitingRun, kind: CardKind): Promise<void> {
  if (kind === 'intake') {
    const filter = run.subject_type === 'inbound_email' && run.subject_id ? (['id', 'eq', run.subject_id] as const) : (['agent_run_id', 'eq', run.id] as const);
    await ports.db.update('inbound_emails', { status: 'rejected' }, { filters: [filter] });
  } else if (kind === 'quote' && run.workflow_instance_id) {
    await ports.db.update('quote_workflows', { status: 'rejected', last_event_at: ports.clock.now().toISOString() }, { filters: [['workflow_instance_id', 'eq', run.workflow_instance_id]] });
  }
}

/** Steps 5 (act) for a claimed run; returns the outcome. */
async function act(env: OpsEnv, ports: Ports, run: WaitingRun, kind: CardKind, verb: string, i: DecideInput, output: Record<string, unknown>): Promise<DecisionOutcome> {
  const acc = usageFromRow(run);
  const instanceId = run.workflow_instance_id;

  if (kind === 'failure') {
    if (verb === 'retry') {
      const failedStep = typeof output.failed_step === 'string' ? output.failed_step : null;
      try {
        if (!instanceId || !failedStep) throw new Error('nothing to restart');
        const instance = await instanceOf(env, instanceId);
        await instance.restart({ from: { name: failedStep } });
        return 'restarted';
      } catch {
        await closeRun(ports.db, run.id, { status: 'failed', error: 'restart_failed' }, acc);
        return 'dismissed';
      }
    }
    await closeRun(ports.db, run.id, { status: 'failed' }, acc);
    return 'dismissed';
  }

  if (kind === 'test') {
    await closeRun(ports.db, run.id, { status: 'succeeded' }, acc);
    return 'dismissed';
  }

  if ((kind === 'intake' && verb === 'not_rfq') || (kind === 'quote' && verb === 'reject')) {
    await rejectBusinessRow(ports, run, kind);
    if (instanceId) {
      try {
        await (await instanceOf(env, instanceId)).terminate();
      } catch {
        console.error(formatLogLine(LOG_PREFIX, 'terminate failed', { run_id: run.id }));
      }
    }
    await closeRun(ports.db, run.id, { status: 'cancelled' }, acc);
    return 'terminated';
  }

  const payload: DecisionEventPayload = { verb, actor: i.actor, channel: i.channel };
  if (i.note) payload.note = i.note;
  const attach = /^attach_([1-3])$/.exec(verb);
  if (attach) payload.candidate = Number(attach[1]);
  if (i.edits) {
    if (i.edits.overrides) payload.overrides = i.edits.overrides;
    if (i.edits.shipping !== undefined) payload.shipping = i.edits.shipping;
    if (i.edits.drafts) payload.drafts = i.edits.drafts;
  }

  if (instanceId) {
    const type = DECISION_EVENTS[kind];
    if (!type) throw new Error(`no decision event for card kind ${kind}`);
    await (await instanceOf(env, instanceId)).sendEvent({ type, payload });
    return 'event_sent';
  }

  if (verb === 'dismiss') {
    await closeRun(ports.db, run.id, { status: 'cancelled' }, acc);
    return 'dismissed';
  }
  if (!env.AGENT_EVENTS) throw new Error('AGENT_EVENTS binding missing for a consumer card');
  const message: AgentEventV1 = { v: 1, type: 'decision', run_id: run.id, card_kind: kind, verb, actor: i.actor, channel: i.channel };
  if (payload.note) message.note = payload.note;
  if (payload.candidate !== undefined) message.candidate = payload.candidate;
  await env.AGENT_EVENTS.send(message, { contentType: 'json' });
  return 'event_sent';
}

export async function decide(env: OpsEnv, ports: Ports, i: DecideInput): Promise<Decided> {
  // 1 Hash (and input shape)
  if (!i || inputProblem(i)) return fail('bad_request');
  const tokenHash = i.channel === 'telegram' ? await sha256hex(i.token as string) : (i.token_sha256 as string);

  // 2 Load
  const run = await findWaitingRunByTokenHash(ports.db, tokenHash);
  if (!run) return fail('already_decided');
  if (i.run_id !== undefined && i.run_id !== run.id) return fail('not_found');
  const output = run.output && typeof run.output === 'object' ? run.output : {};
  const kind = cardKindOf(output);
  if (!kind) return fail('verb_not_allowed');

  // 3 Verb
  const verb = i.channel === 'telegram' ? verbForCode(kind, i.code as string) : (i.verb as string);
  if (!verb || !allowedVerbsOf(output).includes(verb)) return fail('verb_not_allowed');
  if (i.edits !== undefined) {
    if (kind !== 'quote' || verb !== 'approve' || i.channel !== 'dashboard') return fail('bad_request');
    const lineCount = typeof output.line_count === 'number' && Number.isSafeInteger(output.line_count) && output.line_count > 0 ? output.line_count : null;
    if (editsProblem(i.edits, lineCount)) return fail('bad_request');
  }

  // 4 Claim
  const humanAction: Record<string, unknown> = { channel: i.channel, actor: i.actor, verb };
  if (i.note) humanAction.note = i.note;
  const claimed = await ports.db.rpc<unknown>('agent_run_claim_approval', { p_token_sha256: tokenHash, p_human_action: humanAction });
  const claimedRows = Array.isArray(claimed) ? claimed : claimed ? [claimed] : [];
  if (claimedRows.length === 0) return fail('already_decided');

  // 5 Act
  const outcome = await act(env, ports, run, kind, verb, i, output);
  const text = outcome === 'dismissed' && verb === 'retry' ? 'Retry not possible; closed' : label(verb);

  // 6 Card
  const messageId = output.telegram_message_id;
  const card = output.card as CardV1 | undefined;
  if (typeof messageId === 'number' && card && typeof card === 'object') {
    try {
      await ports.telegram.editCard(messageId, decidedCard(card, { label: text, actor: i.actor, at: ports.clock.now() }));
    } catch {
      console.error(formatLogLine(LOG_PREFIX, 'card edit failed', { run_id: run.id }));
    }
  }

  console.log(formatLogLine(LOG_PREFIX, 'decision', { run_id: run.id, kind, verb, outcome, channel: i.channel }));
  return { ok: true, result: { v: 1, ok: true, run_id: run.id, verb, outcome, label: text } };
}

/** HTTP status of a decide() error. */
export const DECIDE_STATUS: Readonly<Record<DecideError, number>> = Object.freeze({
  bad_request: 400,
  not_found: 404,
  already_decided: 409,
  verb_not_allowed: 422,
});
