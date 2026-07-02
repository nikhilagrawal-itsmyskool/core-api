-- Transport Module Rollback Script
-- Drops all transport module tables and indexes.
-- WARNING: This will permanently delete all transport module data.

drop table if exists transport_attendance_audit;
drop table if exists transport_attendance_record;
drop table if exists transport_attendance_session;
drop table if exists transport_student_assignment;
drop table if exists transport_route_stop;
drop table if exists transport_route;
drop table if exists transport_vehicle;
drop table if exists transport_stop;
