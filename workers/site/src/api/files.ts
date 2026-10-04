// /api/s3 files API: same actions, statuses and response bodies as api/s3.js, served from R2 (new uploads) with
// read fallback to the legacy S3 buckets; the articles scope stays on legacy S3.

import type { Principal } from '../../../shared/src/http/rpc';
import type { FileConstraints } from '../auth/constraints';
import type { ResolvedApi } from './resolve';

export interface FilesEnv {
  PRIVATE_FILES: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  LEGACY_S3_REGION: string;
  LEGACY_S3_RFQ_BUCKET: string;
  LEGACY_S3_ARTICLES_BUCKET: string;
  LEGACY_AWS_ACCESS_KEY_ID: string;
  LEGACY_AWS_SECRET_ACCESS_KEY: string;
}

/** Must equal the "jurisdiction" of the PRIVATE_FILES binding in wrangler.jsonc. */
export const R2_JURISDICTION: 'eu' | '' = 'eu';

export function handleFiles(i: {
  resolved: ResolvedApi;
  principal: Principal;
  constraints: FileConstraints;
  env: FilesEnv;
  ctx: ExecutionContext;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  throw new Error('not implemented: S');
}
