import { describe, expect, it } from 'vitest';
import { allow, bindingFor, rateKey, type RateLimiter } from '../../src/auth/rate-limit';

describe('rateKey', () => {
  it('joins kind and parts with colons', () => {
    expect(rateKey('u', 'uid-1', 'nest')).toBe('u:uid-1:nest');
    expect(rateKey('u', 'uid-1', 's3', 'r')).toBe('u:uid-1:s3:r');
    expect(rateKey('form', '203.0.113.7')).toBe('form:203.0.113.7');
  });
});

describe('bindingFor', () => {
  it.each([
    ['form:203.0.113.7', 'mail'],
    ['rcpt:5f2b…hash', 'mail'],
    ['upl:203.0.113.7', 'bulk'],
    ['u:uid-1:s3:r', 'bulk'],
    ['u:uid-1:s3:up', 'bulk'],
    ['u:uid-1:tenders:r', 'bulk'],
    ['u:uid-1:notifications:r', 'bulk'],
    ['u:uid-1:nest', 'default'],
    ['u:uid-1:emails', 'default'],
    ['u:uid-1:s3', 'default'],
    ['m:collector:tender-scan', 'default'],
    ['trk:1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'default'],
    ['oauth:203.0.113.7', 'default'],
    ['u:uid-1:rfq', 'default'],
    ['u:uid-1:upload', 'default'],
  ])('%s -> %s', (key, binding) => {
    expect(bindingFor(key)).toBe(binding);
  });
});

describe('allow', () => {
  it('passes the key to the binding and returns its outcome', async () => {
    const seen: string[] = [];
    const limiter: RateLimiter = {
      async limit({ key }) {
        seen.push(key);
        return { success: seen.length <= 2 };
      },
    };
    expect(await allow(limiter, 'u:a:nest')).toBe(true);
    expect(await allow(limiter, 'u:a:nest')).toBe(true);
    expect(await allow(limiter, 'u:a:nest')).toBe(false);
    expect(seen).toEqual(['u:a:nest', 'u:a:nest', 'u:a:nest']);
  });
});
