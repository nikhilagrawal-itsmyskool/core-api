-- Assembly migration 4: house-mode WEEKLY ROSTER (Phase B).
-- The rotating house-on-duty authors a per-week roster within the template
-- guideline, with a draft -> submitted -> approved(=locked) workflow. Approved
-- rosters overlay the resolved template (fill 'roster' slots, prune un-opted
-- optional nodes, attach the day's anchors/owner + house-on-duty).
-- Additive and idempotent; inert for 'template'-mode schools.

-- One roster instance per (plan/wing, week). house_id is the house-on-duty
-- SNAPSHOT at create time (from rotation); null = a skip week. deadline_at =
-- Wed 14:00 of the week immediately before (advisory + late-edit gate). locked
-- is a hard lock set on approve; late_unlocked records an assembly-incharge
-- override that re-opens editing after the deadline / after a lock.
create table if not exists assembly_week (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    plan_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    week_start date not null,                 -- Monday
    house_id varchar(12),                      -- snapshot of house-on-duty (null = skip week)
    house_name varchar(128),
    status varchar(16) not null check (status in ('draft', 'submitted', 'approved')),
    locked boolean,                            -- true once approved (hard lock)
    late_unlocked boolean,                     -- assembly-incharge re-opened editing past deadline/lock
    deadline_at timestamp(0),
    submittedby_userid varchar(12),
    submitted_at timestamp(0),
    approvedby_userid varchar(12),
    approved_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_week_unique on assembly_week(plan_id, week_start);
create index if not exists idx_assembly_week_school_year on assembly_week(school_id, academic_year_id);

-- Per-day header: the day's anchors (MCs) + a day owner (teacher). Anchors are
-- linked students (feed the student 360 view) with denormalized name/class.
create table if not exists assembly_roster_day (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    entry_date date not null,
    anchor1_student_id varchar(12),
    anchor1_name varchar(160),
    anchor1_class varchar(128),
    anchor2_student_id varchar(12),
    anchor2_name varchar(160),
    anchor2_class varchar(128),
    day_owner_employee_id varchar(12),
    day_owner_name varchar(160),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_roster_day_unique on assembly_roster_day(week_id, entry_date);

-- Per (day, roster node): opt-in/out of optional segments, the day's variable
-- content, the linked student speaker, and per-segment delegation owner.
create table if not exists assembly_roster_entry (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    entry_date date not null,
    node_id varchar(12) not null,
    opted boolean,                             -- optional segment opted in (null/true = shown)
    content text,
    student_id varchar(12),
    student_name varchar(160),
    student_class varchar(128),
    owner_employee_id varchar(12),
    owner_name varchar(160),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_roster_entry_unique on assembly_roster_entry(week_id, entry_date, node_id);
create index if not exists idx_assembly_roster_entry_week on assembly_roster_entry(week_id);

-- Audit of unlocks (who re-opened a locked/late week and why).
create table if not exists assembly_week_unlock (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    reason text,
    unlockedby_userid varchar(12),
    unlocked_at timestamp(0)
);
create index if not exists idx_assembly_week_unlock_week on assembly_week_unlock(week_id);
