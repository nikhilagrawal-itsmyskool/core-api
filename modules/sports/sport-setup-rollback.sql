-- Sport Module Rollback Script
-- Drops all sport tables and indexes

drop index if exists idx_sport_breakage_school_status;
drop index if exists idx_sport_breakage_school;
drop index if exists idx_sport_breakage_sport;
drop index if exists idx_sport_breakage_item;
drop table if exists sport_breakage_log;

drop index if exists idx_sport_issue_school_status;
drop index if exists idx_sport_issue_school;
drop index if exists idx_sport_issue_sport;
drop index if exists idx_sport_issue_item;
drop table if exists sport_issue_log;

drop index if exists idx_sport_purchase_batch_school_status;
drop index if exists idx_sport_purchase_batch_school;
drop table if exists sport_purchase_batch;

drop index if exists idx_sport_purchase_batch_id;
drop index if exists idx_sport_purchase_school_status;
drop index if exists idx_sport_purchase_school;
drop index if exists idx_sport_purchase_sport;
drop index if exists idx_sport_purchase_item;
drop table if exists sport_purchase_log;

drop index if exists idx_sport_item_name_sport_school_id;
drop index if exists idx_sport_item_name;
drop index if exists idx_sport_item_school_status;
drop index if exists idx_sport_item_school;
drop index if exists idx_sport_item_sport;
drop table if exists sport_item;

drop index if exists idx_sport_incharge_unique;
drop index if exists idx_sport_incharge_school;
drop table if exists sport_incharge;
