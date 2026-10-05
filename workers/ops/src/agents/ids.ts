// Identifiers, keys and hashes of the agent layer.
//
//   message_id_sha256      lower-case hex SHA-256 of the trimmed Message-ID header (brackets and case kept);
//                          header missing -> SHA-256 of the raw MIME bytes
//   instance ids           'rfq-intake-<first 32 hex>', 'quote-<rfq_id>-v<n>', 'post-order-<order_id>'; all at most
//                          100 characters and matching ^[a-zA-Z0-9_][a-zA-Z0-9-_]*$
//   CAD job key            '<input_sha256>:<job_type>:<sha256 of the canonical JSON of params>'
//   approval token         128 random bits, RFC 4648 base32 without padding (26 characters); only its SHA-256 hex
//                          is stored
//   outbound Message-ID    '<q.<quote_workflow_id>.<k>@<domain>>', k = 0 for the quote, 1-2 for follow-ups
//   safe file name         NFC, last path segment only, control characters removed, every character outside
//                          [A-Za-z0-9._-] -> '_', at most 100 characters, extension kept; empty or dots-only -> 'file'
// Builders throw on input of the wrong shape, so a malformed id never reaches a Workflow or the database.

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Workflow instance id rule (Workflows limits). */
export const INSTANCE_ID_RE = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;
export const INSTANCE_ID_MAX = 100;
export const SAFE_NAME_MAX = 100;

function bytesOf(data: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytesOf(data));
  return toHex(new Uint8Array(digest));
}

/** message_id_sha256 of an inbound message: the trimmed Message-ID header, else the raw MIME bytes. */
export async function messageIdSha256(messageIdHeader: string | null | undefined, rawMime: ArrayBuffer | Uint8Array): Promise<string> {
  const trimmed = messageIdHeader?.trim();
  return trimmed ? sha256hex(trimmed) : sha256hex(rawMime);
}

function checkedInstanceId(id: string): string {
  if (id.length > INSTANCE_ID_MAX || !INSTANCE_ID_RE.test(id)) throw new Error('invalid workflow instance id');
  return id;
}

export function rfqIntakeInstanceId(messageIdSha256: string): string {
  if (!HEX64.test(messageIdSha256)) throw new Error('rfqIntakeInstanceId: message_id_sha256 must be 64 lower-case hex');
  return checkedInstanceId(`rfq-intake-${messageIdSha256.slice(0, 32)}`);
}

export function quoteInstanceId(rfqId: string, version: number): string {
  if (!UUID.test(rfqId)) throw new Error('quoteInstanceId: rfq_id must be a uuid');
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('quoteInstanceId: version must be an integer >= 1');
  return checkedInstanceId(`quote-${rfqId}-v${version}`);
}

export function postOrderInstanceId(orderId: string): string {
  if (!UUID.test(orderId)) throw new Error('postOrderInstanceId: order_id must be a uuid');
  return checkedInstanceId(`post-order-${orderId}`);
}

/** JSON with object keys sorted at every level (undefined members dropped, as JSON.stringify does). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export async function cadJobKey(inputSha256: string, jobType: string, params: unknown): Promise<string> {
  if (!HEX64.test(inputSha256)) throw new Error('cadJobKey: input sha256 must be 64 lower-case hex');
  if (!/^[a-z_]+$/.test(jobType)) throw new Error('cadJobKey: invalid job type');
  return `${inputSha256}:${jobType}:${await sha256hex(canonicalJson(params))}`;
}

export function safeName(name: string): string {
  const nfc = String(name).normalize('NFC');
  const lastSegment = nfc.split(/[/\\]/).pop() ?? '';
  // Control characters are removed; every other character outside the allowed set becomes '_'.
  const cleaned = lastSegment.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (cleaned.replace(/\./g, '') === '') return 'file';
  if (cleaned.length <= SAFE_NAME_MAX) return cleaned;
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(cleaned)?.[0] ?? '';
  return cleaned.slice(0, SAFE_NAME_MAX - ext.length) + ext;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding. */
export function base32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** A new single-use approval token (26 base32 characters) and the promise of its SHA-256 hex. */
export function newApprovalToken(): { token: string; sha256: Promise<string> } {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = base32(bytes);
  return { token, sha256: sha256hex(token) };
}

export function outboundMessageId(qwid: string, k: number, domain: string): string {
  if (!UUID.test(qwid)) throw new Error('outboundMessageId: quote workflow id must be a uuid');
  if (!Number.isSafeInteger(k) || k < 0) throw new Error('outboundMessageId: k must be an integer >= 0');
  if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error('outboundMessageId: invalid domain');
  return `<q.${qwid}.${k}@${domain}>`;
}

/** True for the Workflows error of a create() whose instance id exists ('instance.already_exists'). */
export function isAlreadyExists(e: unknown): boolean {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return text.includes('instance.already_exists');
}
