-- 0025_ledger_ownership_checks.sql
-- Recreate the ledger RPCs so that the collector is always auth.uid(),
-- group ownership is enforced server-side, and member ownership is checked
-- against both the target group and the calling collector.

create or replace function public.record_payment_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  v_collector := auth.uid();

  if v_collector is null then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  if p_group_id is null then
    raise exception 'Invalid Parameter: Target group ID is required.';
  end if;

  if not exists (
    select 1 from public.groups
    where id = p_group_id and collector_id = v_collector
  ) then
    raise exception 'Group not found or unauthorized for this collector.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Parameter: Amount must be greater than zero.';
  end if;

  if p_type in ('contribution', 'correction', 'payout') and p_member_id is null then
    raise exception 'Invalid Parameter: A saved member is required for this transaction.';
  end if;

  if p_member_id is not null then
    if not exists (
      select 1 from public.members m
      join public.groups g on g.id = m.group_id
      where m.id = p_member_id
        and m.group_id = p_group_id
        and g.collector_id = v_collector
    ) then
      raise exception 'Member does not belong to this group for the authenticated collector.';
    end if;
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
    order by created_at desc
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

create or replace function public.record_correction_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  v_collector := auth.uid();

  if v_collector is null then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  if p_group_id is null then
    raise exception 'Invalid Parameter: Target group ID is required.';
  end if;

  if not exists (
    select 1 from public.groups
    where id = p_group_id and collector_id = v_collector
  ) then
    raise exception 'Group not found or unauthorized for this collector.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Parameter: Amount must be greater than zero.';
  end if;

  if p_member_id is not null then
    if not exists (
      select 1 from public.members m
      join public.groups g on g.id = m.group_id
      where m.id = p_member_id
        and m.group_id = p_group_id
        and g.collector_id = v_collector
    ) then
      raise exception 'Member does not belong to this group for the authenticated collector.';
    end if;
  end if;

  if p_supersedes is not null then
    select * into v_orig_tx
    from public.transactions
    where id = p_supersedes
      and collector_id = v_collector
      and group_id = p_group_id;

    if not found then
      raise exception 'Integrity Error: Original transaction % not found for this collector and group.', p_supersedes;
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

grant execute on function public.record_correction_transaction(jsonb) to authenticated;

create or replace function public.record_payout_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p_group_id uuid;
  p_member_id uuid;
  p_amount numeric;
  p_method text;
  p_note text;
  p_payout_type text;
  v_collector uuid;
  v_open_disputes integer;
  v_total_contributions numeric := 0;
  v_total_outflows numeric := 0;
  v_available_pot numeric := 0;
  v_already_paid_out integer := 0;
  v_transaction record;
  v_sms_log record;
  v_display_id text;
begin
  p_group_id := case when payload->>'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'groupId')::uuid else null end;
  p_member_id := case when payload->>'memberId' is not null and payload->>'memberId' != 'collector' and payload->>'memberId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'memberId')::uuid else null end;
  p_amount := (payload->>'amount')::numeric;
  p_method := coalesce(payload->>'method', 'Cash');
  p_note := coalesce(payload->>'note', 'Member payout');
  p_payout_type := coalesce(payload->>'payoutType', case when p_member_id is null then 'collector_fee' else 'payout' end);

  v_collector := auth.uid();
  if v_collector is null then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  if p_group_id is null then
    raise exception 'Invalid Parameter: Target group ID is required.';
  end if;

  if not exists (
    select 1 from public.groups
    where id = p_group_id and collector_id = v_collector
  ) then
    raise exception 'Group not found or unauthorized for this collector.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Parameter: Payout amount must be greater than zero.';
  end if;

  if p_member_id is not null then
    if not exists (
      select 1 from public.members m
      join public.groups g on g.id = m.group_id
      where m.id = p_member_id
        and m.group_id = p_group_id
        and g.collector_id = v_collector
    ) then
      raise exception 'Member does not belong to this group for the authenticated collector.';
    end if;

    select count(*) into v_open_disputes
    from public.disputes
    where group_id = p_group_id and member_id = p_member_id and status = 'open';

    if v_open_disputes > 0 then
      raise exception 'Dispute Lock: Member has an open dispute that must be resolved prior to disbursing payout.';
    end if;

    select count(*) into v_already_paid_out
    from public.transactions
    where group_id = p_group_id and member_id = p_member_id and type = 'payout';

    if v_already_paid_out > 0 then
      raise exception 'Duplicate Payout: Member has already received payout for this cycle.';
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_total_contributions
  from public.transactions
  where group_id = p_group_id and type = 'contribution';

  select coalesce(sum(amount), 0) into v_total_outflows
  from public.transactions
  where group_id = p_group_id and type in ('payout', 'collector_fee');

  v_available_pot := greatest(0, v_total_contributions - v_total_outflows);

  if p_amount > v_available_pot then
    raise exception 'Solvency Error: Requested payout of % exceeds available pot balance of %.', p_amount, v_available_pot;
  end if;

  v_display_id := 'PO-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substring(gen_random_uuid()::text from 1 for 6));

  insert into public.transactions (
    id, group_id, member_id, type, amount, date, timestamp, method, note, display_id, collector_id
  ) values (
    gen_random_uuid(), p_group_id, p_member_id, p_payout_type, p_amount, current_date, now(),
    p_method, p_note, v_display_id, v_collector
  ) returning * into v_transaction;

  if p_member_id is not null then
    insert into public.sms_log (
      member_id, kind, status, timestamp, content, collector_id
    ) values (
      p_member_id, 'Payout confirmation', 'Delivered', now(),
      'Susu payout of ' || p_amount || ' has been disbursed via ' || p_method, v_collector
    ) returning * into v_sms_log;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Payout recorded successfully and pot debited.',
    'transaction', to_jsonb(v_transaction),
    'remaining_pot', v_available_pot - p_amount
  );
end;
$$;

grant execute on function public.record_payout_transaction(jsonb) to authenticated;

create or replace function public.close_cycle_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p_group_id uuid;
  v_collector uuid;
  v_open_disputes integer;
  v_group record;
begin
  p_group_id := case when payload->>'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'groupId')::uuid else null end;
  v_collector := auth.uid();

  if v_collector is null then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  if p_group_id is null then
    raise exception 'Invalid Parameter: Target group ID is required.';
  end if;

  if not exists (
    select 1 from public.groups
    where id = p_group_id and collector_id = v_collector
  ) then
    raise exception 'Group not found or unauthorized for this collector.';
  end if;

  select count(*) into v_open_disputes
  from public.disputes
  where group_id = p_group_id and status = 'open';

  if v_open_disputes > 0 then
    raise exception 'Business Rule Violation: Cannot close cycle while % open dispute(s) exist. Resolve all disputes first.', v_open_disputes;
  end if;

  update public.groups
  set archived = true,
      virtual_date = null
  where id = p_group_id and collector_id = v_collector
  returning * into v_group;

  if not found then
    raise exception 'Group not found or unauthorized.';
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Cycle closed and group archived successfully.',
    'group', to_jsonb(v_group)
  );
end;
$$;

grant execute on function public.close_cycle_transaction(jsonb) to authenticated;
