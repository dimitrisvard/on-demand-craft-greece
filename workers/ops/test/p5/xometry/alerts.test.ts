// Telegram texts of the Xometry tick (plain text, no buttons): exact bytes, the 200-character excerpt rule and the
// reading of earlier runs' alert kinds.

import { describe, expect, it } from 'vitest';
import { EXCERPT_MAX, sentAlertKinds, utcStamp, utcTime, xometryAlerts } from '../../../src/xometry/alerts';

const NOW = new Date(Date.UTC(2026, 9, 8, 9, 5));

describe('xometryAlerts', () => {
  it('expiry: a future exp asks for a refresh before then, a past exp says it expired', () => {
    expect(xometryAlerts.tokenExpiry(new Date(Date.UTC(2026, 9, 8, 21, 30)), NOW).text).toBe('Xometry token expires at 2026-10-08 21:30 UTC; refresh before then.');
    expect(xometryAlerts.tokenExpiry(new Date(Date.UTC(2026, 9, 8, 8, 0)), NOW).text).toBe('Xometry token expired at 2026-10-08 08:00 UTC; refresh it now.');
  });

  it('error excerpts are cut at 200 characters; kinds carry the failure kind', () => {
    const long = 'x'.repeat(500);
    const failed = xometryAlerts.scanFailed('graphql', 200, long);
    expect(failed.kind).toBe('scan_failed:graphql');
    expect(failed.text).toBe(`Xometry scan failed: graphql 200; first error: ${'x'.repeat(EXCERPT_MAX)}.`);
    expect(xometryAlerts.scanFailed('timeout', null, 'partner API did not answer in time').text).toBe('Xometry scan failed: timeout n/a; first error: partner API did not answer in time.');
    expect(xometryAlerts.offerErrors(3, long).text).toBe(`Xometry scan finished with 3 offer errors (e.g. ${'x'.repeat(EXCERPT_MAX)}).`);
  });

  it('texts are plain text without emoji or markup', () => {
    const all = [
      xometryAlerts.tokenRejected(401, NOW),
      xometryAlerts.tokenReminder(403, NOW),
      xometryAlerts.tokenExpiry(NOW, NOW),
      xometryAlerts.notConfigured(),
      xometryAlerts.scanFailed('http', 502, 'partner API returned 502'),
      xometryAlerts.offerErrors(1, 'HJO-1: x'),
      xometryAlerts.pageCap(),
      xometryAlerts.newOffers(2, 1),
    ];
    for (const a of all) {
      expect(a.text).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(a.text).not.toMatch(/<\/?[a-z]+>/);
    }
    expect(all[0].text.startsWith('Xometry partner API rejected the token (HTTP 401) at 09:05 UTC.')).toBe(true);
    expect(all[1].text.startsWith('Reminder: Xometry scans are still paused since the partner API rejected the token (HTTP 403) on 2026-10-08 09:05 UTC.')).toBe(true);
  });

  it('sentAlertKinds reads output.alerts (strings only); utcTime and utcStamp', () => {
    expect(sentAlertKinds({ alerts: ['page_cap', 3, 'offer_errors'] })).toEqual(['page_cap', 'offer_errors']);
    expect(sentAlertKinds({ alerts_shadow: ['page_cap'] })).toEqual([]);
    expect(sentAlertKinds(null)).toEqual([]);
    expect(utcTime(NOW)).toBe('09:05');
    expect(utcStamp(NOW)).toBe('2026-10-08 09:05');
  });
});
