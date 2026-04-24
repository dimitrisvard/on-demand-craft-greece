# Manual Supabase Tasks Checklist

Last updated: 2026-04-08

This document lists all manual tasks that need to be performed in the Supabase Dashboard or related services. These cannot be automated via code and must be done by hand.

---

## CRITICAL / Security

- [ ] **Rotate Exposed Service Role Key** (see `../security/rls-remediation-plan.md`)
  - Go to: Supabase Dashboard > Project Settings > API > Reset `service_role` key
  - After rotation, update:
    - Cron jobs in database with new key
    - Supabase Edge Functions > Secrets
    - CI/CD pipelines and local `.env` files

---

## Database Migrations

All SQL migrations in `supabase/migrations/` need to be run manually in the Supabase SQL Editor (Dashboard > SQL Editor > New query) since there is no CLI-based migration runner deployed.

### Migrations to run (in order):

1. `20240508_add_part_id_to_rfq_files.sql`
2. `20241201_add_email_unique_constraint.sql`
3. `20241201_allow_null_customer_id.sql`
4. `20241201_allow_null_customer_id_orders.sql`
5. `20241202_create_articles_table.sql`
6. `20241209_add_image_alt.sql`
7. `20241209_add_translation_id.sql`
8. `20250103_create_article_queue_system.sql`
9. `20250103_fix_exposed_service_role_key.sql`
10. `20250103_update_cron_jobs_for_queue.sql`
11. `20250104_make_contact_name_nullable.sql`
12. `20250106_create_email_marketing_schema.sql`
13. `20250107_add_timeout_to_auto_translate_cron.sql`
14. `20250107_identify_broken_tables.sql`
15. `20250111_email_marketing_enhancements.sql`
16. `20250115_create_user_emails_table.sql`
17. `20250120_create_autoblog_tables.sql`
18. `20250121_create_daily_article_cron_job.sql`
19. `20250130_auto_translate_and_sitemap_cron.sql`
20. `20250131_diagnose_article_creation.sql`
21. `20250201_add_social_media_tracking.sql`
22. `20260107_update_fix_links_schedule.sql`
23. `20260311_create_impressum_settings.sql`
24. `20260316_enhance_email_marketing.sql`
25. `20260321_create_lead_monitor.sql`
26. `20260322_create_company_directory_scanner.sql`
27. `20260322_create_funded_startup_scanner.sql`
28. `20260322_create_tender_monitor.sql`
29. `20260323_create_app_settings.sql`
30. `20260325_fix_table_schemas.sql`
31. `20260326_fix_lead_monitor_schema.sql`
32. `20260326_fix_leads_schema_and_policies.sql`
33. `20260327_fix_leads_schema_and_keywords.sql`
34. `20260328_user_roles_and_customer_registration.sql` - Creates user_roles table, customer_profiles, auto-role trigger
35. `20260330_add_fk_constraints.sql`
36. `20260330_add_po_number_and_order_enhancements.sql`
37. `20260401_create_inventory_system.sql`
38. `20260407_create_multi_tenant_system.sql` - Creates tenants, capabilities_registry, tenant_capabilities, quote_fields_registry, tenant_quote_fields, user_tenant_roles, tenant_pages tables + RLS policies + adds tenant_id to existing tables

### New migration needed (not yet created as a file):

- [ ] **Add `user_roles` entry for `tenant_admin` role** - The `user_roles` table from migration `20260328` uses enum values: `admin`, `sales_rep`, `production_manager`, `customer`, `supplier`, `accountant`, `partner_seller`. The `tenant_admin` role is tracked separately in `user_tenant_roles` table (from `20260407` migration), so no additional migration is needed for this.

---

## Edge Functions (Manual Deploy)

Deploy these edge functions via Supabase Dashboard (Edge Functions tab) or copy code from the deployment helpers:

- [ ] **Manufacturing PDF Generator** - Copy from `DEPLOY_index.md`
- [ ] **STEP/STP File Parser** - Copy from `DEPLOY_step-parser.md`
- [ ] **Verify all edge functions listed in `supabase/config.toml`** are deployed:
  - send-confirmation-email
  - send-notification-email
  - send-rfq-confirmation-email
  - generate-daily-article
  - reddit-collector
  - hn-collector
  - leads-api
  - telegram-leads-bot
  - generate-manufacturing-pdf
  - extract-flat-pattern
  - auto-translate-articles
  - auto-fix-article-links
  - auto-update-sitemap
  - enqueue-daily-article
  - social-media-post

---

## Environment Variables & Secrets

### Vercel Environment Variables
- [ ] `VITE_SUPABASE_URL` - Supabase project URL
- [ ] `VITE_SUPABASE_ANON_KEY` - Supabase anon/public key
- [ ] `RESEND_API_KEY` - For email sending (see `EMAIL_SETUP.md`)

### Supabase Edge Function Secrets
Set via: Supabase Dashboard > Edge Functions > Secrets

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (rotate after security fix!)
- [ ] `ANTHROPIC_API_KEY` - For Claude AI article generation
- [ ] `GEMINI_API_KEY` - For Gemini AI
- [ ] `RESEND_API_KEY` - For transactional emails
- [ ] `AWS_ACCESS_KEY_ID` - For S3 CAD file storage
- [ ] `AWS_SECRET_ACCESS_KEY` - For S3 CAD file storage
- [ ] `AWS_BUCKET_NAME` - S3 bucket name
- [ ] `AWS_REGION` - S3 region

### Social Media Secrets (see `SOCIAL_MEDIA_SETUP_CHECKLIST.md`)
- [ ] `FACEBOOK_PAGE_ID`
- [ ] `FACEBOOK_ACCESS_TOKEN` (expires every ~60 days)
- [ ] `LINKEDIN_ORG_ID`
- [ ] `LINKEDIN_ACCESS_TOKEN` (expires every ~60 days)

---

## DNS & Domain Setup

### Email (see `EMAIL_SETUP.md`)
- [ ] Add MX records for Resend domain verification
- [ ] Add SPF TXT record
- [ ] Add CNAME record for DKIM

### Tenant Subdomains
- [ ] Configure wildcard DNS `*.micronshub.eu` pointing to Vercel
- [ ] Or add individual subdomain entries for each tenant (e.g., `acme.micronshub.eu`)

---

## Cron Jobs (see `CRON_SCHEDULE_SUMMARY.md`)

Verify cron jobs are active in Supabase (Dashboard > Database > Extensions > pg_cron):

- [ ] `enqueue-daily-article` - 7:00 AM UTC daily
- [ ] `auto-translate-daily-articles` - 8:00 AM UTC daily
- [ ] `auto-fix-article-links` - 8:30 AM UTC daily
- [ ] `auto-update-sitemap` - 9:00 AM UTC daily

After rotating service role key, update the key in each cron job's HTTP headers.

---

## Multi-Tenant System Setup

After running the `20260407_create_multi_tenant_system.sql` migration:

- [ ] **Verify default tenant was created** - Run: `SELECT * FROM tenants WHERE slug = 'micronshub';`
- [ ] **Verify capabilities registry was seeded** - Run: `SELECT * FROM capabilities_registry ORDER BY sort_order;` (should show 7 capabilities)
- [ ] **Verify quote fields registry was seeded** - Run: `SELECT * FROM quote_fields_registry ORDER BY sort_order;` (should show 40+ fields)
- [ ] **Verify existing data was tagged** - Run: `SELECT COUNT(*) FROM customers WHERE tenant_id IS NOT NULL;` (should match total customer count)
- [ ] **Verify RLS policies** - Test that tenant admins can only see their own tenant's data
- [ ] **Create tenant admin accounts** - When creating new tenants via the dashboard, use the "Tenant Admin Account" section to assign email/password credentials

---

## MCP Server (Optional)

For Claude AI lead monitoring integration (see `mcp-server/README.md`):

- [ ] `npm install && npm run build` in `mcp-server/`
- [ ] Set: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`
- [ ] Configure Claude Desktop config to point to MCP server

---

## Verification Checklist

After completing all tasks above, verify:

- [ ] Login page works (email/password)
- [ ] Customer registration creates user + assigns 'customer' role
- [ ] Quote form submission works for logged-in users
- [ ] Quote form shows login prompt for non-logged-in users
- [ ] RFQ emails are sent (confirmation + notification)
- [ ] File uploads to S3 work
- [ ] Tenant subdomains resolve correctly
- [ ] Tenant admin can access dashboard (except Lead Monitor & Content)
- [ ] Cron jobs are running (check `cron.job_run_details`)
- [ ] Social media posting works (if configured)
