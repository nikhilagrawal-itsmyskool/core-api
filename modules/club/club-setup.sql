-- Club (Clubs & Activities) module schema.
-- Day-neutral engine for co-curricular clubs: a per-club versioned activity bank, a
-- weekly plan board (plan -> slot -> group -> assignment -> completion), a review queue,
-- and an append-only audit. Per-school display name (e.g. "Saturday Activities") lives in
-- club_setting. Reuses existing ERP masters by reference (employee / class / academic_year
-- / room) — no parallel copies, no foreign keys (validated in app code).
--
-- Conventions: all lowercase; uuids varchar(12); enum-like fields via CHECK; no DDL
-- defaults (set in app code); soft delete via status; additive + idempotent (safe re-run).
-- The role->permission override table (authz_permission_override) is CENTRAL and lives in
-- modules/auth/auth-setup.sql — not here.

-- ── CLUB aggregate ────────────────────────────────────────────────────────────

-- club: one co-curricular club (SRIJAN Craft, Art, Science, ...). club_code is the
-- human-facing unique key; uuid is the relationship key used everywhere else.
create table if not exists club (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    club_code varchar(32) not null,
    name varchar(128) not null,
    display_name varchar(128),
    in_charge_employee_id varchar(12),
    applicable_grades jsonb,                         -- ["Nursery","I",...] (display/eligibility)
    status varchar(16) not null check (status in ('planned', 'active', 'inactive')),
    sort_order integer,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_club_code on club(school_id, lower(club_code));
create index if not exists idx_club_school on club(school_id, status);

-- club_config: the "flexible by club" knobs (1:1 with club). Categories/strands, enabled
-- capability blocks and a few defaults/gates — small jsonb, no custom-field sprawl.
create table if not exists club_config (
    uuid varchar(12) primary key,
    club_id varchar(12) not null,
    categories jsonb,                                -- ["Paper & Mixed-Media","Clay & Pottery",...]
    enabled_blocks jsonb,                            -- ["portfolio","exhibition","safety"]
    defaults jsonb,                                  -- {"venueType":"Art Room","evidence":"sample"}
    exception_rules jsonb,                           -- {"specialApprovalCategories":["Clay & Pottery"]}
    trial_mode boolean,                              -- is authorised Trial-version picking on?
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_club_config_club on club_config(club_id);

-- club_setting: per-school programme settings (1 row per school). The day-neutral display
-- name, default slot windows, and the soft parallel-club limit (admin-only).
create table if not exists club_setting (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    display_name varchar(128),                       -- e.g. "Saturday Activities" / "Activity Period"
    default_slots jsonb,                             -- [{"start":"09:00","end":"10:00","label":"Slot 1"}]
    parallel_club_limit integer,                     -- soft cap (warning), null = no limit
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_club_setting_school on club_setting(school_id);

-- ── ACTIVITY aggregate (the bank) ───────────────────────────────────────────────

-- club_activity: the stable IDENTITY of an activity. Content lives on versions. Availability
-- controls whether it is offered at all (independent of version status). activity_code is
-- OPAQUE (never parsed for club/grade — use the explicit columns).
create table if not exists club_activity (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    club_id varchar(12) not null,
    activity_code varchar(48) not null,
    availability varchar(16) not null check (availability in ('planned', 'available', 'suspended', 'archived')),
    current_version_id varchar(12),                  -- the Approved version in normal use
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_club_activity_code on club_activity(school_id, lower(activity_code));
create index if not exists idx_club_activity_club on club_activity(club_id, availability);

-- club_activity_version: the CONTENT, versioned & immutable once used in a published plan.
-- status = draft/trial/approved/superseded. Columns mirror the SRIJAN workbook; lean core +
-- optional metadata jsonb kept off the default screen.
create table if not exists club_activity_version (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    activity_id varchar(12) not null,
    version_no integer not null,
    status varchar(16) not null check (status in ('draft', 'trial', 'approved', 'superseded')),
    title varchar(256) not null,
    grade_level varchar(32),                         -- SRIJAN "Level" (Nursery..XII)
    category varchar(128),                           -- validated against club_config.categories
    difficulty varchar(32),
    prep_burden varchar(32),
    activity_mode varchar(32),                       -- Individual/Pair/Small Group/Team/Whole Group/Mixed
    est_duration integer,                            -- minutes
    recommended_sequence integer,
    learning_outcome text,
    teacher_preparation text,
    procedure text,
    risk_safety text,
    safety_level varchar(24) check (safety_level in ('routine', 'supervised', 'special-approval')),
    assessment_checklist text,
    related_vocabulary text,
    materials_summary text,                          -- free-text; structured lines in club_activity_material
    material_quantity_plan text,
    evidence_note text,
    support_enrichment text,
    cleanup_storage text,
    min_repeat_gap_days integer,
    metadata jsonb,                                  -- optional off-screen (season, special-day, curriculum link)
    approvedby_userid varchar(12),
    approved_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_club_activity_version_no on club_activity_version(activity_id, version_no);
create index if not exists idx_club_activity_version_status on club_activity_version(activity_id, status);

-- club_activity_material: structured material LINES for a version (power guide + material sheet;
-- NOT an inventory module).
create table if not exists club_activity_material (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    version_id varchar(12) not null,
    item varchar(256) not null,
    quantity_note varchar(128),
    provided_by varchar(24) check (provided_by in ('school', 'student', 'teacher', 'other')),
    consumable boolean,
    seq integer
);
create index if not exists idx_club_activity_material_version on club_activity_material(version_id);

-- club_activity_resource: version-linked attachments (worksheet/template/image/guide). Files
-- live in the shared file_storage table (entity_type='club', entity_id=resource uuid).
create table if not exists club_activity_resource (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    version_id varchar(12) not null,
    kind varchar(24) check (kind in ('teacher-guide', 'student-printable', 'reference', 'image', 'worksheet', 'template')),
    audience varchar(24),
    title varchar(256),
    file_storage_ref varchar(12),
    seq integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);
create index if not exists idx_club_activity_resource_version on club_activity_resource(version_id, status);

-- club_activity_review: exception-driven quality/improvement review of an ACTIVITY. Triggered
-- by a completion's "needs review"/safety signal or a manual flag; decision mutates the activity.
create table if not exists club_activity_review (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    activity_id varchar(12) not null,
    version_id varchar(12),
    signal varchar(24) check (signal in ('needs-review', 'safety', 'incomplete', 'manual')),
    source varchar(24) check (source in ('completion', 'manual', 'safety', 'auto')),
    source_ref varchar(12),                          -- completion/assignment uuid
    decision varchar(16) check (decision in ('keep', 'revise', 'suspend', 'archive')),
    note text,
    status varchar(16) not null check (status in ('open', 'closed')),
    raisedby_userid varchar(12),
    raised_at timestamp(0),
    decidedby_userid varchar(12),
    decided_at timestamp(0)
);
create index if not exists idx_club_activity_review_status on club_activity_review(school_id, status);
create index if not exists idx_club_activity_review_activity on club_activity_review(activity_id);

-- club_import: round-trip history of bulk imports for a club's bank. The uploaded .xlsx is
-- kept in file_storage (entity_type='club-import'); every re-import is a new revision.
create table if not exists club_import (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    club_id varchar(12) not null,
    file_storage_ref varchar(12),
    file_name varchar(256),
    template_version varchar(24),
    row_count integer,
    added_count integer,
    updated_count integer,
    status varchar(16) not null check (status in ('preview', 'committed', 'failed')),
    note text,
    createdby_userid varchar(12),
    created_at timestamp(0)
);
create index if not exists idx_club_import_club on club_import(club_id, created_at);

-- ── PLAN aggregate (operational) ────────────────────────────────────────────────

-- club_plan: one weekly plan = one activity day, bound to an academic session + calendar date.
-- row_version is the optimistic-lock guard against silent concurrent overwrite.
create table if not exists club_plan (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    plan_date date not null,
    title varchar(128),
    participation_scope varchar(16) check (participation_scope in ('whole', 'grades', 'groups')),
    coverage varchar(16) check (coverage in ('complete', 'selective')),
    status varchar(16) not null check (status in ('draft', 'published', 'closed', 'cancelled')),
    row_version integer not null,
    note text,
    published_at timestamp(0),
    publishedby_userid varchar(12),
    closed_at timestamp(0),
    closedby_userid varchar(12),
    cancel_reason text,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_club_plan_date
    on club_plan(school_id, academic_year_id, plan_date) where status <> 'cancelled';
create index if not exists idx_club_plan_lookup on club_plan(school_id, plan_date);

-- club_plan_slot: a time window within a plan (overlap checks use actual start/end, not label).
create table if not exists club_plan_slot (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    plan_id varchar(12) not null,
    start_time varchar(5) not null,                  -- 'HH:MM' (24h)
    end_time varchar(5) not null,
    label varchar(64),
    seq integer
);
create index if not exists idx_club_plan_slot_plan on club_plan_slot(plan_id);

-- club_plan_group: a group to cover in a plan. source_type reuses existing ERP structures;
-- label/strength are SNAPSHOTTED so history survives promotion/roster change.
create table if not exists club_plan_group (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    plan_id varchar(12) not null,
    source_type varchar(16) check (source_type in ('class', 'club', 'house', 'mixed', 'selected')),
    source_ref varchar(12),                          -- class/house/club uuid (null for ad-hoc)
    label_snapshot varchar(128) not null,
    strength_snapshot integer,
    seq integer
);
create index if not exists idx_club_plan_group_plan on club_plan_group(plan_id);

-- club_plan_group_member: optional roster-backed membership (only for mixed/selected groups
-- where duplicate-student / full-coverage validation is expected). Name snapshotted.
create table if not exists club_plan_group_member (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    plan_group_id varchar(12) not null,
    student_id varchar(12) not null,
    student_name_snapshot varchar(128)
);
create index if not exists idx_club_plan_group_member_group on club_plan_group_member(plan_group_id);

-- club_group / club_group_member: SCHOOL-LEVEL reusable "saved groups" (independent of any
-- plan). A plan group can be promoted into one, and plans can add from saved groups.
create table if not exists club_group (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    source_type varchar(16) check (source_type in ('class', 'house', 'club', 'mixed', 'selected')),
    source_ref varchar(12),
    strength_snapshot integer,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_club_group_school on club_group(school_id, status);

create table if not exists club_group_member (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    group_id varchar(12) not null,
    student_id varchar(12) not null,
    student_name_snapshot varchar(128)
);
create index if not exists idx_club_group_member_group on club_group_member(group_id);

-- A plan group may be linked to a saved group (saved_group_id) and flagged `edited` once it
-- diverges from its source/saved snapshot.
alter table club_plan_group add column if not exists saved_group_id varchar(12);
alter table club_plan_group add column if not exists edited boolean;

-- club_plan_assignment: the operational transaction — group + activity version + teacher +
-- venue + slot. An individual assignment can be Cancelled with reason, history retained.
create table if not exists club_plan_assignment (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    plan_id varchar(12) not null,
    slot_id varchar(12) not null,
    group_id varchar(12) not null,
    activity_version_id varchar(12) not null,
    club_id varchar(12),                             -- denormalised (derived from the activity)
    teacher_employee_id varchar(12),
    venue_ref varchar(12),
    venue_name_snapshot varchar(128),
    state varchar(16) not null check (state in ('scheduled', 'cancelled')),
    cancel_reason text,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_club_plan_assignment_plan on club_plan_assignment(plan_id, state);
create index if not exists idx_club_plan_assignment_slot on club_plan_assignment(slot_id);
create index if not exists idx_club_plan_assignment_teacher on club_plan_assignment(teacher_employee_id, state);

-- club_plan_completion: quick-closure outcome, 1:1 with an assignment. Conditional fields
-- (not-conducted reason / issue / incident ref) filled only when relevant.
create table if not exists club_plan_completion (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    assignment_id varchar(12) not null,
    plan_id varchar(12),
    outcome varchar(16) check (outcome in ('fully', 'partly', 'not')),
    participation_as_planned boolean,
    participation_actual integer,
    issue_type varchar(16) check (issue_type in ('none', 'material', 'time', 'venue', 'safety', 'other')),
    quality_signal varchar(24) check (quality_signal in ('as-planned', 'minor-change', 'needs-review')),
    not_conducted_reason text,
    note text,
    incident_ref varchar(12),
    closedby_userid varchar(12),
    closed_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_club_plan_completion_assignment on club_plan_completion(assignment_id);
create index if not exists idx_club_plan_completion_plan on club_plan_completion(plan_id);

-- ── Cross-cutting ─────────────────────────────────────────────────────────────

-- club_audit: append-only log of the meaningful state/security changes only (approve/publish/
-- cancel/change/close/reopen/override). actor_role is snapshotted (roles change over time).
create table if not exists club_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    at timestamp(0),
    actor_userid varchar(12),
    actor_role varchar(48),
    action varchar(48),
    object_type varchar(32),
    object_id varchar(12),
    before jsonb,
    after jsonb,
    reason text
);
create index if not exists idx_club_audit_object on club_audit(school_id, object_type, object_id);
create index if not exists idx_club_audit_at on club_audit(school_id, at);
