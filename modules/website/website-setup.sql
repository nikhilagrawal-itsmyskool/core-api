-- Website module: pushes curated Moments photos into a school's Contentful CMS (per-school,
-- optional plugin). Reads the Moments photo pool, uploads selected images as TAGGED Contentful
-- assets, and groups them into a Contentful entry (v1: a School Event). It never writes to the
-- outreach/Moments tables. Conventions: all lowercase, no FKs (app-validated), enums via CHECK,
-- no DDL defaults, varchar(12) uuids via generateShortUuid, idempotent IF NOT EXISTS.

-- Per-school Contentful connection. A row = the module is enabled for that school; no row =
-- the module is invisible there (keeps the sellable core clean). The CMA token is NOT stored
-- here — it's read from the lambda env (cma_token_param names the SSM param for the record).
create table if not exists website_config (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    space_id varchar(64) not null,
    environment varchar(64) not null,
    default_locale varchar(16),
    cma_token_param varchar(256),
    status varchar(16) not null check (status in ('active', 'disabled')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_website_config_school on website_config(school_id) where status = 'active';

-- One row per push to Contentful. Tracks the resulting Contentful entry so a re-push updates
-- it instead of duplicating. fields_json is the exact payload sent (for display + re-sync).
create table if not exists website_publication (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    content_type varchar(32) not null check (content_type in ('event', 'blogPost', 'mediaCoverage', 'schoolAnnouncement')),
    contentful_entry_id varchar(64),
    contentful_status varchar(16) not null check (contentful_status in ('draft', 'published', 'unpublished')),
    -- The Contentful work (many asset uploads) runs async in a worker — a push can exceed the
    -- API-Gateway 29s limit. push_status tracks it; push_detail carries progress / error text.
    push_status varchar(16) not null check (push_status in ('queued', 'processing', 'done', 'failed')),
    push_detail varchar(256),
    source_moment_id varchar(12),
    title varchar(256),
    fields_json jsonb,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0),
    published_at timestamp(0)
);
create index if not exists idx_website_pub_school on website_publication(school_id, status, created_at);
create index if not exists idx_website_pub_moment on website_publication(source_moment_id);
create index if not exists idx_website_pub_queue on website_publication(push_status) where push_status in ('queued', 'processing');

-- The selected photos of a publication -> their Contentful assets, with the TAGS applied to each
-- image (tags_json = array of Contentful tag ids). This is the per-image tagging that drives the
-- website galleries. contentful_asset_id lets a re-push reuse/retag the same asset.
create table if not exists website_publication_asset (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    publication_id varchar(12) not null,
    source_photo_id varchar(12) not null,
    file_id varchar(12),
    contentful_asset_id varchar(64),
    tags_json jsonb,
    seq integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    created_at timestamp(0),
    updated_at timestamp(0)
);
create index if not exists idx_website_pub_asset_pub on website_publication_asset(publication_id, status);

-- Append-only activity log.
create table if not exists website_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    publication_id varchar(12),
    action varchar(16) check (action in ('create', 'update', 'publish', 'unpublish', 'delete', 'push')),
    detail varchar(512),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_website_audit_pub on website_audit(publication_id);
