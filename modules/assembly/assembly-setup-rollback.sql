-- Assembly Module Schema Rollback
-- Drops all assembly tables. Safe to re-run (IF EXISTS guards).

-- House mode Phase B (weekly roster)
drop table if exists assembly_week_unlock;
drop table if exists assembly_roster_entry;
drop table if exists assembly_roster_day;
drop table if exists assembly_week;

-- House mode (Phase A)
drop table if exists assembly_node_day_content;
drop table if exists assembly_week_house;
drop table if exists assembly_house_teacher;
drop table if exists assembly_house_meta;
drop table if exists assembly_school_config;

drop table if exists assembly_node_audit;
drop table if exists assembly_theme;
drop table if exists assembly_special;
drop table if exists assembly_node_resource;
drop table if exists assembly_node_responsible;
drop table if exists assembly_node_day;
drop table if exists assembly_node;
drop table if exists assembly_plan_day;
drop table if exists assembly_plan_class;
drop table if exists assembly_plan;
