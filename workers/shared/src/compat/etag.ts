/// <reference path="./ambient.d.ts" />
// Weak ETag exactly as the npm package `etag` 1.8.1 computes it with { weak: true } (the value @vercel/node's
// res.send() sets): W/"<byte length in hex>-<base64 SHA-1, first 27 characters>". A string is hashed and counted
// as its UTF-8 bytes. The package's empty-body shortcut is the same value computed here.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export function weakEtag(body: Uint8Array | string): string {
  const hash = createHash('sha1').update(body, 'utf8').digest('base64').substring(0, 27);
  const length = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length;
  return `W/"${length.toString(16)}-${hash}"`;
}
