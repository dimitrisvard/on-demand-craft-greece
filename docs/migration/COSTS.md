# Microns Hub to Cloudflare migration: costs

Status: Phase 0 planning deliverable · 2026-09-30 · nothing here is deployed.

Related: [README.md](README.md) · [PLAN.md](PLAN.md) · [INVENTORY.md](INVENTORY.md) · [inventory.csv](inventory.csv) · [ARCHITECTURE.md](ARCHITECTURE.md) · [wrangler.jsonc.draft](wrangler.jsonc.draft) · [SEO_PARITY.md](SEO_PARITY.md) · [AGENTS.md](AGENTS.md) · [RISKS.md](RISKS.md)

This document is brief §7 item 8 (today vs target monthly estimate) and the evidence for brief §2 constraint 6 ("keep monthly infra cost at or below today's Vercel + VPS cost"). It expands plan §11. The cost gate itself is Phase 6 exit gate item 3 and the 30-day cost report P6-7 in [PLAN.md](PLAN.md); this file is the estimate that the report will be checked against. Cost risks are R-55 to R-58 in [RISKS.md](RISKS.md).

## 0. Conventions and sources

| Convention | Meaning |
|---|---|
| **LP** | Vendor list price or included quota read from the vendor's pricing page on 2026-09-30 (§11 lists the pages); list price — re-check at execution |
| **plan §n** | Section n of the approved plan of 2026-09-27 (the Phase 0 planning proposal; its decisions are carried into [README.md](README.md) and [PLAN.md](PLAN.md)) |
| **§15a** | CF docs (verified 2026-09-27), plan §15a; the Containers rates were fetched again on 2026-09-30 and are unchanged |
| **live** | live 2026-09-30 (Vercel API, DNS, Supabase snapshot in the planning record) |
| **A** | Assumption. No measured request volume exists (§4), so traffic and workload are three explicit scenarios |
| Currency | Cloudflare, Vercel, Resend and LLM prices in USD; EUR where the baseline is EUR. Planning rate **USD 1 = EUR 0.90** (assumption, deliberately high so that USD targets are not understated in EUR; re-check) |
| Month | 30 days = 720 h; working month = 22 days |
| Scope | Infrastructure that the migration changes (Vercel, VPS, CI compute, Cloudflare). Supabase, Resend, AWS S3, domains, Google Workspace and LLM APIs exist today and are listed but kept out of the gate |
| Tax | All amounts exclude VAT |

## 1. Summary: today vs target (steady state after Phase 6)

V = today's VPS cost for `sheet-metal-service`, unknown (PLAN.md Q2). Which baseline the gate uses is PLAN.md Q14 (recommended default: Baseline B).

| Line | Baseline A: Vercel Hobby | Baseline B: Vercel Pro | Target low | Target expected | Target high |
|---|---|---|---|---|---|
| Vercel | €0 | $20 ≈ €18.00 (1 seat) | — | — | — |
| VPS | V | V | — (decommissioned in Phase 6) | — | — |
| GitHub Actions | $0 | $0 | $0 | $0 | $0 |
| Workers Paid subscription | — | — | $5.00 | $5.00 | $5.00 |
| Cloudflare usage above included quotas (§3) | — | — | $0.00 | $0.00 | $2.24 |
| Containers, `standard-1`, `sleepAfter` 10 min, no keep-warm (§5) | — | — | $0.20 | $2.07 | $12.12 |
| **Total** | **€0 + V** | **€18.00 + V** | **$5.20 ≈ €4.68** | **$7.07 ≈ €6.36** | **$19.36 ≈ €17.42** |
| Variant: business-hours keep-warm (§5) | — | — | — | $13.56 ≈ €12.20 | — |
| Variant: `standard-2` instead of `standard-1` | — | — | $5.37 ≈ €4.83 | $7.96 ≈ €7.16 | $25.06 ≈ €22.55 |

Reading: at the expected load the target is about $7 a month (about $13.50 with a business-hours keep-warm); plan §11 estimated $8–15. The Workers Paid subscription is almost the whole bill; every per-request product stays inside its included quota up to roughly 25,000 HTML page requests a day (§7). Verdict in §8.

## 2. Today: line items

| Item | Today | Monthly cost | Source | In the gate? | After the migration |
|---|---|---|---|---|---|
| Vercel (project `prj_jsmi2AIFypu8dPv2AQBxyWyFhSKZ`, team `dimitrisvards-projects`) | Hobby plan: the 12-function ceiling is documented in the code | €0 (A) or $20 per developer seat on Pro with a $20 usage credit (B) | api/gsc.js:4; docs/gsc-manual-setup-runbook.md:22; billing-charges API answered "Plan not found" (live), consistent with Hobby; Vercel pricing page: Hobby is for non-commercial personal projects, Pro $20/mo (LP) | Yes | Removed in Phase 6 (paused 30 days first) |
| VPS for `sheet-metal-service` | Docker container, 1 GiB memory limit, host not recorded | V (unknown, PLAN.md Q2) | sheet-metal-service/docker-compose.yml:18-21; sheet-metal-service/README.md:38-42 | Yes | Replaced by the `microns-cad` Container (P5-6); decommissioned in Phase 6 |
| GitHub Actions | `xometry-scan.yml` 7 runs/day; `auto-merge-claude.yml` | $0: free for public repositories on standard GitHub-hosted runners (GitHub billing docs, LP) | .github/workflows/xometry-scan.yml:21 | Yes, as $0 | Scan moves to a Cron Trigger (P5-5). If the repository is made private (PLAN.md Q18), GitHub Free includes 2,000 minutes/month for private repositories (LP) |
| Supabase (project `cfjrtmtaitwzggzpkhxi`) | Postgres, Auth, Storage, 40 edge functions, 10 pg_cron jobs | Unknown tier (PLAN.md Q2). Free $0; Pro from $25/month with 250 GB egress (LP) | live | No, unchanged | Unchanged through Phase 6 (brief constraint 3); see §10 for optional Phase 7 |
| AWS S3 (eu-north-1, `rfq` and `articles` scopes) | 755 article images referenced by `*.amazonaws.com` URLs; legacy RFQ keys | Small, not measured (storage plus egress for article images) | api/s3.js; live (755 rows) | No | Read-only for legacy objects (PLAN.md Q11); new objects go to R2 |
| Resend | Transactional and campaign mail | Plan unknown. Free: 3,000 mails/month, 100/day; Pro from $20 for 50,000 (LP) | package.json:95 | No | Unchanged (brief constraint 4) |
| LLM APIs | Anthropic for article generation; Gemini for translation | ≈ $3/month article generation plus $0–8 translation (§6) | supabase/functions/generate-daily-article/index.ts:183; supabase/functions/translate-article/index.ts:63-76 | No (separate LLM budget, PLAN.md Q20) | Routed through AI Gateway `microns` (§6) |
| Domain `micronshub.eu` | Registrar and DNS at Papaki | Registrar fee not recorded; unchanged | live (NS `dns1/dns2.papaki.gr`) | No | Registrar unchanged; DNS moves to a Cloudflare Free zone ($0, plan §7) |
| Google Workspace, Telegram, Apollo, GA4/Ads | MX, 2 sender accounts, bots, lead data, tags | Unchanged | live | No | Unchanged |

Request volume could not be read from Vercel: grouped runtime-log counts returned 96 middleware log lines for 24 h but 82 for 7 d (live), i.e. log lines on a short-retention plan, not requests; there is no Vercel Analytics (plan C11), and production probes are challenged (H-1). §4 therefore uses scenarios.

## 3. Target: line items per Cloudflare product

Included quotas and overage prices are Workers Paid figures (LP) unless stated. Usage per month from §4; costs are the overage above the included quota.

| Product | Included | Overage price | Usage per month: low / expected / high | Cost: low / expected / high |
|---|---|---|---|---|
| Workers Paid subscription | Account plan | $5.00/month | — | $5.00 / $5.00 / $5.00 |
| Workers requests (all Workers; Cron and Queue consumer invocations count; service-binding hops do not; subrequests are not billed) | 10M | $0.30 per M | 0.47M / 1.59M / 7.18M | $0 / $0 / $0 |
| Workers CPU | 30M ms | $0.02 per M ms | 1.9M / 7.9M / 45.2M ms | $0 / $0 / $0.30 |
| Static Assets | Free and unlimited when the Worker is not invoked; with `run_worker_first: true` every asset hit is a billed Worker request (counted above) | — | — | $0 |
| KV reads (`SEO_CACHE`, `FLAGS`) | 10M | $0.50 per M | 0.18M / 0.6M / 2.4M | $0 / $0 / $0 |
| KV writes | 1M | $5.00 per M | 0.17M / 0.51M / 1.27M | $0 / $0 / $1.34 |
| KV storage | 1 GB | $0.50 per GB-month | < 0.05 GB | $0 |
| R2 storage (`microns-public`, `microns-private`) | 10 GB-month | $0.015 per GB-month | 0.1 / 1 / 5 GB | $0 |
| R2 Class A (writes) / Class B (reads) | 1M / 10M | $4.50 per M / $0.36 per M | A 1k / 5k / 30k; B 10k / 100k / 1M | $0 |
| R2 egress (custom domain `files.micronshub.eu`, Workers, S3 API) | Free | — | — | $0 |
| Queues (5 queues + DLQs) | 1M operations; 3 operations per message ≤ 64 KB; each retry adds a read | $0.40 per M | 28k / 101k / 669k ops | $0 |
| Durable Objects requests | 1M | $0.15 per M | 2k / 7k / 40k | $0 |
| Durable Objects duration (128 MB per active object; the `CadContainer` DO is active while its container is awake) | 400,000 GB-s | $12.50 per M GB-s | 5k / 30k / 140k GB-s | $0 |
| Durable Objects SQLite (rows, storage) | 25B rows read, 50M written, 5 GB | $0.001 / $1.00 per M rows; $0.20 per GB-month | Thousands of rows | $0 |
| Workflows (6 Workflows) | 10M requests, 30M CPU ms, 500,000 steps, 1 GB-month; step and storage billing since 2026-08-10 | $0.30 per M; $0.80 per 100k steps; $0.20 per GB-month | 1.6k / 7.4k / 26.7k steps | $0 |
| Cron Triggers | Billed as Workers requests and CPU; 250 per account | — | 52,800 invocations (in the request row) | $0 |
| Containers (`microns-cad`) | 25 GiB-h memory, 375 vCPU-min, 200 GB-h disk, 1 TB egress (Europe) | $0.0000025 per GiB-s, $0.000020 per vCPU-s (active usage), $0.00000007 per GB-s, $0.025 per GB | 11.7 / 61.7 / 300 awake hours (`standard-1`) | $0.20 / $2.07 / $12.12 (§5) |
| Browser Rendering (`BROWSER`) | 10 browser-hours; 10 concurrent browsers (monthly average of daily peaks) | $0.09 per hour; $2.00 per extra browser | 0.5 / 1.5 / 16.7 h; ≤ 2 concurrent | $0 / $0 / $0.60 |
| Vectorize (`quotes-v1`, 1024 dims) | 50M queried dims; 10M stored dims | $0.01 per M queried; $0.05 per 100M stored | Stored 0.2M / 2.0M / 20.5M; queried 0.5M / 3.9M / 31M | $0 / $0 / < $0.01 |
| Workers AI (`@cf/baai/bge-m3` for the `embed` route) | 10,000 neurons/day; bge-m3 = 1,075 neurons per M input tokens (≈ 9.3M tokens/day free) | $0.011 per 1,000 neurons ($0.012 per M bge-m3 tokens) | < 1M tokens | $0 |
| AI Gateway (`microns`) | Core features free (analytics, caching, rate limits); logs for gateways created after 2026-09-24 follow Workers Logs pricing | Workers Logs price | 0.7k / 3.5k / 16.5k requests | $0 |
| Email Routing + `microns-mail` | Email Routing free on all plans; Worker invocations counted as requests (conservative) | — | 30 / 300 / 1,200 messages | $0 |
| Access (preview host, `api.micronshub.eu` from Phase 3, `mcp.micronshub.eu`) | Zero Trust Free up to 50 users (Cloudflare Zero Trust plans page, search result 2026-09-30; re-check) | Standalone Access ≈ $3 per user (same source; re-check) | 1–3 users plus service tokens (CI, `microns-machine-collector`, `microns-machine-mcp`) | $0 |
| Turnstile | Free plan: 20 widgets, unlimited challenges | — | 1 widget for the two forms (test keys in Phase 2) | $0 |
| Workers Rate Limiting (`API_RATE_LIMIT`, `API_RATE_LIMIT_MAIL`, `API_RATE_LIMIT_BULK`) | No separate line on the Workers pricing page (re-check) | — | — | $0 |
| Analytics Engine (`microns_events`) | 10M data points, 1M read queries; billing not active yet | $0.25 per M points; $1.00 per M queries | < 0.1M points | $0 |
| Workers Logs | 20M events/month, 7-day retention | $0.60 per M | ≈ 2 per request: 0.9M / 3.2M / 14.4M | $0 |
| Hyperdrive `SUPABASE_DB` (optional) | Unlimited queries on Workers Paid | — | Xometry upserts | $0 |
| Zone `micronshub.eu`, Cloudflare for SaaS | Free zone plan (plan §7); SaaS deferred (C8), 100 hostnames free (plan §11; re-check) | — | — | $0 |
| **Total** | | | | **$5.20 / $7.07 / $19.36** |

## 4. Traffic and workload assumptions

All rows are A unless a source is given. Basis: ≈ 2,610 public URLs (CANON count: 2,344 articles, 98 service pages, 126 content pages, 14 × 3 static; live). Replace the first six rows with measured values at P0-3 (GSC crawl stats: total crawl requests per day; GA4 page views per day).

| # | Quantity | Low | Expected | High | Basis / formula |
|---|---|---|---|---|---|
| 1 | Human page views/day | 500 | 2,000 | 10,000 | A |
| 2 | Bot HTML fetches/day (Googlebot, Bingbot, AI crawlers, SEO tools) | 2,500 | 8,000 | 30,000 | A; bots see every language route because the SEO body is served to all clients (plan §3) |
| 3 | HTML document requests/day (1 + 2) | 3,000 | 10,000 | 40,000 | Sum |
| 4 | Asset requests/day through the Worker | 10,000 | 38,000 | 180,000 | Humans × 15 + bots × 1 (A); all billed because `run_worker_first: true` (wrangler.jsonc.draft:114) |
| 5 | `/api/*`, sitemap and other requests/day | 500 | 2,000 | 10,000 | A |
| 6 | `microns-site` requests/month | 0.41M | 1.50M | 6.90M | (3 + 4 + 5) × 30 |
| 7 | SEO handler CPU per HTML request | 5 ms | 8 ms | 15 ms | A (string rewrite of the shell plus rendering); measure in Phase 1 from Workers Logs |
| 8 | CPU per asset hit / per API request | 1 ms / 5 ms | 1 ms / 5 ms | 1 ms / 5 ms | A |
| 9 | Supabase REST calls per uncached HTML request | 0–3 | 0–3 | 0–3 | Homepage 1 (middleware.ts:448), services index 2 (:477), service 1 (:492), blog index 1 (:517), content page 2–3 (:542, :555), article 2 (:598, :615); about/contact/quote/our-work 0 |
| 10 | Supabase REST calls/month from the SEO handler | ≈ 0.17M | ≈ 0.5M | ≈ 1.3M | ≈ KV writes (row 12): KV `SEO_CACHE` 1 h in front of Supabase ([ARCHITECTURE.md](ARCHITECTURE.md) §17); same order as today's per-isolate caches (middleware.ts:44, :193); Supabase tier unchanged |
| 11 | KV reads/month | 0.18M | 0.60M | 2.40M | Row 3 × 2 keys × 30 (every request misses the isolate cache: upper bound) |
| 12 | KV writes/month | 0.17M | 0.51M | 1.27M | Row 3 × 2 keys × share of requests arriving > 1 h after the key's last write, e^(−r/24) with r = row 3 ÷ 2,610 requests per URL per day (0.95 / 0.85 / 0.53) × 30. Upper bound: ≈ 4,000 keys × 24 × 30 = 2.9M |
| 13 | Sitemap requests/day | 20 | 50 | 200 | A; Cache API 1 h, so at most one Supabase Storage fetch per data centre per hour (H-12); Cache API calls not billed |
| 14 | `microns-ops` API calls/day (over `OPS`) | 100 | 500 | 2,000 | A; not billed as requests (service binding), CPU 20 ms each |
| 15 | Cron invocations/month | 52,800 | 52,800 | 52,800 | CANON §6 per day: 07:00 → 1; */15 → 96; */30 (reddit tier2 + hn share one expression) → 48; hourly → 24; 06:00 → 1; Xometry 7; Monday 06:30 → 0.14; every minute → 1,440; */10 → 144; sum 1,761.1 × 30 |
| 16 | Queue messages/day | 316 | 1,122 | 7,430 | Reddit 168 ticks × 1 / 5 / 40 due subreddits (cap 40, supabase/functions/reddit-collector/index.ts:263-264); HN 48 / 96 / 144; tenders 26 connectors; Xometry 7; translations 13; `cad-jobs` 4 / 30 / 120; `agent-events` 20 / 50 / 200; `outbound-mail` 30 / 60 / 200 |
| 17 | Queue operations/month | 28k | 101k | 669k | Row 16 × 3 ops × 30 (messages < 64 KB) |
| 18 | `microns-ops` CPU/month | 1.1M ms | 4.0M ms | 20.4M ms | Crons 52,800 × 10 ms; consumers row 16 × 30 × 50 ms; API row 14 × 30 × 20 ms; `nest` 0 / 1 / 5 per day × 50 s (H-18; `limits.cpu_ms` 300,000 since Phase 2 is a cap, CPU is billed as used; real CPU per run read from the preview logs at P2-12) |
| 19 | Workflow runs/month | 112 | 544 | 1,984 | `rfq-intake` 30 / 300 / 1,200; `quote` 15 / 150 / 600; `post-order` 3 / 30 / 120; `content-daily` 30; `sitemap` 30; `ops-digest` 4.3 (expected = AGENTS.md §8 planning load) |
| 20 | Workflow steps/month | 1.6k | 7.4k | 26.7k | Steps per run: `rfq-intake` 13 (AGENTS.md §3.1), `quote` 15, `post-order` 10, `content-daily` 25, `sitemap` 5, `ops-digest` 5 |
| 21 | CAD bursts/day × jobs per burst | 2 × 2 | 10 × 3 | 40 × 3 | A; 3 jobs per quote (AGENTS.md §3.2) |
| 22 | Container unfold time/day on `standard-1` (work) | 2.7 min (80 vCPU-s) | 20 min (600 vCPU-s) | 80 min (2,400 vCPU-s) | Row 21 × 40 s per job at ½ vCPU = 20 vCPU-s per job (AGENTS.md §3.2) |
| 23 | Container awake hours/month (`standard-1`) | 11.7 | 61.7 | 300 | Bursts × (20 s cold start + jobs × 40 s + 600 s `sleepAfter` tail) × 30; high capped at a 10 h business day |
| 24 | Browser Rendering time/month | 30 min (0.5 h) | 90 min (1.5 h) | 1,000 min (16.7 h) | Scans 10 / 30 / 200 × 3 / 3 / 5 min (A; scrapers on demand, AGENTS.md §3.4) |
| 25 | Vectorize vectors × dims; queries/month | 200 × 1024; 300 | 2,000 × 1024; 1,800 | 20,000 × 1024; 10,000 | Tender scoring ≈ 50/day plus quote similarity; queried dims = (queries + stored vectors) × 1024 |
| 26 | AI Gateway requests/month | 700 | 3,500 | 16,500 | LLM and embed calls of §6 (expected: RFQ 900, quote 600, post-order 60, content 420, digest 4, tender embeddings ≈ 1,500) |
| 27 | R2 storage | 0.1 GB | 1 GB | 5 GB | RFQ files, raw e-mail, CAD outputs, quote PDFs, sitemaps (17 files, 6.76 MB live), new article images |
| 28 | R2 operations/month: Class A (writes) / Class B (reads) | 1k / 10k | 5k / 100k | 30k / 1M | Writes: e-mail + attachments ≈ 4 per RFQ, CAD outputs ≈ 3 per job, 17 sitemap files + 1 image per day; reads: CAD inputs, signed downloads, `files.micronshub.eu` cache misses, sitemap reads on Cache API misses (A) |
| 29 | Worker requests, all Workers, per month | 0.47M | 1.59M | 7.18M | Row 6 + row 15 + consumer invocations (row 16 × 30, batch 1) + e-mails |

## 5. Containers deep-dive (`microns-cad`)

Rates (§15a, fetched again 2026-09-30; list price — re-check at execution): memory $0.0000025 per GiB-s = **$0.009 per GiB-h**; CPU $0.000020 per vCPU-s = **$0.0012 per vCPU-min**, billed on active usage only; disk $0.00000007 per GB-s = **$0.000252 per GB-h**; memory and disk are billed on provisioned size while the instance is awake. Included per month: 25 GiB-h, 375 vCPU-min, 200 GB-h. Billing starts when a request reaches the container and stops when it sleeps. Instance types: `basic` ¼ vCPU 1 GiB 4 GB; `standard-1` ½ vCPU 4 GiB 8 GB; `standard-2` 1 vCPU 6 GiB 12 GB. Draft settings: `instance_type` `standard-1`, `max_instances` 3 (wrangler.jsonc.draft:419-421), `sleepAfter` ≈ 10 min in the `CadContainer` class (wrangler.jsonc.draft:412); cold start 10–30 s, image ≈ 0.7–1 GB (plan §6 item 3).

Formula for H awake hours and W vCPU-min of work per month:
cost = max(0, GiB × H − 25) × $0.009 + max(0, GB × H − 200) × $0.000252 + max(0, W − 375) × $0.0012

| Case | Awake H/month | Memory | Disk | CPU | Total |
|---|---|---|---|---|---|
| `standard-1`, low (row 23) | 11.7 | (46.7 − 25) × 0.009 = $0.20 | 93 GB-h < 200: $0 | 40 vCPU-min < 375: $0 | **$0.20** |
| `standard-1`, expected | 61.7 | (246.7 − 25) × 0.009 = $2.00 | (493 − 200) × 0.000252 = $0.07 | 300 < 375: $0 | **$2.07** |
| `standard-1`, high | 300 | (1,200 − 25) × 0.009 = $10.58 | (2,400 − 200) × 0.000252 = $0.55 | (1,200 − 375) × 0.0012 = $0.99 | **$12.12** |
| `standard-2`, low (job 20 s at 1 vCPU) | 11.0 | (66 − 25) × 0.009 = $0.37 | 132 < 200: $0 | $0 | **$0.37** |
| `standard-2`, expected | 56.7 | (340 − 25) × 0.009 = $2.84 | (680 − 200) × 0.000252 = $0.12 | $0 | **$2.96** |
| `standard-2`, high | 300 | (1,800 − 25) × 0.009 = $15.98 | (3,600 − 200) × 0.000252 = $0.86 | $0.99 | **$17.82** |
| Keep-warm 10 h × 22 working days + 20 % of expected bursts off-hours, `standard-1` | 232.3 | (929 − 25) × 0.009 = $8.14 | (1,859 − 200) × 0.000252 = $0.42 | $0 | **$8.56** |
| Same keep-warm, `standard-2` | 232.3 | (1,394 − 25) × 0.009 = $12.32 | (2,788 − 200) × 0.000252 = $0.65 | $0 | **$12.97** |
| Same keep-warm, `basic` (only if the memory measurement allows it, below) | 232.3 | (232 − 25) × 0.009 = $1.87 | (929 − 200) × 0.000252 = $0.18 | $0 | **$2.05** |
| Always on, `standard-1`, 5 % busy | 720 | (2,880 − 25) × 0.009 = $25.70 | (5,760 − 200) × 0.000252 = $1.40 | (1,080 − 375) × 0.0012 = $0.85 | **$27.94** |
| Always on, `standard-1`, 100 % busy (the plan §11 and R-55 method) | 720 | $25.70 | $1.40 | (21,600 − 375) × 0.0012 = $25.47 | **$52.57** |
| Always on, `standard-2`, 5 % busy | 720 | (4,320 − 25) × 0.009 = $38.66 | (8,640 − 200) × 0.000252 = $2.13 | (2,160 − 375) × 0.0012 = $2.14 | **$42.92** |

Findings:

| # | Finding | Consequence |
|---|---|---|
| 1 | Memory, not CPU, drives the bill: beyond the included hours an awake `standard-1` costs ≈ $0.038 per hour even when idle (memory $0.036 + disk $0.002) | Awake time is the lever: keep `sleepAfter` ≈ 10 min and avoid fixed keep-warm unless cold starts hurt |
| 2 | Always-on costs $28–53/month (`standard-1`) or $43–92 (`standard-2`); plan §11 and R-55 quote ≈ $50–52 because they bill CPU as provisioned, while the pricing page of 2026-09-30 bills CPU on active usage | Avoid always-on in either reading; it alone exceeds Baseline B |
| 3 | Business-hours keep-warm adds ≈ $6.50/month over the expected on-demand case (`standard-1`) | Default off. The quote path is asynchronous (`cad-jobs` Queue), so a 10–30 s cold start is invisible there; prefer an on-demand pre-warm when a staff user opens an RFQ with CAD files |
| 4 | The service runs today under a 1 GiB memory limit (sheet-metal-service/docker-compose.yml:18-21), and its README says a single 512 MB VM handles typical unfold workloads (sheet-metal-service/README.md:41-42) | P5-6 should measure peak memory on the largest recent STEP files; if it stays well under 1 GiB, `basic` makes even keep-warm ≈ $2/month. Keep `standard-1` as the draft until measured |
| 5 | `max_instances` 3 equals the `cad-jobs` consumer `max_concurrency` 3 (wrangler.jsonc.draft:322) | Worst case is three instances awake at once: 3 × the per-instance figures above for the duration of a burst, never more |

## 6. LLM costs per agent run (separate from infrastructure)

LLM spend exists today (article generation and translation) and is budgeted separately: PLAN.md Q20 proposes a €50/month cap (≈ $55.60 at the planning rate). Token counts per step are from [AGENTS.md](AGENTS.md) §3; the planning load (10 RFQ e-mails, 5 quote versions, 1 order per day) is AGENTS.md §8.

| Route | Model class | Price per M tokens (in / out) | Source |
|---|---|---|---|
| `extract` | Current Sonnet-class, e.g. `claude-sonnet-5-5` | $2.00 / $10.00; cached input $0.20 | Anthropic model list (snapshot 2026-09-25); list price — re-check at execution |
| `classify` | Current Haiku-class, e.g. `claude-haiku-4-5` | $1.00 / $5.00 | Same |
| `translate` | Gemini Flash-class | P1 $0.30 / $2.50 (`gemini-2.5-flash`, `gemini-3.5-flash-lite`); P2 $0.75 / $3.75 (`gemini-3.8-flash`, until 2026-12-31); P3 $1.50 / $7.50 (same model from 2027-01-01); batch mode −50 % | ai.google.dev pricing page (LP) |
| `embed` | Workers AI `@cf/baai/bge-m3` | $0.012 per M input tokens, inside the free daily neurons | LP (§3) |

| Agent run | Steps (route: tokens in / out) | Formula | Per run | Runs/month | Per month |
|---|---|---|---|---|---|
| RFQ intake (`rfq-intake`) | triage `classify` 1,500 / 100; `extract` 9,000 / 1,200; classify-process `classify` 2,000 / 150 | 0.0015 + 0.0005 + 0.018 + 0.012 + 0.002 + 0.00075 = $0.035; AGENTS.md planning figure $0.04 covers the large-PDF path ($0.045) | $0.04 | 300 | $12.00 |
| Quote (`quote`, one version, one reply) | price-notes `extract` 10,000 / 1,500; cover-email `extract` 3,000 / 800; classify-reply 2,000 / 150; embed ≈ $0 | 0.035 + 0.014 + 0.003 = $0.052, plus CAD minutes | $0.06 | 150 | $9.00 |
| Post-order (`post-order`) | traveller-notes 3,000 / 500; reorder draft 2,000 / 400 when needed | 0.011 + 0.008 | $0.015 | 30 | $0.45 |
| Article + 13 translations (`content-daily`), price P1 | generate-en `extract` 3,000 / 6,000; 13 × `translate` 7,000 / 7,000 | 0.066 + 13 × (0.0021 + 0.0175) = 0.066 + 0.255 | $0.32/day | 30 | $9.60 |
| Same, price P2 | as above | 0.066 + 13 × (0.00525 + 0.02625) = 0.066 + 0.410 | $0.48/day | 30 | $14.27 |
| Same, price P3 | as above | 0.066 + 13 × (0.0105 + 0.0525) = 0.066 + 0.819 | $0.89/day | 30 | $26.55 |
| Ops digest (`ops-digest`) | narrative `extract` 4,000 / 600 | 0.008 + 0.006 | $0.014 | 4.3 | $0.06 |
| Growth (tenders, optional relevance) | `embed` ≈ 50 tenders; optional `classify` 10 × 1,500 / 100 | ≈ 0 + 0.02 | $0.02 | 30 | $0.60 |
| **Total at planning load** | | | | | **P1 $31.71 · P2 $36.38 · P3 $48.66** |

| Observation | Detail |
|---|---|
| Today | The current code generates with `claude-sonnet-4-20250514` (supabase/functions/generate-daily-article/index.ts:183), a model the Anthropic list marks deprecated; at its earlier list price of $3 / $15 (not re-verified) that is 3,000 × 3/10⁶ + 6,000 × 15/10⁶ = $0.099/day ≈ $3/month. Translation calls Gemini with a free-tier rate-limit comment (supabase/functions/translate-article/index.ts:63-76; live v81 may differ, H-26), so today's translation spend is between $0 and ≈ $7.64/month (13 × $0.0196 × 30) |
| At today's volume | ≈ $10/month (AGENTS.md §8), almost all of it the content pipeline |
| Headroom under Q20 | P3 prices at the planning load leave ≈ $7 of headroom under the €50 proposal; choose a Flash-Lite-class model for `translate`, or Gemini batch mode (−50 %) since the pipeline tolerates hours of delay |
| Price risk | Gemini Flash list prices double on 2027-01-01 for the newest models (P2 → P3); Anthropic Message Batches (−50 %) fit `generate-en`, which is not latency-sensitive (list price — re-check at execution) |

## 7. Sensitivity: when included quotas run out

"Threshold" is the traffic at which the quota is used up with the expected request mix of §4 (5 Worker requests per HTML document, 2.56 ms CPU per request); every figure scales linearly from §4.

| Quota | Included | Consumed by | Expected use | Threshold | Overage cost at 2 × threshold |
|---|---|---|---|---|---|
| Workers requests | 10M/month | Every Worker invocation incl. asset hits | 16 % | ≈ 333,000 requests/day ≈ 66,000 HTML documents/day | 10M × $0.30/M = $3.00 |
| Workers CPU | 30M ms/month | SEO rendering, consumers, `nest` | 26 % | ≈ 390,000 requests/day at 2.56 ms; ≈ 277,000 at the high-scenario mix (3.6 ms) | 30M × $0.02/M = $0.60 |
| KV writes | 1M/month | `SEO_CACHE` refresh after the 1 h TTL | 51 % | ≈ 25,000 HTML documents/day; bounded by keys × 24 × 30 ≈ 2.9M | Bounded: ≤ 1.9M × $5 = $9.50 |
| KV reads | 10M/month | 2 keys per HTML request | 6 % | ≈ 166,000 HTML documents/day | $5.00 |
| Workers Logs | 20M events/month | ≈ 2 events per request | 16 % | ≈ 333,000 requests/day (same as requests) | $12.00 (lower with `head_sampling_rate`) |
| Queues | 1M operations/month | 3 per message | 10 % | ≈ 11,100 messages/day (the reddit cap of 40 per tick alone gives at most 6,720) | $0.40 |
| Workflows steps | 500,000/month | Agent and content Workflows | 1.5 % | ≈ 38,000 RFQ intakes/month | 500k × $0.80/100k = $4.00 |
| Durable Objects requests | 1M/month | Limiter, stock, CAD router, RFQ threads (the remote MCP uses no Durable Object since the Phase 4 build) | < 1 % | ≈ 33,000/day | $0.15 |
| Containers memory | 25 GiB-h/month | Awake time × 4 GiB | 987 % (246.7 GiB-h) | ≈ 6.25 awake hours/month on `standard-1` (≈ 1 short burst/day) | Linear: ≈ $0.038 per awake hour |
| Browser Rendering | 10 h/month; 10 concurrent | Scrapers | 15 % | ≈ 200 scans of 3 min/month; concurrency capped at 2 | 10 h × $0.09 = $0.90 |
| R2 storage / Class A / Class B | 10 GB / 1M / 10M | Files, sitemaps, images | 10 % / 0.5 % / 1 % | 10 GB of new files | $0.15 / $4.50 / $3.60 |
| Vectorize stored dims | 10M | 1024 per vector | 20 % | ≈ 9,760 stored vectors | < $0.01 |
| Workers AI neurons | 10,000/day | bge-m3 embeddings | < 1 % | ≈ 9.3M tokens/day | $0.11 per extra 9.3M tokens |

Reading: the first per-request quota to run out is KV writes at ≈ 25,000 HTML documents a day, 2.5 × the expected load, and its overage is bounded at ≈ $9.50/month. Requests run out at ≈ 6.7 × the expected load; beyond that each extra 10M requests a month costs ≈ $3.50 (requests $3.00 + CPU ≈ $0.50) plus ≈ $12 of Workers Logs unless `head_sampling_rate` is lowered (§9 row 12). Containers are the only item billed from normal use, which is why §5 and §9 focus on awake time.

## 8. Cost gate verdict

The gate is "target ≤ baseline" for the lines that change (Vercel, VPS, CI compute, Cloudflare). EUR at the planning rate.

| Target case | Target | Baseline A (€0 + V) is met when | Baseline B (€18.00 + V) is met when |
|---|---|---|---|
| Low, `standard-1` | $5.20 ≈ €4.68 | V ≥ €4.68 | Always |
| Expected, no keep-warm | $7.07 ≈ €6.36 | V ≥ €6.36 | Always |
| Expected, business-hours keep-warm | $13.56 ≈ €12.20 | V ≥ €12.20 | Always |
| High, `standard-1` | $19.36 ≈ €17.42 | V ≥ €17.42 | Always |
| High, `standard-2` | $25.06 ≈ €22.55 | V ≥ €22.55 | V ≥ €4.55 |

| Verdict | Detail |
|---|---|
| Baseline B (PLAN.md Q14 recommended default) | **Met** at every modelled load with `standard-1`, whatever the VPS costs; margin at the expected load ≈ €11.60 + V per month |
| Baseline A | **Conditional on V (PLAN.md Q2)**: met at the expected load if the VPS costs at least ≈ €6.40/month (≈ €12.20 with keep-warm). If V is lower, the migration costs at most ≈ €6.40 − V more per month at the expected load, in exchange for leaving a plan whose terms exclude commercial use and for removing the VPS |
| During the migration (Phases 0–5) | Costs are additive: Workers Paid $5/month from P0-8, while Vercel and the VPS keep running until Phase 6 (≈ 4 months on the PLAN.md calendar ≈ $20 one-off), plus Container minutes in parallel with the VPS during the Phase 5 parity window |
| What decides | The estimate is not the gate. The gate is the measured 30-day cost report (P6-7) after decommission, compared with the baseline chosen in Q14 and the V given in Q2 |

## 9. Cost controls

| # | Control | Where | Setting | Effect | Phase |
|---|---|---|---|---|---|
| 1 | Cloudflare budget alerts | Account billing | Account-wide USD thresholds, e.g. $10 and $20; e-mail only, they do not pause or cap usage (CF billing docs, LP) | Early warning on any product | P0-8 |
| 2 | Usage-based billing notifications | Notifications | Per-product thresholds (Pay-as-you-go accounts), e.g. Workers requests 7M/month, Containers above the included GiB-h | Warns per product before overage | P0-8, P5-6 |
| 3 | AI Gateway spend limits | Gateway `microns` | Dollar budget per rolling or fixed window, split by the `agent` metadata key; action 429 (block) or fall back to a cheaper model; applies to BYOK requests for models with known pricing (CF docs, fetched 2026-09-30; open beta per changelog, re-check) | Hard cap for PLAN.md Q20, e.g. €50/month expressed as a daily budget | P4-3 |
| 4 | AI Gateway rate limits | Gateway `microns` | Not configured in Phase 4 (PLAN.md §5.4 DC-19, DF-83): a rate-limit 429 would park runs that need no human; controls 3 and 6 bound the request rate | — | P4-3 |
| 5 | Provider-side limits | Anthropic Console, Google AI Studio | Monthly spend limit at each provider (re-check at execution) | Backstop if a call bypasses the gateway | P4-3 |
| 6 | Per-agent run caps | `feature_flags` values (`max_runs_per_day`, `llm_cap`) | `max_runs_per_day` default 200 per agent and UTC day (built in Phase 4: above it a run closes `skipped` before any LLM call); `llm_cap` AGENTS.md §3.4; R-56 | Limits cost per agent | P4 |
| 7 | Container awake time | `CadContainer`, wrangler.jsonc.draft:419-421 | `sleepAfter` ≈ 10 min; keep-warm off by default, on-demand pre-warm; `max_instances` 3; enforced wall-clock in `sheet-metal-service/main.py` (`PROCESSING_TIMEOUT` sheet-metal-service/config.py:37) | Bounds awake hours (§5) | P5-6 |
| 8 | CAD queue concurrency | `cad-jobs` consumer, wrangler.jsonc.draft:322 | `max_concurrency` 3 = `max_instances`; `max_retries` 2 with DLQ | No extra instances from retries | P4, P5-6 |
| 9 | Browser Rendering concurrency | `scrapes` consumer, wrangler.jsonc.draft:311-313 | `max_batch_size` 1, `max_concurrency` 2; page cap per scan; one browser per invocation, closed in `finally`; browser only for client-rendered pages of owner-permitted hosts (built in Phase 4) | Stays under 10 concurrent browsers and 10 h | P4-10 |
| 10 | Narrow `run_worker_first` | `microns-site` assets config ([ARCHITECTURE.md](ARCHITECTURE.md) §6.1) | After the Phase 3 gate, a glob array that leaves hashed `/assets/*` to the asset layer, validated by a full parity run (R-57) | Removes ≈ 76 % of expected requests (38,000 of 50,000/day) from billing | Phase 6 |
| 11 | KV write discipline | SEO handler (P1-4), flag mirror (P4-2) | Write only on a KV miss; keep 30 s negative results in the isolate `Map` rather than KV ([ARCHITECTURE.md](ARCHITECTURE.md) §17 currently stores them in KV), so bot probes of unknown slugs do not create KV writes; mirror `FLAGS` only when a flag changes | Keeps writes ≤ keys × 24 per day | Phases 1, 4 |
| 12 | Log volume | `observability.head_sampling_rate` (wrangler.jsonc.draft:92, :249) | 1 until the Phase 3 exit gate (zero-5xx check needs full logs); lower for `microns-site` if events approach 20M/month | Keeps Workers Logs in quota | Phase 6 |
| 13 | Retry hygiene | All Queue consumers | `max_retries` and a `<name>-dlq` per queue (CANON §3) | Retries cost 1 read each; DLQs end loops | P2–P5 |
| 14 | Monthly review | `agent_runs.cost_cents`, AI Gateway analytics, Cloudflare billable-usage dashboard, weekly ops digest | Compare with §3 and §6 monthly; the 30-day report P6-7 closes the gate | Detects drift | P4 onwards |

## 10. Optional Phase 7 cost delta (Supabase → D1)

| Item | Cost | Source |
|---|---|---|
| D1 `microns-db` | Workers Paid includes 25B rows read and 50M rows written per month and 5 GB storage; overage $0.001 per M rows read, $1.00 per M rows written, $0.75 per GB-month | CF D1 pricing page (LP) |
| Expected D1 usage | Small tables (articles 2,344, leads 700, customers 21, rfqs 2; 72 tables, live); SEO reads well inside 25B rows/month → ≈ $0 incremental | live; A |
| `RealtimeHub` Durable Object | WebSocket hibernation: no duration charge while idle; requests inside the 1M quota → ≈ $0 | CF Durable Objects pricing page (LP) |
| Auth replacement (PLAN.md Q23) | Workers-native library: no separate fee, bcrypt verification CPU inside the Workers CPU quota; a hosted IdP would add its own fee (not priced here) | PLAN.md P7-3 |
| Removed: Supabase plan | Saving = the current plan price (tier unknown, PLAN.md Q2): $0 if Free; at least $25/month if Pro (LP) | supabase.com pricing page |
| Net | Between $0 and the Supabase plan price saved per month, less any hosted-IdP fee | — |

## 11. Verification record

Pages read on 2026-09-30 (list price — re-check at execution):

| Product | Page | Figures used |
|---|---|---|
| Workers, KV, Queues, DO, Workflows, Logs, Hyperdrive, Vectorize | developers.cloudflare.com/workers/platform/pricing/ and the product pricing pages (`/kv/`, `/queues/`, `/durable-objects/`, `/workflows/`, `/vectorize/`, `/hyperdrive/`) | §3 rows; service-binding, Cron and subrequest billing notes |
| Static Assets billing | developers.cloudflare.com/workers/static-assets/billing-and-limitations/ | `run_worker_first` makes asset hits billable |
| Workers limits | developers.cloudflare.com/workers/platform/limits/ | 250 Cron Triggers per account; CPU limits |
| R2 | developers.cloudflare.com/r2/pricing/ | Storage, Class A/B, free egress |
| Containers | developers.cloudflare.com/containers/pricing/ | §5 rates, instance types, active-CPU billing |
| Browser Rendering | developers.cloudflare.com/browser-rendering/pricing/ (the page is titled "Browser Run" on this date) | 10 h, 10 concurrent, $0.09/h, $2/browser |
| Workers AI, AI Gateway | developers.cloudflare.com/workers-ai/platform/pricing/; /ai-gateway/reference/pricing/; /ai-gateway/features/spend-limits/; /ai-gateway/features/rate-limiting/ | bge-m3 price, free neurons, gateway logs, spend limits |
| Email Routing, Turnstile, Analytics Engine, D1 | developers.cloudflare.com/email-routing/ and /email-routing/limits/; /turnstile/plans/; /analytics/analytics-engine/pricing/; /d1/platform/pricing/ | Free routing, 25 MiB inbound; free Turnstile; AE billing inactive; §10 |
| Billing alerts | developers.cloudflare.com/billing/manage/budget-alerts/; /notifications/notification-available/ | §9 rows 1–2 |
| Access | Cloudflare Zero Trust plans (web search result; the plans page did not render) | 50 free users; re-check |
| Vercel, GitHub, Resend, Supabase, Gemini | vercel.com/pricing; docs.github.com Actions billing; resend.com/pricing; supabase.com/pricing; ai.google.dev/gemini-api/docs/pricing | §2 and §6 |
| Anthropic models | Anthropic model list bundled with the Claude API reference (snapshot 2026-09-25) | `extract` and `classify` prices |
| Vercel usage | Vercel API (read-only): runtime-log counts and billing charges | No usable request volume; "Plan not found" |

Not verified in this pass: VPS provider and price (Q2), Supabase and Resend plan tiers, AWS S3 monthly bill, Papaki registrar fee, the Cloudflare Pro zone price (not planned), and the earlier Sonnet 4 list price used for today's article cost.
