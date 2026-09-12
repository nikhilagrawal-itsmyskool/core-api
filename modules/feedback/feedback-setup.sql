-- Feedback / complaint module schema — ticketing model.
-- All SQL lowercase, no foreign keys, enum fields via CHECK, no DDL defaults, uuids
-- are varchar(12), soft delete via status, idempotent (IF NOT EXISTS). Safe to re-run.
--
-- Home-visit feedback modelled as an OPEN-ROUTING TICKET:
--   * A teacher records feedback for a student (with optional evidence files) and assigns
--     it to a teacher (or the director).
--   * The current owner (or god) can reassign it to anyone — forward or send back — with a
--     mandatory comment (god may assign without a comment).
--   * Any participant can add status-neutral comments (with @mentions + files).
--   * The director (god) completes it (satisfied) or cancels it (recorded in error); a
--     completed/cancelled ticket can be reopened.
-- Statuses: open -> completed | cancelled (reopen flips a terminal ticket back to open).
-- "Awaiting director" is derived (open AND current owner holds a reviewer role), not stored.
--
-- Every act is one append-only row in feedback_event (the timeline). Files hang off events
-- in the shared file_storage table (entity_type='feedback', entity_id = the event uuid).
-- Watchers (feedback_watcher) get in-app notifications; @mentions add the mentioned person
-- as a watcher + a direct ping.

-- feedback_category: per-school category taxonomy. Seeded on first use.
create table if not exists feedback_category (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(64) not null,
    sort_order integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_feedback_category_unique
    on feedback_category(school_id, lower(name)) where status <> 'deleted';

-- feedback: the ticket header. Current status + current owner (assigned_to); the timeline
-- (feedback_event) is the source of truth for history. feedback_text is the canonical
-- "what the complaint is" and stays pinned; evidence files hang off the `record` event.
create table if not exists feedback (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12),
    student_id varchar(12) not null,
    class_id varchar(12),
    category_id varchar(12),
    feedback_text text not null,
    visit_date date,
    assigned_to varchar(12) not null,       -- current owner (teacher or director)
    recorded_by varchar(12),
    status varchar(16) not null check (status in ('open', 'completed', 'cancelled')),
    closed_by varchar(12),                  -- who completed/cancelled it
    closed_at timestamp(0),
    last_activity_at timestamp(0),          -- max(event.created_at); powers unread + sort
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
-- Additive columns for an already-created table (fresh installs get them above).
alter table feedback add column if not exists closed_by varchar(12);
alter table feedback add column if not exists closed_at timestamp(0);
alter table feedback add column if not exists last_activity_at timestamp(0);
create index if not exists idx_feedback_status on feedback(school_id, status);
create index if not exists idx_feedback_assigned on feedback(school_id, assigned_to, status);
create index if not exists idx_feedback_student on feedback(school_id, student_id);
create index if not exists idx_feedback_year on feedback(school_id, academic_year_id);
create index if not exists idx_feedback_activity on feedback(school_id, last_activity_at);

-- feedback_event: append-only timeline. One row per act. `assign` carries from/to_assignee;
-- transitions carry from/to_status; `mentions` is a jsonb array of employee uuids.
create table if not exists feedback_event (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    feedback_id varchar(12) not null,
    event_type varchar(16) not null check (event_type in ('record', 'comment', 'assign', 'complete', 'reopen', 'cancel')),
    actor_id varchar(12),
    body text,
    from_status varchar(16),
    to_status varchar(16),
    from_assignee varchar(12),
    to_assignee varchar(12),
    mentions jsonb,
    created_at timestamp          -- full precision: the timeline orders on this, sub-second matters
);
-- Widen precision on an already-created table (was timestamp(0)).
alter table feedback_event alter column created_at type timestamp;
create index if not exists idx_feedback_event_feedback on feedback_event(feedback_id, created_at);

-- feedback_watcher: the notification audience for a ticket. Auto-populated (recorder,
-- every assignee, the director once involved, anyone @mentioned). `muted` suppresses pings;
-- `last_seen_at` drives the unread indicator (last_activity_at > last_seen_at = unread).
create table if not exists feedback_watcher (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    feedback_id varchar(12) not null,
    employee_id varchar(12) not null,
    muted boolean,
    last_seen_at timestamp(0),
    added_at timestamp(0)
);
create unique index if not exists idx_feedback_watcher_unique on feedback_watcher(feedback_id, employee_id);
create index if not exists idx_feedback_watcher_employee on feedback_watcher(school_id, employee_id);
