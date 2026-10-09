// Campaign send from the dashboard (Phase 5): the Worker route POST /api/marketing?action=send-campaign first, and
// the edge function send-campaign (today's path) only when the answer proves that the route is absent or deliberately
// paused, so a campaign is never sent twice.
//
// Rules
//   - The route is called through fetchWithAuth (the session's bearer token) with JSON {campaign_id} and a 30 s
//     timeout.
//   - Fallback to supabase.functions.invoke('send-campaign', {body: {campaign_id}}) on exactly two answers:
//       400 whose JSON error starts with "Invalid action" (Vercel's api/marketing.js, or a Worker without the route)
//       503 {"error":"sending_paused"} (the operator's rollback switch; answered before anything is queued)
//     An error of the edge function is thrown as EdgeSendError (the caller shows today's error toast).
//   - Every other answer never falls back: 202 -> path 'queue'; 409 campaign_already_sent -> already_sent; 423
//     sending_stopped -> stopped; 401 and 403 -> forbidden; 404 -> not_found; anything else (409
//     campaign_partially_queued, 500 enqueue_failed, 429, other statuses, a body that is not JSON, a timeout, a
//     network error) -> unknown, because the route may already have queued mail.
//   - No new dependency; no address or body is logged.
import { supabase } from '@/integrations/supabase/client';
import { fetchWithAuth } from '@/utils/apiAuth';

export const CAMPAIGN_SEND_URL = '/api/marketing?action=send-campaign';
export const CAMPAIGN_SEND_TIMEOUT_MS = 30_000;

export type CampaignSendResult =
  | { path: 'queue'; queued: number; run_id: string }
  | { path: 'edge'; data: unknown }
  | { path: 'none'; reason: 'already_sent' | 'not_found' | 'forbidden' | 'stopped' | 'unknown'; status: number | null };

/** An error answered by the edge function on the fallback path (today's failure). */
export class EdgeSendError extends Error {
  readonly edgeError: unknown;
  constructor(edgeError: unknown) {
    super('send-campaign edge function failed');
    this.name = 'EdgeSendError';
    this.edgeError = edgeError;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await res.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** True for the two answers after which the edge function may run (see the rules above). */
export function isFallbackAnswer(status: number, body: Record<string, unknown> | null): boolean {
  const error = body?.error;
  if (typeof error !== 'string') return false;
  if (status === 400) return error.startsWith('Invalid action');
  if (status === 503) return error === 'sending_paused';
  return false;
}

async function viaEdgeFunction(campaignId: string): Promise<CampaignSendResult> {
  const { data, error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: campaignId } });
  if (error) throw new EdgeSendError(error);
  return { path: 'edge', data };
}

function none(reason: Extract<CampaignSendResult, { path: 'none' }>['reason'], status: number | null): CampaignSendResult {
  return { path: 'none', reason, status };
}

export async function startCampaignSend(campaignId: string): Promise<CampaignSendResult> {
  let res: Response;
  try {
    res = await fetchWithAuth(CAMPAIGN_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId }),
      signal: AbortSignal.timeout(CAMPAIGN_SEND_TIMEOUT_MS),
    });
  } catch {
    return none('unknown', null);
  }
  const body = await readJson(res);
  if (isFallbackAnswer(res.status, body)) return viaEdgeFunction(campaignId);
  if (res.status === 202 && body && typeof body.queued === 'number' && typeof body.run_id === 'string') {
    return { path: 'queue', queued: body.queued, run_id: body.run_id };
  }
  if (res.status === 409 && body?.error === 'campaign_already_sent') return none('already_sent', 409);
  if (res.status === 423 && body?.error === 'sending_stopped') return none('stopped', 423);
  if (res.status === 401 || res.status === 403) return none('forbidden', res.status);
  if (res.status === 404) return none('not_found', 404);
  return none('unknown', res.status);
}

export interface CampaignSendMessage {
  kind: 'success' | 'error';
  text: string;
}

export const UNKNOWN_SEND_STATUS = 'Sending status unknown: check the campaign before trying again';

/** The toast of a send result; `where` keeps each screen's own success texts. */
export function campaignSendMessage(result: CampaignSendResult, where: 'wizard' | 'table'): CampaignSendMessage {
  if (result.path === 'edge') return { kind: 'success', text: where === 'wizard' ? 'Campaign sent successfully!' : 'Campaign sending started!' };
  if (result.path === 'queue') {
    if (result.queued === 0) return { kind: 'success', text: 'Sending already in progress' };
    return { kind: 'success', text: where === 'wizard' ? `Campaign queued: ${result.queued} recipients` : 'Campaign sending started!' };
  }
  switch (result.reason) {
    case 'already_sent':
      return { kind: 'error', text: 'Campaign was already sent' };
    case 'stopped':
      return { kind: 'error', text: 'Sending is stopped by the operator' };
    case 'forbidden':
      return { kind: 'error', text: 'You are not allowed to send this campaign' };
    case 'not_found':
      return { kind: 'error', text: 'Campaign not found' };
    default:
      return { kind: 'error', text: UNKNOWN_SEND_STATUS };
  }
}
