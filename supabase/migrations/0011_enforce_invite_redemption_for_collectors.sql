-- 0011_enforce_invite_redemption_for_collectors.sql
-- Enforce server-side invitation verification for collector profile creation

-- 1. Helper function to normalize phone numbers consistently (PostgreSQL compatible)
create or replace function public.normalize_phone(raw_phone text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
begin
  if raw_phone is null or trim(raw_phone) = '' then
    return null;
  end if;
  cleaned := regexp_replace(raw_phone, '[^\d+]', '', 'g');
  if cleaned like '0%' then
    cleaned := '+231' || substring(cleaned from 2);
  elsif cleaned like '231%' then
    cleaned := '+' || cleaned;
  elsif cleaned not like '+%' then
    cleaned := '+231' || cleaned;
  end if;
  return cleaned;
end;
$$;

-- 2. Ensure phone column exists on collectors table
alter table public.collectors
  add column if not exists phone text;

create index if not exists collectors_phone_idx on public.collectors(phone);

-- 3. Update redeem_invite_code RPC to normalize user_phone
create or replace function public.redeem_invite_code(target_code text, user_phone text default null)
returns json
language plpgsql
security definer
as $$
declare
  found_code record;
  norm_phone text;
begin
  norm_phone := public.normalize_phone(user_phone);

  select * into found_code 
  from public.invite_codes 
  where upper(code) = upper(trim(target_code));

  if not found then
    return json_build_object('success', false, 'message', 'Invalid invitation access key.');
  end if;

  if found_code.status = 'used' and found_code.kind = 'single_use' then
    return json_build_object('success', false, 'message', 'This invitation access key has already been redeemed.');
  end if;

  if found_code.status = 'expired' then
    return json_build_object('success', false, 'message', 'This invitation access key has expired.');
  end if;

  -- Redeem single-use key atomically
  if found_code.kind = 'single_use' then
    update public.invite_codes
    set status = 'used',
        used_by_phone = coalesce(norm_phone, used_by_phone),
        used_at = now()
    where id = found_code.id;
  end if;

  return json_build_object(
    'success', true, 
    'message', 'Access key verified and redeemed successfully!',
    'code_id', found_code.id,
    'kind', found_code.kind
  );
end;
$$;

-- 4. Server-Side Trigger to block creation/updates of collector profiles without a redeemed invite key
create or replace function public.enforce_collector_invite_redemption()
returns trigger
language plpgsql
security definer
as $$
declare
  user_phone text;
  norm_phone text;
  auth_user_phone text;
begin
  -- Allow Super Admin bypass
  if (auth.uid() is not null and public.is_super_admin(auth.uid())) then
    return NEW;
  end if;

  -- Retrieve user phone from record or auth metadata
  select raw_user_meta_data->>'phone' into auth_user_phone
  from auth.users
  where id = NEW.id;

  user_phone := coalesce(NEW.phone, auth_user_phone);
  norm_phone := public.normalize_phone(user_phone);

  -- Allow designated Master Admin phone number bypass
  if norm_phone = '+231886884019' then
    return NEW;
  end if;

  if norm_phone is null then
    raise exception 'Access denied: Valid phone number is required to register a collector profile.';
  end if;

  -- Verify that this phone number has a redeemed single-use invite key in invite_codes
  if not exists (
    select 1 from public.invite_codes
    where public.normalize_phone(used_by_phone) = norm_phone
      and status = 'used'
  ) then
    raise exception 'Access denied: No verified invitation access key found for phone number %. Registration outside the invite workflow is strictly prohibited.', norm_phone;
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_collector_invite_trigger on public.collectors;
create trigger enforce_collector_invite_trigger
  before insert or update on public.collectors
  for each row
  execute function public.enforce_collector_invite_redemption();

-- 5. Tighten RLS policies on collectors table
drop policy if exists collectors_insert on public.collectors;
create policy collectors_insert on public.collectors
  for insert
  with check (
    id = auth.uid()
    and (
      coalesce(is_super_admin, false) = false
      or public.is_super_admin(auth.uid())
    )
    and (
      public.is_super_admin(auth.uid())
      or public.normalize_phone(coalesce(collectors.phone, (select raw_user_meta_data->>'phone' from auth.users where id = auth.uid()))) = '+231886884019'
      or exists (
        select 1 from public.invite_codes
        where public.normalize_phone(used_by_phone) = public.normalize_phone(coalesce(collectors.phone, (select raw_user_meta_data->>'phone' from auth.users where id = auth.uid())))
          and status = 'used'
      )
    )
  );

drop policy if exists collectors_select on public.collectors;
create policy collectors_select on public.collectors
  for select
  using (
    id = auth.uid()
    or public.is_super_admin(auth.uid())
  );
