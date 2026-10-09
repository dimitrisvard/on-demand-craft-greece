# Phase 5 build spec: consolidate compute (P5-1…P5-9)

Status: Phase 5 build specification (design only) · 2026-10-03, completed 2026-10-04, critique applied 2026-10-04 (Appendix C, "Critique log") · scratch (not in the repo) · nothing here is built, deployed, committed or applied.

Related (repo): docs/migration/PLAN.md §5.5 (authoritative task list, file list, exit gate and rollback: PLAN.md:362-409) · docs/migration/AGENTS.md §1.1, §2.1-§2.5, §3.4-§3.6, §5 · docs/migration/wrangler.jsonc.draft:255-521 · ARCHITECTURE.md · COSTS.md · RISKS.md · INVENTORY.md. Related (scratch): `../phase2/PHASE2_SPEC.md` (layout this builds on), `../phase4/agents.md`, `../phase4/data.md`, `../phase4/surfaces.md` (Phase 4 design; the consolidated Phase 4 spec `../phase4/PHASE4_SPEC.md` is cited as **P4 §x / F4-n / CR-n / DF-n / R-n / G4-n** (by section and ID only, because the file is still edited in parallel; re-read 2026-10-04 09:15 UTC with its own critique applied)), the three Phase 5 analyses `jobs.md`, `reconcile.md`, `xometry-cad.md` (this folder), canon CANON.md + CANON_ADDENDUM.md (cd2d8729 scratchpad).

> **Handling.** §0-§12 and Appendix C follow the public-repo rules of CANON.md §1 (no secret values, security at summary level, no description of today's weaknesses beyond the sanitised hazard wording) and may be quoted in repo docs, PRs or handed to any builder. **Appendix P is PRIVATE**: never copy it, or anything it says, into the repository, a commit message, a PR, a code comment or a log line (the GitHub repository is public). Builders of units D5, M5 and O5 read Appendix P together with `../phase2/gates_PRIVATE.md`; the others do not need it.

Evidence tags:

| Tag | Meaning |
|---|---|
| `path:line` | Repo, branch `claude/microns-cloudflare-migration-j6ffpt`, HEAD `91f1376` (2026-10-04). Between `90d2391` (Phase 1 close) and `91f1376` only `workers/**` changed (Phase 2 Wave 0 and unit builds, `git diff --name-only 90d2391 HEAD`), so every citation outside `workers/` is exact at both commits; Phase 2 files cited as landed were re-read on 2026-10-04 |
| live 2026-10-03 / 2026-10-04 | Read-only Supabase MCP (`execute_sql` SELECT, `get_edge_function`) on project `cfjrtmtaitwzggzpkhxi`; first pass 2026-10-03 20:29 UTC (cron jobs, titles left, `xometry_offers` rows, newest article per language, sender accounts, tender connectors); re-check 2026-10-04 08:10 UTC (cron jobs, titles left, newest article per language, `xometry_offers` rows, newest HN lead, sitemap object time) |
| skill (2026-10-04) | Bundled `claude-api` skill, model table cached 2026-09-25 (`claude-sonnet-5` and `claude-sonnet-5-5` both listed at $2.00 / $10.00 per MTok; omitting `thinking` on Sonnet 5 runs adaptive thinking) |
| CF docs (fetched 2026-10-03 / 2026-10-02) | developers.cloudflare.com pages, copies in `../phase4/cfdocs/` and `../phase2/cfdocs/` (file name = doc path with `/` → `_`), or fetched by the analyses (page "last updated" date given where it matters) |
| jobs §x / rec §x / xc §x | `jobs.md`, `reconcile.md`, `xometry-cad.md` in this folder (each cites its own evidence) |
| P2 / P4 / data / surf | `PHASE2_SPEC.md`, `phase4/agents.md`, `phase4/data.md`, `phase4/surfaces.md` section or decision ID |

---

## 0. Ground rules for every builder

| # | Rule | Evidence |
|---|---|---|
| G5-1 | Phase 2 G-1…G-9 and Phase 4 R-1…R-9 apply unchanged: one owner unit per file; never deploy, upload, `secret put`, `queues create`; never call `www.micronshub.eu`, the apex or `*.vercel.app` (this runner gets HTTP 429 pages); Supabase read-only and only where a unit says so; public-repo literal rules; log prefixes `[microns-site]`, `[microns-ops]`, `[microns-cad]`; toolchain pins wrangler 4.145.0, vitest 5.0.3, TypeScript 7.0.2, workers-types 5.20260930.2, Node 22; British spelling; no emojis | P2 §0; P4 §0 |
| G5-2 | Files outside your unit are read-only. Phase 1, 2 and 4 files change **only** at the extension points of §3.2, and only by the unit named there | PLAN.md:42 (one phase at a time) |
| G5-3 | Parity first: a ported job reproduces the live behaviour of 2026-10-03 (models, prompts, query order, DB writes, Telegram texts). Every deliberate difference is a row of §1 or §11 and either only adds output (retries, pagination, backfill, alerts) or blocks a bad write | PLAN.md:364 ("output parity"); H-29 |
| G5-4 | No SQL is applied, no edge function deployed or deleted, no flag or secret set by a builder. SQL files are written to the repo; every production step is an owner step of §10 | PLAN.md:44 |
| G5-5 | Every scheduled or queued Phase 5 unit of work that starts writes exactly one `agent_runs` row with an outcome (`succeeded`, `failed`, `skipped`). The dispatcher writes nothing for a job whose flag (or var) is off at its slot; a consumer that receives already-queued work after the flag was turned off closes its run `skipped` with `output.reason = 'flag_off'` (the message exists, so the row records what happened to it) | PLAN.md:375, :400 (gate item 5) |
| G5-6 | Every external effect sits behind a port with a T1 fake and a T2 HTTP stub (§5.4): the whole phase is testable in this container without a Cloudflare account, without Docker and without any real provider | P4 R-4 |
| G5-7 | Secret-looking test literals (JWT shapes, provider key prefixes, bot-token shapes) are built at runtime (`'ey' + 'J…'`); the scratch PGlite test of the switch-over SQL uses literal JWT shapes and must be rewritten that way when it moves into the repo | P2 G-5; `sqltest/test.mjs:10` |
| G5-8 | Work starts from the commit that closes Phase 4 (or with the owner's explicit OK on the preview-only branch). Never stage, revert or reformat another agent's changes | P2 G-4 |

---

## 1. Defaults chosen for the owner

Owner instruction: every open question takes the plan's recommended default; each choice is listed here for review (PLAN.md:45: doc changes need the owner's OK; §11 lists the doc deviations these choices cause).

### 1.1 PLAN.md questions that touch Phase 5

| # | Question | Default built | One-line reason | Source |
|---|---|---|---|---|
| Q2 | VPS spec/cost; Supabase tier | Information only; Container sized `standard-1`, `max_instances` 3 as in the draft | Measured RSS 0.39-0.43 GB, image 3 GB fits 8 GB disk; concurrency = `cad-jobs` consumer 3 | PLAN.md:617; wrangler.jsonc.draft:417-420; xc §3.10 |
| Q6 | 15 out-of-repo functions | Re-sync the repo from live where live is ahead; keep `gsc-*` (added to the repo); keep `resend-webhook` until the Phase 2 Svix webhook is proven, then delete after a log check; delete `-v2`, `-no-jwt`, test, diag, debug, both translation-queue functions and the dead senders after a log check; count corrected to 41 deployed / 16 live-only | Plan default, applied per function | PLAN.md:621; rec §2-§3 |
| Q8 | Xometry: Python in a Container or TypeScript port; Playwright pricing | TypeScript port, same UTC hours; Playwright pricing, downloads, partner form and review API not ported | Plan default (no Container minutes; tests become fixtures) | PLAN.md:623; xc X-1, X-4 |
| Q21 | Google Ads offline conversions | Not built; digest ships without them (`ads_upload: false`) | No click ID is captured today; no API access | PLAN.md:636; AGENTS.md §3.6 step 5 |
| Q22 | Mac mini | Container only; `mac_mini` backend slot stays unbuilt behind the same interface | Plan default | PLAN.md:637; AGENTS.md §5 |
| Q20 | LLM budget | €50/month gateway cap (Phase 4 setting); Phase 5 adds the `translate` route (Gemini) under the same cap | Plan default | PLAN.md:635; P4 D4-2 |

### 1.2 Design points answered with the recommended default

| ID | Point | Default built | One-line reason | Source |
|---|---|---|---|---|
| D-1 | Sitemap serving source | Supabase Storage stays the served source; only the generator moves (`SitemapWorkflow` writes the same object) plus a shadow copy in R2 `microns-private` `sitemaps/sitemap-complete.xml`; `workers/site/src/sitemap.ts` and `api/sitemap.js` unchanged; the reader switch moves to P7-5 (or Phase 6) | The served bytes keep the Phase 1 path under the SEO parity gate; rollback = re-activate one pg_cron job | jobs D5-1; workers/site/src/sitemap.ts:3-5, :33; api/sitemap.js:25, :236-238 |
| D-2 | Sitemap content | Port the output of deployed `generate-sitemap` v19 (hard-coded 18 static pages × 14 languages), not the repo version that reads `content_pages` | v19 is what search engines read today; the `content_pages` variant changes the URL set (PLAN.md Q24) | jobs D5-2; rec row 7 |
| D-3 | Scheduling mechanism | No new Cron Trigger: a schedule table in code is evaluated by the Phase 4 `* * * * *` tick; each job is flag-gated and idempotent per slot. **Xometry uses the same table** (minute 0 of hours 6-18 even, UTC) | One trigger works under both readings of the conflicting limits pages; switch-over and rollback become flag flips (≤ 2 min) instead of deploys with up to 15 min cron propagation | jobs D5-3; CF docs `durable-objects_api_alarms.md:29` ("up to three Cron Triggers") vs `workers_platform_limits.md:31` (250 per account, fetched 2026-10-02); `workers_configuration_cron-triggers.md:72-74` |
| D-4 | Where scheduled work runs | The tick only creates Workflow instances or sends queue messages; every scan runs in a queue consumer or Workflow step | Cron CPU is 30 s for intervals under 1 h; consumers and steps get `limits.cpu_ms` 300,000 and 15 min wall time | CF docs `workers_platform_limits.md:72` (fetched 2026-10-02); P2 F-12; P4 §17.1 |
| D-5 | Catch-up after a missed tick | Jobs with an interval ≥ 2 h fire on the first tick within **60 min** after their slot if the slot has not fired; shorter intervals fire only in their own minute | A lost 07:00 tick runs at 07:01, while an evening flag flip on the S5 day can never start a second article for that day | jobs §3.4 (bounded here) |
| D-6 | Article generation model | Same model as live for the parity window: the value of the Supabase function secret `ANTHROPIC_MODEL` (live fallback `claude-sonnet-5`), pinned in `agent.content_daily` `value.model`; plain Messages call with the live prompt and parser, through AI Gateway `microns` | Output parity; a model change is a separate evaluated change | jobs D5-4; rec row 1 |
| D-7 | Translation model | The live Gemini chain (`gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite` → `gemini-flash-latest`, `v1beta`, temperature 0.3, `maxOutputTokens` 8192) through AI Gateway route `translate` with the Google key stored in the gateway (BYOK); no `GEMINI_API_KEY` Worker secret | Parity with deployed `translate-article` v81 | jobs D5-5; CF docs `ai-gateway_usage_providers_google-ai-studio.md:82-100` (stored keys) |
| D-8 | IndexNow | One submission per new translation (English URL + new-language URL) in the `translations` consumer, as live | Exactly today's behaviour | jobs D5-6 |
| D-9 | Fix-links scope | Full pass over all non-English articles, paginated, one Workflow step per language | Live job 21 posts `{"fix_all": true}` daily; pagination removes the single-request row cap | jobs D5-7, N5-10 |
| D-10 | Translation backlog | Backfill ≤ 5 per language per day, oldest first (`value.backfill_per_language_per_day`) | Clears the 199 missing translations within the 7-day window at ≤ 65 extra translations a day | jobs D5-8 |
| D-11 | SEO cache after publishing | Best-effort deletion of the KV keys `seo:v1:list:<lang>` and `seo:v1:translations:<translation_id>` (AGENTS.md §3.5 step 8); per-isolate maps expire on their own 1 h TTL as on Vercel | Plan step kept; staleness can never exceed today's 1 h | workers/site/src/seo/cache.ts:82-84; workers/site/src/seo/supabase.ts:18, :238, :261 |
| D-12 | Collector unit of work | One queue message per live HTTP call: reddit one per tier tick (max 40 subreddits), HN one per tick, tenders one per due connector, Xometry one per slot | Same unit and limits as live; one `agent_runs` row per tick | jobs D5-9 |
| D-13 | Tender restart | 24 h canary on two connectors (`value.countries`, default `["NL","DE"]`), then all 26 active connectors. The canary is skipped (flag set without `countries`) when the re-measurement at S3 (§10.2) shows tenders already flowing through the Phase 2 path | On 2026-10-04 the pipeline had produced nothing since 2026-03-28, so a working port changes Telegram volume. Phase 2 rebuilds `tender-collector` (the target of pg_cron 28) with machine headers and the owner deploys it at O-15, after which tenders may flow through the Phase 2 `tender-scan` queue before S3 | jobs D5-10, N5-9; live 2026-10-03 (26 active connectors, one per country code); PHASE2_SPEC.md:146, :837, :950 (O-15); jobs.md:384 (job 28 → `/functions/v1/tender-collector`) |
| D-14 | Lead alerts | Reddit and HN alert only for rows actually inserted | Prevents repeat alerts on re-read posts | jobs D5-20 |
| D-15 | Marketing semantics | Repo `send-campaign` semantics (multi-sender, warm-up caps, tracking, CSV recipients) through a new `/api/marketing` action `send-campaign` (STAFF), one `outbound-mail` message per recipient, pacing in `SenderLimiter`; when every sender is at its cap the message waits for the next UTC day (no fallback to the default sender). A failed enqueue closes its run `failed`, and a later click re-queues only the recipients without a final event (§5.9) | Dashboard and schema were built for the repo version; no unplanned sender identity; a campaign is never stuck behind a broken run | jobs D5-11; rec row 11 |
| D-16 | Follow-ups, warm-up, pause, stop | Ported, off: vars `MARKETING_FOLLOWUPS_ENABLED`, `MARKETING_WARMUP_ENABLED`, `OUTBOUND_MAIL_PAUSED`, `OUTBOUND_MAIL_STOPPED` (all `"false"`). **Pause** = rollback to the edge path (the route answers 503, the dashboard falls back, §9); **stop** = no campaign mail at all (the route answers 423, which never falls back; queued messages are held) | Not live today; CANON has no marketing flag and new switches are vars (P2 F-27); a deliverability incident needs one switch that stops every new send | jobs D5-12; PLAN.md:371 |
| D-17 | Sender pacing | Daily cap = `warmup_enabled ? warmup_current_limit : daily_limit` of the sender row; spacing between two sends of one sender = `marketing_settings.delay_between_emails_seconds` (0-3,600, the dashboard's own field) or 30 s when unset; the dashboard's sending window and active days stay unenforced, as today | Repo caps; spacing uses the value the owner already sets in the dashboard, which no sender reads today | jobs D5-13; supabase/functions/send-campaign/index.ts:336-356; src/components/dashboard/marketing/EmailMarketingSettings.tsx:26-29, :65-68; live 2026-10-04 (`marketing_settings` columns) |
| D-18 | Digest queue health | Final failures recorded in `agent_runs` by each consumer; no Cloudflare API token | No new credential | jobs D5-14; AGENTS.md §9 point 3 |
| D-19 | Switch-over order | S1 HN → S2 reddit → S3 tenders → S4 sitemap only → S5 content chain → S6 marketing route → S7 ops digest → S8 Xometry → S9 CAD; ≥ 24 h apart; the 7-day window starts at the first Worker content run after S5 | Smallest blast radius first; the content chain must never run twice a day | jobs D5-15 (extended with S8, S9) |
| D-20 | Ported edge functions | Stay deployed (schedules stop) until Phase 6; dashboard buttons and `leads-api /collect` keep calling them | Manual callers exist | jobs D5-16; rec §4 |
| D-21 | Article DB functions | Keep `enqueue_next_article()`, `get_next_queue_job()`, `mark_queue_job_completed()`, `mark_queue_job_failed()` and `article_generation_queue` | Same title choice and queue history as live | jobs D5-17 |
| D-22 | Generation retries | 3 attempts, 5 min apart, then `mark_queue_job_failed` and a card | Live re-claims a failed job while `retry_count < 3` | jobs D5-18 |
| D-23 | Mode semantics (all Phase 5 flags) | `shadow` = run, record `agent_runs`, write nothing to business tables, send no Telegram or mail (content writes its would-be output to R2 `phase5-shadow/…`); `assist` and `auto` = full run | One meaning for every job; matches AGENTS.md §2.3 | AGENTS.md §2.3; data §4.1 |
| X-1 | Xometry persistence | PostgREST through the Phase 4 `Db` port with the service role, three requests per offer reproducing the Python upsert; no Hyperdrive `SUPABASE_DB`, no migration | No database password outside Supabase; empty table; exact semantics kept | xc X-2, §2.5 |
| X-2 | Xometry token rejection | HTTP 401/403 → Telegram card in the same tick; scans pause until `XOMETRY_TOKEN` (or `XOMETRY_COOKIE`) changes; daily reminder at 06:00; expiry hint when the token decodes as a JWT | Today every run fails silently | xc X-3, §2.6-§2.7 |
| X-3 | Xometry alerts | Failures only; new-offer summary off (`value.notify_new`) | Quiet by default | xc §4 item 5 |
| X-4 | Xometry tests | 72 of the 95 Python test functions ported (some adapted), 23 documented as not applicable; 388 golden assertion units generated by the real Python code | Python-specific behaviour (half-even rounding, Unicode case folding) must be pinned | xc X-5, §2.9 |
| X-5 | Action schedule | `.github/workflows/xometry-scan.yml` keeps `workflow_dispatch`; the scheduled job is skipped when repository variable `XOMETRY_SCAN_SCHEDULE` = `off` (owner sets it at S8); the file is deleted in P6-6 | Merge changes nothing; switch-over and rollback are a variable flip | PLAN.md:375, :390, :435 |
| C-1 | Container | `CadContainer` source in `workers/ops/src/cad-container/` (not a separate npm package), exported by `microns-ops`, binding `CAD_CONTAINER`, `standard-1`, `max_instances` 3, `sleepAfter` 10 min, `enableInternet` false, `pingEndpoint` `localhost/health`; `workers/cad/` holds the README and the parity tool only. `@cloudflare/containers` 0.3.7 is a dependency of `workers/ops` only, so the bundle has exactly one copy | Draft values; ping must use an open path. The library keeps its outbound-handler registries in module-level maps that `ContainerProxy` reads by class name, so a second copy of the package (one resolved from a `workers/cad` install, one from `workers/ops`) makes every intercepted request answer 520; `cf-ops.yml` installs only root, shared and ops | xc C-1; wrangler.jsonc.draft:390-421; `npmprobe/package/dist/lib/container.js:37-41, :196-235`; probe `ctrprobe/probe2.mjs` (two copies → 520, Node 22, 2026-10-04); .github/workflows/cf-ops.yml:71-81 |
| C-2 | Image | Prebuilt by a new CI workflow `cad-image.yml` and referenced by registry tag in `workers/ops/wrangler.jsonc` (not the Dockerfile path) | Ops deploys need no Docker; the tested artefact is the deployed one | xc C-2; CF docs containers image-management (fetched 2026-10-03) |
| C-3 | Service changes | Phase 5 requires the shared key on every non-health route of the service (constant-time compare, `REQUIRE_API_KEY=1` in the Container); wall clock enforced by a fork-per-request ASGI middleware killing the child at `PROCESSING_TIMEOUT` (120 s) → 504 | PLAN.md P5-6 asks for both; prototyped and measured, endpoint bodies untouched | xc C-3, §3.7, Appendix A |
| C-4 | Compat path for the untouched edge functions | `UNFOLD_SERVICE_URL` = `https://www.micronshub.eu/api/cad/<CAD_COMPAT_TOKEN>`; site gate → `OPS` → `CadRouter` → container; the input URL is rewritten to an internal host served by an outbound handler with a host allow-list (`CAD_INPUT_HOSTS`) | The edge functions keep their current call and stay untouched (PLAN.md:392); the compat path supplies the authentication (Appendix P.3); the container has no internet | xc C-4, §3.5; Appendix P.3 |
| C-5 | "Byte-identical" | Raw response bytes equal after masking only the values the service randomises itself (DXF dates, GUIDs, ezdxf marker, `CLASSES` record order; PDF dates and `/ID`) | Measured: two calls in one process already differ in exactly these fields | xc C-5, §1.4, §3.8 |
| C-6 | Reference files | The 5 STEP fixtures in `sheet-metal-service/tests/fixtures/unfold/` | Synthetic, public, with expected JSON | xc C-6 |
| C-7 | Dependency lock | `sheet-metal-service/requirements.lock.txt` starts from the measured resolution of 2026-10-03 (77 packages, Python 3.11.17, amd64) and is replaced by the VPS freeze when the owner supplies it (OW5-11) before the gate; base image pinned by digest; `PYTHONHASHSEED=0` | Unblocks the image build; byte identity needs the VPS versions | xc §3.6; `cadref/container-freeze.txt` |
| C-8 | `CadRouter` additions | Slots `cad-0…cad-2`; priorities `interactive` (compat) and `batch` (agent jobs, ≤ 2 slots); no active container health probes; `recycle(slot)`; keep-warm off | A probe would wake and bill a sleeping instance; COSTS.md assumes no keep-warm | xc C-8/§3.4; COSTS.md:34 |
| C-9 | Container placement | No `constraints.jurisdiction` set (draft has none); owner may add `eu` later | Inputs and outputs are processed in memory and never stored by the container | wrangler.jsonc.draft:409-421 |
| M-1 | DO migration tag | `v2` = `["SenderLimiter", "CadContainer"]` in one deploy, as in the draft; the image is pushed before that deploy | Draft value; Phase 4 used `v1` and left `MicronsMcp` out | wrangler.jsonc.draft:404; P4 A-4; surf SF-1 |
| M-2 | Edge-function re-sync owner | Re-sync `generate-daily-article`, `translate-article`, `hn-collector` in P5-1; `telegram-leads-bot` is re-synced by P4-12 (Phase 4 unit W) and not touched here | One owner per file | rec A1; P4 §3.2 (`functions/telegram-leads-bot/index.ts ~ W`: live v6 source + one callback branch) |
| M-3 | `PUBLIC_FILES` and Hyperdrive on ops | Not added in Phase 5 | No Phase 5 consumer (D-1, X-1) | wrangler.jsonc.draft:283-286, :437-441 |
| D-24 | Default sender cap | A campaign without sender accounts sends through the default Resend identity with a cap of 500 per UTC day (`DEFAULT_SENDER_DAILY_CAP`, a code constant) | The repo function has no cap on that path; a cap bounds a mistaken send while staying far above today's volume (1 event ever) | supabase/functions/send-campaign/index.ts:383-392; live 2026-10-03 (`marketing_events` 1 row) |
| D-25 | Campaign button fallback | The dashboard calls the new route first and falls back to `functions.invoke('send-campaign')` only on the two answers that prove the route is absent or deliberately paused (§9); any other answer, a timeout or a network error shows an error and never falls back | A second send path is taken only when the first provably did nothing, so a campaign is never sent twice | api/marketing.js:54-69; §5.9 |
| D-26 | CAD edge functions | `extract-flat-pattern` and `generate-manufacturing-pdf` are neither changed nor redeployed in Phase 5; only the secret `UNFOLD_SERVICE_URL` changes (replaced, never unset) | PLAN.md lists both as untouched; the deployed copies read the same secret | PLAN.md:392; supabase/functions/extract-flat-pattern/index.ts:145-153; supabase/functions/generate-manufacturing-pdf/index.ts:55-63 |
| D-27 | Queue messages of the scheduled collectors | A new envelope `P5ScrapeMessage` with kinds `reddit-tier`, `hn-scan`, `tender-scheduled`, `xometry-scan` on queue `scrapes`; `ScrapeMessage` and `queues/scrapes.ts` stay as Phase 2 built them; `index.ts` sends the new kinds to `queues/scrapes-p5.ts` | Phase 2 keys `Record<ScrapeMessage['kind'], …>` tables by the kind union, so widening it would change a Phase 2 file; the Phase 4 `directory-scan` routing uses the same pattern. The hand-off row of PHASE4_SPEC §9 (`queue()` row) still says "inside `queues/scrapes.ts`"; read it as "routed in `index.ts` to `queues/scrapes-p5.ts`" (Phase 4 itself freezes `scrapes.ts`, PHASE4_SPEC §7.1) | workers/ops/src/queues/scrapes.ts:28-31, :153-166; P4 §4.9 |
| D-28 | Telegram output of Phase 5 jobs | Plain-text messages through a Phase 5 port (`P5Ports.telegramText`), byte-identical to the live texts for lead alerts; no approval cards, no buttons | The live collectors send plain text without a parse mode; the Phase 4 card renderer uses HTML mode with buttons | supabase/functions/reddit-collector/index.ts:105-118; P4 §4.14 (`renderTelegram`) |
| D-29 | Anthropic text call | `@anthropic-ai/sdk` `messages.create` through the Phase 4 gateway client `anthropicFor(env, meta)`, body exactly as live (one user message, `max_tokens` 16384, no `system`, no `thinking` field), no server-side fallback | Output parity; Phase 4 already ships the SDK client; the fallback beta belongs to the `extract` route only | P4 §4.15; skill (2026-10-04) Sonnet 5 row; jobs §4.1 L3 |
| D-30 | Run keys of re-runnable units | A unit that can legitimately run again after a final outcome carries a distinguishing suffix: `content_daily.translate:<translation_id>:<lang>:<for_date>`; a campaign re-queue after a failed enqueue uses `marketing.send:<campaign_id>:r<n>` | `agent_run_begin()` returns the existing row on a key conflict and never re-opens a closed run, so a re-run under the same key would be dropped silently | `../phase4/agent_layer.sql:625-650` (`ON CONFLICT (agent, idempotency_key) DO NOTHING`, then the existing row) |
| D-31 | Content prompt files | The three frozen content prompts live in `workers/ops/src/content/prompts/` (C5, own `LOCK.json` and test), not under the Phase 4 `src/agents/prompts/` tree; only `ops_digest.narrative@v1`, which uses the Phase 4 `llm` port, follows the Phase 4 prompt convention and registry | The content prompts are byte copies of the live templates without front matter or schema, which the Phase 4 prompt rules and their frozen-prompt test expect | PHASE4_SPEC §4.15 (prompt files: front matter `route`, `max_tokens`, `effort`; `.schema.json`; per-agent `LOCK.json`) and K-2 (checks every prompt file present) |

---
## 2. Facts this spec relies on

| # | Fact | Consequence | Evidence |
|---|---|---|---|
| F5-1 | `cron.job` holds 10 jobs, all active, unchanged since 2026-09-30: 15 `process-article-queue` `*/5`, 17 `enqueue-daily-article` 07:00, 19 `auto-update-sitemap` 09:00, 21 `auto-fix-article-links` 08:30, 22 `auto-translate-daily-articles` 08:00, 23/24/29 `reddit-tier1/2/3` `*/15`, `*/30`, hourly, 25 `hn-collector` `*/30`, 28 `tender-scan-daily` 06:00 | Switch-over SQL addresses jobs by name and checks their target path | live 2026-10-03 20:29 |
| F5-2 | pg_cron reports every run as succeeded while about a third of the quarter-hour HTTP calls end in a 5 s pg_net timeout | Parity is measured on outputs, not cron status (H-29) | jobs N5-2 |
| F5-3 | Deployed edge functions: 41 (25 in the repo, 16 live-only), not 40/15 | Q6 record and P5-1 table use 41/16 | rec §1; PLAN.md:88, :621 |
| F5-4 | Translation lag: newest English article 2026-10-04, newest cs/da/fi/hu/nb/pl/sv article 2026-09-11 (23 days behind), newest pt 2026-10-02; 199 translations missing on 2026-10-03 | Backfill (D-10) | live 2026-10-04 08:10; live 2026-10-03 20:29 (missing count); jobs N5-4 |
| F5-5 | Cause of the lag: `auto-translate-articles` only considers English articles created today (UTC), works through a fixed language order with a 140 s self-budget and one call per language, and never retries a language it did not reach | One queue message per language with retries and backfill | supabase/functions/auto-translate-articles/index.ts:18-32, :53-56, :63-80 |
| F5-6 | 15 unprocessed `article_titles` remain (exhausted ≈ 2026-10-19 at one a day) | Owner adds titles before S5 (OW5-9) | live 2026-10-04 08:10 |
| F5-7 | Only `sitemaps/sitemap-complete.xml` is regenerated daily in Supabase Storage; the other 16 sitemap blobs are static since 2025-12-30; expected URL count 2,616 (252 + 2,364) | D-1 (generator moves, served object unchanged) | jobs N5-11, Q4 |
| F5-8 | `api/sitemap.js` serves `sitemap-complete.xml` from the public Storage URL and runs unchanged inside the Phase 1 site Worker | No serving change in Phase 5 | api/sitemap.js:24-25, :236-238; workers/site/src/sitemap.ts:3-5, :33 |
| F5-9 | Reddit: last lead 2026-03-30 (the collector runs, the source returns nothing); HN: 1-5 leads a day; tenders: last row 2026-03-28, no connector scan since 2026-06-06 (state of 2026-10-04, before the Phase 2 `tender-collector` deploy O-15) | Reddit and tender parity are "scans happen", HN is the real signal; the tender baseline is re-measured at S3 (§10.2), because after O-15 tenders may flow through the Phase 2 path | jobs N5-7…N5-9; live 2026-10-04 (`tender_connectors`: 26 active, newest `last_scan_at` 2026-06-06); PHASE2_SPEC.md:950 |
| F5-10 | Marketing: 2 active Google Workspace sender accounts, 1 `marketing_events` row ever, 25 pending CSV recipients | Functional acceptance instead of an output baseline | live 2026-10-03 20:29; jobs N5-12 |
| F5-11 | The campaign buttons call the edge function `send-campaign` directly; the deployed version is older than the repo version | Frontend change with a fallback (§9) | src/components/dashboard/marketing/CampaignWizard.tsx:233; CampaignsTable.tsx:96; rec row 11 |
| F5-12 | Vercel's `api/marketing.js` answers an unknown `action` with HTTP 400 `{"error":"Invalid action. Use: …"}` | The new action degrades to the old path on Vercel | api/marketing.js:54-69 |
| F5-13 | Xometry: the GitHub Action has failed on all 505 runs since 2026-06-18 and `xometry_offers` has 0 rows; probes without a valid token get HTTP 401; the token is copied by hand (MFA) | No output baseline; the gate is "runs on schedule with outcomes" | xc §1.1; live 2026-10-03 20:29 (0 rows); xometry-bot/README.md:62-64 |
| F5-14 | Xometry Action: cron `0 6,8,10,12,14,16,18 * * *`, downloads and buyer pricing off | Port scope (X-4); same hours (D-3) | .github/workflows/xometry-scan.yml:19-21, :66-67 |
| F5-15 | P5-6 changes two places in the unfold service: the API-key middleware (Phase 5 requires the key on every non-health route) and the declared `PROCESSING_TIMEOUT = 120` (enforced) | C-3 | sheet-metal-service/main.py:49-57; sheet-metal-service/config.py:37; PLAN.md:373 |
| F5-16 | Both CAD edge functions call `${UNFOLD_SERVICE_URL}/flat-pattern` with a 120 s client timeout and treat any non-2xx answer as a failed call (the body is only logged); their request details are in Appendix P.3 | C-4; §5.9 error answers | supabase/functions/extract-flat-pattern/index.ts:145-175; supabase/functions/generate-manufacturing-pdf/index.ts:55-80 |
| F5-17 | `/flat-pattern` output is not byte-stable even between two calls on one machine (DXF dates/GUIDs/marker; `CLASSES` order varies with `PYTHONHASHSEED`; PDF dates) | C-5 | xc §1.4 (measured) |
| F5-18 | Workflows: step result ≤ 1 MiB, instance id ≤ 100 chars, `create` with a used id throws `instance.already_exists`, events before `waitForEvent` are buffered; Queues: message ≤ 128 KB, consumer wall time 15 min; Cron: UTC only, changes propagate in up to 15 min | Step results stay compact; instance ids are the idempotency for Workflow jobs | P4 N-3; CF docs `queues_platform_limits.md:24, :84`, `workers_configuration_cron-triggers.md:27, :72-74` (fetched 2026-10-03) |
| F5-19 | Containers: images must be `linux/amd64`; cold start often 1-3 s; `enableInternet = false` lets traffic out only through `allowedHosts` or outbound handlers; `ContainerProxy` must be exported for interception; `@cloudflare/containers` 0.3.7 exposes `pingEndpoint`, `static outboundByHost`, `destroy()`, `getContainer()`. `outboundByHost` is a static accessor whose setter fills the registry that `ContainerProxy` reads; a subclass **class field** `static outboundByHost = {…}` (ES2022 define semantics, ops `tsconfig` target ES2022) creates an own property, never calls the setter, and the proxy answers 520 for the host; an assignment after the class body registers it | C-1, C-4; §5.8 | xc §1.3; `npmprobe/package/dist/lib/container.d.ts:46-70`, `container.js:225-229, :272-277, :361-368`; probes with the real 0.3.7 package: `ctrprobe/probe.mjs` (Node 22) and `ctrprobe/wiring.test.ts` under the ops vitest 5.0.3 with a `cloudflare:workers` stub (class field → 520, assignment → 200, unknown host → 520; both 2026-10-04; vitest inlines the package, whose `dist` uses extensionless ESM imports); workers/ops/tsconfig.json:3 |
| F5-20 | The Phase 1 SEO cache keeps rows 1 h (as `middleware.ts` does) under KV keys `seo:v1:<kind>:<parts>` in the site binding `SEO_CACHE` | D-11 | workers/site/src/seo/supabase.ts:18; workers/site/src/seo/cache.ts:5, :42, :82-84; workers/site/wrangler.jsonc:47-49 |
| F5-21 | Phase 2 `scrapes` consumer: kind table `SCRAPE_FUNCTION_PATHS` typed `Record<ScrapeMessage['kind'], string>`, handler run in-process with `runNodeHandler` (840 s deadline), 2xx/4xx ack, 5xx/throw retry 300 s, DLQ after 3 retries; `ScrapeMessage.run_id` is a plain UUID (no `agent_runs` row in Phase 2) | D-27; tender child runs are opened by the Phase 5 handler | workers/ops/src/queues/scrapes.ts:20-31, :36, :100-103, :105-151; workers/ops/src/queues/messages.ts:5-12 |
| F5-22 | `ops` entry today exports `fetch` (404) and `queue: scrapesConsumer`; Phase 4 adds `scheduled()` (`* * * * *` flags sync, `*/10` dispatcher) and the per-kind queue routing | §3.2 `index.ts` row | workers/ops/src/index.ts:55-58; P4 §4.9, §4.17 |
| F5-23 | No scheduler sends campaigns with a `scheduled_at` today (only the wizard's "send now" path calls the function) | Phase 5 adds none (scope) | src/components/dashboard/marketing/CampaignWizard.tsx:215-247; repo grep `scheduled_at` 2026-10-04 (no other reader) |
| F5-24 | Phase 2 tests pin exact shapes that Phase 4 and Phase 5 extend: `workers/site/test/policy.test.ts` asserts exactly 34 action IDs; `workers/ops/test/config.test.ts` asserts exactly the Phase 2 `vars`, queues, `secrets.required`, top-level keys and `dependencies = {hono}`; `workers/shared/test/http/rpc.test.ts` pins the `EndpointId` and `machine` unions; `workers/site/test/env-api.test.ts` counts and checks every site `Env` field after its Phase 2 marker | §3.2 rows for the first three (one owner each, Phase 4's rule R-10 applied); site `env.ts` left unchanged (§5.1); Wave 3 runs them as changed there | workers/site/test/policy.test.ts:9-12; workers/ops/test/config.test.ts:77-98, :112-117, :119-127; workers/shared/test/http/rpc.test.ts:6-22; workers/site/test/env-api.test.ts:228-238 (working tree 2026-10-04); PHASE4_SPEC R-10 |
| F5-25 | The Phase 2 T2 config of ops collects `test/**/*.t2.ts`; Phase 4 K adds `exclude: test/t2/**` to it and gives profile `agents` its own config that collects exactly `test/t2/*.t2.ts` | Phase 5 T2 files use a name neither collects (`test/t2-jobs/p5-<area>.jobs.ts`) and their own config `vitest.t2.jobs.config.ts`; Phase 5 does not touch either earlier T2 config | workers/ops/vitest.t2.config.ts:10; PHASE4_SPEC §7.2 (`vitest.t2.config.ts` row) and G4-3 |
| F5-26 | The site router has no per-target timeout and maps an RPC rejection of `OPS.handle` to 500 `text/plain` "Internal Server Error" (`ops-client.ts` is frozen) | The compat path's own deadline lives in ops (110 s); an RPC-level failure reaches the edge functions as that 500, which they treat like any other failed call (F5-16) | workers/site/src/api/router.ts:35-55; workers/site/src/api/ops-client.ts:72-78; PHASE4_SPEC §7.1 (`ops-client.ts` frozen) |

---

## 3. What Phase 5 consumes, and where it may touch earlier files

### 3.1 Inputs from Phases 2 and 4 (consumed as designed; a builder adapts in its own files if the landed code differs)

| Input | Contract used | Source |
|---|---|---|
| `OpsApi` RPC entrypoint, Hono `app`, `vercelRoute`/`runVercel` shim, `OpsCall`/`Principal` | Site → ops dispatch for the two new HTTP paths; in-process run of `api/tender-scan.js` | P2 §2.3, §2.5, F-6 |
| Site router `routeApi`, `resolveApi`, `applyGate`, `callOps`, `forwardToVercel`/`shouldForward` | New action `send-campaign`, new endpoint `cad-compat` | P2 §2.4, §2.8 |
| Queue `scrapes` (consumer batch 1, retries 3, concurrency 2, `retry_delay` 300, DLQ `scrapes-dlq`) and `ScrapeMessage` | Four Phase 5 kinds (§5.3) | P2 §2.5, §2.9; surf §8.5 (`directory-scan` precedent) |
| `agent_runs` table, `agent_run_begin()`, `agent_retention_purge()`; `feature_flags` + KV `FLAGS` mirror (every-minute `flags-sync`) | Run rows, flag reads | P4 §4.13; data §4, §10; `../phase4/agent_layer.sql:71-111, :625-650, :785-806, :864-879` |
| `readFlag(env, key)` → `AgentFlag {enabled, mode, value, rev}` (KV `cacheTtl` 30, fail closed; the alias `readAgentFlag` is exported too, Phase 5 code imports `readFlag`), `openRun(db, r: OpenRun)` → `{run_id, created, status}`, `checkpointRun`, `closeRun`, `isAlreadyExists(e)` (`agents/flags.ts`, `agents/runs.ts`); `FlagKey` in `workers/shared/src/agent-types.ts` (all 13 canonical keys, including every Phase 5 flag); **`AgentKey` in `workers/ops/src/agents/runs.ts`** with the Phase 4 keys only (`rfq_intake`, `quote`, `post_order`, `post_order.stock`, `quote.reply_poller`, `cad`, `eval`, `mcp`, `flags`, `growth.scrapers`; `post_order.stock` added 2026-10-07 for MaterialStock notices); K5 extends it there (§3.2) | Every Phase 5 job | P4 §4.3, §4.7, §9 (`AgentKey` row), CR-12, CR-34, DF-79 |
| `Ports` (`db`, `mailer`, `gmail`, `llm`, `blob`, `events`, `clock`, `telegram`, `cad`), `makePorts(env)` (stub selection by `AGENT_STUBS`; throws when stubs are set while `AI` is bound), `PostgrestDb`, `MemoryDb` + `memory-rpc.ts`, mini-PostgREST stub `stubs/postgrest.mjs` | DB, Resend, Gmail access tokens (`GmailPort.accessToken(account)`), structured LLM (digest narrative), R2 and Analytics Engine access | P4 §4.6; agents.md §4.3 (port interfaces) |
| Step profiles (`workflows/steps.ts`: `DB`, `BLOB`, `LLM_EXTRACT`, `SEND`, `NOTIFY`, `PURE`, …), test helpers `test/helpers/{cloudflare-workflows,fake-step,fake-do,memory-db,recorders}.ts` | Phase 5 Workflows and tests | P4 §3.2, §4.10 |
| AI Gateway client `anthropicFor(env, meta)` and header builder `gatewayHeaders(env, meta)` (`agents/gateway.ts`: provider-native endpoint from `getUrl('anthropic')`, `cf-aig-authorization`, `cf-aig-metadata` 5 keys, `cf-aig-collect-log-payload: 'false'`, BYOK, `AGENT_LLM_BASE_URL` in T2); `agents/prices.ts`; prompt registry `agents/prompts/registry.ts` (prompt id → `{file, schema, route, max_tokens, effort}`) | Anthropic text call (D-29); the Gemini call sends `gatewayHeaders(env, meta)` to `getUrl('google-ai-studio')`; the digest narrative is a registered prompt (§3.2) | P4 F4-5, §4.15, §9 (`agents/gateway.ts` row); `../phase4/agents.md:117` |
| `CadRouter` DO (`acquire`, `release`, `report`, `snapshot`, `alarm`), `cad-jobs` consumer, `HttpUnfoldBackend(name, fetcher, {baseUrl, apiKey, maxConcurrency})`, `cad/backends/container.ts` stub (`{ok:false, code:'unsupported'}`), var `CAD_BACKEND_DEFAULT` | Container drop-in | P4 §4.6, §4.11, §4.12; agents.md §9 |
| `scheduled()` dispatch on `controller.cron` in `workers/ops/src/index.ts`: `* * * * *` → `flagsSyncTick` (DB), `*/10 * * * *` → `dispatcherTick` (RP) | Schedule table hook | P4 §4.17 |
| T2 harness in `workers/site/test/integration/` (`global-setup.mjs`, `harness.mjs`, `stub-server.mjs`, `stubs/*.mjs`; profile `agents` run by `npm --prefix workers/ops run test:integration:agents` = `T2_PROFILE=agents vitest run -c vitest.t2.agents.config.ts`); the Phase 2 ops T2 config collects `test/**/*.t2.ts` (`workers/ops/vitest.t2.config.ts`), Phase 4 T2 files sit in `test/t2/*.t2.ts` | Profile `jobs` with its own config and file names (§7.2) | P2 §2.12; P4 §3.2, §5.2 (unit K scripts), §6.3, G4-3, CR-25, CR-32; workers/ops/vitest.t2.config.ts:8-16 |
| Frontend helper `fetchWithAuth(url, init)` (`src/utils/apiAuth.ts`, Phase 2 unit E; not in the tree at `91f1376`) | Campaign send | P2 E-1 |

### 3.2 Extension points in Phase 1, 2 and 4 files (the only allowed edits; owner unit in brackets)

| File (owner phase) | Exact change | Unit |
|---|---|---|
| `workers/shared/src/http/rpc.ts` (P2 A, P4 K) | `EndpointId` += `'cad-compat'`; `Principal.machine` += `'cad-compat'` | M5 |
| `workers/ops/src/agents/runs.ts` (P4 K) | `AgentKey` += the 11 Phase 5 keys `'content_daily' \| 'content_daily.translate' \| 'content_daily.sitemap' \| 'growth.reddit' \| 'growth.hn' \| 'growth.tenders' \| 'growth.xometry' \| 'marketing.send' \| 'marketing.followups' \| 'marketing.warmup' \| 'ops_digest'` (the union's only home: P4 CR-34, §4.7, §9); nothing else in the file changes | K5 |
| `workers/ops/src/agents/prompts/registry.ts` (P4 K) | one entry `ops_digest.narrative@v1` → `{file: 'ops_digest/narrative.v1.md', schema: 'ops_digest/narrative.v1.schema.json', route: 'extract', max_tokens: 800, effort: 'low'}` (`max_tokens` per jobs §8 step 4, jobs.md:328; `effort: low` as for extraction prompts, `../phase4/agents.md:466`) (and the id added to the `PromptId` type if the landed registry types one); the content prompts are not registered (D-31) | K5 |
| `workers/shared/test/http/rpc.test.ts` (P2 A; typecheck-only; Phase 4 K extends the same lines first) | the `EndpointId` expectation gains `'cad-compat'` and the `machine?` union gains `'cad-compat'`; nothing else (workers/shared/test/http/rpc.test.ts:6-22; PHASE4_SPEC §7.2 names this Phase 5 edit) | M5 |
| `workers/site/src/api/resolve.ts` (P2 B, P4 W) | (a) `/api/marketing` (and `/api/track`): action `send-campaign` for `POST`; any other method with that action → site answers 405 `{"error":"method_not_allowed"}` with `Allow: POST` (new action, no Vercel parity to keep); (b) `endpointOfPath`: the `/api/cad/` prefix is tested before the exact-match catalogue, beside Phase 4's `/api/agent/` prefix, so `CATALOGUE_PATHS` keeps its 13 paths (workers/site/test/resolve.test.ts:52; PHASE4_SPEC §7.2 `resolve.ts` row); endpoint `cad-compat` for paths matching `^/api/cad/([A-Za-z0-9_-]{32,128})/flat-pattern$`, `POST` only (else 405), `functionUrl` = `/api/cad/flat-pattern` (the token segment never reaches ops), any other `/api/cad/*` path → 404 `{"error":"not_found"}` answered by the site | M5 |
| `workers/site/src/api/router.ts` (P2 B) | `ENDPOINT_TARGETS` gains `'cad-compat': 'ops'` (the table is typed `Record<EndpointId, …>`, so the new endpoint needs its row); marketing `send-campaign` already reaches `ops` through the `by-action` rule (every marketing action except `track`). No timeout is added: the router has none, the compat deadline is the ops-side 110 s (§5.8), and an RPC-level failure answers the frozen `ops-client.ts` 500 (F5-26) | M5 |
| `workers/site/src/api/forward.ts` (P2 B, P4 W) | `shouldForward()` never true for paths under `/api/cad/` (same pattern as the `/api/agent/` exclusion) | M5 |
| `workers/site/src/auth/policy.ts` (P2 G, P4 W) | `ActionId` += `'MK-8' \| 'CD-1'`; `Access` += `'cad-token'`; `ACTION_RULES['MK-8'] = { access: 'staff', userScope: 'send-campaign' }` (rate key `u:<uid>:send-campaign`); `ACTION_RULES['CD-1'] = { access: 'cad-token' }`; `actionIdOf()`: endpoint `marketing` action `send-campaign` → `MK-8`, endpoint `cad-compat` → `CD-1` (today's `MK-1`…`MK-7` lookups unchanged, workers/site/src/auth/policy.ts:101-113) | M5 |
| `workers/site/src/auth/gate.ts` (P2 G, P4 W) | access `cad-token` → `checkCadCompatToken()` of the new file `workers/site/src/auth/cad-compat.ts` (principal `{class: 'MACHINE', machine: 'cad-compat'}`, rate key `m:cad-compat`); every other access branch unchanged | M5 |
| `workers/ops/src/routes/marketing.ts` (P2 C) | `call.action === 'send-campaign'` → `handleSendCampaign` (`routes/marketing-send.ts`); every other branch unchanged | M5 |
| `workers/ops/src/app.ts` (P2 C) | one `register(app)` line for `routes/cad-compat.ts` (path `/api/cad/flat-pattern`) | D5 |
| `workers/ops/src/index.ts` (P2 C, P4 K) | exports `ContentDailyWorkflow`, `SitemapWorkflow`, `OpsDigestWorkflow`, `SenderLimiter`, `CadContainer` (from `./cad-container/cad-container`), `ContainerProxy` (`export { ContainerProxy } from '@cloudflare/containers'`, the same single copy that `cad-container.ts` imports `Container` from); `queue()`: batch `translations` → `translationsConsumer` (C5), `outbound-mail` → `outboundMailConsumer` (M5), `scrapes` messages whose `kind` is in `P5_SCRAPE_KINDS` → `scrapesP5Consumer` (K5), checked before the Phase 4 `directory-scan` branch and the Phase 2 consumer; `scheduled()` case `'* * * * *'`: after the flags sync, `ctx.waitUntil(runSchedule(env, controller.scheduledTime))` | K5 |
| `workers/ops/src/env.ts` (P2 C, P4 K) | Phase 5 fields of §5.1 | K5 |
| `workers/ops/wrangler.jsonc`, `package.json`, `package-lock.json` (P2 C, P4 K) | §5.11; dependency `@cloudflare/containers` 0.3.7 (exact; ops is its only declarer in the repository, C-1); script `test:integration:jobs` = `T2_PROFILE=jobs vitest run -c vitest.t2.jobs.config.ts`. No T1 alias: T1 imports the real package, whose only runtime import is `DurableObject`/`WorkerEntrypoint` from `cloudflare:workers`, already stubbed by the Phase 4 helper (P4 §3.2 layout row `test/helpers/{cloudflare-workers.ts}`, §6.2) | K5 |
| `workers/ops/vitest.t2.jobs.config.ts` (new file, listed here because it sits beside the Phase 2/4 T2 configs) | `include: ['test/t2-jobs/**/*.jobs.ts']`, the Phase 2 `globalSetup`, `fileParallelism: false`, the Phase 2 timeouts | K5 |
| `workers/ops/test/config.test.ts` (P2 C; Phase 4 K rewrites it first to "Phase 2 subset exact + Phase 4 additions present", PHASE4_SPEC §7.2, R-10) | Phase 5 additions asserted the same way, every Phase 2 and Phase 4 expectation left as written: top-level keys += `containers`; `queues` also contains the `translations` and `outbound-mail` producer and consumer objects of §5.11 (exact objects); `workflows`, `durable_objects.bindings` and `migrations` contain the Phase 5 entries (tag `v2`); `vars` ⊇ the Phase 5 vars of §5.11 and still nothing named like a T2-only var (§5.4 names added to that check); `dependencies` ⊇ `{'@cloudflare/containers': '0.3.7'}`; `devDependencies`, `secrets.required` and `.dev.vars.example` unchanged (Phase 5 adds no required secret and no dev dependency) | K5 |
| `workers/site/test/policy.test.ts` (P2 G; Phase 4 W first: count 34 → 41 and the AG rows, PHASE4_SPEC §7.2) | the ID count becomes 43 (`MK-8`, `CD-1`); no other expectation changes (MK-8 has access `staff` and CD-1 `cad-token`, neither enumerated by the access-class test; MK-8's rate scope uses the default binding, as the binding test expects; workers/site/test/policy.test.ts:9-31, :41-50) | M5 |
| `workers/ops/src/queues/messages.ts` (P2 C, P4 K) | `TranslationMessageV1`, `OutboundMailV1`, `P5ScrapeMessage`, `P5_SCRAPE_KINDS`; `ScrapeMessage` unchanged (D-27) | K5 |
| `workers/ops/src/agents/prices.ts` (P4 K) | price rows for the Phase 5 models of §5.4 (`claude-sonnet-5` from the skill table; Gemini rows from Google's pricing page with fetch date); a model without a row → `cost_cents` from the known parts and `output.price_missing` | K5 |
| `workers/ops/scripts/check-bundle.mjs` (P4 K) | forbidden production vars += the T2-only names of §5.4; `@cloudflare/containers`: the metafile inputs that contain `/node_modules/@cloudflare/containers/` must all resolve under `workers/ops/node_modules/@cloudflare/containers/`, and `dist/lib/container.js` must appear exactly once; any other resolved path fails the check | K5 |
| `workers/site/test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs}` (P2 B, P4 K) | profile `jobs` (§7.2) | K5 |
| `workers/site/test/integration/stubs/{gmail,telegram,postgrest}.mjs` (P4 K, P4 DB) | gmail: `POST /gmail/v1/users/me/messages/send` recorder; telegram: plain `sendMessage` bodies recorded byte for byte; postgrest: the tables and RPCs of §5.10 added to the stub's catalogue (no change to existing semantics) | K5 |
| `workers/ops/src/cad/types.ts` (P4 CQ) | additive optional fields of §5.8 (`priority`, `slot`, `recycle`, `lease` argument) | D5 |
| `workers/ops/src/do/cad-router.ts` (P4 CQ) | container slots, priorities, `recycle`, no active container probe (§5.8) | D5 |
| `workers/ops/src/cad/backends/{http-unfold,container}.ts`, `workers/ops/src/cad/registry.ts` (P4 CQ) | fetcher receives the lease; outcome mapping of §5.8; `container.ts` replaces the stub; the registry builds the `container` backend from `P5Ports.container` | D5 |
| `workers/ops/src/queues/cad-jobs.ts` (P4 CQ) | passes the lease to `backend.run`; on `recycle: true` calls `CadRouter.release(…, {recycle: true})` | D5 |
| `.github/workflows/xometry-scan.yml` (pre-migration file) | job-level `if:` that skips scheduled runs when `vars.XOMETRY_SCAN_SCHEDULE == 'off'` (X-5); `workflow_dispatch` and every step unchanged | X5 |
| `src/components/dashboard/marketing/{CampaignWizard,CampaignsTable}.tsx` | the two `functions.invoke('send-campaign', …)` calls become `startCampaignSend(id)` (§9) | M5 |

Everything else written before Phase 5 is read-only for Phase 5 (§8).

---

## 4. Layout (`+` new, `~` changed at an extension point, `−` removed; unit letters of §7)

```
workers/
  shared/src/http/rpc.ts                          ~ M5  EndpointId 'cad-compat'; Principal.machine 'cad-compat'
  shared/test/http/rpc.test.ts                    ~ M5  the two union expectations gain 'cad-compat'
  site/
    src/api/{resolve,router,forward}.ts           ~ M5  §3.2
    src/auth/{gate,policy}.ts                     ~ M5  MK-8, CD-1, access 'cad-token'
    src/auth/cad-compat.ts                        + M5  CadCompatEnv, compat token check (constant time); src/env.ts stays unchanged
    test/policy.test.ts                           ~ M5  ID count 41 → 43 (§3.2)
    test/p5-{marketing-send,cad-compat}.test.ts   + M5
    test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs}   ~ K5  profile 'jobs'
    test/integration/stubs/{gmail,telegram,postgrest}.mjs             ~ K5  §3.2
    test/integration/stubs/{pullpush,hn,xometry,indexnow,google-ai-studio,storage,cad-container}.mjs   + K5
  ops/
    wrangler.jsonc, package.json, package-lock.json   ~ K5
    vitest.t2.jobs.config.ts                      + K5  T2 profile 'jobs' (test/t2-jobs/**/*.jobs.ts)
    test/config.test.ts                           ~ K5  Phase 5 additions asserted; Phase 2 and 4 expectations as written (§3.2)
    README.md                                     ~ K5  Phase 5 section (run, test, switch-over pointers)
    src/index.ts, src/env.ts                      ~ K5
    src/agents/runs.ts                            ~ K5  AgentKey += 11 Phase 5 keys
    src/agents/prompts/registry.ts                ~ K5  entry ops_digest.narrative@v1
    src/cron/schedule.ts                          + K5  SCHEDULE table + matcher (pure)
    src/cron/run-schedule.ts                      + K5  runSchedule(): gates, catch-up, create/enqueue, run rows
    src/ports/p5.ts                               + K5  P5Ports, makeP5Ports(env)
    src/ports/p5-stub/*.ts                        + K5  T1 fakes (text LLM, sources, storage, gmail send, container, telegram text)
    src/queues/messages.ts                        ~ K5
    src/queues/scrapes-p5.ts                      + K5  scrapesP5Consumer + sendP5Scrape(); routes kinds to the unit handlers
    src/agents/prices.ts                          ~ K5
    scripts/check-bundle.mjs                      ~ K5
    test/p5/kernel/**, test/t2-jobs/p5-kernel.jobs.ts   + K5
    src/workflows/content-daily.ts                + C5  ContentDailyWorkflow
    src/workflows/sitemap.ts                      + C5  SitemapWorkflow
    src/queues/translations.ts                    + C5  translationsConsumer
    src/content/{generate-en,translate,gemini-chain,fix-links,sitemap-xml,indexnow,seo-purge,languages,backfill}.ts   + C5  (port implementations stay in K5's ports/p5.ts)
    src/content/prompts/{generate_en.v1.md,translate.v1.md,translate_table.v1.md,LOCK.json}   + C5  frozen byte copies of the live prompts (D-31)
    test/p5/content/**, test/oracles/**, test/t2-jobs/p5-content.jobs.ts   + C5  oracles = live v19 sitemap builder, fix-links, v81 parser (test-only)
    src/collectors/{keywords,reddit,hn,tenders,telegram-lead}.ts   + G5  handleRedditTier, handleHnScan, handleTenderScheduled
    test/p5/collectors/**, test/fixtures/collectors/**, test/t2-jobs/p5-collectors.jobs.ts   + G5
    src/xometry/{types,pyfmt,config,models,filters,pricing,partner-client,store,pipeline,tick,queue,alerts}.ts   + X5
    scripts/xometry-golden/gen_golden.py          + X5
    test/p5/xometry/**, test/fixtures/xometry/golden.json, test/t2-jobs/p5-xometry.jobs.ts   + X5
    src/cad-container/{cad-container,input-proxy,slots}.ts   + D5  CadContainer, outbound input proxy, slot names (C-1)
    src/cad/types.ts, src/cad/registry.ts, src/do/cad-router.ts, src/cad/backends/{http-unfold,container}.ts, src/queues/cad-jobs.ts   ~ D5
    src/routes/cad-compat.ts                      + D5
    src/app.ts                                    ~ D5  one register line
    test/p5/cad/**, test/t2-jobs/p5-cad.jobs.ts   + D5
    src/marketing/{recipients,personalise,tracking,send-gmail,send-resend,followups,warmup,campaign-close,sender-rows}.ts   + M5
    src/routes/marketing-send.ts                  + M5
    src/routes/marketing.ts                       ~ M5  one dispatch branch
    src/queues/outbound-mail.ts                   + M5  outboundMailConsumer
    src/do/sender-limiter.ts                      + M5
    test/p5/marketing/**, test/t2-jobs/p5-marketing.jobs.ts   + M5
    src/workflows/ops-digest.ts                   + O5
    src/digest/{collect,stuck,render}.ts          + O5
    src/agents/prompts/ops_digest/{narrative.v1.md,narrative.v1.schema.json,LOCK.json}   + O5  Phase 4 prompt convention (front matter, schema, LOCK)
    test/p5/digest/**, test/t2-jobs/p5-digest.jobs.ts   + O5
  cad/                                            + D5  no npm package (C-1): Container README and the parity tool
    README.md                                     + D5  build, push, local run, parity procedure
    parity/cad_parity.py, parity/golden/**        + D5
sheet-metal-service/
  main.py, config.py                              ~ D5  key on all non-health routes; wall clock (xc Appendix A)
  Dockerfile                                      ~ D5  amd64 digest pin, lock file, PYTHONHASHSEED=0
  requirements.lock.txt                           + D5
  tests/test_p5_service.py                        + D5
.github/workflows/cad-image.yml                   + D5
.github/workflows/xometry-scan.yml                ~ X5  job-level if (X-5)
src/utils/campaignSend.ts                         + M5
src/components/dashboard/marketing/{CampaignWizard,CampaignsTable}.tsx   ~ M5
tests/frontend-api/campaignSend.test.ts           + M5
supabase/
  migrations/<yyyymmdd>_deactivate_ported_crons.sql   + O5  (date = day of first application)
  migrations/<yyyymmdd>_unschedule_ported_crons.sql   + O5
  tests/phase5/{package.json,package-lock.json,cron-switch.test.mjs,mock_cron.sql,README.md}   + O5  PGlite (P4 pins)
  functions/{generate-daily-article,translate-article,hn-collector}/index.ts   ~ O5  re-synced from live (Wave 0)
  functions/gsc-{sitemap-sync,performance,index-url,inspect-url}/index.ts      + O5  added from live (Wave 0)
  functions/{send-confirmation-email,send-notification-email,send-rfq-confirmation-email,send-internal-rfq-notification-email}/   − O5  later commit, after the owner deleted the deployed functions (OW5-14)
  config.toml                                     ~ O5  later commit: remove the sections of the deleted functions only (supabase/config.toml:2-21)
scripts/phase5/
  parity.sql                                      + O5
  compare-sitemap.mjs                             + C5  byte and URL-set comparison of two sitemap files
  flag-values.sql                                 + O5  template UPDATEs of feature_flags.value per switch-over step (no addresses)
  README.md                                       + O5
```

Test directories follow the Phase 4 convention for T1 (`test/<unit>/**`, P4 §3.2) with a `p5` prefix, so `npm --prefix workers/ops test -- test/p5/<area>` runs one unit. Phase 5 T2 files are `test/t2-jobs/p5-<area>.jobs.ts`: neither the Phase 2 T2 include (`test/**/*.t2.ts`, F5-25), the Phase 4 profile `agents` (`test/t2/*.t2.ts`) nor the T1 include (`test/**/*.test.ts`) collects them, and only `vitest.t2.jobs.config.ts` does.

---

## 5. Binding contracts (signatures, names and shapes are binding; bodies per unit)

### 5.1 Environment

Every Phase 5 field is **optional** and checked where it is used with the Phase 4 helper `need(env, …names)` (`agents/config.ts`, throws `ConfigMissingError`, PHASE4_SPEC §4.2, CR-40): the Phase 2 test helpers build `OpsEnv` literals with Phase 2 fields only (workers/ops/test/helpers/ops.ts:37-53) and `workers/ops/tsconfig.json` includes `test/**/*.ts`, so a required field would break the ops typecheck; and an unrelated ops deploy never fails for Phase 5 configuration. A job whose config is missing closes its run `failed` with `error = 'config_missing'` and the names (never values).

```ts
// ===== workers/ops/src/env.ts (K5) — Phase 2 and Phase 4 fields unchanged; Phase 5 additions, all optional =====
export interface OpsEnv {
  // ----- Phase 5: consolidated compute (all optional, checked per use with need()) -----
  // bindings
  TRANSLATIONS?: Queue<TranslationMessageV1>;
  OUTBOUND_MAIL?: Queue<OutboundMailV1>;
  CONTENT_DAILY?: Workflow<ContentDailyParams>;
  SITEMAP?: Workflow<SitemapParams>;
  OPS_DIGEST?: Workflow<OpsDigestParams>;
  SENDER_LIMITER?: DurableObjectNamespace<SenderLimiter>;
  CAD_CONTAINER?: DurableObjectNamespace<CadContainer>;
  SEO_CACHE?: KVNamespace;                    // same namespace as microns-site (D-11)
  // vars
  TRACKING_DOMAIN?: string;                   // "https://micronshub.eu" (supabase/functions/send-campaign/index.ts:8)
  DIGEST_FROM?: string;                       // "MicronsHub Ops <info@micronshub.eu>"
  MARKETING_FOLLOWUPS_ENABLED?: string;       // "false" (anything but "true" = off)
  MARKETING_WARMUP_ENABLED?: string;          // "false"
  OUTBOUND_MAIL_PAUSED?: string;              // "false"; "true" = rollback to the edge path (route 503, dashboard falls back)
  OUTBOUND_MAIL_STOPPED?: string;             // "false"; "true" = no campaign mail at all (route 423, never falls back; consumer holds messages)
  CAD_SLOTS?: string;                         // "3" (must equal containers[0].max_instances)
  CAD_INPUT_HOSTS?: string;                   // comma list of exact hosts the compat path may fetch (C-4)
  CAD_PROCESSING_TIMEOUT_S?: string;          // "120"
  CAD_KEEP_WARM?: string;                     // "off"
  // T2-only overrides (never in production vars; check-bundle fails on them, §5.4)
  PULLPUSH_API_BASE?: string; HN_API_BASE?: string; XOMETRY_API_BASE?: string; INDEXNOW_API_BASE?: string;
  AGENT_GEMINI_BASE_URL?: string; CAD_CONTAINER_BASE_URL?: string;
  // secrets (names)
  INDEXNOW_KEY?: string;                      // canonical; same value as the public /indexnow_key.txt; missing -> run output indexnow: 'not_configured'
  XOMETRY_TOKEN?: string;                     // canonical; missing -> tick records 'not_configured'
  XOMETRY_COOKIE?: string;                    // proposed, optional
}
export interface ContentDailyParams { date: string /* YYYY-MM-DD */; trigger: 'cron' | 'manual' }
export interface SitemapParams { date: string; parent_run_id?: string }
export interface OpsDigestParams { iso_week: string /* YYYY-Www */; trigger: 'cron' | 'manual' }

// ===== workers/site/src/auth/cad-compat.ts (M5) — workers/site/src/env.ts stays unchanged =====
// (the Phase 2 env test counts and checks every field after its Phase 2 marker, workers/site/test/env-api.test.ts:228-238;
//  Phase 4 uses the same pattern for AGENT_APPROVAL_SECRET, PHASE4_SPEC §3.2 / §4.2)
export interface CadCompatEnv extends Env { CAD_COMPAT_TOKEN?: string }   // optional, checked per request (P2 F-22)
export function checkCadCompatToken(env: CadCompatEnv, token: string): Promise<'ok' | 'mismatch' | 'not_configured'>;
```

`SITE_ORIGIN` (Phase 2 var, `https://www.micronshub.eu`) is the sitemap `<loc>` host, the IndexNow host and the article URL base, as `SITE_URL` is in the live functions (jobs §3.2).

### 5.2 Schedule table and dispatcher (`cron/schedule.ts`, `cron/run-schedule.ts`, K5)

```ts
// ===== workers/ops/src/cron/schedule.ts (K5) — pure, no I/O =====
export type JobId = 'reddit-t1' | 'reddit-t2' | 'reddit-t3' | 'hn' | 'tenders' | 'xometry'
  | 'content-daily' | 'sitemap' | 'ops-digest' | 'marketing-followups' | 'marketing-warmup';
export interface ScheduleEntry {
  job: JobId;
  cron: string;                              // 5-field UTC expression; day of week 0 = Sunday … 6 = Saturday (own matcher, not Cloudflare's parser)
  gate: { flag: FlagKey /* P4 agent-types.ts */; when?: (f: AgentFlag) => boolean } | { varName: 'MARKETING_FOLLOWUPS_ENABLED' | 'MARKETING_WARMUP_ENABLED' };
  action: 'workflow' | 'scrape' | 'inline';
}
export const SCHEDULE: readonly ScheduleEntry[];
export function cronMatches(expr: string, at: Date): boolean;           // supports *, */n, a,b, a-b
export function slotFor(expr: string, at: Date, catchUpMin: number): { slot: Date; catchUp: boolean } | null;
export const CATCH_UP_MIN = 60;                                         // D-5; only for entries whose interval is >= 120 min
export function dueJobs(scheduledTime: number): Array<{ job: JobId; slot: string /* YYYY-MM-DDTHH:MMZ */; catchUp: boolean }>;

// ===== workers/ops/src/cron/run-schedule.ts (K5) =====
export interface ScheduleTickResult { fired: Array<{ job: JobId; slot: string; outcome: 'created' | 'enqueued' | 'exists' | 'flag_off' | 'error' }> }
export function runSchedule(env: OpsEnv, scheduledTime: number, deps?: { ports?: Ports; p5?: P5Ports; memo?: Set<string> }): Promise<ScheduleTickResult>;
// never throws: every per-job error is caught, logged '[microns-ops] schedule <job> <slot> error <name>' and returned as outcome 'error'
```

| Job | `cron` (UTC) | Gate | Action | Idempotency | Replaces (live) |
|---|---|---|---|---|---|
| `reddit-t1` | `*/15 * * * *` | `agent.growth.reddit` | `openRun` → `sendP5Scrape(env, {kind:'reddit-tier', params:{tier:1, max:40, slot}, run_id})` | run key `growth.reddit:t1:<slot>` | job 23 |
| `reddit-t2` | `*/30 * * * *` | `agent.growth.reddit` | as above, tier 2 | `growth.reddit:t2:<slot>` | job 24 |
| `reddit-t3` | `0 * * * *` | `agent.growth.reddit` | as above, tier 3 | `growth.reddit:t3:<slot>` | job 29 |
| `hn` | `*/30 * * * *` | `agent.growth.hn` | `openRun` → `sendP5Scrape(env, {kind:'hn-scan', params:{slot}, run_id})` | `growth.hn:<slot>` | job 25 |
| `tenders` | `0 6 * * *` | `agent.growth.tenders` | `openRun` parent → due connectors (one PostgREST read) (`is_active` and `last_scan_at` null or older than 6 h; filtered by `value.countries` when set) → one `tender-scheduled` message each → parent closed `succeeded` with `{due, enqueued, countries}` | parent `growth.tenders:<date>`; child `growth.tenders:<date>:<CC>` | job 28 |
| `xometry` | `0 6,8,10,12,14,16,18 * * *` | `agent.growth.xometry` | `openRun` → `sendP5Scrape(env, {kind:'xometry-scan', params:{slot}, run_id})` | `growth.xometry:<slot>` | GitHub Action schedule |
| `content-daily` | `0 7 * * *` | `agent.content_daily` and `value.steps` ≠ `["sitemap"]` | `CONTENT_DAILY.create({id:'content-daily-<date>', params:{date, trigger:'cron'}})` | instance id (`instance.already_exists` = done) | jobs 17, 15, 22, 21, 19 |
| `sitemap` | `0 9 * * *` | `agent.content_daily` and `value.steps` = exactly `["sitemap"]` (stage S4) | `SITEMAP.create({id:'sitemap-<date>', params:{date}})` | instance id | job 19 |
| `ops-digest` | `30 6 * * 1` | `agent.ops_digest` | `OPS_DIGEST.create({id:'ops-digest-<YYYY>-W<ww>', params:{iso_week, trigger:'cron'}})` | instance id | — |
| `marketing-followups` | `5 * * * *` | var `MARKETING_FOLLOWUPS_ENABLED` = `"true"` | `enqueueDueFollowups(env, slot)` (M5) | `marketing.followups:<slot>` | — (not live) |
| `marketing-warmup` | `5 0 * * *` | var `MARKETING_WARMUP_ENABLED` = `"true"` | `runWarmup(env, date)` (M5) | `marketing.warmup:<date>` | — (not live) |

| Rule | Detail |
|---|---|
| Order | Flag (or var) first, read with `readFlag()`: `enabled` false → nothing, no run row (G5-5). Then idempotency (`openRun` returned `created: false`, or `isAlreadyExists(e)` on `create`) → skip. Then create / send |
| Catch-up | Entries with an interval ≥ 120 min (`tenders`, `xometry`, `content-daily`, `sitemap`, `ops-digest`, `marketing-warmup`) also fire on any tick ≤ 60 min after their slot when the slot has not fired; others only in their own minute (D-5). A per-isolate memo of fired slots avoids repeated `openRun` calls |
| Enqueue failure | `send()` throws → the run is closed `failed` with `error = 'enqueue_failed'`; no retry in later ticks |
| Budget | Dispatch work only (≤ 50 ms CPU per tick; the sub-hourly cron CPU limit is 30 s, D-4) |
| Hook | `src/index.ts` `scheduled()`: `case '* * * * *'`: the Phase 4 flags sync **and** `ctx.waitUntil(runSchedule(env, controller.scheduledTime))` |
| Local trigger | `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=microns-ops` with `{"cron":"* * * * *"}` and a fake clock in the request-scoped deps (T2), or `/cdn-cgi/local/scheduled?cron=*+*+*+*+*` (CF docs cron-triggers) |

### 5.3 Queue messages and handlers

```ts
// ===== workers/ops/src/queues/messages.ts (K5 additions) =====
export type TargetLang = 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pt' | 'sv' | 'da' | 'nb' | 'pl' | 'cs' | 'hu' | 'fi';  // supabase/functions/auto-translate-articles/index.ts:18-32 order
export interface TranslationMessageV1 {
  v: 1; translation_id: string; en_article_id: string; language: TargetLang;
  origin: 'daily' | 'backfill' | 'manual'; for_date: string /* content-daily date */; parent_run_id: string;
}
export interface OutboundMailV1 {
  v: 1; kind: 'campaign' | 'followup';
  campaign_id: string; subscriber_id: string; recipient_record_id: string | null; sequence: number;
  subject: string;                            // A/B choice made by the producer
  preferred_account_id: string | null;        // round-robin assignment; null = default sender (campaign without accounts)
  idem: string;                               // 'camp:<campaign_id>:<subscriber_id>:<sequence>'
  run_id: string;                             // agent_runs id of marketing.send:<campaign_id>
  deferrals: number;                          // 0 when produced; +1 on every cap or spacing deferral copy (rule below); > 30 -> final failure; pause/stop holds do not count
}
// ScrapeMessage (P2 §2.5) is NOT changed (D-27). Phase 5 kinds use their own envelope on the same queue:
export const P5_SCRAPE_KINDS = ['reddit-tier', 'hn-scan', 'tender-scheduled', 'xometry-scan'] as const;
export type P5ScrapeKind = typeof P5_SCRAPE_KINDS[number];
export interface P5ScrapeMessage {
  v: 1; kind: P5ScrapeKind; params: RedditTierParams | HnScanParams | TenderScheduledParams | XometryScanParams;
  run_id: string;            // agent_runs.id opened by the dispatcher (the parent run for tender-scheduled)
  enqueued_at: string; requested_by: 'schedule' | 'manual';
}
export function isP5ScrapeMessage(body: unknown): body is P5ScrapeMessage;   // v === 1 and kind in P5_SCRAPE_KINDS
export interface RedditTierParams { tier: 1 | 2 | 3; max: 40; slot: string }
export interface HnScanParams { slot: string }
export interface TenderScheduledParams { country_code: string; date: string }
export interface XometryScanParams { slot: string }

// ===== workers/ops/src/queues/scrapes-p5.ts (K5) — queues/scrapes.ts (Phase 2) stays unchanged =====
export type P5ScrapeHandler = (msg: Message<P5ScrapeMessage>, env: OpsEnv, ctx: ExecutionContext, deps?: { ports?: Ports; p5?: P5Ports }) => Promise<void>;  // the handler acks or retries
export function sendP5Scrape(env: OpsEnv, m: Omit<P5ScrapeMessage, 'v' | 'enqueued_at' | 'requested_by'> & { requested_by?: 'schedule' | 'manual' }): Promise<void>;  // typed send on env.SCRAPES
export const scrapesP5Consumer: (batch: MessageBatch<unknown>, env: OpsEnv, ctx: ExecutionContext) => Promise<void>;
// kind table (fixed import paths and names): 'reddit-tier' -> collectors/reddit.ts handleRedditTier · 'hn-scan' -> collectors/hn.ts handleHnScan
//   'tender-scheduled' -> collectors/tenders.ts handleTenderScheduled · 'xometry-scan' -> xometry/queue.ts handleXometryScan
// an invalid body (isP5ScrapeMessage false) is logged and acked (it can never succeed)
```

| Queue / kind | Consumer config | Retry rule | Final failure |
|---|---|---|---|
| `translations` (new) | `max_batch_size` 1, `max_retries` 5, `retry_delay` 120, `max_concurrency` 3, DLQ `translations-dlq` (wrangler.jsonc.draft:333-342) | all models overloaded → `retry({delaySeconds: 120 × attempts})`; parse or length-guard failure → `retry()` | final delivery (`attempts > 5`, the Phase 2 counting rule, workers/ops/src/queues/scrapes.ts:100-103): run `failed`, one plain-text alert, `retry()` → DLQ |
| `outbound-mail` (new) | `max_batch_size` 10, `max_retries` 3, `retry_delay` 60, `max_concurrency` 2, DLQ `outbound-mail-dlq` (wrangler.jsonc.draft:343-351) | Messages of a batch are handled one after another. Spacing: `reserve` returns `not_before`; ≤ 60 s away → the consumer waits in-process, else **defers**. **Defer** = `OUTBOUND_MAIL.send({...body, deferrals: deferrals + 1}, {delaySeconds})` (`deferrals` unchanged for a pause or stop hold, so a long stop never turns held mail into failures) then `ack()` the original, so waiting never uses a retry: all senders at cap → delay to the next 00:00 UTC + jitter ≤ 600 s; `OUTBOUND_MAIL_PAUSED` or `OUTBOUND_MAIL_STOPPED` → 3,600 s; spacing > 60 s → `not_before − now`. Every computed delay is clamped to `min(86_400, …)` (CF limit for `delaySeconds`: 24 h, `../phase2/cfdocs/queues_platform_limits.md:36`, fetched 2026-10-02; caps exhausted within 10 min after midnight would otherwise exceed it and make `send()` throw). `retry()` only for provider 5xx, 429 and network errors | provider 4xx, final retry, or `deferrals > 30`: event `bounced` with `{error}`, recipient `failed`, limiter `release` |
| `scrapes` `reddit-tier`, `hn-scan` | Phase 2 `scrapes` consumer config; handled by `scrapesP5Consumer` | none: any throw closes the run `failed` and acks (the next slot is the retry, as pg_cron) | run `failed` |
| `scrapes` `tender-scheduled` | as above | runs `api/tender-scan.js` in-process with `runNodeHandler` exactly as the Phase 2 consumer does (F5-21); 5xx/throw → `retry({delaySeconds: 300})` | final delivery (`attempts > 3`): child run `failed`, then `retry()` → DLQ `scrapes-dlq` |
| `scrapes` `xometry-scan` | as above | none: always ack after `closeRun` (the next slot is the retry, as the Action) | run `failed` |

All messages stay far below 128 KB (bodies are read by the consumer from the database; F5-18).

### 5.4 Ports and stub seams (`ports/p5.ts`, K5)

```ts
// ===== workers/ops/src/ports/p5.ts (K5) =====
export interface TextLlmMeta { agent: string; run_id: string; tenant_id: string; step: string; prompt: string }  // = the five cf-aig-metadata keys
export type TextLlmResult =
  | { ok: true; text: string; stop: string; model: string; usage: LlmUsage /* P4 type */ }
  | { ok: false; status: number | null; code: 'not_found' | 'rate_limited' | 'server' | 'timeout' | 'blocked' | 'empty' | 'other'; retryable: boolean; message: string };
export interface TextLlmPort {
  anthropic(c: { model: string; maxTokens: number; userText: string; timeoutMs: number; gatewayTimeoutMs?: number; meta: TextLlmMeta }): Promise<TextLlmResult>;
  gemini(c: { model: string; prompt: string; temperature: number; maxOutputTokens: number; timeoutMs: number; meta: TextLlmMeta }): Promise<TextLlmResult>;
}
export type SourceName = 'pullpush' | 'hn' | 'xometry' | 'indexnow';
export interface SourcePort { base(name: SourceName): string; fetch: typeof fetch }
// production bases: https://api.pullpush.io · https://hn.algolia.com/api/v1 · https://api.xometry.eu · https://www.bing.com
export interface SitemapStoragePort {
  upload(name: 'sitemap-complete.xml', xml: string, o: { contentType: 'application/xml'; cacheControl: '3600' }): Promise<{ ok: true } | { ok: false; status: number; message: string }>;
}
export interface GmailSendPort { send(accessToken: string, rawMime: Uint8Array): Promise<{ ok: true; id: string } | { ok: false; status: number; retryable: boolean; message: string }> }
export interface ContainerPort { fetch(slot: string, req: Request): Promise<Response>; destroy(slot: string): Promise<void> }
export interface TelegramTextPort {   // plain sendMessage, no parse_mode (D-28); never throws (live ignores Bot API errors)
  send(text: string, o?: { disableWebPagePreview?: boolean }): Promise<{ ok: boolean; status: number | null }>;
}
export interface P5Ports { textLlm: TextLlmPort; sources: SourcePort; storage: SitemapStoragePort; gmailSend: GmailSendPort; container: ContainerPort; telegramText: TelegramTextPort }
export function makeP5Ports(env: OpsEnv): P5Ports;
```

| Port | Production | T1 fake (vitest, Node) | T2 (`wrangler dev --local`) |
|---|---|---|---|
| `textLlm.anthropic` | `anthropicFor(env, meta).messages.create({model, max_tokens, messages:[{role:'user', content: userText}]}, {timeout: timeoutMs, headers: {'cf-aig-request-timeout': String(gatewayTimeoutMs)}})` (P4 §4.15 client: provider-native gateway URL, `cf-aig-authorization`, 5 metadata keys, payload logging off, BYOK, `maxRetries: 0`); no `system`, no `thinking`, no `fallbacks` (D-29); `generate-en` passes `timeoutMs` 310,000 and `gatewayTimeoutMs` 300,000; result `ok` only for `stop_reason` `end_turn` with a text block, `max_tokens` → `{ok:false, code:'other', retryable:false}`, `refusal` → `blocked` | `FakeTextLlm` (fixtures by `meta.prompt` + SHA-256 of the input) | `AGENT_LLM_BASE_URL` (Phase 4 stub `/anthropic/v1/messages`, replay by header `x-microns-prompt`) |
| `textLlm.gemini` | `POST (await …getUrl('google-ai-studio')) + '/v1beta/models/<model>:generateContent'` with the headers of the Phase 4 builder `gatewayHeaders(env, meta)` (`agents/gateway.ts`, P4 §9) plus `content-type`; no provider key header (stored key, D-7) | same fake | `AGENT_GEMINI_BASE_URL` → stub `/google-ai-studio/v1beta/models/:model:generateContent` (scripted 404/429/5xx per model) |
| `sources` | global `fetch`, production bases | scripted `fetch` | `*_API_BASE` vars → stub routes `/pullpush/…`, `/hn/…`, `/xometry/partners/graphql`, `/indexnow/indexnow` |
| `storage` | `POST {SUPABASE_URL}/storage/v1/object/sitemaps/<name>` with `x-upsert: true`, `content-type`, `cache-control: max-age=3600`, service role (re-check the header form against storage-js at build: the live object shows `cacheControl` `max-age=3600`) | recorder | stub `/storage/v1/object/sitemaps/:name` (records bytes and headers) |
| `gmailSend` | `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` `{raw: base64url}` | recorder | `GMAIL_API_BASE` (Phase 4 stub) + `/gmail/v1/users/me/messages/send` |
| `container` | `getContainer(env.CAD_CONTAINER, slot).fetch(req)`, `.destroy()` | scripted | `CAD_CONTAINER_BASE_URL` → stub route or a locally started patched service (§7 D5) |
| `telegramText` | `POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage` `{chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview}` (the token never appears in a log line or error text) | recorder | `TELEGRAM_API_BASE` (Phase 4 var) → `stubs/telegram.mjs` |

| Safety | Rule |
|---|---|
| No override in production | `scripts/check-bundle.mjs` fails when production `vars` contain any `*_API_BASE`, `AGENT_GEMINI_BASE_URL` or `CAD_CONTAINER_BASE_URL` (extends Phase 4 T-3) |
| Fail closed | `makeP5Ports` throws when an override var is set while `env.AI` is bound (every production deploy binds it) |
| Phase 4 ports reused | DB, Resend (`mailer`), Gmail access tokens (`gmail.accessToken`), structured LLM (digest narrative), R2 (`blob`), Analytics Engine (`events`), clock come from `makePorts(env)` (P4 §4.6); Phase 5 never re-implements them. T1 tests build both with `makeTestPorts()` / `makeTestP5Ports()` from `src/ports/p5-stub/` |

### 5.5 Run records (`agent_runs`)

`AgentKey` lives in `workers/ops/src/agents/runs.ts` and holds only the Phase 4 keys (P4 CR-34, §4.7); K5 adds the 11 Phase 5 keys there in Wave 0: `'content_daily' | 'content_daily.translate' | 'content_daily.sitemap' | 'growth.reddit' | 'growth.hn' | 'growth.tenders' | 'growth.xometry' | 'marketing.send' | 'marketing.followups' | 'marketing.warmup' | 'ops_digest'` (all match the table check `^[a-z0-9_]+(\.[a-z0-9_]+)*$`, `../phase4/agent_layer.sql:98`). Rule: `idempotency_key` always starts with the agent key and a colon; a unit that can run again after a final outcome adds a suffix (D-30).

| Agent | Opened by | `trigger` | `idempotency_key` | Links | `output` (≤ 8 KB; never e-mail addresses, bodies or tokens) |
|---|---|---|---|---|---|
| `content_daily` | Workflow step `open-run` | `cron` / `manual` | `content_daily:<date>` | `workflow_name` `content-daily`, instance id; `subject_type` `article` | `{article_id, slug, words, no_titles, translations:{<lang>:'ok'\|'missing'\|'failed'}, backfilled, lag_days:{<lang>:n}, fix_links:{<lang>:{scanned, updated}}, sitemap:{urls}}` |
| `content_daily.translate` | consumer | `queue` | `content_daily.translate:<translation_id>:<lang>:<for_date>` (D-30) | `parent_run_id`; `subject_type` `article` | `{language, origin, slug, indexnow, model, tables_translated}` |
| `content_daily.sitemap` | `SitemapWorkflow` | `workflow` (`cron` in stage S4) | `content_daily.sitemap:<date>` | `parent_run_id` when started by content-daily | `{urls, articles, bytes, sha256, uploaded, shadow_key}` |
| `growth.reddit` | dispatcher | `cron` | `growth.reddit:t<N>:<slot>` | — | `{tier, due, scanned, fetched, leads_new, high, pullpush_status:{<code>:n}}` |
| `growth.hn` | dispatcher | `cron` | `growth.hn:<slot>` | — | `{scanned, leads_new, high_or_medium, errors}` |
| `growth.tenders` | dispatcher (parent), consumer (child) | `cron` / `queue` | `growth.tenders:<date>` / `growth.tenders:<date>:<CC>` | child `parent_run_id` | parent `{due, enqueued, countries}`; child = the handler's JSON counts + `status` |
| `growth.xometry` | dispatcher | `cron` | `growth.xometry:<slot>` | — | xc §2.6 step 7 (`auth`, `token_fp` 12 hex, counts, `errors` ≤ 20) |
| `marketing.send` | `routes/marketing-send.ts` | `dashboard` | `marketing.send:<campaign_id>`; a re-queue after a failed run `marketing.send:<campaign_id>:r<n>` (n = 2, 3, …; D-30) | `subject_type` `marketing_campaign` | `{expected, queued, sent, bounced, waiting}`; on an enqueue error `{expected, queued}` with `error = 'enqueue_partial'` |
| `marketing.followups` / `marketing.warmup` | dispatcher | `cron` | `marketing.followups:<slot>` / `marketing.warmup:<date>` | — | counts |
| `ops_digest` | Workflow | `cron` / `manual` | `ops_digest:<YYYY>-W<ww>` | instance id | `{sent, recipient_set: true, sections, purge}` |

### 5.6 Flags (KV `FLAGS`, rows seeded by P4-1) and vars

| Key | `value` read by Phase 5 (owner sets it at the switch-over step) | Off / missing |
|---|---|---|
| `agent.content_daily` | `{mode, model, steps: Array<'generate'\|'translate'\|'fix_links'\|'sitemap'>, backfill_per_language_per_day: 5, shadow_generate: false}` | no content-daily, no sitemap; already-queued translations are acked and closed `skipped` with `reason: 'flag_off'` (G5-5) |
| `agent.growth.reddit` | `{mode}` | nothing |
| `agent.growth.hn` | `{mode}` | nothing |
| `agent.growth.tenders` | `{mode, countries?: string[], relevance: false, llm_cap: 20}` (relevance stays off in Phase 5) | nothing |
| `agent.growth.xometry` | `{mode, borderline_exclude: string[], notify_new: false, token_reminder_hours: 24}` | nothing |
| `agent.ops_digest` | `{mode, recipient, ads_upload: false, purge: true}` (recipient is data, never in the repo) | nothing |

`mode` per D-23, taken as `value.mode ?? kv.mode ?? 'shadow'` by Phase 4 `readFlag(env, key)` (KV `cacheTtl` 30 s, fail closed: missing or malformed → `enabled: false`; P4 §4.7, CR-12). Running Workflow instances re-read the flag before every side-effecting step (AGENTS.md §2.3); §6 names those steps. The dashboard switch (P4 `FlagEditBody`) edits only `enabled`, `mode` and `writes`; the other `value` fields above are set by the owner with the template UPDATEs of `scripts/phase5/flag-values.sql` (the KV mirror picks them up within a minute, P4 §4.13). Marketing switches are the four vars of §5.1 (D-16); no new flag key is added (CANON.md §7).

### 5.7 Workflows

| Class | Name / binding | Params | Instance id | Events waited for | Step profiles |
|---|---|---|---|---|---|
| `ContentDailyWorkflow` | `content-daily` / `CONTENT_DAILY` | `ContentDailyParams` | `content-daily-<YYYY-MM-DD>` | `translations-done` (6 h, caught; waited for only when step 7 sent at least one `daily` message) | P4 `workflows/steps.ts`; `generate-en`: retries limit 2, delay 5 min, constant, timeout 10 min (D-22) |
| `SitemapWorkflow` | `sitemap` / `SITEMAP` | `SitemapParams` | `sitemap-<YYYY-MM-DD>` | — | DB profile |
| `OpsDigestWorkflow` | `ops-digest` / `OPS_DIGEST` | `OpsDigestParams` | `ops-digest-<YYYY>-W<ww>` | — | DB profile; `narrative` = P4 profile `LLM_EXTRACT` (P4 §4.10 step rules) |

Event `translations-done` payload `{translation_id}`; sent by the `translations` consumer when all 13 languages of a `daily` group exist; a second event is harmless (events are buffered, P4 N-3). Every step returns compact JSON (< 1 MiB; the sitemap XML never leaves its step, F5-18).

### 5.8 Durable Objects and the Container

```ts
// ===== workers/ops/src/do/sender-limiter.ts (M5) — one object per sender account id, or 'default' =====
export type ReserveResult = { status: 'ok'; not_before: number /* epoch ms of the allotted slot */ } | { status: 'already_sent' } | { status: 'exhausted'; resets_at: string };
export class SenderLimiter extends DurableObject<OpsEnv> {
  reserve(i: { idem: string; now: number }): Promise<ReserveResult>;   // cap per D-17 (sender row cached 60 s; 'default' cap DEFAULT_SENDER_DAILY_CAP = 500, D-24);
                                                                       // slot = max(now, last_slot + spacing) with spacing per D-17 (settings cached 60 s);
                                                                       // a key 'reserved' > 10 min ago is re-used without counting twice
  commit(i: { idem: string; provider_id: string }): Promise<void>;    // kept 30 days, pruned by an alarm
  release(i: { idem: string }): Promise<void>;                        // reserved -> removed, sent_today - 1
  stats(): Promise<{ day: string; sent_today: number; cap: number; last_sent_at: string | null }>;
}

// ===== workers/ops/src/cad/types.ts (D5 additions, all optional, backward compatible) =====
export type CadPriority = 'batch' | 'interactive';
export interface AcquireRequest { job_id: string; backend_candidates: BackendName[]; deadline_s: number; priority?: CadPriority /* default 'batch' */ }
export type AcquireResult = { granted: true; lease_id: string; backend: BackendName; slot?: string /* 'cad-0'…'cad-2' when backend = 'container' */ } | { granted: false; retry_after_s: number };
export interface ReleaseOutcome { ok: boolean; retryable?: boolean; backend_down?: boolean; recycle?: boolean }
export interface CadLease { lease_id: string; slot?: string }
// CadBackend.run(job, input, signal, lease?: CadLease)   (4th argument added)
// UnfoldFetcher = (req: Request, lease: CadLease) => Promise<Response>   (lease added; the 'vps' fetcher ignores it)

// ===== workers/ops/src/do/cad-router.ts (D5 additions) =====
// acquire(): container = lowest free slot; 'batch' holds at most CAD_SLOTS - 1 container leases, 'interactive' any free slot
// release(lease_id, o): o.recycle -> P5Ports.container.destroy(slot)
recycle(slot: string): Promise<void>;
// snapshot() gains slots[] {slot, lease?, since?}; the container backend is never probed actively (C-8); the vps probe stays

// ===== workers/ops/src/cad-container/cad-container.ts (D5) — exported by microns-ops (C-1) =====
import { Container } from '@cloudflare/containers';          // the ops copy; index.ts re-exports ContainerProxy from the same specifier
export class CadContainer extends Container<CadEnv> {
  defaultPort = 8000; sleepAfter = '10m'; enableInternet = false; pingEndpoint = 'localhost/health';
  // envVars = { API_KEY: env.CAD_SHARED_SECRET, REQUIRE_API_KEY: '1', PROCESSING_TIMEOUT: env.CAD_PROCESSING_TIMEOUT_S ?? '120' }
}
// Registration through the inherited static setter, AFTER the class body (never a `static outboundByHost = …` class field: F5-19)
CadContainer.outboundByHost = { [INPUT_HOST]: fetchCompatInput };   // HTTP only, no CA needed
// workers/ops/src/cad-container/input-proxy.ts
export const INPUT_HOST = 'cad-input.internal';
export function encodeInputUrl(original: string): string;     // 'http://cad-input.internal/u/' + base64url(original)
export function fetchCompatInput(request: Request, env: CadEnv, ctx: unknown): Promise<Response>;  // allow-list, https only, ≤ 3 redirects re-checked, else 403
export function isAllowedInputHost(url: URL, hosts: string): boolean;   // exact host match against CAD_INPUT_HOSTS
// workers/ops/src/cad-container/slots.ts
export function slotName(i: number): string;    // 'cad-' + i
export function slotCount(env: { CAD_SLOTS?: string }): number;
```

Outcome mapping in `HttpUnfoldBackend` (amends P4 §9.2): service 504 `Processing timeout …` → `{ok:false, code:'timeout', retryable:false}`; 500 `Processing crashed (exit …)` → retryable once with `recycle: true`; 401 → `backend_error`, non-retryable, card "CAD key mismatch"; 503 `API key not configured` → `unavailable`, card; no response before the abort → retryable (Phase 4 rule). Deadlines: service 120 s; consumer abort 300 s (Phase 4); compat path 110 s end to end (the edge functions abort at 120 s, supabase/functions/extract-flat-pattern/index.ts:157).

Container wiring tests (D5, T1, the real `@cloudflare/containers` 0.3.7 with the Phase 4 `cloudflare:workers` stub, no alias): (a) `ContainerProxy` exported by `src/index.ts` is the same object as `ContainerProxy` of `import * as lib from '@cloudflare/containers'`, and `CadContainer.prototype` inherits from `lib.Container.prototype` (one module instance); (b) `Object.hasOwn(CadContainer, 'outboundByHost')` is `false` and `CadContainer.outboundByHost[INPUT_HOST]` is `fetchCompatInput` (registered through the setter); (c) `new lib.ContainerProxy({props: {className: 'CadContainer', containerId: 't', enableInternet: false, interceptAll: false}}, env).fetch(new Request('http://cad-input.internal/u/<b64>'))` reaches `fetchCompatInput` (scripted `fetch`), and an unknown host answers 520. The same three facts are re-checked in preview at S9 (a) (R5-16).

### 5.9 HTTP contracts

| Public path | Method | Gate (action ID) | Ops handler | Request | Success | Errors (P2 §2.10 shapes plus) |
|---|---|---|---|---|---|---|
| `/api/marketing?action=send-campaign` | POST | `MK-8`: Supabase JWT, role array contains a STAFF role; rate key `u:<uid>:send-campaign` on `API_RATE_LIMIT` | `routes/marketing-send.ts` `handleSendCampaign` | JSON `{campaign_id: <uuid>}`, ≤ 4 KB | 202 `{"queued": n, "run_id": "<uuid>"}`; repeated call while the campaign's newest run is `running` or `succeeded` → 202 with that run (`queued` 0); after a `failed` run → a re-queue run (`queued` = recipients without a final event) | 400 `{"error":"invalid_campaign"}`; 404 `{"error":"campaign_not_found"}`; 409 `{"error":"campaign_already_sent"}`; 409 `{"error":"campaign_partially_queued"}` (paused after a failed run, step 6); 423 `{"error":"sending_stopped"}` when `OUTBOUND_MAIL_STOPPED` = `"true"`; 503 `{"error":"sending_paused"}` when `OUTBOUND_MAIL_PAUSED` = `"true"`; 500 `{"error":"enqueue_failed","queued":n}` when the enqueue breaks after the run was opened (run closed `failed`) |
| `/api/cad/<token>/flat-pattern` | POST | `CD-1`: `<token>` equals `CAD_COMPAT_TOKEN` (constant-time; missing secret → 500 config error, F-22); principal `MACHINE:cad-compat`; rate key `m:cad-compat` on `API_RATE_LIMIT` | `routes/cad-compat.ts` (function URL `/api/cad/flat-pattern`) | the edge functions' JSON body, unchanged (fields and validation rules: Appendix P.3) | the container's status, `content-type` and body bytes unchanged | 400 `{"detail":"…"}` for a body that fails validation (texts in Appendix P.3), 503 `{"detail":"CAD busy"}`, 502 `{"detail":"CAD unavailable"}` for any other failure inside the ops compat branch (FastAPI `detail` shape); the branch catches every error itself, is never forwarded, and logs its path as `/api/cad/<redacted>/flat-pattern`. A failure of the RPC call itself (the ops Worker throws or is unreachable) answers the frozen site 500 `text/plain` "Internal Server Error" (F5-26); both edge functions treat any non-2xx answer alike (F5-16) |

`send-campaign` order in ops (binding, so that the frontend fallback of §9 can never cause a second send): (1) body is JSON `{campaign_id}` with a UUID → else 400 `invalid_campaign`; (2) campaign row exists → else 404 `campaign_not_found`; (3) `status` is `sent` → 409 `campaign_already_sent`; (4) `OUTBOUND_MAIL_STOPPED` = `"true"` → 423 `sending_stopped`; (5) read the campaign's runs (`agent = 'marketing.send'`, `idempotency_key` = `marketing.send:<campaign_id>` or starting with `marketing.send:<campaign_id>:r`), newest first: newest `running` or `succeeded` → 202 with that `run_id` and `queued` 0; (6) `OUTBOUND_MAIL_PAUSED` = `"true"` → 503 `sending_paused` when the campaign has no run, and 409 `{"error":"campaign_partially_queued"}` when it has a `failed` run (never the fallback answer there: the edge function would mail recipients the Worker already reached); (7) open the run (`marketing.send:<campaign_id>` when the campaign has no run, else `marketing.send:<campaign_id>:r<n>` with n = number of existing runs + 1; `created: false` → 202 with that run, `queued` 0, which covers two concurrent clicks); (8) inside one `try`: read the recipients in pages of 1,000 ordered by `id` (PostgREST's row cap, `Range` headers), compute `expected` (first run: the size of the recipient selection of §6.5; a re-queue run counts the recipients that already have a final event or a message still in flight from the earlier run, plus the recipients it queues now (changed 2026-10-09 so a campaign whose list shrank between runs still closes)) and write it to the run output, drop recipients that already have a `sent` or `bounced` `marketing_events` row for this campaign (a first run drops none), `sendBatch` the rest (≤ 100 messages per call), set `marketing_campaigns.status = 'sending'` (allowed by `marketing_campaigns_status_check`: draft, scheduled, sending, sent, cancelled; live 2026-10-04), answer 202 `{queued, run_id}`; (9) any error inside that `try` → `closeRun` `failed` with `error = 'enqueue_partial'` and output `{expected, queued}` (messages already sent to the queue stay valid: their limiter keys make a later duplicate a no-op), answer 500 `{"error":"enqueue_failed","queued":n}`; a later click re-queues through step (7). Gate answers (401 `unauthorized`, 403 `forbidden`, 429 `rate_limited`) keep the Phase 2 shapes (P2 §2.10).

`cad-compat` steps in ops (xc §3.5): validate the body (rules in Appendix P.3; the input URL must be `https:` with a host in `CAD_INPUT_HOSTS`); `CadRouter.acquire({job_id:'compat:'+uuid, backend_candidates:['container'], deadline_s:110, priority:'interactive'})`, retry every 2 s up to 20 s; `POST http://cad/flat-pattern` with `X-API-Key: CAD_SHARED_SECRET` and the input URL replaced by `encodeInputUrl(<original>)`; abort at 110 s from the start of the request; return the response unchanged; release; one Analytics Engine point `event = 'cad_compat'` (no `agent_runs` row: a request, not a scheduled run).

### 5.10 Supabase objects touched (no schema change in Phase 5)

| Job | Reads | Writes | RPCs |
|---|---|---|---|
| content | `articles`, `article_titles`, `article_generation_queue` | `articles` (insert; PATCH `content` for link fixes), `article_generation_logs`, `article_titles.processed/processed_at`, `gsc_monitored_urls` (upsert `on_conflict=url`); Storage `sitemaps/sitemap-complete.xml` | `enqueue_next_article`, `get_next_queue_job`, `mark_queue_job_completed`, `mark_queue_job_failed` |
| collectors | `monitored_subreddits`, `lead_keywords`, `leads` (newest HN `posted_at`), `tender_connectors` | `leads` (upsert: reddit `on_conflict=source_url`, HN `on_conflict=source,external_id`, `Prefer: resolution=ignore-duplicates,return=representation`), `monitored_subreddits.last_scanned_at`; tenders through `api/tender-scan.js` unchanged | — (the live call to the absent `increment_keyword_match_count` is dropped, jobs N5-7) |
| Xometry | `xometry_offers` | `xometry_offers` (three-step upsert, xc §2.5; `updated_at` set explicitly) | — |
| marketing | `marketing_campaigns`, `marketing_settings`, `marketing_sender_accounts`, `marketing_subscribers`, `marketing_campaign_recipients` | `marketing_events`, `marketing_campaign_recipients.status/sent_at`, `marketing_sender_accounts.emails_sent_today` (display mirror), `marketing_campaigns.status/sent_count/updated_at`; warm-up (off) `warmup_current_limit`, `warmup_enabled` | — |
| digest | `rfqs`, `quote_workflows`, `orders`, `agent_runs`, `cad_jobs`, `articles`, `leads`, `tenders`, `marketing_events` (counts via `Prefer: count=exact`, sums over ≤ 1,000 rows in the Worker; no SQL function added) | — | `agent_retention_purge` (first Monday of a month) |
| all | `feature_flags` (via KV only) | `agent_runs` | `agent_run_begin` (P4) |

### 5.11 Configuration

```jsonc
// ===== workers/ops/wrangler.jsonc — Phase 5 additions (K5) =====
"kv_namespaces": [ /* FLAGS (P4) */ { "binding": "SEO_CACHE", "id": "<KV_ID_SEO_CACHE>" } ],
"queues": {
  "producers": [ /* SCRAPES, CAD_JOBS, AGENT_EVENTS */ { "binding": "TRANSLATIONS", "queue": "translations" }, { "binding": "OUTBOUND_MAIL", "queue": "outbound-mail" } ],
  "consumers": [ /* scrapes, cad-jobs, agent-events */
    { "queue": "translations",  "max_batch_size": 1,  "max_retries": 5, "retry_delay": 120, "max_concurrency": 3, "dead_letter_queue": "translations-dlq" },
    { "queue": "outbound-mail", "max_batch_size": 10, "max_retries": 3, "retry_delay": 60,  "max_concurrency": 2, "dead_letter_queue": "outbound-mail-dlq" } ] },
"workflows": [ /* rfq-intake, quote, post-order */
  { "name": "content-daily", "binding": "CONTENT_DAILY", "class_name": "ContentDailyWorkflow" },
  { "name": "sitemap",       "binding": "SITEMAP",       "class_name": "SitemapWorkflow" },
  { "name": "ops-digest",    "binding": "OPS_DIGEST",    "class_name": "OpsDigestWorkflow" } ],
"durable_objects": { "bindings": [ /* RFQ_THREAD, MATERIAL_STOCK, CAD_ROUTER */
  { "name": "SENDER_LIMITER", "class_name": "SenderLimiter" }, { "name": "CAD_CONTAINER", "class_name": "CadContainer" } ] },
"migrations": [ /* v1 (P4) */ { "tag": "v2", "new_sqlite_classes": ["SenderLimiter", "CadContainer"] } ],
"containers": [ { "name": "microns-cad", "class_name": "CadContainer",
  "image": "registry.cloudflare.com/<CF_ACCOUNT_ID>/microns-cad:<IMAGE_TAG>",   // format exactly as printed by `wrangler containers push`
  "instance_type": "standard-1", "max_instances": 3 } ],
"triggers": { "crons": [ "* * * * *", "*/10 * * * *" ] },   // unchanged (D-3)
"vars": { /* P2, P4 */ "TRACKING_DOMAIN": "https://micronshub.eu", "DIGEST_FROM": "MicronsHub Ops <info@micronshub.eu>",
  "MARKETING_FOLLOWUPS_ENABLED": "false", "MARKETING_WARMUP_ENABLED": "false", "OUTBOUND_MAIL_PAUSED": "false", "OUTBOUND_MAIL_STOPPED": "false",
  "CAD_SLOTS": "3", "CAD_INPUT_HOSTS": "<CAD_INPUT_HOSTS>", "CAD_PROCESSING_TIMEOUT_S": "120", "CAD_KEEP_WARM": "off" },
"secrets": { "required": [ /* P2 list, unchanged */ ] }      // Phase 5 secrets (INDEXNOW_KEY, XOMETRY_TOKEN, XOMETRY_COOKIE) are checked per use, as Phase 4's (P4 §4.1, CR-33), so an unrelated ops deploy never fails for them
// CAD_BACKEND_DEFAULT stays "vps" in the merged file; the owner flips it at S9 (§10)
```

`CAD_INPUT_HOSTS` placeholder = the exact presign hosts produced by the Phase 2 `r2Target()` (jurisdiction `eu`) and `legacyTarget()` for the RFQ bucket (workers/shared/src/storage/s3-presign.ts, P2 §2.3); D5 adds a test that presigns with those functions and checks `isAllowedInputHost` accepts them. Site: no `wrangler.jsonc` change (`CAD_COMPAT_TOKEN` is an optional secret, checked per request).

| Name | Worker | Kind | Status | Evidence |
|---|---|---|---|---|
| `TRANSLATIONS`, `OUTBOUND_MAIL`, `CONTENT_DAILY`, `SITEMAP`, `OPS_DIGEST`, `SENDER_LIMITER`, `CAD_CONTAINER`, `SEO_CACHE` | ops | binding | draft names | wrangler.jsonc.draft:273-302, :366-371, :389 |
| queues `translations`, `outbound-mail` (+ DLQs); classes; container `microns-cad` | ops | queue / class / container | CANON | CANON.md §3 |
| `INDEXNOW_KEY`, `XOMETRY_TOKEN`, `CAD_SHARED_SECRET` | ops | secret | CANON | CANON.md §3; wrangler.jsonc.draft:483-485 |
| `XOMETRY_COOKIE` | ops | secret | **proposed** | xc §2.8 |
| `CAD_COMPAT_TOKEN` | site | secret | **proposed** | C-4 |
| `TRACKING_DOMAIN`, `DIGEST_FROM`, `MARKETING_*_ENABLED`, `OUTBOUND_MAIL_PAUSED`, `OUTBOUND_MAIL_STOPPED`, `CAD_SLOTS`, `CAD_INPUT_HOSTS`, `CAD_PROCESSING_TIMEOUT_S`, `CAD_KEEP_WARM` | ops | var | **proposed** | §5.1 |
| `PULLPUSH_API_BASE`, `HN_API_BASE`, `XOMETRY_API_BASE`, `INDEXNOW_API_BASE`, `AGENT_GEMINI_BASE_URL`, `CAD_CONTAINER_BASE_URL` | ops | var | **proposed, T2 only** | §5.4 |
| `MK-8`, `CD-1`; endpoint `cad-compat`; machine `cad-compat` | site | gate IDs | **proposed** | §5.9 |
| Agent keys of §5.5 | data | `agent_runs.agent` | **proposed** (flag-derived keys follow AGENTS.md §2.1) | §5.5 |
| R2 prefix `phase5-shadow/` | `microns-private` | prefix | **proposed** | D-23 |
| GitHub: workflow `cad-image.yml`, environment `cad-release`, repository variable `XOMETRY_SCAN_SCHEDULE` | repo | CI | **proposed** | C-2, X-5 |
| Hyperdrive `SUPABASE_DB`, `GEMINI_API_KEY`, `PUBLIC_FILES` on ops | — | — | not created (X-1, D-7, M-3) | wrangler.jsonc.draft:283-286, :437-441, :481-482 |

---

---

## 6. Behaviour per job (bodies; each unit reads the cited analysis section, then the deltas here)

The analyses (`jobs.md`, `xometry-cad.md`, `reconcile.md`) hold the line-level port details with live and repo evidence. This section fixes what changed when they were consolidated and the rules that cross units. **Where §6 and an analysis differ, §6 wins.**

### 6.1 Consolidation deltas (binding)

| # | Analysis says | This spec | Reason |
|---|---|---|---|
| CD5-1 | `readAgentFlag`, `dry_run` (jobs §4.3 step 1, §4.4 step 2, §5 step 3, §8 step 1; xc §2.6 step 1) | `readFlag(env, key)` (P4 §9 and CR-12 also export the alias `readAgentFlag`; both are the same function, Phase 5 code imports `readFlag`); flag `mode: 'shadow'` replaces `dry_run` (D-23); `value.shadow_generate` decides whether a shadow content run calls the model | P4 CR-12; one mode vocabulary for every job |
| CD5-2 | Tenders reuse the Phase 2 kind `tender-scan` (jobs §6) | Kind `tender-scheduled` (D-27), same handler in-process | The Phase 2 kind keeps its MACHINE semantics and plain run id (F5-21); child runs need `agent_runs` ids |
| CD5-3 | Xometry on its own cron (`XOMETRY_CRON`, `cron.ts`, `runXometryTick(env, ports, scheduledTime)`, key `xometry:<ISO>`, xc §2.2, §2.6) | Schedule entry `xometry` + kind `xometry-scan`; the dispatcher opens the run `growth.xometry:<slot>`; `xometry/queue.ts` calls `xometry/tick.ts` `runXometryTick(env, ports, p5, {slot, run_id})`; overlap guard, token gate, alerts unchanged | D-3, D-4, key rule §5.5 |
| CD5-4 | The `*/10` dispatcher closes a campaign (jobs §7.3 step 9) | The `outbound-mail` consumer closes it (`marketing/campaign-close.ts`) | No edit to a Phase 4 RP file |
| CD5-5 | Limiter `wait` → `retry({delaySeconds})`; exhausted → retry at midnight (jobs §7.3 step 2) | Wait in-process up to 60 s, else defer by re-send (§5.3) | With `max_retries` 3, retries spent on waiting would send good mail to the DLQ |
| CD5-6 | Migration tag "next unused" (jobs §12) | `v2` = `SenderLimiter`, `CadContainer` | P4 F4-4 fixes it |
| CD5-7 | Remove the `schedule:` block of `xometry-scan.yml` at P5-8 (xc §2.10) | Repository-variable guard (X-5); the file is deleted in P6-6 | Merging changes nothing; rollback is a variable flip |
| CD5-8 | Redeploy `extract-flat-pattern` at P5-6 (reconcile row 17) | Not redeployed in Phase 5 (D-26); owner option in Appendix P | PLAN.md:392 untouched list |
| CD5-9 | Run keys `<translation_id>:<language>` (jobs §4.4), `xometry:<ISO>` (xc §2.6) | Every key starts with its agent key and `:` (§5.5) | One rule for the parity queries |
| CD5-10 | Telegram "card" for job failures (jobs §4.3, §4.4; xc §2.7 via `sendCard`) | Plain text through `P5Ports.telegramText` (D-28) | Live texts are plain; Phase 4 cards carry approval buttons |
| CD5-11 | Unit names and commands of jobs §11 and xc §2.9, §3.9 | Units and commands of §7 | Disjoint ownership across seven builders |
| CD5-12 | PGlite test inside `workers/ops/test/sql` with an ops devDependency (jobs §11) | Package `supabase/tests/phase5/` with the Phase 4 pins (`@electric-sql/pglite` 0.5.8, `pglite-pg16` = `npm:@electric-sql/pglite@0.2.17`) | Keeps SQL tooling out of the Worker bundle (P4 §4.19) |
| CD5-13 | Owner step numbers O5-n (jobs §13) and O-n (xc §5) | One list `OW5-n` (§10) | — |
| CD5-14 | `generate-en`: "3 attempts, constant 5 min" (jobs §4.3) | Step config `{retries: {limit: 2, delay: '5 minutes', backoff: 'constant'}, timeout: '10 minutes'}` = 3 attempts | `limit` counts retries |
| CD5-15 | Sender spacing 30 s (jobs §7.4) | Settings value or 30 s (D-17) | Owner's own dashboard value |

### 6.2 Content pipeline (C5; P5-2)

Ported from: jobs §4.1 L1-L8, §4.3, §4.4, §5; live `generate-daily-article` v36, `translate-article` v81, `fix-article-links` v15, `generate-sitemap` v19. C5 ports from the repo copies **after** O5's Wave 0 re-sync (generate-daily-article, translate-article; fix-article-links is already equal to live, rec row 5) and from a fresh read-only pull of `generate-sitemap` v19 for the oracle (the repo copy is a different, never-deployed variant, rec row 7).

`ContentDailyWorkflow` (instance `content-daily-<YYYY-MM-DD>`). Step names are constants.

| # | Step | Runs when `value.steps` has | `assist` / `auto` | `shadow` | Flag re-read before |
|---|---|---|---|---|---|
| 0 | `open-run` | always | `openRun` `content_daily`, key `content_daily:<date>`, `workflow_name` `content-daily`, instance id; `created: false` with a final status → return | same | — |
| 1 | `flag` | always | `readFlag(env, 'agent.content_daily')`; disabled → close `skipped` | same | yes |
| 2 | `enqueue` | `generate` | RPC `enqueue_next_article` → `queue_id` or null; null → `no_titles: true`, one alert "article titles exhausted" per day; generation is skipped, translations and backfill still run | skipped (it writes a queue row) | yes |
| 3 | `claim` | `generate` | RPC `get_next_queue_job` → job or none | read the oldest unprocessed `article_titles` row only (no claim) | — |
| 4 | `generate-en` | `generate` | jobs §4.3 step 4: frozen prompt `content_daily.generate_en@v1` (`src/content/prompts/generate_en.v1.md`, verbatim copy of the live template, D-31), `value.model`, `max_tokens` 16384, live parser with key-anchored recovery, 2,000-word guard, `cleanHtmlContent`, H1 strip; returns compact JSON. After the last failed attempt (caught): RPC `mark_queue_job_failed(queue_id, msg)`, alert, continue at step 7 | only if `value.shadow_generate`: same call, result to R2 `phase5-shadow/content-daily/<date>/en.json` | — (a claimed job always runs to the end so no queue row stays `processing`) |
| 5 | `publish-en` | `generate` | insert `articles` (columns of jobs L3; `translation_id` generated in the step); 23505 on (`slug`, `language`) → read the existing row; `article_generation_logs`; `article_titles.processed = true, processed_at`; RPC `mark_queue_job_completed(queue_id, article_id)` | skipped | — |
| 6 | `seo-purge-en` | `generate` | KV `SEO_CACHE` delete `seo:v1:list:en` (best effort, D-11) | skipped | — |
| 7 | `fan-out` | `translate` | `TRANSLATIONS.sendBatch`: 13 `daily` messages for today's group + `backfill` messages (oldest English articles first, ≤ `backfill_per_language_per_day` per language, D-10) | nothing sent (the Google key's quota is shared with the live chain, D-7) | yes |
| 8 | `wait-translations` | `translate`, and step 7 sent at least one `daily` message (an English article was published today) | `waitForEvent('translations-done', {timeout: '6 hours'})` in `try/catch`; timeout → continue. On a `no_titles` day or after a failed generation the step is skipped, so fix-links and the sitemap run at about 07:05, not after a 6 h wait for a group that does not exist | skipped | — |
| 9 | `fix-links-<lang>` × 13 | `fix_links` | jobs §4.3 step 9 (pages of 200 by `id`, PATCH only rows whose blog links changed) | scan and count, no PATCH | yes (before the first language) |
| 10 | `sitemap` | `sitemap` | `SITEMAP.create({id: 'sitemap-<date>', params: {date, parent_run_id}})`; `isAlreadyExists` = success | created as well; the sitemap Workflow reads the same flag and runs in shadow | yes |
| 11 | `seo-purge` | `translate` | KV delete `seo:v1:list:<lang>` for each language that got a row today and `seo:v1:translations:<translation_id>` for today's and back-filled groups | skipped | — |
| 12 | `close-run` | always | output per §5.5, `lag_days` per language = newest English `created_at` date − newest `created_at` date of that language (parity Q2 definition) | same, plus `shadow: true` | — |

`translations` consumer (`queues/translations.ts`, `translationsConsumer`): jobs §4.4 with these rules. (1) `openRun` `content_daily.translate`, key `content_daily.translate:<translation_id>:<lang>:<for_date>` (D-30), `parent_run_id`; `created: false` and a final status → ack; `created: false`, `running`, `msg.attempts` = 1 and started < 30 min ago → ack (a concurrent duplicate, e.g. a daily and a backfill message for the same language on one day); `created: false` and `running` otherwise (this message's own retry, or a redelivery after a crash) → continue under the existing `run_id`. (2) Flag enabled, mode not `shadow`, `translate` in `value.steps`; else ack and close `skipped` with `reason: 'flag_off'` or `'shadow'` (G5-5). (3) Translation exists → ack, `skipped`. (4) Load the English master (`language = 'en'`); missing → ack, `failed`. (5) `content/translate.ts` = live `translateToLanguage()` with the frozen prompts `content_daily.translate@v1` and `content_daily.translate_table@v1` (`src/content/prompts/`, D-31); `content/gemini-chain.ts` = live model chain over `p5.textLlm.gemini` (gateway route `google-ai-studio`), 90 s per call, 404/429/5xx → next model, all failed → `Overloaded`. (6) Insert (23505 = success). (7) IndexNow for `[<SITE_ORIGIN>/en/<blog>/<en slug>, <SITE_ORIGIN>/<lang>/<blog>/<slug>]` with the per-language blog segment of the live functions (`blogg` for sv and nb, `blogi` for fi, else `blog`; parity Q4) when `INDEXNOW_KEY` is set (else output `indexnow: 'not_configured'`, the translation still succeeds); POST `(INDEXNOW_API_BASE ?? 'https://www.bing.com') + '/indexnow'` `{host, key, keyLocation: <SITE_ORIGIN>/indexnow_key.txt, urlList}`. (8) If `origin = daily` and all 13 languages exist: `CONTENT_DAILY.get('content-daily-<for_date>').sendEvent({type: 'translations-done', payload: {translation_id}})` (buffered if early; a second event is harmless). (9) Close with usage and cost. Errors per §5.3.

`SitemapWorkflow` (instance `sitemap-<date>`): jobs §5 steps 0-3 exactly (live v19 query order, constants and builders; 1,000-row pages; regression guard `urls < 252 + 0.95 × articles of the last succeeded run` → no upload, alert). `assist`/`auto`: re-read the flag, upload to Storage `sitemaps/sitemap-complete.xml` (upsert, `application/xml`, cache control 3600), shadow copy in R2 `microns-private` `sitemaps/sitemap-complete.xml` with `customMetadata {sha256, urls, generated_at}`, upsert `gsc_monitored_urls` in chunks of 500. `shadow`: XML only to R2 `phase5-shadow/sitemaps/<date>/sitemap-complete.xml`, no upload, no upsert. The 6.3 MB XML never leaves its step (F5-18).

Manual dashboard paths keep calling the edge functions (jobs §4.5, D-20).

### 6.3 Collectors (G5; P5-3)

Ported from: jobs §6; repo `supabase/functions/reddit-collector/index.ts` (equal to live v15), `supabase/functions/hn-collector/index.ts` after O5's Wave 0 re-sync (live v7), `api/tender-scan.js` (run unchanged).

| Handler | Behaviour (`assist`/`auto`) | `shadow` |
|---|---|---|
| `handleRedditTier` (`collectors/reddit.ts`) | jobs §6 reddit row: due subreddits of tiers ≤ N, first 40, PullPush fetch with the live `User-Agent`, live keyword scoring (`collectors/keywords.ts`, reddit variant), `leads` upsert `on_conflict=source_url` with `Prefer: resolution=ignore-duplicates,return=representation`, alert text byte-identical to live for `high` rows actually inserted (D-14), `last_scanned_at`, 500 ms pause; the live call to the absent RPC `increment_keyword_match_count` is dropped; close with the §5.5 counts | fetch, score, count; no write, no alert |
| `handleHnScan` (`collectors/hn.ts`) | jobs §6 HN row: live v7 terms and Show HN, `lastTimestamp` from the newest `hackernews` lead − 60 s (else now − 1 h), scoring variant `material_specific`, upsert `on_conflict=source,external_id`, alerts for `high` and `medium` rows actually inserted | as reddit |
| `handleTenderScheduled` (`collectors/tenders.ts`) | open child run `growth.tenders:<date>:<CC>` with `parent_run_id = msg.body.run_id` (`created: false` with a final status → ack; `running` → continue under it, which is this message's own retry); re-read the flag (off → close `skipped`, `reason: 'flag_off'`); run `api/tender-scan.js` in-process with body `{country_code}` through `runNodeHandler` (840 s deadline, as F5-21); 2xx → close `succeeded` with the handler's JSON counts; 4xx → close `failed`, ack; 5xx or throw → `retry({delaySeconds: 300})`, final delivery → close `failed`, DLQ | child closed `skipped` with `reason: 'shadow'` (the handler writes, so it never runs in shadow); the canary of D-13 is the functional test |

Live alert texts contain emoji; in source they are written as `\u{…}` escapes so the files stay free of literal emoji (G5-1), and a test compares the produced bytes with the live template. Kept manual paths: LeadMonitorPage single-subreddit scan and `leads-api` `/collect` (D-20).

### 6.4 Xometry scanner (X5; P5-5)

Ported from: xc §2.1-§2.9 (scope, signatures, Python behaviours, partner client, persistence, tick, alerts, tests) with CD5-3. `handleXometryScan(msg, env, ctx)` (`xometry/queue.ts`) calls `runXometryTick(env, ports, p5, {slot, run_id})` (`xometry/tick.ts`) and always acks after `closeRun`. Tick steps: flag re-read → overlap guard (another `running` `growth.xometry` row started < 15 min ago → close `skipped`, `reason: 'overlap'`) → token gate and daily reminder at the 06:00 slot (fingerprint = first 12 hex of SHA-256 of `XOMETRY_TOKEN ‖ '\n' ‖ XOMETRY_COOKIE`) → expiry hint → scan (`shadow`: `DryRunOfferStore`) → compute pass → close with xc §2.6 step 7 output → alerts (xc §2.7 texts through `telegramText`, `xometry/alerts.ts`) → Analytics Engine point `xometry_tick`. Budget: stop writing at 9,000 counted subrequests (`partial: true`) and at 10 min wall time. Persistence: three PostgREST requests per offer over the Phase 4 `Db` (X-1, xc §2.5). Golden vectors: `scripts/xometry-golden/gen_golden.py` (copied from the scratch generator) produces `test/fixtures/xometry/golden.json` (388 assertion units) and records the SHA-256 of each `xometry-bot/xometry_bot/*.py` module it imported; a T1 test fails when the current files' hashes differ from the recorded ones, so a Python change forces a regeneration without Python in the Worker CI. `.github/workflows/xometry-scan.yml`: job `scan` gains `if: github.event_name != 'schedule' || vars.XOMETRY_SCAN_SCHEDULE != 'off'`.

### 6.5 Marketing (M5; P5-4)

Ported from: jobs §7.1-§7.5; repo `supabase/functions/send-campaign/index.ts` (set-up :186-286, personalisation and tracking :19-78, :293-326, send and finalise :330-435), `process-followups`, `process-warmup`.

| Part | Rule |
|---|---|
| Route `handleSendCampaign` | order of §5.9; recipients: CSV mode (`marketing_campaign_recipients` with `sequence_number = 1`, `status = 'pending'`, subscriber active; `custom_subject`/`custom_body`) else tag mode (active subscribers ∩ `target_tags`, A/B subject 50 % when `ab_test_config.enabled`, random source injectable for tests); active accounts of `sender_account_ids` (`is_active`), round-robin `preferred_account_id`; `expected` written to the run output before the first `sendBatch` |
| Consumer `outboundMailConsumer` | per message, in order: pause or stop → hold (defer 3,600 s without counting a deferral); `reserve` on the preferred account (`'default'` when null); `exhausted` → the campaign's other accounts in round-robin order; all exhausted → defer to the next 00:00 UTC + jitter ≤ 600 s; `already_sent` → finalise the database rows only (idempotent); `not_before` ≤ 60 s → wait, else defer; personalise (`parseSpintax`, `replaceVariables`); insert `marketing_events` `sent` → `event_id`; tracking pixel, click tracking and unsubscribe link with the repo URL format `/api/marketing?action=track&type=…&eid=…&cid=…` (so the Phase 2 `track` action keeps working); send: `google_workspace` → `gmail.accessToken(account)` (P4) then `p5.gmailSend.send(token, rawMime)` (RFC 5322, `From: <display_name> <email>`, RFC 2047 subject when non-ASCII, `text/html; charset=UTF-8`, base64url); `resend` account or default → `marketing/send-resend.ts` (`https://api.resend.com/emails`, `RESEND_API_BASE` in T2, account key from `provider_config.api_key` else `RESEND_API_KEY`, `Idempotency-Key: <idem>`); finalise (event metadata `{resend_id or gmail_id, from}`, `resend_email_id`, recipient `sent`/`sent_at`, `commit`, mirror `emails_sent_today`) or fail (event `bounced` `{error}`, recipient `failed`, `release`) |
| Campaign close | after each final outcome: count `sent` + `bounced` events of the campaign (`Prefer: count=exact`); ≥ `expected` of the campaign's newest `marketing.send` run → `PATCH marketing_campaigns?id=eq.<id>&status=neq.sent` `{status: 'sent', sent_count, updated_at}` with `return=representation`; only the call that gets a row closes that newest run `succeeded` `{expected, sent, bounced}` if it is still `running` (a message's own `run_id` may name an earlier, already `failed` run of a re-queued campaign) |
| Follow-ups, warm-up | `marketing/followups.ts` `enqueueDueFollowups(env, slot)` (process-followups :61-215, kind `followup`, same limiter) and `marketing/warmup.ts` `runWarmup(env, date)` (process-warmup :18-90); both reachable only through the schedule table and only when their var is `"true"` |
| Limiter | `do/sender-limiter.ts` per §5.8; SQLite storage; alarm prunes keys older than 30 days |

Known limit: a Gmail send that succeeds just before an isolate crash, before `commit`, can be sent again on redelivery (Gmail has no idempotency key; Resend sends do). Volumes are tiny (F5-10); recorded as R5-11.

### 6.6 Ops digest (O5; P5-7)

Ported from: jobs §8. Narrative through the Phase 4 `llm` port, route `extract` (P4 F4-6), step profile `LLM_EXTRACT`, prompt `ops_digest.narrative@v1` (registered in `agents/prompts/registry.ts` by K5, §3.2; files in the Phase 4 convention: front matter, `.schema.json`, `LOCK.json`) with input = the metrics JSON only and structured output `{lines: string[5]}`; mail through the Phase 4 `mailer` from `DIGEST_FROM` to `value.recipient` with `Idempotency-Key: digest/<YYYY>-W<ww>`; one Telegram line through `telegramText`; `agent_retention_purge()` on the first Monday of a month (P4 §4.13); `ads_upload: false` → skipped (Q21). Every count is a PostgREST read (`Prefer: count=exact`) or a sum over ≤ 1,000 rows; no SQL function is added. Queue health = consumer rows with `status = 'failed'` (D-18).

### 6.7 CAD Container (D5; P5-6)

Ported from: xc §3.1-§3.11 and Appendix A (prototype diff `../phase5/cadref/main_py_p5-6.diff`, comparator `cadref/cad_parity.py`, freeze `cadref/container-freeze.txt`). Deltas: the container is reached through `P5Ports.container` (registry and router); the site half of the compat path (resolve, gate, token check) belongs to M5, the ops route `routes/cad-compat.ts` to D5, and the contract between them is §5.9 (`endpoint 'cad-compat'`, `functionUrl '/api/cad/flat-pattern'`, principal `MACHINE:cad-compat`). Compatibility rule: the VPS keeps its current image until Phase 6 and is never rebuilt from the new Dockerfile while `UNFOLD_SERVICE_URL` points to it (reason in Appendix P.3; xc §3.7). The Container class, input proxy and slot helpers are D5 files in `workers/ops/src/cad-container/` (C-1); `workers/cad/` holds `README.md` and `parity/` only.

### 6.8 Switch-over SQL, parity and reconciliation (O5; P5-1, P5-8, P5-9)

| Item | Rule |
|---|---|
| `supabase/migrations/<yyyymmdd>_deactivate_ported_crons.sql` | exact text of jobs §9.2 (addressing by job name, target-path check, no-op without `microns.p5_step` and `microns.p5_action`) |
| `supabase/migrations/<yyyymmdd>_unschedule_ported_crons.sql` | exact text of jobs §9.3 (no-op without `microns.p5_gate = 'signed'`; only inactive ported jobs) |
| `supabase/tests/phase5/cron-switch.test.mjs` | the scratch test `sqltest/test.mjs` moved into the repo with literals built at runtime (G5-7) and run on both PGlite versions; cases: no settings → no change; `S1`; `'S2, S5'`; reactivate; re-run after `RESET` is a no-op; a job whose command no longer contains its target is skipped; unschedule without the gate → no change; with the gate → only inactive ported jobs removed, other jobs untouched |
| `scripts/phase5/parity.sql` | jobs §10 Q1-Q12 with Q8 replaced by the per-agent version below, plus Q13 below; placeholders `<S_SWITCH_UTC>` (S1-S5) and `<S8_SWITCH_UTC>`. Q6/Q5 for tenders compare against the baseline measured at S3 (§10.2) |
| `scripts/phase5/flag-values.sql` | one template `UPDATE feature_flags SET value = value \|\| '<json>'::jsonb WHERE key = '<flag>'` per switch-over step (no recipient address: the digest step uses a `<RECIPIENT>` placeholder) |
| Re-sync (Wave 0) | reconcile A1 (`generate-daily-article`, `translate-article`, `hn-collector`; `telegram-leads-bot` is P4 W) and A2 (`gsc-*`) from fresh read-only `get_edge_function` pulls; the literal scan of §7.2 (with its positive self-test) must be clean before commit |
| Later commit (after OW5-14) | once the owner has deleted the functions after the log check: remove the repo folders of the four deleted senders that exist in the repo, `supabase/functions/{send-confirmation-email,send-notification-email,send-rfq-confirmation-email,send-internal-rfq-notification-email}/` (reconcile rows #22-#25, legend "remove the repo folder if any", PLAN.md:391), and their `config.toml` sections (supabase/config.toml:2-12) together with the three phantom sections (supabase/config.toml:14-21, reconcile A4). No other folder is removed in Phase 5 (R1, R5 go in P6-6) |

```sql
-- Q8 (replaces jobs §10 Q8) agent_runs completeness per agent and day; 'stuck' uses a limit per agent
WITH lim(agent, max_running) AS (VALUES
  ('growth.reddit', interval '1 hour'), ('growth.hn', interval '1 hour'), ('growth.xometry', interval '1 hour'),
  ('growth.tenders', interval '2 hours'),          -- a child may run 4 deliveries of <= 840 s plus 3 x 300 s retry delays
  ('content_daily', interval '8 hours'),           -- generation <= 40 min + translations wait <= 6 h + fix-links + sitemap
  ('content_daily.sitemap', interval '1 hour'), ('content_daily.translate', interval '1 hour'),
  ('marketing.send', interval '48 hours'),         -- stays open across cap deferrals to the next UTC day
  ('ops_digest', interval '1 hour'))
SELECT r.agent, r.started_at::date AS day, count(*) AS runs,
       count(*) FILTER (WHERE r.status = 'succeeded') AS ok,
       count(*) FILTER (WHERE r.status = 'failed') AS failed,
       count(*) FILTER (WHERE r.status = 'skipped') AS skipped,
       count(*) FILTER (WHERE r.status = 'running' AND r.started_at < now() - l.max_running) AS stuck
FROM agent_runs r JOIN lim l ON l.agent = r.agent
WHERE r.started_at >= '<S_SWITCH_UTC>'::timestamptz
GROUP BY 1, 2 ORDER BY 2, 1;   -- pass: stuck = 0 on every row

-- Q13 Xometry: one agent_runs row with an outcome for every scheduled slot since the switch (S8)
WITH params AS (SELECT '<S8_SWITCH_UTC>'::timestamptz AS s),
slots AS (
  SELECT g AS slot FROM generate_series(date_trunc('hour', (SELECT s FROM params)), now(), interval '1 hour') g
  WHERE g >= (SELECT s FROM params)                 -- no slot before the switch
    AND g <= now() - interval '5 minutes'           -- the current slot gets 5 min to open its run
    AND extract(hour FROM g AT TIME ZONE 'UTC') IN (6, 8, 10, 12, 14, 16, 18))
SELECT s.slot,
       r.status,
       r.output->>'auth' AS auth,
       (r.output->>'scanned')::int AS scanned
FROM slots s
LEFT JOIN agent_runs r
  ON r.agent = 'growth.xometry'
 AND r.idempotency_key = 'growth.xometry:' || to_char(s.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')
ORDER BY s.slot;   -- pass: no NULL status; with a valid token at least one succeeded slot per day
```

Both queries were run read-only on live (2026-10-04 09:00 UTC) with a CTE stand-in for `agent_runs` (`to_regclass('public.agent_runs')` is NULL before P4-1): Q13 with switch `2026-10-03T08:30Z` lists 10:00-18:00 and the next day's 06:00 and 08:00, not 08:00 of the switch day; Q8 counts a `content_daily` row running 9 h and a `growth.hn` row running 2 h as stuck, and neither a `content_daily` row running 7 h nor a `marketing.send` row running 30 h.

---

## 7. Build units (disjoint file ownership; every check runs in this container without a Cloudflare account)

### 7.1 Units

| Unit | PLAN tasks | Owns (paths of §4) | Reads first | Stub seams used in tests |
|---|---|---|---|---|
| **K5** kernel | cross-cutting for P5-2…P5-8 | ops `wrangler.jsonc`, `package.json`, `package-lock.json`, `vitest.t2.jobs.config.ts`, `test/config.test.ts` (extension), `README.md`, `src/index.ts`, `src/env.ts`, `src/agents/runs.ts` (extension: `AgentKey`), `src/agents/prompts/registry.ts` (extension: one entry), `src/cron/{schedule,run-schedule}.ts`, `src/ports/p5.ts`, `src/ports/p5-stub/**`, `src/queues/{messages,scrapes-p5}.ts`, `src/agents/prices.ts` (extension), `scripts/check-bundle.mjs`, `test/p5/kernel/**`, `test/t2-jobs/p5-kernel.jobs.ts`; site `test/integration/{harness.mjs,global-setup.mjs,stub-server.mjs}` and `stubs/*` of §4 | §3, §5 (all) | fake clock, `FakeStep`, recorders, every T2 stub |
| **C5** content | P5-2 | `src/workflows/{content-daily,sitemap}.ts`, `src/queues/translations.ts`, `src/content/**` (including `src/content/prompts/**`, D-31), `test/p5/content/**`, `test/oracles/**`, `test/t2-jobs/p5-content.jobs.ts`, `scripts/phase5/compare-sitemap.mjs` | §6.2; jobs §4-§5 | `FakeTextLlm`, storage recorder, `MemoryDb` + memory RPCs (`enqueue_next_article`, `get_next_queue_job`, `mark_queue_job_*`), stub Google route with scripted 404/429/5xx per model, KV fake |
| **G5** collectors | P5-3 | `src/collectors/**`, `test/p5/collectors/**`, `test/fixtures/collectors/**`, `test/t2-jobs/p5-collectors.jobs.ts` | §6.3; jobs §6 | scripted `sources.fetch` (PullPush, Algolia), `telegramText` recorder, `api/tender-scan.js` with stub PostgREST and stub connector URLs |
| **X5** Xometry | P5-5 | `src/xometry/**`, `scripts/xometry-golden/gen_golden.py`, `test/p5/xometry/**`, `test/fixtures/xometry/golden.json`, `test/t2-jobs/p5-xometry.jobs.ts`, `.github/workflows/xometry-scan.yml` (extension) | §6.4; xc §2 | injected `fetcher` with fixture pages and 401/403, `MemoryOfferStore`, mini-PostgREST `xometry_offers` |
| **D5** CAD | P5-6 | `workers/cad/{README.md,parity/**}`; ops `src/cad-container/**`, `src/cad/{types,registry}.ts`, `src/cad/backends/{http-unfold,container}.ts`, `src/do/cad-router.ts`, `src/queues/cad-jobs.ts` (extensions), `src/routes/cad-compat.ts`, `src/app.ts` (one line), `test/p5/cad/**`, `test/t2-jobs/p5-cad.jobs.ts`; `sheet-metal-service/{main.py,config.py,Dockerfile,requirements.lock.txt,tests/test_p5_service.py}`; `.github/workflows/cad-image.yml` | §6.7, §5.8; xc §3, Appendix A | `p5.container` scripted; the real `@cloudflare/containers` for the wiring tests of §5.8; stub route `stubs/cad-container.mjs`; optional local uvicorn of the patched service; fixture file server on `127.0.0.1` |
| **M5** marketing + edges | P5-4 (+ the site half of P5-6) | `src/marketing/**`, `src/routes/marketing-send.ts`, `src/routes/marketing.ts` (one branch), `src/queues/outbound-mail.ts`, `src/do/sender-limiter.ts`, `test/p5/marketing/**`, `test/t2-jobs/p5-marketing.jobs.ts`; shared `src/http/rpc.ts` and `test/http/rpc.test.ts` (extensions); site `src/api/{resolve,router,forward}.ts`, `src/auth/{gate,policy}.ts` (extensions), `src/auth/cad-compat.ts`, `test/policy.test.ts` (extension: ID count), `test/p5-{marketing-send,cad-compat}.test.ts`; `src/utils/campaignSend.ts`, the two campaign components, `tests/frontend-api/campaignSend.test.ts` | §6.5, §5.9, §9; jobs §7 | `gmailSend` recorder, Resend stub, fake DO storage (`test/helpers/fake-do.ts`), MSW-style fetch mock in the frontend test |
| **O5** ops, SQL, reconcile | P5-1, P5-7, P5-8 (SQL), P5-9 (parity) | `src/workflows/ops-digest.ts`, `src/digest/**`, `src/agents/prompts/ops_digest/**`, `test/p5/digest/**`, `test/t2-jobs/p5-digest.jobs.ts`; `supabase/migrations/*_ported_crons.sql`, `supabase/tests/phase5/**`, `supabase/functions/{generate-daily-article,translate-article,hn-collector}/index.ts`, `supabase/functions/gsc-*/index.ts`; later commit (after OW5-14): removal of `supabase/functions/{send-confirmation-email,send-notification-email,send-rfq-confirmation-email,send-internal-rfq-notification-email}/` and the matching `supabase/config.toml` sections; `scripts/phase5/{parity.sql,flag-values.sql,README.md}` | §6.6, §6.8; jobs §8-§10; reconcile §2-§5 | `FakeLlm` (P4) for the narrative, mailer recorder, seeded `MemoryDb` |

Every path above has exactly one owner; the extension rows of §3.2 are the only Phase 1, 2 and 4 files any unit touches. Supabase access during the build: read-only MCP only for O5 (fresh `get_edge_function` pulls of the re-synced and added functions; `parity.sql` SELECTs with test dates) and C5 (`get_edge_function` `generate-sitemap`, expected version 19, for the oracle). No unit calls `www.micronshub.eu`, the apex or `*.vercel.app` (G5-1).

### 7.2 Acceptance checks (exact commands; run from the repository root)

Literal scan (every unit, over its own files; also O5 before committing re-synced functions). The patterns are separate `-e` arguments (a `\|` inside a markdown table is a literal pipe to ripgrep, so the earlier single-pattern form never matched; probe 2026-10-04: exit 1 on a line containing the JWT prefix). The self-test must report a match before the real scan counts:

```bash
# the patterns are split with adjacent quotes so this text never matches itself if it is copied into a scanned file
P5_SCAN=(-e 'ey''J' -e 'wh''sec_[A-Za-z0-9]' -e '\bre_[A-Za-z0-9_]{24,}' -e 'AI''za[0-9A-Za-z_-]{20,}' -e 'sk''-ant-' \
         -e '[0-9]{8,10}:AA[0-9A-Za-z_-]{30,}' -e '-----BEG''IN')
probe="$(mktemp)"; printf '%s%s\n' 'ey' 'Jprobe' > "$probe"
rg -q "${P5_SCAN[@]}" "$probe" && echo "self-test ok" || { echo "self-test FAILED"; exit 1; }; rm -f "$probe"
rg -n "${P5_SCAN[@]}" <own files>; test $? -eq 1 && echo "scan clean"
```

| Unit | Commands | Must show |
|---|---|---|
| all | `npm --prefix workers/shared ci && npm --prefix workers/shared run typecheck`; `npm --prefix workers/ops ci && npm --prefix workers/ops run typecheck`; `npm --prefix workers/site ci && npm --prefix workers/site run typecheck` | green |
| all | the literal scan above | `self-test ok`, then `scan clean` |
| K5 | `npm --prefix workers/ops test -- test/p5/kernel test/config.test.ts`; `npm --prefix workers/ops run build:dry`; `npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-kernel.jobs.ts`; `npm --prefix workers/ops run test:integration` | Schedule over a simulated week (10,080 minute ticks): reddit-t1 672, reddit-t2 336, reddit-t3 168, hn 336, tenders 7, xometry 49, content-daily 7 (steps ≠ `["sitemap"]`) or sitemap 7 (steps = `["sitemap"]`), never both, ops-digest 1 (Monday 06:30), follow-ups 168 and warm-up 7 only with their vars `"true"`; a lost 07:00 tick fires at 07:01 with `catchUp: true`, a tick 61 min late does not; flag off → no `openRun`; `send()` throwing → run `failed` `enqueue_failed`; `index.ts` routes each P5 kind to `scrapesP5Consumer` and `tender-scan`/`funded-scan` to the Phase 2 consumer (spies); `AgentKey` accepts the 11 Phase 5 keys (type test); `makeP5Ports` throws when an override var is set with `AI` bound; `check-bundle` fails on a production var `PULLPUSH_API_BASE` and on a metafile with a second `@cloudflare/containers` path, and passes on the real config; `config.test.ts` green with the Phase 5 config; T2: a Local Explorer `scheduled` call with a fixed clock opens one run per due job against the stub PostgREST; the Phase 2 `test:integration` collects no `test/t2/` or `test/t2-jobs/` file |
| C5 | `npm --prefix workers/ops test -- test/p5/content`; `node scripts/phase5/compare-sitemap.mjs --self-test`; `npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-content.jobs.ts` | jobs §11 C5 row: byte-equal XML against the live v19 oracle for a 300-article fixture (orphans, non-ASCII `fi` service slugs, `sv`/`nb`/`fi` blog segments); equal link rewrites against the fix-links oracle; prompt files in `src/content/prompts/` byte-equal to the live templates (C5's own `LOCK.json` test); generate-en parser on recorded responses (valid, stray quote, truncated, < 2,000 words); Gemini chain 429 → next, 404 → next, all 5xx → `Overloaded` → `retry({delaySeconds: 120 × attempts})`; consumer idempotency (exists → ack; 23505 → success; concurrent duplicate at attempt 1 → ack; own retry at attempt 2 continues under the same run; double `translations-done`); a `no_titles` day skips `wait-translations`; flag off with queued work → `skipped` `flag_off`; missing `INDEXNOW_KEY` → `indexnow: 'not_configured'`; shadow writes nothing but R2 `phase5-shadow/…`; T2: one full day incl. backfill and the 6 h timeout path |
| G5 | `npm --prefix workers/ops test -- test/p5/collectors`; `npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-collectors.jobs.ts` | scoring tables equal the live rules (reddit and HN variants); due filter and 40 cap; no alert for an existing row (D-14); alert bytes equal the live templates; tender child run per connector with the handler's counts; 5xx → retry 300 s under the same child run; shadow writes nothing; T2 one tick per job with stub PullPush, Algolia and Telegram |
| X5 | `npm --prefix workers/ops test -- test/p5/xometry`; `python3 -m venv /tmp/xb && /tmp/xb/bin/pip install -q "httpx>=0.27" "pydantic>=2.7" "psycopg[binary]>=3.2" fastapi uvicorn pytest && (cd xometry-bot && /tmp/xb/bin/python -m pytest -q)`; `(cd xometry-bot && /tmp/xb/bin/python ../workers/ops/scripts/xometry-golden/gen_golden.py) \| diff -q - workers/ops/test/fixtures/xometry/golden.json`; `npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-xometry.jobs.ts` | 72 ported tests + 388 golden units + `config`, `store`, `tick` tests green (xc §2.9); the unchanged Python suite still passes (107 on 2026-10-03, xb-pytest.log); golden file reproducible; T2: 401 page → alert + `auth: 'rejected'`, next slot with the same fingerprint → `skipped` without a fetch |
| D5 | `npm --prefix workers/ops test -- test/p5/cad`; `npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-cad.jobs.ts`; `python3 -m venv /tmp/cad && /tmp/cad/bin/pip install -q -r sheet-metal-service/requirements.lock.txt pytest httpx && (cd sheet-metal-service && /tmp/cad/bin/python -m pytest -q tests/test_p5_service.py tests/test_fixtures.py)`; `python3 workers/cad/parity/cad_parity.py self-test` | input-proxy allow-list and URL codec; class config snapshot (`defaultPort` 8000, `sleepAfter` `10m`, `enableInternet` false, `pingEndpoint` `localhost/health`, `envVars` names); the three wiring tests of §5.8 against the real package (one module instance, setter registration, `ContainerProxy` routes `cad-input.internal` to the handler and answers 520 for other hosts); slot accounting with priorities (batch ≤ 2), `recycle`, no container probe; outcome mapping table of §5.8; compat route validation, URL rewrite, 503 `CAD busy` after 20 s, 110 s abort → 502; service key matrix, 504 at 0.05 s, disconnect leaves no child, 5 references equal to the golden after masking; comparator reports `DIFFERS` for a 0.01 mm change. Optional when a Docker daemon is available: the cad-image.yml steps by hand (xc §3.9) |
| M5 | `npm --prefix workers/site test -- test/p5- test/policy.test.ts test/env-api.test.ts test/resolve.test.ts`; `npm --prefix workers/shared run typecheck` (the `rpc.test.ts` unions); `npm --prefix workers/ops test -- test/p5/marketing`; `workers/site/node_modules/.bin/vitest run -c tests/frontend-api/vitest.config.mjs tests/frontend-api/campaignSend.test.ts`; `npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-marketing.jobs.ts`; `npx tsc --noEmit -p tsconfig.app.json 2>&1 \| grep -E "src/utils/campaignSend.ts\|marketing/Campaign(Wizard\|sTable)" ; test $? -eq 1`; `npx vite build` | site: `send-campaign` resolves to ops only for POST (405 otherwise), MK-8 needs STAFF, CD-1 accepts only the configured token (constant time; missing secret → 500), token never in `functionUrl` or logs, `/api/cad/*` never forwarded, `ENDPOINT_TARGETS['cad-compat']` = `ops`, policy ID count 43 with every earlier expectation unchanged, `env-api.test.ts` and `resolve.test.ts` unchanged and green (site `env.ts` untouched); ops: route order of §5.9 including stop (423), pause with and without a failed run (503 / 409), a failed enqueue closing the run `failed` and a second click re-queuing only recipients without a final event under `:r2`, recipient pages of 1,000; recipient selection (CSV vs tags, A/B with a seeded source); tracking URLs equal to the repo function's output for the same ids; limiter cap, spacing, UTC roll-over, `already_sent`, stale `reserved`; cap and spacing defer copies carry `deferrals + 1`, pause/stop holds do not, no delay above 86,400 s (a cap exhausted at 00:05 UTC), and none calls `retry()`; campaign closes once; frontend: §9 matrix; zero type errors in the touched frontend files (the repo has a baseline of errors elsewhere, P4 §4.13); `vite build` green |
| O5 | `npm --prefix supabase/tests/phase5 ci && npm --prefix supabase/tests/phase5 test`; `npm --prefix workers/ops test -- test/p5/digest`; `npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-digest.jobs.ts` | SQL cases of §6.8 on both PGlite versions; digest metrics from a seeded stub DB equal hand-computed values; narrative schema and registry entry; idempotency key; purge only on the first Monday; re-synced files equal the fresh pulls apart from line endings, with the literal scan (self-test first) clean |
| Wave 3 (all, after merge of every unit) | `npm --prefix workers/site test`; `npm --prefix workers/shared test`; `npm --prefix workers/ops test`; `npm --prefix workers/ops run test:integration`; `npm --prefix workers/ops run test:integration:agents`; `npm --prefix workers/ops run test:integration:jobs`; `npm --prefix supabase/tests/agent_layer test`; `git diff --name-only --diff-filter=MD <phase4-close> -- workers/shared/test workers/site/test workers/ops/test workers/ops/vitest.t2.config.ts workers/ops/vitest.t2.agents.config.ts workers/site/vitest.config.ts workers/site/vitest.t2.config.ts` | Phase 1, 2 and 4 suites green; the diff lists exactly `workers/ops/test/config.test.ts`, `workers/shared/test/http/rpc.test.ts`, `workers/site/test/integration/{global-setup.mjs,harness.mjs,stub-server.mjs}`, `workers/site/test/integration/stubs/{gmail,postgrest,telegram}.mjs`, `workers/site/test/policy.test.ts`, none deleted (the Phase 5 counterpart of PHASE4_SPEC G4-10); bundle sizes printed by `build:dry` |

`test:integration:jobs` = `T2_PROFILE=jobs vitest run -c vitest.t2.jobs.config.ts` (the way Phase 4 selects `agents`, P4 §5.2 unit K scripts). Profile `jobs` generates configs with every Phase 5 binding, the T2-only vars of §5.4 pointing at the stub server, `AI`, `BROWSER`, `QUOTES_INDEX`, `EVENTS` and the `containers` stanza removed (Phase 4 binding stripping, P4 CR-25), and `CAD_CONTAINER_BASE_URL` set. Unlike profiles `api` and `agents` (which drop the `scrapes` consumer, PHASE2_SPEC.md:655, P4 §6.3 generated ops config), profile `jobs` keeps the consumers `scrapes`, `translations`, `outbound-mail` and `cad-jobs` (local only): every source they reach points at the stub (`*_API_BASE` vars, seeded `tender_connectors` URLs on the stub origin), so no real scan runs. If `wrangler deploy --dry-run` 4.145.0 refuses the `containers` stanza without Docker or registry access, `build:dry` runs on a generated config without it and prints that fact (R5-13).

### 7.3 Waves

| Wave | Who | Content | Gate to the next wave |
|---|---|---|---|
| 0 | K5 | Every exported type and signature of §5 as stub files (`throw new Error('not implemented: <unit>')`): `AgentKey` keys in `agents/runs.ts`, the registry entry, ops `env.ts`, `index.ts` (all class exports and dispatch wired to stub modules owned by the units, `ContainerProxy` re-exported from `@cloudflare/containers`), `wrangler.jsonc`, `package.json` + lockfile (`@cloudflare/containers` 0.3.7), `vitest.t2.jobs.config.ts`, the Phase 5 additions to `config.test.ts`, `messages.ts`, `scrapes-p5.ts`, `cron/*` types, `ports/p5.ts` interfaces, `src/cad-container/*` signatures; ownership of each stub file then passes to its unit | the three typecheck commands of §7.2 green; `npm --prefix workers/ops test -- test/config.test.ts` green |
| 0 | O5 | Re-sync A1 and add A2 (fresh read-only pulls, literal scan) so C5 and G5 port from the repo | scan clean; files committed by O5 only |
| 1 | all | T1 implementation and tests | each unit's T1 command green |
| 2 | all | T2 (`test:integration:jobs` per unit); D5 service tests and comparator; X5 golden reproduction | green |
| 3 | all | Regression row of §7.2, scans, `vite build` | green |
| 4 | owner | §10 | PLAN.md:394-401 exit gate (§12) |

A cross-unit need is met through §5 only, never by editing another unit's file; a contract change after Wave 0 goes through K5 and is announced to every unit (P4 §3.4 rule).

---

## 8. What must not change

| Area | Files / behaviour that stay byte-identical in Phase 5 | Why |
|---|---|---|
| SEO path | `workers/site/src/{index.ts,sitemap.ts,redirects.ts,static.ts,preview.ts}`, `src/seo/**`, `src/compat/vercel-shim.ts`, `vitest.config.ts`, `tsconfig.json`, every Phase 1 test file, `scripts/seo-parity/**`, `scripts/seo-parity.mjs`, `scripts/verify-ssr.sh`, `tests/middleware/**`, `tests/e2e/{seo,homepage,navigation}.spec.ts`, `tests/e2e/fixtures/**`, `playwright.config.ts`. The served `/sitemap.xml`, `/sitemap-complete.xml` and `/sitemap-<lang>.xml` bytes come from the same Storage objects through the same code (D-1); Phase 5 only purges KV keys of the SEO cache | SEO parity gate of Phase 1 (P2 G-3 list) |
| Vercel and pre-migration code | `vercel.json`, `middleware.ts`, `middleware/*`, `api/*` (imported in-process, never edited; `api/tender-scan.js` runs unchanged), `lib/*`, `index.html`, `vite.config.ts` | P2 G-3; P4 F4-18 |
| Phase 2 code | Every `workers/shared`, `workers/site` and `workers/ops` file except the rows of §3.2 (which include two Phase 2 tests, `policy.test.ts` and `config.test.ts`, F5-24); in particular `workers/ops/src/queues/scrapes.ts`, the Phase 2 kinds `tender-scan` and `funded-scan`, the `scrapes` consumer config, every route other than `routes/marketing.ts` (one branch), `src/compat/**`, the shared auth and storage modules, and the Phase 2 answers for every existing `/api/*` action | Phase 2 parity |
| Phase 4 code | Every Phase 4 file except the rows of §3.2: `agents/*` other than `prices.ts`, `runs.ts` (the `AgentKey` union only) and `prompts/registry.ts` (one entry), `cron/{flags-sync,dispatcher,gmail-poller}.ts`, `workflows/{rfq-intake,quote,post-order,steps}.ts`, `do/{rfq-thread,material-stock}.ts`, `routes/agent*.ts`, `mcp/**`, `scrapers/**`, `ports/index.ts`, `db/**` | Phase 4 gate stays valid |
| Cron triggers | `"crons": ["* * * * *", "*/10 * * * *"]` exactly (D-3) | One trigger works under both readings of the limits pages |
| Supabase | No schema change, no SQL applied, no function deployed or deleted by a builder; unchanged repo folders: `create-partner-auth-user`, `update-partner-password`, `send-user-email`, `xometry-review`, `leads-api`, `post-to-social-media`, `telegram-tenders-bot`, `extract-flat-pattern`, `generate-manufacturing-pdf` (PLAN.md:392), `telegram-leads-bot` (P4 W only), and the "keep repo" folders `generate-sitemap`, `send-campaign`, `check-replies`, `admin-update-partner-password`, `process-followups`, `process-warmup`, `fix-broken-tables` (rec A3, R1-R5). The folders of the dead senders #22-#25 are never overwritten with live code (rec A3) and are removed only by O5's later commit after the owner deleted the functions (§6.8) | Owner deploys; overwriting would undo committed work (and, for #24/#25, put a key literal into the public repo) |
| Python | `xometry-bot/**` unchanged (the Action remains the rollback path until P5-9); `sheet-metal-service` endpoint bodies, `export/**`, `storage/**` unchanged (only `main.py` middleware and `config.py` env reading, xc Appendix A) | Rollback and byte parity |
| Docs | `docs/migration/**` unchanged by builders; the deviations of §11 go to the owner (PLAN.md:45) | Doc changes need the owner's OK |
| Live services | No call to `www.micronshub.eu`, the apex or `*.vercel.app`; no Supabase write; no Cloudflare resource created | G5-1, G5-4 |

## 9. Frontend changes that reach Vercel production on merge

A merge to the main branch deploys the frontend to Vercel production before Phase 5's Worker code is live, so the only frontend change must behave exactly like today until the new route exists.

```ts
// ===== src/utils/campaignSend.ts (M5) =====
export type CampaignSendResult =
  | { path: 'queue'; queued: number; run_id: string }                        // 202 from the Worker route
  | { path: 'edge'; data: unknown }                                          // fallback: functions.invoke('send-campaign') (today's path)
  | { path: 'none'; reason: 'already_sent' | 'not_found' | 'forbidden' | 'stopped' | 'unknown'; status: number | null };
export function startCampaignSend(campaignId: string): Promise<CampaignSendResult>;
// POST /api/marketing?action=send-campaign, JSON {campaign_id}, through fetchWithAuth (P2 E-1), timeout 30 s
```

| Answer of `/api/marketing?action=send-campaign` | Where it happens | Result | UI |
|---|---|---|---|
| 400 with `error` starting `Invalid action` | Vercel today (api/marketing.js:54-69); a Worker without Phase 5 (Phase 2 `#unknown` sentinel answered by the same handler, P2 §2.8) | `edge`: the function is invoked exactly as today | today's toasts ("Campaign sent successfully!" / "Campaign sending started!") |
| 503 `{"error":"sending_paused"}` | Worker with `OUTBOUND_MAIL_PAUSED = "true"` (S6 rollback) and a campaign without any run; answered before anything is queued (§5.9 order) | `edge` | today's toasts |
| 423 `{"error":"sending_stopped"}` | Worker with `OUTBOUND_MAIL_STOPPED = "true"` (incident stop) | `none` (`stopped`) — **never** the fallback | "Sending is stopped by the operator" |
| 409 `campaign_partially_queued`, 500 `enqueue_failed` | Worker with Phase 5 (paused after a failed run; enqueue error) | `none` (`unknown`) — never the fallback | "Sending status unknown: check the campaign before trying again" |
| 202 `{queued, run_id}` | Worker with Phase 5 | `queue` | "Campaign queued: n recipients" (wizard) / "Campaign sending started!" (table) |
| 409 `campaign_already_sent` or 202 with `queued: 0` | Worker with Phase 5 | `none` / `queue` | "Campaign was already sent" / "Sending already in progress" |
| 401, 403, 404, 429, any other status, timeout, network error, non-JSON body | anywhere | `none` (`reason` from the status, else `unknown`) — **never** the fallback | "Sending status unknown: check the campaign before trying again" (`unknown`), or the specific reason |

Rules: no new dependency; the wizard still navigates to `/dashboard/email-marketing` afterwards; scheduled campaigns stay untouched (F5-23); `tests/frontend-api/campaignSend.test.ts` covers every row (call order: the edge function is invoked only after a fallback answer). Evidence that the first row is today's behaviour: `api/marketing.js` answers any action other than `track`, `webhook`, `google-auth`, `apollo-enrich` with HTTP 400 and that body (api/marketing.js:57-68).

---

## 10. Owner checklist (manual steps at the end; Dimitris unless marked Both)

### 10.1 Before the first Phase 5 deploy

| # | Step | Reference |
|---|---|---|
| OW5-1 | Sign the Phase 4 gate; Phase 5 code merges from the commit that closes Phase 4 | PLAN.md:404; G5-8 |
| OW5-2 | Review §1 (defaults), the **proposed** names of §5.11 and the doc deviations of §11; approve the doc edits (Q6 record "41 deployed / 16 live-only", PLAN file-list paths) | PLAN.md:45 |
| OW5-3 | Run `agent_retention_purge()` once by hand (P4 §4.13 asks for it before Phase 5) | P4 §4.13 |
| OW5-4 | Appendix P items P-A and P-B (independent of Phase 5; do them now) | Appendix P |
| OW5-5 | Read the value of the Supabase function secret `ANTHROPIC_MODEL` (a model id, not a credential) and put it in `agent.content_daily` `value.model`, or accept `claude-sonnet-5` | D-6 |
| OW5-6 | AI Gateway `microns`: add the Google AI Studio key as a stored provider key; one preview call to confirm the `v1beta` path through the gateway | D-7 |
| OW5-7 | Cloudflare: `npx wrangler queues create translations`, `translations-dlq`, `outbound-mail`, `outbound-mail-dlq`; put the `SEO_CACHE` namespace id of `microns-site` into `workers/ops/wrangler.jsonc` | §5.11; workers/site/wrangler.jsonc:47-49 |
| OW5-8 | Secrets in `workers/ops` (none is in `secrets.required`; each is checked where it is used): `INDEXNOW_KEY` (same value as the public `/indexnow_key.txt`; without it translations record `indexnow: 'not_configured'`), `XOMETRY_TOKEN` (fresh: partner.xometry.eu login with MFA → DevTools → Local Storage `authToken`), optional `XOMETRY_COOKIE`; in `workers/site`: `CAD_COMPAT_TOKEN` (random, URL-safe, ≥ 32 characters); fill the `CAD_INPUT_HOSTS` placeholder with the presign hosts of the RFQ storage | §5.11; xc §5 O-1, O-9 |
| OW5-9 | Add ≥ 30 rows to `article_titles` (dashboard `/dashboard/auto-blog`); 15 were left on 2026-10-04 | F5-6 |
| OW5-10 | GitHub: environment `cad-release` with yourself as required reviewer and secrets `CLOUDFLARE_API_TOKEN` (Containers write) and `CLOUDFLARE_ACCOUNT_ID`; dispatch `cad-image.yml` with `push: true` and approve; copy the printed image reference into `workers/ops/wrangler.jsonc` | C-2; xc §5 O-6, O-7 |
| OW5-11 | On the VPS, send the output of `python --version; uname -m; pip freeze` inside the service container and the image id or git commit it was built from (no secrets in it); Claude replaces `requirements.lock.txt` with it before the CAD gate | C-7; xc §5 O-5 |
| OW5-12 | Open Action run 37146119967 and confirm the failure reason (expected: partner API 401) | F5-13; xc §5 O-2 |
| OW5-13 | Deploy `microns-ops` (`cf-ops.yml`) with every Phase 5 flag off, `CAD_BACKEND_DEFAULT = "vps"`, migration `v2`; wait several minutes for the container application; deploy `microns-site` | M-1; xc §3.11 step 1 |
| OW5-14 | P5-1: log check per reconcile §5, then delete the functions marked "delete after log check" (rec rows #22-#36; #37 only after the Phase 2 webhook is proven); then merge O5's later commit (removal of the repo folders #22-#25 and of the deleted functions' `config.toml` sections, §6.8) | rec §2, §5; Q6; PLAN.md:391 |

### 10.2 Switch-over runbook (P5-8; one step at a time, ≥ 24 h apart; record each step's first Worker run time)

Flag values are set with `scripts/phase5/flag-values.sql`; old schedulers with `supabase/migrations/<date>_deactivate_ported_crons.sql` after `SET microns.p5_step = '<S>'; SET microns.p5_action = 'deactivate';` in the same SQL-editor session.

| Step | Old scheduler | New job | Order inside the step | Rollback (≈ 5-15 min) |
|---|---|---|---|---|
| S1 | pg_cron 25 `hn-collector` | `hn` | flag `agent.growth.hn` `assist`; after the first succeeded `growth.hn:*` run → SQL `S1` | flag off; SQL `S1` `reactivate` |
| S2 | 23, 24, 29 `reddit-tier1/2/3` | `reddit-t1…t3` | as S1 with `agent.growth.reddit` | as S1 |
| S3 | 28 `tender-scan-daily` (it calls `tender-collector`, which after O-15 also drives the Phase 2 `tender-scan` path on the Worker) | `tenders` | (0) the day before: re-measure tenders per day and `tender_connectors.last_scan_at` (Q5, Q6). If tenders flow already (O-15 done), the prior 7 days become the Q5/Q6 baseline and the canary is skipped; else the baseline stays "scans happen" (DV5-12) and the canary runs. (1) SQL `S3` before 06:00 (this stops the old schedule and with it the Phase 2 collector path, so Phase 2 and Phase 5 runs never mix in one day); (2) flag `agent.growth.tenders` `assist`, with `countries` = the two canary countries (default `["NL","DE"]`, D-13) only when the canary runs; after 24 h and an acceptable alert volume, remove `countries` | flag off; SQL `S3` `reactivate` |
| S4 | 19 `auto-update-sitemap` | `sitemap` | the day before: flag `shadow` with `steps ["sitemap"]`, after 09:05 compare `phase5-shadow/sitemaps/<date>/sitemap-complete.xml` with the Storage object (`node scripts/phase5/compare-sitemap.mjs <a> <b>`: URL set equal, byte differences only in `lastmod` of the day); then SQL `S4` and flag `assist` | flag off; SQL `S4` `reactivate` |
| S5 | 17, 15, 22, 21 (`enqueue-daily-article`, `process-article-queue`, `auto-translate-daily-articles`, `auto-fix-article-links`) | `content-daily` | day D after 09:05: SQL `S5`; same evening: flag `assist`, `steps ["generate","translate","fix_links","sitemap"]`, `model` (OW5-5); D+1 07:00 first Worker run. **Never both chains on one day** | before 06:55: flag off; SQL `S5` `reactivate` |
| S6 | — | marketing route | owner test campaign to two owner-controlled addresses (one per sender account): events `sent`, tracking open and click recorded, limiter `stats()` shows the cap and spacing, campaign closes `sent`; decide the 25 pending CSV recipients first (OW5-19) | Rollback: `OUTBOUND_MAIL_PAUSED = "true"` (the dashboard falls back to the edge function, §9). Incident stop: `OUTBOUND_MAIL_STOPPED = "true"` (no fallback, queued mail held); the old edge function stays callable only from code that invokes it directly, so a stop that must also cover it needs that function's provider secrets removed (owner choice) |
| S7 | — | `ops-digest` | flag `agent.ops_digest` `assist` with `recipient` | flag off |
| S8 | GitHub Action schedule | `xometry` | flag `agent.growth.xometry` `shadow` for one day (first proof that Xometry accepts Worker egress, R5-14), then `assist`; repository variable `XOMETRY_SCAN_SCHEDULE = off` | flag off; variable deleted |
| S9 | VPS for the edge functions and agent jobs | CAD Container | (a) gate procedure §12 item 4 (needs the VPS reachable with its key), plus the preview checks of R5-16: a compat call whose input is fetched through `cad-input.internal` (the §5.8 wiring facts in the real runtime), cold start, abort at 110 s; (b) Supabase secret `UNFOLD_SERVICE_URL` → `https://www.micronshub.eu/api/cad/<CAD_COMPAT_TOKEN>` (keep the old value privately; replace, never unset); watch `cad_compat` events and the edge-function logs for 24 h; (c) `CAD_BACKEND_DEFAULT = "container"` and deploy | `UNFOLD_SERVICE_URL` back to the old value; `CAD_BACKEND_DEFAULT = "vps"` |

### 10.3 During and after the window

| # | Step | Reference |
|---|---|---|
| OW5-15 | Daily for 7 days after S5: run `scripts/phase5/parity.sql` with `<S_SWITCH_UTC>` per step (or read the digest); after S8 also Q13 | §12 |
| OW5-16 | Sign the Phase 5 gate when §12 passes for 7 consecutive days after S5 (S1-S4 have run longer by then) | PLAN.md:394-401 |
| OW5-17 | After signing: `SET microns.p5_gate = 'signed';` then the unschedule file (P5-9); delete the Action's repository secrets (Appendix P) | jobs §9.3 |
| OW5-18 | Keep the VPS and the Python Action file until Phase 6 (P6-5, P6-6) | PLAN.md:421-422 |
| OW5-19 | Marketing: decide what happens to the 25 `pending` CSV recipients of the draft campaign before using the route | F5-10 |
| OW5-20 | `gsc-*`: confirm whether anything outside the repo calls them; if not, delete them in P6-6 | rec rows #38-#41; Q6 |
| OW5-21 | Reddit returns no leads since 2026-03-30 (the source answers empty): decide whether the source stays (outside parity) | F5-9 |
| OW5-22 | Optional: `admin-update-partner-password` caller (src/pages/PartnerManagement.tsx:61) → switch it to `update-partner-password` | rec R4 |

---

## 11. Deviations from the documents, and risks

### 11.1 Deviations (doc changes need the owner's OK, PLAN.md:45; builders do not edit `docs/migration/**`)

| # | Document says | This spec | Why |
|---|---|---|---|
| DV5-1 | Sitemaps written to `microns-private` `sitemaps/…` and served from R2; `workers/site/src/sitemap.ts` changed (PLAN.md:368, :388; AGENTS.md:439) | Storage stays the served source; R2 shadow copy; `sitemap.ts` unchanged; reader switch in P7-5 or Phase 6 | D-1 |
| DV5-2 | Phase 5 cron expressions uncommented one at a time (wrangler.jsonc.draft:495-516); "Collectors as Cron Triggers" and Xometry "on a Cron Trigger" (PLAN.md:369, :372) | One minute tick + schedule table + flags; triggers unchanged | D-3 |
| DV5-3 | `workers/ops/src/cron/{collectors,marketing}.ts` (PLAN.md:383) | `cron/{schedule,run-schedule}.ts`, `collectors/*`, `marketing/*`, `queues/scrapes-p5.ts` | §4 |
| DV5-4 | `content-daily` submits the new URLs to IndexNow in one step (AGENTS.md §3.5) | One submission per new translation in the consumer, as live | D-8 |
| DV5-5 | Fix-links for the day's `translation_id` only (AGENTS.md §3.5) | Full paginated pass per language | D-9 |
| DV5-6 | Generation failure → no fan-out; a language failing 5 times → card with **Retry failed** (AGENTS.md:466) | Generation failure still fans out today's backfill; a final language failure → plain-text alert, and the next daily backfill re-enqueues it | D-10, D-28 |
| DV5-7 | DLQ backlog read from the Cloudflare API for the digest (AGENTS.md §3.6, §9 point 3) | Final failures recorded in `agent_runs` | D-18 |
| DV5-8 | "40 deployed edge functions", "15 out-of-repo" (PLAN.md:88, :621; CANON.md §12) | 41 deployed, 16 live-only | F5-3 |
| DV5-9 | P5-4 names only the queue and the DO (PLAN.md:371) | New `/api/marketing` action `send-campaign` (resolver, gate rows MK-8) and a frontend change with fallback | D-15, §9 |
| DV5-10 | `content-daily` "replaces" `enqueue-daily-article` (PLAN.md:368) | The jobs are replaced; the DB functions are kept and called | D-21 |
| DV5-11 | A flag for every job (PLAN.md:368-374) | Marketing follow-ups, warm-up and pause are vars | D-16 |
| DV5-12 | Gate item 3: tenders and leads "within the normal range of the prior 7 days"; Xometry "upserted on schedule" (PLAN.md:397-398) | Tenders: connectors scanned on schedule (Q6) because the prior range is 0 — **conditional**: if the re-measurement at S3 shows tenders flowing through the Phase 2 path (O-15 done), the prior 7 days are the baseline as PLAN.md says; reddit 0 accepted; Xometry: one run with an outcome per slot (Q13) because no offer was ever stored | F5-9, F5-13; §10.2 S3 |
| DV5-13 | Xometry Action schedule removed (PLAN.md:375, :390) | Schedule kept behind a repository variable until P6-6 | X-5 |
| DV5-14 | Container image from the Dockerfile path (PLAN.md:373, :385; wrangler.jsonc.draft:416) | Prebuilt image by tag; new workflow `cad-image.yml` (not in the PLAN file list) | C-2 |
| DV5-15 | Optional Hyperdrive `SUPABASE_DB` for Xometry (PLAN.md:372) | Not created | X-1 |
| DV5-16 | Keep-warm ping in business hours; cold start 10-30 s (ARCHITECTURE.md:396, :462) | Keep-warm off (as COSTS.md:34, :158); cold start measured at the gate | C-8 |
| DV5-17 | `/flat-pattern` "byte-identical" (PLAN.md:399) | Equal after masking the values the service randomises itself | C-5 |
| DV5-18 | `UNFOLD_SERVICE_URL` repointed to the Container (PLAN.md:373) | Repointed to a site path that reaches the Container through ops (`/api/cad/<token>/flat-pattern`) | C-4 |
| DV5-19 | Names not in CANON: `XOMETRY_COOKIE`, `CAD_COMPAT_TOKEN`, vars of §5.1, endpoint `cad-compat`, gate IDs MK-8 and CD-1, agent keys `content_daily.translate`, `content_daily.sitemap`, `marketing.*`, R2 prefix `phase5-shadow/`, GitHub `cad-release` and `XOMETRY_SCAN_SCHEDULE` | Proposed (§5.11); a CANON addendum lists them once approved | — |
| DV5-20 | Q6 default "keep `gsc-*` if a caller exists" (PLAN.md:621) | Kept and added to the repo until the owner confirms a caller (OW5-20) | rec rows #38-#41 |
| DV5-21 | `workers/cad/*` = "Container app definition (`CadContainer`, image from `sheet-metal-service/Dockerfile`), bound from `microns-ops`" (PLAN.md:385) | `CadContainer`, input proxy and slot helpers in `workers/ops/src/cad-container/`; `workers/cad/` holds the README and the parity tool; image still built from `sheet-metal-service/Dockerfile` | C-1 (one copy of `@cloudflare/containers`) |
| DV5-22 | PLAN.md:391 "Deleted: dead edge functions and their repo folders" | Deployed functions deleted by the owner (OW5-14); the four repo folders that exist (#22-#25) removed by O5's later commit after that; live-only functions have no folder | §6.8 |

### 11.2 Risks

| # | Risk | Mitigation |
|---|---|---|
| R5-1 | Titles run out during the window (15 left on 2026-10-04), failing gate item 1 for a reason unrelated to the port | OW5-9; Q10 shows `no_titles` days separately |
| R5-2 | Gemini quota with 13 + ≤ 65 translations a day, on the same key as the live chain while both exist | Shadow never translates; backfill cap in the flag value (lower to 2 on 429s); the chain falls through models as live |
| R5-3 | Equal `updated_at` values make the article order of the sitemap non-deterministic (live has no tie-breaker) | Parity compares the URL set and count (Q4, `compare-sitemap.mjs`), not byte order; the port keeps live's order clause exactly |
| R5-4 | A working tender port sends alerts the owner has not seen for months | Canary (D-13) |
| R5-5 | Two articles on the S5 day | Runbook order S5; catch-up window 60 min (D-5) |
| R5-6 | Conflicting Cron Trigger limits in the docs | One trigger (D-3) |
| R5-7 | Gmail access tokens refreshed per send burst (no write-back, P4) | Token cached per isolate for its lifetime; volumes are tiny |
| R5-8 | Long `generate-en` completions near the gateway timeout | `cf-aig-request-timeout` 300 s on that call; step timeout 10 min |
| R5-9 | Dashboard buttons keep calling the old functions (two paths for a while) | D-20; repoint in Phase 6 |
| R5-10 | Phase 4 widens `ScrapeMessage['kind']` with `directory-scan` (P4 §4.9) while Phase 2 types two tables by that union (workers/ops/src/queues/scrapes.ts:28-31) | Phase 5 does not depend on it (D-27); reported to the Phase 4 spec owner |
| R5-11 | A Gmail send that succeeded just before an isolate crash is sent again on redelivery | Limiter keys plus tiny volumes; Resend sends carry an idempotency key |
| R5-12 | Xometry token lifetime unknown; refresh is manual (MFA) | Alert, pause, daily reminder, JWT expiry hint (X-2) |
| R5-13 | `wrangler deploy --dry-run` may need Docker or registry access for the `containers` stanza | `build:dry` falls back to a config without it and says so (§7.2) |
| R5-14 | Xometry may treat Worker egress differently from GitHub runners | Shadow day at S8 decides; fallback: keep the Python Action with an added 401 alert step |
| R5-15 | Byte identity needs the VPS library versions | OW5-11 is a precondition; without it the CAD gate is not attempted |
| R5-16 | Container behaviours not testable locally: outbound interception of `cad-input.internal` in the real runtime, its DNS, abort propagation to the container | T1 pins the library side against the real 0.3.7 package (§5.8 wiring tests: one module instance, setter registration, proxy routing); preview (T3) checks at S9 (a); fallbacks `interceptHttps` with a CA in the image, or R2 staging; the service wall clock still stops work at 120 s |
| R5-17 | 3 GB image: slow first pull on a new placement; 50 GB account image storage | ≤ 3 tags kept; slimmer image later |
| R5-18 | 9 service tests already fail or error under today's library versions | Out of the CI gate, listed in `workers/cad/README.md` |
| R5-19 | `PYTHONHASHSEED=0` disables hash randomisation | Only authenticated callers reach the service |
| R5-20 | Xometry hours fixed in UTC move by one hour in Athens with daylight saving | Accepted (Cron Triggers are UTC; same as the Action) |
| R5-21 | Names in §3.1 come from the final Phase 4 spec; the landed Phase 4 code may still differ | Builders adapt in their own files; K5's Wave 0 stubs follow the landed Phase 4 code |
| R5-24 | Phase 4 and Phase 5 both extend the same pinned Phase 2 tests (`config.test.ts`, `policy.test.ts`, `rpc.test.ts`) | Same rule as Phase 4 R-10: earlier expectations stay as written, each phase adds its own; the Wave 3 diff check (§7.2) lists exactly the test files Phase 5 may change; if the landed Phase 4 code differs (e.g. count ≠ 41), M5/K5 add their deltas to what landed |
| R5-25 | Hand-off wording in PHASE4_SPEC.md §9 (:1057 "inside `queues/scrapes.ts`") differs from D-27 | D-27 wins for Phase 5 (Phase 4 itself freezes `scrapes.ts`); reported to the Phase 4 spec owner |
| R5-22 | Line numbers in PLAN.md and the annexes drift | Re-anchor at build time; citations name the section too |
| R5-23 | Gate item 1's baseline is 0 per day for the seven lagging languages, so "≥ baseline" passes trivially | Q2 (missing translations fall every day to 0) and Q3 (13 translations within 24 h) carry the real check |

---

## 12. Exit gate mapping (PLAN.md:394-401) and rollback

| Gate item | Evidence | Tool | Pass |
|---|---|---|---|
| 1 Articles and translation lag | Q1, Q2, Q3, Q10 of `scripts/phase5/parity.sql`; `content_daily` run output `lag_days` | SQL editor (read-only), daily | Q1 no day below baseline; Q2 `lag_days` 0 from day 2 and `missing_translations` falling daily to 0; Q3 no rows; Q10 one completed queue row a day (or a `no_titles` day explained) |
| 2 Sitemap | Q4 (a-c); SEO parity probes of `/sitemap.xml` and `/sitemap-complete.xml` (headers and bytes) with `scripts/seo-parity` from an allowed vantage point | SQL; parity tool (owner) | object updated within 26 h every day; run `urls` = expected count; 0 missing monitored URLs; headers unchanged |
| 3 Leads, tenders, Xometry | Q5, Q6, Q7, Q13 | SQL | HN per day ≥ prior-week minimum (or a failure explained in the digest); 0 duplicates; connectors not stale from the second day after S3, and tenders per day within the prior 7-day range when the S3 re-measurement found tenders flowing (DV5-12); subreddit coverage ≤ 54 overdue; every Xometry slot has an outcome |
| 4 `/flat-pattern` and cold start | `cad_parity.py capture/compare` VPS vs Container for the 5 references (compat path and a dual-run `cad-jobs` message); cold start: `CadRouter.recycle('cad-2')`, 3 timed cold calls and 3 warm calls | comparator report (owner run, OW5-11 precondition) | 5/5 `IDENTICAL` for every endpoint; timings recorded |
| 5 Run rows | Q8 (+ Q13) | SQL | expected counts per agent and day; `stuck` = 0, i.e. no run `running` beyond its agent's limit (1 h; `growth.tenders` 2 h; `content_daily` 8 h; `marketing.send` 48 h; §6.8) |
| 6 Old schedulers disabled, not deleted | Q9; GitHub variable `XOMETRY_SCAN_SCHEDULE = off` with the workflow file present; VPS serving with its old image and the old `UNFOLD_SERVICE_URL` value kept | SQL; GitHub UI | 10 jobs present and inactive, silent since deactivation |

Rollback per step is the last column of §10.2 (≈ 5-15 min; PLAN.md:403). After P5-9 the pg_cron rollback is no longer a re-activation: a new `cron.schedule(…)` per job is needed with a credential issued at P6-1, which is why unscheduling waits for the signed gate (PLAN.md:375; jobs §9.3).

---

## Appendix C — Critique log (2026-10-04)

Public section (same handling as §0-§12). The critique of 2026-10-04 raised 15 findings (3 high, 6 medium, 6 low). Each was verified before any edit; the verification evidence is in the third column. Verdicts: **fixed** (as proposed), **fixed (variant)** (the defect was real, a different fix was chosen, reason given), **partly rejected** (the part not done and why). Nothing was rejected outright. The pass also found seven defects of its own (SF rows).

| # | Sev. | Finding (short) | Verified by | Verdict and where |
|---|---|---|---|---|
| 1 | high | `AgentKey` placed in shared `agent-types.ts`, while Phase 4 keeps it in `agents/runs.ts` with Phase 4 keys only, and §8 froze that file | P4 CR-34, §4.7 (union of 9 Phase 4 keys), §4.3 (`FlagKey` only), §9, DF-79 | **fixed**: K5 adds the 11 keys in `agents/runs.ts` (§3.2 row, §5.5, §7.1, Wave 0); agent-types row removed; §8 exempts `runs.ts`; shared stays M5-only (`rpc.ts`) |
| 2 | high | `@cloudflare/containers` declared in `workers/cad` and ops: unresolved in ops CI or two copies, and two copies break the proxy registry | `container.js:37-41, :196-235`; probe `ctrprobe/probe2.mjs` (two copies → 520); `.github/workflows/cf-ops.yml:71-81` (installs root, shared, ops only) | **fixed (variant)**: option (b) — `CadContainer`, input proxy and slots move to `workers/ops/src/cad-container/` (D5), ops is the only declarer (C-1, DV5-21), `workers/cad/` keeps README + parity tool; no CI change needed. `check-bundle` fails on a second resolved path (§3.2). Option (a) not taken: it needs a `cf-ops.yml` change plus a re-export chain, and any later `npm ci` in `workers/cad` would silently bring the second copy back |
| 3 | high | Phase 2 tests pin exact shapes Phase 4/5 extend, while Wave 3 demanded them "unchanged" | workers/site/test/policy.test.ts:9-12; workers/ops/test/config.test.ts:77-127; also `rpc.test.ts:6-22`, `env-api.test.ts:228-238`, `resolve.test.ts:52` (found during the fix) | **fixed**: §3.2 rows — `config.test.ts` (K5), `policy.test.ts` count 41 → 43 (M5), `rpc.test.ts` unions (M5); site `env.ts` left unchanged (`CadCompatEnv`), `/api/cad/` matched as a prefix outside the 13-path catalogue; Wave 3 diff check lists exactly the changed test files. Aligned with the Phase 4 rule R-10 / §7.2, which the Phase 4 spec adopted in its own critique pass (re-read 09:15 UTC) |
| 4 | med | Literal-secret scan with `\|` inside a table never matches | probe: `rg "eyJ\|whsec_…"` exit 1 on a line with the JWT prefix; `-e` form exit 0 | **fixed**: §7.2 fenced bash with one `-e` per pattern, PEM marker added, positive self-test on a runtime-built probe first (run in this container 2026-10-04: `self-test ok`, `scan clean`, dirty files matched) |
| 5 | med | T2 `jobs` profile ran on the Phase 2 T2 config; consumers not stated | workers/ops/vitest.t2.config.ts:10; P4 §5.2, §6.3 | **fixed (variant)**: own config `vitest.t2.jobs.config.ts`, script `T2_PROFILE=jobs vitest run -c vitest.t2.jobs.config.ts`; files `test/t2-jobs/p5-<area>.jobs.ts` rather than the proposed `test/t2/p5-*.t2.ts`, because Phase 4's `agents` config collects exactly `test/t2/*.t2.ts` and would pick those up; profile keeps `scrapes`, `translations`, `outbound-mail`, `cad-jobs` consumers with stub-only sources (§7.2, F5-25) |
| 6 | med | `send-campaign` had no failure path, no pagination; "nothing running > 1 h" contradicts designed run lifetimes; 6 h wait on days without an article | §5.9 old steps (4), (6); jobs.md Q8 (`running` > 1 h incl. `content_daily`, `marketing.send`); §6.2 step 8 | **fixed (variant)**: §5.9 steps (1)-(9) (failed enqueue closes the run `failed`, re-queue under `:r<n>` only for recipients without a final event, pages of 1,000, concurrent clicks covered by `created: false`); D-30; step 8 waits only when a `daily` message went out; Q8 per-agent limits written and run on live with a stand-in — `content_daily` 8 h (not the proposed 7 h: generation ≤ 40 min + 6 h wait + fix-links + sitemap), `growth.tenders` 2 h (retries of a child), `marketing.send` 48 h; gate item 5 reworded (§12) |
| 7 | med | Public sections described a current weakness of a specific endpoint and its request shape | CANON.md §1 rule 2; old C-3, C-4, F5-15, F5-16, §5.9, §6.7 wording | **fixed**: rephrased as rules ("Phase 5 requires the key on every non-health route", "the compat path supplies authentication"); request fields, validation texts and the compatibility reason moved to Appendix P.3 |
| 8 | med | `static outboundByHost = {…}` class field never registers the handler | `container.js:225-229, :272-277, :361-368`; probes with the real 0.3.7 package in Node 22 and in the ops vitest 5.0.3 (`ctrprobe/probe.mjs`, `ctrprobe/wiring.test.ts`: field → 520, setter → 200) | **fixed**: registration by assignment after the class body (§5.8), three T1 wiring tests against the real package (no T1 alias any more), preview re-check at S9 (a), F5-19 |
| 9 | med | Sibling-spec wording: `scrapes.ts` vs `scrapes-p5.ts`, `readAgentFlag`, `gatewayHeaders`, "P4 LLM profile", prompt registry not an extension point | P4 §9 rows, CR-12, §4.10, §4.15; `../phase4/agents.md:117` | **partly rejected**: Phase 5 side fixed (`gatewayHeaders` named in §3.1/§5.4, profile `LLM_EXTRACT` in §5.7/§6.6, `readFlag` note in CD5-1, registry entry as a K5 extension row, D-31 keeps content prompts outside the Phase 4 prompt tree). Editing the Phase 4 §9 sentence was not done: that file belongs to the Phase 4 spec pass (being edited in parallel); recorded as R5-25 with D-27 as the binding reading |
| 10 | low | `INDEXNOW_KEY` in `secrets.required` against the Phase 4 per-use rule | P4 §4.1, CR-33; old §5.11 | **fixed**: `secrets.required` unchanged; `INDEXNOW_KEY?` checked per use, `indexnow: 'not_configured'` (§5.1, §6.2, §5.11, OW5-8) |
| 11 | low | Tender baseline "dead since 2026-06-06" ignores the Phase 2 `tender-collector` rebuild (O-15) | PHASE2_SPEC.md:146, :837, :950; jobs.md:384 (job 28 calls `tender-collector`) | **fixed**: D-13, F5-9, DV5-12 conditional; S3 step (0) re-measures and picks the baseline, and notes that SQL `S3` also stops the Phase 2 collector path |
| 12 | low | PLAN "dead functions and their repo folders" not covered | PLAN.md:391; reconcile rows #22-#25; `supabase/functions/` listing; supabase/config.toml:2-21 | **fixed**: O5 later commit removes the four folders and their `config.toml` sections after OW5-14 (§4, §6.8, §7.1, §8, DV5-22) |
| 13 | low | Q13 counted a slot before the switch | live run with a stand-in (switch 08:30 → slot 08:00 listed) | **fixed**: `g >= switch`, current slot gets 5 min; re-run on live 2026-10-04 09:00 UTC (§6.8) |
| 14 | low | Router timeouts and the 502 promise cannot be built on the landed router | workers/site/src/api/router.ts:35-89 (no per-target timeout); ops-client.ts:72-78 (500 text/plain) | **fixed (variant)**: timeout wording removed, `ENDPOINT_TARGETS['cad-compat'] = 'ops'`, the 110 s deadline is ops-side; RPC-level failures accepted as the frozen 500 `text/plain` (F5-26), because both edge functions treat any non-2xx alike (extract-flat-pattern/index.ts:159-167, generate-manufacturing-pdf/index.ts:77-80); the optional router mapping to 502 was not added (it would widen a frozen Phase 2 path for no behavioural gain) |
| 15 | low | "Pause" falls back to the old sender, so there was no stop; G5-5 vs `skipped` rows; deferral delay can exceed 24 h | §9 row 503; §5.3 deferral; `../phase2/cfdocs/queues_platform_limits.md:36` | **fixed**: var `OUTBOUND_MAIL_STOPPED` → 423 `sending_stopped`, never a fallback, consumer holds mail (D-16, §5.1, §5.9, §9, S6); G5-5 reworded (dispatcher writes nothing, a consumer of already-queued work writes `skipped` `flag_off`); every delay clamped to `min(86_400, …)` |

Defects found while applying the critique:

| # | Defect | Evidence | Fix |
|---|---|---|---|
| SF-1 | The translations consumer acked its **own retries**: a retry arrives < 30 min after the run opened, while the run is still `running`, so the old rule (1) dropped the translation and left the run open | §5.3 retry delays 120 × attempts; old §6.2 rule (1) | rule (1) now acks a `running` duplicate only at `msg.attempts = 1`; any other `running` case continues under the same run |
| SF-2 | A unit re-run after a final outcome reused its key and was silently dropped (backfill of a failed translation the next day; campaign re-queue) | `../phase4/agent_layer.sql:625-650` (`ON CONFLICT … DO NOTHING`, existing row returned, never re-opened) | D-30: `content_daily.translate:<translation_id>:<lang>:<for_date>`, `marketing.send:<campaign_id>:r<n>` |
| SF-3 | Content prompts are byte copies without front matter or schema, but sat in the Phase 4 prompt tree whose rules and frozen-prompt test expect both | P4 §4.15, K-2 | D-31: `src/content/prompts/` with C5's own lock test; only the digest prompt follows the Phase 4 convention and registry |
| SF-4 | Pause after a failed run answered 503, so the dashboard fell back to the old sender, which (tag mode) mails recipients the Worker already reached | §9 fallback rule; repo `send-campaign` sends to every tagged subscriber | §5.9 step (6): 409 `campaign_partially_queued` in that case (never the fallback answer) |
| SF-5 | Pause/stop holds counted as deferrals, so a stop longer than 30 h turned held mail into failures | §5.3 `deferrals > 30` → final failure | holds do not count; only cap and spacing deferrals do |
| SF-6 | Required Phase 5 `OpsEnv` fields would break the ops typecheck (Phase 2 test helpers build `OpsEnv` literals) and a site `Env` field would break the Phase 2 env test | workers/ops/test/helpers/ops.ts:37-53; workers/site/test/env-api.test.ts:228-238; P4 CR-40 | §5.1: every Phase 5 field optional, checked with Phase 4 `need()`; site keeps `env.ts`, the token type lives in `auth/cad-compat.ts` |
| SF-7 | The tender child run had no rule for its own retries and flag-off | §6.3 old row | `created: false` + final → ack; `running` → continue; flag off → `skipped` `flag_off` |

Critique statements accepted without change (re-checked where cheap): live schema columns, unique keys and RPC signatures match §5.10; one tender connector per country code (live 2026-10-04: 26 active); `runNodeHandler` is shared; `OpsApi.handle` returns a `Response`; `fetchWithAuth` and `tests/frontend-api/vitest.config.mjs` exist in the working tree; the §9 fallback is safe on Vercel and on a Worker without Phase 5 (api/marketing.js:57-68); Phase 3 precedes Phase 5; no Workers CPU, wall-time or subrequest limit problem for the designed jobs.

---

