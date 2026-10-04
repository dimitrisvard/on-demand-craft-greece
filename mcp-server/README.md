# Microns Hub Lead Monitor — MCP Server

This MCP server exposes the Microns Hub lead monitoring system to Claude via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Setup

### 1. Install dependencies

```bash
cd mcp-server
npm install
npm run build
```

### 2. Configure environment variables

```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your-service-role-key
export TELEGRAM_BOT_TOKEN=your-bot-token   # optional
export TELEGRAM_CHAT_ID=your-chat-id       # optional
```

### 3. Site API settings (tools that call `/api/*`)

Six tools call the site API instead of Supabase. All of them use one base URL and, when configured, a Cloudflare Access service token.

| Variable | Required | Meaning |
|---|---|---|
| `SITE_URL` | no | Base URL for every `/api/*` call; default `https://www.micronshub.eu` (called without Access headers). Point it at the host that accepts machine credentials (the preview host while it is tested, the machine API host once it exists) |
| `CF_ACCESS_CLIENT_ID` | with the secret | Client ID of the MCP service token |
| `CF_ACCESS_CLIENT_SECRET` | with the ID | Client secret of the MCP service token; never commit it or paste it into a chat |

| Rule | Detail |
|---|---|
| Access headers | `CF-Access-Client-Id` and `CF-Access-Client-Secret` are sent only when both variables are set, only to the origin of `SITE_URL`, and only to a host behind a Cloudflare Access application: never to `www.micronshub.eu`, `micronshub.eu` or a `*.vercel.app` host (the server prints one notice on stderr instead, without the values) |
| Redirects | Never followed: a 3xx answer is reported as an error that names the target, so the token never travels to another host. A `SITE_URL` that redirects (for example the apex host, which redirects to `www`) therefore fails; use the final host |
| `api_base_url` tool argument | Optional per-call override of `SITE_URL`; a different origin is called without the Access headers |

| Tool | Endpoint | Result |
|---|---|---|
| `scan_directory`, `run_saved_search` | `POST /api/scan-directory` | Companies upserted into `company_leads` |
| `enrich_company_emails` | `POST /api/scrape-website` | Per-company result; a 401, 403, 429 or redirect stops the run and leaves the remaining companies `pending` |
| `trigger_country_scan` | `POST /api/tender-scan` | Counts of a synchronous scan, or `queued (run_id …)` when the API queues the scan |
| `export_tenders_csv` | `GET /api/tenders?export=csv&…` | The CSV text (filters `country`, `min_score`, `status`, `relevant_only`), cut at 200 KB on a row boundary with a note |
| `trigger_funding_scan` | `POST /api/funded-startups` | Feed scan counts |

### 4. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "micronshub-leads": {
      "command": "node",
      "args": ["/path/to/on-demand-craft-greece/mcp-server/build/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_KEY": "your-service-role-key",
        "TELEGRAM_BOT_TOKEN": "optional",
        "TELEGRAM_CHAT_ID": "optional",
        "SITE_URL": "optional: https://<preview or machine API host>",
        "CF_ACCESS_CLIENT_ID": "optional, with the secret and SITE_URL",
        "CF_ACCESS_CLIENT_SECRET": "optional, with the ID and SITE_URL"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_leads` | Get leads with filters (source, score, status, days_back, keyword, industry) |
| `get_lead_detail` | Get full details of a specific lead by ID |
| `score_lead` | Manually score a lead (high/medium/low) |
| `update_lead_status` | Update lead status (new/reviewed/contacted/saved/dismissed/converted) |
| `save_response_draft` | Save a drafted response for a lead |
| `add_lead_note` | Add a note to a lead |
| `get_lead_stats` | Get summary statistics for a time period |
| `search_leads` | Full-text search across lead titles and bodies |
| `manage_keywords` | List/add/remove/toggle monitored keywords |
| `manage_subreddits` | List/add/remove/toggle monitored subreddits |

### Google Search Console tools

The server also exposes tools for Google Search Console and the Indexing
API. Credentials are stored in the Supabase `gsc_config` table — see
[`../docs/gsc-setup.md`](../docs/gsc-setup.md) for one-time setup. No
extra environment variables are needed; the existing `SUPABASE_SERVICE_KEY`
unlocks credential access.

| Tool | Description |
|------|-------------|
| `gsc_search_analytics` | Raw Search Analytics query (dimensions, filters, row limit) |
| `gsc_get_top_queries` | Shortcut: top N queries by clicks |
| `gsc_get_top_pages` | Shortcut: top N pages, optional language filter |
| `gsc_compare_periods` | Compare totals between two equal-length windows |
| `gsc_inspect_url` | Run URL Inspection API on a single URL |
| `gsc_get_unindexed_pages` | List monitored URLs that aren't `PASS` in the cache |
| `gsc_submit_for_indexing` | Submit URLs to the Indexing API (respects 200/day quota) |
| `gsc_get_indexing_quota` | How many Indexing submissions have been used today |
| `gsc_list_sitemaps` | List sitemaps for the property |
| `gsc_submit_sitemap` | Submit a new sitemap URL |

## Available Resources

| Resource URI | Description |
|-------------|-------------|
| `leads://today` | Today's lead summary with counts |
| `leads://keywords` | Active keywords by category |
| `leads://subreddits` | Active subreddits by tier |

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `draft_lead_response` | Draft a helpful response for a specific lead |
| `daily_lead_review` | Review today's unreviewed leads and suggest actions |

## Example Claude Conversations

Once connected via Claude Desktop or Cowork:

```
You: Show me today's high-intent leads
Claude: [calls get_leads with score=high, days_back=1]

You: Get the details on lead [ID]
Claude: [calls get_lead_detail]

You: Draft a response for this lead
Claude: [calls draft_lead_response prompt, writes helpful reply]

You: Mark this lead as contacted and add a note
Claude: [calls update_lead_status + add_lead_note]

You: What's our lead volume trend this week?
Claude: [calls get_lead_stats with days_back=7]
```
