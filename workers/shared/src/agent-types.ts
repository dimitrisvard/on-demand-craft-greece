// Cross-Worker types of the agent layer (Phase 4): the canonical flag keys and the RPC contract between
// microns-mail and microns-ops (service binding OPS, named entrypoint MailIngest).
//
// Rules
//   - FlagKey lists exactly the 13 canonical flag keys (docs/migration/CANON.md §7); the feature_flags seed rows of
//     the agent-layer migration use the same keys.
//   - MailIngest has exactly the two methods of MailIngestRpc and holds no principal: the mail Worker can start an
//     intake run or queue a reply, nothing else. Every call carries version 1 and ids only (no address, subject or
//     body); ops reads the inbound_emails row itself.
//   - A breaking change of an input adds a new version number, and ops accepts both versions for one release.

/** The 13 canonical flag keys (KV FLAGS mirror of public.feature_flags). */
export type FlagKey =
  | 'seo.strict_404'
  | 'api.forward_to_vercel'
  | 'agent.rfq_intake'
  | 'agent.quote'
  | 'agent.post_order'
  | 'agent.growth.reddit'
  | 'agent.growth.hn'
  | 'agent.growth.tenders'
  | 'agent.growth.scrapers'
  | 'agent.growth.xometry'
  | 'agent.content_daily'
  | 'agent.ops_digest'
  | 'mcp.remote';

/** microns-mail -> MailIngest.startIntake: a stored inbound_emails row of the rfq mailbox. */
export interface StartIntakeInput {
  v: 1;
  /** inbound_emails.id (uuid). */
  inbound_email_id: string;
  /** Lower-case hex SHA-256 of the trimmed Message-ID header (of the raw MIME when the header is missing). */
  message_id_sha256: string;
  /** Tenant of the row (uuid). */
  tenant_id: string;
}

/** microns-mail (replies mailbox) or the Gmail poller -> MailIngest.ingestReply. */
export interface IngestReplyInput {
  v: 1;
  inbound_email_id: string;
  message_id_sha256: string;
  tenant_id: string;
  mailbox: 'replies' | 'gmail';
}

export type StartIntakeResult =
  | { status: 'started' | 'exists'; instance_id: string }
  /** The row stays 'received'; the 10-minute dispatcher retries once the flag is on. */
  | { status: 'flag_off' }
  | { status: 'rejected'; reason: 'bad_input' };

export type IngestReplyResult = { status: 'queued' } | { status: 'rejected'; reason: 'bad_input' };

/** The only RPC surface microns-mail reaches in microns-ops. */
export interface MailIngestRpc {
  startIntake(i: StartIntakeInput): Promise<StartIntakeResult>;
  ingestReply(i: IngestReplyInput): Promise<IngestReplyResult>;
}
