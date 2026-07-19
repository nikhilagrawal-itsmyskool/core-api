-- Syllabus Planner Module Rollback Script
-- Drops all syllabus module tables and indexes.
-- WARNING: This will permanently delete all syllabus module data.

drop table if exists syllabus_progress;
drop table if exists syllabus_entry;
drop table if exists syllabus;
drop table if exists syllabus_subject;
