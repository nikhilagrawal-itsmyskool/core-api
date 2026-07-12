-- Transfer Certificate (TC) module schema.
-- All SQL lowercase, no foreign keys, enum fields use CHECK constraints,
-- no DDL defaults (set in app code). Safe to re-run.

create table if not exists student_tc (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    student_id varchar(12) not null,
    application_date date,
    srn_number varchar(32),
    issue_date date,
    reason_for_leaving varchar(256),
    total_attendance_days int,
    total_working_days int,
    status varchar(16) check (status in ('applied', 'issued', 'cancelled', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_student_tc_student on student_tc(school_id, student_id, status);
