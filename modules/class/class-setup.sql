-- Class Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: every statement is additive + idempotent (IF NOT EXISTS guards).
--
-- The core `class` table itself lives in modules/db/db-create-1.sql. This file only
-- adds the columns/tables the class module owns (or needs guaranteed) on top of it.
-- Prefer adding new idempotent DDL HERE rather than accumulating one-off migrate files.

-- class.class_group_id — set by the timetable module for composite/co-scheduled
-- ("cohort") classes. Also ensured by timetable-setup.sql; kept here so the column
-- exists even on schools where timetable was never provisioned.
alter table class add column if not exists class_group_id varchar(12);

-- Stream taxonomy. Streams (e.g. XI-A splits into SCI = Science, COM = Commerce) are
-- modelled as stream-child `class` rows that point at their base class:
--   * class.base_class_id — parent (base) class uuid; null on a base/real class, set on a
--     stream-child row. This is the "is this a real, pickable class" signal the class
--     dropdown filters on (base_class_id is null), replacing the older class_group_id test.
--   * class.stream_code — SCI / COM on a stream-child row; null otherwise. Matches a
--     class_stream.code within the same school (no FK, by convention).
alter table class add column if not exists base_class_id varchar(12);
alter table class add column if not exists stream_code varchar(16);

-- class_stream: per-school stream lookup (SCI/Science, COM/Commerce). Seed-only for now
-- (no read/write API yet). Soft delete, partial-unique-where-active.
create table if not exists class_stream (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    code varchar(16) not null,
    name varchar(64) not null,
    seq integer,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_class_stream_code_school
    on class_stream(school_id, lower(code)) where status = 'active';
