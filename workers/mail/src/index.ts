// microns-mail entry module: the email() handler of the Email Worker (rfq@ and replies@ rfq.micronshub.eu).
//
//   M0 check-rcpt   recipient must be in ALLOWED_RCPT, else setReject
//   M1 buffer       raw MIME read once (at most 25 MiB by the routing limit)
//   M2 hash         message_id_sha256 of the trimmed Message-ID header (of the raw bytes when it is missing)
//   M3 store-raw    R2 email/<sha>/raw.eml; bytes a row already stands for are never replaced (store.ts):
//                   other bytes under the Message-ID of an existing row -> log duplicate_mismatch, stop
//   M4 insert-row   inbound_emails (on_conflict tenant_id,message_id_sha256, ignore-duplicates); duplicate -> stop
//   M5 hand-over    OPS.startIntake (rfq) or OPS.ingestReply (replies); an RPC error is logged and ignored
//   M6 shadow-copy  forward to MAIL_COPY_TO when set
//   M7 fallback     only when M1, M3 or M4 failed: forward to MAIL_FALLBACK_TO when set, else setReject
// One log line per mail: '[microns-mail] mail <mailbox> <sha16> <outcome> <ms>', never addresses or subjects.
// Configuration is checked per mail: a missing name fails the mail into M7, never the Worker.

import type { MailIngestRpc } from '../../shared/src/agent-types';
import { missingNames } from '../../shared/src/http/env-check';
import { inboundEmailExists, insertInboundEmail, type InboundEmailInsert } from './db';
import {
  authResultsOfRaw,
  inReplyToOf,
  mailboxOf,
  messageIdSha256,
  messageIdTokens,
  parseFrom,
  sha256hex,
  subjectOf,
  trimmedMessageId,
  type Mailbox,
} from './headers';
import { handOver } from './ingest';
import { realSleep, storeRaw, type Sleep } from './store';

export interface MailEnv {
  PRIVATE_FILES: R2Bucket;                                       // microns-private (jurisdiction eu)
  OPS: Service<MailIngestRpc & Rpc.WorkerEntrypointBranded>;     // microns-ops, entrypoint MailIngest
  ALLOWED_RCPT: string;                                          // var, comma list of accepted recipients
  SUPABASE_URL: string;                                          // var
  AGENT_TENANT_ID: string;                                       // var, default tenant uuid
  SUPABASE_SERVICE_ROLE_KEY: string;                             // secret
  MAIL_COPY_TO?: string;                                         // secret (optional), verified destination
  MAIL_FALLBACK_TO?: string;                                     // secret (optional), verified destination
}

// Stable prefix for every log line of this Worker, so Workers Logs can be filtered on it. Not exported: the
// runtime accepts only classes, functions and handler objects as named exports of the entry module.
const LOG_PREFIX = '[microns-mail]';
const REQUIRED: ReadonlyArray<keyof MailEnv> = ['PRIVATE_FILES', 'OPS', 'SUPABASE_URL', 'AGENT_TENANT_ID', 'SUPABASE_SERVICE_ROLE_KEY'];
const REJECT_UNKNOWN = 'Unknown recipient';
const REJECT_TEMPORARY = 'Temporary processing error, please resend later';

/** Test seams (the runtime passes none). */
export interface MailDeps {
  fetch?: typeof fetch;
  sleep?: Sleep;
  now?: () => number;
}

function logLine(mailbox: string, sha: string, outcome: string, ms: number): void {
  console.log(`${LOG_PREFIX} mail ${mailbox} ${sha ? sha.slice(0, 16) : '-'} ${outcome} ${ms}`);
}

/** M7: forward to MAIL_FALLBACK_TO when set; if that fails too or it is unset, reject so the sender retries. */
async function fallback(message: ForwardableEmailMessage, env: MailEnv): Promise<'fallback_forwarded' | 'fallback_rejected'> {
  if (env.MAIL_FALLBACK_TO) {
    try {
      await message.forward(env.MAIL_FALLBACK_TO);
      return 'fallback_forwarded';
    } catch {
      // the reject below is the last resort
    }
  }
  message.setReject(REJECT_TEMPORARY);
  return 'fallback_rejected';
}

export async function handleEmail(message: ForwardableEmailMessage, env: MailEnv, ctx: ExecutionContext, deps: MailDeps = {}): Promise<void> {
  void ctx;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? realSleep;
  const started = now();
  const elapsed = () => now() - started;

  // M0 check-rcpt
  const mailbox: Mailbox | null = mailboxOf(message.to, env.ALLOWED_RCPT);
  if (!mailbox) {
    message.setReject(REJECT_UNKNOWN);
    logLine('-', '', 'rejected_rcpt', elapsed());
    return;
  }

  let sha = '';
  let rowId: string | null = null;
  try {
    const missing = missingNames(env, REQUIRED as string[]);
    if (missing.length) {
      console.error(`${LOG_PREFIX} mail config missing: ${missing.join(', ')}`);
      throw new Error('config missing');
    }
    // M1 buffer (single read of the raw stream)
    const raw = await new Response(message.raw).arrayBuffer();
    // M2 hash
    const messageId = trimmedMessageId(message.headers.get('message-id'));
    sha = await messageIdSha256(messageId, raw);
    const rawSha256 = messageId ? await sha256hex(raw) : sha;
    const receivedAt = new Date(now()).toISOString();
    // M3 store-raw
    const db = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
    const stored = await storeRaw(env.PRIVATE_FILES, { sha, raw, rawSha256, mailbox, receivedAt }, () => inboundEmailExists({ ...db, tenantId: env.AGENT_TENANT_ID, messageIdSha256: sha }, deps.fetch, sleep), sleep);
    if (stored.outcome === 'kept') {
      logLine(mailbox, sha, 'duplicate_mismatch', elapsed());
      return;
    }
    // M4 insert-row
    const from = parseFrom(message.headers.get('from'), message.from);
    const row: InboundEmailInsert = {
      tenant_id: env.AGENT_TENANT_ID,
      message_id: messageId ?? sha,
      message_id_sha256: sha,
      mailbox,
      source: 'email_routing',
      from_email: from.email,
      from_name: from.name,
      to_email: message.to.trim().toLowerCase(),
      subject: subjectOf(message.headers.get('subject')),
      in_reply_to: inReplyToOf(message.headers.get('in-reply-to')),
      references_ids: messageIdTokens(message.headers.get('references')),
      received_at: receivedAt,
      raw_r2_key: stored.key,
      raw_size_bytes: raw.byteLength,
      auth_results: authResultsOfRaw(raw),
      status: 'received',
    };
    const inserted = await insertInboundEmail({ ...db, row }, deps.fetch, sleep);
    if (inserted.status === 'duplicate') {
      logLine(mailbox, sha, 'duplicate', elapsed());
      return;
    }
    rowId = inserted.id;
  } catch {
    const outcome = await fallback(message, env);
    logLine(mailbox, sha, outcome, elapsed());
    return;
  }

  // M5 hand-over (never fails the handler)
  const handed = await handOver(env.OPS, mailbox, { inbound_email_id: rowId, message_id_sha256: sha, tenant_id: env.AGENT_TENANT_ID });

  // M6 shadow-copy
  let copy = '';
  if (env.MAIL_COPY_TO) {
    try {
      await message.forward(env.MAIL_COPY_TO, new Headers({ 'X-Microns-Inbound': sha.slice(0, 16) }));
      copy = '+copy';
    } catch {
      copy = '+copy_failed';
    }
  }
  logLine(mailbox, sha, `${handed}${copy}`, elapsed());
}

export default {
  email: (message, env, ctx) => handleEmail(message, env, ctx),
} satisfies ExportedHandler<MailEnv>;
