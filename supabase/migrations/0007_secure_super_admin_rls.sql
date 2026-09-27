-- 0007_secure_super_admin_rls.sql
-- Fix RLS policy infinite recursion (42P17) and enforce Super Admin column security on INSERT & UPDATE

-- 1. Helper Security Definer Function (bypasses RLS to prevent 42P17 infinite recursion)
create or replace function public.is_super_admin(user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (select is_super_admin from public.collectors where id = user_id limit 1),
    false
  );
$$;

-- 2. Trigger Function to block unauthorized self-promotion on INSERT and UPDATE
create or replace function public.protect_super_admin_column()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Block non-admins from inserting rows with is_super_admin = true
  if (TG_OP = 'INSERT') then
    if (NEW.is_super_admin is true) then
      if (auth.uid() is not null and not public.is_super_admin(auth.uid())) then
        raise exception 'Unauthorized: New accounts cannot self-assign super admin privileges.';
      end if;
    end if;
  end if;

  -- Block non-admins from modifying is_super_admin on existing rows
  if (TG_OP = 'UPDATE') then
    if (NEW.is_super_admin is distinct from OLD.is_super_admin) then
      if (auth.uid() is not null and not public.is_super_admin(auth.uid())) then
        raise exception 'Unauthorized: Only existing Super Admins can modify super admin privileges.';
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

-- Attach trigger to collectors table for both BEFORE INSERT and BEFORE UPDATE
drop trigger if exists protect_super_admin_trigger on public.collectors;
create trigger protect_super_admin_trigger
  before insert or update on public.collectors
  for each row
  execute function public.protect_super_admin_column();

-- 3. Recursion-Free RLS Policies for collectors table
drop policy if exists collectors_self on public.collectors;
drop policy if exists collectors_select on public.collectors;
drop policy if exists collectors_insert on public.collectors;
drop policy if exists collectors_update on public.collectors;
drop policy if exists collectors_delete on public.collectors;

create policy collectors_select on public.collectors
  for select
  using (
    id = auth.uid() 
    or public.is_super_admin(auth.uid())
  );

-- Enforce that INSERT requires is_super_admin to be false unless inserted by an existing super admin
create policy collectors_insert on public.collectors
  for insert
  with check (
    id = auth.uid()
    and (
      coalesce(is_super_admin, false) = false
      or public.is_super_admin(auth.uid())
    )
  );

create policy collectors_update on public.collectors
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (
      is_super_admin is not true
      or public.is_super_admin(auth.uid())
    )
  );

create policy collectors_delete on public.collectors
  for delete
  using (
    id = auth.uid() 
    or public.is_super_admin(auth.uid())
  );
