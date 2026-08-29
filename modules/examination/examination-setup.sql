-- Examination module schema (Phase 1: schedule/datesheet + invigilator assignment).
-- Conventions: all lowercase, no foreign keys (validated in app), enum fields via
-- CHECK, no DDL defaults (set in app), uuids are varchar(12), soft delete via status,
-- idempotent (IF NOT EXISTS) so this file is the single canonical, re-runnable source.
--
-- v1 covers only the admit-card system. An `examination` is one exam event per
-- (school, academic_year) — e.g. "Half Yearly Examination". Its datesheet is a
-- per-GRADE grid: one `exam_paper` per (exam, grade, date) carrying a free-text
-- subject label (grades I..IX; column count varies by grade; "---" cells are simply
-- absent). Invigilators are assigned per (exam, date, section-class). Later phases add
-- admit-card identity, exam attendance + signatures, dues overrides and print logs.

-- ── examination: the exam header + per-exam configuration ────────────────────────
create table if not exists examination (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    name varchar(128) not null,
    -- draft while building the grid + assigning invigilators; published unlocks
    -- admit-card printing and the invigilator PWA; archived hides it.
    status varchar(16) not null check (status in ('draft', 'published', 'archived', 'deleted')),
    -- the assigned exam incharge (employee uuid); footer signature source later.
    incharge_employee_id varchar(12),
    -- per-exam, god-editable dues thresholds (amount). Blank/0 until Phase 2.
    dues_threshold_current numeric,
    dues_threshold_prior numeric,
    -- remembered admit-cards-per-A4-page default (3 or 4). App sets on first print.
    cards_per_page integer,
    -- schema-ready; derived from papers or entered.
    start_date date,
    end_date date,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_examination_school_year
    on examination(school_id, academic_year_id, status);

-- Which grades this exam covers (comma-separated grade labels, e.g. 'I,II,...,IX').
-- Null = all grades that have sections in the year (backward-compatible default). The
-- datesheet grid shows only these columns.
alter table examination add column if not exists grades varchar(256);

-- Dues cutoff: the admit-card gate checks academic dues due ON OR BEFORE this date
-- (typically set to a fee cycle's due date, e.g. "clear dues till Aug end"). Null =
-- fall back to "due now" (arrears through the end of the current month).
alter table examination add column if not exists dues_cutoff_date date;

-- Exam type = which features it uses. Some exams (e.g. an oral test) are just a
-- datesheet: no invigilator assignment, no admit cards. Null is treated as TRUE in code
-- so existing exams keep both.
alter table examination add column if not exists has_invigilation boolean;
alter table examination add column if not exists has_admit_cards boolean;

-- Free-text notes printed under the datesheet PDF (one per line). Null = a standard set.
alter table examination add column if not exists datesheet_notes text;

-- ── exam_paper: one cell of the grade × date datesheet ───────────────────────────
-- `grade` is the grade-label prefix of the class name (I-A -> I). One active paper per
-- (exam, grade, exam_date). `subject_label` is free text (e.g. "G.K., Value Edu.,
-- Reasoning & Art") — exam subjects are kept independent of timetable/syllabus.
create table if not exists exam_paper (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    grade varchar(16) not null,
    exam_date date not null,
    subject_label varchar(256) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_paper_cell
    on exam_paper(exam_id, grade, exam_date) where status = 'active';
create index if not exists idx_exam_paper_exam
    on exam_paper(school_id, exam_id, status);

-- ── exam_invigilator: per (exam, date, section) assignment ───────────────────────
-- The paper a section sits on a date = exam_paper where grade = the section's grade
-- prefix and exam_date matches. One active invigilator per (exam, date, section).
-- Double-booking one employee across sections on a date is allowed (warned in the UI).
create table if not exists exam_invigilator (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    exam_date date not null,
    section_class_id varchar(12) not null,
    employee_id varchar(12) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_invigilator_cell
    on exam_invigilator(exam_id, exam_date, section_class_id) where status = 'active';
create index if not exists idx_exam_invigilator_exam
    on exam_invigilator(school_id, exam_id, status);

-- ── exam_audit: append-only log of examination changes (who / what / when) ────────
create table if not exists exam_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12),
    entity varchar(16) check (entity in ('exam', 'paper', 'invigilator', 'override', 'print')),
    action varchar(24),
    detail varchar(512),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_exam_audit_exam
    on exam_audit(school_id, exam_id, changed_at);

-- `create table if not exists` does NOT widen an existing table's CHECK, so the entity
-- enum is (re)applied explicitly and idempotently — Phase 1 created exam_audit with only
-- ('exam','paper','invigilator'); Phase 2 adds 'override'/'print'.
alter table exam_audit drop constraint if exists exam_audit_entity_check;
alter table exam_audit add constraint exam_audit_entity_check
    check (entity in ('exam', 'paper', 'invigilator', 'override', 'print'));

-- ══ Phase 2: admit cards, dues overrides, print log, branding ════════════════════

-- exam_admit_card: the STABLE identity for a student's admit card in one exam. Created
-- lazily on first generation/print and reused thereafter; its `uuid` is what the staff
-- QR encodes, so regeneration/reprints resolve to the same live card.
create table if not exists exam_admit_card (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    student_id varchar(12) not null,
    section_class_id varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0)
);
create unique index if not exists idx_exam_admit_card_student
    on exam_admit_card(exam_id, student_id);
create index if not exists idx_exam_admit_card_exam
    on exam_admit_card(school_id, exam_id);
-- Track whether/when a student's card was last printed (so the roster can show "printed"
-- and the office doesn't reselect it) and how many times (lost-card reprints).
alter table exam_admit_card add column if not exists printed_at timestamp(0);
alter table exam_admit_card add column if not exists print_count integer;

-- exam_dues_override: a god decision to allow printing a dues-blocked student's card.
-- Persisted (who/when/reason) so later prints/reprints go through without re-approval.
create table if not exists exam_dues_override (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    student_id varchar(12) not null,
    approved_by_userid varchar(12),
    reason varchar(512),
    status varchar(16) not null check (status in ('active', 'revoked')),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_dues_override_student
    on exam_dues_override(exam_id, student_id) where status = 'active';
create index if not exists idx_exam_dues_override_exam
    on exam_dues_override(school_id, exam_id, status);

-- exam_print_log: append-only print audit (who printed which class, when, how many
-- pages) so a "regenerated because lost" reprint is visible.
create table if not exists exam_print_log (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    section_class_id varchar(12),
    printedby_userid varchar(12),
    cards_per_page integer,
    student_count integer,
    page_count integer,
    reason varchar(24),
    note varchar(512),
    created_at timestamp(0)
);
create index if not exists idx_exam_print_log_exam
    on exam_print_log(school_id, exam_id, created_at);

-- school_branding: CENTRAL / shared per-school branding (school logo + office stamp),
-- NOT examination-specific. Examination is the first consumer; receipts/report-cards
-- can migrate onto it later (and the write endpoints can move to a dedicated config
-- module). Images live in file_storage (entity_type 'school_logo' / 'school_stamp');
-- these columns point at the active file uuids.
create table if not exists school_branding (
    school_id varchar(12) primary key,
    logo_file_id varchar(12),
    stamp_file_id varchar(12),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- ══ Phase 3: exam attendance + invigilator signatures ════════════════════════════

-- exam_attendance: per (paper-day, section, student) present/absent + the invigilator's
-- digital signature. A row exists once a student is marked. `signed_*` is stamped when
-- the invigilator signs the roster (one signature applied to every row of that
-- paper+section); the admit card then renders the signature image for present students
-- and "ABSENT" for absent ones on that day. `signature_file_id` snapshots which
-- signature image was used, so a later signature change doesn't rewrite history.
-- Employee signatures themselves live in file_storage (entity_type='employee_signature').
create table if not exists exam_attendance (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    exam_paper_id varchar(12) not null,
    exam_date date not null,
    section_class_id varchar(12) not null,
    student_id varchar(12) not null,
    status varchar(16) check (status in ('present', 'absent')),
    signed_by_employee_id varchar(12),
    signed_at timestamp(0),
    signature_file_id varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_attendance_cell
    on exam_attendance(exam_paper_id, student_id);
create index if not exists idx_exam_attendance_section
    on exam_attendance(school_id, exam_id, exam_paper_id, section_class_id);

-- exam_attendance_audit: append-only log of marking / signing (who / what / when).
create table if not exists exam_attendance_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12),
    exam_paper_id varchar(12),
    section_class_id varchar(12),
    student_id varchar(12),
    action varchar(24) check (action in ('mark_present', 'mark_absent', 'sign', 'resign', 'edit')),
    old_status varchar(16),
    new_status varchar(16),
    employee_id varchar(12),
    note varchar(256),
    at timestamp(0)
);
create index if not exists idx_exam_attendance_audit
    on exam_attendance_audit(school_id, exam_id, at);
