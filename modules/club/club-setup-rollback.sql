-- Club module rollback — drops all club_* tables. Does NOT touch authz_permission_override
-- (central, owned by the auth module).
drop table if exists club_audit;
drop table if exists club_plan_completion;
drop table if exists club_plan_assignment;
drop table if exists club_plan_group_member;
drop table if exists club_plan_group;
drop table if exists club_plan_slot;
drop table if exists club_plan;
drop table if exists club_import;
drop table if exists club_activity_review;
drop table if exists club_activity_resource;
drop table if exists club_activity_material;
drop table if exists club_activity_version;
drop table if exists club_activity;
drop table if exists club_setting;
drop table if exists club_config;
drop table if exists club;
