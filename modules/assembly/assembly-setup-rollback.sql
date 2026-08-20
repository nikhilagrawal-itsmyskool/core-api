-- Assembly Module Schema Rollback
-- Drops all assembly tables. Safe to re-run (IF EXISTS guards).

-- House mode Phase D (grading)
drop table if exists assembly_grade_penalty;
drop table if exists assembly_grade_metric;
drop table if exists assembly_grade;
drop table if exists assembly_evaluator;
drop table if exists assembly_rubric_config;
drop table if exists assembly_rubric_penalty;
drop table if exists assembly_rubric_metric;

-- House mode Phase C (checklist)
drop table if exists assembly_checklist_signoff;
drop table if exists assembly_checklist_tick;
drop table if exists assembly_checklist_item;

-- House mode Phase B (weekly roster)
drop table if exists assembly_roster_reference;
drop table if exists assembly_week_unlock;
drop table if exists assembly_roster_participant;
drop table if exists assembly_roster_entry;
drop table if exists assembly_week;

-- House mode (Phase A)
drop table if exists assembly_node_day_content;
drop table if exists assembly_week_house;
drop table if exists assembly_house_rotation;
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
