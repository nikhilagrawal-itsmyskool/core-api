-- Lab Module Rollback Script
-- Drops all lab tables and indexes

drop index if exists idx_lab_breakage_school_status;
drop index if exists idx_lab_breakage_school;
drop index if exists idx_lab_breakage_lab;
drop index if exists idx_lab_breakage_item;
drop table if exists lab_breakage_log;

drop index if exists idx_lab_issue_school_status;
drop index if exists idx_lab_issue_school;
drop index if exists idx_lab_issue_lab;
drop index if exists idx_lab_issue_item;
drop table if exists lab_issue_log;

drop index if exists idx_lab_purchase_school_status;
drop index if exists idx_lab_purchase_school;
drop index if exists idx_lab_purchase_lab;
drop index if exists idx_lab_purchase_item;
drop table if exists lab_purchase_log;

drop index if exists idx_lab_item_name_lab_school_id;
drop index if exists idx_lab_item_name;
drop index if exists idx_lab_item_school_status;
drop index if exists idx_lab_item_school;
drop index if exists idx_lab_item_lab;
drop table if exists lab_item;

drop index if exists idx_lab_name_school_id;
drop index if exists idx_lab_school_status;
drop index if exists idx_lab_school;
drop table if exists lab;
