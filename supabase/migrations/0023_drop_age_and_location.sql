-- 0023_drop_age_and_location.sql
-- Remove age and location columns from collectors (and members/standalone tables if created)

-- 1. Drop age and location columns from collectors table
alter table public.collectors drop column if exists age cascade;
alter table public.collectors drop column if exists location cascade;

-- 2. Drop age and location columns from members table if added there
alter table public.members drop column if exists age cascade;
alter table public.members drop column if exists location cascade;

-- 3. Drop location/locations table if created as a separate table
drop table if exists public.location cascade;
drop table if exists public.locations cascade;
