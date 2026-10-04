// Presigned URLs are built from code constants (R2 S3 endpoint with the jurisdiction, bucket name) while head,
// list and delete go through the PRIVATE_FILES binding: both must address the same bucket, so the constants must
// agree with the binding in wrangler.jsonc.

import { describe, expect, it } from 'vitest';
import { R2_BUCKET, R2_JURISDICTION } from '../src/api/files';

const NODE_FS: string = 'node:fs';
const CONFIG_PATH = new URL('../wrangler.jsonc', (import.meta as unknown as { url: string }).url).pathname;

/** JSONC -> JSON: drops line and block comments outside strings, then trailing commas. */
function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

async function siteConfig(): Promise<{ r2_buckets?: Array<{ binding: string; bucket_name: string; jurisdiction?: string }> }> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(path: string, encoding: 'utf8'): string };
  return JSON.parse(stripJsonc(fs.readFileSync(CONFIG_PATH, 'utf8')));
}

describe('files API constants agree with the PRIVATE_FILES binding (wrangler.jsonc)', () => {
  it('stripJsonc keeps // inside strings and removes comments and trailing commas', () => {
    expect(JSON.parse(stripJsonc('{\n // c\n "a": "https://x/y", /* b */ "b": [1,2,],\n}'))).toEqual({ a: 'https://x/y', b: [1, 2] });
  });

  it('R2_JURISDICTION equals the binding "jurisdiction" (absent means none)', async () => {
    const binding = (await siteConfig()).r2_buckets?.find((b) => b.binding === 'PRIVATE_FILES');
    expect(binding, 'r2_buckets entry with binding PRIVATE_FILES in workers/site/wrangler.jsonc').toBeDefined();
    expect(binding?.jurisdiction ?? '').toBe(R2_JURISDICTION);
  });

  it('R2_BUCKET equals the binding "bucket_name"', async () => {
    const binding = (await siteConfig()).r2_buckets?.find((b) => b.binding === 'PRIVATE_FILES');
    expect(binding?.bucket_name).toBe(R2_BUCKET);
  });
});

describe('r2/cors.private.json (bucket CORS the owner applies with wrangler r2 bucket cors set)', () => {
  interface CorsRule { allowed: { origins: string[]; methods: string[]; headers?: string[] }; exposeHeaders?: string[]; maxAgeSeconds?: number }

  async function cors(): Promise<{ rules: CorsRule[] }> {
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(path: string, encoding: 'utf8'): string };
    const path = new URL('../r2/cors.private.json', (import.meta as unknown as { url: string }).url).pathname;
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  }

  it('allows browser PUT/GET/HEAD with the signed Content-Type from the site origins only', async () => {
    const { rules } = await cors();
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect([...rule.allowed.methods].sort()).toEqual(['GET', 'HEAD', 'PUT']);
    expect(rule.allowed.headers).toEqual(['Content-Type']);
    expect(rule.allowed.origins).toEqual(expect.arrayContaining(['https://www.micronshub.eu', 'https://micronshub.eu', 'https://*.micronshub.eu']));
    expect(rule.maxAgeSeconds).toBeLessThanOrEqual(86_400);
  });

  it('every origin is scheme://host[:port], at most one wildcard, never a catch-all or a host outside the site', async () => {
    const { rules } = await cors();
    for (const origin of rules[0].allowed.origins) {
      expect(origin, origin).toMatch(/^https?:\/\/[^/]+$/);
      expect(origin.split('*').length, origin).toBeLessThanOrEqual(2);
      expect(origin).not.toBe('*');
      expect(origin, origin).not.toMatch(/vercel\.app|api\.micronshub\.eu/);
      const host = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
      expect(host, origin).toMatch(/(^|\.)micronshub\.eu$|\.workers\.dev$|^localhost$/);
    }
  });
});
