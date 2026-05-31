-- Medical Module Rollback Script
-- Drops all medical tables and indexes

drop index if exists idx_medical_purchase_batch_date;
drop index if exists idx_medical_purchase_batch_school_status;
drop index if exists idx_medical_purchase_batch_school;
drop table if exists medical_purchase_batch;

drop index if exists idx_medical_purchase_log_batch;

drop index if exists idx_medical_issue_log_status;
drop index if exists idx_medical_issue_log_school;
drop index if exists idx_medical_issue_log_entity;
drop index if exists idx_medical_issue_log_item;
drop table if exists medical_issue_log;

drop index if exists idx_medical_purchase_log_status;
drop index if exists idx_medical_purchase_log_school;
drop index if exists idx_medical_purchase_log_item;
drop table if exists medical_purchase_log;

drop index if exists idx_medical_item_name_school_id;
drop index if exists idx_medical_item_status;
drop index if exists idx_medical_item_name;
drop index if exists idx_medical_item_school_id;
drop table if exists medical_item;
