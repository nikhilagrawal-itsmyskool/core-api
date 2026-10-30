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

-- ── TC-specific printed fields (CBSE-style certificate) ──────────────────────
-- Identity fields (name, parents, DOB, nationality, category, admission date,
-- class) are DERIVED live at print time from the student record and are NOT
-- stored here. These columns hold only the TC-specific values the operator
-- chooses/edits on the form (prefilled from transfer_config defaults + derivation),
-- stored so a reprint stays stable even if config/derivation later changes.
alter table student_tc add column if not exists tc_number varchar(32);                 -- "TC No." e.g. DRBPASN/T.C.137
alter table student_tc add column if not exists book_no varchar(32);                    -- register "Book No." e.g. 2/2022
alter table student_tc add column if not exists result varchar(64);                     -- field 9: annual exam result
alter table student_tc add column if not exists failed_in_class varchar(16);            -- field 10: no/once/twice
alter table student_tc add column if not exists subjects_studied varchar(1024);         -- field 11: ordered subject list
alter table student_tc add column if not exists qualified_for_promotion varchar(8);     -- field 12: yes/no
alter table student_tc add column if not exists dues_paid_upto varchar(16);             -- field 13: month e.g. MARCH
alter table student_tc add column if not exists fee_concession varchar(256);            -- field 14: NO / nature
alter table student_tc add column if not exists ncc_scout_guide varchar(128);           -- field 17
alter table student_tc add column if not exists games_activities varchar(512);          -- field 18
alter table student_tc add column if not exists general_conduct varchar(64);            -- field 19
alter table student_tc add column if not exists remarks varchar(1024);                  -- field 23: any other remarks
alter table student_tc add column if not exists printed_at timestamp(0);                -- last print
alter table student_tc add column if not exists print_count int;                        -- times printed

-- Identity OVERRIDES: normally derived live from the student record, but stored here when
-- the operator fills/corrects them (e.g. sparse left-student imports with no DOB/parents).
-- Print uses override-if-present, else the live-derived value.
alter table student_tc add column if not exists mother_name varchar(128);
alter table student_tc add column if not exists father_name varchar(128);
alter table student_tc add column if not exists dob date;
alter table student_tc add column if not exists nationality varchar(64);
alter table student_tc add column if not exists category varchar(64);
alter table student_tc add column if not exists first_admission_date date;

-- ── Per-school TC configuration (god-only Config screen) ─────────────────────
-- One row per school; factory defaults live in transfer-constants.ts when absent.
-- Holds dropdown option-sets + default values so the certificate adapts school to
-- school without code changes. CBSE Reg No. + school masthead live in school_branding
-- (central), NOT here — only the TC register "book no" and number formats live here.
create table if not exists transfer_config (
    school_id varchar(12) primary key,
    dues_gate_mode varchar(16) check (dues_gate_mode in ('block', 'warn', 'off')),  -- issue gate on outstanding fees
    tc_book_no varchar(32),                 -- default register book no (e.g. 2/2022)
    srn_prefix varchar(64),                 -- S.R.N. prefix (e.g. "DBPASN TC/")
    tc_number_prefix varchar(64),           -- TC No. prefix (e.g. "DRBPASN/T.C.")
    default_result varchar(64),
    default_conduct varchar(64),
    default_promotion varchar(8),           -- yes/no
    default_failed varchar(16),             -- no/once/twice
    default_dues_paid_upto varchar(16),     -- e.g. MARCH
    default_ncc varchar(128),               -- e.g. "-"
    result_options jsonb,                   -- allowed values for field 9 dropdown
    conduct_options jsonb,                  -- allowed values for field 19 dropdown
    auto_derive_subjects boolean,           -- prefill field 11 from exam report scheme
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
