-- 0001_init.sql
-- Susu Collector App — initial schema, derived directly from the
-- Group / Member / Tx / Dispute / Rollover / SmsEntry interfaces in
-- src/App.tsx, plus an append-only audit_log.
--
-- Design notes (read before applying):
--
-- 1. Every tenant-scoped table carries its own `collector_id`, not just
--    a join back through `group_id`. This is denormalized on purpose:
--    RLS policies that filter on a column directly on the row are much
--    cheaper than ones that require a subquery/join through `groups`
--    on every single row check, and it means a table is never
--    accidentally left unprotected because its parent join was wrong.
--
-- 2. `transactions.member_id` and `sms_log.member_id` are NULLABLE.
--    The current frontend (src/App.tsx) uses the string literal
--    "collector" as a sentinel member_id for the collector's own fee
--    transaction (see `recordCollectorFee` and `mkSms("collector", ...)`).
--    That sentinel is not a real member and cannot satisfy a uuid
--    foreign key. In this schema, a NULL member_id on a
--    `collector_fee`-type transaction (or its matching sms_log row)
--    means "this belongs to the collector, not a member." The frontend
--    will need a small change when it's wired to Supabase: stop
--    sending the "collector" string and send NULL instead for these
--    rows. Flagging this now so it isn't a surprise mid-Stage-4.
--
-- 3. `collectors.id` is the same value as `auth.users.id` — one row
--    per Supabase Auth user, created at onboarding (Stage 2).

-- ── collectors ───────────────────────────────────────────────────────
create table collectors (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

-- ── groups ───────────────────────────────────────────────────────────
create table groups (
  id            uuid primary key default gen_random_uuid(),
  collector_id  uuid not null references collectors(id) on delete cascade,
  name          text not null,
  amount        numeric not null check (amount > 0),
  currency      text not null default 'LRD',
  frequency     text not null,
  cycles        integer not null default 1,
  cycle_number  integer not null default 1,
  payout_order  text not null default 'Fixed rotation',
  start_date    date not null,
  end_date      date,
  fee_type      text not null default 'none' check (fee_type in ('none', 'percentage')),
  fee_value     numeric not null default 0 check (fee_value >= 0 and fee_value <= 100),
  virtual_date  date,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index groups_collector_id_idx on groups(collector_id);

-- ── members ──────────────────────────────────────────────────────────
create table members (
  id              uuid primary key default gen_random_uuid(),
  collector_id    uuid not null references collectors(id) on delete cascade,
  group_id        uuid not null references groups(id) on delete cascade,
  name            text not null,
  phone           text not null,
  payout_position integer not null,
  created_at      timestamptz not null default now()
);
create index members_collector_id_idx on members(collector_id);
create index members_group_id_idx on members(group_id);

-- ── transactions ─────────────────────────────────────────────────────
-- member_id is nullable — see design note 2 above.
create table transactions (
  id               uuid primary key default gen_random_uuid(),
  collector_id     uuid not null references collectors(id) on delete cascade,
  group_id         uuid not null references groups(id) on delete cascade,
  member_id        uuid references members(id) on delete restrict,
  type             text not null check (type in ('contribution', 'correction', 'payout', 'collector_fee')),
  amount           numeric not null check (amount >= 0),
  date             date not null,
  "timestamp"      timestamptz not null default now(),
  method           text not null check (method in ('Cash', 'MTN', 'Orange')),
  note             text not null default '',
  supersedes       uuid references transactions(id),
  original_amount  numeric,
  display_id       text,
  created_at       timestamptz not null default now()
);
create index transactions_collector_id_idx on transactions(collector_id);
create index transactions_group_id_idx on transactions(group_id);
create index transactions_member_id_idx on transactions(member_id);
create index transactions_supersedes_idx on transactions(supersedes);

-- ── rollovers ────────────────────────────────────────────────────────
create table rollovers (
  id           uuid primary key default gen_random_uuid(),
  collector_id uuid not null references collectors(id) on delete cascade,
  group_id     uuid not null references groups(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  amount       numeric not null,
  from_cycle   integer not null,
  created_at   timestamptz not null default now()
);
create index rollovers_collector_id_idx on rollovers(collector_id);
create index rollovers_group_id_idx on rollovers(group_id);

-- ── disputes ─────────────────────────────────────────────────────────
create table disputes (
  id           uuid primary key default gen_random_uuid(),
  collector_id uuid not null references collectors(id) on delete cascade,
  group_id     uuid not null references groups(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  description  text not null,
  status       text not null default 'open' check (status in ('open', 'resolved')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index disputes_collector_id_idx on disputes(collector_id);
create index disputes_group_id_idx on disputes(group_id);

-- ── sms_log ──────────────────────────────────────────────────────────
-- member_id is nullable — see design note 2 above (collector-fee SMS).
create table sms_log (
  id           uuid primary key default gen_random_uuid(),
  collector_id uuid not null references collectors(id) on delete cascade,
  member_id    uuid references members(id) on delete set null,
  kind         text not null check (kind in ('Receipt', 'Arrears receipt', 'Payment reminder', 'Payout confirmation', 'Collector fee')),
  status       text not null default 'Sent' check (status in ('Sent', 'Delivered', 'Failed')),
  "timestamp"  timestamptz not null default now(),
  content      text not null,
  created_at   timestamptz not null default now()
);
create index sms_log_collector_id_idx on sms_log(collector_id);
create index sms_log_member_id_idx on sms_log(member_id);

-- ── audit_log (append-only) ─────────────────────────────────────────
create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  collector_id   uuid not null references collectors(id) on delete cascade,
  actor_id       uuid not null,
  action         text not null,
  table_name     text not null,
  record_id      uuid not null,
  previous_value jsonb,
  new_value      jsonb,
  reason         text,
  created_at     timestamptz not null default now()
);
create index audit_log_collector_id_idx on audit_log(collector_id);

-- ─────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────

alter table collectors   enable row level security;
alter table groups       enable row level security;
alter table members      enable row level security;
alter table transactions enable row level security;
alter table rollovers    enable row level security;
alter table disputes     enable row level security;
alter table sms_log      enable row level security;
alter table audit_log    enable row level security;

-- collectors: a collector can only see/edit their own row
create policy collectors_self on collectors
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- All other tenant-scoped tables: full access to rows you own, none otherwise.
create policy groups_tenant_isolation on groups
  for all
  using (collector_id = auth.uid())
  with check (collector_id = auth.uid());

create policy members_tenant_isolation on members
  for all
  using (collector_id = auth.uid())
  with check (collector_id = auth.uid());

create policy transactions_tenant_isolation on transactions
  for all
  using (collector_id = auth.uid())
  with check (collector_id = auth.uid());

create policy rollovers_tenant_isolation on rollovers
  for all
  using (collector_id = auth.uid())
  with check (collector_id = auth.uid());

create policy disputes_tenant_isolation on disputes
  for all
  using (collector_id = auth.uid())
  with check (collector_id = auth.uid());

create policy sms_log_tenant_isolation on sms_log
  for all
  using (collector_id = auth.uid())
  with check (collector_id = auth.uid());

-- audit_log: readable by its owner, but INSERT-only — no update/delete
-- policy exists for any role, so with RLS enabled those operations are
-- rejected outright regardless of who's asking. Belt-and-suspenders:
-- also revoke UPDATE/DELETE at the grant level from the two roles
-- Supabase actually uses at request time.
create policy audit_log_select on audit_log
  for select
  using (collector_id = auth.uid());

create policy audit_log_insert on audit_log
  for insert
  with check (collector_id = auth.uid());

revoke update, delete on audit_log from authenticated;
revoke update, delete on audit_log from anon;

-- ─────────────────────────────────────────────────────────────────────
-- Audit trigger — automatically logs inserts to the three tables where
-- history matters most, so the app can't forget to call this itself.
-- ─────────────────────────────────────────────────────────────────────

create or replace function log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (collector_id, actor_id, action, table_name, record_id, previous_value, new_value)
  values (
    new.collector_id,
    auth.uid(),
    tg_op,
    tg_table_name,
    new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger transactions_audit
  after insert or update on transactions
  for each row execute function log_audit_event();

create trigger disputes_audit
  after insert or update on disputes
  for each row execute function log_audit_event();

create trigger groups_audit
  after insert or update on groups
  for each row execute function log_audit_event();
