-- 0018_allow_reclaim_invite_code_same_phone.sql
-- Allow a user with the same phone number to reclaim an invite code if signup is retried

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

  -- Allow reclaim if the code was already redeemed by this SAME phone number
  if found_code.status = 'used' and found_code.kind = 'single_use' then
    if norm_phone is not null and public.normalize_phone(found_code.used_by_phone) = norm_phone then
      return json_build_object(
        'success', true, 
        'message', 'Access key verified for your registered phone number.',
        'code_id', found_code.id,
        'kind', found_code.kind
      );
    end if;
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

grant execute on function public.redeem_invite_code(text, text) to anon, authenticated, service_role;
