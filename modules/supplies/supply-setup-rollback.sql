-- Supplies Module Rollback Script
-- Drops all supplies tables and indexes.

drop index if exists idx_supply_wastage_school_status;
drop index if exists idx_supply_wastage_item;
drop table if exists supply_wastage_log;

drop index if exists idx_supply_issue_school_status;
drop index if exists idx_supply_issue_item;
drop table if exists supply_issue_log;

drop index if exists idx_supply_purchase_school_status;
drop index if exists idx_supply_purchase_batch;
drop index if exists idx_supply_purchase_item;
drop table if exists supply_purchase_log;

drop index if exists idx_supply_purchase_batch_school_status;
drop table if exists supply_purchase_batch;

drop index if exists idx_supply_item_name_category_school;
drop index if exists idx_supply_item_name;
drop index if exists idx_supply_item_school_category;
drop index if exists idx_supply_item_school_status;
drop table if exists supply_item;

drop index if exists idx_supply_category_code_unique;
drop index if exists idx_supply_category_school_status;
drop table if exists supply_category;

drop table if exists supply_seed_state;
