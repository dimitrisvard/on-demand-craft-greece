// Minimal PostgREST client for the gate lookups (no supabase-js in the gate path). Each answer is classified so
// that callers can tell "the database refused or found nothing" from "the database could not be asked":
//   ok           2xx, body parsed as JSON (null when empty)
//   client_error 4xx: the request was refused (no such row shape, invalid value, row-level security)
//   unavailable  network failure, timeout, 5xx or an unreadable 2xx body

export interface RestConfig {
  supabaseUrl: string;
  /** Value of the apikey header (the project key matching `bearer`'s role). */
  apiKey: string;
  /** Bearer token: the caller's own JWT, or the service key for service-role lookups. */
  bearer: string;
  fetchImpl?: typeof fetch;
  /** Whole request including the body read; default 5,000 ms. */
  timeoutMs?: number;
}

export type RestResult =
  | { kind: 'ok'; status: number; body: unknown }
  | { kind: 'client_error'; status: number }
  | { kind: 'unavailable'; reason: 'network' | 'timeout' | 'server_error'; status?: number };

export interface RestInit {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Prefer header, e.g. 'resolution=merge-duplicates'. */
  prefer?: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** PostgREST filter value: percent-encoded so that any character reaches the server as data. */
export function filterValue(value: string): string {
  return encodeURIComponent(value);
}

async function classify(response: Response): Promise<RestResult> {
  if (response.status >= 500) {
    response.body?.cancel().catch(() => {});
    return { kind: 'unavailable', reason: 'server_error', status: response.status };
  }
  if (response.status >= 400) {
    response.body?.cancel().catch(() => {});
    return { kind: 'client_error', status: response.status };
  }
  const text = await response.text();
  if (!text) return { kind: 'ok', status: response.status, body: null };
  try {
    return { kind: 'ok', status: response.status, body: JSON.parse(text) };
  } catch {
    return { kind: 'unavailable', reason: 'server_error', status: response.status };
  }
}

export async function restRequest(cfg: RestConfig, pathAndQuery: string, init: RestInit = {}): Promise<RestResult> {
  const base = cfg.supabaseUrl.replace(/\/+$/, '');
  const headers = new Headers({
    apikey: cfg.apiKey,
    authorization: `Bearer ${cfg.bearer}`,
    accept: 'application/json',
  });
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.prefer) headers.set('prefer', init.prefer);

  const doFetch = cfg.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RestResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ kind: 'unavailable', reason: 'timeout' });
    }, cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });

  const attempt = (async (): Promise<RestResult> => {
    try {
      const response = await doFetch(`${base}/rest/v1/${pathAndQuery}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      return await classify(response);
    } catch {
      return { kind: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
    }
  })();

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The rows of an ok answer (an array), or [] for any other body. */
export function rowsOf(result: RestResult): unknown[] {
  return result.kind === 'ok' && Array.isArray(result.body) ? result.body : [];
}
