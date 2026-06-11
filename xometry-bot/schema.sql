-- xometry_offers: review queue for the auto-counteroffer pipeline (§3).
-- Upsert key is `code` (the HJO-... PO number). `submitted`/`skipped` are terminal:
-- the worker's upsert refreshes price/expiry on re-scan but never touches terminal rows.
-- `submitting` is a transient claim status so a double-click can never submit twice.

create table if not exists xometry_offers (
  id              bigint generated always as identity primary key,
  code            text unique not null,          -- offer.code "HJO-..."  (dedupe key)
  offer_id        text not null,                 -- numeric offer id for the detail/counteroffer URL
  is_urgent       boolean default false,
  exclusive       boolean,                       -- non-exclusive = race; TODO(confirm) field
  -- job spec
  process_type    text,
  material        text,
  quantity        integer,
  dimensions      text,
  weight_kg       numeric,
  volume_mm3      numeric,
  tags            text[],                        -- all tag names (context-prefixed)
  tolerance       text,                          -- e.g. "ISO 2768 medium" / "± 0.5 mm" (§1C)
  roughness       text,                          -- e.g. "Ra: 3.2" (§1C)
  finish          text,                          -- finish field; "" = none
  threads_present boolean,                       -- read back from buyer quote "Threads and tapped holes: N"
  inspection_needed boolean,                     -- measurementProtocolNeeded
  excluded_reason text,                          -- which secondary op caused exclusion (if any)
  part_files      jsonb,                         -- [{name,downloadUrl}]
  local_files     jsonb,                         -- downloaded paths
  production_remark text,
  -- prices
  partner_cost     numeric,                      -- offer.cost  (Xometry's lowball to you)
  allow_counter_from numeric,                    -- offer.allowCounterofferFrom (floor)
  buyer_price      numeric,                      -- read from instant quote "Order Value excl. VAT"
  buyer_quote_id   text,                         -- get.xometry.eu quote E-... for audit
  suggested_price  numeric,                      -- max(buyer_price*0.80, cost*(1+margin))
  -- timing
  xo_leadtime      date,                         -- offer.leadtime (Xometry required)
  publication_end  timestamptz,                  -- expiry -> sort
  suggested_leadtime date,                       -- max(xo_leadtime, today+10 business days)
  -- workflow
  status          text not null default 'new'
                  check (status in ('new','priced','ready','needs_manual','needs_review',
                                    'excluded_secondary_ops','submitting','submitted','skipped','error')),
  flags           text[],
  raw             jsonb,                          -- full offer json for audit
  -- submit audit trail (§6C: timestamp + screenshot per counteroffer)
  final_price     numeric,
  final_leadtime  date,
  submitted_at    timestamptz,
  submit_screenshot text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists xometry_offers_status_idx on xometry_offers (status);
create index if not exists xometry_offers_publication_end_idx on xometry_offers (publication_end);

-- Deny-by-default: worker + review API use the direct Postgres connection and the
-- dashboard reads server-side with the service-role key, both of which bypass RLS.
-- No policies on purpose - the anon key must never see this table.
alter table xometry_offers enable row level security;
