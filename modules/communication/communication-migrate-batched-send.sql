-- Communication: migrate to two-phase (expand -> batched send) job processing.
-- Safe to re-run.
--
-- Relaxes the status CHECK constraints so a job can move through the new
-- expanding/sending phases and a recipient can be transiently claimed for
-- sending, and adds an index that backs the send-phase batch claim
-- (message_recipient by job + status).

-- message_job: allow expanding + sending phases (keep legacy 'running').
alter table message_job drop constraint if exists message_job_status_check;
alter table message_job add constraint message_job_status_check
    check (status in ('queued', 'expanding', 'sending', 'running', 'completed', 'failed', 'canceled'));

-- message_recipient: allow the transient 'sending' claim state.
alter table message_recipient drop constraint if exists message_recipient_status_check;
alter table message_recipient add constraint message_recipient_status_check
    check (status in ('pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'));

-- Backs the send-phase claim: "pending rows for sending jobs, oldest first".
create index if not exists idx_message_recipient_job_status on message_recipient(job_id, status);
