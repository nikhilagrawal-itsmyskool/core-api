-- Fine Module Rollback Script
-- Drops all fine module tables and indexes
-- WARNING: This will permanently delete all fine module data

drop table if exists fine_collection;
drop table if exists fine_incident_evidence;
drop table if exists fine_incident_note;
drop table if exists fine_incident;
