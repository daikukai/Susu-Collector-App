-- 0006_invite_codes_and_admin.sql
-- Create invite_codes table and super admin fields

-- 1. Add is_super_admin flag to collectors table
alter table public.collectors
  add column if not exists is_super_admin boolean default false;

-- 2. Create invite_codes table
create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null default 'single_use' check (kind in ('single_use', 'multi_use_demo')),
  status text not null default 'active' check (status in ('active', 'used', 'expired')),
  used_by_phone text default null,
  used_at timestamptz default null,
  created_at timestamptz not null default now()
);

-- Index for fast invite code lookup
create index if not exists invite_codes_code_idx on public.invite_codes(code);
create index if not exists invite_codes_status_idx on public.invite_codes(status);

-- Enable RLS on invite_codes
alter table public.invite_codes enable row level security;

-- RLS policies for invite_codes
create policy "Allow public to read active invite codes for validation"
  on public.invite_codes for select
  using (true);

create policy "Allow super admin full access to invite codes"
  on public.invite_codes for all
  using (
    auth.uid() in (
      select id from public.collectors where is_super_admin = true
    )
  );

-- Insert initial preset demo codes
insert into public.invite_codes (code, kind, status)
values 
  ('DEMO-2026', 'multi_use_demo', 'active'),
  ('SB-7890-MON', 'multi_use_demo', 'active'),
  ('WATERSIDE-USD-2026', 'multi_use_demo', 'active'),
  ('RED-LIGHT-2026', 'multi_use_demo', 'active')
on conflict (code) do nothing;
