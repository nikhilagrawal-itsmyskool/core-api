-- Rollback for biometric module. Drops module tables; leaves employee.device_number
-- in place (dropping a core-table column is intentionally NOT automated here).
drop table if exists biometric_punch;
drop table if exists biometric_template;
drop table if exists biometric_enrollment;
drop table if exists biometric_command;
drop table if exists biometric_device;
-- To also remove the identity column (destructive):
-- alter table employee drop column if exists device_number;
