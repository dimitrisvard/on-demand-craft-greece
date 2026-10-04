#!/usr/bin/env node
// Rollback copy helper (owner-run): copies files uploaded through the Worker files API from R2 back to the
// legacy S3 rfq bucket, so that the Vercel copy of /api/s3 can serve them again.
//
//   R2 microns-private  rfq/<key>   ->   legacy rfq bucket  <key>
//
// Dry run by default: lists what would be copied and writes nothing. --execute copies. Credentials come from
// the environment only (the owner's own) and are never printed: output lines carry keys, sizes and counts only.
// Uses @aws-sdk/client-s3 from the root node_modules (no new dependency).

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { pathToFileURL } from 'node:url';

const R2_PREFIX = 'rfq/';

const USAGE = `Usage: node scripts/r2-to-legacy-s3.mjs [--dry-run | --execute] [options]

Copies R2 objects rfq/<key> (bucket microns-private) to <key> in the legacy S3 rfq bucket.

Options:
  --dry-run          list what would be copied; write nothing (default)
  --execute          copy the objects
  --since <ISO>      only objects last modified at or after this time, e.g. 2026-10-01T00:00:00Z
  --prefix <p>       only keys starting with <p> (contract key, without rfq/)
  --overwrite        also copy keys that already exist in the legacy bucket (default: skip them)
  --endpoint <url>   tests only: send R2 and legacy requests to <url>, path style
  --help             show this text

Environment (values are never printed):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   R2 API token that can read microns-private
  R2_JURISDICTION      eu (default) or empty for a bucket without a jurisdiction
  R2_BUCKET            default microns-private
  LEGACY_S3_RFQ_BUCKET legacy rfq bucket name (required)
  LEGACY_S3_REGION     default eu-north-1
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (or AWS_PROFILE): your own AWS credentials with s3:PutObject
                       and s3:GetObject on the legacy rfq bucket
`;

class UsageError extends Error {}

export function parseArgs(argv) {
  const o = { execute: false, dryRun: false, since: null, prefix: '', overwrite: false, endpoint: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--execute') o.execute = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--overwrite') o.overwrite = true;
    else if (a === '--since') {
      const v = value();
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new UsageError(`--since: not a date: ${v}`);
      o.since = d;
    } else if (a === '--prefix') o.prefix = value();
    else if (a === '--endpoint') o.endpoint = value();
    else throw new UsageError(`unknown option: ${a}`);
  }
  if (o.execute && o.dryRun) throw new UsageError('--execute and --dry-run exclude each other');
  return o;
}

function config(env) {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'LEGACY_S3_RFQ_BUCKET'];
  const missing = required.filter((n) => !env[n]);
  if (missing.length) throw new UsageError(`missing environment: ${missing.join(', ')}`);
  return {
    accountId: env.R2_ACCOUNT_ID.trim(),
    jurisdiction: env.R2_JURISDICTION === undefined ? 'eu' : env.R2_JURISDICTION.trim(),
    r2Bucket: (env.R2_BUCKET || 'microns-private').trim(),
    r2Credentials: { accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() },
    legacyBucket: env.LEGACY_S3_RFQ_BUCKET.trim(),
    legacyRegion: (env.LEGACY_S3_REGION || 'eu-north-1').trim(),
  };
}

function clients(c, endpoint) {
  const r2Endpoint = endpoint ?? `https://${c.accountId}${c.jurisdiction ? `.${c.jurisdiction}` : ''}.r2.cloudflarestorage.com`;
  const common = { requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' };
  const r2 = new S3Client({ ...common, region: 'auto', endpoint: r2Endpoint, forcePathStyle: true, credentials: c.r2Credentials });
  // Legacy: the AWS SDK default credential chain (environment, then profile).
  const legacy = new S3Client({ ...common, region: c.legacyRegion, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  return { r2, legacy };
}

async function* listR2(r2, bucket, prefix) {
  let token;
  do {
    const page = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key) yield o;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

async function existsInLegacy(legacy, bucket, key) {
  try {
    await legacy.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
    throw err;
  }
}

function errorText(err) {
  return `${err?.name ?? 'Error'}${err?.$metadata?.httpStatusCode ? ` (HTTP ${err.$metadata.httpStatusCode})` : ''}: ${err?.message ?? String(err)}`;
}

export async function main(argv = process.argv.slice(2), env = process.env, out = console.log, err = console.error) {
  let o;
  let c;
  try {
    o = parseArgs(argv);
    if (o.help) {
      out(USAGE);
      return 0;
    }
    c = config(env);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`r2-to-legacy-s3: ${e.message}\n`);
    err(USAGE);
    return 2;
  }
  const mode = o.execute ? 'execute' : 'dry-run';
  const { r2, legacy } = clients(c, o.endpoint);
  out(`mode=${mode} source=r2:${c.r2Bucket}/${R2_PREFIX}${o.prefix} target=s3:${c.legacyBucket} (${c.legacyRegion})${o.since ? ` since=${o.since.toISOString()}` : ''}`);

  const counts = { listed: 0, older: 0, exists: 0, copy: 0, copied: 0, failed: 0 };
  try {
    for await (const obj of listR2(r2, c.r2Bucket, R2_PREFIX + o.prefix)) {
      counts.listed++;
      const key = obj.Key.slice(R2_PREFIX.length);
      if (!key) continue;
      if (o.since && obj.LastModified && obj.LastModified < o.since) {
        counts.older++;
        continue;
      }
      try {
        if (!o.overwrite && (await existsInLegacy(legacy, c.legacyBucket, key))) {
          counts.exists++;
          out(`skip (exists)  ${obj.Key} -> ${key}`);
          continue;
        }
        counts.copy++;
        if (!o.execute) {
          out(`would copy     ${obj.Key} -> ${key} (${obj.Size ?? '?'} bytes)`);
          continue;
        }
        const got = await r2.send(new GetObjectCommand({ Bucket: c.r2Bucket, Key: obj.Key }));
        const body = await got.Body.transformToByteArray();
        await legacy.send(new PutObjectCommand({
          Bucket: c.legacyBucket,
          Key: key,
          Body: body,
          ContentType: got.ContentType || 'application/octet-stream',
        }));
        counts.copied++;
        out(`copied         ${obj.Key} -> ${key} (${body.byteLength} bytes)`);
      } catch (e) {
        counts.failed++;
        err(`failed         ${obj.Key}: ${errorText(e)}`);
      }
    }
  } catch (e) {
    err(`r2-to-legacy-s3: listing R2 failed: ${errorText(e)}`);
    return 1;
  }
  out(`listed=${counts.listed} older=${counts.older} exists=${counts.exists} ${o.execute ? `copied=${counts.copied}` : `would_copy=${counts.copy}`} failed=${counts.failed}`);
  return counts.failed ? 1 : 0;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) process.exitCode = await main();
