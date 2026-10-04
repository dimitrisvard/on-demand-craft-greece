import { describe, expect, it } from 'vitest';
import { apiError, jsonResponse, textResponse } from '../../src/http/json';

describe('jsonResponse', () => {
  it('serialises the body with Content-Type application/json; charset=utf-8', async () => {
    const response = jsonResponse(200, { success: true, n: [1, 'é'] });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.text()).toBe('{"success":true,"n":[1,"é"]}');
  });

  it('keeps extra headers; the JSON type always wins', async () => {
    const response = jsonResponse(504, { success: false, code: 'TIMEOUT' }, { 'X-Extra': '1', 'Content-Type': 'text/html' });
    expect(response.headers.get('x-extra')).toBe('1');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('sends no body for a null-body status', () => {
    expect(jsonResponse(204, { ignored: true }).body).toBeNull();
  });
});

describe('textResponse', () => {
  it('sends the text with Content-Type text/plain; charset=utf-8', async () => {
    const response = textResponse(500, 'Internal Server Error');
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Internal Server Error');
  });
});

describe('apiError', () => {
  it('answers {"error": code} as JSON with the status and extra headers', async () => {
    const response = apiError(429, 'rate_limited', { 'Retry-After': '60' });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.text()).toBe('{"error":"rate_limited"}');
  });

  it('builds every error body of the API error policy', async () => {
    for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [413, 'payload_too_large'], [415, 'unsupported_media_type']] as const) {
      expect(await apiError(status, code).json()).toStrictEqual({ error: code });
    }
  });
});
