-- Hiring Module Rollback Script
-- Drops all hiring module tables and indexes
-- WARNING: This will permanently delete all hiring module data

drop table if exists hiring_stage;
drop table if exists hiring_candidate;
