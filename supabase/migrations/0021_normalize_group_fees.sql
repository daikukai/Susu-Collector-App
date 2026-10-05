-- 0021_normalize_group_fees.sql
-- Fix audit_log constraint and log_audit_event trigger, normalize group fees to 1_unit, and ensure close_cycle_transaction works

-- 1. Ensure actor_id is nullable in audit_log to prevent null violations when run from SQL Editor, Edge Functions, or background tasks
alter table public.audit_log alter column actor_id drop not null;

-- 2. Make log_audit_event safe and fault-tolerant
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    collector_id, actor_id, action, table_name, record_id, previous_value, new_value
  ) values (
    new.collector_id,
    coalesce(auth.uid(), new.collector_id),
    tg_op,
    tg_table_name,
    new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
exception when others then
  -- Fail-safe: Never block business transactions or schema updates if audit logging fails
  return new;
end;
$$;

-- 3. Normalize groups fee type check and update existing rows to standard 1_unit
alter table public.groups drop constraint if exists groups_fee_type_check;
alter table public.groups add constraint groups_fee_type_check check (fee_type in ('none', 'percentage', '1_unit', 'fixed'));

update public.groups
set fee_type = '1_unit', fee_value = 1
where fee_type = 'percentage' or fee_type is null or fee_type = '10';

-- 4. Ensure close_cycle_transaction function is properly defined and granted
create or replace function public.close_cycle_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  p_group_id uuid;
  p_collector_id uuid;
  v_collector uuid;
  v_open_disputes integer;
  v_group record;
begin
  p_group_id := case when payload->>'groupId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'groupId')::uuid else null end;
  p_collector_id := case when payload->>'collectorId' is not null and payload->>'collectorId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (payload->>'collectorId')::uuid else auth.uid() end;

  v_collector := coalesce(p_collector_id, auth.uid());

  if v_collector != auth.uid() and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Collector ID mismatch.';
  end if;

  if p_group_id is null then
    raise exception 'Invalid Parameter: Target group ID is required.';
  end if;

  -- Verify no open disputes exist for the group before closing cycle
  select count(*) into v_open_disputes
  from public.disputes
  where group_id = p_group_id
    and status = 'open';

  if v_open_disputes > 0 then
    raise exception 'Business Rule Violation: Cannot close cycle while % open dispute(s) exist. Resolve all disputes first.', v_open_disputes;
  end if;

  -- Archive group and clear virtual date
  update public.groups
  set archived = true,
      virtual_date = null
  where id = p_group_id
    and collector_id = v_collector
  returning * into v_group;

  if not found then
    raise exception 'Group not found or unauthorized.';
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Cycle closed successfully.',
    'group', to_jsonb(v_group)
  );
end;
$$;

grant execute on function public.close_cycle_transaction(jsonb) to authenticated;
