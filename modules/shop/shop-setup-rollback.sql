-- Shop Module Rollback — drops all tables in reverse dependency order
drop table if exists shop_sale_item;
drop table if exists shop_sale;
drop table if exists shop_set_item;
drop table if exists shop_set;
drop table if exists shop_purchase_log;
drop table if exists shop_purchase_batch;
drop table if exists shop_item;
