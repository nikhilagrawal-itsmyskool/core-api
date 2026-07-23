-- Class migration 1: ensure the cohort column exists on the shared class table.
-- class.class_group_id is set by the timetable module for composite/co-scheduled
-- ("cohort") classes. The class dropdown search now hides those rows by default,
-- so the column must exist even on schools where timetable was never provisioned.
-- Additive + idempotent.

alter table class add column if not exists class_group_id varchar(12);
