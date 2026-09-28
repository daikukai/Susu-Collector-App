-- 0016_stage4_server_side_ledger_views.sql
-- Stage 4: Server-Side Financial Ledger Aggregation Views

-- 1. View for Group Financial Balances & Totals
create or replace view public.v_group_balances as
select
  g.id as group_id,
  g.collector_id,
  g.name as group_name,
  g.currency,
  coalesce(sum(case when t.type = 'contribution' then t.amount else 0 end), 0) as total_contributions,
  coalesce(sum(case when t.type = 'payout' then t.amount else 0 end), 0) as total_payouts,
  coalesce(sum(case when t.type = 'collector_fee' then t.amount else 0 end), 0) as total_collector_fees,
  coalesce(sum(case when t.type = 'contribution' then t.amount else 0 end), 0) 
    - coalesce(sum(case when t.type = 'payout' then t.amount else 0 end), 0) 
    - coalesce(sum(case when t.type = 'collector_fee' then t.amount else 0 end), 0) as net_pot_balance,
  count(distinct t.id) as total_transactions_count
from public.groups g
left join public.transactions t on t.group_id = g.id and t.supersedes is null
group by g.id, g.collector_id, g.name, g.currency;

-- Grant SELECT access on view to authenticated users
grant select on public.v_group_balances to authenticated;

-- 2. View for Member Financial Summaries
create or replace view public.v_member_financial_summaries as
select
  m.id as member_id,
  m.group_id,
  m.collector_id,
  m.name as member_name,
  m.member_code,
  coalesce(sum(case when t.type = 'contribution' then t.amount else 0 end), 0) as total_contributions_paid,
  coalesce(sum(case when t.type = 'payout' then t.amount else 0 end), 0) as total_payouts_received,
  coalesce(sum(case when t.type = 'contribution' then t.amount else 0 end), 0) 
    - coalesce(sum(case when t.type = 'payout' then t.amount else 0 end), 0) as net_member_balance,
  count(distinct t.id) as transaction_count
from public.members m
left join public.transactions t on t.member_id = m.id and t.supersedes is null
group by m.id, m.group_id, m.collector_id, m.name, m.member_code;

-- Grant SELECT access on view to authenticated users
grant select on public.v_member_financial_summaries to authenticated;
