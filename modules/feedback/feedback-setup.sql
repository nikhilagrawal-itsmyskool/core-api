-- Feedback / complaint module schema.
-- All SQL lowercase, no foreign keys, enum fields via CHECK, no DDL defaults, uuids
-- are varchar(12), soft delete via status, idempotent (IF NOT EXISTS). Safe to re-run.
--
-- Home-visit feedback: a team member (teacher) records feedback for a student and
-- assigns it to a teacher; the teacher responds with a comment; a reviewer (the
-- "education director" — god for now) reviews and completes it (or reopens it).
-- Lifecycle: assigned -> responded -> completed, with completed/responded -> reopened.

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

-- feedback: one recorded home-visit feedback, assigned to a teacher.
create table if not exists feedback (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12),
    student_id varchar(12) not null,
    class_id varchar(12),
    category_id varchar(12),
    feedback_text text not null,
    visit_date date,
    assigned_to varchar(12) not null,
    recorded_by varchar(12),
    teacher_comment text,
    responded_by varchar(12),
    responded_at timestamp(0),
    review_note varchar(512),
    reviewed_by varchar(12),
    reviewed_at timestamp(0),
    status varchar(16) not null check (status in ('assigned', 'responded', 'completed', 'reopened')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_feedback_status on feedback(school_id, status);
create index if not exists idx_feedback_assigned on feedback(school_id, assigned_to, status);
create index if not exists idx_feedback_student on feedback(school_id, student_id);
create index if not exists idx_feedback_year on feedback(school_id, academic_year_id);

-- feedback_audit: append-only log of every state change.
create table if not exists feedback_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    feedback_id varchar(12) not null,
    action varchar(16) not null,
    detail varchar(256),
    from_status varchar(16),
    to_status varchar(16),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);
create index if not exists idx_feedback_audit_feedback on feedback_audit(feedback_id);
