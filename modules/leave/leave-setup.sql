-- Leave module schema.
-- All SQL lowercase, no foreign keys, enum fields via CHECK, no DDL defaults, uuids
-- are varchar(12), soft delete via status, idempotent (IF NOT EXISTS). Safe to re-run.
--
-- Staff leave: application -> approval, a monthly casual-leave (CL) quota, a per-day
-- approval cap, and (phase 2/3) biometric attendance import + reconciliation + an
-- escalating salary-deduction ladder. See modules/leave/DESIGN.md.
--
-- NAMING: the identity noun is `employee` (matches employee_login / JWT type). Leave
-- tables are `leave_*`. Attendance tables are `employee_attendance_*` (leave OWNS them
-- for now but they are named by domain so they lift out cleanly later).

-- leave_config: one active row per school (policy knobs; defaults set in app code).
create table if not exists leave_config (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    cl_per_month integer not null,
    daily_cap integer not null,
    reset varchar(16) not null check (reset in ('monthly')),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_leave_config_school
    on leave_config(school_id) where status = 'active';

-- leave_type: per-school leave types (policy lives in data). Seeded on first use.
create table if not exists leave_type (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    code varchar(16) not null,
    name varchar(64) not null,
    paid varchar(16) not null check (paid in ('yes', 'no', 'discretionary')),
    counts_vs_quota boolean not null,
    requires_attachment boolean not null,
    waivable boolean not null,
    approver_role varchar(16),
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'inactive', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_leave_type_unique
    on leave_type(school_id, lower(code)) where status <> 'deleted';

-- leave_application: one applied leave (a date range). Backdating allowed.
create table if not exists leave_application (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    employee_id varchar(12) not null,
    leave_type_code varchar(16) not null,
    from_date date not null,
    to_date date not null,
    working_days integer,
    reason text,
    status varchar(16) not null check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    applied_at timestamp(0),
    decided_by varchar(12),
    decided_at timestamp(0),
    decision_note varchar(256),
    waived boolean,
    waiver_reason varchar(256),
    attachment_file_id varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_leave_application_status on leave_application(school_id, status);
create index if not exists idx_leave_application_employee on leave_application(school_id, employee_id, from_date);
create index if not exists idx_leave_application_range on leave_application(school_id, from_date, to_date);

-- leave_audit: append-only log of every application state change.
create table if not exists leave_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    application_id varchar(12) not null,
    action varchar(16) not null,
    detail varchar(256),
    from_status varchar(16),
    to_status varchar(16),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_leave_audit_application on leave_audit(application_id);

-- ── Attendance (feed only; phase 2 populates these) ──────────────────────────
-- employee_biometric_map: resolves the device's enrollment code to an employee.
create table if not exists employee_biometric_map (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    enroll_code varchar(64) not null,
    employee_id varchar(12) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_employee_biometric_map_unique
    on employee_biometric_map(school_id, enroll_code) where status = 'active';

-- employee_attendance_import_batch: one row per biometric Excel upload.
create table if not exists employee_attendance_import_batch (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    file_name varchar(255),
    total_rows integer,
    matched integer,
    unmatched integer,
    suspect boolean,
    applied_by varchar(12),
    applied_at timestamp(0)
);
create index if not exists idx_employee_attendance_batch_school on employee_attendance_import_batch(school_id, applied_at);

-- employee_attendance_day: one present/absent row per employee per day.
create table if not exists employee_attendance_day (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    employee_id varchar(12) not null,
    att_date date not null,
    status varchar(16) not null check (status in ('present', 'absent', 'holiday', 'off', 'suspect', 'unknown')),
    first_in timestamp(0),
    last_out timestamp(0),
    minutes_worked integer,
    source varchar(16) check (source in ('biometric', 'manual')),
    import_batch_id varchar(12),
    override_note varchar(256),
    created_at timestamp(0),
    updated_at timestamp(0)
);
create unique index if not exists idx_employee_attendance_day_unique
    on employee_attendance_day(school_id, employee_id, att_date);

-- ── Deduction (phase 3 populates this) ───────────────────────────────────────
-- leave_deduction_run: monthly per-employee deduction summary (the payroll handoff).
create table if not exists leave_deduction_run (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    employee_id varchar(12) not null,
    run_year integer not null,
    run_month integer not null,
    paid_days integer,
    cl_used integer,
    authorized_unpaid_absences integer,
    unauthorized_absences integer,
    ladder_deduction_days integer,
    plain_lwp_days integer,
    applied_deduction_days integer,
    status varchar(16) not null check (status in ('draft', 'finalized')),
    generated_by varchar(12),
    generated_at timestamp(0),
    confirmed_by varchar(12),
    confirmed_at timestamp(0)
);
create unique index if not exists idx_leave_deduction_run_unique
    on leave_deduction_run(school_id, employee_id, run_year, run_month);
