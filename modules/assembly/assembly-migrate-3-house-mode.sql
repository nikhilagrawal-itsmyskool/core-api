-- Assembly migration 3: house-mode foundation (Phase A) + per-weekday content grid.
-- Additive and idempotent; safe on a populated DB.

-- Per-school mode + optional branding. (Rotation is PER-PLAN/wing — see below.)
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

-- Rotation is per-plan (each wing rotates the houses independently). anchor = the
-- Monday the wing's cycle starts from; houses cycle by assembly_house_meta.rotation_order.
alter table assembly_plan add column if not exists rotation_anchor date;

-- House leadership + rotation order (extends the student-module `house` by house_id).
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

-- House member teachers (employees).
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

-- Manual per-week rotation override, PER PLAN. house_id set = re-anchors the cycle
-- from that house going forward; house_id null = "no house / skip" (no shift).
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

-- Template node: roster fill mode + optional + a pick-one options list.
alter table assembly_node add column if not exists fill_mode varchar(16);  -- null/'auto' (template) | 'roster' (house fills)
alter table assembly_node add column if not exists is_optional boolean;     -- can be opted in/out per day
alter table assembly_node add column if not exists options text;            -- newline-separated pick-one choices

-- Per-weekday content grid on a leaf node (the doc's Mon–Sat content row).
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
