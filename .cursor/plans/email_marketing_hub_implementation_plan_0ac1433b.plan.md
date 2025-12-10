---
name: Email Marketing Hub Implementation Plan
overview: |-
  Implement a comprehensive Email Marketing Hub within the dashboard, featuring subscriber management, campaign scheduling with a wizard interface, and an analytics dashboard. The implementation will include advanced features like Smart Sending suggestions, A/B testing capabilities for subject lines, and click heatmaps.

  This plan integrates with the existing Resend API configuration (using `info@micronshub.eu`) for email delivery, leveraging the infrastructure already in place for contact forms and RFQ notifications.
todos:
  - id: db-migration
    content: Create Supabase migration for marketing tables (subscribers, campaigns, analytics)
    status: completed
  - id: routes-setup
    content: Update PersistentDashboardLayout and Routes to include Email Marketing page
    status: completed
  - id: page-shell
    content: Create EmailMarketing page shell and main tabs/navigation
    status: completed
    dependencies:
      - routes-setup
  - id: subscriber-mgmt
    content: Implement Subscriber Management (Table + CSV Import)
    status: completed
    dependencies:
      - db-migration
      - page-shell
  - id: campaign-wizard
    content: Implement Campaign Wizard (Wizard UI, Editor, A/B logic)
    status: completed
    dependencies:
      - page-shell
  - id: backend-sending
    content: Create Supabase Edge Function 'send-campaign' using Resend API (info@micronshub.eu)
    status: completed
    dependencies:
      - campaign-wizard
  - id: analytics-dash
    content: Implement Analytics Dashboard (Charts, Heatmap)
    status: completed
    dependencies:
      - page-shell
---

# Email Marketing Hub Implementation Plan

## Overview

Create a new "Email Marketing" module within the Operations section of the dashboard. This module will serve as a central hub for managing email campaigns, subscribers, and analyzing performance metrics.

**Key Integration Point**: The system will utilize the existing **Resend API** integration (currently used for transactional emails like contact forms and RFQs). All marketing emails will be sent from `info@micronshub.eu` using the configured Resend API key in Vercel.

## Core Features

1.  **Subscriber Management**:

    -   High-performance data table for viewing subscribers.
    -   CSV/Excel import functionality.
    -   Columns: Name, Email, Tags, Status (Active/Unsubscribed).
    -   Tag management.

2.  **Campaign Scheduler**:

    -   Wizard-style interface for creating campaigns.
    -   Step 1: Campaign Details (Name, Subject lines for A/B testing).
    -   Step 2: Audience Selection (Filter by tags/status).
    -   Step 3: Content Editor (Rich text editor for body).
    -   Step 4: Scheduling (Date/time picker, Smart Sending toggle).
    -   **Backend Integration**: Uses Supabase Edge Functions or a dedicated Next.js API route to trigger Resend batch sending.

3.  **Analytics Dashboard**:

    -   Key metrics cards: Total Sent, Open Rate, CTR, Bounce Rate.
    -   Charts: Performance over time (Line chart), Engagement breakdown (Pie/Bar chart).
    -   Heatmap visualization for click tracking (simulated/mock for initial version, can leverage Resend webhooks for real data later).

## Advanced Features

-   **Smart Sending**: UI toggle to "Optimize Send Time" based on user data (mock logic initially).
-   **A/B Testing**: Input fields for "Subject A" and "Subject B" with a distribution slider (e.g., Test 20%, Send Winner to 80%).
-   **Heatmaps**: Visual overlay on email preview showing click density.

## Technical Architecture

### Database Schema (Supabase)

-   `marketing_subscribers`: `id`, `email`, `name`, `tags` (jsonb), `status`, `created_at`.
-   `marketing_campaigns`: `id`, `name`, `subject_a`, `subject_b`, `body`, `scheduled_at`, `status` (draft/scheduled/sent), `ab_test_config` (jsonb), `sent_count`.
-   `marketing_analytics`: `id`, `campaign_id`, `opens`, `clicks`, `bounces`, `heatmap_data` (jsonb).

### Backend / Email Delivery

-   **Service**: Resend (via existing setup).
-   **Sender**: `info@micronshub.eu`.
-   **Integration**:
    -   Reuse existing `resend` client initialization if available, or ensure new module uses `RESEND_API_KEY` from environment.
    -   Create a Supabase Edge Function `send-campaign` (or similar) to handle batch sending to avoid timeout issues on the frontend.
    -   Implement webhook handler (optional/future) to capture Open/Click events from Resend and update `marketing_analytics`.

### Frontend Components

-   **Page**: `src/pages/dashboard/EmailMarketing.tsx`
-   **Components**:
    -   `SubscribersTable.tsx`: TanStack Table with virtualization for performance.
    -   `CampaignWizard.tsx`: Multi-step form using `react-hook-form` and `zod`.
    -   `AnalyticsCharts.tsx`: Recharts visualizations.
    -   `EmailHeatmap.tsx`: Custom component for click visualization.

### Routes

-   `/dashboard/email-marketing`: Main dashboard/overview.
-   `/dashboard/email-marketing/subscribers`: Subscriber list & import.
-   `/dashboard/email-marketing/campaigns/new`: Campaign creation wizard.
-   `/dashboard/email-marketing/campaigns/:id`: Campaign details & analytics.

## Implementation Steps

1.  **Setup & Routing**:

    -   Create new route `/dashboard/email-marketing`.
    -   Update `PersistentDashboardLayout` to include "Email Marketing" in Operations.

2.  **Database & Types**:

    -   Create Supabase migration for new tables.
    -   Generate TypeScript interfaces.

3.  **Subscriber Management**:

    -   Implement `SubscribersTable` with dummy data first, then connect to Supabase.
    -   Add CSV import handler (using `papaparse` or similar).

4.  **Campaign Wizard & Sending Logic**:

    -   Build the multi-step wizard UI.
    -   Integrate rich text editor.
    -   **Critical**: Implement the sending logic using the Resend API (`info@micronshub.eu`).
    -   Create an Edge Function (or API route) to handle the actual broadcast to subscribers.

5.  **Analytics & Visualization**:

    -   Build charts for campaign stats.
    -   Create the Email Heatmap component.

6.  **Integration**:

    -   Connect all parts to Supabase.
    -   Ensure responsive design and error handling.