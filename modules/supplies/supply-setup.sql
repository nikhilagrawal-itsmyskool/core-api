-- Supplies Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- Supply CATEGORIES are a managed, per-school lookup (`supply_category`) rather
-- than a hardcoded enum, so each school's category list can evolve. Both the
-- default categories AND a curated starter item master are seeded per school on
-- first use (see supply-service.ts:seedForSchool), tracked by supply_seed_state.
-- Purchases are bulk-only: every purchase line belongs to a purchase batch.

-- Table 1: supply_category (managed lookup of categories per school)
create table if not exists supply_category (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    code varchar(48) not null,
    name varchar(96) not null,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_supply_category_school_status on supply_category(school_id, status);
create unique index if not exists idx_supply_category_code_unique on supply_category(school_id, lower(code)) where status = 'active';

-- Table 2: supply_item (inventory items; references a category)
create table if not exists supply_item (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    category_id varchar(12) not null,
    name varchar(128) not null,
    item_type varchar(16) not null check (item_type in ('consumable', 'equipment')),
    unit varchar(32) not null,
    current_stock integer,
    reorder_level integer,
    location varchar(128),
    item_condition varchar(32) check (item_condition in ('new', 'good', 'fair', 'needs_repair', 'condemned')),
    cost_per_unit decimal(10,2),
    comments varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_supply_item_school_status on supply_item(school_id, status);
create index if not exists idx_supply_item_school_category on supply_item(school_id, category_id);
create index if not exists idx_supply_item_name on supply_item(school_id, category_id, name);
-- Normalized uniqueness powers auto-reuse: a casing/spacing duplicate cannot be created.
create unique index if not exists idx_supply_item_name_category_school on supply_item(lower(name), category_id, school_id) where status = 'active';

-- Table 3: supply_purchase_batch (bill header)
create table if not exists supply_purchase_batch (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    purchase_date date not null,
    supplier varchar(128),
    invoice_number varchar(64),
    batch_no varchar(64),
    notes varchar(512),
    file_id varchar(64),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12) not null,
    created_at timestamp not null,
    updatedby_userid varchar(12),
    updated_at timestamp
);

create index if not exists idx_supply_purchase_batch_school_status on supply_purchase_batch(school_id, status);

-- Table 4: supply_purchase_log (bill line items; every line has a batch)
create table if not exists supply_purchase_log (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    batch_id varchar(12) not null,
    item_id varchar(12) not null,
    purchase_date date not null,
    quantity integer not null,
    cost_per_unit decimal(10,2),
    supplier varchar(128),
    invoice_number varchar(64),
    batch_no varchar(64),
    remarks varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_supply_purchase_item on supply_purchase_log(item_id);
create index if not exists idx_supply_purchase_batch on supply_purchase_log(batch_id);
create index if not exists idx_supply_purchase_school_status on supply_purchase_log(school_id, status);

-- Table 5: supply_issue_log (stock out / consumption)
create table if not exists supply_issue_log (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
    issue_date date not null,
    quantity integer not null,
    issue_type varchar(32) not null check (issue_type in ('class_use', 'department', 'individual', 'event', 'disposed', 'transferred')),
    issued_to varchar(128),
    issued_to_type varchar(16),
    issued_to_id varchar(12),
    purpose varchar(512),
    expected_return_date date,
    returned boolean,
    return_date date,
    return_condition varchar(32) check (return_condition in ('good', 'damaged', 'lost')),
    return_remarks varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_supply_issue_item on supply_issue_log(item_id);
create index if not exists idx_supply_issue_school_status on supply_issue_log(school_id, status);

-- Table 6: supply_wastage_log (spoiled / expired / damaged / lost / used up)
create table if not exists supply_wastage_log (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
    wastage_date date not null,
    quantity integer not null,
    reason varchar(32) not null check (reason in ('spoiled', 'expired', 'damaged', 'lost', 'used_up', 'other')),
    responsible_type varchar(32) check (responsible_type in ('student', 'teacher', 'wear_and_tear', 'unknown')),
    responsible_name varchar(128),
    responsible_class varchar(64),
    responsible_id varchar(12),
    estimated_cost decimal(10,2),
    action_taken varchar(32) check (action_taken in ('written_off', 'replaced', 'cost_recovered')),
    wastage_status varchar(32) check (wastage_status in ('reported', 'resolved')),
    remarks varchar(512),
    file_id varchar(64),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_supply_wastage_item on supply_wastage_log(item_id);
create index if not exists idx_supply_wastage_school_status on supply_wastage_log(school_id, status);

-- Table 7: supply_seed_state (records which catalog version a school is seeded to)
create table if not exists supply_seed_state (
    school_id varchar(12) primary key,
    seeded_version integer not null,
    seeded_at timestamp(0) not null
);
