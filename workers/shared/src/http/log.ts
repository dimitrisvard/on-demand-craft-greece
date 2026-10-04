// One structured log line per event, starting with the Worker's prefix ('[microns-site]' or '[microns-ops]').
// Never pass tokens, cookies, signatures, Access assertions, request bodies or e-mail addresses as fields.
//
// Format: `<prefix> <event> key=value key=value`. Fields whose value is undefined are left out. A string value
// that is empty or contains whitespace, a quote, '=' or a control character is written as a JSON string, so a
// value can never start a new line or forge another field. Line breaks in the event text become spaces.

type FieldValue = string | number | boolean | undefined;

const BARE_VALUE = /^[^\s"=\\\u0000-\u001f\u007f]+$/;

function formatValue(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  return BARE_VALUE.test(value) ? value : JSON.stringify(value);
}

export function formatLogLine(prefix: string, event: string, fields?: Record<string, FieldValue>): string {
  let line = `${prefix} ${event.replace(/[\r\n]+/g, ' ')}`;
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      line += ` ${key}=${formatValue(value)}`;
    }
  }
  return line;
}

export function logLine(prefix: string, event: string, fields?: Record<string, FieldValue>): void {
  console.log(formatLogLine(prefix, event, fields));
}
