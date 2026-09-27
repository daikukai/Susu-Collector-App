-- 0008_financial_integrity_and_invite_gate.sql
-- Server-Side Access Key Redemption RPC & Financial Ledger Idempotency

-- 1. Atomic Invite Code Redemption Function
create or replace function public.redeem_invite_code(target_code text, user_phone text default null)
returns json
language plpgsql
security definer
as $$
declare
  found_code record;
begin
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
        used_by_phone = coalesce(user_phone, used_by_phone),
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

-- 2. Financial Ledger Idempotency & Tenant Boundary Rules
alter table public.transactions
  add column if not exists idempotency_key text;

-- Create unique index on idempotency_key to prevent duplicate transactions
create unique index if not exists transactions_idempotency_key_idx 
  on public.transactions(idempotency_key) 
  where idempotency_key is not null;

-- Trigger to verify cross-tenant integrity for transactions
create or replace function public.verify_transaction_tenant_integrity()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Ensure targeted group belongs to the authenticated collector
  if not exists (
    select 1 from public.groups
    where id = NEW.group_id and collector_id = auth.uid()
  ) and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Target group does not belong to collector.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists verify_tx_tenant_trigger on public.transactions;
create trigger verify_tx_tenant_trigger
  before insert or update on public.transactions
  for each row
  execute function public.verify_transaction_tenant_integrity();
