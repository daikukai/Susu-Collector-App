-- 0010_secure_invite_codes_rls.sql
-- Enforce RLS on public.invite_codes to prevent public listing of access keys

-- 1. Enable RLS on invite_codes table
alter table public.invite_codes enable row level security;

-- 2. Drop any legacy open policies
drop policy if exists invite_codes_select on public.invite_codes;
drop policy if exists invite_codes_all on public.invite_codes;
drop policy if exists invite_codes_admin on public.invite_codes;

-- 3. Policy: ONLY Super Admins can SELECT (list/view) invite codes from PostgREST API
create policy invite_codes_admin_select on public.invite_codes
  for select
  using (public.is_super_admin(auth.uid()));

-- 4. Policy: ONLY Super Admins can INSERT, UPDATE, DELETE invite codes
create policy invite_codes_admin_all on public.invite_codes
  for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));
