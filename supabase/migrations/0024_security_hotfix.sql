-- 0024_security_hotfix.sql
-- Close the public/anonymous execution hole before production rollout.
-- This hotfix removes anonymous/public access to the sensitive financial RPCs.

revoke all on function public.record_payment_transaction(jsonb) from public;
revoke all on function public.record_payment_transaction(jsonb) from anon;
revoke execute on function public.record_payment_transaction(jsonb) from public;
revoke execute on function public.record_payment_transaction(jsonb) from anon;

grant execute on function public.record_payment_transaction(jsonb) to authenticated;

revoke all on function public.record_correction_transaction(jsonb) from public;
revoke all on function public.record_correction_transaction(jsonb) from anon;
revoke execute on function public.record_correction_transaction(jsonb) from public;
revoke execute on function public.record_correction_transaction(jsonb) from anon;

grant execute on function public.record_correction_transaction(jsonb) to authenticated;

revoke all on function public.record_payout_transaction(jsonb) from public;
revoke all on function public.record_payout_transaction(jsonb) from anon;
revoke execute on function public.record_payout_transaction(jsonb) from public;
revoke execute on function public.record_payout_transaction(jsonb) from anon;

grant execute on function public.record_payout_transaction(jsonb) to authenticated;

revoke all on function public.close_cycle_transaction(jsonb) from public;
revoke all on function public.close_cycle_transaction(jsonb) from anon;
revoke execute on function public.close_cycle_transaction(jsonb) from public;
revoke execute on function public.close_cycle_transaction(jsonb) from anon;

grant execute on function public.close_cycle_transaction(jsonb) to authenticated;

-- Keep summary views private to authenticated callers only.
revoke all on table public.v_group_financial_summary from public;
revoke all on table public.v_group_financial_summary from anon;
revoke select on table public.v_group_financial_summary from public;
revoke select on table public.v_group_financial_summary from anon;

grant select on table public.v_group_financial_summary to authenticated;

-- Defensive hardening for the audit log and financial tables.
revoke all on table public.audit_log from public;
revoke all on table public.audit_log from anon;
revoke all on table public.transactions from public;
revoke all on table public.transactions from anon;
revoke all on table public.groups from public;
revoke all on table public.groups from anon;
revoke all on table public.members from public;
revoke all on table public.members from anon;

-- Keep the app working via RLS and authenticated calls only.
grant select, insert, update, delete on table public.transactions to authenticated;
grant select, insert, update, delete on table public.groups to authenticated;
grant select, insert, update, delete on table public.members to authenticated;
grant select, insert, update, delete on table public.audit_log to authenticated;
