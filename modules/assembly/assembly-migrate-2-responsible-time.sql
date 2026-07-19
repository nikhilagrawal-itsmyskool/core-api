-- Assembly migration 2: time-aware responsibility (G2) — date ranges + rotation.
-- Additive and idempotent. Existing rows have null mode ≡ 'fixed', null dates ≡ always.

alter table assembly_node_responsible add column if not exists start_date date;
alter table assembly_node_responsible add column if not exists end_date date;
alter table assembly_node_responsible add column if not exists mode varchar(16);
alter table assembly_node_responsible add column if not exists cycle_unit varchar(16);
alter table assembly_node_responsible add column if not exists anchor_date date;
alter table assembly_node_responsible add column if not exists rule_group varchar(12);
