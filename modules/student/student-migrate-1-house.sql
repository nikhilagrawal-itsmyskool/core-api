-- Student migration 1: the House domain (identity + staff + lifelong assignment).
-- Additive and idempotent — safe to re-run and safe on a populated DB. Mirrors the
-- house section of student-setup.sql; extracted here so existing prod databases can
-- apply just the house domain incrementally. Consumed by the assembly house-mode
-- feature (house-on-duty), but the domain itself is student-owned.

-- house — per-school managed lookup (lifelong assignment; survives promotion).
create table if not exists house (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(96) not null,
    code varchar(32) not null,
    color varchar(16),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_house_school_status on house(school_id, status);
create unique index if not exists idx_house_code_unique on house(school_id, lower(code)) where status = 'active';

-- house_teacher — a house's staff (in-charge / co-in-charge / member teachers).
create table if not exists house_teacher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    house_id varchar(12) not null,
    employee_id varchar(12) not null,
    role varchar(16) not null check (role in ('incharge', 'coincharge', 'member')),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_house_teacher_unique on house_teacher(house_id, employee_id) where status = 'active';
create index if not exists idx_house_teacher_house on house_teacher(school_id, house_id) where status = 'active';

-- student.house_id — lifelong House assignment (nullable; survives promotion).
alter table student add column if not exists house_id varchar(12);
