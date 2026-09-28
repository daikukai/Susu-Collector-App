-- 0012_immutable_financial_ledger.sql
-- Server-Side Financial Writes & Immutable Audit Ledger

-- 1. Ensure SECURITY DEFINER on atomic server functions
create or replace function public.record_payment_transaction(
  p_group_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_date text,
  p_method text,
  p_note text,
  p_display_id text,
  p_collector_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_transaction record;
  v_sms_log record;
  v_result jsonb;
  v_idempotency_key text;
begin
  -- Validate caller authorization
  if p_collector_id != auth.uid() and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  v_idempotency_key := coalesce(
    case when p_display_id is not null and trim(p_display_id) != '' then 'tx-disp-' || p_display_id end,
    'tx-pmt-' || p_group_id || '-' || coalesce(p_member_id::text, 'collector') || '-' || p_date || '-' || p_amount
  );

  -- Idempotency check: if transaction already exists, return existing record
  select * into v_transaction from public.transactions
  where idempotency_key = v_idempotency_key;

  if found then
    return jsonb_build_object(
      'transaction', to_jsonb(v_transaction),
      'idempotent', true
    );
  end if;

  -- Insert transaction row
  insert into public.transactions (
    group_id,
    member_id,
    type,
    amount,
    date,
    timestamp,
    method,
    note,
    display_id,
    idempotency_key,
    collector_id
  ) values (
    p_group_id,
    p_member_id,
    'contribution',
    p_amount,
    p_date,
    now(),
    coalesce(p_method, 'Cash'),
    coalesce(p_note, 'Rapid roster'),
    p_display_id,
    v_idempotency_key,
    p_collector_id
  ) returning * into v_transaction;

  -- Insert matching receipt / SMS log atomically
  insert into public.sms_log (
    member_id,
    kind,
    status,
    timestamp,
    content,
    collector_id
  ) values (
    p_member_id,
    'Receipt',
    'Delivered',
    now(),
    'Payment receipt for ' || p_amount,
    p_collector_id
  ) returning * into v_sms_log;

  return jsonb_build_object(
    'transaction', to_jsonb(v_transaction),
    'sms_log', to_jsonb(v_sms_log),
    'idempotent', false
  );
end;
$$;

create or replace function public.record_correction_transaction(
  p_group_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_date text,
  p_method text,
  p_note text,
  p_supersedes uuid,
  p_original_amount numeric,
  p_collector_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_transaction record;
  v_result jsonb;
  v_idempotency_key text;
begin
  -- Validate caller authorization
  if p_collector_id != auth.uid() and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  v_idempotency_key := 'tx-corr-' || p_group_id || '-' || coalesce(p_member_id::text, 'collector') || '-' || p_supersedes || '-' || p_amount;

  -- Idempotency check
  select * into v_transaction from public.transactions
  where idempotency_key = v_idempotency_key;

  if found then
    return jsonb_build_object(
      'transaction', to_jsonb(v_transaction),
      'idempotent', true
    );
  end if;

  -- Insert append-only correction record
  insert into public.transactions (
    group_id,
    member_id,
    type,
    amount,
    date,
    timestamp,
    method,
    note,
    supersedes,
    original_amount,
    idempotency_key,
    collector_id
  ) values (
    p_group_id,
    p_member_id,
    'correction',
    p_amount,
    p_date,
    now(),
    coalesce(p_method, 'Cash'),
    coalesce(p_note, 'Correction'),
    p_supersedes,
    p_original_amount,
    v_idempotency_key,
    p_collector_id
  ) returning * into v_transaction;

  return jsonb_build_object(
    'transaction', to_jsonb(v_transaction),
    'idempotent', false
  );
end;
$$;

create or replace function public.close_cycle_transaction(
  p_group_id uuid,
  p_collector_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_group record;
begin
  -- Validate caller authorization
  if p_collector_id != auth.uid() and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  update public.groups
  set archived = true,
      virtual_date = null
  where id = p_group_id
    and collector_id = p_collector_id
  returning * into v_group;

  if not found then
    raise exception 'Group not found or unauthorized.';
  end if;

  return jsonb_build_object(
    'group', to_jsonb(v_group)
  );
end;
$$;

-- 2. Trigger to forbid deletion or mutation of finalized transactions
create or replace function public.protect_financial_ledger_immutability()
returns trigger
language plpgsql
security definer
as $$
begin
  if (TG_OP = 'DELETE') then
    raise exception 'Financial Integrity Error: Deletion of finalized transactions is strictly forbidden. Use void or reversal records instead.';
  end if;

  if (TG_OP = 'UPDATE') then
    if (OLD.amount is distinct from NEW.amount
        or OLD.group_id is distinct from NEW.group_id
        or OLD.member_id is distinct from NEW.member_id
        or OLD.type is distinct from NEW.type
        or OLD.supersedes is distinct from NEW.supersedes
        or OLD.original_amount is distinct from NEW.original_amount) then
      raise exception 'Financial Integrity Error: Editing finalized transaction records is forbidden. Create an append-only correction record referencing the original transaction.';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists protect_ledger_immutability_trigger on public.transactions;
create trigger protect_ledger_immutability_trigger
  before update or delete on public.transactions
  for each row
  execute function public.protect_financial_ledger_immutability();

-- 3. RLS Policies on public.transactions: allow SELECT; allow UPDATE/DELETE to target trigger for explicit exception handling
alter table public.transactions enable row level security;

drop policy if exists transactions_select on public.transactions;
drop policy if exists transactions_insert on public.transactions;
drop policy if exists transactions_update on public.transactions;
drop policy if exists transactions_delete on public.transactions;
drop policy if exists "Allow collectors full access to their transactions" on public.transactions;

create policy transactions_select on public.transactions
  for select
  using (
    collector_id = auth.uid()
    or public.is_super_admin(auth.uid())
  );

create policy transactions_update on public.transactions
  for update
  using (
    collector_id = auth.uid()
    or public.is_super_admin(auth.uid())
  );

create policy transactions_delete on public.transactions
  for delete
  using (
    collector_id = auth.uid()
    or public.is_super_admin(auth.uid())
  );
