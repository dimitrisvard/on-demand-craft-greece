// Telegram texts of the Xometry tick (plain text through P5Ports.telegramText, no buttons; PHASE5_SPEC D-28, X-2,
// X-3). The Python bot sends no alert; these are new, for failures only (the new-offer summary is off unless
// value.notify_new is true).
//
// Rules
//   - No text ever contains the token, the cookie, a header or a request body; error excerpts are at most 200
//     characters.
//   - Repeat rules (applied by the tick from the alert kinds recorded in earlier runs' output.alerts):
//       token_rejected   in the tick that got the 401/403; later ticks with the same fingerprint make no call. When
//                        no run of that fingerprint sent it or a reminder (the 401/403 came in shadow mode), the
//                        first later tick that may send sends it
//       token_reminder   at the 06:00 slot while the same fingerprint stays rejected
//       token_expiry     once per fingerprint, when the token decodes as a JWT that expires within
//                        value.token_reminder_hours (default 24)
//       not_configured   once per UTC day while neither XOMETRY_TOKEN nor XOMETRY_COOKIE is set
//       scan_failed:<k>  once per kind and UTC day (graphql, schema, http, timeout, network, internal)
//       offer_errors     every tick with per-offer errors
//       page_cap         once per UTC day
//       new_offers       every tick with new offers, only with value.notify_new = true

export type ScanFailureKind = 'graphql' | 'schema' | 'http' | 'timeout' | 'network' | 'internal';

export type XometryAlertKind =
  | 'token_rejected'
  | 'token_reminder'
  | 'token_expiry'
  | 'not_configured'
  | `scan_failed:${ScanFailureKind}`
  | 'offer_errors'
  | 'page_cap'
  | 'new_offers';

export interface XometryAlert {
  kind: XometryAlertKind;
  text: string;
}

/** Longest error excerpt in a text. */
export const EXCERPT_MAX = 200;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'HH:MM' (UTC). */
export function utcTime(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD HH:MM' (UTC). */
export function utcStamp(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${utcTime(d)}`;
}

const REFRESH_STEPS =
  'Refresh: log in at partner.xometry.eu → DevTools → Application → Local Storage → authToken, then `npx wrangler secret put XOMETRY_TOKEN` in workers/ops';

export const xometryAlerts = {
  tokenRejected: (status: number, at: Date): XometryAlert => ({
    kind: 'token_rejected',
    text: `Xometry partner API rejected the token (HTTP ${status}) at ${utcTime(at)} UTC. Scans are paused until XOMETRY_TOKEN changes. ${REFRESH_STEPS} (and the Supabase secret XOMETRY_PARTNER_AUTH_TOKEN if you submit counteroffers).`,
  }),
  tokenReminder: (status: number, since: Date): XometryAlert => ({
    kind: 'token_reminder',
    text: `Reminder: Xometry scans are still paused since the partner API rejected the token (HTTP ${status}) on ${utcStamp(since)} UTC. ${REFRESH_STEPS}.`,
  }),
  tokenExpiry: (exp: Date, now: Date): XometryAlert => ({
    kind: 'token_expiry',
    text: exp.getTime() > now.getTime() ? `Xometry token expires at ${utcStamp(exp)} UTC; refresh before then.` : `Xometry token expired at ${utcStamp(exp)} UTC; refresh it now.`,
  }),
  notConfigured: (): XometryAlert => ({
    kind: 'not_configured',
    text: 'Xometry scan is switched on but neither XOMETRY_TOKEN nor XOMETRY_COOKIE is set in workers/ops; scans are skipped. Set it with `npx wrangler secret put XOMETRY_TOKEN` in workers/ops.',
  }),
  scanFailed: (kind: ScanFailureKind, status: number | null, firstError: string): XometryAlert => ({
    kind: `scan_failed:${kind}`,
    text: `Xometry scan failed: ${kind} ${status ?? 'n/a'}; first error: ${firstError.slice(0, EXCERPT_MAX)}.`,
  }),
  offerErrors: (count: number, example: string): XometryAlert => ({
    kind: 'offer_errors',
    text: `Xometry scan finished with ${count} offer errors (e.g. ${example.slice(0, EXCERPT_MAX)}).`,
  }),
  pageCap: (): XometryAlert => ({ kind: 'page_cap', text: 'Xometry board exceeded 100 pages; scan truncated.' }),
  newOffers: (inserted: number, needsManual: number): XometryAlert => ({
    kind: 'new_offers',
    text: `Xometry: ${inserted} new offers (${needsManual} needs_manual) → /dashboard/xometry`,
  }),
};

/** Alert kinds an earlier run recorded as sent (output.alerts). */
export function sentAlertKinds(output: unknown): string[] {
  const alerts = (output as { alerts?: unknown } | null | undefined)?.alerts;
  return Array.isArray(alerts) ? alerts.filter((a): a is string => typeof a === 'string') : [];
}
