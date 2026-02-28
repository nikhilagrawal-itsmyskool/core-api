-- Data Sync Module Rollback
-- Removes columns added by data-sync-setup.sql

alter table employee_login drop column if exists must_change_password;

alter table student drop column if exists status;

alter table employee drop column if exists status;
