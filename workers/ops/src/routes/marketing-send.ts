// /api/marketing?action=send-campaign in microns-ops (Phase 5, unit M5): queues one outbound-mail message per
// recipient of a campaign under the run 'marketing.send:<campaign_id>' (or a re-queue run ':r<n>'). Dispatched from
// src/routes/marketing.ts; the site gate (action MK-8) admits STAFF and ADMIN sessions only.
//
// Order (PHASE5_SPEC §5.9; binding, so that the dashboard's fallback can never cause a second send)
//   0 caller   the principal must be STAFF or ADMIN (403 {"error":"forbidden"}), the method POST (405)
//   1 body     JSON {campaign_id: <uuid>} of at most 4 KB -> else 400 {"error":"invalid_campaign"}
//   2 row      the campaign exists -> else 404 {"error":"campaign_not_found"}
//   3 sent     status 'sent' -> 409 {"error":"campaign_already_sent"}
//   4 stop     OUTBOUND_MAIL_STOPPED = "true" -> 423 {"error":"sending_stopped"}
//   5 runs     newest run of the campaign 'running' or 'succeeded' -> 202 {queued: 0, run_id} of that run
//   6 pause    OUTBOUND_MAIL_PAUSED = "true" -> 503 {"error":"sending_paused"} when the campaign has no run, 409
//              {"error":"campaign_partially_queued"} when it has a failed one (the edge function must not run then)
//   7 open     run 'marketing.send:<id>' (no run yet) or 'marketing.send:<id>:r<n>' (n = runs + 1), trigger
//              'dashboard', subject marketing_campaign/<id>; created: false -> 202 with that run, queued 0
//   8 enqueue  inside one try: recipients (src/marketing/recipients.ts; a re-queue keeps the first run's mode),
//              `expected` written to the run output before the first sendBatch: first run = the selection's size;
//              re-queue = the newest earlier run's known `expected`, or, when no earlier run knows it (every earlier
//              run failed before its selection was read), the selection's size plus the subscribers outside it that
//              already have a 'sent' or 'bounced' event of the campaign mail. A re-queue leaves out the recipients
//              with a final event and those whose unfinished 'sent' event is younger than 15 min (a message in
//              flight; src/marketing/events.ts); sendBatch of at most 100 messages; marketing_campaigns.status =
//              'sending'; 202 {queued, run_id}. Nothing to queue -> the campaign close runs at once.
//   9 failure  any error inside that try -> run closed 'failed', error 'enqueue_partial', output {expected, queued,
//              mode} with expected null while it is not known yet; 500 {"error":"enqueue_failed","queued":n}.
//              Queued messages stay valid (their limiter keys make a later duplicate a no-op); a later click
//              re-queues through step 7.
// Missing configuration (OUTBOUND_MAIL) answers 500 before a run is opened, naming the binding in the log only.
// Log lines carry ids and counts, never an address, a subject or a body.

import type { Context } from 'hono';
import { jsonResponse, textResponse } from '../../../shared/src/http/json';
import { formatLogLine } from '../../../shared/src/http/log';
import { isConfigMissing, need } from '../agents/config';
import { checkpointRun, closeRun, EMPTY_USAGE, openRun } from '../agents/runs';
import { LOG_PREFIX, type OpsEnv, type OpsHono } from '../env';
import { closeCampaignIfDone, campaignRuns, CAMPAIGN_SUBJECT, SEND_AGENT, sendRunKey, type CampaignRun } from '../marketing/campaign-close';
import { campaignOutcomeEvents, subscribersSettledOrInFlight, subscribersWithEvent } from '../marketing/events';
import type { RandomSource } from '../marketing/personalise';
import { loadCampaign, selectRecipients, type RecipientMode } from '../marketing/recipients';
import { activeSenders } from '../marketing/sender-rows';
import { makePorts, type Ports } from '../ports/index';
import type { OutboundMailV1 } from '../queues/messages';

export const MAX_BODY_BYTES = 4096;
export const SEND_BATCH_MAX = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SendCampaignDeps {
  ports?: (env: OpsEnv) => Ports;
  /** Draw of the A/B subject (default Math.random). */
  random?: RandomSource;
}

function error(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return jsonResponse(status, { error: code, ...extra });
}

/** campaign_id of the body, or null (rule 1). */
export function campaignIdOf(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BODY_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const id = (value as { campaign_id?: unknown }).campaign_id;
  return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null;
}

function modeOf(runs: readonly CampaignRun[]): RecipientMode | undefined {
  for (const run of [...runs].reverse()) {
    const mode = run.output?.mode;
    if (mode === 'csv' || mode === 'tags') return mode;
  }
  return undefined;
}

/** `expected` of the newest run that knows it (runs newest first), or null. */
function knownExpected(runs: readonly CampaignRun[]): number | null {
  for (const run of runs) {
    const v = run.output?.expected;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

function log(event: string, fields: Record<string, string | number | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, event, fields));
}

export function createSendCampaignHandler(deps: SendCampaignDeps = {}): (c: Context<OpsHono>) => Promise<Response> {
  const portsFor = deps.ports ?? ((env: OpsEnv) => makePorts(env));
  return async function handleSendCampaign(c: Context<OpsHono>): Promise<Response> {
    const call = c.var.call;
    // 0. Caller (the site gate admits STAFF and ADMIN only; checked again here).
    if (call.principal.class !== 'STAFF' && call.principal.class !== 'ADMIN') return error(403, 'forbidden');
    if (c.req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    // 1. Body.
    const campaignId = campaignIdOf(new Uint8Array(await c.req.arrayBuffer()));
    if (!campaignId) return error(400, 'invalid_campaign');
    const env = c.env;
    const ports = portsFor(env);
    const db = ports.db;
    // 2. Row; 3. sent.
    const campaign = await loadCampaign(db, campaignId);
    if (!campaign) return error(404, 'campaign_not_found');
    if (campaign.status === 'sent') return error(409, 'campaign_already_sent');
    // 4. Stop.
    if (env.OUTBOUND_MAIL_STOPPED === 'true') return error(423, 'sending_stopped');
    // 5. Runs.
    const runs = await campaignRuns(db, campaignId);
    const newest = runs[0];
    if (newest && (newest.status === 'running' || newest.status === 'succeeded')) return jsonResponse(202, { queued: 0, run_id: newest.id });
    // 6. Pause.
    if (env.OUTBOUND_MAIL_PAUSED === 'true') return runs.length === 0 ? error(503, 'sending_paused') : error(409, 'campaign_partially_queued');
    try {
      need(env, 'OUTBOUND_MAIL');
    } catch (e) {
      if (!isConfigMissing(e)) throw e;
      console.error(formatLogLine(LOG_PREFIX, `marketing send config missing: ${e.names.join(', ')}`, { campaign_id: campaignId }));
      return textResponse(500, 'Internal Server Error');
    }
    const queue = env.OUTBOUND_MAIL;
    // 7. Open the run.
    const n = runs.length + 1;
    const run = await openRun(db, { agent: SEND_AGENT, trigger: 'dashboard', idempotency_key: sendRunKey(campaignId, n), subject_type: CAMPAIGN_SUBJECT, subject_id: campaignId });
    if (!run.created) return jsonResponse(202, { queued: 0, run_id: run.run_id });
    // 8. Enqueue.
    let expected: number | null = null;
    let queued = 0;
    let mode: RecipientMode | undefined = modeOf(runs);
    try {
      const selection = await selectRecipients(db, campaign, { random: deps.random, mode });
      mode = selection.mode;
      const events = runs.length === 0 ? [] : await campaignOutcomeEvents(db, campaignId);
      if (runs.length === 0) expected = selection.recipients.length;
      else {
        const selected = new Set(selection.recipients.map((r) => r.subscriber_id.toLowerCase()));
        const outside = [...subscribersWithEvent(events)].filter((id) => !selected.has(id)).length;
        expected = knownExpected(runs) ?? selected.size + outside;
      }
      await checkpointRun(db, run.run_id, { ...EMPTY_USAGE, by_step: {} }, { output: { expected, queued: 0, mode } });
      const done = subscribersSettledOrInFlight(events, ports.clock.now().getTime());
      const rest = selection.recipients.filter((r) => !done.has(r.subscriber_id.toLowerCase()));
      const senders = await activeSenders(db, campaign.sender_account_ids ?? []);
      const messages: OutboundMailV1[] = rest.map((r, i) => ({
        v: 1,
        kind: 'campaign',
        campaign_id: campaignId,
        subscriber_id: r.subscriber_id,
        recipient_record_id: r.recipient_record_id,
        sequence: 1,
        subject: r.subject,
        preferred_account_id: senders.length > 0 ? (senders[i % senders.length] as { id: string }).id : null,
        idem: `camp:${campaignId}:${r.subscriber_id}:1`,
        run_id: run.run_id,
        deferrals: 0,
      }));
      for (let i = 0; i < messages.length; i += SEND_BATCH_MAX) {
        const chunk = messages.slice(i, i + SEND_BATCH_MAX);
        await queue.sendBatch(chunk.map((body) => ({ body })));
        queued += chunk.length;
      }
      await db.update('marketing_campaigns', { status: 'sending', updated_at: ports.clock.now().toISOString() }, { filters: [['id', 'eq', campaignId]] });
      await checkpointRun(db, run.run_id, { ...EMPTY_USAGE, by_step: {} }, { output: { expected, queued, mode } });
    } catch (e) {
      // 9. Failure.
      try {
        await closeRun(db, run.run_id, { status: 'failed', error: 'enqueue_partial', output: { expected, queued, mode } }, { ...EMPTY_USAGE, by_step: {} });
      } catch {
        console.error(formatLogLine(LOG_PREFIX, 'marketing send run close failed', { run_id: run.run_id }));
      }
      console.error(formatLogLine(LOG_PREFIX, 'marketing send enqueue failed', { campaign_id: campaignId, run_id: run.run_id, queued, error: e instanceof Error ? e.name : 'error' }));
      return error(500, 'enqueue_failed', { queued });
    }
    log('marketing send queued', { campaign_id: campaignId, run_id: run.run_id, expected, queued, mode });
    // Nothing to queue: no message will run the campaign close, so it runs here (a failure leaves the run open
    // for the next click, which answers 202 with it).
    if (queued === 0) {
      try {
        await closeCampaignIfDone(db, campaignId, ports.clock.now());
      } catch (e) {
        console.error(formatLogLine(LOG_PREFIX, 'marketing send close failed', { campaign_id: campaignId, error: e instanceof Error ? e.name : 'error' }));
      }
    }
    return jsonResponse(202, { queued, run_id: run.run_id });
  };
}

export const handleSendCampaign: (c: Context<OpsHono>) => Promise<Response> = createSendCampaignHandler();
