-- 0013_stage1_core_financial_operations.sql
-- Stage 1: Core Financial Operations, Type-Aware Writes & Tenant-Scoped Idempotency

-- 1. Drop old function signatures to prevent PostgREST signature conflicts
drop function if exists public.record_payment_transaction CASCADE;
drop function if exists public.record_correction_transaction CASCADE;

-- 2. Stage 1 Payment & Payout Server RPC (Atomic Transaction + SMS Log)
create or replace function public.record_payment_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  p_group_id uuid;
  p_member_id uuid;
  p_type text;
  p_amount numeric;
  p_date date;
  p_method text;
  p_note text;
  p_display_id text;
  p_collector_id uuid;
  v_collector uuid;
  v_transaction record;
  v_sms_log record;
  v_disp_key text;
  v_server_key text;
begin
  -- Safe UUID parsing with regex to prevent 22P02 syntax errors on non-UUID local IDs
  p_group_id := case when payload->>'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'groupId')::uuid else null end;
  p_member_id := case when payload->>'memberId' is not null and payload->>'memberId' != 'collector' and payload->>'memberId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'memberId')::uuid else null end;
  p_type := coalesce(payload->>'type', 'contribution');
  p_amount := (payload->>'amount')::numeric;
  p_date := coalesce(payload->>'date', current_date::text)::date;
  p_method := coalesce(payload->>'method', 'Cash');
  p_note := coalesce(payload->>'note', case when p_type = 'payout' then 'Member payout' when p_type = 'collector_fee' then 'Collector fee' else 'Rapid roster' end);
  p_display_id := payload->>'displayId';
  p_collector_id := case when payload->>'collectorId' is not null and payload->>'collectorId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'collectorId')::uuid else auth.uid() end;

  v_collector := coalesce(p_collector_id, auth.uid());

  -- Tenant authorization check
  if v_collector != auth.uid() and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  -- Scoped Idempotency Keys (Collector-scoped to prevent cross-tenant collisions)
  v_disp_key := case when p_display_id is not null and trim(p_display_id) != '' then 'tx-disp-' || v_collector || '-' || trim(p_display_id) end;
  v_server_key := 'tx-' || p_type || '-' || v_collector || '-' || coalesce(p_group_id::text, 'no-grp') || '-' || coalesce(p_member_id::text, 'collector') || '-' || p_date::text || '-' || p_amount;

  -- 1. Collector-Scoped Idempotency Check
  select * into v_transaction from public.transactions
  where collector_id = v_collector
    and ((v_disp_key is not null and idempotency_key = v_disp_key)
         or idempotency_key = v_server_key
         or (group_id is not distinct from p_group_id 
             and coalesce(member_id::text, 'collector') = coalesce(p_member_id::text, 'collector') 
             and date = p_date 
             and amount = p_amount 
             and type = p_type))
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'already_processed', true,
      'message', 'Transaction already processed successfully.',
      'transaction', to_jsonb(v_transaction)
    );
  end if;

  -- 2. Atomic Insertion (Transaction + SMS Log)
  begin
    insert into public.transactions (
      group_id, member_id, type, amount, date, timestamp, method, note, display_id, idempotency_key, collector_id
    ) values (
      p_group_id, p_member_id, p_type, p_amount, p_date, now(),
      p_method, p_note, p_display_id, coalesce(v_disp_key, v_server_key), v_collector
    ) returning * into v_transaction;

    if p_member_id is not null then
      insert into public.sms_log (
        member_id, kind, status, timestamp, content, collector_id
      ) values (
        p_member_id, case when p_type = 'payout' then 'Payout confirmation' else 'Receipt' end, 'Delivered', now(),
        case when p_type = 'payout' then 'Payout confirmation for ' else 'Payment receipt for ' end || p_amount, v_collector
      ) returning * into v_sms_log;
    end if;

    return jsonb_build_object(
      'success', true,
      'idempotent', false,
      'already_processed', false,
      'message', 'Transaction recorded successfully.',
      'transaction', to_jsonb(v_transaction),
      'sms_log', to_jsonb(v_sms_log)
    );
  exception when unique_violation then
    select * into v_transaction from public.transactions
    where collector_id = v_collector
      and idempotency_key in (v_disp_key, v_server_key)
    limit 1;

    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'already_processed', true,
      'message', 'Transaction already processed successfully.',
      'transaction', to_jsonb(v_transaction)
    );
  end;
end;
$$;

-- 3. Stage 1 Correction RPC with Validation Against Original Record
create or replace function public.record_correction_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  p_group_id uuid;
  p_member_id uuid;
  p_amount numeric;
  p_date date;
  p_method text;
  p_note text;
  p_supersedes uuid;
  p_original_amount numeric;
  p_collector_id uuid;
  v_collector uuid;
  v_orig_tx record;
  v_transaction record;
  v_server_key text;
begin
  p_group_id := case when payload->>'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'groupId')::uuid else null end;
  p_member_id := case when payload->>'memberId' is not null and payload->>'memberId' != 'collector' and payload->>'memberId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'memberId')::uuid else null end;
  p_amount := (payload->>'amount')::numeric;
  p_date := coalesce(payload->>'date', current_date::text)::date;
  p_method := coalesce(payload->>'method', 'Cash');
  p_note := coalesce(payload->>'note', 'Correction');
  p_supersedes := case when payload->>'supersedes' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'supersedes')::uuid else null end;
  p_original_amount := (payload->>'originalAmount')::numeric;
  p_collector_id := case when payload->>'collectorId' is not null and payload->>'collectorId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'collectorId')::uuid else auth.uid() end;

  v_collector := coalesce(p_collector_id, auth.uid());

  if v_collector != auth.uid() and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  -- Validate against original record if supersedes is provided
  if p_supersedes is not null then
    select * into v_orig_tx from public.transactions where id = p_supersedes;
    if not found then
      raise exception 'Integrity Error: Original transaction % not found.', p_supersedes;
    end if;
    if v_orig_tx.collector_id != v_collector then
      raise exception 'Integrity Error: Original transaction % belongs to a different collector.', p_supersedes;
    end if;
  end if;

  v_server_key := 'tx-corr-' || v_collector || '-' || coalesce(p_group_id::text, 'no-grp') || '-' || coalesce(p_member_id::text, 'collector') || '-' || coalesce(p_supersedes::text, 'none') || '-' || p_amount;

  select * into v_transaction from public.transactions
  where collector_id = v_collector
    and (idempotency_key = v_server_key or (supersedes is not distinct from p_supersedes and amount = p_amount));

  if found then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'already_processed', true,
      'message', 'Correction transaction already processed successfully.',
      'transaction', to_jsonb(v_transaction)
    );
  end if;

  insert into public.transactions (
    group_id, member_id, type, amount, date, timestamp, method, note, supersedes, original_amount, idempotency_key, collector_id
  ) values (
    p_group_id, p_member_id, 'correction', p_amount, p_date, now(),
    p_method, p_note, p_supersedes, p_original_amount, v_server_key, v_collector
  ) returning * into v_transaction;

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'already_processed', false,
    'message', 'Correction transaction recorded successfully.',
    'transaction', to_jsonb(v_transaction)
  );
end;
$$;

-- 4. Clean Up Legacy Transaction Policies
drop policy if exists transactions_tenant_isolation on public.transactions;
drop policy if exists "transactions_tenant_isolation" on public.transactions;
drop policy if exists "Allow collectors full access to their transactions" on public.transactions;
drop policy if exists transactions_select on public.transactions;
drop policy if exists transactions_insert on public.transactions;
drop policy if exists transactions_update on public.transactions;
drop policy if exists transactions_delete on public.transactions;

alter table public.transactions enable row level security;

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
