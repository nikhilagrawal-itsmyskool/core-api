-- Rollback for the academic-calendar module schema. Drops all tables.
drop table if exists calendar_audit;
drop table if exists calendar_holiday;
drop table if exists calendar_entry;
drop table if exists calendar_type;
