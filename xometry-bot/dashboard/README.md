# Dashboard drop-in: `/xometry` review page

> **Already integrated in this repo — nothing to copy.** Microns Hub is a Vite
> SPA on Vercel's Hobby plan (12/12 serverless functions used), so the page was
> ported to the hub's stack instead of installing these Next.js folders:
>
> - **Page**: `src/pages/dashboard/XometryQueuePage.tsx` → `/dashboard/xometry`,
>   wrapped in `PersistentDashboardLayout` (login-gated) and linked under
>   Lead Monitor → "Xometry Queue".
> - **Backend**: `supabase/functions/xometry-review` edge function. Reads
>   `xometry_offers` with the service role key after checking the caller has an
>   admin-level row in `user_roles` (same bar as `api/_lib/admin-auth.js`).
>   `skip` is a direct DB transition; `submit` enforces the §6C guard, claims the
>   row atomically, and sends the counteroffer (no box needed).
> - **Secrets** for submit (Dashboard → Edge Functions → Manage secrets, or
>   `supabase secrets set …`) — see `../README.md` "Operator setup B":
>   `XOMETRY_PARTNER_AUTH_TOKEN` + `XOMETRY_COUNTEROFFER_MUTATION` for the direct
>   GraphQL path, **or** `XOMETRY_REVIEW_API_URL` + `XOMETRY_REVIEW_API_TOKEN` to
>   proxy to a review-API box instead. Until one pair is set, `pending`/`skip`
>   work and `submit` returns a clear "not configured" error (never a silent OK).
> - The scanner that fills the queue is the `xometry-scan` GitHub Action, not
>   this page — see `../README.md` "Operator setup A".
>
> The files below are the original portable Next.js (App Router) variant, kept
> for reference in case the page ever needs to move to a Next.js app.

Portable Next.js (App Router) route for the Microns Hub dashboard. No new
dependencies beyond `@supabase/supabase-js` (already in the hub) and Tailwind
classes.

## Install into the hub

1. Copy `app/xometry/` → `<hub>/app/xometry/`
2. Copy `app/api/xometry/` → `<hub>/app/api/xometry/`
3. Env (Vercel project settings):
   - `NEXT_PUBLIC_SUPABASE_URL` — already set in the hub
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only; the `xometry_offers` table has RLS
     enabled with **no policies**, so the anon key can never read it
   - `XOMETRY_REVIEW_API_URL` — the Hetzner review API, e.g. `https://<box>:8077`
     (put it behind TLS/a reverse proxy or a private network)
   - `XOMETRY_REVIEW_API_TOKEN` — must match `XB_REVIEW_API_TOKEN` on the box

## Wiring notes

- `page.tsx` reads the queue straight from Supabase (server component, sorted by
  `publication_end`).
- Submit/Skip POST to `/api/xometry/{action}`, which proxies to the Hetzner
  review API with the bearer token — the token never reaches the browser.
- Submit asks for an explicit `window.confirm` and sends `accept_review_row`
  only for `needs_review` rows (visible as "Submit (override)").
- `part-viewer.tsx` is a placeholder slot: swap in the existing Microns Hub
  STEP→GLB Three.js viewer component (§2 of the build spec).
