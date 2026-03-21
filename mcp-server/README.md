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

### 3. Configure Claude Desktop

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
        "TELEGRAM_CHAT_ID": "optional"
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
