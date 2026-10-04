-- Removes every row of tests/e2e/api/seed.sql and the rows the e2e run wrote for them. Run after the Phase 2 gate
-- (and after each preview run when the seed is not needed again). Then delete the three test users in Supabase
-- Auth. Objects the run uploaded to R2 are deleted by the tests themselves; nothing here touches storage.

begin;

-- Tracking: events of the e2e subscribers and campaigns (sent, opened, clicked, unsubscribed), then the rows.
delete from public.marketing_events
where subscriber_id in (select id from public.marketing_subscribers where id::text like 'e2e00000-%')
   or campaign_id in (select id from public.marketing_campaigns where id::text like 'e2e00000-%');
delete from public.marketing_analytics where campaign_id in (select id from public.marketing_campaigns where id::text like 'e2e00000-%');
delete from public.marketing_subscribers where id::text like 'e2e00000-%';
delete from public.marketing_campaigns where id::text like 'e2e00000-%';

-- Inventory.
delete from public.stock_transactions where stock_item_id in (select id from public.stock_items where id::text like 'e2e00000-%');
delete from public.stock_items where id::text like 'e2e00000-%';
delete from public.materials where id::text like 'e2e00000-%';

-- RFQs, file rows and customers (file rows first: rfq_files.rfq_id references rfqs).
delete from public.rfq_files where rfq_id in (select id from public.rfqs where id::text like 'e2e00000-%');
delete from public.rfqs where id::text like 'e2e00000-%';
delete from public.customers where id::text like 'e2e00000-%';

-- Roles of the test users (the users themselves are deleted in the dashboard).
delete from public.user_roles
where user_id in (
  select id from auth.users
  where lower(email) in ('delivered+e2e-staff@resend.dev', 'delivered+e2e-admin@resend.dev', 'delivered+e2e-customer@resend.dev')
);

commit;
