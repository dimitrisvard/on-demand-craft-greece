import { describe, expect, it } from 'vitest';
import { ApiError, DEFAULT_TIMEOUT_MS, MAX_FUNCTION_BODY_BYTES, RAW_BODY } from '../../src/compat/vercel-node';

describe('vercel-node constants', () => {
  it('caps request bodies at 4.5 MiB (4,718,592 bytes)', () => {
    expect(MAX_FUNCTION_BODY_BYTES).toBe(4.5 * 1024 * 1024);
    expect(MAX_FUNCTION_BODY_BYTES).toBe(4_718_592);
  });

  it('gives one invocation 30 s by default', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('keys the raw body with a symbol', () => {
    expect(typeof RAW_BODY).toBe('symbol');
  });
});

describe('ApiError', () => {
  it('is an Error carrying an HTTP status and the message', () => {
    const err = new ApiError(400, 'Invalid JSON');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid JSON');
  });
});
