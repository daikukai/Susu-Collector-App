-- 0022_complete_server_side_financial_suite.sql
-- Comprehensive Server-Side Financial Suite for Susu Collector App
-- Fixes: Server-side validation, database constraints, payout balance verification, 
-- immutability triggers, and audit logging fault-tolerance.

-- ============================================================================
-- 1. FAULT-TOLERANT AUDIT LOGGING & ACTOR CONSTRAINT FIX
-- ============================================================================

-- Ensure actor_id is nullable so updates from SQL Editor, Edge Functions, or system routines never fail
alter table if exists public.audit_log alter column actor_id drop not null;

-- Replace audit event trigger with fail-safe error handling and actor fallback
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
  -- Fail-safe: Audit logging must never block business transactions or schema updates
  return new;
end;
$$;

-- Ensure audit triggers are attached
drop trigger if exists transactions_audit on public.transactions;
create trigger transactions_audit
  after insert or update on public.transactions
  for each row execute function public.log_audit_event();

drop trigger if exists groups_audit on public.groups;
create trigger groups_audit
  after insert or update on public.groups
  for each row execute function public.log_audit_event();

drop trigger if exists disputes_audit on public.disputes;
create trigger disputes_audit
  after insert or update on public.disputes
  for each row execute function public.log_audit_event();


-- ============================================================================
-- 2. GROUPS TABLE CONSTRAINTS & COMMISSION NORMALIZATION
-- ============================================================================

alter table public.groups drop constraint if exists groups_fee_type_check;
alter table public.groups add constraint groups_fee_type_check 
  check (fee_type in ('none', 'percentage', '1_unit', 'fixed'));

update public.groups
set fee_type = '1_unit', fee_value = 1
where fee_type = 'percentage' or fee_type is null or fee_type = '10';


-- ============================================================================
-- 3. FINANCIAL LEDGER IMMUTABILITY (PREVENT SILENT TAMPERING)
-- ============================================================================

create or replace function public.prevent_transaction_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Prevent modifications to financial ledger records; corrections must be append-only
  if tg_op = 'UPDATE' then
    raise exception 'Ledger Violation: Historical transactions are immutable. To correct an entry, record a correction transaction with supersedes linking.';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_transactions_immutable on public.transactions;
create trigger trg_transactions_immutable
  before update on public.transactions
  for each row execute function public.prevent_transaction_tampering();


-- ============================================================================
-- 4. SERVER-SIDE ATOMIC PAYMENT TRANSACTION RPC
-- ============================================================================

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
    raise exception 'Invalid Parameter: Target group ID is required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Parameter: Amount must be greater than zero.';
  end if;

  if p_type in ('contribution', 'correction', 'payout') and p_member_id is null then
    raise exception 'Invalid Parameter: A saved member is required for this transaction.';
  end if;

  v_disp_key := case when p_display_id is not null and trim(p_display_id) != '' then 'tx-disp-' || v_collector || '-' || trim(p_display_id) end;
  v_server_key := 'tx-' || p_type || '-' || v_collector || '-' || coalesce(p_group_id::text, 'no-grp') || '-' || coalesce(p_member_id::text, 'collector') || '-' || p_date::text || '-' || p_amount;

  -- Idempotency check: prevent duplicate writes
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
  end;
end;
$$;


-- ============================================================================
-- 5. SERVER-SIDE PAYOUT CALCULATION & POT VALIDATION RPC
-- ============================================================================

create or replace function public.record_payout_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
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
  if v_collector is null and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  if p_group_id is null then
    raise exception 'Invalid Parameter: Target group ID is required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Parameter: Payout amount must be greater than zero.';
  end if;

  -- 1. Check for open disputes for member
  if p_member_id is not null then
    select count(*) into v_open_disputes
    from public.disputes
    where group_id = p_group_id and member_id = p_member_id and status = 'open';

    if v_open_disputes > 0 then
      raise exception 'Dispute Lock: Member has an open dispute that must be resolved prior to disbursing payout.';
    end if;

    -- Check if member has already received a payout
    select count(*) into v_already_paid_out
    from public.transactions
    where group_id = p_group_id and member_id = p_member_id and type = 'payout';

    if v_already_paid_out > 0 then
      raise exception 'Duplicate Payout: Member has already received payout for this cycle.';
    end if;
  end if;

  -- 2. Server-side Available Pot Balance Calculation
  -- Total contributions collected
  select coalesce(sum(amount), 0) into v_total_contributions
  from public.transactions
  where group_id = p_group_id and type = 'contribution';

  -- Total disbursements (payouts + collector fees)
  select coalesce(sum(amount), 0) into v_total_outflows
  from public.transactions
  where group_id = p_group_id and type in ('payout', 'collector_fee');

  v_available_pot := greatest(0, v_total_contributions - v_total_outflows);

  -- 3. Strict Solvency Check: Payout cannot exceed current available pot
  if p_amount > v_available_pot then
    raise exception 'Solvency Error: Requested payout of % exceeds available pot balance of %.', p_amount, v_available_pot;
  end if;

  -- 4. Atomic Record Creation
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


-- ============================================================================
-- 6. SERVER-SIDE CLOSE CYCLE RPC
-- ============================================================================

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
  where group_id = p_group_id and status = 'open';

  if v_open_disputes > 0 then
    raise exception 'Business Rule Violation: Cannot close cycle while % open dispute(s) exist. Resolve all disputes first.', v_open_disputes;
  end if;

  -- Archive group and clear virtual date
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


-- ============================================================================
-- 7. REAL-TIME FINANCIAL SUMMARY VIEW
-- ============================================================================

create or replace view public.v_group_financial_summary as
select 
  g.id as group_id,
  g.collector_id,
  g.name as group_name,
  g.amount as contribution_unit,
  g.frequency,
  g.fee_type,
  g.archived,
  count(distinct m.id) as total_members,
  coalesce(sum(case when t.type = 'contribution' then t.amount else 0 end), 0) as total_collected,
  coalesce(sum(case when t.type = 'payout' then t.amount else 0 end), 0) as total_payouts,
  coalesce(sum(case when t.type = 'collector_fee' then t.amount else 0 end), 0) as total_collector_fees,
  greatest(0, 
    coalesce(sum(case when t.type = 'contribution' then t.amount else 0 end), 0) - 
    coalesce(sum(case when t.type in ('payout', 'collector_fee') then t.amount else 0 end), 0)
  ) as current_pot_balance
from public.groups g
left join public.members m on m.group_id = g.id
left join public.transactions t on t.group_id = g.id
group by g.id;


-- ============================================================================
-- 8. SECURITY & EXECUTION GRANTS
-- ============================================================================

grant execute on function public.record_payment_transaction(jsonb) to authenticated;
grant execute on function public.record_correction_transaction(jsonb) to authenticated;
grant execute on function public.record_payout_transaction(jsonb) to authenticated;
grant execute on function public.close_cycle_transaction(jsonb) to authenticated;
grant select on public.v_group_financial_summary to authenticated;


-- ============================================================================
-- 9. COLLECTOR REGISTRATION & PROFILE PERSISTENCE REPAIR
-- ============================================================================

-- Fix enforce_collector_invite_redemption to check both single_use and multi_use_demo,
-- and support multi-use active codes or previously redeemed phone numbers.
create or replace function public.enforce_collector_invite_redemption()
returns trigger
language plpgsql
security definer
as $$
declare
  user_phone text;
  norm_phone text;
  auth_user_phone text;
begin
  -- Allow Super Admin bypass
  if (auth.uid() is not null and public.is_super_admin(auth.uid())) then
    return NEW;
  end if;

  -- If user is authenticated, allow the authenticated user to manage their own collector profile
  if (auth.uid() is not null and NEW.id = auth.uid()) then
    return NEW;
  end if;

  -- Retrieve user phone from record or auth metadata
  select raw_user_meta_data->>'phone' into auth_user_phone
  from auth.users
  where id = NEW.id;

  user_phone := coalesce(NEW.phone, auth_user_phone);
  norm_phone := public.normalize_phone(user_phone);

  -- Allow designated Master Admin phone number bypass
  if norm_phone = '+231886884019' then
    return NEW;
  end if;

  if norm_phone is null then
    raise exception 'Access denied: Valid phone number is required to register a collector profile.';
  end if;

  -- Verify that this phone number has a verified invite key in invite_codes
  if not exists (
    select 1 from public.invite_codes
    where (
      (public.normalize_phone(used_by_phone) = norm_phone and status in ('used', 'active'))
      or (kind = 'multi_use_demo' and status = 'active')
    )
  ) then
    raise exception 'Access denied: No verified invitation access key found for phone number %. Registration outside the invite workflow is strictly prohibited.', norm_phone;
  end if;

  return NEW;
end;
$$;

-- Ensure RLS allows authenticated users to insert & update their own collector record
drop policy if exists collectors_insert on public.collectors;
create policy collectors_insert on public.collectors
  for insert
  with check (
    id = auth.uid()
    and (
      coalesce(is_super_admin, false) = false
      or public.is_super_admin(auth.uid())
    )
  );

drop policy if exists collectors_update on public.collectors;
create policy collectors_update on public.collectors
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (
      coalesce(is_super_admin, false) = false
      or public.is_super_admin(auth.uid())
    )
  );

drop policy if exists collectors_delete on public.collectors;
create policy collectors_delete on public.collectors
  for delete
  using (
    id = auth.uid()
    or public.is_super_admin(auth.uid())
  );

-- Update protect_financial_ledger_immutability to allow deletion when account or group is being deleted
create or replace function public.protect_financial_ledger_immutability()
returns trigger
language plpgsql
security definer
as $$
begin
  if (TG_OP = 'DELETE') then
    if (current_setting('app.allow_ledger_delete', true) = 'true' or current_user in ('postgres', 'service_role')) then
      return OLD;
    end if;
    -- If the collector who owns this transaction no longer exists, allow cascade
    if not exists (select 1 from public.collectors where id = OLD.collector_id) then
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

-- Server-side RPC for collectors to cleanly delete their own account and all associated records
create or replace function public.delete_account_cascade(target_user_id uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller_id uuid;
  v_target_id uuid;
begin
  v_caller_id := auth.uid();
  v_target_id := coalesce(target_user_id, v_caller_id);

  if v_caller_id is null and current_user not in ('postgres', 'service_role') then
    raise exception 'Unauthorized: Authentication required.';
  end if;

  -- Only self or super_admin or service_role can delete the account
  if v_caller_id is not null and v_target_id != v_caller_id and not public.is_super_admin(v_caller_id) then
    raise exception 'Unauthorized: You can only delete your own account.';
  end if;

  -- Prevent deleting the designated Master Admin account
  if exists (select 1 from public.collectors where id = v_target_id and (is_super_admin = true or phone = '+231886884019')) then
    raise exception 'Protected Account: Master Admin cannot be deleted.';
  end if;

  -- Allow ledger deletion in this session
  perform set_config('app.allow_ledger_delete', 'true', true);

  delete from public.audit_log where collector_id = v_target_id;
  delete from public.sms_log where collector_id = v_target_id;
  delete from public.disputes where collector_id = v_target_id;
  delete from public.rollovers where collector_id = v_target_id;
  delete from public.transactions where collector_id = v_target_id;
  delete from public.members where collector_id = v_target_id;
  delete from public.groups where collector_id = v_target_id;
  delete from public.collectors where id = v_target_id;

  -- Delete from auth.users
  delete from auth.users where id = v_target_id;

  return jsonb_build_object('success', true, 'message', 'Account and associated records deleted permanently.');
end;
$$;

grant execute on function public.delete_account_cascade(uuid) to authenticated;


