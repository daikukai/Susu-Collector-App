-- 0003_auth_trigger.sql
-- Onboarding flow: profile creation is explicitly handled during the Onboarding screen
-- by calling createCollector(userId, name) after user registration.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Profile creation is deferred to the Onboarding step in the app
  return new;
end;
$$;
