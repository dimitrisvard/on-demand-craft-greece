# GSC Dashboard + MCP Tools — Manual Setup Runbook

This is the step-by-step handoff for rolling out the Google Search Console
integration. Code is already implemented on branch
`claude/plan-gsc-mcp-setup-GP23w` (commits `c90a7e3`, `a26d333`, `e0b2690`,
`a51ab48`). Everything below is the manual work that still has to happen
outside the repo.

Do these in order — each section depends on the previous one.

---

## 0. Merge the branch

Code lives on `claude/plan-gsc-mcp-setup-GP23w`. Review and merge it into
`main` via GitHub — Vercel auto-deploys.

**Do not merge until step 1 is done on production Supabase**, otherwise
`/dashboard/seo` and `/api/gsc` will return errors ("gsc_config row not
found", "table gsc_monitored_urls does not exist").

Serverless function count is now exactly **12 out of 12** on the Hobby plan.
Any new `api/*.js` file later will require consolidation.

---

## 1. Apply the Supabase migration

1. Open Supabase dashboard → SQL editor for the `cfjrtmtaitwzggzpkhxi`
   project.
2. Paste and run the contents of
   `supabase/migrations/20260411_gsc_dashboard.sql`. This creates:
   - `public.gsc_config` (RLS enabled, **no policies** — service role only;
     intentional)
   - `public.gsc_indexing_log` (SELECT policy for admin roles)
   - `public.gsc_inspection_cache` (SELECT policy for admin roles)
   - `public.gsc_monitored_urls` (full RLS policies for admin roles)
3. Verify: `SELECT * FROM public.gsc_config;` → 0 rows (filled in step 5).

Alternative: `supabase db push` if the CLI is wired to the prod project.

---

## 2. Google Cloud Console — APIs and credentials

### 2a. Create or select a GCP project
1. https://console.cloud.google.com
2. Create a project, e.g. `micronshub-gsc` (or reuse one).

### 2b. Enable the APIs
**APIs & Services → Library**, enable:
- **Google Search Console API** (`searchconsole.googleapis.com`)
- **Web Search Indexing API** (`indexing.googleapis.com`)

### 2c. Create OAuth 2.0 Web Application credentials
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. If prompted, configure the consent screen first:
   - User Type: **External** (or Internal on Google Workspace)
   - App name: `Micronshub GSC`
   - Support email: your address
   - Test users: add the Google account that **owns** the Search Console
     property
3. Back on Credentials → Create credentials → OAuth client ID:
   - Application type: **Web application**
   - Name: `Micronshub GSC OAuth`
   - Authorized redirect URI: **`http://127.0.0.1:8787/callback`** (exact,
     no trailing slash)
4. Save. Copy **Client ID** and **Client secret**.

### 2d. Create a service account (for the Indexing API)
1. **APIs & Services → Credentials → Create credentials → Service account**.
2. Name: `micronshub-indexing`.
3. Skip role assignment (Indexing API doesn't use IAM).
4. Open the service account → **Keys → Add key → Create new key → JSON**.
   Download.
5. **Copy the service account email** (looks like
   `micronshub-indexing@your-project.iam.gserviceaccount.com`) — needed in
   step 3.

---

## 3. Search Console — grant service account ownership

**Easy to miss.** The Indexing API rejects submissions unless the caller is
an **Owner** on the Search Console property.

1. https://search.google.com/search-console
2. Select the `micronshub.eu` property (the `sc-domain:` one).
3. **Settings → Users and permissions → Add user**.
4. Email: the service account email from step 2d.
5. Permission: **Owner** (not "Full user" — must be Owner).
6. Save.

---

## 4. Obtain a refresh token

Run on your **local dev laptop** (opens a browser + local server on port
8787):

```bash
cd /path/to/on-demand-craft-greece
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=your-client-secret \
  tsx scripts/get-google-refresh-token.ts
```

1. Open the printed URL in a browser.
2. Sign in with the Google account that **owns** the Search Console
   property (must match a test user from 2c if still in Testing mode).
3. Approve `webmasters` + `webmasters.readonly` scopes.
4. Redirects to `http://127.0.0.1:8787/callback`. Terminal prints
   `=== REFRESH TOKEN ===`. **Copy it immediately.** In Testing mode it
   expires after 7 days; once Production, it's permanent.

Port 8787 busy? Edit `scripts/get-google-refresh-token.ts`, change
`server.listen(8787, …)` and re-register the new redirect URI in step 2c.

---

## 5. Insert the `gsc_config` row

Supabase SQL editor — fill in the four placeholders:

```sql
INSERT INTO public.gsc_config (
  id, client_id, client_secret, refresh_token, service_account, site_url
)
VALUES (
  1,
  'PASTE-CLIENT-ID.apps.googleusercontent.com',
  'PASTE-CLIENT-SECRET',
  'PASTE-REFRESH-TOKEN-FROM-STEP-4',
  '{
    "type": "service_account",
    "project_id": "...",
    "private_key_id": "...",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
    "client_email": "micronshub-indexing@your-project.iam.gserviceaccount.com",
    "client_id": "...",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "...",
    "client_x509_cert_url": "..."
  }'::jsonb,
  'sc-domain:micronshub.eu'
)
ON CONFLICT (id) DO UPDATE SET
  client_id       = EXCLUDED.client_id,
  client_secret   = EXCLUDED.client_secret,
  refresh_token   = EXCLUDED.refresh_token,
  service_account = EXCLUDED.service_account,
  site_url        = EXCLUDED.site_url,
  updated_at      = NOW();
```

Notes:
- **`site_url`** uses `sc-domain:micronshub.eu` for a domain property. If
  URL-prefix instead, use `https://www.micronshub.eu/` (with trailing
  slash).
- Paste the entire service account JSON file contents verbatim. Verify:
  `SELECT service_account->>'client_email' FROM gsc_config;` should return
  the email.
- No new Vercel env vars — existing `SUPABASE_SERVICE_ROLE_KEY` unlocks the
  row.

---

## 6. Seed the monitored URLs

On your laptop:

```bash
SUPABASE_URL=https://cfjrtmtaitwzggzpkhxi.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  tsx scripts/seed-gsc-monitored-urls.ts
```

Expected: `Seeded 112 monitored URLs (14 languages × 8 pages).` Safe to
re-run (upsert on the `url` unique constraint).

---

## 7. Verify the Vercel handler

With an admin session (log in to dashboard, grab access token from DevTools
→ Application → Cookies or `supabase.auth.getSession()` in console):

```bash
curl -X POST "https://micronshub.eu/api/gsc?action=search-analytics" \
  -H "Authorization: Bearer <session-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-03-14",
    "endDate":   "2026-04-07",
    "dimensions": ["query"],
    "rowLimit": 5
  }'
```

Expected: JSON with `rows[]` (`clicks`, `impressions`, `ctr`, `position`).

Failure modes:
- `401 Missing bearer token` → no Authorization header.
- `403 Admin role required` → `user_roles.role` not in
  `admin / sales_rep / production_manager / accountant`.
- `500 gsc_config row not found` → step 5 not run.
- `401 GSC auth failed … invalid_grant` → refresh token expired. Re-run
  step 4 and `UPDATE` the row.

---

## 8. Verify the dashboard UI

1. Log in to https://micronshub.eu as admin.
2. Dashboard sidebar → **System → SEO Console**, or go to `/dashboard/seo`.
3. Check each tab:
   - **Overview** — date range picker, 4 summary cards, line chart.
   - **Top queries** — filter/sort.
   - **Top pages** — language dropdown filter.
   - **Countries** — bar chart + full table.
   - **Index status** — monitored URLs from `gsc_monitored_urls`; "Inspect
     all" chunks 50; "Request indexing" submits batch; "Quota used today:
     X / 200" updates.
   - **Sitemaps** — list from GSC; submit/delete.
4. Non-admin user → `/dashboard/seo` redirects to login.

---

## 9. Test Indexing API end-to-end

1. Index status tab → pick a single URL to force-reindex.
2. Click its inspect icon → cached result appears.
3. Check the box, click **Request indexing**.
4. Verify:
   - Toast: `Submitted: 1 · Skipped (quota): 0`.
   - `SELECT * FROM gsc_indexing_log ORDER BY submitted_at DESC LIMIT 5;`
     shows a row with `status = 'success'`.
   - Quota card increments to `1 / 200`.
5. Quota truncation test: call `/api/gsc?action=submit-indexing` with 210
   URLs → 10 come back as `status = "skipped_quota"`.

---

## 10. Build the MCP server (dev laptop only)

Stdio-only, runs locally via Claude Desktop. **Not** deployed on Vercel.

```bash
cd mcp-server
npm install
npm run build
```

If `tsc` runs out of heap (rare on a normal laptop):

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run build
```

---

## 11. Wire Claude Desktop

**If the lead-monitor MCP server is already configured, no changes
needed** — same binary, same env vars. Just rebuild (step 10) and restart
Claude Desktop. The 10 new `gsc_*` tools appear automatically.

First-time setup — edit
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "micronshub-leads": {
      "command": "node",
      "args": ["/absolute/path/to/on-demand-craft-greece/mcp-server/build/index.js"],
      "env": {
        "SUPABASE_URL": "https://cfjrtmtaitwzggzpkhxi.supabase.co",
        "SUPABASE_SERVICE_KEY": "<service-role-key>"
      }
    }
  }
}
```

Restart Claude Desktop fully (quit from menu bar, not just close window).

---

## 12. Smoke-test the MCP tools

In Claude Desktop, ask:
- "What were Micronshub's top 10 search queries this month?" →
  `gsc_get_top_queries`
- "Inspect https://www.micronshub.eu/en/services/cnc-machining in Google
  Search Console." → `gsc_inspect_url`
- "Which monitored pages are not yet indexed?" → `gsc_get_unindexed_pages`
- "How much Indexing API quota have we used today?" →
  `gsc_get_indexing_quota`
- "Compare clicks this week vs last week." → `gsc_compare_periods`

Alternative — run the MCP Inspector UI:

```bash
cd mcp-server
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  npx @modelcontextprotocol/inspector node build/index.js
```

All 10 `gsc_*` tools should appear in the Tools panel.

---

## 13. (Optional) Promote the OAuth consent screen to Production

In **Testing** mode, refresh tokens expire after 7 days and only test users
can sign in. To make it survive long-term:

1. GCP Console → APIs & Services → OAuth consent screen.
2. Click **Publish app**. For `webmasters` + `webmasters.readonly` on a
   small internal tool, verification is typically not required.
3. Existing refresh tokens then work indefinitely.

---

## 14. Credential rotation (when needed)

No redeploy. In Supabase SQL editor:

```sql
UPDATE public.gsc_config
SET refresh_token = 'new-refresh-token',
    updated_at    = NOW()
WHERE id = 1;
```

Vercel handlers pick up new value on next cold start (or redeploy to
force). MCP server caches per-process — picks up on next restart.

---

## Quick-reference checklist

| # | Action | Where |
|---|--------|-------|
| 0 | Merge branch → main | GitHub |
| 1 | Run SQL migration | Supabase SQL editor |
| 2a | Enable Search Console API + Indexing API | GCP Console |
| 2b | Create OAuth Web client (note ID + secret) | GCP Credentials |
| 2c | Create service account + download JSON key | GCP Credentials |
| 3 | Add service account email as **Owner** | Search Console → Settings → Users |
| 4 | Run `scripts/get-google-refresh-token.ts` | Dev laptop + browser |
| 5 | `INSERT INTO gsc_config …` | Supabase SQL editor |
| 6 | Run `scripts/seed-gsc-monitored-urls.ts` | Dev laptop |
| 7 | `curl` the search-analytics endpoint | Dev laptop |
| 8 | Visit `/dashboard/seo` as admin | Browser |
| 9 | Submit one URL to the Indexing API | Dashboard |
| 10 | `cd mcp-server && npm install && npm run build` | Dev laptop |
| 11 | Update / restart Claude Desktop | Dev laptop |
| 12 | Ask Claude a GSC question | Claude Desktop |
| 13 | Publish OAuth consent screen | GCP Console |

Zero new Vercel env vars at any step. The existing
`SUPABASE_SERVICE_ROLE_KEY` is the only secret that unlocks the stack.
