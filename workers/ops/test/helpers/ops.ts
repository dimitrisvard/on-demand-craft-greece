// Test helpers for microns-ops: an OpsEnv with dummy values, a recording queue binding, an ExecutionContext that
// collects waitUntil promises, OpsCall builders and a direct OpsApi.handle invocation (as the site's RPC does).

import type { OpsCall, Principal } from '../../../shared/src/http/rpc';
import type { OpsEnv } from '../../src/env';
import type { ScrapeMessage } from '../../src/queues/messages';

export interface RecordingQueue {
  binding: Queue<ScrapeMessage>;
  sent: Array<{ body: ScrapeMessage; options?: QueueSendOptions }>;
  /** When set, send() rejects with this error. */
  failWith?: Error;
}

export function recordingQueue(): RecordingQueue {
  const queue: RecordingQueue = {
    sent: [],
    binding: {
      async send(body: ScrapeMessage, options?: QueueSendOptions) {
        if (queue.failWith) throw queue.failWith;
        queue.sent.push({ body: structuredClone(body), options });
        return {} as QueueSendResponse;
      },
      async sendBatch() {
        throw new Error('sendBatch is not used by microns-ops');
      },
      async metrics() {
        return { backlogCount: 0, backlogBytes: 0 };
      },
    } as unknown as Queue<ScrapeMessage>,
  };
  return queue;
}

export const SUPABASE_URL = 'https://project.supabase.test';

export function opsEnv(overrides: Partial<OpsEnv> = {}): OpsEnv {
  return {
    SUPABASE_URL,
    SITE_ORIGIN: 'https://www.micronshub.eu',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-value',
    SUPABASE_ANON_KEY: 'anon-test-value',
    RESEND_API_KEY: 'resend-test-value',
    RESEND_WEBHOOK_SECRET: 'webhook-test-value',
    TELEGRAM_BOT_TOKEN: 'telegram-test-value',
    TELEGRAM_CHAT_ID: 'chat-test-value',
    GOOGLE_CLIENT_ID: 'client-id.apps.example',
    GOOGLE_CLIENT_SECRET: 'google-test-value',
    GOOGLE_REDIRECT_URI: 'https://www.micronshub.eu/api/marketing?action=google-auth&step=callback',
    APOLLO_API_KEY: 'apollo-test-value',
    SCRAPES: recordingQueue().binding,
    ...overrides,
  };
}

export interface TestContext extends ExecutionContext {
  pending: Promise<unknown>[];
}

export function testContext(): TestContext {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as TestContext;
}

export const STAFF: Principal = { class: 'STAFF', uid: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', roles: ['sales_rep'] };
export const COLLECTOR: Principal = { class: 'MACHINE', machine: 'collector' };
export const MCP: Principal = { class: 'MACHINE', machine: 'mcp' };

export function opsCall(partial: Partial<OpsCall> & Pick<OpsCall, 'endpoint' | 'functionUrl'>): OpsCall {
  return { v: 1, requestId: 'req-test-1', action: 'post', principal: STAFF, ...partial };
}

interface OpsApiLike {
  handle(request: Request, call: OpsCall): Promise<Response>;
}

type OpsApiClass = new (ctx: ExecutionContext, env: OpsEnv) => OpsApiLike;

/** Calls OpsApi.handle as the site's service binding does; the request URL is built as the site builds it. */
export function invoke(
  OpsApi: OpsApiClass,
  call: OpsCall,
  init: RequestInit & { env?: OpsEnv; ctx?: ExecutionContext; origin?: string } = {},
): Promise<Response> {
  const { env, ctx, origin, ...requestInit } = init;
  const request = new Request(new URL(call.functionUrl, origin ?? 'https://www.micronshub.eu'), requestInit);
  return new OpsApi(ctx ?? testContext(), env ?? opsEnv()).handle(request, call);
}

export function jsonPost(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

/** Status, the headers as a plain object and the body text of a response. */
export async function snapshot(response: Response): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { status: response.status, headers, body: await response.text() };
}
