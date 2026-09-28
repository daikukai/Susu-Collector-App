-- 0014_stage2_ledger_immutability_security.sql
-- Stage 2: Immutable Financial Ledger & Strict Security Enforcement

-- 1. Complete Immutability Trigger for public.transactions
create or replace function public.protect_financial_ledger_immutability()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Strictly forbid deletion of finalized financial records
  if (TG_OP = 'DELETE') then
    raise exception 'Financial Integrity Error: Deletion of finalized transactions is strictly forbidden. Use void or reversal records instead.';
  end if;

  -- Strictly forbid modification of any core transaction field
  if (TG_OP = 'UPDATE') then
    if (OLD.amount is distinct from NEW.amount
        or OLD.group_id is distinct from NEW.group_id
        or OLD.member_id is distinct from NEW.member_id
        or OLD.type is distinct from NEW.type
        or OLD.supersedes is distinct from NEW.supersedes
        or OLD.original_amount is distinct from NEW.original_amount
        or OLD.date is distinct from NEW.date
        or OLD.method is distinct from NEW.method
        or OLD.note is distinct from NEW.note
        or OLD.timestamp is distinct from NEW.timestamp
        or OLD.display_id is distinct from NEW.display_id
        or OLD.idempotency_key is distinct from NEW.idempotency_key
        or OLD.collector_id is distinct from NEW.collector_id) then
      raise exception 'Financial Integrity Error: Editing finalized transaction records is strictly forbidden. Create an append-only correction record referencing the original transaction.';
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

-- 2. Revoke Direct Client INSERT Access on public.transactions
-- Ensure no INSERT policy exists for authenticated role on public.transactions,
-- enforcing that all financial writes must flow through SECURITY DEFINER RPC functions.
alter table public.transactions enable row level security;

drop policy if exists transactions_insert on public.transactions;
drop policy if exists "transactions_insert" on public.transactions;

-- Ensure SELECT policy remains active for collectors and super admins
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select
  using (
    collector_id = auth.uid()
    or public.is_super_admin(auth.uid())
  );
