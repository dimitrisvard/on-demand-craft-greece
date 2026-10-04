// weakEtag must equal the npm package `etag` 1.8.1 with { weak: true }, the value @vercel/node's res.send() sets.
import { Buffer } from 'node:buffer';
import etag from 'etag';
import { describe, expect, it } from 'vitest';
import { weakEtag } from '../../src/compat/etag';

const binary = new Uint8Array(256);
for (let i = 0; i < binary.length; i++) binary[i] = (i * 151 + 7) % 256;

const STRINGS: Array<[string, string]> = [
  ['empty', ''],
  ['ASCII', 'hello'],
  ['UTF-8', 'héllo wörld € 日本 🚀'],
  ['1,000 ASCII characters', 'x'.repeat(1000)],
  ['more than 1,000 characters', '<p>row</p>\n'.repeat(400)],
  ['under 1,000 characters but over 1,000 bytes', 'é'.repeat(600)],
  ['a lone surrogate (encoded as U+FFFD)', 'a\ud800b'],
];

describe('weakEtag equals etag(body, { weak: true })', () => {
  it.each(STRINGS)('string: %s', (_name, body) => {
    expect(weakEtag(body)).toBe(etag(body, { weak: true }));
  });

  it.each(STRINGS)('same value for the UTF-8 bytes of the string: %s', (_name, body) => {
    expect(weakEtag(Buffer.from(body, 'utf8'))).toBe(etag(body, { weak: true }));
  });

  it('empty bytes', () => {
    expect(weakEtag(new Uint8Array(0))).toBe(etag(Buffer.from(''), { weak: true }));
  });

  it('binary bytes (every byte value)', () => {
    expect(weakEtag(binary)).toBe(etag(Buffer.from(binary), { weak: true }));
  });

  it('bytes of at least 1,000 entries', () => {
    const big = new Uint8Array(4096).map((_, i) => i % 251);
    expect(weakEtag(big)).toBe(etag(Buffer.from(big), { weak: true }));
  });

  it('a Uint8Array view into a larger buffer hashes only its own bytes', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    expect(weakEtag(view)).toBe(etag(Buffer.from([1, 2, 3]), { weak: true }));
  });

  it('has the documented shape: W/"<length in hex>-<27 base64 characters>"', () => {
    expect(weakEtag('x'.repeat(300))).toMatch(/^W\/"12c-[A-Za-z0-9+/]{27}"$/);
  });
});
