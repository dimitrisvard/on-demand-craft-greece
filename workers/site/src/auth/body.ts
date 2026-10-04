// Request-format rules of the gate, applied before the handler sees the request.
//   Public mail paths (/api/emails email, contact, rfq), in this order:
//     a. a non-empty body must be application/json (any parameters)            -> 415 unsupported_media_type
//     b. the body must be a JSON object whose top-level values are strings or null -> 400 invalid_field
//     c. email / customerEmail, when given, must look like an address           -> 400 invalid_email
//     d. length caps: name 200, message 5,000, any other string 500             -> 400 field_too_long
//     e. every string except email, customerEmail and action is HTML-escaped and the body re-serialised
//   Inventory paths (/api/notifications inv-*): a non-empty body must be application/json (415), and the tenant
//   fields tenantId / tenant_id are removed from the query and the top level of the body, so the handler always
//   works on its default tenant.
// Query helpers keep every other parameter byte for byte.

import { apiError } from '../../../shared/src/http/json';
import type { ResolvedApi } from '../api/resolve';

export type BodyRuleResult =
  | { ok: true; functionUrl?: string; body?: Uint8Array }
  | { ok: false; response: Response };

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const ADDRESS_FIELDS = new Set(['email', 'customerEmail']);
const UNESCAPED_FIELDS = new Set(['email', 'customerEmail', 'action']);
const FIELD_CAPS: Readonly<Record<string, number>> = { name: 200, message: 5_000 };
const DEFAULT_CAP = 500;
const TENANT_FIELDS = ['tenantId', 'tenant_id'];

/** True for application/json with any parameters. */
export function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function unsupported(): BodyRuleResult {
  return { ok: false, response: apiError(415, 'unsupported_media_type') };
}

/** Rules a-e for the public mail paths. */
export function mailBodyRules(r: ResolvedApi, contentType: string | null): BodyRuleResult {
  if (r.bodyBytes.length === 0) return { ok: true };
  if (!isJsonMediaType(contentType)) return unsupported();
  if (!r.body.ok || !isPlainObject(r.body.value)) return { ok: false, response: apiError(400, 'invalid_field') };
  const fields = r.body.value;
  for (const value of Object.values(fields)) {
    if (value !== null && typeof value !== 'string') return { ok: false, response: apiError(400, 'invalid_field') };
  }
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') continue;
    if (ADDRESS_FIELDS.has(key) && value !== '' && !EMAIL_RE.test(value)) {
      return { ok: false, response: apiError(400, 'invalid_email') };
    }
    const cap = Object.prototype.hasOwnProperty.call(FIELD_CAPS, key) ? FIELD_CAPS[key] : DEFAULT_CAP;
    if (value.length > cap) return { ok: false, response: apiError(400, 'field_too_long') };
  }
  let changed = false;
  // Object.fromEntries defines own properties, so a "__proto__" key stays an ordinary field.
  const escaped = Object.fromEntries(Object.entries(fields).map(([key, value]) => {
    if (typeof value !== 'string' || UNESCAPED_FIELDS.has(key)) return [key, value];
    const next = escapeHtml(value);
    if (next !== value) changed = true;
    return [key, next];
  }));
  return changed ? { ok: true, body: encodeJson(escaped) } : { ok: true };
}

/** Inventory paths: JSON-only body, tenant fields removed from query and body. */
export function inventoryRequestRules(r: ResolvedApi, contentType: string | null): BodyRuleResult {
  const out: { ok: true; functionUrl?: string; body?: Uint8Array } = { ok: true };
  if (r.bodyBytes.length > 0) {
    if (!isJsonMediaType(contentType)) return unsupported();
    const value = r.body.ok ? r.body.value : undefined;
    if (isPlainObject(value) && TENANT_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(value, f))) {
      const kept = Object.fromEntries(Object.entries(value).filter(([key]) => !TENANT_FIELDS.includes(key)));
      out.body = encodeJson(kept);
    }
  }
  const stripped = removeQueryParams(r.functionUrl, TENANT_FIELDS);
  if (stripped !== r.functionUrl) out.functionUrl = stripped;
  return out;
}

// ----- Query helpers (keys decoded as URLSearchParams decodes them, so they match req.query) -----

function splitUrl(functionUrl: string): { path: string; segments: string[] } {
  const q = functionUrl.indexOf('?');
  if (q < 0) return { path: functionUrl, segments: [] };
  return { path: functionUrl.slice(0, q), segments: functionUrl.slice(q + 1).split('&') };
}

function keyOf(segment: string): string {
  const params = new URLSearchParams(segment);
  for (const key of params.keys()) return key;
  return '';
}

function joinUrl(path: string, segments: string[]): string {
  const kept = segments.filter((s) => s !== '');
  return kept.length ? `${path}?${kept.join('&')}` : path;
}

/** Removes every occurrence of the named parameters; other parameters keep their exact bytes and order. */
export function removeQueryParams(functionUrl: string, names: readonly string[]): string {
  const { path, segments } = splitUrl(functionUrl);
  if (segments.length === 0) return functionUrl;
  const kept = segments.filter((segment) => !names.includes(keyOf(segment)));
  return kept.length === segments.length ? functionUrl : joinUrl(path, kept);
}

/** Replaces every occurrence of `name` by one `name=<encodedValue>` at the first occurrence's position. */
export function replaceQueryParam(functionUrl: string, name: string, encodedValue: string): string {
  const { path, segments } = splitUrl(functionUrl);
  const out: string[] = [];
  let placed = false;
  for (const segment of segments) {
    if (keyOf(segment) !== name) {
      out.push(segment);
    } else if (!placed) {
      out.push(`${encodeURIComponent(name)}=${encodedValue}`);
      placed = true;
    }
  }
  if (!placed) out.push(`${encodeURIComponent(name)}=${encodedValue}`);
  return joinUrl(path, out);
}
