// One structured log line per event, starting with the Worker's prefix ('[microns-site]' or '[microns-ops]').
// Never pass tokens, cookies, signatures, Access assertions, request bodies or e-mail addresses as fields.

export function logLine(prefix: string, event: string, fields?: Record<string, string | number | boolean | undefined>): void {
  throw new Error('not implemented: A');
}
