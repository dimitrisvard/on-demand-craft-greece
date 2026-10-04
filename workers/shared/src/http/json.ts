// Response helpers for answers produced by the Worker code itself (handler answers are never rewritten).

const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';

// Statuses whose Response must not carry a body (Fetch spec "null body status").
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function withType(headers: HeadersInit | undefined, type: string): Headers {
  const out = new Headers(headers);
  out.set('Content-Type', type);
  return out;
}

/** JSON body, Content-Type application/json; charset=utf-8. */
export function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  const text = JSON.stringify(body);
  const payload = NULL_BODY_STATUSES.has(status) || text === undefined ? null : text;
  return new Response(payload, { status, headers: withType(headers, JSON_TYPE) });
}

/** Plain-text body, Content-Type text/plain; charset=utf-8. */
export function textResponse(status: number, text: string, headers?: HeadersInit): Response {
  return new Response(NULL_BODY_STATUSES.has(status) ? null : text, { status, headers: withType(headers, TEXT_TYPE) });
}

/** JSON error body {"error": code}. */
export function apiError(status: number, code: string, headers?: HeadersInit): Response {
  return jsonResponse(status, { error: code }, headers);
}
