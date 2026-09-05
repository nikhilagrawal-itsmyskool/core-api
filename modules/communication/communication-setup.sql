-- Communication Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- An independent SMS/WhatsApp notification service. Other modules (attendance,
-- fees, exams ...) call it to send templated, transactional messages.
--
-- Design notes:
--  * message_template references an EXTERNALLY pre-approved template (Meta
--    WhatsApp / DLT SMS). We never compose free-form business-initiated content;
--    we resolve variables into provider_template_id. Templates are keyed by
--    (school, key, channel, language) so one logical "key" has a per-channel row.
--  * message_job IS the queue (claimed via "for update skip locked"), and is
--    self-describing: it carries its own audience spec, resolved LAZILY by the
--    worker at send time so scheduled sends use a live roster.
--  * message_recipient is the per-person expansion (created by the worker), one
--    row per resolved recipient with its own delivery status.

-- Table 1: message_template (pointer to an externally-approved template)
create table if not exists message_template (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    key varchar(64) not null,
    name varchar(128),
    channel varchar(16) not null check (channel in ('sms', 'whatsapp')),
    language varchar(8),
    provider varchar(32),
    provider_template_id varchar(128),
    category varchar(32),
    header_type varchar(16) check (header_type in ('none', 'text', 'image')),
    body_preview text,
    variables jsonb,
    variable_meta jsonb,
    status varchar(16) check (status in ('active', 'inactive', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Additive for existing DBs: per-variable UI metadata (hint + preset suggestions),
-- keyed by variable name, for the sender-supplied variables. Shape:
--   { "<var>": { "hint": "...", "suggestions": ["...", "..."] } }
alter table message_template add column if not exists variable_meta jsonb;

create index if not exists idx_message_template_school_status on message_template(school_id, status);
create index if not exists idx_message_template_key on message_template(school_id, key, channel);
-- One active template per (school, key, channel, language).
create unique index if not exists idx_message_template_unique
    on message_template(school_id, lower(key), channel, coalesce(language, '')) where status = 'active';

-- Table 2: message_job (the queue + self-describing batch)
create table if not exists message_job (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    status varchar(16) not null check (status in ('queued', 'expanding', 'sending', 'running', 'completed', 'failed', 'canceled')),
    scheduled_at timestamp(0),
    template_key varchar(64) not null,
    language varchar(8),
    force_channel varchar(16) check (force_channel in ('sms', 'whatsapp')),
    audience jsonb,
    audience_summary varchar(255),
    context jsonb,
    source varchar(32),
    worker_id varchar(64),
    heartbeat_at timestamp(0),
    attempts integer,
    error text,
    started_at timestamp(0),
    finished_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Worker claim ordering: oldest DUE queued job first.
create index if not exists idx_message_job_claim on message_job(status, scheduled_at);
create index if not exists idx_message_job_school on message_job(school_id, created_at);

-- Table 3: message_recipient (per-recipient expansion of a job, created lazily)
create table if not exists message_recipient (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    job_id varchar(12) not null,
    recipient_type varchar(16) not null check (recipient_type in ('student', 'employee')),
    recipient_id varchar(12),
    role varchar(16) check (role in ('father', 'mother', 'guardian', 'self')),
    to_number varchar(20),
    channel varchar(16) check (channel in ('sms', 'whatsapp')),
    template_id varchar(12),
    context jsonb,
    status varchar(16) check (status in ('pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
    worker_id varchar(64),
    provider_message_id varchar(128),
    error text,
    sent_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Additive for existing DBs: the send-claim marks which worker invocation owns a
-- recipient here (was wrongly stuffed into updatedby_userid, a varchar(12) that
-- overflowed on the drain's long worker id).
alter table message_recipient add column if not exists worker_id varchar(64);

create index if not exists idx_message_recipient_job on message_recipient(job_id);
create index if not exists idx_message_recipient_job_status on message_recipient(job_id, status);
create index if not exists idx_message_recipient_provider_msg on message_recipient(provider_message_id);

-- Employees are also message recipients and carry a channel preference; the
-- column does not exist on the base employee table, so add it here (forward-
-- compatible). Students already have communication_preference.
alter table employee add column if not exists communication_preference varchar(64);

-- ── In-app notifications (free/instant; separate from the SMS/WhatsApp queue) ──
-- A single polymorphic inbox for BOTH audiences (employee + student). Teacher PWA
-- reads it (polled); the native student app also gets a real push (device_token).
-- Written synchronously by notification-service (no message_job queue). See the
-- leave module's DESIGN.md §8.
create table if not exists notification (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    recipient_type varchar(16) not null check (recipient_type in ('employee', 'student')),
    recipient_id varchar(12) not null,
    key varchar(64),
    title varchar(128),
    body text,
    entity_type varchar(32),
    entity_id varchar(12),
    read_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0)
);
create index if not exists idx_notification_recipient
    on notification(school_id, recipient_type, recipient_id, created_at);
create index if not exists idx_notification_unread
    on notification(school_id, recipient_type, recipient_id, read_at);

-- device_token: a native app's push token (Expo/FCM/APNs). Teacher PWA registers
-- none (inbox only); the student native app registers here for real push.
create table if not exists device_token (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    recipient_type varchar(16) not null check (recipient_type in ('employee', 'student')),
    recipient_id varchar(12) not null,
    platform varchar(16) check (platform in ('ios', 'android', 'web')),
    token varchar(255) not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    last_seen timestamp(0),
    created_at timestamp(0),
    updated_at timestamp(0)
);
create unique index if not exists idx_device_token_unique
    on device_token(school_id, token) where status = 'active';
create index if not exists idx_device_token_recipient
    on device_token(school_id, recipient_type, recipient_id, status);
