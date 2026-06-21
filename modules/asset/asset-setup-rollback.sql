-- Asset Module Schema Rollback
-- Drops all asset module tables. Destructive - use with care.

drop table if exists asset_movement_log;
drop table if exists asset;
drop table if exists asset_type;
