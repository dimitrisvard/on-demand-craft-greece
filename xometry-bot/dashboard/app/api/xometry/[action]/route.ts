import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy to the Hetzner review API — keeps the bearer token and the
// box's address out of the browser. The review API is the ONLY thing that can
// send a counteroffer, and only for one explicit code per call.

const ACTIONS = new Set(['submit', 'skip']);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await ctx.params;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ detail: 'unknown action' }, { status: 404 });
  }
  const base = process.env.XOMETRY_REVIEW_API_URL;
  const token = process.env.XOMETRY_REVIEW_API_TOKEN;
  if (!base || !token) {
    return NextResponse.json(
      { detail: 'XOMETRY_REVIEW_API_URL / XOMETRY_REVIEW_API_TOKEN not configured' },
      { status: 500 },
    );
  }
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code;
  if (!code) {
    return NextResponse.json({ detail: 'missing code' }, { status: 422 });
  }
  const upstream = await fetch(`${base.replace(/\/$/, '')}/${action}/${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload: unknown = await upstream.json().catch(() => ({}));
  return NextResponse.json(payload, { status: upstream.status });
}
