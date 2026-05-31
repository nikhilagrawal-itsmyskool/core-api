-- File Storage Rollback Script

drop index if exists idx_file_storage_school;
drop index if exists idx_file_storage_entity;
drop table if exists file_storage;
