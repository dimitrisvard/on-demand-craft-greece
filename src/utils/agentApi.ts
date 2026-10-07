// Actions of the agent dashboard pages (Phase 4) over the site's /api/agent/* endpoint (microns-site gate, then
// microns-ops). Contract: src/types/agent.ts (mirror of workers/shared/src/agent-api.ts).
//
// Rules
//   - Every request carries the signed-in user's Supabase session (fetchWithAuth, src/utils/apiAuth.ts).
//   - The pages ship before the Cloudflare API exists (Vercel answers unknown paths with the SPA shell), so no
//     action is sent before GET /api/agent/status answered 200 JSON with a valid AgentStatus: the action methods exist
//     only on the AgentApiClient that a successful probeAgentApi() returns. Any other answer (HTML, 404, 5xx, a
//     network error) means "absent"; 401 and 403 are reported as such.
//   - Request bodies are checked against the contract before they are sent; a body that fails the check is never
//     sent. Decisions use run_id + token_sha256 as read under staff RLS (never a raw token).
//   - Answers are accepted only in the contract's shapes; errors carry the endpoint's {"error": code}.
//   - Stored files are read through GET /api/agent/file?k=<key> with the key's slashes kept literally (the
//     endpoint refuses encoded slashes); keys outside the staff preview patterns are refused here too.
import { useQuery } from '@tanstack/react-query';
import { downloadWithAuth, fetchWithAuth, openInNewWindow } from '@/utils/apiAuth';
import {
  isAgentApiErrorBody,
  isAgentStatus,
  isDecisionBodyDashboard,
  isDecisionResult,
  isFlagEditBody,
  isFlagEditResult,
  isStartBody,
  isStartResult,
  NOTE_MAX,
  type AgentApiError,
  type AgentRunRow,
  type AgentStatus,
  type DecisionBodyDashboard,
  type DecisionResult,
  type FlagEditBody,
  type FlagEditResult,
  type QuoteEdits,
  type StartBody,
  type StartResult,
} from '@/types/agent';

export const AGENT_API_BASE = '/api/agent';

/** Keys the staff preview may read (quote and traveller PDFs, CAD outputs, stored e-mails and attachments). */
export const STAFF_FILE_KEY_RE =
  /^(quotes\/[0-9a-f-]{36}\/v\d+\/quote\.pdf|orders\/[0-9a-f-]{36}\/traveler\.pdf|cad\/[0-9a-f-]{36}\/output\/[a-z_.]+|email\/[0-9a-f]{64}\/(raw\.eml|att\/[0-9]+-[A-Za-z0-9._-]{1,100}))$/;

/** Limits of approval edits (the same rules decide() applies in microns-ops). */
export const EDIT_LIMITS = Object.freeze({ priceMax: 10_000_000, noteMax: NOTE_MAX, subjectMax: 200, bodyMax: 10_000 });
const HTML_RE = /<\s*[a-zA-Z!/?]/;

export type AgentApiErrorCode = AgentApiError | 'network' | 'invalid_response' | 'invalid_body' | 'api_absent';

/** A refused or failed /api/agent/* request. */
export class AgentApiRequestError extends Error {
  constructor(
    readonly code: AgentApiErrorCode,
    readonly status: number,
  ) {
    super(`Agent API: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'AgentApiRequestError';
  }
}

export interface PreviewTarget {
  href: string;
  revoke: () => void;
}

/** The actions; obtained only from a successful probeAgentApi(). */
export interface AgentApiClient {
  readonly status: AgentStatus;
  /** True when the caller may edit agent switches (ADMIN). */
  readonly canEditFlags: boolean;
  decide(body: DecisionBodyDashboard): Promise<DecisionResult>;
  editFlag(body: FlagEditBody): Promise<FlagEditResult>;
  start(body: StartBody): Promise<StartResult>;
  /** Saves a stored file (attachment, raw e-mail, PDF) as a download. */
  downloadFile(key: string, filename: string): Promise<void>;
  /** A stored PDF as an object URL for an in-page preview (revoke it when done). */
  previewFile(key: string): Promise<PreviewTarget>;
  /** Opens a stored file in a new window (call from the click handler, before any await). */
  openFile(key: string, filename: string): Promise<boolean>;
}

export type AgentApiProbe =
  | { available: true; status: AgentStatus; client: AgentApiClient }
  | { available: false; reason: 'absent' | 'unauthorized' | 'forbidden' | 'error' };

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') || '').toLowerCase().includes('application/json');
}

/** GET /api/agent/file?k=<key>, slashes kept; throws for keys outside STAFF_FILE_KEY_RE. */
export function agentFileUrl(key: string): string {
  if (!STAFF_FILE_KEY_RE.test(key)) throw new AgentApiRequestError('invalid_body', 0);
  return `${AGENT_API_BASE}/file?k=${encodeURIComponent(key).replace(/%2F/g, '/')}`;
}

async function postJson<T>(action: 'decision' | 'flag' | 'start', body: unknown, accept: (x: unknown) => x is T): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithAuth(`${AGENT_API_BASE}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AgentApiRequestError('network', 0);
  }
  let parsed: unknown = null;
  if (isJson(res)) {
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
  }
  if (res.status === 200 && accept(parsed)) return parsed;
  if (res.status !== 200 && isAgentApiErrorBody(parsed)) throw new AgentApiRequestError(parsed.error, res.status);
  throw new AgentApiRequestError('invalid_response', res.status);
}

function createClient(status: AgentStatus): AgentApiClient {
  return {
    status,
    canEditFlags: status.principal === 'ADMIN' && status.actions.includes('flag'),
    async decide(body) {
      if (!isDecisionBodyDashboard(body)) throw new AgentApiRequestError('invalid_body', 0);
      return postJson('decision', body, isDecisionResult);
    },
    async editFlag(body) {
      if (!isFlagEditBody(body)) throw new AgentApiRequestError('invalid_body', 0);
      return postJson('flag', body, isFlagEditResult);
    },
    async start(body) {
      if (!isStartBody(body)) throw new AgentApiRequestError('invalid_body', 0);
      return postJson('start', body, isStartResult);
    },
    async downloadFile(key, filename) {
      await downloadWithAuth(agentFileUrl(key), filename);
    },
    async previewFile(key) {
      const url = agentFileUrl(key);
      const res = await fetchWithAuth(url, { cache: 'no-store' });
      if (!res.ok) throw new AgentApiRequestError('invalid_response', res.status);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      return { href, revoke: () => URL.revokeObjectURL(href) };
    },
    openFile(key, filename) {
      const url = agentFileUrl(key);
      return openInNewWindow(async () => {
        const res = await fetchWithAuth(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
        const href = URL.createObjectURL(await res.blob());
        return { href, revoke: () => URL.revokeObjectURL(href) };
      }, filename);
    },
  };
}

/** GET /api/agent/status: the client when the Worker API answers as specified, else why not. */
export async function probeAgentApi(): Promise<AgentApiProbe> {
  let res: Response;
  try {
    res = await fetchWithAuth(`${AGENT_API_BASE}/status`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    return { available: false, reason: 'error' };
  }
  if (res.status === 401) return { available: false, reason: 'unauthorized' };
  if (res.status === 403) return { available: false, reason: 'forbidden' };
  if (res.status >= 500) return { available: false, reason: 'error' };
  if (res.status !== 200 || !isJson(res)) return { available: false, reason: 'absent' };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { available: false, reason: 'absent' };
  }
  if (!isAgentStatus(body)) return { available: false, reason: 'absent' };
  return { available: true, status: body, client: createClient(body) };
}

/** The dashboard decision body for a waiting run (no edits or note unless given and non-empty). */
export function dashboardDecision(run: Pick<AgentRunRow, 'id' | 'approval_token_sha256'>, verb: string, extra: { edits?: QuoteEdits; note?: string } = {}): DecisionBodyDashboard {
  const body: DecisionBodyDashboard = { v: 1, run_id: run.id, token_sha256: run.approval_token_sha256 ?? '', verb };
  const edits = extra.edits;
  if (edits && (edits.overrides?.length || edits.shipping !== undefined || edits.drafts)) body.edits = edits;
  if (extra.note && extra.note.trim() !== '') body.note = extra.note.trim();
  return body;
}

/** The first edit that decide() would refuse, as a short reason, or null when every edit is acceptable. */
export function validateQuoteEdits(edits: QuoteEdits, lineCount: number): string | null {
  const seen = new Set<number>();
  for (const o of edits.overrides ?? []) {
    if (!Number.isInteger(o.line_no) || o.line_no < 1 || o.line_no > lineCount || seen.has(o.line_no)) return `Line ${o.line_no}: unknown line`;
    seen.add(o.line_no);
    if (!Number.isFinite(o.unit_price) || o.unit_price < 0 || o.unit_price > EDIT_LIMITS.priceMax) return `Line ${o.line_no}: price must be between 0 and 10,000,000`;
    if (o.note !== undefined && (o.note.length > EDIT_LIMITS.noteMax || HTML_RE.test(o.note))) return `Line ${o.line_no}: note must be plain text of at most 500 characters`;
  }
  if (edits.shipping !== undefined && (!Number.isFinite(edits.shipping) || edits.shipping < 0 || edits.shipping > EDIT_LIMITS.priceMax)) return 'Shipping must be between 0 and 10,000,000';
  const d = edits.drafts;
  if (d?.subject !== undefined && (d.subject.length > EDIT_LIMITS.subjectMax || HTML_RE.test(d.subject))) return 'Subject must be plain text of at most 200 characters';
  if (d?.body_text !== undefined && (d.body_text.length > EDIT_LIMITS.bodyMax || HTML_RE.test(d.body_text))) return 'Text must be plain text of at most 10,000 characters';
  return null;
}

export interface AgentErrorMessage {
  title: string;
  /** The page should reload its data (the card changed or was decided elsewhere). */
  refetch: boolean;
  /** The session expired: offer "Sign in again". */
  signIn: boolean;
}

/** The message a page shows for a failed action. */
export function describeAgentError(error: unknown): AgentErrorMessage {
  const code = error instanceof AgentApiRequestError ? error.code : 'network';
  switch (code) {
    case 'already_decided':
    case 'stale':
      return { title: 'Already decided', refetch: true, signIn: false };
    case 'verb_not_allowed':
      return { title: 'This card has changed; the list was reloaded', refetch: true, signIn: false };
    case 'not_found':
      return { title: 'Not found; it may have been decided already', refetch: true, signIn: false };
    case 'flag_off':
      return { title: 'The agent is switched off', refetch: false, signIn: false };
    case 'active_quote_exists':
      return { title: 'A quote is already running for this RFQ', refetch: true, signIn: false };
    case 'unauthorized':
      return { title: 'Your session has expired. Sign in again.', refetch: false, signIn: true };
    case 'forbidden':
      return { title: 'Not allowed for your account', refetch: false, signIn: false };
    case 'rate_limited':
      return { title: 'Too many requests; try again in a minute', refetch: false, signIn: false };
    case 'invalid_body':
    case 'bad_request':
    case 'payload_too_large':
      return { title: 'The request was refused; check the values', refetch: false, signIn: false };
    case 'network':
      return { title: 'Could not reach the server', refetch: false, signIn: false };
    default:
      return { title: 'The action failed; try again', refetch: false, signIn: false };
  }
}

/** Query key of the status probe (one probe per page load, shared by the agent pages). */
export const AGENT_API_QUERY_KEY = ['agent-api-status'] as const;

/** The status probe as a query: never retried, kept for a minute, not refetched on focus. */
export function useAgentApi() {
  return useQuery({ queryKey: AGENT_API_QUERY_KEY, queryFn: probeAgentApi, retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
}
