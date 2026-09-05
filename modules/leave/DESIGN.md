# Leave Module — DESIGN

Staff leave management for teachers and office staff: leave application + approval,
monthly casual-leave (CL) quota, an escalating salary-deduction ladder for excess
absence, and a monthly deduction report that feeds payroll (there is no payroll
module — this report is the handoff).

**Ports:** HTTP 3053 / Lambda 3054. Route prefix `/leave/*`, `/me/leave/*`.

---

## 1. Scope

**In scope (v1)**
- Leave-type config (per-school, data-driven policy).
- Leave application lifecycle: apply → approve/reject → cancel/withdraw. Backdating allowed.
- Monthly daily-cap on concurrent approvals (per-wing/department, configurable).
- Biometric attendance **import** (Excel export → daily present/absent rows).
- Reconciliation of biometric attendance vs approved leave → per-day outcome.
- Monthly CL quota (1/month, configurable) + escalation ladder + deduction report.
- In-app notifications (first consumer of a new shared `inapp` channel).
- `/me/leave` PWA surface + append-only audit.

**Out of scope**
- **Attendance capture** — the biometric device owns this. We only ingest its Excel.
- Half-days / late-marks / early-outs — **deferred to v2**. We ingest `first_in`/`last_out`
  times now so the data is ready; no rules applied yet.
- Payroll processing — we emit a report; salary runs elsewhere.
- Leave encashment, carry-forward beyond the month, sandwich rule.
- Web Push (phone wake) — v1 is an in-app inbox polled on app focus.

---

## 2. Data model

Snake_case, idempotent additive DDL in `leave-setup.sql`. No FKs (application-level
validation), UUIDs via `generateShortUuid(12)`.

> **Naming convention.** The identity noun is **`employee`** throughout (matches
> `employee_login`, the `employee` module, and the JWT `type` claim `employee|student` in
> `authz.ts`) — *not* "staff" ("staff" lives only in the auth `user_type in ('parent','staff')`
> audience axis; "teachers / office staff" is UI wording only). Leave-specific tables are
> prefixed `leave_*`. **Attendance tables are prefixed `employee_attendance_*`, not
> `leave_*`** — the leave module *owns* them for now (sole reader), but they're named by
> domain so they lift out cleanly if payroll/reports ever need them.

### Policy config
- **`leave_profile`** — a named entitlement bundle. v1 ships one default (teacher rules).
  Office staff get their own profile later by cloning + editing. Employee category →
  profile mapping lives on the profile (`applies_to`).
- **`leave_type`** — per-school: `code`, `name`, `paid` (bool), `counts_vs_quota` (bool),
  `requires_attachment` (bool), `waivable` (bool, Rule 4), `approver_role`, `sort_order`,
  `status`. Seeded on first use:

  | code | paid | counts_vs_quota | attachment | waivable | approver |
  |---|---|---|---|---|---|
  | CL   | yes | yes (1/mo) | no  | —   | Director |
  | ML   | yes | no  | yes | yes | Director |
  | OD   | yes | no  | no  | yes | Director |
  | COMP | yes | no  | no  | —   | Director |
  | EMERG| discretionary | no | optional | yes | Director |
  | LWP  | no  | —   | —   | —   | — |

- **`leave_quota_rule`** (or folded into profile): `cl_per_month` (default 1),
  `reset` = monthly, `daily_cap_scope` = wing|department, `daily_cap` (default 2).
  (No `delegate_approver_role` yet — see §5, all gates are `god` for now.)

  > **`approver_role` is advisory policy only.** There is no Director/Principal/VP role in
  > the system today, so **every approval/waive endpoint is gated on `god`**. The column
  > records intent for when a real staff-role model exists.

### Applications
- **`leave_application`** — `uuid`, `school_code`, `employee_uuid`, `leave_type_code`,
  `from_date`, `to_date`, `half_day` (bool, v2), `half` (first|second, v2),
  `working_days` (computed via academic-calendar), `reason`, `status`
  (`pending|approved|rejected|cancelled|withdrawn`), `applied_at` (FCFS ordering),
  `decided_by`, `decided_at`, `decision_note`, `waived` (bool), `waiver_reason`,
  `attachment_file_id` (→ `file_storage`, `entity_type='leave'`).
- **`leave_audit`** — append-only: application_uuid, action, actor, from→to status, at, note.

### Attendance feed (import only)
- **`employee_biometric_map`** — `(school_code, enroll_code, employee_uuid)`. Resolves the
  device's identity column to our employee. Unmatched rows surfaced for manual mapping.
- **`employee_attendance_import_batch`** — `uuid`, file ref, `total_rows`, `matched`,
  `unmatched`, `suspect` (bool — device-down guard), `applied_by`, `applied_at`.
- **`employee_attendance_day`** — `(school_code, employee_uuid, date)` unique upsert:
  `status` (`present|absent|holiday|off|suspect|unknown`), `first_in`, `last_out`,
  `minutes_worked`, `source` (`biometric|manual`), `import_batch_id`, `override_note`.

### Deduction
- **`leave_deduction_run`** — per `(school_code, employee_uuid, year, month)`:
  `paid_days`, `cl_used`, `authorized_unpaid_absences`, `unauthorized_absences`,
  `ladder_deduction_days`, `plain_lwp_days`, `applied_deduction_days`,
  `status` (`draft|finalized`), `generated_by`, `generated_at`, `confirmed_by`.
  This is the payroll deliverable (CSV + print).

---

## 3. Biometric import

Header-name-matched Excel import + diff/sync (same pattern as `academic-calendar`).

1. Upload → parse → resolve each row's identity via `biometric_employee_map`.
   Unmatched enroll codes are listed for one-time manual mapping (persisted).
2. Idempotent upsert into `employee_attendance_day` keyed on `(employee, date)` — re-uploading
   a month corrects it rather than duplicating.
3. **Device-failure guard:** if punch coverage for a date is below a threshold
   (~40% of active staff), mark the day `suspect` and do **not** auto-mark anyone absent.
   Missing punches = `unknown`, never silently `absent`.
4. Manual override of a single day allowed (device glitch) → `source='manual'` + audit.

---

## 4. Reconciliation matrix

For each **expected working day** (Sundays + full holidays excluded via
`academic-calendar`), per employee:

| Biometric | Leave that day | Outcome |
|---|---|---|
| Present | none | Present |
| Present | approved leave exists | Present; **refund** the CL/leave (don't burn it) |
| Absent  | approved CL within quota | Authorized, paid, no deduction |
| Absent  | approved paid type (ML/OD/COMP/MAT) | Paid, no deduction, no ladder |
| Absent  | approved beyond-quota / unpaid type | **Counted absence** → ladder |
| Absent  | leave **waived** (Rule 4) | No deduction, does **not** advance ladder |
| Absent  | **no leave** | **Unauthorized absence** — ladder, cannot be waived |
| Absent  | day flagged `suspect` | Held for review, no penalty |

Multi-day leave crossing a month boundary is split per month for quota + ladder.

---

## 5. Application lifecycle & approval

- `pending → approved | rejected`; approved → `cancelled | withdrawn` before/after start.
- **Daily cap** checked at approve-time against a live "N/cap already approved for this
  date" counter, scoped per-wing/department. FCFS (`applied_at`) is the default sort; the
  Director still decides (reason counts) — evaluated at decision, so no race.
- **Authorization:** all approve/reject/waive endpoints are gated on the `god` role for
  now — there are no Director/Principal/VP roles yet. Delegation is deferred until a real
  staff-role model exists.
- Backdating permitted for emergencies (apply after the fact).

---

## 6. Quota + escalation ladder

- **CL quota:** 1 per calendar month (config), resets on the 1st.
- **Ladder:** the *nth* counted absence in a month costs *n* days of pay
  (1 + 2 + 3 + …), cumulative, resets monthly.

  *Example — daily pay ₹1,000, 1 CL then 3 counted absences in a month:*
  - Plain LWP (automatic): 3 × ₹1,000 = **₹3,000**.
  - Ladder (confirmable): (1+2+3) × ₹1,000 = **₹6,000**.

- **Default behaviour:** plain LWP auto-computes; the ladder figure is a **flagged line the
  Director confirms** on the deduction run (legal caution on escalating penalties — to be
  validated with the school's accountant before it auto-applies).

---

## 7. Deduction run

Monthly job (mirrors `fees/apply-fines.js`): walks each employee's counted +
unauthorized absences in date order, computes both `plain_lwp_days` and
`ladder_deduction_days`, writes `leave_deduction_run` as `draft`. Director reviews →
`finalized` sets `applied_deduction_days`. Export as CSV + printable summary = payroll input.

---

## 8. App notifications (new shared surface)

**One** notification surface for **both** audiences — a single polymorphic table, not one
table per audience (teacher vs student content/lifecycle is identical; only the delivery
transport differs by client). Leave is the first consumer; reusable by every app-facing
module.

- **`notification`** table (universal inbox): `recipient_type` (`employee|student`),
  `recipient_id`, `key`, `title`, `body`, `entity_type`, `entity_id`, `read_at`,
  `created_at`.
- **`device_token`** table: `recipient_type`, `recipient_id`, `platform`
  (`ios|android|web`), `token`, `last_seen`. Native clients register here.
- **One `app` channel in `communication`** (reuses audience resolution + templates keyed
  by `(key, channel)`). For every notification it:
  1. writes the `notification` inbox row **synchronously** (free, instant), then
  2. for each registered `device_token`, fires a push — this leg goes **through the
     existing DB-as-queue** (external HTTP, rate-limited, retryable).
- **Transport by client:**
  - **Teacher PWA** — no device token → **inbox only**, polled on app focus (Web Push is
    limited on iOS PWAs; deferred).
  - **Student native app** (Expo SDK 54, sibling `student-app/`) — registers an **Expo
    push token** → **inbox + real push** (Expo Push handles APNs/FCM; iOS needs an APNs
    key uploaded to Expo once).
- **`/me/notifications`** — list + unread count + mark-read, scoped by the caller's JWT
  identity (employee or student). Same endpoint serves both apps.
- Leave events (apply → approve/reject, pending-approval nudge, deduction warning) fire on
  the **`app` channel only** → ₹0 SMS/WhatsApp cost.

---

## 9. `/me/leave` PWA surface

- Balance view: CL used/remaining this month, pending/approved/rejected, running
  deduction tally.
- Apply form: type, date range, reason, certificate upload (`file_storage`).
- Director/approver view: pending queue with `applied_at` order, reason, live daily-cap
  count, approve/reject/waive.

---

## 10. Integrations

- **`academic-calendar`** — working-day / holiday / Sunday resolution.
- **`employee`** — identity, wing/department, category → profile.
- **`file_storage`** — medical certificates, biometric import files (`entity_type='leave'`).
- **`communication`** — `inapp` channel for all leave notifications.

---

## 11. Open decisions

- **Office-staff profile** — undecided; v1 ships default profile only, clone later.
- **Escalation multiplier** — pending accountant sign-off before auto-apply.
- **Web Push** — deferred; revisit once in-app inbox is adopted.

---

## 12. Phasing

1. **Config + application + approval + `/me/leave`** (leave works, no deductions).
   ✅ BUILT + green on local (2026-09-04); NOT yet deployed to prod. All schema
   (`leave_*`, `employee_attendance_*`, `employee_biometric_map`, `leave_deduction_run`)
   is created via `leave-setup.sql` — later phases are schema-ready.
4. **In-app notification surface** ✅ BUILT alongside phase 1 (in `communication`:
   `notification` + `device_token`, `/communication/notifications` + `/me/notifications`
   + `/me/devices`; Expo push off unless `EXPO_PUSH_ENABLED=true`). Real push also needs
   the student-app to register tokens + a one-time APNs key upload (not done).
2. **Biometric import + reconciliation** ✅ BUILT + green on local (2026-09-04); NOT
   deployed. `leave-reconcile.ts` (attendance ⊕ approved-leave ⊕ holidays/weekly-off →
   per-day status) powers `/me/attendance`, `/employees/{id}/attendance`, `/day`, and the
   deduction run. Ingest = manual `attendance/mark` + a **column-mapping xlsx importer**
   (`leave-attendance-import.ts`, exceljs) with coverage-bounded absence inference + a
   <40%-coverage device-down guard + `employee_biometric_map` resolution. **The device's
   exact column headers are supplied at import time** (mapping) — when a real export
   arrives, confirm/tweak the parser and optionally save a preset. Rule-4 exceptions:
   god approves a backdated ML/EMERG (no separate waive action).
3. **Deduction run + payroll report** ✅ BUILT + green on local (2026-09-04); NOT deployed.
   `leave-deduction-service.ts`: ladder in **days of pay** (plain LWP = k automatic; ladder
   = k·(k+1)/2 is the finalize-time confirmed figure), `deductions/run` (draft) →
   `deductions/{id}/finalize` (applyLadder), `/me/deductions` + `/employees/{id}/deductions`
   return **provisional until finalized** (teacher sees a not-final indicator). CSV/print
   export endpoint still TODO.
