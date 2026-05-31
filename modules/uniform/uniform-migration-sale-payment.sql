alter table uniform_return add column if not exists file_id varchar(12);

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
