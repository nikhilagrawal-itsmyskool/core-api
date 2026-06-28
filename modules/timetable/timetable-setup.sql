-- Timetable Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- This module owns the academic backbone (subject, class<->subject demand,
-- teacher assignment) plus the day-varying grid, teacher constraints, the
-- generation job queue, candidate timetables, and the published master.
-- See DESIGN.md for the full design and rationale.

-- ---------------------------------------------------------------------------
-- Academic backbone
-- ---------------------------------------------------------------------------

-- subject: per-school subjects. Games and Library are subjects too.
create table if not exists subject (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    code varchar(32) not null,
    kind varchar(16) not null check (kind in ('academic', 'games', 'library', 'activity')),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_subject_school_status on subject(school_id, status);
create unique index if not exists idx_subject_code_unique on subject(school_id, lower(code)) where status = 'active';

-- class_group: a cohort of co-scheduled classes (e.g. a composite class like XI-A
-- whose Science + Commerce streams study some subjects together / share elective
-- bands). Member classes carry class.class_group_id; an elective_band pointing at a
-- class_group co-schedules across every member. See DESIGN.md "Composite classes".
create table if not exists class_group (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    name varchar(128) not null,
    code varchar(32),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_class_group_school_year on class_group(school_id, academic_year_id, status);

-- Forward-compatible link on the existing core class table (nullable, unused by v1).
alter table class add column if not exists class_group_id varchar(12);

-- class_subject: which subjects a class takes, how many periods/week, and the
-- block rules (e.g. two doubles + six singles). block_rules is jsonb; the app
-- enforces sum(size*count) == periods_per_week.
create table if not exists class_subject (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12) not null,
    subject_id varchar(12) not null,
    periods_per_week integer not null,
    block_rules jsonb,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_class_subject_school_year on class_subject(school_id, academic_year_id, status);
create index if not exists idx_class_subject_class on class_subject(class_id);
create unique index if not exists idx_class_subject_unique on class_subject(school_id, academic_year_id, class_id, subject_id) where status = 'active';

-- teaching_assignment: who teaches a given class+subject. Two rows (each with a
-- period_share) split one class+subject between two teachers. period_share null
-- means the teacher takes all of that class+subject's periods.
create table if not exists teaching_assignment (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12) not null,
    subject_id varchar(12) not null,
    teacher_id varchar(12) not null,
    period_share integer,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_teaching_assignment_school_year on teaching_assignment(school_id, academic_year_id, status);
create index if not exists idx_teaching_assignment_teacher on teaching_assignment(teacher_id);
create index if not exists idx_teaching_assignment_class on teaching_assignment(class_id);
create unique index if not exists idx_teaching_assignment_unique on teaching_assignment(school_id, academic_year_id, class_id, subject_id, teacher_id) where status = 'active';

-- class_teacher: the class teacher for a class in a given academic year. The
-- first teaching slot of every day for a class is pinned (hard) to its class
-- teacher (teaching one of the subjects they're assigned to that class); it
-- counts toward that subject's weekly periods and doubles as attendance.
-- teacher_id references an employee uuid. One class teacher per class per year.
create table if not exists class_teacher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12) not null,
    teacher_id varchar(12) not null,
    -- which of the class teacher's subjects is pinned to the first period each day.
    -- null = auto (the class teacher's subject with the most periods/week).
    first_period_subject_id varchar(12),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_class_teacher_school_year on class_teacher(school_id, academic_year_id, status);
create unique index if not exists idx_class_teacher_unique on class_teacher(school_id, academic_year_id, class_id) where status = 'active';

-- forward-compatible column for existing databases.
alter table class_teacher add column if not exists first_period_subject_id varchar(12);

-- first_period_days: jsonb array of weekdays (1=Mon..7=Sun) on which the class
-- teacher takes the 1st (first teaching) period. null = all teaching days (the
-- original behavior); [] = the class teacher takes no first period (floats).
alter table class_teacher add column if not exists first_period_days jsonb;

-- elective_band: a parallel option block. Several subject offerings run in the SAME
-- time slots; a student picks one. Shaped like class_subject (periods_per_week +
-- block_rules, sum(size*count) == periods_per_week).
-- Scope is EITHER a single class (class_id) OR a cohort (class_group_id): when
-- class_group_id is set the band co-schedules across every member class of the group
-- (a composite class like XI-A). Exactly one of the two is populated.
create table if not exists elective_band (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    class_id varchar(12),
    class_group_id varchar(12),
    name varchar(128) not null,
    periods_per_week integer not null,
    block_rules jsonb,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_elective_band_school_year on elective_band(school_id, academic_year_id, status);
create index if not exists idx_elective_band_class on elective_band(class_id);

-- forward-compatible for existing databases: cohort-scoped bands.
alter table elective_band add column if not exists class_group_id varchar(12);
alter table elective_band alter column class_id drop not null;

-- elective_offering: one subject choice inside a band, with its own teacher. All
-- offerings of a band are co-scheduled into the same slots, and each offering's
-- teacher is booked for those slots.
create table if not exists elective_offering (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    band_id varchar(12) not null,
    subject_id varchar(12) not null,
    teacher_id varchar(12) not null,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_elective_offering_band on elective_offering(band_id, status);
create unique index if not exists idx_elective_offering_unique on elective_offering(band_id, subject_id) where status = 'active';

-- timetable_wing: a named set of classes (e.g. primary / middle / senior) for an
-- academic year. Lives entirely in the timetable module — the core class table is
-- untouched. Generation/publish can target the whole school (no wing) or one wing
-- (its class subset). A class may belong to more than one wing.
create table if not exists timetable_wing (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    name varchar(128) not null,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_timetable_wing_school_year on timetable_wing(school_id, academic_year_id, status);
create unique index if not exists idx_timetable_wing_name_unique on timetable_wing(school_id, academic_year_id, lower(name)) where status = 'active';

-- timetable_wing_class: membership of a wing. One row per class in the wing.
create table if not exists timetable_wing_class (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    wing_id varchar(12) not null,
    class_id varchar(12) not null,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_timetable_wing_class_wing on timetable_wing_class(wing_id, status);
create unique index if not exists idx_timetable_wing_class_unique on timetable_wing_class(wing_id, class_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Grid (day-varying bell schedule)
-- ---------------------------------------------------------------------------

-- timetable_config: one configuration per academic year (the grid + the run
-- target). status archived once superseded.
create table if not exists timetable_config (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    name varchar(128) not null,
    status varchar(16) check (status in ('active', 'archived')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_timetable_config_school_year on timetable_config(school_id, academic_year_id, status);

-- Lock lifecycle: locked_at null = draft (freely editable); non-null = locked
-- (immutable, and the only state usable for generation). Unlock is allowed only
-- while unused by any generation_run; otherwise clone to revise.
alter table timetable_config add column if not exists locked_at timestamp(0);
alter table timetable_config add column if not exists lockedby_userid varchar(12);

-- day_structure: one row per active weekday of a config (1=Mon .. 7=Sun), so the
-- grid can vary day to day (e.g. a half-day Saturday).
create table if not exists day_structure (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    config_id varchar(12) not null,
    day_of_week integer not null,
    label varchar(64),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_day_structure_config on day_structure(config_id);
create unique index if not exists idx_day_structure_unique on day_structure(config_id, day_of_week);

-- time_slot: ordered slots within a day. Non-teaching slots (assembly/break/
-- lunch/reserved/activity) are fixed; the solver only fills 'teaching' slots, and
-- a double cannot span a non-teaching slot. 'activity' is a school-wide fixed slot
-- with no teacher (e.g. the last two Saturday periods); it renders from the grid.
create table if not exists time_slot (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    day_structure_id varchar(12) not null,
    sequence integer not null,
    start_time time,
    end_time time,
    slot_type varchar(16) not null check (slot_type in ('teaching', 'assembly', 'break', 'lunch', 'reserved', 'activity', 'registration')),
    label varchar(64),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_time_slot_day on time_slot(day_structure_id);
create unique index if not exists idx_time_slot_unique on time_slot(day_structure_id, sequence);

-- forward-compatible: widen the slot_type CHECK to include 'registration' (the 0th
-- attendance period) on existing databases. Idempotent — drops then re-adds.
alter table time_slot drop constraint if exists time_slot_slot_type_check;
alter table time_slot add constraint time_slot_slot_type_check
    check (slot_type in ('teaching', 'assembly', 'break', 'lunch', 'reserved', 'activity', 'registration'));

-- ---------------------------------------------------------------------------
-- Teacher constraints (per-teacher, individually hard or soft)
-- ---------------------------------------------------------------------------

create table if not exists teacher_constraint (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    teacher_id varchar(12) not null,
    constraint_type varchar(24) not null check (constraint_type in ('max_per_day', 'max_consecutive', 'weekly_max', 'day_off', 'unavailable_slot', 'preferred_slot')),
    value jsonb,
    hardness varchar(8) not null check (hardness in ('hard', 'soft')),
    weight integer,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_teacher_constraint_teacher on teacher_constraint(school_id, academic_year_id, teacher_id, status);

-- ---------------------------------------------------------------------------
-- Generation job queue + candidate timetables
-- ---------------------------------------------------------------------------

-- generation_run: this row IS the queue. A worker claims it with
-- "for update skip locked", solves, writes candidates, and marks completed.
-- wing_id (nullable) scopes a run to one wing's classes; null = whole school.
create table if not exists generation_run (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    config_id varchar(12) not null,
    wing_id varchar(12),
    status varchar(16) not null check (status in ('queued', 'running', 'completed', 'failed')),
    objective_weights jsonb,
    num_candidates integer,
    progress integer,
    worker_id varchar(64),
    heartbeat_at timestamp(0),
    attempts integer,
    error text,
    started_at timestamp(0),
    finished_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- forward-compatible column for existing databases.
alter table generation_run add column if not exists wing_id varchar(12);

-- Worker claim ordering + fast lookup of queued/running runs.
create index if not exists idx_generation_run_status on generation_run(status, created_at);
create index if not exists idx_generation_run_school_year on generation_run(school_id, academic_year_id);

-- timetable_candidate: one of several solutions for a run, with its score.
create table if not exists timetable_candidate (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    generation_run_id varchar(12) not null,
    rank integer,
    score numeric(12,4),
    score_breakdown jsonb,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_timetable_candidate_run on timetable_candidate(generation_run_id, rank);

-- timetable_entry: a placed period within a candidate. block_group_id ties the
-- slots of a double (or larger block) together. band_id (nullable) ties the
-- co-scheduled offerings of an elective band together: several entries share the
-- same class+day+slot only when they share a band_id (else it's a clash).
-- teacher_id is nullable: a subject with no teaching assignment (e.g. a
-- supervised study / library period) is still placed, booking the class only.
create table if not exists timetable_entry (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    candidate_id varchar(12) not null,
    class_id varchar(12) not null,
    subject_id varchar(12) not null,
    teacher_id varchar(12),
    day_of_week integer not null,
    time_slot_id varchar(12) not null,
    block_group_id varchar(12),
    band_id varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- forward-compatible relax for existing databases.
alter table timetable_entry alter column teacher_id drop not null;
-- subject_id is null for a registration (0th attendance) entry: class teacher, no subject.
alter table timetable_entry alter column subject_id drop not null;

create index if not exists idx_timetable_entry_candidate on timetable_entry(candidate_id);
create index if not exists idx_timetable_entry_class on timetable_entry(candidate_id, class_id);
create index if not exists idx_timetable_entry_teacher on timetable_entry(candidate_id, teacher_id);

-- ---------------------------------------------------------------------------
-- Published master timetable
-- ---------------------------------------------------------------------------

-- wing_id (nullable) scopes the master to one wing; null = whole-school master.
-- One active master per (school, academic_year, wing_id).
create table if not exists published_timetable (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    wing_id varchar(12),
    source_candidate_id varchar(12),
    status varchar(16) check (status in ('active', 'archived')),
    effective_from date,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- forward-compatible column for existing databases.
alter table published_timetable add column if not exists wing_id varchar(12);

create index if not exists idx_published_timetable_school_year on published_timetable(school_id, academic_year_id, status);

-- published_entry: the editable master copy (same shape as timetable_entry).
create table if not exists published_entry (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    published_timetable_id varchar(12) not null,
    class_id varchar(12) not null,
    subject_id varchar(12) not null,
    teacher_id varchar(12),
    day_of_week integer not null,
    time_slot_id varchar(12) not null,
    block_group_id varchar(12),
    band_id varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- forward-compatible relax for existing databases.
alter table published_entry alter column teacher_id drop not null;
-- subject_id is null for a registration (0th attendance) entry: class teacher, no subject.
alter table published_entry alter column subject_id drop not null;

create index if not exists idx_published_entry_timetable on published_entry(published_timetable_id);
create index if not exists idx_published_entry_class on published_entry(published_timetable_id, class_id);
create index if not exists idx_published_entry_teacher on published_entry(published_timetable_id, teacher_id);
