-- Assembly migration 1: dated, overlapping plans (G1).
-- Additive and idempotent — safe to re-run and safe on a populated DB.

alter table assembly_plan add column if not exists start_date date;
alter table assembly_plan add column if not exists end_date date;
alter table assembly_plan add column if not exists priority integer;

-- Classes may now belong to overlapping dated plans (Term 1 + exam block, ...),
-- resolved by narrowest-range-wins. Drop the old one-plan-per-class-per-year guard.
drop index if exists idx_assembly_plan_class_no_overlap;

-- Keep a plain (non-unique) lookup index for the resolver's class→plan query.
create index if not exists idx_assembly_plan_class_school_year_class
    on assembly_plan_class(school_id, academic_year_id, class_id) where status = 'active';
