-- 0021_normalize_group_fees.sql
-- Normalize existing and future groups in Supabase to standard 1_unit Liberian Susu fee structure

alter table public.groups drop constraint if exists groups_fee_type_check;
alter table public.groups add constraint groups_fee_type_check check (fee_type in ('none', 'percentage', '1_unit', 'fixed'));

update public.groups
set fee_type = '1_unit', fee_value = 1
where fee_type = 'percentage' or fee_type is null or fee_type = '10';
