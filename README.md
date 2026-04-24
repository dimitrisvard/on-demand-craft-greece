# Microns Hub — European On-Demand Manufacturing Platform

[![Live Site](https://img.shields.io/badge/Live-micronshub.eu-blue?style=for-the-badge&logo=vercel)](https://www.micronshub.eu)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000?style=flat-square&logo=vercel)](https://vercel.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](#license)

> A production manufacturing marketplace connecting European engineers with vetted machine shops — competing directly with Xometry, Protolabs, and Sculpteo. **This is a live, revenue-generating business, not a tutorial project.**

---

## Overview

**Microns Hub** is a full-stack manufacturing-as-a-service platform that automates quoting, CAD processing, order management, and multilingual content distribution for on-demand manufacturing across Europe.

- Built from scratch as **solo founder and developer**
- Serves real customers with CNC machining, sheet metal, 3D printing, and injection molding
- Handles the full lifecycle: CAD upload → instant quoting → order tracking → delivery
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
| **Auth** | Supabase Auth (customers + partners with role-based access) |
| **File Storage** | AWS S3 (presigned URL uploads) + Supabase Storage |
| **Backend** | 28+ Supabase Edge Functions (Deno) + 12+ Vercel Serverless Functions (Node.js) |
| **Sheet Metal Service** | FastAPI (Python) microservice with Docker — STEP → DXF/PDF/SVG pipeline |
| **CAD Processing** | OpenCascade (occt-import-js) for STEP parsing, CadQuery for unfolding |
| **3D Viewer** | Three.js + React Three Fiber + Drei (STEP → GLB browser rendering) |
| **2D Nesting** | Custom nesting engine (DXF import → bin-packing → SVG/DXF export with QR tracking) |
| **i18n** | i18next + react-i18next (14 languages, SSR-rendered for SEO) |
| **Email** | Resend (transactional + marketing campaigns with A/B testing and tracking) |
| **AI Content** | Claude (article generation) + Gemini (multi-language translation) |
| **SEO** | Prerendered routes (210+ URLs), hreflang, structured data, XML sitemaps, IndexNow |
| **Deployment** | Vercel (frontend + serverless API) + Docker (sheet metal service) |
| **Monitoring** | Vercel Analytics |

---

## Key Features

### For Customers (B2B Engineers & Procurement)
- **Instant Quoting Engine** — upload STEP/STL, get automated pricing with DFM analysis
- **Multi-Service Manufacturing** — CNC milling & turning, sheet metal fabrication, 3D printing (SLS/FDM/SLA), injection molding, surface finishing
- **3D CAD Viewer** — Three.js browser viewer with STEP → GLB rendering pipeline
- **Order Tracking Dashboard** — real-time status updates for all orders and RFQs
- **Pan-European Delivery** — vetted manufacturer network across Europe (4–9 working days)

### For Manufacturing Partners
- **Partner Dashboard** — dedicated interface with role-based authentication (`partner_seller`)
- **RFQ Management** — receive qualified leads, manage jobs, update production status
- **Credential Management** — partner onboarding and secure password management

### Platform Architecture
- **Multi-Tenant System** — Supabase RLS with `tenant_id`, white-label SaaS ready
- **Subdomain Routing** — per-tenant branded subdomains with capability toggles and custom landing pages
- **Multilingual SEO Engine** — 14 languages, prerendered routes, hreflang tags, language-aware sitemaps
- **Sheet Metal Unfolding Pipeline** — Python FastAPI service using OpenCascade/CadQuery, DXF export, PDF drawing generation
- **2D Nesting Engine** — bin-packing optimization for sheet metal parts with SVG preview, DXF export, and QR-labeled remnant tracking

### Automation & Content
- **AI Article Generation** — daily SEO-optimized manufacturing articles via Claude, with silo structure and internal linking
- **Multi-Language Translation** — automated translation into 14 languages via Gemini with continuation loops, length-ratio checks, and table-aware processing
- **Social Media Distribution** — automated posting to Facebook and LinkedIn with AI-generated hashtags
- **Email Marketing** — campaigns with spintax personalization, open/click tracking, and unsubscribe management
- **Lead Generation** — Reddit monitor, EU procurement tender scanner, Europages scraper, Hacker News collector

### Technical Highlights
- **210+ prerendered routes** with structured data, dynamic meta tags, XML sitemaps, hreflang
- **Server-side STEP analysis** — geometry extraction and manufacturability checks
- **Rate-limit aware** AI pipelines with exponential backoff and retry logic
- **Real-time features** via Supabase Realtime subscriptions
- **PDF generation** — manufacturing quotes, RFQ confirmations, technical drawings

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Client (Browser)                        │
│   React 18 + Vite  │  Three.js 3D Viewer  │  Tailwind CSS   │
│   React Router v6  │  i18next (14 langs)  │  shadcn/ui      │
└────────────┬───────────────────────────────┬─────────────────┘
             │                               │
             ▼                               ▼
┌────────────────────────┐    ┌────────────────────────────────┐
│   Vercel Platform      │    │   FastAPI Microservice          │
│   ┌─ Vite SSG/Prerender│    │   (Python + Docker)             │
│   ├─ 12+ API Routes    │    │   ┌─ Sheet Metal Unfolder       │
│   └─ Serverless Fns    │    │   ├─ STEP → DXF/PDF/SVG        │
│      (Node.js)         │    │   ├─ DFM Analyzer               │
│                        │    │   └─ Flat Pattern Generator     │
└────────────┬───────────┘    └──────────────┬─────────────────┘
             │                               │
             ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│                        Supabase                              │
│   PostgreSQL  │  RLS (tenant_id)  │  Auth  │  Storage        │
│   28+ Edge Functions (Deno):                                 │
│   ├─ Article Generation (Claude AI)                          │
│   ├─ Translation Pipeline (Gemini AI)                        │
│   ├─ Sitemap Generation & IndexNow                           │
│   ├─ Email (Resend) & Social Media APIs                      │
│   ├─ Lead Gen (Reddit, Tenders, Europages)                   │
│   └─ Partner Management & Notifications                      │
└──────────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│                    External Services                         │
│   AWS S3  │  Resend  │  Facebook  │  LinkedIn  │  IndexNow   │
│   Claude API  │  Gemini API  │  Google Search Console        │
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
├── src/
│   ├── pages/            # 40+ pages (services, blog, dashboard, quote, RFQ, partner)
│   ├── components/       # Shared UI (shadcn/ui, forms, 3D viewer, dashboards)
│   ├── utils/            # Business logic (pricing, materials, email, PDF, storage)
│   ├── hooks/            # Custom React hooks
│   ├── contexts/         # Auth, tenant, language contexts
│   ├── locales/          # 14 language translation files
│   ├── types/            # TypeScript type definitions
│   └── i18n.ts           # i18next configuration
├── api/                  # 12+ Vercel serverless functions (Node.js)
├── supabase/
│   ├── functions/        # 28+ Edge Functions (Deno)
│   └── migrations/       # PostgreSQL schema migrations
├── sheet-metal-service/  # FastAPI Python microservice (Docker)
│   ├── core/             # OpenCascade/CadQuery unfolding logic
│   ├── drawing/          # Technical drawing generation
│   └── export/           # DXF/PDF/SVG export
├── lib/
│   └── nesting/          # 2D nesting engine (DXF parse, bin-pack, SVG/DXF export)
├── tests/                # Test suites (nesting, E2E, unit)
├── scripts/              # Utility scripts (FreeCAD, GSC, seeding)
└── docs/                 # Technical documentation
```

---

## Quality & Testing

### Automated Test Suites

- **Nesting Engine Integration Tests** (`tests/nest.test.js`) — 11 tests covering DXF parsing, area calculation, hole detection, material grouping, bin-packing, oversized part handling, SVG preview, and DXF export
- **Playwright E2E Tests** (`tests/e2e/`) — end-to-end tests against the live site covering homepage rendering across 14 languages, service page navigation, SEO meta tags, hreflang validation, and sitemap/robots.txt checks
- **Unit Tests** (`tests/unit/`) — Jest unit tests for utility functions including material density lookup, weight calculation, spintax parsing, and email template processing

### Manual Testing Practices

- Cross-browser testing (Chrome, Firefox, Safari, Edge) for all customer-facing flows
- Mobile responsiveness validation across breakpoints
- Multilingual content verification in all 14 languages
- CAD file upload testing with various STEP/STL/DXF formats and edge cases
- API endpoint testing for quoting, RFQ submission, and CAD processing pipelines
- Supabase RLS policy testing for multi-tenant data isolation
- Partner dashboard role-based access verification

### QA Methodology

- Error boundary implementation for graceful failure handling
- Rate-limit aware retry logic with exponential backoff for external API calls
- File upload validation (format, size, geometry checks) before processing
- Translation pipeline quality checks (length-ratio, truncation detection, table preservation)

---

## What I Built & What I Learned

| Domain | Skills Demonstrated |
|---|---|
| **Frontend** | React 18, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, Three.js 3D rendering, i18next multilingual, responsive design |
| **Backend** | Node.js serverless functions, Deno edge functions, Python FastAPI, REST API design, file processing pipelines |
| **Database** | PostgreSQL schema design, Row Level Security policies, migrations, multi-tenant data modeling |
| **CAD/Manufacturing** | STEP file parsing, sheet metal unfolding, DXF/PDF generation, 2D nesting algorithms, 3D mesh visualization |
| **AI Integration** | Claude API (content generation), Gemini API (translation), prompt engineering, rate-limit handling, continuation loops |
| **DevOps** | Vercel deployment, Docker containers, GitHub Actions CI/CD, environment management |
| **SEO** | Prerendering 210+ routes, hreflang implementation, structured data, XML sitemaps, IndexNow submission |
| **Business** | Solo founding a B2B SaaS, competitor analysis (Xometry, Protolabs), go-to-market in European manufacturing |

---

## Code Tour

For reviewers short on time, these files best illustrate the systems thinking across the platform:

- **`lib/nesting/index.js`** — End-to-end 2D nesting pipeline: material grouping, bin-packing, and utilization-driven sheet allocation with density-weighted cost calculation.
- **`sheet-metal-service/main.py`** — FastAPI entry for the Python CAD microservice; STEP → DXF / PDF / SVG unfolding via OpenCascade and CadQuery.
- **`supabase/functions/extract-flat-pattern/index.ts`** — Polymorphic file-type dispatch (native STL mesh edge-detection, STEP delegation to the unfold service) with graceful error surfacing.
- **`supabase/migrations/20260407_create_multi_tenant_system.sql`** — Registry-based tenant + capability model with RLS policies enforcing isolation at the data layer, not the application layer.
- **`middleware.ts`** — SEO body injection for crawlers without breaking React hydration; language-aware metadata and schema markup unified across 10+ route types.
- **`src/components/ThreeDViewerModal.tsx`** — Multi-format 3D loader (STL / OBJ / GLB / GLTF) with render-mode toggles and PBR material tuning for CAD-like studio lighting.

---

## Roadmap & Known Issues

Active engineering initiatives, tracked transparently:

- **Row-Level Security Hardening** — Migration drafted for additional production tables; pending audit of anon vs. service role key usage across the Next.js codebase before rollout. See `docs/security/rls-remediation-plan.md`.
- **Server-Side Rendering Migration** — Migrating from Vite prerender to full SSR for improved indexation across the 14-language content corpus.
- **3D Viewer Tessellation Upgrade** — Improving STEP→GLB tessellation resolution to close the quality gap versus HOOPS-based competitors.
- **Test Coverage Expansion** — Expanding Playwright E2E and Jest unit coverage, with CI gating planned.

---

## About the Developer

**Dimitris Vardalachakis** — Full-stack developer and founder based in Heraklion, Crete, Greece.

- Built entire platform solo: frontend, backend, infrastructure, CAD processing, AI pipelines, business operations
- **Stack**: React, TypeScript, Vite, Node.js, Python, Supabase/PostgreSQL, Vercel, Three.js, FastAPI, Docker
- **Domain expertise**: Manufacturing technology, CAD/CAM, European B2B marketplaces
- **Languages**: Greek (native), English (fluent)

Contact: Available on request
Platform: [micronshub.eu](https://www.micronshub.eu)

---

## License

**Copyright 2024-2026 Dimitris Vardalachakis. All Rights Reserved.**

This source code is viewable for portfolio evaluation and recruitment review only. No copying, modification, distribution, or commercial use is permitted. See [LICENSE](./LICENSE) for full terms.
