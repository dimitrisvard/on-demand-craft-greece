// Consolidated S3 storage API endpoint.
//
// Routes via ?action= :
//   presign-upload   — returns a presigned PUT url + object key (the browser
//                      uploads the file body directly to S3 with that url)
//   presign-download — returns a presigned GET url for an object key
//   delete           — deletes a single object
//   delete-folder    — deletes every object under a prefix
//   list             — lists objects under a prefix
//
// AWS credentials live ONLY here (server-side) and are never shipped to the
// browser. Non-VITE_ env names are read first, falling back to the legacy
// VITE_AWS_* names so existing deployments keep working without any env change.
// (On Vercel every configured env var is available to functions via process.env
// regardless of the VITE_ prefix — the prefix only matters for the client build.)

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetBucketLocationCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Region the env *claims* the bucket is in. This is only a fallback: the real
// region is discovered from S3 at runtime (see resolveRegion). Presigned URLs
// are region-specific and cannot follow the 301 redirect a wrong region
// produces, so signing with the wrong region silently breaks every upload —
// which is exactly what happened when this was pinned to us-east-1 while the
// bucket actually lives in eu-north-1.
const FALLBACK_REGION =
  process.env.AWS_REGION || process.env.VITE_AWS_REGION || 'us-east-1';

const BUCKETS = {
  rfq:
    process.env.AWS_S3_BUCKET ||
    process.env.AWS_BUCKET_NAME ||
    process.env.VITE_AWS_BUCKET_NAME,
  articles:
    process.env.AWS_ARTICLES_BUCKET ||
    process.env.VITE_AWS_ARTICLES_BUCKET_NAME ||
    'articles',
};

const CREDS = {
  rfq: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.VITE_AWS_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY || process.env.VITE_AWS_SECRET_ACCESS_KEY,
  },
  articles: {
    accessKeyId:
      process.env.AWS_ARTICLES_ACCESS_KEY_ID ||
      process.env.VITE_AWS_ARTICLES_ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.VITE_AWS_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.AWS_ARTICLES_SECRET_ACCESS_KEY ||
      process.env.VITE_AWS_ARTICLES_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      process.env.VITE_AWS_SECRET_ACCESS_KEY,
  },
};

const clients = {};
const regionByBucket = {};

function scopeKey(scope) {
  return scope === 'articles' ? 'articles' : 'rfq';
}

function credsFor(scope) {
  const creds = CREDS[scopeKey(scope)];
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error('AWS credentials are not configured on the server');
  }
  return {
    accessKeyId: creds.accessKeyId.trim(),
    secretAccessKey: creds.secretAccessKey.trim(),
  };
}

function bucketFor(scope) {
  const bucket = BUCKETS[scopeKey(scope)];
  if (!bucket) throw new Error(`S3 bucket is not configured for scope "${scopeKey(scope)}"`);
  return bucket;
}

// Discover the bucket's real region once and cache it. GetBucketLocation is a
// global call (any region works) and returns null for us-east-1 and the legacy
// "EU" alias for eu-west-1. Falls back to the env region if the lookup fails.
async function resolveRegion(scope) {
  const bucket = bucketFor(scope);
  if (regionByBucket[bucket]) return regionByBucket[bucket];
  let region = FALLBACK_REGION;
  try {
    const probe = new S3Client({ region: 'us-east-1', credentials: credsFor(scope) });
    const loc = await probe.send(new GetBucketLocationCommand({ Bucket: bucket }));
    region = loc.LocationConstraint || 'us-east-1';
    if (region === 'EU') region = 'eu-west-1';
  } catch (err) {
    console.error(`[api/s3] region lookup for "${bucket}" failed, using ${FALLBACK_REGION}:`, err?.message);
  }
  regionByBucket[bucket] = region;
  return region;
}

async function getClient(scope) {
  const key = scopeKey(scope);
  if (clients[key]) return clients[key];
  const region = await resolveRegion(scope);
  clients[key] = new S3Client({
    region,
    credentials: credsFor(scope),
    followRegionRedirects: true,
  });
  return clients[key];
}

async function publicUrl(scope, key) {
  const region = await resolveRegion(scope);
  return `https://${bucketFor(scope)}.s3.${region}.amazonaws.com/${key}`;
}

function sanitizeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const action = req.query.action;

  try {
    const body = readBody(req);
    const scope = body.scope || req.query.scope || 'rfq';

    switch (action) {
      case 'presign-upload': {
        const { fileName, contentType, prefix } = body;
        if (!fileName) return res.status(400).json({ error: 'fileName is required' });
        const safeName = sanitizeName(fileName);
        const key = prefix ? `${prefix}/${safeName}` : safeName;
        const command = new PutObjectCommand({
          Bucket: bucketFor(scope),
          Key: key,
          ContentType: contentType || 'application/octet-stream',
        });
        const uploadUrl = await getSignedUrl(await getClient(scope), command, { expiresIn: 300 });
        return res.status(200).json({ uploadUrl, key, publicUrl: await publicUrl(scope, key) });
      }

      case 'presign-download': {
        const { key, expiresIn } = body;
        if (!key) return res.status(400).json({ error: 'key is required' });
        const command = new GetObjectCommand({ Bucket: bucketFor(scope), Key: key });
        const url = await getSignedUrl(await getClient(scope), command, {
          expiresIn: Number(expiresIn) || 3600,
        });
        return res.status(200).json({ url });
      }

      case 'delete': {
        const { key } = body;
        if (!key) return res.status(400).json({ error: 'key is required' });
        await (await getClient(scope)).send(
          new DeleteObjectCommand({ Bucket: bucketFor(scope), Key: key })
        );
        return res.status(200).json({ success: true });
      }

      case 'delete-folder': {
        const { prefix } = body;
        if (!prefix) return res.status(400).json({ error: 'prefix is required' });
        const client = await getClient(scope);
        const bucket = bucketFor(scope);
        const listed = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
        );
        const contents = listed.Contents || [];
        if (contents.length === 0) {
          return res.status(200).json({ success: false, deletedCount: 0 });
        }
        let deleted = 0;
        for (const obj of contents) {
          if (!obj.Key) continue;
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
          deleted++;
        }
        return res.status(200).json({ success: true, deletedCount: deleted });
      }

      case 'list': {
        const { prefix } = body;
        const client = await getClient(scope);
        const bucket = bucketFor(scope);
        const region = await resolveRegion(scope);
        const listed = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || '' })
        );
        const objects = (listed.Contents || []).map((item) => ({
          key: item.Key,
          url: `https://${bucket}.s3.${region}.amazonaws.com/${item.Key}`,
          lastModified: item.LastModified,
        }));
        return res.status(200).json({ objects });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[api/s3] error:', err);
    return res.status(500).json({ error: err?.message || 'S3 operation failed' });
  }
}
