# Student Module — Design

The student module is the **system of record for a student's identity and
enrollment lifecycle**: admit/edit/view a student, capture structured
parent/guardian details with photos, assign a House, and promote students (one,
or a whole class) into a new academic year. It also becomes the home of a future
**360° student summary** — a parent-facing "quick pulse" that aggregates data
other modules already own, and is eventually read aloud via Alexa/Echo.

> Status: **Phase 1 built** (admin foundation: CRUD, guardians, houses, photos,
> promotion lifecycle), test-backed. Phase 2 (360 summary aggregator) and Phase 3
> (Alexa narrative) are designed below but not built.

## Scope boundaries

Deliberately **out** of this module (each is/should be its own module):
attendance, transfer certificates (TC), communication, performance observation.
The 360 summary will *read* attendance/performance when those modules exist; until
then those cards degrade gracefully.

## Confirmed decisions

- **Parents/guardians → normalized `student_guardian` table** (one row per
  father/mother/guardian/other). The legacy inline `student.*_mobile/whatsapp/email`
  columns are left in place (not yet backfilled); the new table is the going-forward
  home for names, occupation, address, and per-guardian photos.
- **House is lifelong** → `house_id` on `student` (survives promotion). A per-school
  `house` lookup (name/code/color) backs it.
- **Promotion is the first "population → action"**: the UI selects a population
  (search/filter → studentIds) and POSTs that list to an action endpoint. v1 ships
  the year-rollover actions; future actions (attendance, etc.) reuse the same shape.
- **Promotion lifecycle has three actions** (not just class→class):
  - *Promote* — new `student_class` row in the target class+year.
  - *Retain* (held back) — same mechanism, `toClassId` = the same class, new year.
  - *Graduate / pass out* — no new enrollment; `student.status` → `inactive`.
- **The "current" class is derived**, not flagged: it is the enrollment row with the
  latest `academic_year.start_date` (lateral join, same pattern as
  `supply-issue-service.ts`). No "is_current" column to keep in sync.
- **Summary endpoint (Phase 2) returns structured JSON only**; the natural-language
  narrative is a thin Phase 3 layer over that JSON.
- **Admission number is unique per school** (the prior global `UNIQUE` was dropped —
  it was a multi-tenancy bug).

## Build phases

1. **Admin foundation (built):** schema (`house`, `student_guardian`,
   `student.house_id`, `student_class.roll_number`), student CRUD + extended search
   (by admission number / parent phone), guardians, houses + assignment, photos,
   promotion lifecycle.
2. **360 summary aggregator (next):** one read-only endpoint
   `GET /students/{id}/summary` that fans out across other modules' tables and rolls
   up a 6-dimension "pulse". Structured JSON only. See below.
3. **Alexa narrative:** a short natural-language paragraph generated from the Phase 2
   JSON (Claude), exposed for TTS/Alexa skill consumption.

## Data model

> Conventions: `varchar(12)` uuid PK via `generateShortUuid(12)`, lowercase
> snake_case, status `check` constraints, **no foreign keys**, no DDL defaults
> (set in app code), audit columns, `school_id` on every row, partial unique
> indexes `where status = 'active'`. The core `student` / `student_class` tables
> live in `modules/db/db-create-1.sql`; this module adds the rest in
> `student-setup.sql`.

- **`house`** — per-school lookup. `name, code, color, status`. Unique
  `(school_id, lower(code)) where status='active'`. Delete is blocked while any
  student still references it.
- **`student.house_id`** (added column) — lifelong House assignment (nullable).
- **`student_class.roll_number`** (added column) — per-year roll number; unique
  `(class_id, academic_year_id, roll_number) where status='active' and roll_number is not null`.
- **`student_class.status`** (added column) — soft-delete/lifecycle on the enrollment
  row. Treated as active when null (legacy rows). Queries filter `status <> 'deleted'`.
- **`student_guardian`** — one row per guardian. `relation('father'|'mother'|
  'guardian'|'other'), name, occupation, address, mobile, whatsapp, email,
  is_primary_contact, status`. Indexed `(school_id, student_id, status)`.
- **Photos** — stored in the shared `file_storage` table
  (`entity_type in ('student','guardian')`, `entity_id` = the row uuid). One photo
  per entity (upload replaces). 2 MB / `image/jpeg|png` guard in app code.

## API

camelCase JSON, `ResponseBuilder`, `X-School-Code` multi-tenancy on every call.
Module is mounted at `/students`.

- `GET /students` / `GET /students/search` — list/search (name, classId,
  academicYearId, **admissionNumber, phone**).
- `POST /students` — admit (optional initial enrollment + inline guardians).
- `GET /students/{id}` — full detail: student + house + current enrollment +
  enrollment history + guardians (+ photo refs).
- `PUT /students/{id}` / `DELETE /students/{id}` — update / soft-delete.
- `GET|POST /students/{id}/guardians`, `PUT|DELETE /students/{id}/guardians/{guardianId}`.
- `PUT /students/{id}/house` — assign/clear House.
- `GET|POST|PUT|DELETE /students/houses[/{id}]` — House lookup CRUD.
- `POST|GET|DELETE /students/photos/{entityType}/{entityId}` — student/guardian photos.
- `POST /students/promote` — promote/retain selected students (`items:[{studentId,
  toClassId, rollNumber?}]`). Transactional, idempotent, per-student result list.
- `POST /students/promote-class` — promote a whole class (resolves the source roster,
  `excludeStudentIds` left for explicit Retain/Graduate).
- `POST /students/graduate` — pass out (`studentIds` → status inactive).

## Status semantics

`student.status`: `active` = on roll; `inactive` = left/withdrawn/passed-out
(excluded from rosters & promote lists, retained in history & summary); `deleted` =
soft-deleted.

## Cross-module access (for the Phase 2 summary)

No FKs; one shared DB; everything joins `student` by uuid + a `*_type='student'`
discriminator. The aggregator reads (all columns verified to exist today):

| Dimension | Source table(s) | Student link |
|---|---|---|
| Enrollment/identity | student, student_class, house | own |
| Conduct | `fine_incident` (person_id), `lab_breakage_log` / `sport_breakage_log` (responsible_id) | `*_type='student'` |
| Library | `library_circulation` (borrower_id), `library_fine` (borrower_id) | `borrower_type='student'` |
| Dues | `library_fine`, `fine_incident`, `uniform_sale` (student_id), `shop_sale` (student_id) | mixed |
| Health | `medical_issue_log` (entity_id) | `entity_type='student'` |
| Timetable | `published_entry` via current class | `class_id` of current enrollment |
| Attendance / performance | *future modules* | placeholder until built |

## Test plan

API-level tests under `__tests__/` (run against the live local module via the
gateway): create→get student (per-school admission-number uniqueness), search by
admission number / phone, guardian add/list/update/delete, house create + assign,
photo upload guard (mime/size), **promote**, **retain** (same-class new-year row),
**graduate** (status→inactive, no new enrollment), **promote-class** (new rows +
idempotent re-run skips), roll-number uniqueness, soft-delete.
