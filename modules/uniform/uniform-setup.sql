-- Uniform Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints
-- No default values in DDL - defaults handled in application code
-- Safe to re-run: all statements use IF NOT EXISTS guards

-- Table 1: uniform_item (catalog items)
create table if not exists uniform_item (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    category varchar(32) not null check (category in ('summer', 'winter', 'sports', 'general')),
    gender varchar(8) not null check (gender in ('male', 'female', 'unisex')),
    is_seeded boolean,
    description varchar(512),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_uniform_item_school_id on uniform_item(school_id);
create index if not exists idx_uniform_item_school_status on uniform_item(school_id, status);
create index if not exists idx_uniform_item_category on uniform_item(school_id, category);
create unique index if not exists idx_uniform_item_name_school_gender on uniform_item(lower(name), school_id, gender) where status = 'active';

-- Table 2: uniform_item_size (size variants with pricing and stock)
create table if not exists uniform_item_size (
    uuid varchar(12) primary key,
    item_id varchar(12) not null,
    school_id varchar(12) not null,
    size_label varchar(32) not null,
    mrp decimal(10,2),
    student_discount_pct decimal(5,2),
    bulk_discount_pct decimal(5,2),
    current_stock integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_uniform_size_item_id on uniform_item_size(item_id);
create index if not exists idx_uniform_size_school_id on uniform_item_size(school_id, status);
create unique index if not exists idx_uniform_size_label_item on uniform_item_size(lower(size_label), item_id) where status = 'active';

-- Table 3: uniform_purchase_batch (lot/bill header)
create table if not exists uniform_purchase_batch (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    purchase_date date not null,
    supplier varchar(128),
    invoice_number varchar(64),
    notes varchar(512),
    total_amount decimal(12,2),
    file_id varchar(12),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_uniform_batch_school_id on uniform_purchase_batch(school_id, status);
create index if not exists idx_uniform_batch_date on uniform_purchase_batch(school_id, purchase_date);

-- Table 4: uniform_purchase_log (line items per batch)
create table if not exists uniform_purchase_log (
    uuid varchar(12) primary key,
    batch_id varchar(12) not null,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
    size_id varchar(12) not null,
    quantity integer not null,
    mrp decimal(10,2),
    student_discount_pct decimal(5,2),
    bulk_discount_pct decimal(5,2),
    cost_per_unit decimal(10,2),
    remaining_quantity integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_uniform_purchase_log_batch on uniform_purchase_log(batch_id);
create index if not exists idx_uniform_purchase_log_school on uniform_purchase_log(school_id, status);
create index if not exists idx_uniform_purchase_log_size on uniform_purchase_log(size_id);

-- Table 5: uniform_set (named item bundles)
create table if not exists uniform_set (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    gender varchar(8) check (gender in ('male', 'female', 'unisex')),
    description varchar(512),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_uniform_set_school_id on uniform_set(school_id, status);
create unique index if not exists idx_uniform_set_name_school on uniform_set(lower(name), school_id) where status = 'active';

-- Table 6: uniform_set_item (items within a set, no size - chosen at sale time)
create table if not exists uniform_set_item (
    uuid varchar(12) primary key,
    set_id varchar(12) not null,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
    quantity integer not null,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_uniform_set_item_set_id on uniform_set_item(set_id);
create index if not exists idx_uniform_set_item_school on uniform_set_item(school_id, status);

-- Table 7: uniform_sale (sale/bill header)
create table if not exists uniform_sale (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    student_id varchar(12) not null,
    sale_date date not null,
    sale_type varchar(16) not null check (sale_type in ('student', 'bulk')),
    set_id varchar(12),
    total_mrp decimal(12,2),
    total_discount decimal(12,2),
    total_amount decimal(12,2),
    amount_paid decimal(12,2),
    payment_status varchar(16) not null check (payment_status in ('paid', 'partial', 'due')),
    notes varchar(512),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_uniform_sale_school_id on uniform_sale(school_id, status);
create index if not exists idx_uniform_sale_student on uniform_sale(school_id, student_id);
create index if not exists idx_uniform_sale_date on uniform_sale(school_id, sale_date);
create index if not exists idx_uniform_sale_payment on uniform_sale(school_id, payment_status);

-- Table 8: uniform_sale_item (line items per sale)
create table if not exists uniform_sale_item (
    uuid varchar(12) primary key,
    sale_id varchar(12) not null,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
    size_id varchar(12) not null,
    quantity integer not null,
    mrp decimal(10,2),
    discount_pct decimal(5,2),
    unit_price decimal(10,2),
    line_total decimal(12,2),
    returned_quantity integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_uniform_sale_item_sale_id on uniform_sale_item(sale_id);
create index if not exists idx_uniform_sale_item_school on uniform_sale_item(school_id, status);

-- Table 9: uniform_return (return records)
create table if not exists uniform_return (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    sale_id varchar(12) not null,
    sale_item_id varchar(12) not null,
    return_date date not null,
    quantity integer not null,
    refund_amount decimal(12,2),
    reason varchar(512),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_uniform_return_sale_id on uniform_return(sale_id);
create index if not exists idx_uniform_return_school on uniform_return(school_id, status);

alter table uniform_return add column if not exists file_id varchar(12);

-- Table 10: uniform_sale_payment (payment installment log)
create table if not exists uniform_sale_payment (
    uuid varchar(12) primary key,
    sale_id varchar(12) not null,
    school_id varchar(12) not null,
    amount decimal(12,2) not null,
    payment_date date not null,
    notes varchar(512),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_uniform_sale_payment_sale on uniform_sale_payment(sale_id);
create index if not exists idx_uniform_sale_payment_school on uniform_sale_payment(school_id, status);
