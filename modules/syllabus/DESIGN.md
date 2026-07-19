# Syllabus Planner — Design

A month-wise **syllabus planner**: for each grade + subject in an academic year, an ordered list of what gets taught and when (the digital form of the printed "Session 2026-27: Class III — General Knowledge" sheets). Teachers mark coverage **per section**; the student/parent app reads a **timeline anchored on today** — scroll back to see what's been covered, forward to see what's pending.

> Status: **Phase 1 (backend)**. Subjects, plans, entries (with bulk add + reorder), per-section progress, and the student `/me` timeline are implemented with integration tests. Admin coverage rollups beyond a per-section count are deferred.

## Scope boundaries

- **Own subject catalog.** Syllabus subjects are independent of the timetable module's `subject` table — GK (and the specific textbook a sheet is built around) need not be a teaching/timetable subject. The `syllabus` module owns `syllabus_subject`.
- **No grade entity.** A `class` row is a *section* (`I-A`, `I-B`, `Nursery-A`). The plan attaches to a **grade string** = the class name with its trailing `-<section>` removed (`I-A` → `I`, `Nursery-A` → `Nursery`). Sections of a grade are every class whose parsed grade matches. See `parseGrade` in `syllabus-util.ts`.
- **Classes / students / academic years** are owned by their modules; syllabus stores their uuids (no FKs) and resolves names for display.
- **Month granularity.** Entries belong to an academic month (April→March), not a date. "Today" resolves to the current month to anchor the timeline.
- **Coverage = teacher marks.** The calendar only *anchors* the timeline; a topic reads Covered only when its section has a `covered` progress row. This shows a class running behind/ahead of plan honestly.

## Confirmed decisions

- **Plan per grade, progress per section.** One `syllabus` per `(school, academic_year, grade, subject)`, shared across the grade's sections. Progress rows are keyed `(entry, class_id)` so each section/teacher tracks its own coverage.
- **One ordered entry list.** Months, senior "Topic:" section-headers, topics, and exam/revision/refresher markers all live in `syllabus_entry`, ordered by a single `seq`. The printed grouping falls out of `month` + `entry_type`. `entry_type in (topic, section, activity, revision, exam, refresher, note)`.
- **Themes are free text** (`theme`) — GK-rich, blank for most other subjects. No lookup to maintain.
- **Layout hint** (`layout in (junior, senior)`) on the plan drives print rendering (junior single table vs senior grouped/two-column); the API serves the same structured data regardless.
- **Bulk entry.** A whole sheet is entered via `POST /syllabi/{id}/entries/bulk` (append or replace), not only one row at a time. Manual entry is the input path (no Word/Excel importer in v1).

## Data model

Conventions: lowercase SQL, no FKs, no DDL defaults, `varchar(12)` uuids, `school_id` on every row, `status in ('active','deleted')` soft delete, audit columns, enums as `varchar + check`, uniqueness via partial unique indexes `where status='active'`. See `syllabus-setup.sql`.

- **syllabus_subject** — school-level catalog: `name`, optional `description`. Unique `(school_id, lower(name))`.
- **syllabus** — the plan header: `academic_year_id`, `grade`, `subject_id`, optional `book`, `layout in (junior,senior)`, `note` (the "current affairs / assembly" footer). Unique `(school_id, academic_year_id, grade, subject_id)`.
- **syllabus_entry** — `syllabus_id`, `seq`, `month in (april..march)`, `entry_type`, optional `topic_no` ("T-1"), `title`, optional `theme`, optional `page_ref` (free text: "177", "178-179"), optional `term in (half_yearly, annual)`. Index `(syllabus_id, seq)`.
- **syllabus_progress** — one per `(syllabus_entry_id, class_id)`: `status in (pending, covered)`, optional `covered_date`, `marked_by` (employee), optional `remark`. Upserted on mark; absence of a `covered` row = pending. Unique `(syllabus_entry_id, class_id)`.

## API

Base path `/syllabus`. All admin/teacher requests require `X-School-Code`; JSON is camelCase.

- **Lookups**: `GET /lookups` (months, entry types, terms, layouts), `GET /grades?academicYearId=` (distinct grades derived from class names)
- **Subjects**: `POST /subjects`, `GET /subjects`, `GET/PUT/DELETE /subjects/{id}`
- **Plans**: `POST /syllabi`, `GET /syllabi?academicYearId=&grade=&subjectId=`, `GET /syllabi/{id}` (header + ordered entries), `PUT/DELETE /syllabi/{id}`
- **Entries**: `POST /syllabi/{id}/entries` (one), `POST /syllabi/{id}/entries/bulk` (`{mode:'append'|'replace', entries:[...]}`), `PUT /entries/{id}`, `DELETE /entries/{id}`, `PUT /syllabi/{id}/entries/order` (resequence)
- **Progress (teacher)**: `GET /syllabi/{id}/progress?classId=` (entries + covered status + a `{total,covered,pending}` count for that section), `POST /progress` (mark one: `{entryId, classId, status, coveredDate?, remark?}`), `POST /progress/bulk` (mark many)
- **Student app (family token + `X-Student-Id`)**: `GET /me/timeline?academicYearId=&today=` → the active child's grade timeline: `{grade, classId, className, currentMonth, subjects:[{subjectId, subjectName, layout, book, note, months:[{month, isCurrent, entries:[{..., covered, coveredDate}]}]}]}`. `today` optional (testing override).

## Cross-module access

- Reads `school`, `academic_year`, `class`, `student_class`, `employee` by uuid for validation, grade derivation, and name resolution (`syllabus-common.ts`).
- The student timeline resolves the active child → `student_class` (for the year) → `class` (section) → grade → the grade's plans, and overlays that section's `syllabus_progress`.

## Assumptions / follow-ups

- **Grade parse** assumes `<grade>-<section>` naming (`I-A`); a class with no `-` is treated as its own grade. Revisit if a school uses a different convention.
- **Current month** for the anchor comes from the server clock (overridable via `?today=YYYY-MM-DD`); it is a display anchor only and never changes stored data.
- **Coverage rollups** across a whole grade/school (dashboards) are deferred — the per-section count in the progress roster covers the teacher-marking screen.

## Test plan

Integration tests (`__tests__/syllabus.test.ts`, run against the gateway): subject create + duplicate rejection; plan create + one-per-grade/subject enforcement; entry add, bulk append/replace, reorder; grade derivation in `GET /grades`; progress mark → roster covered count, re-mark idempotency, per-section isolation. The student `/me` timeline is covered by unit tests for its pure logic (`parseGrade`, current-month anchor) plus the shared coverage overlay exercised by the progress-roster test; it is not driven over HTTP because minting a family JWT across the test/module processes is unreliable (same reason transport skips it). Ports: 3043/3044 local, 6043/6044 prod.

## Tools

- **`scripts/import-syllabus.js`** — dependency-free `.docx` importer for the school's GK syllabus sheets. Parses both layouts (junior single-table, senior two-column with `Topic:` section headers and `#…` note rows), auto-detects grade/subject/layout, and seeds the plan via the API. `--file`/`--dir`, `--school`, `--stage`, `--mode append|replace`, `--dry-run`. Reuse for future syllabus documents.

## Handover checklist

- [ ] Deploy DB (`node modules/syllabus/scripts/db-setup.js --stage <stage> --action setup`).
- [ ] Admin-portal: subject catalog, plan builder (bulk paste of a sheet), and the per-section progress-marking screen.
- [ ] Student app: wire `GET /syllabus/me/timeline` into a scrollable month timeline anchored on the current month.
