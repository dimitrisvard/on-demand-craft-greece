// Client-side helper that proxies S3 operations through the server-side
// /api/s3 endpoint. AWS credentials never reach the browser bundle — the
// server signs requests and returns presigned URLs the browser can use.

export type S3Scope = 'rfq' | 'articles';

export async function callS3<T = unknown>(
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`/api/s3?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 ${action} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}
