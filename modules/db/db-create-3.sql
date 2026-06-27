-- Class ordering
-- Adds an admin-controlled sort sequence to the class table so that class
-- dropdowns can be ordered explicitly (asc) instead of alphabetically by name.
-- Idempotent migration for existing databases (db-create-1.sql carries the
-- column for fresh setups).

alter table class add column if not exists seq integer;

create index if not exists idx_class_seq_school on class (school_id, seq);
