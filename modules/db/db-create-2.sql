-- File Storage Schema
-- Generic file storage backed by PostgreSQL (base64 text)
-- Designed for easy S3 migration: swap file-storage.ts implementation, keep same interface
-- No status column - files are hard-deleted (no point keeping orphaned blobs)

create table if not exists file_storage (
    uuid varchar(12) primary key,
    file_name varchar(256) not null,
    mime_type varchar(128) not null,
    size_bytes integer not null,
    data text not null,
    entity_type varchar(64) not null,
    entity_id varchar(12) not null,
    school_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_file_storage_entity on file_storage(entity_type, entity_id);
create index if not exists idx_file_storage_school on file_storage(school_id);
