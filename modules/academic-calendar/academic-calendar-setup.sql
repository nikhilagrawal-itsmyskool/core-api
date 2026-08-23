-- Academic-calendar module schema.
-- All SQL lowercase, no foreign keys, enum fields via CHECK, no DDL defaults, uuids
-- are varchar(12), soft delete via status, idempotent (IF NOT EXISTS).
--
-- A per-(school, academic_year) activity calendar keyed by date. Each date carries a
-- LIST of discrete entries; every entry belongs to a per-school configurable TYPE
-- (the "columns": Festivals, Important Days, Remembrance, Theme, Academics, ...).
-- New schools add their own types -> that is the customization surface. Holidays are
-- tracked separately (calendar_holiday) so the attendance module has one cheap table
-- to read; the daily Theme entry is what the assembly module surfaces.

-- calendar_type: per-school configurable entry type (a "column"). `code` is a stable
-- programmatic handle for the seeded types (theme/festival/...); custom types get a
-- slug. `name` is the display label the Excel header maps to on import.
create table if not exists calendar_type (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    code varchar(40) not null,
    name varchar(80) not null,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_calendar_type_code
    on calendar_type(school_id, code) where status = 'active';
create index if not exists idx_calendar_type_school
    on calendar_type(school_id, status);

-- calendar_entry: one discrete entry on a date under a type. `value` = the label
-- (activity/festival/personality name); `detail` = folded-in extra (e.g. the
-- personality's role for a Remembrance entry, or a short description). `end_date`
-- (nullable) is schema-ready for range/multi-day events; null = single day.
create table if not exists calendar_entry (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    entry_date date not null,
    end_date date,
    type_id varchar(12) not null,
    value varchar(512) not null,
    detail varchar(512),
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_calendar_entry_date
    on calendar_entry(school_id, academic_year_id, entry_date, status);
create index if not exists idx_calendar_entry_type
    on calendar_entry(school_id, type_id, status);

-- calendar_holiday: explicitly-marked non-teaching days (attendance reads this).
-- kind 'full' = school closed; 'restricted' = optional/RH (school open). Sundays are
-- NOT stored here -- the weekly-off rule is computed in code.
create table if not exists calendar_holiday (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    holiday_date date not null,
    name varchar(256),
    kind varchar(16) not null check (kind in ('full', 'restricted')),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_calendar_holiday_unique
    on calendar_holiday(school_id, academic_year_id, holiday_date) where status = 'active';
create index if not exists idx_calendar_holiday_range
    on calendar_holiday(school_id, academic_year_id, holiday_date, status);

-- Weekly-off configuration lives as a single column on the existing academic_year
-- row (per school + year) — NOT a new table. Comma-separated weekday numbers
-- (0=Sun … 6=Sat); null is treated as '0' (Sunday only). A day is "non-teaching"
-- when its weekday is in this set OR it has a full-holiday row in calendar_holiday.
alter table academic_year add column if not exists weekly_off varchar(16);

-- calendar_audit: append-only log of calendar changes (who / what / when).
create table if not exists calendar_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12),
    entity varchar(16) check (entity in ('type', 'entry', 'holiday')),
    entity_id varchar(12),
    entry_date date,
    action varchar(16) check (action in ('create', 'update', 'delete')),
    detail varchar(256),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_calendar_audit_school
    on calendar_audit(school_id, changed_at);
