# Microns Hub — European On-Demand Manufacturing Platform

[![Live Site](https://img.shields.io/badge/Live-micronshub.eu-blue?style=for-the-badge)](https://www.micronshub.eu)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![Cloudflare](https://img.shields.io/badge/Runs_on-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](#license)

> A production manufacturing marketplace connecting European engineers with vetted machine shops — competing directly with Xometry, Protolabs, and Sculpteo. **This is a live, revenue-generating business, not a tutorial project.**

---

## Overview

**Microns Hub** is a full-stack manufacturing-as-a-service platform that automates quoting, CAD processing, order management, and multilingual content distribution for on-demand manufacturing across Europe.

- Built from scratch as **solo founder and developer**
- Serves real customers with CNC machining, sheet metal, 3D printing, and injection molding
- Handles the full lifecycle: CAD upload → quoting → order tracking → delivery
- 14-language multilingual SEO engine driving organic traffic across Europe
- Live at **[micronshub.eu](https://www.micronshub.eu)**

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 18 with Vite 5 (SPA with prerendered routes for SEO) |
| **Language** | TypeScript / JavaScript |
| **Routing** | React Router v6 (language-prefixed routes: `/{lang}/services`, `/{lang}/blog/{slug}`) |
| **Styling** | Tailwind CSS 3 + shadcn/ui (Radix UI primitives) |
| **State Management** | TanStack React Query (server state + caching) |
| **Forms** | React Hook Form + Formik + Zod / Yup validation |
| **Database** | Supabase (PostgreSQL + Row Level Security) |
| **Auth** | Supabase Auth (customers, partners and staff with role-based access) |
| **Edge and API** | Cloudflare Workers: `microns-site` (static assets, SEO rendering, redirects, sitemaps, browser-facing `/api/*`), `microns-ops` (back-office API, Cron Triggers, Queues, Workflows, Durable Objects, remote MCP) and `microns-mail` (inbound RFQ mail) |
| **File Storage** | Cloudflare R2 (new uploads) + legacy AWS S3 (existing files) + Supabase Storage |
| **Backend jobs** | Cloudflare Workflows, Queues and Cron Triggers in `microns-ops` (article pipeline, translations, collectors, marketing, Xometry scan, weekly digest) + Supabase Edge Functions (Deno) for auth-bound and partner functions |
| **Sheet Metal Service** | FastAPI (Python) — STEP → DXF/PDF/SVG pipeline, run as a Cloudflare Container |
| **CAD Processing** | OpenCascade (occt-import-js) for STEP parsing, CadQuery for unfolding |
| **3D Viewer** | Three.js + React Three Fiber + Drei (STEP → GLB browser rendering) |
| **2D Nesting** | Custom nesting engine (DXF import → bin-packing → SVG/DXF export with QR tracking) |
| **i18n** | i18next + react-i18next (14 languages, server-rendered SEO bodies) |
| **Email** | Resend (transactional + marketing campaigns with tracking) |
| **AI** | Claude and Gemini through Cloudflare AI Gateway (article generation, translation, RFQ intake) |
| **SEO** | Prerendered routes (210+ URLs), hreflang, structured data, XML sitemaps, IndexNow |
| **Monitoring** | Cloudflare Workers Logs and Analytics Engine; GA4 and Google Ads tags in the page shell |

---

## Key Features

### For Customers (B2B Engineers & Procurement)
- **Quoting Engine** — upload STEP/STL, get pricing with DFM analysis
- **Multi-Service Manufacturing** — CNC milling & turning, sheet metal fabrication, 3D printing (SLS/FDM/SLA), injection molding, surface finishing
- **3D CAD Viewer** — Three.js browser viewer with STEP → GLB rendering pipeline
- **Order Tracking Dashboard** — status updates for all orders and RFQs
- **Pan-European Delivery** — vetted manufacturer network across Europe (4–9 working days)

### For Manufacturing Partners
- **Partner Dashboard** — dedicated interface with role-based authentication (`partner_seller`)
- **RFQ Management** — receive qualified leads, manage jobs, update production status
- **Credential Management** — partner onboarding and password management

### Platform Architecture
- **Multi-Tenant System** — Supabase RLS with `tenant_id`, white-label SaaS ready
- **Subdomain Routing** — per-tenant branded subdomains with capability toggles and custom landing pages
- **Multilingual SEO Engine** — 14 languages, prerendered routes, server-rendered SEO bodies at the edge, hreflang tags, language-aware sitemaps
- **Agent Layer** — RFQ intake, quoting and post-order Workflows behind feature flags, with human approval for every customer-facing step
- **Sheet Metal Unfolding Pipeline** — Python FastAPI service using OpenCascade/CadQuery, DXF export, PDF drawing generation
- **2D Nesting Engine** — bin-packing optimization for sheet metal parts with SVG preview, DXF export, and QR-labeled remnant tracking

### Automation & Content
- **AI Article Generation** — daily SEO-optimized manufacturing articles, with silo structure and internal linking
- **Multi-Language Translation** — translation into 14 languages with per-language queue retries and quality checks
- **Social Media Distribution** — automated posting to Facebook and LinkedIn
- **Email Marketing** — campaigns with spintax personalization, open/click tracking, and unsubscribe management
- **Lead Generation** — Reddit monitor, EU procurement tender scanner, Europages scraper, Hacker News collector

### Technical Highlights
- **210+ prerendered routes** with structured data, dynamic meta tags, XML sitemaps, hreflang
- **Server-side STEP analysis** — geometry extraction and manufacturability checks
- **Rate-limit aware** AI pipelines with retries and dead-letter queues
- **Real-time features** via Supabase Realtime subscriptions
- **PDF generation** — manufacturing quotes, RFQ confirmations, technical drawings

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Client (Browser)                        │
│   React 18 + Vite  │  Three.js 3D Viewer  │  Tailwind CSS   │
│   React Router v6  │  i18next (14 langs)  │  shadcn/ui      │
└────────────┬─────────────────────────────────────────────────┘
             │  www.micronshub.eu, <tenant>.micronshub.eu
             ▼
┌──────────────────────────────────────────────────────────────┐
│   Cloudflare                                                 │
│   microns-site (Worker + static assets)                      │
│   ├─ SEO rendering, redirects, sitemaps                      │
│   └─ /api/* router ── service binding ──┐                    │
│                                         ▼                    │
│   microns-ops (Worker)                                       │
│   ├─ back-office API, Cron Triggers, Queues                  │
│   ├─ Workflows (content, RFQ intake, quote, post-order)      │
│   ├─ AI Gateway, remote MCP                                  │
│   └─ CAD Container (sheet-metal-service)                     │
│   microns-mail (Email Worker, rfq.micronshub.eu) ─▶ ops      │
│   R2: public and private buckets                             │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│                        Supabase                              │
│   PostgreSQL  │  RLS (tenant_id)  │  Auth  │  Storage        │
│   Edge Functions (Deno) for auth-bound and partner functions │
└──────────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│                    External Services                         │
│   Resend  │  Claude API  │  Gemini API  │  Telegram          │
│   Google Search Console  │  IndexNow  │  AWS S3 (legacy)     │
└──────────────────────────────────────────────────────────────┘
```

---

## Manufacturing Services

| Service | Technologies | File Formats |
|---|---|---|
| **CNC Machining** | 3-axis, 4-axis, 5-axis milling; CNC turning | STEP, STP, STL, IGES |
| **Sheet Metal** | Laser cutting, bending, welding, unfolding | STEP, DXF, PDF drawings |
| **3D Printing** | SLS, FDM, SLA, MJF | STEP, STL, 3MF |
| **Injection Molding** | Prototype & production tooling | STEP, STP |
| **Surface Finishing** | Anodizing, powder coating, plating, polishing | — |
| **Rapid Prototyping** | Multi-process fast turnaround | STEP, STL |

---

## Project Structure

```
├── src/                  # React SPA: pages, components, utils, hooks, contexts, 14 locales
├── workers/
│   ├── site/             # microns-site: static assets, SEO handler, redirects, sitemaps, /api router, gates
│   ├── ops/              # microns-ops: back-office API, queues, workflows, agents, remote MCP, CAD Container class
│   ├── mail/             # microns-mail: Email Worker of rfq.micronshub.eu
│   ├── cad/              # CAD Container notes and the unfold parity tool
│   └── shared/           # code shared by the Workers (auth, HTTP, storage, Express-compatible shim)
├── middleware/           # SEO rendering modules (metadata, schema, renderers) used by workers/site
├── api/                  # API handlers, run by the Workers through the Express-compatible shim
├── lib/                  # nesting engine, inventory, tender connectors
├── supabase/
│   ├── functions/        # Edge Functions (Deno)
│   └── migrations/       # PostgreSQL schema migrations
├── sheet-metal-service/  # FastAPI Python service (Docker image of the CAD Container)
├── mcp-server/           # local MCP server (stdio)
├── reference/            # frozen parity references used by tests: the pre-2026 Vercel config, two retired edge functions
├── tests/                # nesting, E2E (Playwright), unit, frontend API and edge-function tests
├── scripts/              # parity tool, DNS parity, verification and utility scripts
└── docs/                 # technical documentation, migration plan and runbook
```

---

## Deployment

Production runs on Cloudflare since the 2026 migration (plan and runbook: [docs/migration/PLAN.md](docs/migration/PLAN.md)). Supabase remains the database, auth and storage provider.

| Part | Where it runs | How it is deployed |
|---|---|---|
| Website, SEO rendering, sitemaps, redirects, browser-facing `/api/*` | Cloudflare Worker `microns-site` (`workers/site`) on the `www.micronshub.eu` and `*.micronshub.eu` routes | GitHub Actions, manual: `cf-preview.yml` uploads a preview version; `cf-site-production.yml` uploads and deploys with `--env production` |
| Back-office `/api/*` routes, queues, workflows, scheduled jobs, remote MCP (`mcp.micronshub.eu`) | Cloudflare Worker `microns-ops` (`workers/ops`), reached from `microns-site` over a service binding | `cf-ops.yml`, manual |
| Inbound RFQ mail (`rfq.micronshub.eu`) | Cloudflare Email Worker `microns-mail` (`workers/mail`), hands each message to `microns-ops` | `cf-mail.yml`, manual |
| Apex `micronshub.eu` | Cloudflare redirect rule to `https://www.micronshub.eu` (path and query kept); payload generated by `scripts/phase3/` | Zone configuration |
| Any `http://` request | Cloudflare redirect rule to `https://` on the same host (path and query kept); payload generated by `scripts/phase3/` | Zone configuration |
| Tenant sites | `<slug>.micronshub.eu` through the wildcard route; custom tenant domains are connected by the platform team | Zone configuration |
| Article images | Uploaded from the dashboard media library; with `ARTICLES_STORE` = `r2` new images go to the R2 bucket behind `files.micronshub.eu`, older images keep their URLs | Worker var in `workers/site/wrangler.jsonc` |
| Edge Functions, database, auth | Supabase | Supabase CLI / dashboard |
| Sheet metal service | Cloudflare Container (`CadContainer`, exported by `microns-ops`) from `sheet-metal-service/` | image built and pushed by `cad-image.yml`, then deployed with `microns-ops` |

Local development:

```bash
npm ci && npx vite build          # the Worker serves dist/
npm run cf:install                 # Worker dependencies
npm run cf:dev                     # microns-site on http://localhost:8787 (wrangler dev --local)
npm run cf:test:all                # Worker unit tests
```

Secrets are never committed; local values go in the git-ignored `.dev.vars` files (templates: `.dev.vars.example`). A `microns-site` secret changes with `npx wrangler versions secret put <NAME> --env production` in `workers/site`, followed by an `upload` and a `deploy` of `cf-site-production.yml` (preview and production versions share the Worker's secrets); never `wrangler secret put` or a plain `wrangler deploy` on `microns-site`. The other Workers set secrets as their READMEs describe.

Rollback: every production change is a tagged Worker version (`prod-<commit>`); the `deploy` action of `cf-site-production.yml` with the previous version ID restores it.

---

## Quality & Testing

### Automated Test Suites

- **Worker tests** (`workers/*/test/`) — Vitest unit and integration tests for routing, redirects, SEO rendering parity, API gates, storage and jobs
- **SEO parity tool** (`scripts/seo-parity/`) — compares status, headers and bodies of the public URL set between two hosts
- **Nesting Engine Integration Tests** (`tests/nest.test.js`) — DXF parsing, area calculation, hole detection, material grouping, bin-packing, SVG preview, DXF export
- **Playwright E2E Tests** (`tests/e2e/`) — homepage rendering across 14 languages, service navigation, SEO meta tags, hreflang, sitemaps and robots.txt, API paths
- **Frontend and edge-function tests** (`tests/frontend-api/`, `tests/edge/`, `tests/edge-functions/`) — authenticated API helpers, forms, and the caller checks of edge functions
- **Database policy tests** (`supabase/tests/`) — PGlite runs of migrations and row-level security rules
- **Unit Tests** (`tests/unit/`) — material density lookup, weight calculation, spintax parsing, email template processing

### Manual Testing Practices

- Cross-browser testing (Chrome, Firefox, Safari, Edge) for all customer-facing flows
- Mobile responsiveness validation across breakpoints
- Multilingual content verification in all 14 languages
- CAD file upload testing with various STEP/STL/DXF formats and edge cases
- Supabase RLS policy testing for multi-tenant data isolation
- Partner dashboard role-based access verification

---

## What I Built & What I Learned

| Domain | Skills Demonstrated |
|---|---|
| **Frontend** | React 18, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, Three.js 3D rendering, i18next multilingual, responsive design |
| **Backend** | Cloudflare Workers, Workflows, Queues and Durable Objects, Deno edge functions, Python FastAPI, REST API design, file processing pipelines |
| **Database** | PostgreSQL schema design, Row Level Security policies, migrations, multi-tenant data modeling |
| **CAD/Manufacturing** | STEP file parsing, sheet metal unfolding, DXF/PDF generation, 2D nesting algorithms, 3D mesh visualization |
| **AI Integration** | Claude and Gemini through an AI gateway, structured outputs, human-in-the-loop approvals, rate-limit handling |
| **DevOps** | Cloudflare Workers and Containers, zone and DNS migration, GitHub Actions, parity-gated cutover |
| **SEO** | Prerendering 210+ routes, edge SEO rendering, hreflang implementation, structured data, XML sitemaps, IndexNow submission |
| **Business** | Solo founding a B2B SaaS, competitor analysis (Xometry, Protolabs), go-to-market in European manufacturing |

---

## Code Tour

For reviewers short on time, these files best illustrate the systems thinking across the platform:

- **`lib/nesting/index.js`** — End-to-end 2D nesting pipeline: material grouping, bin-packing, and utilization-driven sheet allocation with density-weighted cost calculation.
- **`sheet-metal-service/main.py`** — FastAPI entry for the Python CAD service; STEP → DXF / PDF / SVG unfolding via OpenCascade and CadQuery.
- **`workers/site/src/index.ts`** — the edge router: redirect table, sitemaps, `/api/*`, SEO rendering and static assets in one ordered path.
- **`workers/site/src/seo/handler.ts`** — SEO body injection for crawlers without breaking React hydration; language-aware metadata and schema markup across 10+ route types.
- **`supabase/migrations/20260407_create_multi_tenant_system.sql`** — Registry-based tenant + capability model with RLS policies enforcing isolation at the data layer, not the application layer.
- **`src/components/ThreeDViewerModal.tsx`** — Multi-format 3D loader (STL / OBJ / GLB / GLTF) with render-mode toggles and PBR material tuning for CAD-like studio lighting.

---

## Roadmap & Known Issues

- **Row-Level Security** — the access model per role and tenant is maintained as migrations with PGlite policy tests; plan in `docs/security/rls-remediation-plan.md`.
- **3D Viewer Tessellation Upgrade** — Improving STEP→GLB tessellation resolution to close the quality gap versus HOOPS-based competitors.
- **Test Coverage Expansion** — Expanding Playwright E2E and unit coverage.

---

## About the Developer

**Dimitris Vardalachakis** — Full-stack developer and founder based in Heraklion, Crete, Greece.

- Built entire platform solo: frontend, backend, infrastructure, CAD processing, AI pipelines, business operations
- **Stack**: React, TypeScript, Vite, Cloudflare Workers, Node.js, Python, Supabase/PostgreSQL, Three.js, FastAPI, Docker
- **Domain expertise**: Manufacturing technology, CAD/CAM, European B2B marketplaces
- **Languages**: Greek (native), English (fluent)

Contact: Available on request
Platform: [micronshub.eu](https://www.micronshub.eu)

---

## License

**Copyright 2024-2026 Dimitris Vardalachakis. All Rights Reserved.**

This source code is viewable for portfolio evaluation and recruitment review only. No copying, modification, distribution, or commercial use is permitted. See [LICENSE](./LICENSE) for full terms.
