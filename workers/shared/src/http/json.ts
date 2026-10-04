// Response helpers for answers produced by the Worker code itself (handler answers are never rewritten).

/** JSON body, Content-Type application/json; charset=utf-8. */
export function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  throw new Error('not implemented: A');
}

/** Plain-text body, Content-Type text/plain; charset=utf-8. */
export function textResponse(status: number, text: string, headers?: HeadersInit): Response {
  throw new Error('not implemented: A');
}

/** JSON error body {"error": code}. */
export function apiError(status: number, code: string, headers?: HeadersInit): Response {
  throw new Error('not implemented: A');
}
