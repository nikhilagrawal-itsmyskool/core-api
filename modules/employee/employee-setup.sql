-- Employee module schema — the staff document handbook (policy documents that staff
-- must read and acknowledge/sign).
--
-- All SQL lowercase, no foreign keys, enum fields via CHECK, no DDL defaults, uuids are
-- varchar(12), soft delete via status, idempotent (IF NOT EXISTS). Safe to re-run.
-- Core employee / employee_login tables live in modules/db/*; this file only adds the
-- document-acknowledgement subsystem. Tables carry the `employee_` prefix so they group
-- with the other employee-owned tables (employee_attendance_*, employee_biometric_map).
--
-- A school publishes versioned employee_document rows; each staff member records an
-- employee_document_ack (read + signed). Signing is configurable per document via
-- sign_modes: 'digital' (typed declaration + a drawn signature image), 'upload' (print,
-- physically sign the last page, upload the scan), or 'both' (employee's choice).
--
-- employee_id discriminates the two document kinds this table is designed to hold:
--   NULL      -> a SHARED, school-wide document (leave policy, handbook) — v1 scope.
--   <emp uuid> -> a PERSONAL document owned by one employee (appointment letter,
--                 certificate) — the future per-employee "My Documents" vault.
-- The /me surface shows documents where employee_id is null OR equals the caller, so the
-- same table serves both with no migration when personal docs land.

-- employee_document: one versioned document per (school, code). Bumping version requires a
-- fresh acknowledgement from every staff member.
create table if not exists employee_document (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    employee_id varchar(12),              -- null = shared (all staff); set = personal doc
    code varchar(48) not null,            -- stable key, e.g. 'staff_leave_policy'
    title varchar(200) not null,
    category varchar(32),                 -- 'policy' | 'handbook' | 'form' | ...
    version integer not null,             -- bump to re-require acknowledgement
    summary varchar(600),
    body_html text,                       -- readable content rendered in-app + printed
    pdf_file_id varchar(12),              -- optional uploaded PDF (else body_html prints)
    effective_from date,
    audience varchar(16) not null check (audience in ('all', 'teaching', 'non_teaching')),
    sign_modes varchar(16) not null check (sign_modes in ('digital', 'upload', 'both')),
    requires_ack boolean not null,        -- false = read-only reference (no signature)
    exempt_roles varchar(400),            -- CSV of role names exempt from signing (they still see it)
    status varchar(16) not null check (status in ('draft', 'published', 'archived')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
-- coalesce(employee_id,'') so shared docs (null owner) dedupe by code+version, while a
-- personal doc is unique per (owner, code, version) rather than clashing across employees.
-- Additive for already-created tables (the inline column above only applies to fresh installs).
alter table employee_document add column if not exists exempt_roles varchar(400);
create unique index if not exists idx_employee_document_code_version
    on employee_document(school_id, coalesce(employee_id, ''), lower(code), version) where status <> 'archived';
create index if not exists idx_employee_document_school_status
    on employee_document(school_id, status);
create index if not exists idx_employee_document_owner
    on employee_document(school_id, employee_id) where employee_id is not null;

-- employee_document_ack: one acknowledgement per (document version, employee). Append-only
-- in spirit — a version bump creates a new required ack rather than editing this row.
create table if not exists employee_document_ack (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    document_id varchar(12) not null,
    document_version integer not null,
    employee_id varchar(12) not null,
    method varchar(16) not null check (method in ('digital', 'upload')),
    declared_name varchar(120),
    declared_designation varchar(120),
    declared_emp_id varchar(60),
    agreed boolean not null,              -- the "I have read and agree" checkbox
    signature_file_id varchar(12),        -- drawn signature image (digital)
    signed_page_file_id varchar(12),      -- uploaded physically-signed page (upload)
    ip varchar(64),
    user_agent varchar(256),
    status varchar(16) not null check (status in ('active', 'revoked')),
    acknowledged_at timestamp(0),
    created_at timestamp(0),
    updated_at timestamp(0)
);
create unique index if not exists idx_employee_document_ack_unique
    on employee_document_ack(school_id, document_id, document_version, employee_id)
    where status = 'active';
create index if not exists idx_employee_document_ack_doc
    on employee_document_ack(school_id, document_id, document_version);
create index if not exists idx_employee_document_ack_employee
    on employee_document_ack(school_id, employee_id);
