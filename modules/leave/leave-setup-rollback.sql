-- Leave module rollback: drop all leave + employee-attendance tables.
-- Note: leave attachments in file_storage (entity_type='leave') are NOT removed here.
drop table if exists leave_deduction_run;
drop table if exists employee_attendance_day;
drop table if exists employee_attendance_import_batch;
drop table if exists employee_biometric_map;
drop table if exists leave_audit;
drop table if exists leave_application;
drop table if exists leave_type;
drop table if exists leave_config;
