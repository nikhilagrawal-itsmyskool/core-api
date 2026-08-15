# Account Recovery — Forgot Username / Forgot Password (Design)

Self-service recovery for the two PWAs (a **parent** app and a **staff** app). An
unauthenticated user enters their phone number, receives a one-time code by **SMS**,
and after verifying it either **sees their username** on screen or **sets a new
password**. Fills the gap left by the existing flows, all of which require an already-valid
JWT (`student/change-password`, `employee/change-password`, admin `employee/reset-password`).

> Status
> - **DESIGNED, not built** — this document. Endpoints, schema, and the synchronous OTP
>   send are net-new. Depends on a DLT-approved OTP SMS template (see "SMS dependency").

## Scope boundaries

- **Two audiences, one engine.** Parents log in via `student_login`, staff via
  `employee_login`; both are keyed `username = family_unique_number`, one row per family,
  **plaintext** passwords (`password !== stored` compare — no hashing anywhere in auth).
  The request carries `userType in ('parent','staff')`, which only selects the resolver;
  the OTP + verify + set-password spine is shared.
- **Phone is the entry point, not the username.** The login tables have no phone column,
  so a phone maps to an account by hopping through the person row:
  `student.{father,mother,guardian}_{mobile,whatsapp}` (parents) or
  `employee.{mobile,whatsapp}` (staff) → `family_unique_number` → `*_login.username`.
- **OTP goes only to the number the user typed** (and only if it matches an account) —
  never to other numbers on file. Match on the exact number; do not reveal siblings' or
  the mother's number.
- **SMS only** in v1. WhatsApp coverage for this tenant is near-zero and a WhatsApp OTP
  needs a separate Meta-approved template; deferred.
- **Username is shown on screen** after a valid code (the user has proven phone control and
  is looking at the screen). Not SMS'd.
- **No new hashing.** Consistent with the current plaintext model, the set-password step
  overwrites the column. Passwords are min-length-checked (≥6) only. OTP **codes** are
  hashed at rest (cheap, and the table then holds nothing usable).

## Confirmed decisions

- **`userType` splits the resolver, apps pass it explicitly.** Parent app sends
  `userType=parent`, staff app sends `userType=staff`. No auto-detection; a phone that is
  both a parent contact and a staff contact is disambiguated by which app is asking.
- **Three endpoints, all authorizer-exempt** (added to the per-module exempt list, exactly
  like `student/login` and `employee/login`): `request-otp`, `verify-otp`, `set-password`.
  Username recovery finishes at `verify-otp` (nothing to write); password recovery needs the
  third call.
- **Two-token handoff.** `request-otp` returns an opaque **`otpToken`** (the `login_otp`
  row uuid — harmless without the SMS'd code). `verify-otp` mints a short-lived signed
  **`resetToken`** (JWT, ~5 min, one-shot) that `set-password` must present. This decouples
  "proved control of the phone" from the sensitive write and keeps the reset window tight.
- **Anti-enumeration.** `request-otp` returns the **same shape whether or not the phone
  matches** an account. On a miss it stores a challenge with an empty `matched_accounts`
  and **sends no SMS**; `verify-otp` then simply fails. An attacker can't distinguish
  "not registered" from "wrong code".
- **Matched set is snapshotted** on the challenge at request time, so a roster edit mid-flow
  can't change who gets reset. The normal case is exactly one login (siblings share the
  family number); when >1 match, username-reveal shows all and set-password makes the user
  pick which `username` (must be in the snapshot).
- **Audit every recovery event** — `otp_requested`, `username_revealed`, `password_reset`
  rows (phone, username, ip, ua) for abuse investigation.
- **Accepted limitations.** Password reset does **not** invalidate existing JWTs (they're
  stateless with an expiry) and does **not** set `must_change_password` (the user just chose
  the password).

## Data model

Conventions: lowercase SQL, no FKs, no DDL defaults, `varchar(16)` uuids, `school_id` on
every row, enums as `varchar + check`, audit columns. New tables live in `auth-setup.sql`
(idempotent additive DDL — the login tables themselves remain in `modules/db/db-create-1.sql`).

- **login_otp** — one row per OTP challenge.
  `uuid`(PK), `school_id`, `user_type in ('parent','staff')`, `purpose in ('username','password')`,
  `phone` (normalized, e.g. `9198XXXXXXXX`), `code_hash` (`sha256(code + pepper)`),
  `matched_accounts jsonb` (`[{"username":"…"}]` snapshot), `expires_at`, `attempts` (verify
  attempts used), `consumed_at` (set when a valid code is accepted — blocks reuse),
  `reset_done_at` (set after a successful password write — blocks replay), `ip`, `user_agent`,
  audit cols. Index `(school_id, phone, created_at)` for rate-limit counting.
- **auth_recovery_audit** — `uuid`(PK), `school_id`, `user_type`, `username`, `phone`,
  `event in ('otp_requested','username_revealed','password_reset')`, `ip`, `user_agent`,
  `created_at`.

## Endpoints

All under `/auth/recover/*`, all POST, all authorizer-exempt.

### `POST /auth/recover/request-otp`
```jsonc
// request
{ "schoolCode": "DBPASN", "userType": "parent", "phone": "9198XXXXXXXX", "purpose": "password" }
// response — ALWAYS this shape (anti-enumeration)
{ "otpToken": "a1b2c3d4e5f6", "resendInSeconds": 60 }
```
Validate school/userType/purpose; normalize phone (match on last 10 digits, store MSG91 form);
enforce resend cooldown + per-phone request cap. Resolve candidates via the `userType`
resolver. If ≥1 matched: generate a 6-digit code, store `code_hash`, fire the synchronous
OTP SMS. If none: store the challenge with `matched_accounts = []` and send nothing.
Return `otpToken` (= `login_otp.uuid`) regardless. Write `otp_requested` audit.

### `POST /auth/recover/verify-otp`
```jsonc
// request
{ "otpToken": "a1b2c3d4e5f6", "code": "482913" }
// response — purpose=username (done)
{ "verified": true, "usernames": ["9198XXXXXXXX"] }
// response — purpose=password
{ "verified": true, "resetToken": "<jwt ~5min>", "usernames": ["EMP0421"] }
// response — bad/expired/locked (generic)
{ "verified": false, "error": "Invalid or expired code" }
```
Load by uuid, not expired, not consumed; enforce the attempt cap (increment `attempts` on
mismatch). On match set `consumed_at`. For `username`: return matched usernames + write
`username_revealed`. For `password`: mint `resetToken`
(`{ kind:'recovery-reset', otpId, schoolId, userType, phone, exp:+5min }`) and include
`usernames` so a >1-match set-password screen can show a picker.

### `POST /auth/recover/set-password` (password purpose only)
```jsonc
// request
{ "resetToken": "<jwt>", "username": "EMP0421", "newPassword": "……" }
// response
{ "success": true }
```
Verify `resetToken` (sig/exp/kind/otpId); confirm the `login_otp` row exists and
`reset_done_at` is null (one-shot); confirm `username` ∈ the snapshot's matched set;
enforce min length (≥6). `update <student_login|employee_login> set password=$new,
updated_at=now() where username=$1 and school_id=$2`. Set `reset_done_at`; write
`password_reset` audit.

## Guardrails

| Knob | Value |
|---|---|
| Code | 6 digits, numeric |
| OTP TTL | 10 min |
| Verify attempts | 5 per challenge, then locked |
| Resend cooldown | 60 s |
| Requests per phone | 5 / 60 min (rolling, counted from `login_otp`) |
| resetToken TTL | 5 min, one-shot |
| Min password length | 6 |

## SMS dependency (synchronous send)

The existing communication send is **audience-based and async** (queue → EventBridge tick):
no path to a bare number, and seconds of latency — wrong for an OTP. Two net-new pieces:

1. **A synchronous send-to-number call in the communication module** — a small,
   service-token-gated `POST /communication/otp` that resolves the school's `otp` template
   and calls `getProvider().send()` directly. Auth calls it over HTTP with a service token,
   exactly like `fees-notify.ts`. All MSG91 logic stays in one module.
2. **A DLT-approved OTP SMS template** registered as an MSG91 Flow, plus a `message_template`
   row `key='otp', channel='sms', provider_template_id=<flow id>, variables=['otp']`.

## Build order

1. `auth-setup.sql` — `login_otp` + `auth_recovery_audit` (idempotent).
2. `recovery-service.ts` — resolvers (parent/staff), OTP gen/hash, rate-limit + attempt logic,
   token mint/verify, the three service methods.
3. `recovery-handler.ts` + `auth-endpoints.yml` — the three routes; add them to the
   authorizer exempt list.
4. `communication` — `POST /communication/otp` synchronous send + provider wiring; register
   the `message_template` row once the DLT template is approved.
5. Tests (`__tests__/recovery.test.ts`) — resolver hits/misses, expiry, attempt lockout,
   cooldown, anti-enumeration uniform response, one-shot reset-token replay.
6. Wire the two PWA screens.
