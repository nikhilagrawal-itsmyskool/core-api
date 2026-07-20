-- Assembly migration 5: house-mode CHECKLIST (Phase C).
-- A per-school configurable execution checklist (week-scoped and day-scoped
-- items), ticked against a roster week, plus a week-level sign-off. Recorded,
-- NOT a hard gate. Additive/idempotent; inert for 'template'-mode schools.

-- Per-school checklist catalog. phase = a free grouping label (e.g. "Before
-- assembly"); scope = 'week' (once per week) or 'day' (per assembly date).
create table if not exists assembly_checklist_item (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    phase varchar(64),
    scope varchar(8) not null check (scope in ('week', 'day')),
    text text not null,
    sort_order integer not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_assembly_checklist_item_school on assembly_checklist_item(school_id) where status = 'active';

-- A tick against a checklist item for a roster week. entry_date is null for
-- week-scoped items and the assembly date for day-scoped items. Ticking is
-- execution-time and NOT gated by the week lock.
create table if not exists assembly_checklist_tick (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    item_id varchar(12) not null,
    entry_date date,
    checked boolean,
    checkedby_userid varchar(12),
    checked_at timestamp(0)
);
-- One tick per (week, item, date). coalesce keeps week-scoped (null date) rows unique.
create unique index if not exists idx_assembly_checklist_tick_unique
    on assembly_checklist_tick(week_id, item_id, (coalesce(entry_date, date '1900-01-01')));
create index if not exists idx_assembly_checklist_tick_week on assembly_checklist_tick(week_id);

-- Week-level checklist sign-off (one per week).
create table if not exists assembly_checklist_signoff (
    week_id varchar(12) primary key,
    school_id varchar(12) not null,
    note text,
    signedby_userid varchar(12),
    signed_at timestamp(0)
);
