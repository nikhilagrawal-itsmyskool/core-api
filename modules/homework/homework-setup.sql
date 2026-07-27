-- Homework module schema.
-- All SQL lowercase, no foreign keys, enum fields via CHECK, no DDL defaults, uuids
-- are varchar(12), soft delete via status, idempotent (IF NOT EXISTS). Mirrors the
-- attendance module (per-(class,date) header + append-only audit).
--
-- A class teacher posts the day's homework as photos for a BASE class. The day is a
-- draft (private) until Published (visible to that class's students); Unpublish
-- returns it to draft to fix. Images live in the shared file_storage table
-- (entity_type='homework', entity_id=homework_item.uuid).

-- homework_day: one homework "post" per class per calendar day (per academic year).
create table if not exists homework_day (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12) not null,               -- BASE class (base_class_id is null)
    homework_date date not null,
    status varchar(16) not null check (status in ('draft', 'published')),
    published_at timestamp(0),
    publishedby_userid varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_homework_day_unique
    on homework_day(school_id, academic_year_id, class_id, homework_date);
create index if not exists idx_homework_day_lookup
    on homework_day(school_id, class_id, homework_date);

-- homework_item: one row per photo under a day, with an optional subject label + note.
create table if not exists homework_item (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    homework_day_id varchar(12) not null,
    subject_label varchar(64),
    note text,
    seq integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_homework_item_day on homework_item(homework_day_id, status);

-- homework_class_teacher: per-school admin OVERRIDE of the class -> class-teacher
-- mapping. Resolution = this override (if active) else the timetable class_teacher.
create table if not exists homework_class_teacher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12) not null,               -- BASE class
    teacher_id varchar(12) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_homework_class_teacher_unique
    on homework_class_teacher(school_id, academic_year_id, class_id) where status = 'active';

-- homework_audit: append-only log of every homework activity (who / what / when).
create table if not exists homework_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    homework_day_id varchar(12),
    item_id varchar(12),
    class_id varchar(12) not null,
    homework_date date,
    action varchar(16) check (action in ('upload', 'remove', 'edit', 'publish', 'unpublish')),
    detail varchar(256),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_homework_audit_day on homework_audit(homework_day_id);
create index if not exists idx_homework_audit_class_date on homework_audit(school_id, class_id, homework_date);
