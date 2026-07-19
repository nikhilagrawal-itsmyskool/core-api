-- Assembly Module Schema Rollback
-- Drops all assembly tables. Safe to re-run (IF EXISTS guards).

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
