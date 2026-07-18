-- Parent-app groundwork (Path A): a shared identity key.
--
-- Employee and parent (family) logins are separate credentials with no common
-- key. Adding `phone` to both login tables lets a single number later resolve to
-- both personas — the basis for cross-app SSO ("Switch to Staff") between the
-- staff PWA and the parent app. Not consumed yet; this is the schema groundwork.
--
-- Idempotent — safe to re-run. Run with:
--   node scripts/run-sql.js --stage <stage> --file modules/db/db-add-login-phone.sql

alter table employee_login add column if not exists phone varchar(16);
alter table student_login  add column if not exists phone varchar(16);
