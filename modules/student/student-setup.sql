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

-- Table 1b: house_teacher — a house's staff (in-charge / co-in-charge / member
-- teachers). A house-domain concept (independent of assembly); consumers like the
-- assembly module read it for house-on-duty display.
create table if not exists house_teacher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    house_id varchar(12) not null,
    employee_id varchar(12) not null,
    role varchar(16) not null check (role in ('incharge', 'coincharge', 'member')),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_house_teacher_unique on house_teacher(house_id, employee_id) where status = 'active';
create index if not exists idx_house_teacher_house on house_teacher(school_id, house_id) where status = 'active';

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

-- =====================================================================
-- Phase 2 — full student record (demographics, addresses, lookups,
-- siblings, photo variants). All additive; safe to re-run.
-- =====================================================================

-- student — new demographic / identity / lifecycle columns.
alter table student add column if not exists student_email varchar(255);
alter table student add column if not exists student_mobile varchar(20);
alter table student add column if not exists student_whatsapp varchar(20);
alter table student add column if not exists category_code varchar(32);       -- lookup: category
alter table student add column if not exists nationality_code varchar(32);     -- lookup: nationality
alter table student add column if not exists mother_tongue_code varchar(32);   -- lookup: mother_tongue
alter table student add column if not exists blood_group_code varchar(8);      -- lookup: blood_group
alter table student add column if not exists aadhaar_number varchar(20);
alter table student add column if not exists previous_school varchar(256);
alter table student add column if not exists admission_date date;              -- lifelong first admission
alter table student add column if not exists withdrawal_date date;
alter table student add column if not exists withdrawal_remarks varchar(512);

-- exam_only: student registered here but studying at another school — enrolled with
-- us only to sit exams. A student attribute (not a fee concept). The fees module reads
-- this flag to skip demand generation and to find/cancel demands for these students.
alter table student add column if not exists exam_only boolean;
alter table student add column if not exists exam_only_reason varchar(256);

-- rte: student admitted under the Right to Education (RTE) quota. A plain flag.
alter table student add column if not exists rte boolean;

-- student_class.join_date — "Date Of Joining" for that enrollment.
alter table student_class add column if not exists join_date date;

-- student_class.stream_code — the student's stream for this enrollment (e.g. SCI / COM
-- for XI/XII); null for classes without streams. Set at admission/edit (that flow lands
-- later); the shared effective-class resolver maps (class_id + stream_code) to the
-- stream-child class row. Matches a class_stream.code within the school (no FK).
alter table student_class add column if not exists stream_code varchar(16);

-- student_guardian — parent/guardian extended attributes.
alter table student_guardian add column if not exists relationship varchar(64);  -- specific label: uncle/sister/...
alter table student_guardian add column if not exists designation varchar(128);
alter table student_guardian add column if not exists organisation varchar(128);
alter table student_guardian add column if not exists education varchar(128);

-- Table 3: student_lookup (per-school coded reference data).
create table if not exists student_lookup (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    lookup_type varchar(32) not null,
    code varchar(64) not null,
    label varchar(256),
    extra jsonb,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_student_lookup_school_type on student_lookup(school_id, lookup_type, status);
create unique index if not exists idx_student_lookup_code_unique
    on student_lookup(school_id, lookup_type, lower(code)) where status = 'active';

-- Table 4: student_address (household addresses; is_permanent / is_communication flags).
create table if not exists student_address (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    student_id varchar(12) not null,
    is_permanent boolean,
    is_communication boolean,
    line varchar(512),
    locality_code varchar(64),   -- lookup: locality
    city_code varchar(64),       -- lookup: city
    state_code varchar(64),      -- lookup: state
    country_code varchar(64),    -- lookup: country
    pincode varchar(10),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_student_address_student on student_address(school_id, student_id, status);

-- Table 5: student_sibling (explicit links between enrolled students).
create table if not exists student_sibling (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    student_id varchar(12) not null,
    sibling_student_id varchar(12) not null,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_student_sibling_student on student_sibling(school_id, student_id, status);
create unique index if not exists idx_student_sibling_pair_unique
    on student_sibling(school_id, student_id, sibling_student_id) where status = 'active';

-- Widen code columns for tables created by an earlier revision (idempotent):
-- long state / auto-created city & locality codes need more than 32 chars.
alter table student_lookup alter column code type varchar(64);
alter table student_address alter column locality_code type varchar(64);
alter table student_address alter column city_code type varchar(64);
alter table student_address alter column state_code type varchar(64);
alter table student_address alter column country_code type varchar(64);

-- Shared file_storage gains a photo variant ('original' | 'thumb').
-- Null is treated as 'original' for legacy rows.
alter table file_storage add column if not exists variant varchar(16);
