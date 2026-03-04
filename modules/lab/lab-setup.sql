-- Lab Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints
-- No default values in DDL - defaults handled in application code
-- Safe to re-run: all statements use IF NOT EXISTS guards

-- Table 1: lab (lab register)
create table if not exists lab (
    uuid varchar(12) primary key,
    name varchar(128) not null,
    type varchar(32) not null check (type in ('physics', 'chemistry', 'biology', 'computer', 'language', 'mathematics', 'other')),
    location varchar(128),
    in_charge_id varchar(12),
    status varchar(16) check (status in ('active', 'inactive', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_lab_school on lab(school_id);
create index if not exists idx_lab_school_status on lab(school_id, status);

-- Table 2: lab_item (inventory items per lab)
create table if not exists lab_item (
    uuid varchar(12) primary key,
    lab_id varchar(12) not null,
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

create index if not exists idx_lab_item_lab on lab_item(lab_id);
create index if not exists idx_lab_item_school on lab_item(school_id);
create index if not exists idx_lab_item_school_status on lab_item(school_id, status);
create index if not exists idx_lab_item_name on lab_item(school_id, lab_id, name);

-- Table 3: lab_purchase_log (stock in)
create table if not exists lab_purchase_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    lab_id varchar(12) not null,
    purchase_date date not null,
    quantity integer not null,
    cost_per_unit decimal(10,2),
    supplier varchar(128),
    invoice_number varchar(64),
    batch_no varchar(64),
    expiry_date date,
    warranty_end_date date,
    remarks varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_lab_purchase_item on lab_purchase_log(item_id);
create index if not exists idx_lab_purchase_lab on lab_purchase_log(lab_id);
create index if not exists idx_lab_purchase_school on lab_purchase_log(school_id);
create index if not exists idx_lab_purchase_school_status on lab_purchase_log(school_id, status);

-- Table 4: lab_issue_log (stock out / consumption)
create table if not exists lab_issue_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    lab_id varchar(12) not null,
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

create index if not exists idx_lab_issue_item on lab_issue_log(item_id);
create index if not exists idx_lab_issue_lab on lab_issue_log(lab_id);
create index if not exists idx_lab_issue_school on lab_issue_log(school_id);
create index if not exists idx_lab_issue_school_status on lab_issue_log(school_id, status);

-- Table 5: lab_breakage_log (breakage / damage tracking)
create table if not exists lab_breakage_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    lab_id varchar(12) not null,
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

create index if not exists idx_lab_breakage_item on lab_breakage_log(item_id);
create index if not exists idx_lab_breakage_lab on lab_breakage_log(lab_id);
create index if not exists idx_lab_breakage_school on lab_breakage_log(school_id);
create index if not exists idx_lab_breakage_school_status on lab_breakage_log(school_id, status);

-- Entity linking columns (idempotent)
alter table lab_issue_log add column if not exists issued_to_type varchar(16);
alter table lab_issue_log add column if not exists issued_to_id varchar(12);

alter table lab_breakage_log add column if not exists responsible_id varchar(12);

-- Unique constraints for upsert support (data-sync)
create unique index if not exists idx_lab_name_school_id on lab(lower(name), school_id);
create unique index if not exists idx_lab_item_name_lab_school_id on lab_item(lower(name), lab_id, school_id);
