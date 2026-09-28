-- 0015_stage3_fee_logic_dispute_closure.sql
-- Stage 3: Unified Cycle Closure Dispute Verification & SMS Status Standards

-- 1. Drop old function signature
drop function if exists public.close_cycle_transaction CASCADE;

-- 2. Unified Cycle Closure RPC with Open Dispute Enforcement
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
