// CONTRACT STUB (replaced by the SEO handler implementation, PLAN.md P1-4).
// handleSeo answers a /{lang} or /{lang}/* request the way middleware.ts does, or returns null where
// middleware.ts returns undefined (the router then falls through to the static step).
import type { Env } from '../env';

export async function handleSeo(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response | null> {
  return null;
}
