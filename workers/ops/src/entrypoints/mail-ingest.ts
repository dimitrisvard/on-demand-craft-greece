// MailIngest: the named entrypoint microns-mail reaches over its service binding OPS. Exactly two methods, no
// principal: start an intake run for a stored rfq mail, or queue a reply. Inputs are validated (v === 1, UUID and
// 64-hex shapes) and the inbound_emails row is read here; no field beyond the ids is trusted.
//
// Rules
//   - startIntake: the row must exist with the same message_id_sha256 and tenant and mailbox 'rfq'. Flag
//     agent.rfq_intake off -> {status: 'flag_off'} and the row stays 'received' (the 10-minute dispatcher starts it
//     once the flag is on). Otherwise RFQ_INTAKE.create with id 'rfq-intake-<32 hex>' and params of ids only;
//     "already exists" -> {status: 'exists'}.
//   - ingestReply: the row must exist with the same sha, tenant and mailbox ('replies' or 'gmail'); one
//     agent-events message {type: 'inbound-reply'} -> {status: 'queued'} (the consumer checks agent.quote).
//   - Anything else answers {status: 'rejected', reason: 'bad_input'}. A missing binding or a database error is
//     thrown: microns-mail logs it and the dispatcher retries rows left 'received'.
//   - Log lines carry the first 16 hex of the sha and the outcome, never an address or a subject.
// startIntakeFor() and ingestReplyFor() are the same logic for in-process callers (the dispatcher).

import { WorkerEntrypoint } from 'cloudflare:workers';
import type {
  IngestReplyInput,
  IngestReplyResult,
  MailIngestRpc,
  StartIntakeInput,
  StartIntakeResult,
} from '../../../shared/src/agent-types';
import { formatLogLine } from '../../../shared/src/http/log';
import { need } from '../agents/config';
import { readFlag } from '../agents/flags';
import { isAlreadyExists, rfqIntakeInstanceId } from '../agents/ids';
import { PostgrestDb, type Db } from '../db/postgrest';
import { getInboundEmail, type InboundMailbox } from '../db/repos/inbound-emails';
import { LOG_PREFIX, type OpsEnv } from '../env';
import type { AgentEventV1 } from '../queues/messages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const REJECTED = Object.freeze({ status: 'rejected', reason: 'bad_input' } as const);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** v === 1 with the three id fields in their shapes (extra fields are ignored). */
export function isStartIntakeInput(x: unknown): x is StartIntakeInput {
  return (
    isRecord(x) &&
    x.v === 1 &&
    typeof x.inbound_email_id === 'string' &&
    UUID.test(x.inbound_email_id) &&
    typeof x.message_id_sha256 === 'string' &&
    HEX64.test(x.message_id_sha256) &&
    typeof x.tenant_id === 'string' &&
    UUID.test(x.tenant_id)
  );
}

export function isIngestReplyInput(x: unknown): x is IngestReplyInput {
  if (!isStartIntakeInput(x)) return false;
  const mailbox = (x as unknown as Record<string, unknown>).mailbox;
  return mailbox === 'replies' || mailbox === 'gmail';
}

export interface MailIngestDeps {
  db?: Db;
  /** Mailboxes whose rows may start an intake (the RPC: 'rfq' only). */
  mailboxes?: readonly InboundMailbox[];
}

function dbOf(env: OpsEnv, deps: MailIngestDeps): Db {
  return deps.db ?? new PostgrestDb({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
}

function log(event: string, sha: string, outcome: string): void {
  console.log(formatLogLine(LOG_PREFIX, event, { sha: sha.slice(0, 16), outcome }));
}

/** startIntake logic (also called in process by the dispatcher). */
export async function startIntakeFor(env: OpsEnv, input: unknown, deps: MailIngestDeps = {}): Promise<StartIntakeResult> {
  if (!isStartIntakeInput(input)) return REJECTED;
  const { inbound_email_id, message_id_sha256, tenant_id } = input;
  const row = await getInboundEmail(dbOf(env, deps), inbound_email_id);
  const mailboxes = deps.mailboxes ?? ['rfq'];
  if (!row || row.message_id_sha256 !== message_id_sha256 || row.tenant_id !== tenant_id || !mailboxes.includes(row.mailbox)) {
    log('mail ingest start', message_id_sha256, 'rejected');
    return REJECTED;
  }
  const flag = await readFlag(env, 'agent.rfq_intake', tenant_id);
  if (!flag.enabled) {
    log('mail ingest start', message_id_sha256, 'flag_off');
    return { status: 'flag_off' };
  }
  need(env, 'RFQ_INTAKE');
  const instance_id = rfqIntakeInstanceId(message_id_sha256);
  try {
    await env.RFQ_INTAKE.create({ id: instance_id, params: { v: 1, inbound_email_id, message_id_sha256, tenant_id } });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    log('mail ingest start', message_id_sha256, 'exists');
    return { status: 'exists', instance_id };
  }
  log('mail ingest start', message_id_sha256, 'started');
  return { status: 'started', instance_id };
}

/** ingestReply logic. */
export async function ingestReplyFor(env: OpsEnv, input: unknown, deps: MailIngestDeps = {}): Promise<IngestReplyResult> {
  if (!isIngestReplyInput(input)) return REJECTED;
  const { inbound_email_id, message_id_sha256, tenant_id, mailbox } = input;
  const row = await getInboundEmail(dbOf(env, deps), inbound_email_id);
  if (!row || row.message_id_sha256 !== message_id_sha256 || row.tenant_id !== tenant_id || row.mailbox !== mailbox) {
    log('mail ingest reply', message_id_sha256, 'rejected');
    return REJECTED;
  }
  need(env, 'AGENT_EVENTS');
  const message: AgentEventV1 = { v: 1, type: 'inbound-reply', inbound_email_id, tenant_id };
  await env.AGENT_EVENTS.send(message, { contentType: 'json' });
  log('mail ingest reply', message_id_sha256, 'queued');
  return { status: 'queued' };
}

export class MailIngest extends WorkerEntrypoint<OpsEnv> implements MailIngestRpc {
  async startIntake(i: StartIntakeInput): Promise<StartIntakeResult> {
    return startIntakeFor(this.env, i);
  }

  async ingestReply(i: IngestReplyInput): Promise<IngestReplyResult> {
    return ingestReplyFor(this.env, i);
  }
}
