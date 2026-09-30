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
    check (entity in ('exam', 'paper', 'invigilator', 'override', 'print', 'room'));

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
-- Printed header text (used on the datesheet / admit-card PDFs). Central, so any module
-- can read it; examination just happens to host the edit UI for now.
alter table school_branding add column if not exists school_name varchar(256);
alter table school_branding add column if not exists motto varchar(256);
alter table school_branding add column if not exists address varchar(512);
-- Extra masthead fields the report card needs (edited on the same Branding page). board_logo is
-- the right-side board/affiliation crest (existing logo_file_id stays the school crest).
alter table school_branding add column if not exists affiliation_no varchar(64);
alter table school_branding add column if not exists school_code varchar(64);
alter table school_branding add column if not exists contact varchar(128);
alter table school_branding add column if not exists email varchar(128);
alter table school_branding add column if not exists website varchar(128);
alter table school_branding add column if not exists board_logo_file_id varchar(12);

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

-- ══ Phase 4: seating rooms ═══════════════════════════════════════════════════════
-- A seating scheme layers physical exam ROOMS onto an exam. Each room seats a MIX of
-- sections by roll-range (the printed "Seating Plan"); a section may be split across
-- rooms (disjoint ranges). For a room-based exam (has_seating), invigilators are assigned
-- per ROOM per exam-day and attendance/signing pivot from section to room — the room's
-- occupants on a date are the sections in it that have a paper that day. Non-seating exams
-- keep the per-section invigilator flow. Rooms live inside one exam; a "copy from another
-- exam" clones the scheme.

-- Whether this exam uses the seating-room scheme. Null/true-or-false set in app; when off
-- the section-based invigilator flow is used.
alter table examination add column if not exists has_seating boolean;

-- exam_room: one physical room within an exam (e.g. "1A", "III", "Library").
create table if not exists exam_room (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    name varchar(64) not null,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_exam_room_exam
    on exam_room(school_id, exam_id, status);

-- exam_room_allocation: a section's roll-range seated in a room. roll_from/roll_to are the
-- plan's stated numbers; they resolve to students via student_class.roll_number when it is
-- populated, otherwise they are shown as labels (roll numbers aren't captured yet).
create table if not exists exam_room_allocation (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    room_id varchar(12) not null,
    section_class_id varchar(12) not null,
    grade varchar(16),
    roll_from integer,
    roll_to integer,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
-- Per-date seating override: a room's allocation normally applies to EVERY exam date
-- (exam_date null = the base plan). A row with a specific exam_date overrides that room's
-- seating for that one day only — so a day with a different layout (e.g. the last day, when
-- some grades are done and students are merged into fewer rooms) can be captured without
-- disturbing the base plan. Resolution per (room, date): use the room's date-specific rows if
-- any exist for that date, else its base (null) rows.
alter table exam_room_allocation add column if not exists exam_date date;
create index if not exists idx_exam_room_alloc_room
    on exam_room_allocation(school_id, room_id, status);
create index if not exists idx_exam_room_alloc_exam
    on exam_room_allocation(school_id, exam_id, status);
create index if not exists idx_exam_room_alloc_room_date
    on exam_room_allocation(room_id, exam_date, status);

-- exam_room_invigilator: invigilator(s) assigned to a room for one exam day. MULTIPLE active
-- invigilators per (room, date) are allowed (Phase 5: shift hand-offs) — each may carry a
-- shift label + from/to time (HH:MM) so partial duties are logged and an on-duty teacher is
-- never shown as Free. One employee may still cover several rooms a day (warned in UI).
create table if not exists exam_room_invigilator (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    room_id varchar(12) not null,
    exam_date date not null,
    employee_id varchar(12) not null,
    shift_label varchar(32),
    from_time varchar(5),
    to_time varchar(5),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
-- Phase 5: multiple invigilators per (room, date) — the old one-per-cell unique index is
-- dropped, and shift/time columns added (idempotent for existing installs).
drop index if exists idx_exam_room_invig_cell;
alter table exam_room_invigilator add column if not exists shift_label varchar(32);
alter table exam_room_invigilator add column if not exists from_time varchar(5);
alter table exam_room_invigilator add column if not exists to_time varchar(5);
create index if not exists idx_exam_room_invig_cell
    on exam_room_invigilator(exam_id, room_id, exam_date) where status = 'active';
create index if not exists idx_exam_room_invig_exam
    on exam_room_invigilator(school_id, exam_id, status);

-- exam_reliever (Phase 5b): a day-level pool of break-cover floaters per (exam, date) — not
-- tied to a room. They are on floor duty across ALL rooms that day (deliver papers, relieve
-- invigilators) and DO countersign each room roster (role_label='reliever'); their signature
-- is on the room sheet only, never on the admit card. A person can't be both a room
-- invigilator and a reliever on the same date (enforced in app).
create table if not exists exam_reliever (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    exam_date date not null,
    employee_id varchar(12) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_exam_reliever_exam
    on exam_reliever(school_id, exam_id, status);
create unique index if not exists idx_exam_reliever_cell
    on exam_reliever(exam_id, exam_date, employee_id) where status = 'active';

-- Room-based marking/signing reuses exam_attendance (keyed by exam_paper + student); the
-- room the student was marked in is stamped here so signing can group by (room, date).
alter table exam_attendance add column if not exists room_id varchar(12);

-- Phase 5: god/admin corrections to a SIGNED roster retain the invigilator's signature
-- (rule b) — these columns record who altered it afterwards and when, so the card and the
-- 360 view can show "corrected by <name> on <date>" alongside the original signature.
alter table exam_attendance add column if not exists corrected_by_employee_id varchar(12);
alter table exam_attendance add column if not exists corrected_at timestamp(0);

-- exam_roster_signature (Phase 5): the record of daily roster signing events. MANY signers
-- may sign one roster — each room (or section) has one row PER signer, tagged role_label
-- ('invigilator' | 'reliever' | 'incharge'). The drawn signature PNG is anchored to THAT
-- row's uuid in file_storage (entity_type='exam_roster_signature', entity_id=uuid — a clean
-- 12-char owner, mirroring the document-ack pattern). A fresh signature is drawn at each
-- submit. The AUTHORITATIVE signer (drives "submitted" + admit card + corrections) is the
-- invigilator row; reliever/incharge rows are additional countersignatures shown on the room
-- sheet only. god/admin corrections to a signed roster retain the invigilator's signature and
-- stamp corrected_by/at on the invigilator row. exam_attendance.signature_file_id keeps the
-- invigilator's signature as a denormalised pointer so the admit card renders without a join.
create table if not exists exam_roster_signature (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    -- 'r:<roomId>:<date>' (seating) | 'p:<paperId>:<sectionId>' (section) — the roster key.
    scope_key varchar(48) not null,
    room_id varchar(12),          -- set for seating rosters (powers the completion board)
    exam_date date,
    role_label varchar(16),       -- 'invigilator' | 'reliever' | 'incharge'
    signed_by_employee_id varchar(12),
    signed_at timestamp(0),
    signature_file_id varchar(12),
    corrected_by_employee_id varchar(12),
    corrected_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
alter table exam_roster_signature add column if not exists role_label varchar(16);
-- Legacy single-signer rows were always the invigilator's sign; tag them so the authoritative
-- lookup (role_label='invigilator') keeps returning them.
update exam_roster_signature set role_label = 'invigilator' where role_label is null;
-- Multi-signer: one row per (roster, signer). Replaces the old one-row-per-scope unique index.
drop index if exists idx_exam_roster_sig_scope;
create unique index if not exists idx_exam_roster_sig_scope_signer
    on exam_roster_signature(exam_id, scope_key, signed_by_employee_id);
create index if not exists idx_exam_roster_sig_scope
    on exam_roster_signature(exam_id, scope_key);
create index if not exists idx_exam_roster_sig_room
    on exam_roster_signature(school_id, exam_id, room_id);

-- Phase 5c: AV room. A single special room per seating exam (exam_room.kind = 'av'; seating
-- rooms are 'seating'/null), auto-created and active on EVERY exam date. It holds students who
-- aren't sitting a paper (or need assembling), so its roster is AD-HOC — the supervisor adds
-- the specific students present that day into exam_av_occupant (self-contained present/absent,
-- NOT exam_attendance since there's no paper) and signs it like any room (owner-row signature).
alter table exam_room add column if not exists kind varchar(16);

create table if not exists exam_av_occupant (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    exam_id varchar(12) not null,
    exam_date date not null,
    student_id varchar(12) not null,
    status varchar(16) check (status in ('present', 'absent')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_av_occupant_cell
    on exam_av_occupant(exam_id, exam_date, student_id);
create index if not exists idx_exam_av_occupant_day
    on exam_av_occupant(school_id, exam_id, exam_date);

-- ══ Report cards (Term-1 marks + co-scholastic → Achievement Record) ══════════════════
-- A data-driven report card. A `scheme` per (school, academic-year, grade band) is the
-- blueprint; every column/area/grade is a row, so the three bands (1-3, 4-5, 6-9) differ by
-- DATA not code, and one renderer draws them all. Student values (marks, area grades, header)
-- reference the scheme by STABLE CODES, never a hard FK — an edit to a label never touches data.
-- Everything carries academic_year_id + (for values) term, so years/terms stand alone.

-- exam_report_scheme: the card blueprint for a grade band.
create table if not exists exam_report_scheme (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    band varchar(16) not null,               -- '1-3' | '4-5' | '6-9' | 'pre-primary'
    name varchar(128) not null,
    applies_to_grades varchar(128) not null,  -- csv of class-name grade prefixes, e.g. 'I,II,III'
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_report_scheme_band
    on exam_report_scheme(school_id, academic_year_id, band) where status = 'active';

-- exam_report_component: the NUMERIC columns of a scheme, PER TERM (Term-1 and Term-2 are
-- different rows). code is unique within (scheme, term); marks reference it by code.
create table if not exists exam_report_component (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    scheme_id varchar(12) not null,
    term smallint not null,                   -- 1 | 2
    code varchar(24) not null,                -- 'PT1','CT1','NB1','SEA1','CP1','ORAL1','HY'...
    label varchar(64) not null,               -- 'PT-I', 'Half Yearly'...
    max_marks integer not null,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_exam_report_component_scheme
    on exam_report_component(scheme_id, term, status);

-- exam_report_subject: the subject ROWS of a scheme (NOT per term — same subjects both terms).
-- report_label is the printed name (can differ per band); syllabus_subject is the name matched
-- against the syllabus plan to resolve the teacher for marks-entry access.
create table if not exists exam_report_subject (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    scheme_id varchar(12) not null,
    code varchar(24) not null,                -- 'ENG','HIN','MATH','EVS','SCI','SST','COMP'
    report_label varchar(64) not null,        -- 'EVS', 'Social Science'...
    syllabus_subject varchar(128),            -- comma list of syllabus_subject names (teacher link)
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_exam_report_subject_scheme
    on exam_report_subject(scheme_id, status);
-- Optional per-subject grade scope WITHIN a band (comma list of grades, e.g. 'VI,VII,VIII').
-- null/blank = applies to every grade the band covers. Lets a band-level scheme carry a subject
-- (e.g. Sanskrit in 6-9) that only some of its grades actually take.
alter table exam_report_subject add column if not exists applies_to_grades varchar(64);

-- exam_report_area: the GRADE-only rows (co-scholastic / personality / other), grouped by
-- section. scale_kind names which grade scale its dropdown+legend use. value_type 'grade' (a
-- letter) or 'text' (free text, e.g. pre-primary "At school I enjoy").
create table if not exists exam_report_area (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    scheme_id varchar(12) not null,
    section varchar(48) not null,             -- 'Co-Scholastic' | 'Personality Development' | 'Other Areas'
    label varchar(128) not null,
    scale_kind varchar(24) not null,          -- 'coscholastic' (matches exam_report_grade_scale.kind)
    value_type varchar(8) not null,           -- 'grade' | 'text'
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_exam_report_area_scheme
    on exam_report_area(scheme_id, status);
-- Co-scholastic is MARKS-entered (value_type 'marks'): max_marks is the area's out-of (10 or 100),
-- scale_kind picks the grading table ('coscholastic' = /100 bands, 'coscholastic10' = /10 bands),
-- and denominator_editable=1 means the "out of" is entered per class at marking time (GA / Reasoning
-- / Value Education, whose denominator differs by class) and marks are scaled to % before grading.
alter table exam_report_area add column if not exists max_marks integer;
alter table exam_report_area add column if not exists denominator_editable smallint;

-- exam_report_grade_scale: the two legends (scholastic A1..E with % ranges; coscholastic A..D).
-- Per scheme so a band can diverge (e.g. pre-primary A+..D). scholastic rows drive the computed
-- subject grade (% -> letter); coscholastic rows are the class-teacher's allowed area choices.
create table if not exists exam_report_grade_scale (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    scheme_id varchar(12) not null,
    kind varchar(16) not null,                -- 'scholastic' | 'coscholastic'
    grade varchar(8) not null,                -- 'A1','A2',...,'E' | 'A','B','C','D'
    label varchar(64) not null,
    min_pct integer,                          -- scholastic only (inclusive)
    max_pct integer,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_exam_report_grade_scale_scheme
    on exam_report_grade_scale(scheme_id, kind, status);

-- exam_report: the per-student card header (attendance, house, remark, promoted-to, photo) for
-- one (student, academic-year, term). print_count/printed_at track system prints (Phase B).
create table if not exists exam_report (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    term smallint not null,
    student_id varchar(12) not null,
    class_id varchar(12) not null,
    attendance_present integer,
    attendance_total integer,
    house varchar(64),
    remark text,
    promoted_to varchar(64),
    photo_ref varchar(12),
    print_count integer,
    printed_at timestamp(0),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_report_cell
    on exam_report(school_id, academic_year_id, term, student_id) where status = 'active';

-- exam_report_config: per-(school, academic-year) report settings. `term2_starts_on` drives the
-- default term on the entry/report screens — before it → Term 1, on/after → Term 2 (blank →
-- always Term 1). Never hard-coded; the school sets the date.
create table if not exists exam_report_config (
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    term2_starts_on date,
    updatedby_userid varchar(12),
    updated_at timestamp(0),
    primary key (school_id, academic_year_id)
);
-- remark_required_final=1 → the class-teacher remark is mandatory when saving co-scholastic for the
-- FINAL term (Term 2); Term 1 is never required. Blank/0 = optional always.
alter table exam_report_config add column if not exists remark_required_final smallint;

-- exam_report_teacher: the exam-incharge's explicit teacher assignment for a (class, report
-- subject). ONE teacher per subject. When set, it OVERRIDES the syllabus-derived access (so
-- marks-entry no longer depends on the fuzzy syllabus name match); when absent, access falls
-- back to the syllabus offering. Per academic year.
create table if not exists exam_report_teacher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12) not null,
    subject_code varchar(24) not null,        -- exam_report_subject.code
    teacher_id varchar(12) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_report_teacher_cell
    on exam_report_teacher(school_id, academic_year_id, class_id, subject_code) where status = 'active';

-- exam_report_mark: one student's mark for a (subject, component) in a term. subject_teacher-entered.
create table if not exists exam_report_mark (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    term smallint not null,
    student_id varchar(12) not null,
    class_id varchar(12) not null,
    subject_code varchar(24) not null,        -- exam_report_subject.code
    component_code varchar(24) not null,      -- exam_report_component.code
    value numeric(6,2),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_report_mark_cell
    on exam_report_mark(school_id, academic_year_id, term, student_id, subject_code, component_code);
create index if not exists idx_exam_report_mark_class
    on exam_report_mark(school_id, academic_year_id, term, class_id, subject_code);
-- absent=1 → the student was Absent for this component (entered as 'A'); prints as a red-circle A.
alter table exam_report_mark add column if not exists absent smallint;

-- exam_report_area_grade: one student's grade (or free text) for an area in a term. class_teacher-entered.
create table if not exists exam_report_area_grade (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    term smallint not null,
    student_id varchar(12) not null,
    class_id varchar(12) not null,
    area_id varchar(12) not null,             -- exam_report_area.uuid
    grade varchar(8),
    text_value text,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_exam_report_area_grade_cell
    on exam_report_area_grade(school_id, academic_year_id, term, student_id, area_id);
create index if not exists idx_exam_report_area_grade_class
    on exam_report_area_grade(school_id, academic_year_id, term, class_id);
-- Co-scholastic value_type 'marks': marks = the entered score, max_marks = the effective out-of
-- (area.max_marks, or the per-class denominator for GA/Reasoning/Value Education); grade is computed
-- at render, not stored. absent=1 → Absent (red-circle A). (grade/text_value stay for pre-primary
-- direct-grade areas + text areas.)
alter table exam_report_area_grade add column if not exists marks numeric(6,2);
alter table exam_report_area_grade add column if not exists max_marks numeric(6,2);
alter table exam_report_area_grade add column if not exists absent smallint;
