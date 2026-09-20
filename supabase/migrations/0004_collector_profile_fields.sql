-- 0004_collector_profile_fields.sql
-- Adds business_name, business_address, and avatar_url to public.collectors table

alter table public.collectors
  add column if not exists business_name text default '',
  add column if not exists business_address text default '',
  add column if not exists avatar_url text default '';
