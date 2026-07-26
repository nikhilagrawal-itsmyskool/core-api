-- Syllabus Planner Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- Model:
--   syllabus_subject  - school-level catalog of syllabus subjects (own, not timetable's)
--   syllabus          - plan header per (school, academic_year, grade, subject)
--   syllabus_entry    - ordered month-wise rows (topics/sections/exams/revision/...)
--   syllabus_progress - per-section coverage marks against an entry

-- Table 1: syllabus_subject (school-level catalog)
create table if not exists syllabus_subject (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    description varchar(256),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- No duplicate subject name within a school (soft-delete aware, case-insensitive).
create unique index if not exists idx_syllabus_subject_name_unique
    on syllabus_subject(school_id, lower(name)) where status = 'active';
create index if not exists idx_syllabus_subject_school on syllabus_subject(school_id);

-- Table 2: syllabus (plan header; one shared plan per grade + subject + year)
create table if not exists syllabus (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    grade varchar(32) not null,
    subject_id varchar(12) not null,
    book varchar(256),
    layout varchar(16) not null check (layout in ('junior', 'senior')),
    note text,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Stream dimension (senior grades XI/XII): a plan may be scoped to a stream_code
-- (matches class_stream.code, e.g. SCI/COM). null = common subject, shown to
-- every stream of the grade. Added idempotently for existing deployments.
alter table syllabus add column if not exists stream_code varchar(16);

-- One plan per grade+stream+subject per academic year (soft-delete aware).
-- coalesce so a null stream (common) participates in uniqueness as a single slot.
drop index if exists idx_syllabus_unique;
create unique index if not exists idx_syllabus_unique
    on syllabus(school_id, academic_year_id, lower(grade), coalesce(lower(stream_code), ''), subject_id) where status = 'active';
create index if not exists idx_syllabus_school_year on syllabus(school_id, academic_year_id);
create index if not exists idx_syllabus_subject on syllabus(subject_id);

-- Table 3: syllabus_entry (ordered rows; months/topics/exams interleave via seq)
create table if not exists syllabus_entry (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    syllabus_id varchar(12) not null,
    seq integer not null,
    month varchar(16) not null check (month in (
        'april','may','june','july','august','september',
        'october','november','december','january','february','march')),
    entry_type varchar(16) not null check (entry_type in (
        'topic','section','activity','revision','exam','refresher','note')),
    topic_no varchar(16),
    title varchar(256) not null,
    theme varchar(128),
    page_ref varchar(32),
    term varchar(16) check (term in ('half_yearly','annual')),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_syllabus_entry_seq on syllabus_entry(syllabus_id, seq) where status = 'active';
create index if not exists idx_syllabus_entry_school on syllabus_entry(school_id);

-- Table 4: syllabus_progress (per-section coverage against an entry)
create table if not exists syllabus_progress (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    syllabus_entry_id varchar(12) not null,
    class_id varchar(12) not null,
    status varchar(16) not null check (status in ('pending', 'covered')),
    covered_date date,
    marked_by varchar(12),
    remark text,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One progress row per entry per section.
create unique index if not exists idx_syllabus_progress_unique
    on syllabus_progress(syllabus_entry_id, class_id);
create index if not exists idx_syllabus_progress_class on syllabus_progress(school_id, class_id);

-- Table 5: syllabus_plan_teacher (which teacher(s) teach a plan's subject to a section)
create table if not exists syllabus_plan_teacher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    syllabus_id varchar(12) not null,
    class_id varchar(12) not null,
    teacher_id varchar(12) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- A teacher is assigned at most once per (plan, section); many teachers per section allowed.
create unique index if not exists idx_syllabus_plan_teacher_unique
    on syllabus_plan_teacher(syllabus_id, class_id, teacher_id) where status = 'active';
create index if not exists idx_syllabus_plan_teacher_plan on syllabus_plan_teacher(syllabus_id) where status = 'active';
create index if not exists idx_syllabus_plan_teacher_teacher on syllabus_plan_teacher(school_id, teacher_id) where status = 'active';

-- Table 6: syllabus_model_paper (exam paper set per grade+stream+subject+exam).
-- Independent of the month-wise plan; a subject can have papers with no plan.
-- answer_key_released gates student visibility of the answer key (default false, app).
create table if not exists syllabus_model_paper (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    grade varchar(32) not null,
    stream_code varchar(16),
    subject_id varchar(12) not null,
    exam varchar(32) not null,
    answer_key_released boolean not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One paper set per (grade, stream, subject, exam) per year (coalesce null stream).
create unique index if not exists idx_model_paper_unique
    on syllabus_model_paper(school_id, academic_year_id, lower(grade), coalesce(lower(stream_code), ''), subject_id, lower(exam)) where status = 'active';
create index if not exists idx_model_paper_scope on syllabus_model_paper(school_id, academic_year_id, lower(grade)) where status = 'active';

-- Table 7: syllabus_model_paper_doc (the 3 documents of a paper set). Each holds a
-- Word (docx_file_id) and a generated PDF (pdf_file_id), both file_storage uuids.
-- pdf_status doubles as the conversion queue: 'pending' rows with a docx are picked
-- up by the LibreOffice worker, which sets pdf_file_id + 'ready' (or 'failed').
create table if not exists syllabus_model_paper_doc (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    model_paper_id varchar(12) not null,
    doc_type varchar(16) not null check (doc_type in ('model_paper', 'answer_key', 'blueprint')),
    docx_file_id varchar(12),
    pdf_file_id varchar(12),
    pdf_status varchar(16) not null check (pdf_status in ('pending', 'ready', 'failed', 'none')),
    pdf_attempts integer,
    pdf_error text,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One active doc per (paper, doc_type).
create unique index if not exists idx_model_paper_doc_unique
    on syllabus_model_paper_doc(model_paper_id, doc_type) where status = 'active';
-- Conversion queue lookup: pending docs that still need a PDF.
create index if not exists idx_model_paper_doc_pending
    on syllabus_model_paper_doc(school_id) where status = 'active' and pdf_status = 'pending';
