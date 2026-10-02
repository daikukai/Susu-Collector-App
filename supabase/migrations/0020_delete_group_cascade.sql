-- 0020_delete_group_cascade.sql
-- RPC to cascade delete groups, override ledger immutability trigger during group deletion, and ensure payout transaction types are preserved

create or replace function public.protect_financial_ledger_immutability()
returns trigger
language plpgsql
security definer
as $$
begin
  if (TG_OP = 'DELETE') then
    if (current_setting('app.allow_ledger_delete', true) = 'true') then
      return OLD;
    end if;
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

create or replace function public.delete_group_cascade(p_group_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_collector_id uuid;
begin
  v_collector_id := auth.uid();
  if v_collector_id is null then
    raise exception 'Unauthorized: User is not authenticated.';
  end if;

  -- Enable temporary session override for ledger deletion trigger
  perform set_config('app.allow_ledger_delete', 'true', true);

  delete from public.transactions where group_id = p_group_id and collector_id = v_collector_id;
  delete from public.disputes where group_id = p_group_id and collector_id = v_collector_id;
  delete from public.rollovers where group_id = p_group_id and collector_id = v_collector_id;
  delete from public.sms_log where member_id in (select id from public.members where group_id = p_group_id) and collector_id = v_collector_id;
  delete from public.members where group_id = p_group_id and collector_id = v_collector_id;
  delete from public.groups where id = p_group_id and collector_id = v_collector_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.delete_group_cascade(uuid) to authenticated;

-- Ensure positional record_payment_transaction accepts optional p_type
create or replace function public.record_payment_transaction(
  p_group_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_date text,
  p_method text,
  p_note text,
  p_display_id text,
  p_collector_id uuid,
  p_type text default 'contribution'
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
  v_tx_type text;
begin
  if p_collector_id != auth.uid() and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  v_tx_type := coalesce(p_type, 'contribution');

  v_idempotency_key := coalesce(
    case when p_display_id is not null and trim(p_display_id) != '' then 'tx-disp-' || p_display_id end,
    'tx-' || v_tx_type || '-' || p_group_id || '-' || coalesce(p_member_id::text, 'collector') || '-' || p_date || '-' || p_amount
  );

  select * into v_transaction from public.transactions
  where idempotency_key = v_idempotency_key;

  if found then
    return jsonb_build_object(
      'transaction', to_jsonb(v_transaction),
      'idempotent', true
    );
  end if;

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
    v_tx_type,
    p_amount,
    p_date::date,
    now(),
    coalesce(p_method, 'Cash'),
    coalesce(p_note, case when v_tx_type = 'payout' then 'Member payout' when v_tx_type = 'collector_fee' then 'Collector fee' else 'Rapid roster' end),
    p_display_id,
    v_idempotency_key,
    p_collector_id
  ) returning * into v_transaction;

  if p_member_id is not null then
    insert into public.sms_log (
      member_id, kind, status, timestamp, content, collector_id
    ) values (
      p_member_id, case when v_tx_type = 'payout' then 'Payout confirmation' else 'Receipt' end, 'Delivered', now(),
      case when v_tx_type = 'payout' then 'Payout confirmation for ' else 'Payment receipt for ' end || p_amount, p_collector_id
    ) returning * into v_sms_log;
  end if;

  return jsonb_build_object(
    'transaction', to_jsonb(v_transaction),
    'sms_log', to_jsonb(v_sms_log),
    'idempotent', false
  );
end;
$$;

grant execute on function public.record_payment_transaction(uuid, uuid, numeric, text, text, text, text, uuid, text) to authenticated;
