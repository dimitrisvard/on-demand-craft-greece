// Phase 5 (unit M5): src/utils/campaignSend.ts, the dashboard's campaign send (PHASE5_SPEC §9). Every row of the
// answer table: the route's 202, the two fallback answers (Vercel's or a Phase 2 Worker's 400 "Invalid action…",
// and 503 sending_paused) after which — and only after which — the edge function is invoked exactly as today, and
// every other answer (423, 409, 500, 401, 403, 404, 429, other statuses, a non-JSON body, a timeout, a network
// error) that never falls back. Also the request (URL, method, JSON body, bearer token, 30 s timeout) and the toast
// texts of both screens.
import * as clientModule from '@/integrations/supabase/client';
import { supabaseMock } from './mocks/supabase-client';
import { jsonResponse, stubFetch, type RecordedCall } from './helpers';
import {
  CAMPAIGN_SEND_TIMEOUT_MS,
  CAMPAIGN_SEND_URL,
  EdgeSendError,
  UNKNOWN_SEND_STATUS,
  campaignSendMessage,
  isFallbackAnswer,
  startCampaignSend,
  type CampaignSendResult,
} from '@/utils/campaignSend';

const CAMPAIGN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const VERCEL_400 = { error: 'Invalid action. Use: track, webhook, google-auth, apollo-enrich' };

let log: string[];
let invoke: ReturnType<typeof vi.fn>;

function installInvoke(answer: { data?: unknown; error?: unknown } | Error = { data: { message: 'Campaign processing complete', sent: 2, errors: 0 }, error: null }) {
  invoke = vi.fn(async (name: string, options: unknown) => {
    log.push(`invoke ${name} ${JSON.stringify(options)}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  (clientModule.supabase as unknown as { functions: unknown }).functions = { invoke };
}

function route(answer: (call: RecordedCall) => Response | Promise<Response>) {
  return stubFetch(answer, log);
}

beforeEach(() => {
  supabaseMock.reset();
  supabaseMock.accessToken = ['session', 'token', 'value'].join('-');
  log = [];
  installInvoke();
});

describe('the request', () => {
  it('POST /api/marketing?action=send-campaign with JSON {campaign_id}, the bearer token and a 30 s timeout signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { calls, fn } = route(() => jsonResponse(202, { queued: 2, run_id: 'r1' }));
    await startCampaignSend(CAMPAIGN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CAMPAIGN_SEND_URL);
    expect(CAMPAIGN_SEND_URL).toBe('/api/marketing?action=send-campaign');
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ campaign_id: CAMPAIGN });
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer session-token-value');
    expect(timeout).toHaveBeenCalledWith(CAMPAIGN_SEND_TIMEOUT_MS);
    expect(CAMPAIGN_SEND_TIMEOUT_MS).toBe(30_000);
    expect((fn.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('answers that fall back to the edge function (invoked only after the route answered)', () => {
  const fallbacks: Array<[string, () => Response]> = [
    ['Vercel / Worker without the route: 400 Invalid action', () => jsonResponse(400, VERCEL_400)],
    ['paused (rollback switch): 503 sending_paused', () => jsonResponse(503, { error: 'sending_paused' })],
  ];
  for (const [name, answer] of fallbacks) {
    it(name, async () => {
      route(answer);
      const result = await startCampaignSend(CAMPAIGN);
      expect(result).toEqual({ path: 'edge', data: { message: 'Campaign processing complete', sent: 2, errors: 0 } });
      expect(log).toEqual([`fetch ${CAMPAIGN_SEND_URL}`, `invoke send-campaign ${JSON.stringify({ body: { campaign_id: CAMPAIGN } })}`]);
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  }

  it('an error of the edge function is thrown as EdgeSendError (today\'s error toast); a thrown invoke propagates', async () => {
    installInvoke({ data: null, error: { message: 'FunctionsHttpError' } });
    route(() => jsonResponse(400, VERCEL_400));
    const failed = await startCampaignSend(CAMPAIGN).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(EdgeSendError);
    expect((failed as EdgeSendError).edgeError).toEqual({ message: 'FunctionsHttpError' });
    installInvoke(new Error('network down'));
    await expect(startCampaignSend(CAMPAIGN)).rejects.toThrow('network down');
  });
});

describe('answers that never fall back', () => {
  const rows: Array<[string, () => Response | Promise<Response>, CampaignSendResult]> = [
    ['202 queued', () => jsonResponse(202, { queued: 12, run_id: 'run-1' }), { path: 'queue', queued: 12, run_id: 'run-1' }],
    ['202 queued 0 (already in progress)', () => jsonResponse(202, { queued: 0, run_id: 'run-1' }), { path: 'queue', queued: 0, run_id: 'run-1' }],
    ['423 sending_stopped', () => jsonResponse(423, { error: 'sending_stopped' }), { path: 'none', reason: 'stopped', status: 423 }],
    ['409 campaign_already_sent', () => jsonResponse(409, { error: 'campaign_already_sent' }), { path: 'none', reason: 'already_sent', status: 409 }],
    ['409 campaign_partially_queued', () => jsonResponse(409, { error: 'campaign_partially_queued' }), { path: 'none', reason: 'unknown', status: 409 }],
    ['500 enqueue_failed', () => jsonResponse(500, { error: 'enqueue_failed', queued: 3 }), { path: 'none', reason: 'unknown', status: 500 }],
    ['401 unauthorized', () => jsonResponse(401, { error: 'unauthorized' }), { path: 'none', reason: 'forbidden', status: 401 }],
    ['403 forbidden', () => jsonResponse(403, { error: 'forbidden' }), { path: 'none', reason: 'forbidden', status: 403 }],
    ['404 campaign_not_found', () => jsonResponse(404, { error: 'campaign_not_found' }), { path: 'none', reason: 'not_found', status: 404 }],
    ['429 rate_limited', () => jsonResponse(429, { error: 'rate_limited' }, { 'Retry-After': '60' }), { path: 'none', reason: 'unknown', status: 429 }],
    ['400 invalid_campaign', () => jsonResponse(400, { error: 'invalid_campaign' }), { path: 'none', reason: 'unknown', status: 400 }],
    ['400 without JSON', () => new Response('Invalid action', { status: 400 }), { path: 'none', reason: 'unknown', status: 400 }],
    ['400 error not a string', () => jsonResponse(400, { error: ['Invalid action'] }), { path: 'none', reason: 'unknown', status: 400 }],
    ['503 other error', () => jsonResponse(503, { error: 'auth_unavailable' }), { path: 'none', reason: 'unknown', status: 503 }],
    ['503 HTML', () => new Response('<html>busy</html>', { status: 503, headers: { 'content-type': 'text/html' } }), { path: 'none', reason: 'unknown', status: 503 }],
    ['500 text/plain', () => new Response('Internal Server Error', { status: 500 }), { path: 'none', reason: 'unknown', status: 500 }],
    ['502 upstream', () => jsonResponse(502, { error: 'upstream' }), { path: 'none', reason: 'unknown', status: 502 }],
    ['200 unexpected', () => jsonResponse(200, { ok: true }), { path: 'none', reason: 'unknown', status: 200 }],
    ['202 without a run id', () => jsonResponse(202, { queued: 1 }), { path: 'none', reason: 'unknown', status: 202 }],
    ['network error', () => Promise.reject(new TypeError('Failed to fetch')), { path: 'none', reason: 'unknown', status: null }],
    ['timeout', () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')), { path: 'none', reason: 'unknown', status: null }],
  ];
  for (const [name, answer, expected] of rows) {
    it(name, async () => {
      route(answer);
      expect(await startCampaignSend(CAMPAIGN)).toEqual(expected);
      expect(invoke).not.toHaveBeenCalled();
      expect(log).toEqual([`fetch ${CAMPAIGN_SEND_URL}`]);
    });
  }

  it('isFallbackAnswer: exactly the two fallback answers', () => {
    expect(isFallbackAnswer(400, VERCEL_400)).toBe(true);
    expect(isFallbackAnswer(400, { error: 'Invalid action' })).toBe(true);
    expect(isFallbackAnswer(503, { error: 'sending_paused' })).toBe(true);
    expect(isFallbackAnswer(400, { error: 'invalid action' })).toBe(false);
    expect(isFallbackAnswer(400, { error: 'invalid_campaign' })).toBe(false);
    expect(isFallbackAnswer(503, { error: 'sending_stopped' })).toBe(false);
    expect(isFallbackAnswer(423, { error: 'sending_stopped' })).toBe(false);
    expect(isFallbackAnswer(409, { error: 'campaign_partially_queued' })).toBe(false);
    expect(isFallbackAnswer(500, { error: 'Invalid action' })).toBe(false);
    expect(isFallbackAnswer(400, null)).toBe(false);
  });
});

describe('toast texts', () => {
  it('wizard and table texts per result', () => {
    const edge: CampaignSendResult = { path: 'edge', data: {} };
    const queued: CampaignSendResult = { path: 'queue', queued: 7, run_id: 'r' };
    const busy: CampaignSendResult = { path: 'queue', queued: 0, run_id: 'r' };
    expect(campaignSendMessage(edge, 'wizard')).toEqual({ kind: 'success', text: 'Campaign sent successfully!' });
    expect(campaignSendMessage(edge, 'table')).toEqual({ kind: 'success', text: 'Campaign sending started!' });
    expect(campaignSendMessage(queued, 'wizard')).toEqual({ kind: 'success', text: 'Campaign queued: 7 recipients' });
    expect(campaignSendMessage(queued, 'table')).toEqual({ kind: 'success', text: 'Campaign sending started!' });
    expect(campaignSendMessage(busy, 'wizard')).toEqual({ kind: 'success', text: 'Sending already in progress' });
    expect(campaignSendMessage({ path: 'none', reason: 'already_sent', status: 409 }, 'table')).toEqual({ kind: 'error', text: 'Campaign was already sent' });
    expect(campaignSendMessage({ path: 'none', reason: 'stopped', status: 423 }, 'wizard')).toEqual({ kind: 'error', text: 'Sending is stopped by the operator' });
    expect(campaignSendMessage({ path: 'none', reason: 'unknown', status: 500 }, 'wizard')).toEqual({ kind: 'error', text: UNKNOWN_SEND_STATUS });
    expect(UNKNOWN_SEND_STATUS).toBe('Sending status unknown: check the campaign before trying again');
    expect(campaignSendMessage({ path: 'none', reason: 'not_found', status: 404 }, 'table').kind).toBe('error');
    expect(campaignSendMessage({ path: 'none', reason: 'forbidden', status: 403 }, 'table').kind).toBe('error');
  });
});
