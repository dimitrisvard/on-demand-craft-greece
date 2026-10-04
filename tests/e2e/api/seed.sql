-- Seed rows for tests/e2e/api.spec.ts (preview and compare modes).
--
-- | Step | Who | What |
-- |---|---|---|
-- | 1 | owner | Create three Supabase Auth users with the e-mail addresses below (password sign-in; the addresses are Resend test sinks) and, optionally, the admin user |
-- | 2 | owner | Review this file against the live schema, then run it in the SQL editor (it is idempotent: it can run again) |
-- | 3 | owner | Before every preview run: run the RESET block at the end (first-hit tracking events, the fresh RFQ) |
-- | 4 | owner | Put the ids below and the users' passwords into the fixtures JSON outside git (shape: fixtures.example.json) |
-- | 5 | owner | After the Phase 2 gate: run cleanup.sql and delete the test users |
--
-- Every id starts with e2e00000-; RFQ numbers use the date 01011970, which no real RFQ carries.
-- Test users: delivered+e2e-staff@resend.dev (role sales_rep), delivered+e2e-customer@resend.dev (role customer),
-- optional delivered+e2e-admin@resend.dev (role admin).

begin;

-- ---- roles of the test users ---------------------------------------------------------------------------------
insert into public.user_roles (user_id, role)
select u.id, r.role::public.app_role
from auth.users u
join (values ('delivered+e2e-staff@resend.dev', 'sales_rep'),
             ('delivered+e2e-admin@resend.dev', 'admin'),
             ('delivered+e2e-customer@resend.dev', 'customer')) as r(email, role)
  on lower(u.email) = r.email
where not exists (select 1 from public.user_roles x where x.user_id = u.id and x.role = r.role::public.app_role);

-- ---- customers, RFQs and file rows ---------------------------------------------------------------------------
insert into public.customers (id, email, company_name, contact_name, user_id)
select 'e2e00000-0000-4000-8000-00000000c001', 'delivered+e2e-customer@resend.dev', 'E2E Test Customer A', 'E2E A',
       (select id from auth.users where lower(email) = 'delivered+e2e-customer@resend.dev')
on conflict do nothing;

insert into public.customers (id, email, company_name, contact_name)
values ('e2e00000-0000-4000-8000-00000000c002', 'delivered+e2e-other@resend.dev', 'E2E Test Customer B', 'E2E B')
on conflict do nothing;

insert into public.rfqs (id, rfq_number, customer_id, company_name, contact_email, title, created_at)
values
  ('e2e00000-0000-4000-8000-0000000a0001', 'RFQ-01011970-90001', 'e2e00000-0000-4000-8000-00000000c001', 'E2E Test Customer A', 'delivered+e2e-customer@resend.dev', 'E2E RFQ (customer A)', '2020-01-01T00:00:00Z'),
  ('e2e00000-0000-4000-8000-0000000a0002', 'RFQ-01011970-90002', 'e2e00000-0000-4000-8000-00000000c002', 'E2E Test Customer B', 'delivered+e2e-other@resend.dev', 'E2E RFQ (customer B)', '2020-01-01T00:00:00Z'),
  ('e2e00000-0000-4000-8000-0000000a0003', 'RFQ-01011970-90003', null, 'E2E Anonymous', null, 'E2E RFQ (fresh, anonymous upload)', '2020-01-01T00:00:00Z')
on conflict do nothing;

insert into public.rfq_files (id, rfq_id, file_name, file_path, file_size, file_type)
values
  ('e2e00000-0000-4000-8000-0000000f0001', 'e2e00000-0000-4000-8000-0000000a0001', 'own.step', 'RFQ-01011970-90001/e2e/own.step', 3, 'application/octet-stream'),
  ('e2e00000-0000-4000-8000-0000000f0002', 'e2e00000-0000-4000-8000-0000000a0002', 'other.step', 'RFQ-01011970-90002/e2e/other.step', 3, 'application/octet-stream')
on conflict do nothing;

-- ---- inventory: one material and one stock item (label PDF, QR scan) -----------------------------------------
insert into public.materials (id, name, category, base_unit, thickness_mm, notes)
values ('e2e00000-0000-4000-8000-0000000d0001', 'E2E Test Sheet', 'sheet_metal', 'm2', 2, 'e2e test row')
on conflict do nothing;

insert into public.stock_items (id, material_id, qr_code, width_mm, height_mm, total_area_mm2, remaining_area_mm2, location, notes)
values ('e2e00000-0000-4000-8000-0000000b0001', 'e2e00000-0000-4000-8000-0000000d0001', 'E2E-QR-0001', 1000, 500, 500000, 500000, 'E2E', 'e2e test row')
on conflict do nothing;

-- ---- marketing: three tracking sets (preview run, compare on the Worker, compare on Vercel) -------------------
-- Campaigns stay 'cancelled' and subscribers 'unsubscribed', so no real campaign ever mails them; the tracking
-- handler reads neither status. The campaign body links the click target host (e2e.example.org).
insert into public.marketing_campaigns (id, name, subject_a, body, status)
select ('e2e00000-0000-4000-8000-0000000c00' || s.code)::uuid, 'E2E tracking ' || s.label, 'E2E tracking ' || s.label,
       '<p><a href="https://e2e.example.org/landing">E2E link</a></p>', 'cancelled'
from (values ('01', 'preview'), ('02', 'compare worker'), ('03', 'compare vercel')) as s(code, label)
on conflict do nothing;

-- Cases per set: 01 open first, 02 open repeat, 03 click first, 04 click repeat, 05 unsubscribe first,
-- 06 unsubscribe repeat. One subscriber per case, because a first hit depends on the subscriber's events.
insert into public.marketing_subscribers (id, email, name, status, tags)
select ('e2e00000-0000-4000-8000-00000005' || s.code || c.code)::uuid,
       'delivered+e2e-trk-' || s.code || '-' || c.code || '@resend.dev', 'E2E tracking', 'unsubscribed', '["e2e"]'::jsonb
from (values ('01'), ('02'), ('03')) as s(code)
cross join (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06')) as c(code)
on conflict do nothing;

insert into public.marketing_events (id, campaign_id, subscriber_id, event_type, metadata)
select ('e2e00000-0000-4000-8000-0000000e' || s.code || c.code)::uuid,
       ('e2e00000-0000-4000-8000-0000000c00' || s.code)::uuid,
       ('e2e00000-0000-4000-8000-00000005' || s.code || c.code)::uuid,
       'sent', '{"e2e": true}'::jsonb
from (values ('01'), ('02'), ('03')) as s(code)
cross join (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06')) as c(code)
on conflict do nothing;

commit;

-- ---- RESET (run before every preview or compare run) --------------------------------------------------------
-- Removes the events the tracking links wrote (so first hits are first hits again), keeps the subscribers out of
-- real sends, and makes RFQ-01011970-90003 fresh for the anonymous-upload test (valid for 30 minutes).
begin;
delete from public.marketing_events
where subscriber_id in (select id from public.marketing_subscribers where id::text like 'e2e00000-%')
  and event_type <> 'sent';
update public.marketing_subscribers set status = 'unsubscribed' where id::text like 'e2e00000-%';
update public.rfqs set created_at = now() where id = 'e2e00000-0000-4000-8000-0000000a0003';
commit;
