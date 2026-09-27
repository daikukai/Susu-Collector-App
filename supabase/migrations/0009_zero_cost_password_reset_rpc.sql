-- 0009_zero_cost_password_reset_rpc.sql
-- Zero-Cost Server-Side Password Reset Function for Supabase Auth

create extension if not exists pgcrypto;

create or replace function public.reset_user_password(target_phone text, new_plain_password text)
returns json
language plpgsql
security definer
as $$
declare
  clean_phone text;
  target_email text;
  target_user_id uuid;
begin
  -- Sanitize phone format (e.g. +231886884019 -> 231886884019)
  clean_phone := regexp_replace(target_phone, '[^\d]', '', 'g');
  if left(clean_phone, 1) = '0' then
    clean_phone := '231' || substring(clean_phone from 2);
  end if;
  if left(clean_phone, 3) != '231' then
    clean_phone := '231' || clean_phone;
  end if;

  target_email := 'collector' || clean_phone || '@susu.com';

  -- Locate user by generated email or phone metadata in auth.users
  select id into target_user_id 
  from auth.users 
  where lower(email) = lower(target_email)
     or raw_user_meta_data->>'phone' = '+' || clean_phone
     or raw_user_meta_data->>'phone' = target_phone
  limit 1;

  if target_user_id is null then
    return json_build_object('success', false, 'message', 'No account found matching this phone number.');
  end if;

  -- Update encrypted password using bcrypt in auth.users
  begin
    update auth.users
    set encrypted_password = extensions.crypt(new_plain_password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = target_user_id;
  exception when others then
    update auth.users
    set encrypted_password = crypt(new_plain_password, gen_salt('bf')),
        updated_at = now()
    where id = target_user_id;
  end;

  return json_build_object(
    'success', true, 
    'message', 'Password reset successfully! You can now log in.',
    'user_id', target_user_id
  );
exception when others then
  return json_build_object('success', false, 'message', SQLERRM);
end;
$$;
