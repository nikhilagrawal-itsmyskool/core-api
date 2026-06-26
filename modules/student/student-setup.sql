-- Student Module Schema (Phase 1 — admin foundation)
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.
--
-- The core `student` and `student_class` tables already live in modules/db/db-create-1.sql.
-- This file only adds the NEW tables/columns this module owns:
--   * house            - per-school House lookup (lifelong assignment)
--   * student.house_id - the lifelong House assignment (survives promotion)
--   * student_class.roll_number - per-year roll number
--   * student_guardian - one row per father/mother/guardian/other (names, occupation, etc.)
-- Photos for students and guardians are stored in the shared `file_storage` table
-- (entity_type 'student' / 'guardian'); no table is added for them here.

-- Table 1: house (managed per-school lookup)
create table if not exists house (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(96) not null,
    code varchar(32) not null,
    color varchar(16),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_house_school_status on house(school_id, status);
create unique index if not exists idx_house_code_unique on house(school_id, lower(code)) where status = 'active';

-- student.house_id — lifelong House assignment (nullable; survives promotion).
alter table student add column if not exists house_id varchar(12);

-- Drop the global UNIQUE on student.admission_number (multi-tenancy bug: two schools
-- could not reuse a number). Per-school uniqueness is already enforced by
-- idx_student_admission_number_school_id in db-create-1.sql.
alter table student drop constraint if exists student_admission_number_key;

-- student_class.status — soft-delete / lifecycle flag on the enrollment row.
-- (Original table has no status column; treated as active when null.)
alter table student_class add column if not exists status varchar(16);

-- student_class.roll_number — per-year roll number (nullable).
alter table student_class add column if not exists roll_number int;
create unique index if not exists idx_student_class_roll_unique
    on student_class(class_id, academic_year_id, roll_number)
    where status = 'active' and roll_number is not null;

-- Table 2: student_guardian (one row per guardian)
create table if not exists student_guardian (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    student_id varchar(12) not null,
    relation varchar(16) not null check (relation in ('father', 'mother', 'guardian', 'other')),
    name varchar(128),
    occupation varchar(128),
    address varchar(512),
    mobile varchar(20),
    whatsapp varchar(20),
    email varchar(255),
    is_primary_contact boolean,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_student_guardian_student on student_guardian(school_id, student_id, status);
