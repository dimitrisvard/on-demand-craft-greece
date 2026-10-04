import { afterEach, describe, expect, it, vi } from 'vitest';
import { configError, missingNames } from '../../src/http/env-check';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('missingNames', () => {
  it('lists the names whose value is undefined, null or the empty string, in the order asked', () => {
    const env = { A: 'set', B: '', C: null, D: undefined, ZERO: 0, FALSE: false, BINDING: { fetch() {} } };
    expect(missingNames(env, ['D', 'A', 'B', 'C', 'E', 'ZERO', 'FALSE', 'BINDING'])).toStrictEqual(['D', 'B', 'C', 'E']);
  });

  it('returns an empty list when every name is present', () => {
    expect(missingNames({ RESEND_API_KEY: 'x' }, ['RESEND_API_KEY'])).toStrictEqual([]);
    expect(missingNames({}, [])).toStrictEqual([]);
  });

  it('does not treat a whitespace value as missing', () => {
    expect(missingNames({ A: ' ' }, ['A'])).toStrictEqual([]);
  });
});

describe('configError', () => {
  it('answers 500 text/plain "Internal Server Error" and logs the names (never a value)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = configError('[microns-site]', ['RESEND_API_KEY', 'OPS']);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Internal Server Error');
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]).toStrictEqual(['[microns-site] api config missing: RESEND_API_KEY, OPS']);
  });
});
