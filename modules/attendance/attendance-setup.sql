-- Attendance Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- Daily roll-call: one attendance_session per class per academic-year per date.
-- attendance_record holds one row per enrolled student for that session.
-- attendance_audit is an append-only log of every status change (initial mark,
-- finalize fill-in, and post-finalize edits) so corrections are never silent.

-- Table 1: attendance_session (the roll-call header; this row = "attendance taken")
create table if not exists attendance_session (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12) not null,
    attendance_date date not null,
    status varchar(16) not null check (status in ('open', 'finalized')),
    finalized_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One roll-call per class per day (per academic year).
create unique index if not exists idx_attendance_session_unique
    on attendance_session(school_id, academic_year_id, class_id, attendance_date);
create index if not exists idx_attendance_session_lookup
    on attendance_session(school_id, class_id, attendance_date);

-- Table 2: attendance_record (one per enrolled student per session)
create table if not exists attendance_record (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    session_id varchar(12) not null,
    student_id varchar(12) not null,
    status varchar(16) not null check (status in ('present', 'absent', 'late', 'leave')),
    remark text,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_attendance_record_unique on attendance_record(session_id, student_id);
create index if not exists idx_attendance_record_session on attendance_record(session_id);
create index if not exists idx_attendance_record_student on attendance_record(school_id, student_id);

-- Table 3: attendance_audit (append-only change log)
create table if not exists attendance_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    session_id varchar(12) not null,
    record_id varchar(12),
    student_id varchar(12) not null,
    old_status varchar(16),
    new_status varchar(16),
    source varchar(32) check (source in ('mark', 'edit', 'finalize')),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);

create index if not exists idx_attendance_audit_session on attendance_audit(session_id);
create index if not exists idx_attendance_audit_record on attendance_audit(record_id);
