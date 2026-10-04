/// <reference path="./ambient.d.ts" />
// Weak ETag exactly as the npm package `etag` computes it with { weak: true } (the value @vercel/node's
// res.send() sets): W/"<byte length in hex>-<base64 SHA-1, first 27 characters>".

export function weakEtag(body: Uint8Array | string): string {
  throw new Error('not implemented: A');
}
