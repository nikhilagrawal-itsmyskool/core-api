-- Medical Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints
-- No default values in DDL - defaults handled in application code
-- Safe to re-run: all statements use IF NOT EXISTS guards

-- Table 1: medical_item (inventory items)
create table if not exists medical_item (
    uuid varchar(12) primary key,
    name varchar(128) not null,
    unit varchar(16) not null check (unit in ('tablet', 'capsule', 'ml', 'tube', 'sachet', 'strip', 'bottle', 'piece', 'roll', 'pair', 'box')),
    reorder_level integer,
    current_stock integer,
    comments varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_medical_item_school_id on medical_item(school_id);
create index if not exists idx_medical_item_name on medical_item(school_id, name);
create index if not exists idx_medical_item_status on medical_item(school_id, status);

-- Table 2: medical_purchase_log (purchases)
create table if not exists medical_purchase_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    purchase_date date not null,
    batch_no varchar(64),
    expiry_date date,
    quantity integer not null,
    supplier varchar(128),
    invoice_number varchar(64),
    cost_per_unit decimal(10,2),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_medical_purchase_log_item on medical_purchase_log(item_id);
create index if not exists idx_medical_purchase_log_school on medical_purchase_log(school_id);
create index if not exists idx_medical_purchase_log_status on medical_purchase_log(school_id, status);

-- Table 3: medical_issue_log (issues to employees/students)
create table if not exists medical_issue_log (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    issue_date date not null,
    entity_type varchar(16) not null check (entity_type in ('employee', 'student')),
    entity_id varchar(12) not null,
    quantity integer,
    remarks varchar(512),
    parent_consent boolean,
    issued_by_id varchar(12),
    status varchar(16) check (status in ('active', 'deleted')),
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_medical_issue_log_item on medical_issue_log(item_id);
create index if not exists idx_medical_issue_log_entity on medical_issue_log(entity_type, entity_id);
create index if not exists idx_medical_issue_log_school on medical_issue_log(school_id);
create index if not exists idx_medical_issue_log_status on medical_issue_log(school_id, status);

-- Incremental changes (safe to re-run, guards with IF NOT EXISTS)
alter table medical_issue_log add column if not exists issued_by_id varchar(12);

-- Unique constraint for upsert support (data-sync)
create unique index if not exists idx_medical_item_name_school_id on medical_item(lower(name), school_id);
