// Operator alerts of the CAD path (Phase 5, unit D5): one plain-text Telegram line through P5Ports.telegramText when
// an unfold service refuses the shared key or has none configured (CadOutcome.alert, src/cad/backends/http-unfold.ts).
// Used by the cad-jobs consumer and by the CAD compat route.
//
// Rules
//   - At most one line per alert kind and backend per isolate and ALERT_EVERY_MS, so a burst of jobs sends one line.
//   - The texts name the backend, the HTTP status and the variable to check; never a key, an address, an input URL
//     or an answer text. Plain text, no parse mode (D-28).
//   - Never throws (a failed send is reported as false).

import type { TelegramTextPort } from '../ports/p5';
import type { CadAlert } from '../cad/types';

/** Shortest time between two alerts of one kind and backend in one isolate. */
export const ALERT_EVERY_MS = 60 * 60_000;

/** Plain-text alert lines. */
export const CAD_ALERT_TEXTS: Readonly<Record<CadAlert, (backend: string) => string>> = Object.freeze({
  key_mismatch: (backend: string) =>
    `CAD key mismatch: the ${backend} unfold service refused the shared key (HTTP 401). CAD calls to it fail until CAD_SHARED_SECRET matches the service key.`,
  key_not_configured: (backend: string) =>
    `CAD key not configured: the ${backend} unfold service has no shared key (HTTP 503). CAD calls to it fail until CAD_SHARED_SECRET is set in microns-ops.`,
});

const lastAlertAt = new Map<string, number>();

/** Sends the alert line unless the same kind for the same backend was sent within ALERT_EVERY_MS. */
export async function sendCadAlert(telegram: () => TelegramTextPort, alert: CadAlert, backend: string, nowMs: number): Promise<boolean> {
  const key = `${alert}:${backend}`;
  const last = lastAlertAt.get(key);
  if (last !== undefined && nowMs - last < ALERT_EVERY_MS) return false;
  lastAlertAt.set(key, nowMs);
  try {
    const sent = await telegram().send(CAD_ALERT_TEXTS[alert](backend));
    return sent.ok;
  } catch {
    return false;
  }
}

/** Test hook: forgets the alert times of this isolate. */
export function resetCadAlerts(): void {
  lastAlertAt.clear();
}
