# Optional Cloudflare Access in front of `/dashboard` (P6-4)

Status: prepared, off by default. Nothing here is applied by code; the owner creates the application if wanted
(docs/migration/MANUAL_STEPS.md, OW6-8).

Related: [PLAN.md](../PLAN.md) P6-4 · [access-dashboard.json](access-dashboard.json)

## Allow-list rule

Every person who opens `/dashboard` on `www.micronshub.eu` must be on the allow list of the application, or the
destination must be narrowed to staff-only subpaths. That is:

- staff (the accounts with an `admin`, `sales_rep`, `production_manager` or `accountant` role);
- every **tenant admin** and every **production partner** (`partner_seller`) who uses the dashboard: their menus are
  built from the same dashboard layout (`src/components/dashboard/PersistentDashboardLayout.tsx`), so they load
  `/dashboard` paths as well.

Anyone missing from the list is locked out of the dashboard at the edge. `access-dashboard.json` carries three
placeholders (`<STAFF_EMAIL_1>`, `<STAFF_EMAIL_2>`, `<DASHBOARD_EMAIL_3>`); add one `email` entry per further person.
The addresses are filled in when the application is created and are never committed. The alternative to listing
tenant admins and partners is to replace the one destination by staff-only subpaths (same `uri` form, for example
`www.micronshub.eu/dashboard/leads`), so the paths those users open stay outside the application.

## Decisions

| Item | Decision |
|---|---|
| What it does | An Access self-hosted application on `www.micronshub.eu/dashboard` asks for an Access login (allowed e-mail addresses, the account's identity provider) before any full page load of `/dashboard` and every path below it reaches the Worker. A public destination covers its subpaths (CF API reference "Add an Access application", read 2026-10-04: unlike the `uri` of public destinations, override path patterns do not cover subpaths) |
| What it does not do | It is an extra layer, not the access control of the data. The React app also reaches `/dashboard` by client-side navigation from any public page, which sends no request to the edge; the dashboard's data stays protected by Supabase Auth, row-level security and the `/api` gates. The JavaScript bundle under `/assets/*` stays public |
| Not covered | `/api/*` (dashboard calls carry the Supabase session token, not an Access identity; never add it), the staff pages outside `/dashboard` (`/customers`, `/partners`, `/calendar`, `/products`, `/rfq…`, `/orders…`; optional extra destinations, same `uri` form), `/customer/*` and `/partner/*` (customers and partners sign in with Supabase Auth only), tenant hosts `*.micronshub.eu` (never add them) |
| Precondition | Phase 3 done (zone on Cloudflare, `www` proxied); the allow list per the rule above |
| Create | Zero Trust dashboard → Access → Applications → Self-hosted, with the values of `access-dashboard.json`, or the API (`POST /accounts/<account_id>/access/apps` with that JSON after replacing the placeholders). Check afterwards: a private window on `https://www.micronshub.eu/dashboard` shows the Access login; `https://www.micronshub.eu/en` and `/api/track` do not; a tenant admin and a production partner on the list reach their dashboard pages |
| Telegram links | Collector messages link to `/dashboard/tenders` and `/dashboard/funded-startups`; with the application on, they open the Access login first |
| Turn off | Delete the application (or remove its destination). Takes effect within a minute; no deploy |
| Session | 24 h, HttpOnly cookie, SameSite Lax (cross-site navigations from Telegram or e-mail keep the session) |
