-- Outreach module ("Moments"): a parent-facing photo + text feed. One `moment` is a
-- post (title/body + photos) targeted at an audience (school / grade / class). A published
-- moment appears in the parent app with an in-app notification and emoji reactions (no
-- replies). Conventions: all lowercase, no foreign keys (validated in app code), enums via
-- CHECK, no DDL defaults (set in code), varchar(12) uuids via generateShortUuid, idempotent
-- IF NOT EXISTS so this file is safe to re-run and is the canonical schema source.

-- The post header. status: draft (staging — composing + attaching photos) -> published
-- (visible in the feed). Unpublish flips back to draft. Image bytes are NOT here.
create table if not exists moment (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    author_employee_id varchar(12),
    title varchar(256),
    body text,
    status varchar(16) not null check (status in ('draft', 'published')),
    published_at timestamp(0),
    publishedby_userid varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_moment_school_status on moment(school_id, status, published_at);
create index if not exists idx_moment_school_ay on moment(school_id, academic_year_id);
create index if not exists idx_moment_author on moment(school_id, author_employee_id);

-- One row per photo under a moment. The image itself lives in the shared file_storage
-- table (entity_type = 'outreach', entity_id = this photo uuid).
create table if not exists moment_photo (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    moment_id varchar(12) not null,
    caption varchar(256),
    seq integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_moment_photo_moment on moment_photo(moment_id, status);

-- Who a moment targets: a set of scope rows. scope = 'school' (ref_id null) means everyone;
-- 'grade' (ref_id = grade label, e.g. 'I' / 'VIII'); 'class' (ref_id = a class uuid).
create table if not exists moment_audience (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    moment_id varchar(12) not null,
    scope varchar(8) not null check (scope in ('school', 'grade', 'class')),
    ref_id varchar(64),
    created_at timestamp(0)
);
create index if not exists idx_moment_audience_moment on moment_audience(moment_id);

-- One emoji reaction per (moment, reactor). reactor_type employee|student; a parent reacts
-- as the active child (student uuid). emoji is a short token (love / like / clap / ...).
create table if not exists moment_reaction (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    moment_id varchar(12) not null,
    reactor_type varchar(8) not null check (reactor_type in ('student', 'employee')),
    reactor_id varchar(12) not null,
    emoji varchar(16) not null,
    created_at timestamp(0),
    updated_at timestamp(0)
);
create unique index if not exists idx_moment_reaction_unique on moment_reaction(moment_id, reactor_id);
create index if not exists idx_moment_reaction_moment on moment_reaction(moment_id);

-- Scheduled publish: a future publish_at on a draft = "scheduled" (a worker publishes it then
-- and notifies). Derived state, so no new status value / no CHECK migration needed.
alter table moment add column if not exists publish_at timestamp(0);
create index if not exists idx_moment_scheduled on moment(status, publish_at);

-- Videos on a moment = YouTube links (several per moment). Only the youtube id + original url
-- are stored; the parent app embeds the player. We never host video (long clips -> YouTube).
create table if not exists moment_video (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    moment_id varchar(12) not null,
    youtube_id varchar(32) not null,
    url varchar(512),
    caption varchar(256),
    seq integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_moment_video_moment on moment_video(moment_id, status);

-- Append-only activity log.
create table if not exists moment_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    moment_id varchar(12),
    action varchar(16) check (action in ('create', 'edit', 'photo-add', 'photo-remove', 'publish', 'unpublish')),
    detail varchar(256),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_moment_audit_moment on moment_audit(moment_id);
