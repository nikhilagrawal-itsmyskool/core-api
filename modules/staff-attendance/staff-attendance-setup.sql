-- Staff attendance module schema (distinct from the student roll-call `attendance` module).
-- Derives daily staff attendance from biometric punches (modules/biometric: biometric_punch)
-- against per-school, season-aware policy; adds a regularization workflow approved by the
-- education-director. Reads leave + holidays like the leave module. Links to payroll later.
-- Conventions: lowercase; no FKs (validated in app); no DDL defaults; enum = varchar + check;
-- every statement additive + idempotent. Apply:
--   node scripts/run-sql.js --stage <stage> --file modules/staff-attendance/staff-attendance-setup.sql

-- Per-school defaults + global settings (one row per school).
create table if not exists staff_attendance_config (
  uuid varchar(12) primary key,
  school_id varchar(12),
  expected_in varchar(5),              -- 'HH:MM' default check-in (when no season matches)
  expected_out varchar(5),             -- 'HH:MM' default check-out
  grace_min integer,                   -- minutes of lateness tolerated before 'late'
  half_day_after_min integer,          -- if worked minutes < this -> half day
  min_present_min integer,             -- below this worked -> treated as absent-ish (optional)
  enabled varchar(8) check (enabled in ('on', 'off')),
  createdby_userid varchar(12),
  created_at timestamp(0),
  updatedby_userid varchar(12),
  updated_at timestamp(0)
);
create unique index if not exists idx_staff_att_config_school on staff_attendance_config (school_id);

-- Exemption from staff attendance (who does NOT appear in the roster/dashboard). Effective rule:
-- an employee is exempt if (holds any role in exempt_role_codes OR is in exempt_employee_ids)
-- AND is NOT in include_employee_ids. So you can exempt a whole role and still pull one person
-- back in. All CSV columns; empty/null = nothing exempted.
alter table staff_attendance_config add column if not exists exempt_role_codes text;
alter table staff_attendance_config add column if not exists include_employee_ids text;  -- 'take attendance anyway' (override)
alter table staff_attendance_config add column if not exists exempt_employee_ids text;   -- also exempt (no role needed)

-- Seasonal timing overrides (summer/winter/...). Recurring by month-day (no year), so no
-- annual maintenance; a window may wrap the year end (start_md > end_md). A date picks the
-- first matching active season (by sort_order); none -> config defaults.
create table if not exists staff_attendance_season (
  uuid varchar(12) primary key,
  school_id varchar(12),
  name varchar(40),                    -- 'Summer', 'Winter', ...
  start_month integer,                 -- 1..12
  start_day integer,                   -- 1..31
  end_month integer,
  end_day integer,
  expected_in varchar(5),              -- 'HH:MM'
  expected_out varchar(5),
  grace_min integer,
  half_day_after_min integer,
  sort_order integer,
  status varchar(16) check (status in ('active', 'deleted')),
  createdby_userid varchar(12),
  created_at timestamp(0),
  updatedby_userid varchar(12),
  updated_at timestamp(0)
);
create index if not exists idx_staff_att_season_school on staff_attendance_season (school_id, status);

-- Regularization requests: an employee claims an in/out for a day the device missed or
-- flagged. education-director (or god) approves; on approval the derived day is overridden.
create table if not exists staff_attendance_regularization (
  uuid varchar(12) primary key,
  school_id varchar(12),
  employee_id varchar(12),
  att_date date,
  kind varchar(16) check (kind in ('missing_in', 'missing_out', 'missing_both', 'late', 'absent', 'other')),
  claimed_in varchar(5),               -- 'HH:MM' the employee says they arrived
  claimed_out varchar(5),              -- 'HH:MM' the employee says they left
  reason text,
  status varchar(16) check (status in ('open', 'approved', 'rejected', 'cancelled')),
  decided_by varchar(12),
  decided_at timestamp(0),
  decision_comment text,
  createdby_userid varchar(12),
  created_at timestamp(0),
  updatedby_userid varchar(12),
  updated_at timestamp(0)
);
create index if not exists idx_staff_att_reg_emp on staff_attendance_regularization (employee_id, att_date);
create index if not exists idx_staff_att_reg_school_status on staff_attendance_regularization (school_id, status, att_date);
-- At most one non-terminal request per employee/day.
create unique index if not exists idx_staff_att_reg_open_unique
  on staff_attendance_regularization (employee_id, att_date) where status = 'open';

-- Append-only audit of regularization lifecycle + config changes.
create table if not exists staff_attendance_audit (
  uuid varchar(12) primary key,
  school_id varchar(12),
  entity_type varchar(24),             -- 'regularization' | 'config' | 'season'
  entity_id varchar(12),
  action varchar(24),                  -- 'apply' | 'approve' | 'reject' | 'cancel' | 'update'
  actor_userid varchar(12),
  detail text,                         -- json snapshot / note
  created_at timestamp(0)
);
create index if not exists idx_staff_att_audit_entity on staff_attendance_audit (entity_type, entity_id, created_at);
