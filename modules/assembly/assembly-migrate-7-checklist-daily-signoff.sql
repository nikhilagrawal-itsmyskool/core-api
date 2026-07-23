-- Assembly migration 7: independent WEEKLY vs DAILY checklist sign-off.
-- Previously assembly_checklist_signoff was one row per week (week_id primary key).
-- To let the weekly checks be submitted once (before the roster starts) and each
-- day's checks be submitted day-by-day, a sign-off is now keyed by (week, date):
--   entry_date NULL  -> the WEEKLY sign-off
--   entry_date set   -> that assembly DAY's sign-off
-- Additive + idempotent. Existing rows (entry_date null) become the weekly sign-off.

alter table assembly_checklist_signoff add column if not exists entry_date date;

-- Drop the single-row-per-week primary key so weekly + per-day sign-offs coexist.
alter table assembly_checklist_signoff drop constraint if exists assembly_checklist_signoff_pkey;

-- One sign-off per (week, date); coalesce keeps the weekly (null-date) row unique.
create unique index if not exists idx_assembly_checklist_signoff_unique
    on assembly_checklist_signoff(week_id, (coalesce(entry_date, date '1900-01-01')));
