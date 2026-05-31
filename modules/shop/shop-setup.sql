-- Shop Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints
-- No default values in DDL - defaults handled in application code
-- Safe to re-run: all statements use IF NOT EXISTS guards

-- Table 1: shop_item (catalog items)
create table if not exists shop_item (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(256) not null,
    type varchar(16) not null check (type in ('book', 'notebook', 'stationery')),
    subject varchar(64),
    publisher varchar(128),
    class_no smallint,
    current_stock integer,
    description varchar(512),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_shop_item_school_id on shop_item(school_id);
create index if not exists idx_shop_item_school_status on shop_item(school_id, status);
create index if not exists idx_shop_item_type on shop_item(school_id, type);
create index if not exists idx_shop_item_class_no on shop_item(school_id, class_no) where class_no is not null;
create unique index if not exists idx_shop_item_name_school on shop_item(lower(name), school_id) where status = 'active';

-- Table 2: shop_purchase_batch (lot/bill header)
create table if not exists shop_purchase_batch (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    purchase_date date not null,
    academic_session varchar(16),
    supplier varchar(128),
    invoice_number varchar(64),
    notes varchar(512),
    total_amount decimal(12,2),
    student_discount_pct decimal(5,2),
    bulk_discount_pct decimal(5,2),
    file_id varchar(12),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_shop_batch_school_id on shop_purchase_batch(school_id, status);
create index if not exists idx_shop_batch_date on shop_purchase_batch(school_id, purchase_date);
create index if not exists idx_shop_batch_session on shop_purchase_batch(school_id, academic_session) where academic_session is not null;

-- Table 3: shop_purchase_log (line items per batch)
create table if not exists shop_purchase_log (
    uuid varchar(12) primary key,
    batch_id varchar(12) not null,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
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

create index if not exists idx_shop_purchase_log_batch on shop_purchase_log(batch_id);
create index if not exists idx_shop_purchase_log_school on shop_purchase_log(school_id, status);
create index if not exists idx_shop_purchase_log_item on shop_purchase_log(item_id);

-- Table 4: shop_set (class sets)
create table if not exists shop_set (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    class_no smallint not null,
    academic_session varchar(16) not null,
    description varchar(512),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_shop_set_school_id on shop_set(school_id, status);
create index if not exists idx_shop_set_class_session on shop_set(school_id, class_no, academic_session);
create unique index if not exists idx_shop_set_class_session_unique on shop_set(school_id, class_no, academic_session) where status = 'active';

-- Table 5: shop_set_item (items within a class set)
create table if not exists shop_set_item (
    uuid varchar(12) primary key,
    set_id varchar(12) not null,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
    section varchar(16) not null check (section in ('main', 'additional', 'other')),
    quantity integer not null,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_shop_set_item_set_id on shop_set_item(set_id);
create index if not exists idx_shop_set_item_school on shop_set_item(school_id, status);

-- Table 6: shop_sale (sale/bill header)
create table if not exists shop_sale (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    student_id varchar(12) not null,
    sale_date date not null,
    set_id varchar(12),
    academic_session varchar(16),
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

create index if not exists idx_shop_sale_school_id on shop_sale(school_id, status);
create index if not exists idx_shop_sale_student on shop_sale(school_id, student_id);
create index if not exists idx_shop_sale_date on shop_sale(school_id, sale_date);
create index if not exists idx_shop_sale_session on shop_sale(school_id, academic_session) where academic_session is not null;
create index if not exists idx_shop_sale_payment on shop_sale(school_id, payment_status);

-- Table 7: shop_sale_item (line items per sale)
create table if not exists shop_sale_item (
    uuid varchar(12) primary key,
    sale_id varchar(12) not null,
    school_id varchar(12) not null,
    item_id varchar(12) not null,
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

create index if not exists idx_shop_sale_item_sale_id on shop_sale_item(sale_id);
create index if not exists idx_shop_sale_item_school on shop_sale_item(school_id, status);
