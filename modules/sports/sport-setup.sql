-- Sport Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints
-- No default values in DDL - defaults handled in application code
-- Safe to re-run: all statements use IF NOT EXISTS guards
--
-- Sports have no separate "register" entity: a sport IS its type (see sport_type
-- values below, mirroring SPORT_TYPES in sport-constants.ts). Inventory references
-- the sport type directly. The only per-sport metadata is the in-charge mapping.

-- Table 1: sport_incharge (who manages each sport's equipment; multiple allowed per sport)
create table if not exists sport_incharge (
    uuid varchar(12) primary key,
    sport_type varchar(32) not null check (sport_type in ('cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'table_tennis', 'athletics', 'kabaddi', 'swimming', 'archery', 'shooting', 'kho_kho', 'racquetball', 'squash', 'fencing', 'horse_riding', 'chess', 'tennis', 'throwball', 'handball', 'gymnastics', 'yoga', 'karate', 'taekwondo', 'skating', 'carrom', 'general', 'other')),
    in_charge_id varchar(12) not null,
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_sport_incharge_school on sport_incharge(school_id);
create unique index if not exists idx_sport_incharge_unique on sport_incharge(school_id, sport_type, in_charge_id) where status = 'active';

-- Table 2: sport_item (inventory items per sport type)
create table if not exists sport_item (
    uuid varchar(12) primary key,
    sport_type varchar(32) not null check (sport_type in ('cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'table_tennis', 'athletics', 'kabaddi', 'swimming', 'archery', 'shooting', 'kho_kho', 'racquetball', 'squash', 'fencing', 'horse_riding', 'chess', 'tennis', 'throwball', 'handball', 'gymnastics', 'yoga', 'karate', 'taekwondo', 'skating', 'carrom', 'general', 'other')),
    name varchar(128) not null,
    category varchar(64),
    item_type varchar(16) not null check (item_type in ('equipment', 'consumable')),
    unit varchar(32) not null check (unit in ('piece', 'set', 'bottle', 'packet', 'ml', 'gm', 'kg', 'box', 'roll', 'pair', 'strip', 'litre', 'dozen', 'ream')),
    current_stock integer,
    reorder_level integer,
    location varchar(128),
    item_condition varchar(32) check (item_condition in ('new', 'good', 'fair', 'needs_repair', 'condemned')),
    cost_per_unit decimal(10,2),
    comments varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_sport_item_sport on sport_item(sport_type);
create index if not exists idx_sport_item_school on sport_item(school_id);
create index if not exists idx_sport_item_school_status on sport_item(school_id, status);
create index if not exists idx_sport_item_name on sport_item(school_id, sport_type, name);

-- Table 3: sport_purchase_log (stock in)
create table if not exists sport_purchase_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    sport_type varchar(32) not null check (sport_type in ('cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'table_tennis', 'athletics', 'kabaddi', 'swimming', 'archery', 'shooting', 'kho_kho', 'racquetball', 'squash', 'fencing', 'horse_riding', 'chess', 'tennis', 'throwball', 'handball', 'gymnastics', 'yoga', 'karate', 'taekwondo', 'skating', 'carrom', 'general', 'other')),
    purchase_date date not null,
    quantity integer not null,
    cost_per_unit decimal(10,2),
    supplier varchar(128),
    invoice_number varchar(64),
    batch_no varchar(64),
    remarks varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_sport_purchase_item on sport_purchase_log(item_id);
create index if not exists idx_sport_purchase_sport on sport_purchase_log(sport_type);
create index if not exists idx_sport_purchase_school on sport_purchase_log(school_id);
create index if not exists idx_sport_purchase_school_status on sport_purchase_log(school_id, status);

-- Table 4: sport_issue_log (stock out / consumption)
create table if not exists sport_issue_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    sport_type varchar(32) not null check (sport_type in ('cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'table_tennis', 'athletics', 'kabaddi', 'swimming', 'archery', 'shooting', 'kho_kho', 'racquetball', 'squash', 'fencing', 'horse_riding', 'chess', 'tennis', 'throwball', 'handball', 'gymnastics', 'yoga', 'karate', 'taekwondo', 'skating', 'carrom', 'general', 'other')),
    issue_date date not null,
    quantity integer not null,
    issue_type varchar(32) not null check (issue_type in ('class_use', 'individual', 'disposed', 'transferred')),
    issued_to varchar(128),
    purpose varchar(512),
    expected_return_date date,
    returned boolean,
    return_date date,
    return_condition varchar(32) check (return_condition in ('good', 'damaged', 'lost')),
    return_remarks varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_sport_issue_item on sport_issue_log(item_id);
create index if not exists idx_sport_issue_sport on sport_issue_log(sport_type);
create index if not exists idx_sport_issue_school on sport_issue_log(school_id);
create index if not exists idx_sport_issue_school_status on sport_issue_log(school_id, status);

-- Table 5: sport_breakage_log (breakage / damage tracking)
create table if not exists sport_breakage_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    sport_type varchar(32) not null check (sport_type in ('cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'table_tennis', 'athletics', 'kabaddi', 'swimming', 'archery', 'shooting', 'kho_kho', 'racquetball', 'squash', 'fencing', 'horse_riding', 'chess', 'tennis', 'throwball', 'handball', 'gymnastics', 'yoga', 'karate', 'taekwondo', 'skating', 'carrom', 'general', 'other')),
    breakage_date date not null,
    quantity integer not null,
    responsible_type varchar(32) check (responsible_type in ('student', 'teacher', 'wear_and_tear', 'unknown')),
    responsible_name varchar(128),
    responsible_class varchar(64),
    cause varchar(32) check (cause in ('accident', 'mishandling', 'wear_and_tear', 'manufacturing_defect')),
    estimated_cost decimal(10,2),
    action_taken varchar(32) check (action_taken in ('replaced', 'repaired', 'written_off', 'cost_recovered')),
    breakage_status varchar(32) check (breakage_status in ('reported', 'resolved')),
    remarks varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_sport_breakage_item on sport_breakage_log(item_id);
create index if not exists idx_sport_breakage_sport on sport_breakage_log(sport_type);
create index if not exists idx_sport_breakage_school on sport_breakage_log(school_id);
create index if not exists idx_sport_breakage_school_status on sport_breakage_log(school_id, status);

-- Table 6: sport_purchase_batch (bulk purchase invoice header)
create table if not exists sport_purchase_batch (
    uuid varchar(12) primary key,
    purchase_date date not null,
    supplier varchar(128),
    invoice_number varchar(64),
    batch_no varchar(64),
    notes varchar(512),
    file_id varchar(64),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12) not null,
    created_at timestamp not null,
    updatedby_userid varchar(12),
    updated_at timestamp
);

create index if not exists idx_sport_purchase_batch_school on sport_purchase_batch(school_id);
create index if not exists idx_sport_purchase_batch_school_status on sport_purchase_batch(school_id, status);

-- Entity linking columns (idempotent)
alter table sport_issue_log add column if not exists issued_to_type varchar(16);
alter table sport_issue_log add column if not exists issued_to_id varchar(12);

alter table sport_breakage_log add column if not exists responsible_id varchar(12);
alter table sport_breakage_log add column if not exists file_id varchar(64);

alter table sport_purchase_log add column if not exists batch_id varchar(12);
create index if not exists idx_sport_purchase_batch_id on sport_purchase_log(batch_id);

-- Unique constraint for upsert support (data-sync)
-- Partial index excludes soft-deleted records so names can be reused after deletion
create unique index if not exists idx_sport_item_name_sport_school_id on sport_item(lower(name), sport_type, school_id) where status = 'active';
