-- Rollback for db-create-3.sql (class ordering seq column).

drop index if exists idx_class_seq_school;
alter table class drop column if exists seq;
