import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatLogLine, logLine } from '../../src/http/log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logLine', () => {
  it('writes one console.log line: prefix, event, then key=value fields in order', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logLine('[microns-site]', 'api', { endpoint: 'emails', action: 'contact', status: 200, ms: 12, ok: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toStrictEqual(['[microns-site] api endpoint=emails action=contact status=200 ms=12 ok=true']);
  });

  it('leaves out undefined fields and writes the event alone when there are none', () => {
    expect(formatLogLine('[microns-ops]', 'queued', { run_id: 'r-1', actionId: undefined })).toBe('[microns-ops] queued run_id=r-1');
    expect(formatLogLine('[microns-ops]', 'started')).toBe('[microns-ops] started');
  });

  it('quotes a value with spaces, quotes, = or control characters, so it cannot add a line or a field', () => {
    const line = formatLogLine('[microns-site]', 'api', { action: 'a b', forged: 'x\n[microns-site] admin=1', eq: 'k=v', empty: '' });
    expect(line).toBe('[microns-site] api action="a b" forged="x\\n[microns-site] admin=1" eq="k=v" empty=""');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('keeps the event text on one line', () => {
    expect(formatLogLine('[microns-ops]', 'scrapes tender-scan\r\ncountry=DE', { status: 200 })).toBe('[microns-ops] scrapes tender-scan country=DE status=200');
  });
});
