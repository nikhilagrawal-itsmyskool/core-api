-- Assembly Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- Model:
--   assembly_plan              - a per-wing weekly assembly template (draft -> published)
--   assembly_plan_class        - explicit class/section audience (no class in two plans/year)
--   assembly_plan_day          - weekdays this plan holds assembly (the subset-rule ceiling)
--   assembly_node              - the recursive tree (template AND special share it, via owner_type)
--   assembly_node_day          - explicit weekday set on a node (no rows = inherit parent / all)
--   assembly_node_responsible  - many-per-node, polymorphic (employee/class/student/text) + role
--   assembly_node_resource     - text/link resources on a node (no file storage)
--   assembly_special           - a dated snapshot that replaces the plan for one date
--   assembly_theme             - value-of-the-week; a date range, informational only
--   assembly_node_audit        - append-only node change log
--   -- House mode (optional per-school extension; inert for template schools):
--   assembly_school_config     - per-school mode (template|house) + branding
--   assembly_house_meta        - house leadership + rotation order (extends student-module house)
--   assembly_house_teacher     - house member teachers (employees)
--   assembly_week_house        - manual per-week rotation override, per plan/wing
--   assembly_node_day_content  - per-weekday content grid on a leaf node
--   -- House mode Phase B (weekly roster):
--   assembly_week              - per (plan/wing, week) roster instance; draft->submitted->approved(=locked)
--   assembly_roster_day        - per-day anchors (MCs) + day owner
--   assembly_roster_entry      - per (day, roster node) opt-in/content/student speaker/owner
--   assembly_week_unlock       - audit of late/locked-week unlocks

-- Table 1: assembly_plan (per-wing weekly template)
create table if not exists assembly_plan (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    name varchar(128) not null,
    scope_label varchar(64),
    publish_status varchar(16) not null check (publish_status in ('draft', 'published', 'archived')),
    published_at timestamp(0),
    publishedby_userid varchar(12),
    -- Validity window: dated, possibly overlapping plans (Term 1 / exam block / etc.).
    -- null start = -inf, null end = +inf (a whole-year "base" plan). Resolution =
    -- narrowest range covering the day wins; priority breaks equal-span ties.
    start_date date,
    end_date date,
    priority integer,
    -- House-mode: the Monday this wing's house rotation cycles from (see assembly_house_meta).
    rotation_anchor date,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Plan name unique per academic year within a school (soft-delete aware).
create unique index if not exists idx_assembly_plan_name_unique
    on assembly_plan(school_id, academic_year_id, lower(name)) where status = 'active';
create index if not exists idx_assembly_plan_school_year on assembly_plan(school_id, academic_year_id);

-- Table 2: assembly_plan_class (audience; explicit classes/sections)
create table if not exists assembly_plan_class (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    plan_id varchar(12) not null,
    class_id varchar(12) not null,
    class_name varchar(128),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- No duplicate class within a plan.
create unique index if not exists idx_assembly_plan_class_unique
    on assembly_plan_class(plan_id, class_id) where status = 'active';
-- NOTE: no cross-plan uniqueness — a class may belong to overlapping dated plans
-- (e.g. a Term-1 plan and an exam-block plan); resolution is narrowest-range-wins.
create index if not exists idx_assembly_plan_class_plan on assembly_plan_class(plan_id);
create index if not exists idx_assembly_plan_class_school_year_class
    on assembly_plan_class(school_id, academic_year_id, class_id) where status = 'active';

-- Table 3: assembly_plan_day (weekdays this plan holds assembly)
-- Set-replace semantics: rows are hard-deleted and re-inserted; no soft-delete needed.
create table if not exists assembly_plan_day (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    plan_id varchar(12) not null,
    weekday varchar(3) not null check (weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create unique index if not exists idx_assembly_plan_day_unique on assembly_plan_day(plan_id, weekday);

-- Table 4: assembly_node (recursive tree; owner is a plan OR a special)
create table if not exists assembly_node (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    owner_type varchar(16) not null check (owner_type in ('plan', 'special')),
    owner_id varchar(12) not null,
    parent_id varchar(12),
    depth integer not null,
    sort_order integer not null,
    title varchar(160) not null,
    description text,
    expectation text,
    recommendation text,
    outcome text,
    start_time varchar(8),
    duration_minutes integer,
    -- House-mode template grid. fill_mode null/'auto' = fixed template content;
    -- 'roster' = a slot the house fills weekly. is_optional = can be opted in/out per day.
    -- options = newline-separated pick-one choices. All ignored in 'template' mode.
    fill_mode varchar(16),
    is_optional boolean,
    options text,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_assembly_node_owner
    on assembly_node(owner_type, owner_id, parent_id, sort_order) where status = 'active';
create index if not exists idx_assembly_node_school on assembly_node(school_id);

-- Table 5: assembly_node_day (explicit weekday set; no rows = inherit parent / all)
-- Set-replace semantics: rows are hard-deleted and re-inserted.
create table if not exists assembly_node_day (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    node_id varchar(12) not null,
    weekday varchar(3) not null check (weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create unique index if not exists idx_assembly_node_day_unique on assembly_node_day(node_id, weekday);

-- Table 6: assembly_node_responsible (many per node; polymorphic target + role label)
create table if not exists assembly_node_responsible (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    node_id varchar(12) not null,
    role varchar(48),
    target_type varchar(16) not null check (target_type in ('employee', 'class', 'student', 'text')),
    target_id varchar(12),
    target_text varchar(160),
    target_name varchar(160),
    sort_order integer not null,
    -- Time-aware responsibility. A "rule" = rows sharing rule_group; null start/end
    -- = always. mode null/'fixed' = single target; 'rotating' = the group's rows cycle
    -- (cycle_unit from anchor_date), sort_order = member order. Resolution picks the
    -- narrowest date-range rule covering the day, then fixed target or members[idx].
    start_date date,
    end_date date,
    mode varchar(16) check (mode in ('fixed', 'rotating')),
    cycle_unit varchar(16) check (cycle_unit in ('weekly', 'monthly')),
    anchor_date date,
    rule_group varchar(12),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_assembly_node_responsible_node
    on assembly_node_responsible(node_id) where status = 'active';

-- Table 7: assembly_node_resource (text/links only; no file storage)
create table if not exists assembly_node_resource (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    node_id varchar(12) not null,
    label varchar(160),
    url text,
    note text,
    sort_order integer not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_assembly_node_resource_node
    on assembly_node_resource(node_id) where status = 'active';

-- Table 8: assembly_special (dated snapshot; replaces the plan for one date)
create table if not exists assembly_special (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    plan_id varchar(12) not null,
    special_date date not null,
    title varchar(160) not null,
    description text,
    source varchar(16) not null check (source in ('cloned', 'blank')),
    publish_status varchar(16) not null check (publish_status in ('draft', 'published', 'archived')),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One special assembly per plan per date (soft-delete aware).
create unique index if not exists idx_assembly_special_unique
    on assembly_special(school_id, plan_id, special_date) where status = 'active';
create index if not exists idx_assembly_special_lookup on assembly_special(school_id, plan_id, special_date);

-- Table 9: assembly_theme (value-of-the-week; plan_id null = school-wide)
create table if not exists assembly_theme (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    plan_id varchar(12),
    title varchar(160) not null,
    description text,
    start_date date not null,
    end_date date not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_assembly_theme_lookup on assembly_theme(school_id, academic_year_id, plan_id);

-- Table 10: assembly_node_audit (append-only change log)
create table if not exists assembly_node_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    node_id varchar(12) not null,
    owner_type varchar(16),
    owner_id varchar(12),
    action varchar(16) not null check (action in ('create', 'update', 'delete', 'reorder')),
    changed_field varchar(48),
    old_value text,
    new_value text,
    changedby_userid varchar(12),
    changed_at timestamp(0)
);

create index if not exists idx_assembly_node_audit_node on assembly_node_audit(school_id, node_id);

-- ---------------------------------------------------------------------------
-- House mode (Phase A). Optional per-school extension. These tables stay empty
-- and menus hidden for 'template' schools — zero added surface. Kept in parity
-- with assembly-migrate-3-house-mode.sql for fresh installs.
-- ---------------------------------------------------------------------------

-- Table 11: assembly_school_config (per-school mode + optional branding)
create table if not exists assembly_school_config (
    school_id varchar(12) primary key,
    mode varchar(16) not null check (mode in ('template', 'house')),
    title varchar(160),
    subtitle varchar(200),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Table 12: assembly_house_meta (house leadership + rotation order; extends student-module `house`)
create table if not exists assembly_house_meta (
    house_id varchar(12) primary key,
    school_id varchar(12) not null,
    incharge_id varchar(12),
    coincharge_id varchar(12),
    rotation_order integer,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_assembly_house_meta_school on assembly_house_meta(school_id);

-- Table 13: assembly_house_teacher (house member teachers / employees)
create table if not exists assembly_house_teacher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    house_id varchar(12) not null,
    employee_id varchar(12) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_house_teacher_unique on assembly_house_teacher(house_id, employee_id) where status = 'active';
create index if not exists idx_assembly_house_teacher_house on assembly_house_teacher(school_id, house_id);

-- Table 14: assembly_week_house (manual per-week rotation override, PER PLAN/wing)
-- house_id set = re-anchors the cycle from that house going forward; null = "skip" (no shift).
create table if not exists assembly_week_house (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    plan_id varchar(12) not null,
    week_start date not null,
    house_id varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_week_house_unique on assembly_week_house(plan_id, week_start);

-- Table 15: assembly_node_day_content (per-weekday content grid on a leaf node)
create table if not exists assembly_node_day_content (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    node_id varchar(12) not null,
    weekday varchar(3) not null check (weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    content text,
    createdby_userid varchar(12),
    created_at timestamp(0)
);
create unique index if not exists idx_assembly_node_day_content_unique on assembly_node_day_content(node_id, weekday);

-- ---------------------------------------------------------------------------
-- House mode Phase B: the weekly roster (draft -> submitted -> approved=locked).
-- Kept in parity with assembly-migrate-4-roster.sql for fresh installs.
-- ---------------------------------------------------------------------------

-- Table 16: assembly_week (per plan/wing, per week roster instance)
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

-- Table 17: assembly_roster_day (per-day anchors + day owner)
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

-- Table 18: assembly_roster_entry (per day+roster node: opt-in/content/speaker/owner)
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

-- Table 19: assembly_week_unlock (audit of late/locked-week unlocks)
create table if not exists assembly_week_unlock (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    reason text,
    unlockedby_userid varchar(12),
    unlocked_at timestamp(0)
);
create index if not exists idx_assembly_week_unlock_week on assembly_week_unlock(week_id);
