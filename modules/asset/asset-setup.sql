-- Asset Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- Assets form a single containment tree (parent_id = where the asset physically
-- sits; a room is itself an asset). The "type" of a node is a managed, per-school
-- lookup (asset_type) rather than a hardcoded enum, so the school-specific list of
-- asset kinds can evolve without code changes. Default types are seeded in
-- application code on first use (see asset-type-service.ts), not here.

-- Table 1: asset_type (managed lookup of asset kinds per school)
create table if not exists asset_type (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    code varchar(32) not null,
    label varchar(64) not null,
    kind varchar(16) not null check (kind in ('container', 'item')),
    tag_abbr varchar(8),
    include_in_tag boolean,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- tag_abbr/include_in_tag added after initial release; guard for existing tables.
alter table asset_type add column if not exists tag_abbr varchar(8);
alter table asset_type add column if not exists include_in_tag boolean;

create index if not exists idx_asset_type_school_status on asset_type(school_id, status);
create unique index if not exists idx_asset_type_code_unique on asset_type(school_id, lower(code)) where status = 'active';

-- Table 2: asset (the tree of physical assets)
create table if not exists asset (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    type_id varchar(12) not null,
    name varchar(128) not null,
    parent_id varchar(12),
    quantity integer not null,
    asset_code varchar(128),
    tag_seq integer,
    asset_condition varchar(32) check (asset_condition in ('new', 'good', 'fair', 'needs_repair', 'condemned')),
    responsible_id varchar(12),
    responsibility_remarks varchar(512),
    asset_status varchar(16) check (asset_status in ('active', 'condemned', 'disposed', 'lost')),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- tag_seq added after initial release; widen asset_code for full hierarchy paths.
alter table asset add column if not exists tag_seq integer;
alter table asset alter column asset_code type varchar(128);

create index if not exists idx_asset_school on asset(school_id);
create index if not exists idx_asset_school_status on asset(school_id, status);
create index if not exists idx_asset_parent on asset(parent_id);
create index if not exists idx_asset_school_parent_status on asset(school_id, parent_id, status);
create index if not exists idx_asset_school_type on asset(school_id, type_id);
create index if not exists idx_asset_responsible on asset(school_id, responsible_id);
create unique index if not exists idx_asset_code_unique on asset(school_id, lower(asset_code)) where asset_code is not null and status = 'active';

-- Table 3: asset_movement_log (history of location/parent changes)
create table if not exists asset_movement_log (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    asset_id varchar(12) not null,
    result_asset_id varchar(12),
    from_parent_id varchar(12),
    to_parent_id varchar(12),
    from_code varchar(128),
    to_code varchar(128),
    quantity_moved integer not null,
    movement_date date not null,
    reason varchar(512),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- from_code/to_code (tag before/after a move) added after initial release.
alter table asset_movement_log add column if not exists from_code varchar(128);
alter table asset_movement_log add column if not exists to_code varchar(128);

create index if not exists idx_asset_movement_school on asset_movement_log(school_id);
create index if not exists idx_asset_movement_asset on asset_movement_log(asset_id);
create index if not exists idx_asset_movement_school_status on asset_movement_log(school_id, status);
