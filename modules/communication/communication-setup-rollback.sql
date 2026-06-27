-- Communication Module Rollback Script
-- Drops all communication tables and indexes.
-- Note: the employee.communication_preference column is intentionally NOT
-- dropped here — it may hold data and is harmless to keep.

drop index if exists idx_message_recipient_provider_msg;
drop index if exists idx_message_recipient_job;
drop table if exists message_recipient;

drop index if exists idx_message_job_school;
drop index if exists idx_message_job_claim;
drop table if exists message_job;

drop index if exists idx_message_template_unique;
drop index if exists idx_message_template_key;
drop index if exists idx_message_template_school_status;
drop table if exists message_template;
