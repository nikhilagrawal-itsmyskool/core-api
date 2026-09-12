# Examination Module — DESIGN

> Status: **DESIGN (pre-build)**. This is the first slice of a larger examination
> module. The eventual module owns exam schedules, marks entry, and report cards.
> **This design covers only the admit-card system** (schedule/datesheet, invigilation,
> digital signatures, dues-gated printing). Marks and report cards are a later phase and
> are deliberately out of scope here.

Ports: local **3051 / 3052**, prod **6051 / 6052**, gateway route `/examination/*`,
prefix `examination` (next free slot after academic-calendar 3049/3050).

---

## 1. Product summary

The school runs multiple examinations per academic year (Unit Tests, Half-Yearly,
Annual). Each exam has a **datesheet**: a grade × date grid where each cell is the paper
(subject) that grade sits that day. From the datesheet the office prints an **admit card**
per student — a small card (3 or 4 to an A4 page) carrying the student's paper schedule
with a per-day **Invigilator sign** box.

Two problems the paper-only process has, that this module solves:

1. **No system-of-record.** If a physical card is lost it cannot be reissued faithfully,
   and there is no way to know, in the system, whether a day was actually invigilated.
2. **Dues leakage.** The school rule is "all dues cleared before the exam", but nothing
   enforces it at print time.

So the module adds: a stable **live admit-card identity** (regenerate/reprint always
reproduces current state), a **digital signature** path (invigilators mark present/absent
and sign the roster once on their phone; the signature stamps into each student's card),
and a **dues gate** at print (per-exam thresholds, god override).

Physical and digital signing run **in parallel** — the printed card still has a wet-ink
box; if a day was digitally signed, a *reprint* pre-fills that box with the captured
signature (or "ABSENT").

### Explicitly out of scope (v1)
- Marks entry, grade computation, report cards.
- Vivas / practicals on the card.
- Grades outside **I–IX**, and Nursery–KG.
- Per-**section** schedule differences, electives, streams (schedule is **per grade**).
- Two papers in one day (one paper per grade per date).
- Student/parent app visibility (the QR is **staff-only**).
- Exam-absence notifications (no SMS/WhatsApp on exam absence).
- xlsx import of the datesheet (grid is entered by hand in the portal).

---

## 2. Core decisions (frozen)

| Topic | Decision |
|-------|----------|
| Schedule granularity | **Per grade** (I–IX). One paper per grade per date. Column count varies by grade (skip "---" dates). |
| Subject | **Free-text label** per cell (e.g. `G.K., Value Edu., Reasoning & Art`). No normalized subject master — exam subjects are kept independent of timetable/syllabus subjects; correlation deferred. |
| Multiple exams/year | Yes. Each exam has its own datesheet + cards. |
| Roll number | **Not modelled.** Card prints `Roll No: ____________` as a blank line, filled by hand. Students on a card/roster are ordered **alphabetically by name**. |
| Dues gate | At print, **per class**. Two **per-exam**, god-editable thresholds: current-AY outstanding and prior-AYs outstanding (shown separately). Over either threshold ⇒ blocked unless a god override exists. |
| Dues source | Computed via a **fees-module service function** (imported, not HTTP), **academic heads only, transport excluded**, split current-AY vs prior-AYs. No duplicated ledger logic. |
| God override | God selects one-or-many blocked students; override is **persisted** with who/when/reason and lets subsequent prints/reprints through. Only **god** edits thresholds and overrides. |
| Print | **Per class only.** **HTML + CSS `@page` print** (house pattern — no server-PDF stack exists; the office prints to PDF from the browser), 3-or-4-up (selectable, remembered as per-exam default). Logo/stamp/QR inlined as `data:` URIs. A **print-preview / page-count** summary is shown before printing. Every print recorded in a **print audit** (for lost-card reprints). |
| Reprint semantics | Card is a **live view** keyed by a stable `admit_card` id. A reprint pre-fills a day's signature box with the captured **digital signature (or "ABSENT")** *only if that day was digitally signed*; otherwise the box prints blank for wet ink. |
| Invigilation | Assigned per **(exam, date, section)**. One employee may cover multiple sections on a date — **warn but allow** (override). |
| Digital signature | Invigilator uses the **employee PWA (`/me`)**, sees **only their** rosters, marks every student present/absent, then **signs once** (a **draw-on-canvas PNG** stored in `file_storage`). Sign is enabled **only when the roster is fully marked**. Signed rosters remain **editable** (present↔absent, re-sign) with an **append-only audit**. |
| Admin/god/incharge | See the **full** schedule and can sign **any** roster. |
| Exam attendance | A **separate** `exam_attendance` (per paper-day), not the daily roll-call attendance module. Append-only audit. |
| QR | **Staff-authed** live admit-card view: student + class + exam, paper list, per-day present/absent + signer + signed-at. |
| Roles | `god`, `admin`, and a **new `exam_incharge`** role with **admin-equivalent powers in the exam domain**. God alone edits thresholds + dues overrides. |
| Branding | Logo + office stamp come from a **central per-school config store** (shared, reused by receipts/report-cards later). Exam-incharge footer signature = the assigned incharge **employee's stored signature** (reused). |
| Lifecycle | Exam is **draft** while building the grid + assigning invigilators; **published** unlocks printing and invigilator PWA visibility. |

---

## 3. Data model

Conventions per repo: all lowercase snake_case; `varchar` + `check` for enums; no DDL
defaults (set in app); no foreign keys (app-level validation); short uuid PKs via
`generateShortUuid(12)`; timestamps `timestamptz`. Schema lives in
`modules/examination/examination-setup.sql` (idempotent, additive) with a matching
`examination-setup-rollback.sql`.

### 3.1 `examination`
The exam header + per-exam configuration.

| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | |
| school_code | varchar | tenant |
| academic_year_id | varchar | |
| name | varchar | e.g. `Half Yearly Examination` |
| status | varchar(16) | check `('draft','published','archived')` |
| exam_incharge_employee_id | varchar | assigned incharge; footer signature source |
| dues_threshold_current | numeric | current-AY block threshold (amount) |
| dues_threshold_prior | numeric | prior-AYs block threshold (amount) |
| cards_per_page | int | remembered default (3 or 4) |
| start_date / end_date | date | schema-ready; derived from papers or entered |
| created_at / updated_at | timestamptz | |
| created_by / updated_by | varchar | employee id |

### 3.2 `exam_paper` — the datesheet grid
One row per (exam, grade, date) where a paper exists. "---" cells are simply absent.

| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | |
| exam_id | varchar | |
| school_code | varchar | |
| grade | varchar | grade label prefix: `I`..`IX` (derived from class name like `I-A` → `I`) |
| exam_date | date | |
| subject_label | varchar | free text |
| status | varchar(16) | check `('active','deleted')` |
| created_at / updated_at / by | | |

App-level uniqueness: one active paper per `(exam_id, grade, exam_date)`.
The grid editor upserts this table in bulk.

### 3.3 `exam_invigilator` — per (date, section) assignment
| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | |
| exam_id | varchar | |
| school_code | varchar | |
| exam_date | date | |
| section_class_id | varchar | the section/class (e.g. `I-A`) |
| employee_id | varchar | invigilator |
| status | varchar(16) | active/deleted |
| created_at / updated_at / by | | |

The paper a section sits on a date = `exam_paper` where `grade` = section's grade prefix
and `exam_date` matches. If none, that section has no roster that day. Double-booking
(same employee, same date, >1 section) is allowed with a portal warning.

### 3.4 `exam_admit_card` — stable identity for QR + reprint
Lazily created on first generation/print and reused thereafter. The `uuid` is what the QR
encodes.

| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | **the admit-card id in the QR** |
| exam_id | varchar | |
| school_code | varchar | |
| student_id | varchar | |
| section_class_id | varchar | enrolment section at generation |
| created_at | timestamptz | |

### 3.5 `exam_attendance` — per paper-day/student
One row per (paper, student), created when the invigilator marks the roster.

| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | |
| exam_id | varchar | |
| school_code | varchar | |
| exam_paper_id | varchar | the grade/date paper |
| exam_date | date | denormalized for cheap reads |
| section_class_id | varchar | |
| student_id | varchar | |
| status | varchar(16) | check `('present','absent')`; unmarked = no row / null |
| signed_by_employee_id | varchar | invigilator who signed |
| signed_at | timestamptz | |
| signature_file_id | varchar | **snapshot** of the signature PNG used at sign time (so later signature changes don't rewrite history) |
| created_at / updated_at | timestamptz | |

App-level uniqueness: `(exam_paper_id, student_id)`.

### 3.6 `exam_attendance_audit` — append-only
Mirrors the attendance/homework audit pattern.

| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | |
| exam_id / school_code | varchar | |
| exam_paper_id / student_id | varchar | |
| action | varchar(24) | `mark_present` / `mark_absent` / `sign` / `resign` / `edit` |
| old_status / new_status | varchar(16) | |
| employee_id | varchar | actor |
| note | text | |
| at | timestamptz | |

### 3.7 `exam_dues_override` — persisted god override
| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | |
| exam_id / school_code | varchar | |
| student_id | varchar | |
| approved_by_employee_id | varchar | god |
| reason | text | required |
| status | varchar(16) | active / revoked |
| at | timestamptz | |

### 3.8 `exam_print_log` — print audit
| column | type | notes |
|--------|------|-------|
| uuid | varchar(12) pk | |
| exam_id / school_code | varchar | |
| section_class_id | varchar | class printed |
| printed_by_employee_id | varchar | |
| cards_per_page | int | |
| student_count | int | cards in this run |
| page_count | int | |
| reason | varchar(24) | `normal` / `reprint` |
| note | text | e.g. "lost card — Aaradhya Singh" |
| at | timestamptz | |

### 3.9 Central branding store (shared, not exam-specific)
A small per-school config record (new **shared/central** store — first consumer is
examination; receipts/report-cards migrate onto it later). If an equivalent already exists
in the receipts pipeline, reuse it instead of creating a new table.

| column | type | notes |
|--------|------|-------|
| school_code | varchar pk | |
| logo_file_id | varchar | header logo (file_storage) |
| stamp_file_id | varchar | office sign & stamp (file_storage) |
| updated_at / by | | |

### 3.10 Employee signature
Stored via the existing `file_storage` table, `entity_type = 'employee_signature'`,
`entity_id = employee_id` (one active PNG per employee). Uploaded by the employee via
`/me`. Exam-incharge footer signature = the incharge employee's signature file.

---

## 4. The admit card (print layout)

One card (the physical artifact from the sample):

```
┌───────────────────────────────────────────────────────────────┐
│ [LOGO]  Dr. B. P. Agrawal Shiksha Niketan            [QR]      │
│         — Chariot of Knowledge —                    (staff)    │
│         Half Yearly Examination · 2026-27                      │
│                     ADMIT CARD                    Class: I-A __ │
│  Name: Aaradhya Singh        Roll No: ____________             │
│  ┌────────┬────────┬────────┬────────┬────────┬────────┐       │
│  │ Date   │ 09-09  │ 11-09  │ 14-09  │  ...   │        │       │
│  │ Subject│ Eng-I  │ Eng-II │ EVS    │  ...   │        │       │
│  │ Invig. │ [sign] │ [sign] │ [    ] │  ...   │        │       │
│  │ sign   │        │        │        │        │        │       │
│  └────────┴────────┴────────┴────────┴────────┴────────┘       │
│                                                               │
│  Examination Incharge [sig]        Office sign & Stamp [stamp] │
└───────────────────────────────────────────────────────────────┘
```

- **Columns** = that grade's papers, in date order (only dates the grade actually sits).
- **Invigilator sign** cell: on a reprint, a **digitally-signed** day renders the captured
  signature image (or the word **ABSENT**); otherwise the box is blank for wet ink.
- **Header** text is data-driven; **logo**, footer **incharge signature**, and **office
  stamp** are images.
- **QR** encodes the `exam_admit_card.uuid` → staff verify page.
- **N-up**: 4-up = 2×2, 3-up = 3 stacked, on A4 portrait. Selectable at print.

### Rendering — DECIDED: HTML + CSS print
This codebase has **no server-side PDF stack** — receipts
(`modules/fees/fees-receipt-template.ts`) are HTML printed from the browser, QR embedded
as an inline `data:` URI. Admit cards follow the same house pattern:

- A server-built **HTML template** (data-driven text like the receipt template), N-up via
  **CSS grid + `@media print` / `@page`**, `cards-per-page` (3 or 4) toggling the grid.
- **Logo, office stamp, incharge signature, QR, and any digital invigilator signatures**
  are inlined as `data:` URIs (base64 pulled from `file_storage`).
- The portal renders a **print-preview** with the derived page count
  (`ceil(printable ÷ cardsPerPage)`) and the office prints to PDF from the browser.
- Zero new Lambda infra; reuses the receipt template pattern verbatim.

---

## 5. Dues gate

At print for a class, for each active on-roll student:

1. Call the fees service → `{ currentDue, priorDue }`. Reuse
   `feesReportService.duesByYear(schoolId, studentId)`
   (`modules/fees/fees-report-service.ts:452`) which returns `{ academic_year_id,
   year_name, balance }` per year; **partition** on the exam's `academicYearId`
   (current vs sum-of-prior). Add `category = 'fee'` to its query (or a thin exam variant)
   so **transport is excluded** — `duesByYear` does not filter it today. Underlying source
   is the `student_ledger_entry` table (`outstanding = debit − credit`).
2. `blocked = currentDue > exam.dues_threshold_current OR priorDue > exam.dues_threshold_prior`.
3. `printable = !blocked OR active override exists`.

The **preview** lists: printable count, blocked list (with current/prior amounts),
overridden list, and resulting **page count** = `ceil(printableCount / cardsPerPage)`.
The **print** includes only printable students. God can multi-select blocked students →
create overrides (with reason) → re-preview.

---

## 6. Endpoints

### Admin / office (portal) — `god | admin | exam_incharge`
```
POST   /examinations                              create (draft)
GET    /examinations?academicYearId=              list
GET    /examinations/{id}                          detail
PATCH  /examinations/{id}                          name / incharge / cardsPerPage / publish
PATCH  /examinations/{id}/thresholds               dues thresholds        [god only]

GET    /examinations/{id}/papers                   the grid
PUT    /examinations/{id}/papers                    bulk upsert grid cells

GET    /examinations/{id}/invigilators              date×section grid (+ double-book flags)
PUT    /examinations/{id}/invigilators               bulk assign

GET    /examinations/{id}/classes/{sectionId}/roster        students + dues + signed status
GET    /examinations/{id}/classes/{sectionId}/print-preview  counts, blocked, pages
POST   /examinations/{id}/classes/{sectionId}/print         generate PDF, log print
POST   /examinations/{id}/dues-overrides            create overrides       [god only]
DELETE /examinations/{id}/dues-overrides/{id}       revoke                 [god only]
GET    /examinations/{id}/print-log                 audit

GET    /examinations/{id}/rosters                   all rosters (sign any)  [admin/god/incharge]
POST   /examinations/{id}/rosters/{paperId}/{sectionId}/mark   present/absent (any roster)
POST   /examinations/{id}/rosters/{paperId}/{sectionId}/sign   sign any roster
```

### Employee PWA — `/me` (invigilator)
```
GET    /me/exam/invigilations                       my assigned (exam,date,section,paper)
GET    /me/exam/invigilations/{paperId}/{sectionId}/roster   my roster
POST   /me/exam/invigilations/{paperId}/{sectionId}/mark     present/absent (mine)
POST   /me/exam/invigilations/{paperId}/{sectionId}/sign     sign once (mine; requires fully marked)
GET    /me/signature                                have I uploaded one?
PUT    /me/signature                                upload canvas PNG
```

### Staff QR verify — `god | admin | exam_incharge` (authorizer enforced)
```
GET    /examination/verify/{admitCardId}            live admit-card view
```
Returns student + class + exam, papers[], and per-day `{ status, signedBy, signedAt }`.

---

## 7. Roles

Add `exam_incharge` to the role enum with **admin-equivalent** powers scoped to the exam
domain (create/edit exams, grid, invigilators, print, sign any roster, view verify).
**God-only:** edit `dues_threshold_*`, create/revoke `exam_dues_override`. Gate via the
central `requireAction`/`guard` RBAC helper (branch `feat/backend-authz`); offline falls
back to god. `/me` invigilator writes are scoped to the caller's own assignments.

---

## 8. Build phases

**Phase 1 — Foundation**
- Module scaffold (serverless.yml, local.config.json, handler/service split, endpoints
  yml, `/health`), matching a recent module (academic-calendar/homework).
- `examination-setup.sql` (+ rollback): §3.1–3.4, 3.7, 3.8.
- Exam CRUD + draft→publish; grade×date **grid editor**; invigilator **assignment grid**
  with double-book warning.
- Portal `/examination` page (list, grid editor, invigilator grid).

**Phase 2 — Admit cards & printing**
- Central branding store (§3.9) or reuse receipts' branding.
- Fees dues **service integration** (current vs prior).
- Roster view + dues status; god override (§3.7); print-preview + page count.
- Server **PDF** (reuse receipts' stack), 3/4-up, print audit (§3.8), staff QR encoding
  the `admit_card` id.

**Phase 3 — Invigilation / PWA & signatures**
- Employee signature capture (draw-on-canvas PNG → `file_storage`).
- `/me` invigilator schedule + roster mark/sign; `exam_attendance` (§3.5) + audit (§3.6);
  sign-enabled-when-fully-marked; post-sign edits with audit.
- Reprint pre-fill of digitally-signed days ("signature or ABSENT").
- Staff QR verify view.

---

## 9. Integration points (grounded against the codebase)

- **Fees dues** — `feesReportService.duesByYear(schoolId, studentId)`
  (`fees-report-service.ts:452`) → per-year `{ balance }`; partition on current AY; add
  `category = 'fee'` for academic-only. Source table `student_ledger_entry`. ✔ resolved.
- **Roster** — `student_class` join `order by st.name` (pattern:
  `attendance-service.ts:43`); **no `roll_no` column** → blank line. ✔ resolved.
- **Branding store** — receipts have **no logo/stamp** today (text-only header,
  `fees-receipt-template.ts:107`); §3.9 central store is net-new, examination is first
  consumer. ✔ resolved.
- **file_storage** — `fileStorageService.upload/getWithData` (`shared/lib/file-storage.ts`);
  new `entity_type`s: `employee_signature`, `school_logo`, `school_stamp`,
  `exam_incharge_signature`. Pattern: `modules/student/student-photo-service.ts`. ✔.
- **QR** — `qrcode` lib, `imsk:<type>:<uuid>` opaque staff token + authed `verify/staff`
  endpoint, authorizer **not** exempted (`fees-receipt-service.ts:280`,
  `fees/serverless.yml`). ✔ resolved.
- **Roles** — add `EXAM_VIEW`/`EXAM_MANAGE` to `ACTIONS` and `'exam-incharge': ['exam.*']`
  + `'exam.*'` on admin in `shared/lib/authz-policy.ts`; enforce via
  `guard(action, fn)` (`modules/auth/authz.ts`). Keep `admin-portal/src/permissions/*`
  in sync (parity test). ✔ resolved.
- **`/me` PWA** — employee routes resolve caller via `resolveEmployee(event, callback)`
  (`modules/homework/handler-util.ts:59`); JWT-protected, row-scoped (not role-guarded). ✔.
- **Ports** — 3051/3052 (local) / 6051/6052 (prod) confirmed free. ✔ resolved.
- **Rendering** — **DECIDED**: HTML + CSS `@page` print (house pattern), logo/stamp/QR
  inlined as `data:` URIs; office prints to PDF from the browser. See §4. ✔ resolved.
```

---

## 10. Phase 5 — relievers · free teachers · AV room · roster finalization

> Status: **DESIGN (frozen 2026-09-12)**, pre-build. Extends the Phase-4 seating-room model.
> Every decision below was confirmed with the owner; the knock-on rules (E1–E3) are the ones
> that most affect the schema and the printed card.

### 10.1 Relievers (break-cover floaters)
- A **day-level pool** per `(exam, exam_date)` — floaters that relieve room invigilators for
  breaks; **not** tied to a room.
- New table `exam_reliever(uuid, school_id, exam_id, exam_date, employee_id, status,
  createdby_userid, created_at, updated_at)`. Idempotent per (exam, date): replace-on-save
  like `exam_room_invigilator`.
- UI starts at **2 rows**, "add" for more, **0 allowed**.
- A person **cannot** be both a room invigilator and a reliever on the same date (validate at
  save, both directions).
- Relievers **never sign** anything and **never appear on the admit card** — purely on-duty log.

### 10.2 Free teachers (that day)
- Definition: **active employees NOT assigned to any room AND NOT a reliever** for this exam on
  this date. (We cannot account for non-exam duties — the timetable load is a separate module
  and exams suspend normal classes; out of scope.) Computed, not stored.
- Surfaced **only in "Focus a day"** mode on the invigilator grid, as a picker to assign
  relievers from.

### 10.3 AV room
- A **single special room auto-present on every exam date**. Modelled as an `exam_room` row with
  **`kind = 'av'`** (seating rooms are `kind = 'seating'` / null); auto-created on first load of
  a seating-enabled exam. **No roll-range allocations.**
- Needs an assigned **supervisor** each day — reuses the room-invigilator mechanism
  (`exam_room_invigilator`, `room_id` = the AV room).
- **Ad-hoc roster**: the supervisor searches & adds the specific students present that day; then
  marks + submits like any room. Occupants come from a new
  `exam_av_occupant(uuid, school_id, exam_id, exam_date, student_id, status, added_by, ...)`
  instead of section allocations. (`roomOccupants` gets an AV branch that reads this table.)
- A student in the AV room is a **distinct status** in Student 360 (see 10.7), not "Absent".

### 10.4 Roster: Save draft vs Submit & sign
- Two actions, clearer semantics:
  - **Save draft** — persist present/absent marks, **no signature**, stays editable, labelled
    *Not submitted*. Nothing prints.
  - **Submit & sign** — materialise unmarked→present, stamp the signer's signature onto every
    occupant's `exam_attendance` row (prints on the card), and **finalise**.
- After submit, the teacher/admin view is **read-only**: openable, shows a **"Submitted ✓ on
  <date>"** banner, all controls disabled.
- **Re-submit window**: teacher/admin may re-submit **until the end of that exam date (IST)**;
  **hard-locked (god-only) after** the date passes. Lock boundary = `istToday() > exam_date`.

### 10.5 God corrections — **option (b): retain the invigilator's signature**
- God may edit a submitted roster at any time (never time-locked — **E3**).
- When god edits a roster that **already carries an invigilator signature**, that signature is
  **retained**; we record **"corrected by god on <date>"**.
- **E1.** If god is the **first/only** signer (teacher never submitted), the card uses **god's**
  signature (there is no invigilator signature to retain).
- **E2.** The **"corrected by god on <date>"** marker is **visible** on the printed admit card
  and in Student 360 — not audit-only. (New columns on `exam_attendance`:
  `corrected_by_employee_id`, `corrected_at`; or a per-room correction stamp — decide at build.)

### 10.6 Invigilator assignment: auto-save + post-submit lock
- Selecting a teacher in a grid cell **auto-saves immediately** (per-cell PUT). **No Save
  button** — this also removes the permanently-blue "unsaved" affordance bug.
- Once a room-day roster is **submitted**, that cell's invigilator is **locked for
  teacher/admin**; **god can still change it** (auto-saves).
- Clarity: grid assignment = *who's rostered*; card signature = *who actually signed* (governed
  by 10.5). A post-submit god reassignment does **not** rewrite the signature.

### 10.7 Student 360 exam surface
- **Per paper** — one row per subject/date: subject, date, **present/absent** (or **In AV
  room**), and the **invigilator name + "signed ✓"** marker, plus **"corrected by god"** per E2.
  No signature image.
- Rows appear **only once the roster is submitted**; an unfinalised day shows **"—/pending"**; a
  no-show shows **Absent**; an AV-room student shows **In AV room**.
- One session per exam day; one invigilator per room (relievers cover extra load).

### 10.8 Build phasing
- **P5a** — roster finalization (draft vs submit + read-only view + end-of-day lock) · god
  correction retaining invigilator signature (E1/E2) · grid auto-save + post-submit lock · fix
  the always-blue button. *(Highest value, touches existing surfaces.)*
- **P5b** — relievers pool + free-teacher picker.
- **P5c** — AV room (auto room + ad-hoc occupant roster + supervisor).
- **P5d** — Student 360 per-paper surface (incl. In-AV-room + corrected-by-god markers).

### 10.9 Added requirements (folded into P5a)
- **Completion board (for the incharge/god).** Not a check-in — purely a progress view over the
  existing *submitted* (signed) state: per exam date show how many room-day rosters are **signed**
  vs **attendance pending**, and flag the pending rooms. Surfaced on the invigilator grid: a per-cell
  **signed ✓ / pending** marker and a per-day tally ("12/17 signed").
- **Sudden duty change (reassign).** Done via the invigilator **grid cell** (auto-saves on select —
  same surface, works on phone). On reassign, fire an **in-app notification** to the **new** invigilator
  ("duty assigned") and, if someone was replaced, the **old** one ("duty changed") — via the
  communication inbox (mirror `leave-notify.ts`; fire-and-forget, never fails the save). Reassignment
  of a room whose roster is already **submitted** is **locked for teacher/admin, god-only**.
