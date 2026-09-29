-- 0017_fix_auth_user_signup_trigger.sql
-- Fix database error (HTTP 500) during Supabase auth user signup

-- 1. Create robust, exception-safe handle_new_user trigger function
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Collector profile creation is handled explicitly on the client side
  -- via createCollector() during registration / onboarding.
  -- Returning NEW inside exception block ensures auth user creation in auth.users
  -- will NEVER fail with HTTP 500 due to trigger exceptions.
  return new;
exception
  when others then
    return new;
end;
$$;

-- 2. Grant permissions on handle_new_user
grant execute on function public.handle_new_user() to anon, authenticated, service_role;

-- 3. Safely re-bind on_auth_user_created trigger on auth.users
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created'
  ) then
    drop trigger if exists on_auth_user_created on auth.users;
  end if;
exception
  when others then null;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
