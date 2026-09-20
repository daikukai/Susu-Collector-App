-- 0005_update_fee_type_check.sql
-- Update groups_fee_type_check constraint on public.groups to support 1_unit and fixed fee types

alter table public.groups drop constraint if exists groups_fee_type_check;

alter table public.groups add constraint groups_fee_type_check check (fee_type in ('none', 'percentage', '1_unit', 'fixed'));
