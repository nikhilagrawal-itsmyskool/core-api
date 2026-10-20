-- file_storage: move objects to S3
-- Adds the S3 object key column and lets the inline blob (data) become null once an
-- object has been copied to S3. Idempotent migration for existing databases
-- (db-create-1.sql should carry these for fresh setups).

alter table file_storage add column if not exists storage_key varchar(512);
-- Which backend holds the bytes: 's3' (default) | 'r2' (Cloudflare, zero-egress) | null (legacy).
-- Lets a single file_storage table mix providers (e.g. outreach photos on R2, the rest on S3).
alter table file_storage add column if not exists storage_provider varchar(8);
alter table file_storage alter column data drop not null;
create index if not exists idx_file_storage_storage_key on file_storage (storage_key);
