-- Assembly migration 3: house-mode foundation (Phase A) + per-weekday content grid.
-- Additive and idempotent; safe on a populated DB.
--
-- NOTE: the house DOMAIN (identity, in-charge/co-in-charge, member teachers) lives
-- in the student module (`house`, `house_teacher`). Assembly owns only its own
-- rotation POLICY: which houses rotate for assembly duty and in what order
-- (assembly_house_rotation), plus per-week pins/overrides (assembly_week_house).

-- Per-school mode + optional branding.
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

-- Assembly-specific house rotation order. A row = this house participates in the
-- assembly duty rotation, at this sort_order. (Leadership/members are read from the
-- student module's house_teacher — not duplicated here.)
create table if not exists assembly_house_rotation (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    house_id varchar(12) not null,
    sort_order integer not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_house_rotation_unique on assembly_house_rotation(school_id, house_id) where status = 'active';
create index if not exists idx_assembly_house_rotation_school on assembly_house_rotation(school_id) where status = 'active';

-- Per-plan (wing) week PIN / override. house_id set = pin this week to that house
-- and RE-ANCHOR the cycle from it going forward; house_id null = "skip" (no house,
-- no shift). The EARLIEST pin is the cycle's start (there is no separate anchor).
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
