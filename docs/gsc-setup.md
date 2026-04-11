# Google Search Console Dashboard — Setup Guide

This document walks through the one-time setup for the `/dashboard/seo`
admin surface and the `gsc_*` MCP tools exposed by `mcp-server`.

**Design constraints:**

- Vercel environment-variable slots are full. This integration adds
  **zero** new Vercel env vars. Credentials live in the Supabase
  `gsc_config` table and are read using the existing
  `SUPABASE_SERVICE_ROLE_KEY`.
- Both the Vercel handlers and the MCP server talk to Google via plain
  `fetch` + Node's `crypto` — no `googleapis` dependency. Keeps the
  MCP server bundle small and the TypeScript typecheck fast.

---

## 1. Google Cloud project

1. Go to <https://console.cloud.google.com> and create (or reuse) a project
   — e.g. `micronshub-gsc`.
2. Enable these APIs under **APIs & Services → Library**:
   - **Google Search Console API** (`searchconsole.googleapis.com`)
   - **Web Search Indexing API** (`indexing.googleapis.com`)

## 2. OAuth 2.0 credentials (for Search Analytics / URL Inspection / Sitemaps)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Authorized redirect URI: `http://127.0.0.1:8787/callback`
   (used only by the refresh-token helper below — not a live URL).
4. Save. Copy the **Client ID** and **Client secret**.

### Obtain a refresh token

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=your-client-secret \
  tsx scripts/get-google-refresh-token.ts
```

Open the printed URL in a browser, sign in with the Google account that
**owns** the Search Console property, and approve. The script prints a
refresh token — copy it.

## 3. Service account (for Indexing API)

The Indexing API requires a service account separate from the OAuth2 client.

1. **APIs & Services → Credentials → Create credentials → Service account**.
2. Give it a name, e.g. `micronshub-indexing`.
3. Skip role assignment (Indexing API doesn't use IAM roles).
4. After creation, open the service account → **Keys → Add key → JSON**.
   Download the file.
5. **Grant the service account ownership of the Search Console property:**
   - Open <https://search.google.com/search-console>.
   - Select the `micronshub.eu` property.
   - Settings → Users and permissions → Add user.
   - Paste the service account email (looks like
     `micronshub-indexing@your-project.iam.gserviceaccount.com`).
   - Grant **Owner** permission. (The Indexing API requires this level.)

## 4. Insert the row into `gsc_config`

Open the Supabase SQL editor for the `micronshub-*` project and run:

```sql
INSERT INTO public.gsc_config (
  id,
  client_id,
  client_secret,
  refresh_token,
  service_account,
  site_url
)
VALUES (
  1,
  'your-client-id.apps.googleusercontent.com',
  'your-client-secret',
  'your-refresh-token-from-step-2',
  '{
    "type": "service_account",
    "project_id": "...",
    "private_key_id": "...",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
    "client_email": "micronshub-indexing@your-project.iam.gserviceaccount.com",
    ...
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

- `site_url` uses the `sc-domain:` prefix for domain-level properties.
  For URL-prefix properties use the full `https://www.micronshub.eu/` value.
- `gsc_config` has RLS enabled with no policies, so only the service role
  can read or write it. This is intentional — never expose it to the browser.
- To rotate credentials (e.g. a new refresh token) just `UPDATE` the row.
  No redeploy required.

## 5. Seed monitored URLs

```bash
SUPABASE_URL=https://cfjrtmtaitwzggzpkhxi.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
  tsx scripts/seed-gsc-monitored-urls.ts
```

This inserts 14 × 8 = **112 rows** (homepage + services index + 6 service
pages for each of the 14 supported languages).

## 6. Verify

### Vercel handlers

With an admin session, call:

```bash
curl -X POST https://micronshub.eu/api/gsc/search-analytics \
  -H "Authorization: Bearer <admin-session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-03-14",
    "endDate":   "2026-04-07",
    "dimensions": ["query"],
    "rowLimit": 5
  }'
```

Expect JSON rows with `clicks`, `impressions`, `ctr`, `position`.

### Dashboard

Log in as an admin and visit `/dashboard/seo`. All six tabs should load.

### MCP server

```bash
cd mcp-server
npm run build
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  npx @modelcontextprotocol/inspector node build/index.js
```

The new `gsc_*` tools should appear in the Inspector's tool list.

### Claude Desktop

No config changes required beyond the existing `mcp-server` entry — the
same process now exposes the GSC tools as soon as you restart Claude
Desktop after building.

---

## Rotating credentials

Run the refresh-token helper again with the same OAuth client and `UPDATE`
the single row:

```sql
UPDATE public.gsc_config
SET refresh_token = 'new-token', updated_at = NOW()
WHERE id = 1;
```

The Vercel handlers pick up new values on the next cold start; to force
a pickup immediately, redeploy or change any environment variable. The
MCP server picks them up the next time a tool is invoked (the client
caches credentials per-process).
