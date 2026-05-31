-- Uniform Module Rollback Script
-- Drops all uniform module tables in reverse dependency order

drop table if exists uniform_return;
drop table if exists uniform_sale_item;
drop table if exists uniform_sale;
drop table if exists uniform_set_item;
drop table if exists uniform_set;
drop table if exists uniform_purchase_log;
drop table if exists uniform_purchase_batch;
drop table if exists uniform_item_size;
drop table if exists uniform_item;
