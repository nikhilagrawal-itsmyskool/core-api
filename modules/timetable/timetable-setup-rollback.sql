-- Timetable Module Schema Rollback
-- Drops all timetable tables. Safe to re-run.
-- Note: the forward-compatible class.class_group_id column is also dropped.

drop table if exists published_entry;
drop table if exists published_timetable;
drop table if exists timetable_entry;
drop table if exists timetable_candidate;
drop table if exists generation_run;
drop table if exists teacher_constraint;
drop table if exists time_slot;
drop table if exists day_structure;
drop table if exists timetable_config;
drop table if exists timetable_wing_class;
drop table if exists timetable_wing;
drop table if exists elective_offering;
drop table if exists elective_band;
drop table if exists class_teacher;
drop table if exists teaching_assignment;
drop table if exists class_subject;
drop table if exists class_group;
drop table if exists subject;

alter table class drop column if exists class_group_id;
