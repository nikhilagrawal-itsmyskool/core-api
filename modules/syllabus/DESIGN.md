# Syllabus Planner — Design

A month-wise **syllabus planner**: for each grade + subject in an academic year, an ordered list of what gets taught and when (the digital form of the printed "Session 2026-27: Class III — General Knowledge" sheets). Teachers mark coverage **per section**; the student/parent app reads a **timeline anchored on today** — scroll back to see what's been covered, forward to see what's pending.

> Status
> - **Phase 1 (shipped)** — subjects, plans, entries (bulk add + reorder), per-section progress, student `/me` timeline. In prod; 8 GK plans (I–VIII) seeded.
> - **Streams (shipped)** — plans carry a nullable `stream_code`; the student timeline shows common (`null`) + the child's stream; grades/sections use base classes only. See "Streams" below.
> - **Model papers (shipped)** — per grade+stream+subject+exam, Word+PDF docs with visibility-gated download and an answer-key release; docx→pdf conversion worker (LibreOffice layer) wired, PDF-runtime enablement pending. See "Model papers" below.
> - **Phase 2 — per-subject layouts & activity-level coverage (DESIGNED, not built)** — the section "Phase 2" below. This supersedes the flat junior/senior `entry_type` model for the non-GK subjects.

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

## Phase 2 — Per-subject layouts & activity-level coverage (designed)

**Why.** Beyond GK, every subject's document is a wide table — `Month | Chapter | Pages | …subject-specific columns…` — and those columns differ **per subject and per grade** (Class II English = Speaking/Listening/Writing/Phonics/Cursive; Class VIII English = Discussion Point/Vocabulary/Language in Use/Active Listening; Computer II has 10 columns, VIII has 11). Content also changes year to year. So the layout must be **data, not code**, and coverage must go finer than "chapter".

**The owner's coverage rule (Class II Computer).** A chapter shows its **activities** (the non-empty pedagogy cells). The teacher ticks **each activity**; when all of a chapter's activities are ticked, the **chapter completes automatically**. The chapter itself is never clicked. Pages are meta, not tickable.

**The model — one node tree, per-plan layout.** Every subject is the same tree at different depth; depth + columns are data.

- **Per-plan component layout** — the plan (already `(year, grade, subject)`) stores its ordered list of **components** = the activity columns, read from the document header. No columns hardcoded.
- **Node tree** — generalize `syllabus_entry` with `parent_entry_id` + `component`:
  - `node_type in (unit, chapter, item, section, exam, revision, note)` (extends the current set).
  - `parent_entry_id` links `unit → chapter → item` (unit optional).
  - `heading` (title / cell content), `page_ref`, `month`, `seq`; `component` on items (which column); `theme` kept (GK).
  - An **item** (leaf) is one non-empty component cell. A **chapter** groups items and may span months (item carries its own month).
- **Coverage on leaves only** (`syllabus_progress` unchanged shape, keyed on the leaf `entry_id` + `class_id`). A parent's status is the **roll-up** of its leaves — computed, never stored, never directly marked.
- **GK = the degenerate case** — flat leaf topics (no components, depth 0), ticked directly. Existing GK plans + coverage are already exactly this, so they keep working **unchanged** (a subject whose layout has zero components).

**The three real shapes:** GK = flat leaves; Computer/English/Maths/Social Studies = chapter → items; EVS/Science = unit → chapter → items.

**Two specials:** **Reasoning** = three parallel tracks (`Verbal | Pages | Non-Verbal | Pages | Quantitative | Pages`) — a layout variant, handled explicitly. **Devanagari** subjects (Hindi/Vyakaran) = identical structure, Hindi text + month names — same engine + Hindi month aliases.

**Renders (all from the same data):**
- **Admin** — a grid: chapters × the plan's components; cells are item content. (Generated from the stored layout.)
- **Teacher (PWA)** — per chapter, a checklist of its item-leaves; ticking the last one auto-completes the chapter; subject % = chapters done. Reuses the batch-across-sections mark.
- **Student app** — month timeline; chapters with rolled-up covered/pending; tap to see activities. (Student-app UI is a separate session.)

Visual: artifact `syllabus-layout-model` (admin / teacher / student).

**Source Word doc.** Every plan **stores its source `.docx`** (`syllabus.source_file_id` → `file_storage`, same as model papers), so anyone can **download** the original Word. This is **in scope now** — the bulk import saves each doc as it parses it. **Uploading stays a manual process for now:** re-parsing a plan is done by re-running the CLI importer (not a self-service admin upload). The **self-service loop** — edit in Word → re-upload → server re-parses, and **download a blank template → fill → upload** — is a **later phase**.

**Schema delta (additive, backward-compatible):**
- `syllabus_entry` — add `parent_entry_id varchar(12)`, `component varchar(64)`; widen `entry_type` check to include `unit`, `item`, `chapter`.
- Per-plan layout — either a `syllabus_component (syllabus_id, key, label, seq)` table or an ordered JSON column on `syllabus`.
- `syllabus` — add `source_file_id varchar(12)` (later phase).
- `syllabus_progress` — unchanged; rows only ever on leaf entries. Roll-up is a query, not a column.

**Importer changes:** parse the wide `Month | Chapter | Pages | components…` template — read the header → the plan's component layout; carry-forward month + chapter across rows; each non-empty component cell → an item (heading = cell content, `component` = column, `page_ref` from the cell); `Unit:`/`Theme:`/`Topic:` → grouping nodes; `Revision`/`Periodic Test`/`Examination` → structural nodes; Hindi month aliases for Devanagari. Reasoning gets a dedicated path.

**Open points (to confirm before build):** structural rows (Periodic Test / Exam / Revision) tickable vs informational; whether students see item detail or just chapter status; exact treatment of Reasoning's parallel tracks.

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

## In-place update (reconcile) — Phase A

**Problem.** A revised document (minor changes) must be re-imported **without** losing
teacher coverage. Coverage (`syllabus_progress`) is keyed on `syllabus_entry_id`, so an
entry's uuid *is* its identity — the old delete-all + re-insert path (`bulk replace`,
`import-syllabus-v2`) orphans every mark. Reconcile updates matched entries **in place**
(uuid kept → marks preserved) instead.

**Match key (see the design note).** Title is the **primary** key; the chapter/topic
**number is only a tiebreak** (it drifts on insert). `page_ref`/`month` are **never**
matched on — they're updated in place. Matching is **hierarchical**: anchors (nodes with
children — chapters/sections/units) match first by normalized title; leaves then match
*within* a matched anchor by `(component, ordinal|normalized-text)` — page-only items
(`"7-14"`) and repeated components fall back to the ordinal. Three tiers: equal
`source_key` → exact normalized key → fuzzy (≥0.88 auto, [0.55,0.88) → a **proposal**
that needs confirmation). See `syllabus-match.ts`; `deriveTitleParts` keeps the GK
`topic_no`/title split so a re-import isn't a spurious title change.

**Files.** `syllabus-parse.ts` (buffer-based port of the v2 parser, Lambda-usable),
`syllabus-match.ts` (pure matcher → `DiffPlan`), `syllabus-reconcile-service.ts`
(preview + apply + revisions), `syllabus-reconcile-handler.ts` (admin/god-gated).

**Flow.** `POST /syllabi/{id}/reconcile/preview` (parse+match, no writes) → the admin-portal
plan page shows the diff (kept / new / removed / proposals) with a grade/subject sanity
check; the **one guardrail** is that a proposal or removal that would drop marks must be
explicitly resolved. `POST /syllabi/{id}/reconcile/apply` (with the human decisions) runs one
transaction: snapshot the plan → prune to last 10 → UPDATE kept (uuid kept, `source_key`
stamped) + INSERT new + soft-delete removed (and their progress) + resequence + store the new
`.docx`. `syllabus_progress` for kept entries is never touched.

**Revisions.** `syllabus_revision` snapshots the plan on every apply (entry tree + source
`.docx` + counts + an itemized `changes` list = what that reconcile added/removed/changed/
renamed), keeping the newest 10 (older pruned, orphan source files deleted).
`GET /syllabi/{id}/revisions` (with `changes`) + `GET /revisions/{id}/source` (download any).

**Restore is intentionally NOT a feature** (decided against reconcile-in-reverse). Rollback is
a manual, transparent step: each revision shows exactly what it changed and lets you download
its `.docx`; to roll back you download the version you want as the base, redo the edits you
want to keep, and re-upload it through the normal reconcile (same review + mark guardrail).

**Surface.** On the plan editor (admin/god): `Upload revised .docx` (inline diff → Apply) +
`Revisions` (expandable per-revision change list + Word download). No restore button.

## Handover checklist

- [ ] Deploy DB (`node modules/syllabus/scripts/db-setup.js --stage <stage> --action setup`).
- [ ] Admin-portal: subject catalog, plan builder (bulk paste of a sheet), and the per-section progress-marking screen.
- [ ] Student app: wire `GET /syllabus/me/timeline` into a scrollable month timeline anchored on the current month.
