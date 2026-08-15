-- auth module schema. additive + idempotent (safe to re-run).
-- apply: node scripts/run-sql.js --stage <stage> --file modules/auth/auth-setup.sql

-- brute-force lockout counters for the login endpoints. lambda is stateless, so
-- the counters live here. two independent scopes per row:
--   scope='user'  scope_key = '<school_id>:<lower(username)>'  -> targeted password guessing
--   scope='ip'    scope_key = '<source ip>'                    -> one host spraying many usernames
-- window/threshold/lock-duration are enforced in application code (login-throttle.ts).
create table if not exists login_lockout (
  scope varchar(8) not null check (scope in ('user', 'ip')),
  scope_key varchar(200) not null,
  fail_count int not null,
  window_started_at timestamptz not null,
  locked_until timestamptz,
  updated_at timestamptz not null,
  primary key (scope, scope_key)
);

-- sweep helper: quickly find/evict stale rows (rows whose window has rolled over and are not locked).
create index if not exists idx_login_lockout_updated on login_lockout (updated_at);

-- forgot-username / forgot-password OTP challenges. one row per issued OTP.
-- the phone the user typed hops to matching login accounts (parents: student.*_mobile/whatsapp,
-- staff: employee.mobile/whatsapp) -> family_unique_number -> *_login.username; that resolved
-- set is SNAPSHOTTED into matched_accounts at request time so a later data change can't shift it.
-- code_hash = sha256('<pepper>:<code>'); the plaintext code is never stored. guardrails
-- (ttl, max attempts, resend cooldown, per-phone request cap) are enforced in recovery-service.ts.
create table if not exists login_otp (
  uuid varchar(12) not null primary key,
  school_id varchar(12) not null,
  user_type varchar(8) not null check (user_type in ('parent', 'staff')),
  purpose varchar(8) not null check (purpose in ('username', 'password')),
  phone varchar(20) not null,           -- last-10-digit normalized phone the user entered
  code_hash varchar(64) not null,       -- sha256 hex of '<pepper>:<code>'
  matched_accounts jsonb not null,      -- snapshot: [{ username, loginId }] resolved at request time
  expires_at timestamptz not null,
  attempts int not null,                -- verify attempts consumed so far
  consumed_at timestamptz,              -- set when the OTP is successfully verified (one-shot)
  reset_done_at timestamptz,            -- set when a password reset completes against this otp (one-shot)
  ip varchar(200),
  user_agent varchar(400),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- lookup by (school, phone) newest-first for cooldown + per-phone request-rate checks.
create index if not exists idx_login_otp_phone on login_otp (school_id, phone, created_at);

-- append-only audit of recovery activity (request / username revealed / password reset).
create table if not exists auth_recovery_audit (
  uuid varchar(12) not null primary key,
  school_id varchar(12) not null,
  user_type varchar(8) not null check (user_type in ('parent', 'staff')),
  username varchar(120),                -- resolved account (may be null at otp_requested time)
  phone varchar(20) not null,
  event varchar(20) not null check (event in ('otp_requested', 'username_revealed', 'password_reset')),
  ip varchar(200),
  user_agent varchar(400),
  created_at timestamptz not null
);

create index if not exists idx_auth_recovery_audit_school on auth_recovery_audit (school_id, created_at);
