delete from uniform_return
where sale_item_id in (
  select usi.uuid from uniform_sale_item usi
  join uniform_item ui on usi.item_id = ui.uuid
  where ui.created_at < '2026-04-05 16:00:00'
);

delete from uniform_sale_item
where item_id in (
  select uuid from uniform_item where created_at < '2026-04-05 16:00:00'
);

delete from uniform_sale
where uuid not in (select distinct sale_id from uniform_sale_item);

delete from uniform_purchase_log
where item_id in (
  select uuid from uniform_item where created_at < '2026-04-05 16:00:00'
);

delete from uniform_purchase_batch
where uuid not in (select distinct batch_id from uniform_purchase_log);

delete from uniform_set_item
where item_id in (
  select uuid from uniform_item where created_at < '2026-04-05 16:00:00'
);

delete from uniform_set
where uuid not in (select distinct set_id from uniform_set_item);

delete from uniform_item_size
where item_id in (
  select uuid from uniform_item where created_at < '2026-04-05 16:00:00'
);

delete from uniform_item
where created_at < '2026-04-05 16:00:00'
