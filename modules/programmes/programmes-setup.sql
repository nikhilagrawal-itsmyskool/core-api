-- Programmes Module Schema — Phase 1 (content delivery)
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- A generic host for developmental / co-curricular programmes. The first programme is
-- "Spoken English & Life Communication" (Nursery-XII); a future programme (Scout, etc.)
-- is another `programme` row + its seeded masters + imported content, NOT a new module.
--
-- The hybrid model: controlled VOCABULARY is small stable tables (the backbone that later
-- search/assessment/reporting joins to); per-month CONTENT is a JSON document on the unit
-- (read/edited as a whole, never row-by-row). 8 tables total.
--
--   programme                - root: one row per programme per school (SELC, SCOUT, ...)
--   programme_field_type     - the monthly field headings/order (F01..F15 for SELC); per programme
--   programme_material_type  - controlled material/activity types (MT01..MT15 for SELC)
--   programme_domain         - controlled life/context domains (D01..D24 for SELC)
--   programme_skill          - controlled communication skills (~40 for SELC)
--   programme_stage          - per-grade developmental band/focus master
--   programme_unit           - the monthly unit; holds its 15 fields + focus skills as JSON
--   programme_source_doc     - the stored class-module .docx per grade (download / re-upload)
--
-- Later phases (designed in DESIGN.md, NOT created here): content_item, support_block,
-- toolkit, level, observation, unit_revision. Re-upload overwrites content wholesale (with a
-- UI confirm); the prior-content snapshot (unit_revision) is a Phase-4 safety net, deferred.

-- Table 1: programme (root)
create table if not exists programme (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    code varchar(32) not null,
    name varchar(128) not null,
    motto varchar(256),
    philosophy text,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_programme_code_unique
    on programme(school_id, lower(code)) where status = 'active';
create index if not exists idx_programme_school on programme(school_id);

-- Programme-level teacher guidance: an ordered jsonb array of short "how to teach this
-- programme" principles, shown as one collapsed card at the top of the teacher reader
-- (distinct from each unit's month-specific F14 Teacher Guidance). Added idempotently.
alter table programme add column if not exists teacher_guidance jsonb;

-- Table 2: programme_field_type (the monthly field headings + order; F01..F15 for SELC)
-- The unit's `fields` JSON stores code -> content; labels and display order live HERE.
create table if not exists programme_field_type (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    programme_id varchar(12) not null,
    code varchar(16) not null,
    name varchar(128) not null,
    seq integer not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_prog_field_type_unique
    on programme_field_type(programme_id, lower(code)) where status = 'active';
create index if not exists idx_prog_field_type_prog on programme_field_type(programme_id) where status = 'active';

-- Table 3: programme_material_type (controlled activity/resource types; MT01..MT15 for SELC)
create table if not exists programme_material_type (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    programme_id varchar(12) not null,
    code varchar(16) not null,
    name varchar(128) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_prog_material_type_unique
    on programme_material_type(programme_id, lower(code)) where status = 'active';
-- Name-level guard against near-duplicates ("Role Play" vs "Roleplay") within a programme.
create unique index if not exists idx_prog_material_type_name_unique
    on programme_material_type(programme_id, lower(name)) where status = 'active';

-- Table 4: programme_domain (controlled life/context domains; D01..D24 for SELC)
create table if not exists programme_domain (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    programme_id varchar(12) not null,
    code varchar(16) not null,
    name varchar(128) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_prog_domain_unique
    on programme_domain(programme_id, lower(code)) where status = 'active';
create unique index if not exists idx_prog_domain_name_unique
    on programme_domain(programme_id, lower(name)) where status = 'active';

-- Table 5: programme_skill (controlled communication skills; ~40 for SELC)
-- Kept as rows (not JSON) because Phase-3 observations join on skill uuid for longitudinal
-- reporting ("Questioning progression Nursery->XII"), and dashboards group by skill.
create table if not exists programme_skill (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    programme_id varchar(12) not null,
    category varchar(64) not null,
    name varchar(128) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Skill names are unique within a programme (category is descriptive, not part of identity).
create unique index if not exists idx_prog_skill_name_unique
    on programme_skill(programme_id, lower(name)) where status = 'active';
create index if not exists idx_prog_skill_prog on programme_skill(programme_id) where status = 'active';

-- Table 6: programme_stage (per-grade developmental band/focus master)
create table if not exists programme_stage (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    programme_id varchar(12) not null,
    grade varchar(32) not null,
    seq integer not null,
    developmental_band varchar(64),
    master_focus varchar(256),
    stage_emphasis varchar(256),
    assessment_band varchar(16) not null check (assessment_band in ('early', 'i_viii', 'ix_xii')),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_prog_stage_unique
    on programme_stage(programme_id, lower(grade)) where status = 'active';
create index if not exists idx_prog_stage_prog on programme_stage(programme_id) where status = 'active';

-- Table 7: programme_unit (the monthly unit — one row is one whole teacher page)
-- Content is stored as JSON on the row:
--   fields          jsonb  - { "F01": "...", "F04": "...", ... }  the 15 field contents by code
--   focus_skill_ids jsonb  - ["<skill_uuid>", ...]  ordered 3-5 monthly focus skills
-- Field labels/order come from programme_field_type; focus-skill names from programme_skill.
-- workflow_status carries the full enum from day 1 but Phase 1 only operates draft/published
-- (review/approve gates come in Phase 4).
create table if not exists programme_unit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    programme_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    grade varchar(32) not null,
    month varchar(16) not null check (month in (
        'april','may','june','july','august','september',
        'october','november','december','january','february','march')),
    title text not null,
    programme_focus varchar(256),
    primary_domain_id varchar(12),
    fields jsonb,
    focus_skill_ids jsonb,
    workflow_status varchar(16) not null check (workflow_status in (
        'draft','reviewed','approved','published','archived')),
    version integer not null,
    source_file_id varchar(12),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One unit per (programme, year, grade, month).
create unique index if not exists idx_prog_unit_unique
    on programme_unit(programme_id, academic_year_id, lower(grade), month) where status = 'active';
-- Teacher reader lookup: a programme's units for a grade in a year (then filter by month in app).
create index if not exists idx_prog_unit_scope
    on programme_unit(programme_id, academic_year_id, lower(grade)) where status = 'active';
create index if not exists idx_prog_unit_school on programme_unit(school_id);

-- Table 8: programme_source_doc (the stored class-module .docx, one per grade)
-- The 15 SELC class modules are per-grade documents (one file = one grade x 11 months).
-- This is the downloadable "document library": download the current .docx, edit in Word,
-- re-upload -> the importer re-parses and OVERWRITES each month's unit content wholesale
-- (UI confirms "this replaces current content for Class X"). version bumps on each upload.
-- file_id -> shared file_storage (entity_type='programme_source', entity_id=this uuid).
create table if not exists programme_source_doc (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    programme_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    grade varchar(32) not null,
    file_id varchar(12),
    version integer not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One current source document per (programme, year, grade).
create unique index if not exists idx_prog_source_doc_unique
    on programme_source_doc(programme_id, academic_year_id, lower(grade)) where status = 'active';
create index if not exists idx_prog_source_doc_school on programme_source_doc(school_id);
