-- Biometric / attendance-device module schema.
-- Conventions: all lowercase; no FKs (validated in app code); no DDL defaults
-- (handled in app code); enum-like fields are varchar + check. Every statement is
-- additive + idempotent so this file is the single canonical, re-runnable source.
-- Apply: node scripts/run-sql.js --stage <stage> --file modules/biometric/biometric-setup.sql

-- The person's single numeric identity on attendance/biometric devices (the device
-- "PIN"), distinct from employee_number (which is a free-form HR string). One number
-- per person; fingerprint + face + card all enrol under it on the device. Lives on the
-- core employee table because it is a stable shared identity (like employee_number),
-- while all heavy biometric state (templates, enrolment, punches) stays in this module.
alter table employee add column if not exists device_number varchar(16);
create unique index if not exists idx_employee_device_number_school
  on employee (device_number, school_id) where device_number is not null;

-- Registered devices. The serial number is how the device identifies itself on every
-- push request (it carries no JWT) — so the SN is both the identity and the allowlist.
create table if not exists biometric_device (
  uuid varchar(12) primary key,
  school_id varchar(12),
  serial_number varchar(64),
  name varchar(128),                       -- friendly name / location
  model varchar(64),                       -- e.g. 'ESSL K30 Pro'
  firmware varchar(64),                     -- last-seen firmware string
  push_version varchar(16),                 -- last-seen pushver (protocol dialect)
  status varchar(16) check (status in ('active', 'disabled', 'deleted')),
  last_seen_at timestamp(0),
  last_ip varchar(45),
  attlog_stamp bigint,                      -- high-water mark acked for ATTLOG
  operlog_stamp bigint,                     -- high-water mark acked for OPERLOG
  user_count integer,                       -- last-reported counts (from INFO heartbeat)
  fp_count integer,
  createdby_userid varchar(12),
  created_at timestamp(0),
  updatedby_userid varchar(12),
  updated_at timestamp(0)
);
create unique index if not exists idx_biometric_device_sn on biometric_device (serial_number);
create index if not exists idx_biometric_device_school on biometric_device (school_id);

-- DB-as-queue of commands to push to a device on its next poll. Same claim pattern as
-- communication/timetable (for update skip locked). cmd_id is the C:<id> we issue; the
-- device echoes it back on /iclock/devicecmd so we can confirm the outcome.
create table if not exists biometric_command (
  uuid varchar(12) primary key,
  school_id varchar(12),
  device_sn varchar(64),
  employee_id varchar(12),
  device_number varchar(16),
  kind varchar(32) check (kind in ('push_user', 'delete_user', 'reload_data', 'reboot', 'clear_users')),
  payload text,                             -- raw command body (without the C:<id>: prefix)
  status varchar(16) check (status in ('queued', 'sent', 'confirmed', 'failed', 'cancelled')),
  cmd_id varchar(24),                       -- the numeric id issued to the device
  return_code varchar(16),                  -- Return= from the devicecmd callback
  attempts integer,
  worker_id varchar(64),
  sent_at timestamp(0),
  confirmed_at timestamp(0),
  error text,
  createdby_userid varchar(12),
  created_at timestamp(0),
  updated_at timestamp(0)
);
create index if not exists idx_biometric_command_claim on biometric_command (device_sn, status, created_at);
create index if not exists idx_biometric_command_cmdid on biometric_command (device_sn, cmd_id);

-- Per-(device, device_number) enrolment state: who is pushed to which device and what
-- credentials they have enrolled. device_number defaults to employee.device_number but
-- can differ per device (escape hatch for a second vendor/device numbered differently).
create table if not exists biometric_enrollment (
  uuid varchar(12) primary key,
  school_id varchar(12),
  device_sn varchar(64),
  employee_id varchar(12),
  device_number varchar(16),
  name varchar(128),                        -- name as pushed to the device
  privilege integer,                        -- Pri (0 = user, 14 = super admin)
  card varchar(32),
  fp_count integer,
  face_count integer,
  status varchar(16) check (status in ('pending', 'synced', 'enrolled', 'removed')),
  synced_at timestamp(0),                   -- when the user record was pushed
  enrolled_at timestamp(0),                 -- when the first credential arrived
  created_at timestamp(0),
  updated_at timestamp(0)
);
create unique index if not exists idx_biometric_enrollment_dev_pin on biometric_enrollment (device_sn, device_number);
create index if not exists idx_biometric_enrollment_emp on biometric_enrollment (employee_id);

-- Raw fingerprint / face templates captured from the device (big base64 blobs), kept
-- separate from enrolment so we own the biometric data and the device stays replaceable
-- (we can push templates back after a device wipe).
create table if not exists biometric_template (
  uuid varchar(12) primary key,
  school_id varchar(12),
  device_sn varchar(64),
  employee_id varchar(12),
  device_number varchar(16),
  kind varchar(8) check (kind in ('fp', 'face')),
  fid integer,                              -- finger index (0..9) for fingerprints
  size integer,
  valid integer,
  template text,                            -- base64 TMP payload
  captured_at timestamp(0),
  created_at timestamp(0),
  updated_at timestamp(0)
);
create unique index if not exists idx_biometric_template_unique on biometric_template (device_sn, device_number, kind, fid);
create index if not exists idx_biometric_template_emp on biometric_template (employee_id);

-- Raw attendance punches uploaded by the device (ATTLOG). Idempotent on
-- (device, device_number, punch time) so a device re-dump never double-counts.
create table if not exists biometric_punch (
  uuid varchar(12) primary key,
  school_id varchar(12),
  device_sn varchar(64),
  device_number varchar(16),
  employee_id varchar(12),                  -- resolved from device_number (nullable if unknown)
  punched_at timestamp(0),                  -- device local time
  status_code varchar(8),                   -- punch state (0 = check-in, 1 = check-out, ...)
  verify_mode varchar(8),                   -- 1 = fingerprint, 15 = face, ...
  work_code varchar(16),
  raw text,
  created_at timestamp(0)
);
create unique index if not exists idx_biometric_punch_unique on biometric_punch (device_sn, device_number, punched_at);
create index if not exists idx_biometric_punch_emp on biometric_punch (employee_id, punched_at);
create index if not exists idx_biometric_punch_school_time on biometric_punch (school_id, punched_at);
