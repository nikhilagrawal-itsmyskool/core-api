-- Attendance Module Rollback Script
-- Drops all attendance tables and indexes.

drop index if exists idx_attendance_audit_record;
drop index if exists idx_attendance_audit_session;
drop table if exists attendance_audit;

drop index if exists idx_attendance_record_student;
drop index if exists idx_attendance_record_session;
drop index if exists idx_attendance_record_unique;
drop table if exists attendance_record;

drop index if exists idx_attendance_session_lookup;
drop index if exists idx_attendance_session_unique;
drop table if exists attendance_session;
