-- Rollback for db-create-4.sql (file_storage S3 columns).
-- NOTE: `alter column data set not null` fails if any row already has a null data
-- value (i.e. after the DB->S3 object migration has run). Only run this rollback while
-- the data column is still fully populated (schema change not yet followed by the
-- object migration in scripts/migrate-file-storage-to-s3.js).

drop index if exists idx_file_storage_storage_key;
alter table file_storage alter column data set not null;
alter table file_storage drop column if exists storage_key;
