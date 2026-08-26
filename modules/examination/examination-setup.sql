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
    entity varchar(16) check (entity in ('exam', 'paper', 'invigilator')),
    action varchar(24),
    detail varchar(512),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_exam_audit_exam
    on exam_audit(school_id, exam_id, changed_at);
