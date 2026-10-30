# Per-School Configuration — TODO / design notes (core-api-wide)

> Living doc. Terse, dense. Owner keeps appending. NOT an implementation plan yet.
> **One doc for the whole system** — every school-specific assumption baked into any module, tracked here.
> Goal: onboarding a new school = fill config forms, not edit code. Each module section lists the knobs
> that must become **data-driven per school** + where they're hardcoded today.

## Why
- Built for DBPASN; its policy is baked into constants/code across modules. Other schools differ
  (leave quotas, half-day rules, whether "academic handover" exists at all, week pattern, notification
  wording, etc.). Every hardcoded assumption blocks multi-school. Enumerate → drive to per-school config.

## Cross-cutting decisions (settle once, applies everywhere)
- [ ] **Config storage pattern:** widen each module's typed config row (additive `add column if not exists`,
      per setup.sql convention) vs a generic `school_setting(module, key, value)` KV table vs a shared
      `school_config` service. Lean: typed rows for scalars, KV only where it sprawls. **Pick one.**
- [ ] **Config screen placement:** per-module config page vs one central "School Settings" area in the
      admin portal that aggregates all modules. Probably central shell + per-module panels.
- [ ] **Role model:** approvals/authoring are mostly `god`-only today (no Principal/Director role).
      Many workflow knobs wait on a richer role model — decide before building §approval-type knobs.
- [ ] **Org scoping:** no wing/department/grade scoping possible until `employee` gets a department field.
      Blocks any "per-wing cap / per-department approver" config.
- [ ] **Weekly-off / week pattern:** Sunday-only is assumed in multiple modules (leave, attendance,
      transport). One shared per-school week pattern (5-day, alt-Saturday, half-day Sat) → all consume it.
- [ ] **Holiday source:** `calendar_holiday` (academic-calendar module) is the shared source; confirm every
      module reads it and none re-hardcodes holidays.

---

## LEAVE module
Current: `leave_type` rows already per-school (code, name, paid, annual_quota, requires_attachment +
attachment_over_days, waivable, approver_role, sort_order, show_in_balance, **allow_half_day**, status).
`leave_config` row has only `daily_cap`, `cl_per_month` (legacy), `reset`. Rest is hardcoded.

### Types & quotas (mostly EXISTS — audit + expose gaps)
- [ ] Verify every `leave_type` flag editable in UI (allow_half_day / show_in_balance / attachment_over_days).
- [ ] Add/remove/reorder/deactivate types per school.
- [ ] Quota reset basis per type: academic-year (lapse 31 Mar, today) vs calendar vs monthly.
- [ ] Carry-forward? none today. Per-type toggle + cap if wanted.
- [ ] Seed numbers are DBPASN's: `DEFAULT_CL_PER_YEAR=8`, `DEFAULT_ML_PER_YEAR=4`, `DEFAULT_DAILY_CAP=2`
      (leave-constants.ts). Fine as seed; confirm nothing else reads the constant post-seed.

### Half-day policy
- [ ] Per-type `allow_half_day` (exists). Confirm on form.
- [ ] Portions first/second half only; quarter-day out of scope (note).

### Caps & concurrency
- [ ] `daily_cap` value (exists). **Which types it counts is hardcoded CL-only** → make configurable.
- [ ] Scope school-wide only; per wing/dept BLOCKED on employee.department.
- [ ] Monthly cap (legacy `cl_per_month`) — keep/drop/real ceiling?

### Approval workflow
- [ ] Approver role(s) (`APPROVER_ROLES=["god"]` hardcoded). Add admin / Principal.
- [ ] Multi-step approval? none today.
- [ ] Backdating window (allowed, unbounded today).
- [ ] Override-past-cap/quota: who, reason mandatory (today god, reason kept).

### Academic handover   (BIGGEST divergence)
- [ ] **Master toggle: OFF / optional / required.** Today hardcoded **required** for teaching staff
      (`leave-service.ts` ~L206 `assertValid` runs unconditionally). Other schools may not do handover.
- [ ] Applies-to: "teaching" derived from timetable today; school with no timetable → everyone treated
      non-teaching → handover silently skipped. Allow manual flag / role-based.
- [ ] Per-field show/require: affected periods (needs timetable), per-class topic/substitution (needs
      syllabus), lesson-plan text/file, other-duties checklist (**labels themselves per-school editable**).
- [ ] Blocking vs advisory (block apply vs warn).
- [ ] Covering teacher: free text vs pick-from-staff; required?

### Calendar / working-day
- [ ] Uses shared week pattern + `calendar_holiday` (see cross-cutting). Sunday-only today.
- [ ] Half-day counts as 0.5 everywhere (deduction/quota/cap) — confirm.

### Attachments
- [ ] Global MIME+size fixed (5MB; jpg/png/webp/pdf) — likely keep.
- [ ] Per-type requirement + attachment_over_days (exists).

### Notifications
- [ ] Which events notify (`NOTIFY` keys applied/approved/rejected/cancelled).
- [ ] Channel (in-app today; SMS/WhatsApp needs per-school template approval).
- [ ] Per-school copy? template-keyed, defer.

### Deduction / payroll ladder (Phase B/C, mostly deferred)
- [ ] LOP penalty rule (today actual + 0/1/2 per unauthorized spell).
- [ ] Grace late-in ladder + early-departure automation (Phase C, not built) — per-school knobs.

---

## OTHER MODULES — school-specific assumptions to migrate to config
> Stubs. Fill in as we touch each module. Anything DBPASN-specific goes here.

### Attendance
- [ ] Weekly-off = Sunday only; warn-but-allow on holidays (shared week pattern above).

### Communication
- [ ] Provider + templates are per-school (DLT/Meta approval); preference ladder (WhatsApp-first default).

### Academic-calendar
- [ ] Configurable per-school calendar types (already seeded-on-first-use — confirm fully data-driven).

### Examination
- [ ] Dues-gate cutoff, branding, exam-incharge role assignment — per school.

### Fees
- [ ] Late-fee rule (₹10/day, cap, effective date), quarterly buckets, concession schemes — per school.

### Transport
- [ ] Weekly-off / attendance rules; fees deferred.

### Assembly / Syllabus / Homework
- [ ] Wings, house-mode, class-teacher overrides, junior/senior layout — per-school shape.

---

## Open questions (owner to resolve)
- [ ] Storage pattern (see cross-cutting) — decide before first build.
- [ ] Central "School Settings" portal shell vs scattered per-module pages.
- [ ] Is "academic handover / cover arrangement" leave-specific or a cross-cutting feature (substitution)?
- [ ] Timeline: config screens per-module incrementally, or one push before onboarding school #2?

<!-- APPEND BELOW: owner notes -->
