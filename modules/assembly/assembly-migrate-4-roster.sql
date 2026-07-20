-- Assembly migration 4: house-mode WEEKLY ROSTER (Phase B).
-- The rotating house-on-duty authors a per-week roster within the template
-- guideline, with a draft -> submitted -> approved(=locked) workflow. Approved
-- rosters overlay the resolved template (fill 'roster' slots, prune un-opted
-- optional nodes, attach the day's anchors/owner + house-on-duty).
-- Additive and idempotent; inert for 'template'-mode schools.
--
-- People (anchors, day owner, per-slot speakers/performers/groups) are NOT flat
-- columns: they are polymorphic rows in assembly_roster_participant, mirroring
-- assembly_node_responsible. assembly_roster_entry holds only the slot's own
-- state (opted + content).

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

-- Per (day, roster node) SLOT STATE: opt-in/out of an optional segment + the
-- day's filled content. People on the slot are participant rows (scope='entry').
create table if not exists assembly_roster_entry (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    entry_date date not null,
    node_id varchar(12) not null,
    opted boolean,                             -- optional segment opted in (null/true = shown)
    content text,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_roster_entry_unique on assembly_roster_entry(week_id, entry_date, node_id);
create index if not exists idx_assembly_roster_entry_week on assembly_roster_entry(week_id);

-- Polymorphic roster participants (mirrors assembly_node_responsible):
--   scope='day'   (node_id null) -> the day's anchors (role 'anchor') + day owner
--                                   (role 'day-owner'); N of each allowed.
--   scope='entry' (node_id set)  -> a slot's speakers/performers/group; a skit
--                                   group is simply many rows on one node.
-- target_type: employee | student | class | text.
create table if not exists assembly_roster_participant (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    entry_date date not null,
    scope varchar(8) not null check (scope in ('day', 'entry')),
    node_id varchar(12),                       -- null for scope='day'
    role varchar(48),
    target_type varchar(16) not null check (target_type in ('employee', 'student', 'class', 'text')),
    target_id varchar(12),
    target_name varchar(160),
    target_class varchar(128),
    target_text varchar(160),
    sort_order integer not null,
    createdby_userid varchar(12),
    created_at timestamp(0)
);
create index if not exists idx_assembly_roster_participant_day on assembly_roster_participant(week_id, entry_date);
create index if not exists idx_assembly_roster_participant_node on assembly_roster_participant(week_id, entry_date, node_id);

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
