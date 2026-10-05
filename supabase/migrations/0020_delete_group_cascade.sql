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

-- Ensure JSON payload record_payment_transaction preserves p_type and grants execute
create or replace function public.record_payment_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  p_id uuid;
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
  p_id := case when payload->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'id')::uuid else null end;
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

  if v_collector is null or (v_collector != auth.uid() and current_user not in ('postgres', 'service_role')) then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  if p_group_id is null then
    raise exception 'Invalid Parameter: A saved group is required before recording money.';
  end if;

  if p_type in ('contribution', 'correction', 'payout') and p_member_id is null then
    raise exception 'Invalid Parameter: A saved member is required for this transaction.';
  end if;

  v_disp_key := case when p_display_id is not null and trim(p_display_id) != '' then 'tx-disp-' || v_collector || '-' || trim(p_display_id) end;
  v_server_key := 'tx-' || p_type || '-' || v_collector || '-' || coalesce(p_group_id::text, 'no-grp') || '-' || coalesce(p_member_id::text, 'collector') || '-' || p_date::text || '-' || p_amount;

  select * into v_transaction from public.transactions
  where collector_id = v_collector
    and (
      (p_id is not null and id = p_id)
      or (v_disp_key is not null and idempotency_key = v_disp_key)
    )
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

  begin
    insert into public.transactions (
      id, group_id, member_id, type, amount, date, timestamp, method, note, display_id, idempotency_key, collector_id
    ) values (
      coalesce(p_id, gen_random_uuid()), p_group_id, p_member_id, p_type, p_amount, p_date, now(),
      p_method, p_note, p_display_id, coalesce(v_disp_key, v_server_key), v_collector
    ) returning * into v_transaction;

    if p_member_id is not null then
      insert into public.sms_log (
        member_id, kind, status, timestamp, content, collector_id
      ) values (
        p_member_id, case when p_type = 'payout' then 'Payout confirmation' else 'Receipt' end, 'Delivered', now(),
        case when p_type = 'payout' then 'Payout confirmation for ' else 'Payment receipt for ' end || p_amount, v_collector
      ) returning * into v_sms_log;
    elsif p_type = 'collector_fee' then
      insert into public.sms_log (
        member_id, kind, status, timestamp, content, collector_id
      ) values (
        null, 'Collector fee', 'Delivered', now(),
        'Collector fee payout for ' || p_amount, v_collector
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
      and (
        (p_id is not null and id = p_id)
        or (v_disp_key is not null and idempotency_key = v_disp_key)
        or idempotency_key = v_server_key
      )
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

grant execute on function public.record_payment_transaction(jsonb) to authenticated;
