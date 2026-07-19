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
