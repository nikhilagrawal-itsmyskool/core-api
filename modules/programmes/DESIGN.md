# Programmes — Design

A generic host for **developmental / co-curricular programmes** — a whole-school programme
is stored once as data and delivered to teachers through a single, simple interface:
**Class → Month → Theme → the monthly unit**. The first programme is **Spoken English &
Life Communication** (Nursery–XII). A future programme (e.g. Scout, Values, Life Skills) is
**another `programme` row + its content**, not a new module.

> Why a module, not part of `syllabus`.
> `syllabus` is subject-and-chapter driven (subjects, textbooks, chapters, exam blueprints,
> model papers, answer keys). A programme has none of those; it has its own frozen taxonomy
> (domains, skills, material types, developmental bands, observation levels) and its own
> governance. The overlap with `syllabus` is **pattern overlap, not data overlap** — so we
> **fork the patterns** (module scaffold, `parseGrade`, the ordered-content + per-scope
> overlay shape, the `.docx` parser, the `/me` read-surface shape) and own everything
> data-facing here. See "Reused from syllabus" below.

> Authority. This module implements the vendor's **frozen ERP specification** for the DBPASN
> Spoken English & Life Communication Programme (Nursery–XII, Session 2026–27). The spec is the
> *system authority*; the 15 class modules (`.docx`) are the *content authority*; the audit
> certifies both are freeze-ready. The spec's root entity is already a generic **`Programme`**
> ("One Programme → One Architecture → Progressive Complexity") — this module honours that:
> everything programme-specific (the 15 fields, 15 material types, 24 domains, ~40 skills,
> assessment bands) is **data, not code**.

## Status

- **Phase 1 — Content delivery (BUILT — backend; local-verified).** Programme + taxonomy
  masters (seeded), monthly units with the common 15-field content, monthly focus skills, the
  admin unit CRUD, and the teacher `Class → Month → Theme` reader (`/teach`). A `.docx` importer
  loads all 15 class modules, and each grade's source Word file is stored for **download / edit /
  re-upload** (re-upload overwrites content with a UI confirm). Verified locally against school
  SS1: **165 units across 15 grades + 15 source docs** imported clean; 21 tests pass (parser 7,
  util 5, integration 9). **Not yet deployed.** Remaining Phase-1 work: the admin-portal
  screens (editor + teacher reader page + Programmes hub route) — backend endpoints are ready.
  - Notes: (1) some class modules list a focus skill **"Responsiveness"** that isn't in the
    frozen §8 skill master — the importer reports it as unmatched and simply doesn't link it
    (the text still shows under F15); revisit if it should map to `Interaction`. (2) The
    `authz-policy` cross-repo parity test has **pre-existing** drift (`leave.*`/`documents.*`
    present in the admin-portal policy but absent from the backend copy) — unrelated to this
    module; `programme.*` was added identically to both sides.
- **Phase 2 — Teacher Support + Toolkit (designed).** Unit-linked 10 support blocks; T1–T16
  toolkit repository + linking. Quick Teach / Need Help / Learn More depth.
- **Phase 3 — Assessment (designed).** Per-student longitudinal observations, band-valid
  levels, `Not Observed / Insufficient Evidence` as a separate state, **batch section entry**,
  April baseline + February capstone evidence types, student development profile.
- **Phase 4 — Governance + reporting (designed).** Draft→Reviewed→Approved→Published→Archived
  workflow with role permissions, versioning + audit, coordinator/director coverage &
  progression dashboards, and **copy-forward** to the next academic year.

The data model below is laid out so Phases 2–4 are **additive** (new tables + additive columns),
never a rewrite of Phase 1.

## Scope boundaries

- **Programme is the root, and it is data.** Every masters row (`field_type`, `material_type`,
  `domain`, `skill`, `stage`, later `level`/`support_block`/`toolkit`) is scoped by
  `programme_id`. Launching Scout = seed a new `programme` + its masters + import its content.
  **No code change, no new module, no new deploy.** No self-service "create a programme" UI in
  Phase 1 — programmes are seeded by script (the agreed genericity boundary).
- **No grade entity** (same rule as `syllabus`). A `class` row is a *section* (`I-A`,
  `Nursery-A`); a unit attaches to a **grade string** = the class name with its trailing
  `-<section>` removed (`I-A` → `I`, `Nursery` → `Nursery`, `XII` → `XII`). Developmental
  metadata for a grade lives in `programme_stage` keyed `(programme, grade)`. Fork `parseGrade`
  from `syllabus-util.ts`.
- **Month granularity, April→March teaching order.** Units belong to an academic month, not a
  date. Core content is April–February; March is optional integration (per spec §5). Months are
  a code constant (as in `syllabus-constants.ts`), not a table.
- **Classes / students / academic years / files** are owned by their modules; this module
  stores their uuids (no FKs) and resolves names for display. Source `.docx` lives in the shared
  `file_storage` (`entity_type='programme_unit'`), same as `syllabus`/model papers.
- **Teacher-facing first.** Phase 1 ships the teacher reader + admin editor. A student/parent
  `/me` surface is a later, optional add (the spec is primarily teacher- and assessment-facing).

## Confirmed decisions

- **Generic model, seed by script** (agreed). Masters + content for Spoken English & Life
  Communication are loaded by `scripts/import-programme.js` from the 15 `.docx` class modules.
- **Content is a JSON document; vocabulary is tables** (the hybrid). A unit's 15 field contents
  and its focus-skill list are the *content* — always read/edited together, never referenced
  individually — so they live as `jsonb` **on the unit** (`fields`, `focus_skill_ids`), not as
  child rows. The controlled vocabulary (field types, material types, domains, skills, stages) is
  the *backbone* — small, stable, and the join target for later search/assessment/reporting — so
  it stays in **tables**. This honours spec §5 ("do not create 15 permanent content columns")
  without exploding one unit into ~20 rows: **165 JSON documents, not ~3,400 rows.** Field
  labels/order come from `programme_field_type` (the JSON stores only `code → content`);
  focus-skill names resolve from `programme_skill`.
- **One primary domain per unit; primary skill mandatory on atomic content** (spec §8/§9).
  Supporting skills / secondary domains are optional many-to-many links (Phase 2 content items).
- **Status stored from day 1, operated simply in Phase 1** (spec / Phase-1 plan §4). Units carry
  the full `status in (draft, reviewed, approved, published, archived)` enum now, but Phase 1
  only uses `draft`/`published`; the review/approve transitions + role gates land in Phase 4.
- **Taxonomy present in the backend from day 1, mostly invisible to the teacher** (Phase-1 plan
  §6). The domain/skill/material-type/stage masters are seeded and linkable now; the teacher UI
  just reads Class → Month → Theme → the 15 fields + focus skills.
- **Controlled taxonomy, duplicate-guarded** (spec §22). Domain/skill/material-type values come
  only from the seeded masters; creating near-duplicates (`Role Play` vs `Roleplay`) is
  prevented. Master edits are permission-controlled (Phase 4).

## Reused from syllabus (fork, not shared dependency)

| Need | Forked from |
|---|---|
| Module scaffold (serverless.yml, authorizer wiring, health, ports) | `modules/syllabus/*` |
| Grade-from-class (`parseGrade`, `gradeEquals`) | `syllabus-util.ts` |
| Ordered content + per-scope overlay **pattern** | `syllabus_entry` + `syllabus_progress` |
| `.docx` parsing starting point | `syllabus-parse.ts` |
| `/me` read-surface shape (later phase) | `syllabus-me-service.ts` |
| docx→pdf worker + LibreOffice layer (only if printable units wanted, later) | `syllabus-convert.ts` |

Everything else — tables, taxonomy, endpoints, teacher UI — is net-new and owned here.

## Data model (Phase 1)

Conventions: lowercase SQL, no FKs, no DDL defaults, `varchar(12)` uuids, `school_id` on every
row, `status in ('active','deleted')` soft delete, audit columns, enums as `varchar + check`,
uniqueness via partial unique indexes `where status='active'`. See `programmes-setup.sql`.

**Root**
- **programme** — `code` (e.g. `SELC`, `SCOUT`), `name`, `motto`, `philosophy`, `status`.
  Unique `(school_id, lower(code))`.

**Masters (seeded per programme; "rich backend, invisible to teacher")**
- **programme_field_type** — the monthly fields: `programme_id`, `code` (`F01`…`F15`), `name`,
  `seq`. For SELC: Theme, Life Connection, Learning Outcomes, Key Vocabulary, Sentence Frames,
  Model Conversation, Listening Task, Picture Talk, Story/Narration, Situational/Role Play,
  Think & Speak, Pair/Group Activity, Monthly Speaking Task, Teacher Guidance, Assessment.
  Unique `(programme_id, code)`.
- **programme_material_type** — `code` (`MT01`…`MT15`), `name` (Vocabulary, Conversation, Role
  Play, Story, Presentation, …). Unique `(programme_id, code)`. Fixed 15 for SELC (spec §7).
- **programme_domain** — `code` (`D01`…`D24`), `name` (Myself & My Identity … Career, Future &
  Independent Life). Unique `(programme_id, code)`. 24 for SELC (spec §9).
- **programme_skill** — `category` (Foundational / Thinking / Life / Advanced), `name`
  (~40 for SELC, spec §8). Unique `(programme_id, category, lower(name))`.
- **programme_stage** — one row per grade: `grade` (string, e.g. `Nursery`,`I`,`XII`), `seq`,
  `developmental_band` (Early Years / Primary Foundation / … / Senior Secondary),
  `master_focus` (e.g. "Interact → Narrate → Request → Explain"), `stage_emphasis`,
  `assessment_band` (`early` | `i_viii` | `ix_xii`, drives the valid observation levels in
  Phase 3). Unique `(programme_id, lower(grade))`. (Spec §4.)

**Content**
- **programme_unit** — the monthly unit, **one row = one whole teacher page**, one per
  `(programme, academic_year, grade, month)`. Columns: `programme_id`, `academic_year_id`,
  `grade`, `month` (april…march), `title` (the class-specific theme — kept verbatim, not
  normalised), `programme_focus`, `primary_domain_id`, `workflow_status` (draft…archived),
  `version`, `source_file_id` (the class-module `.docx`), and the two content JSON columns:
  - **`fields jsonb`** — the 15 field contents keyed by field code, e.g.
    `{"F01":"Myself, My School…","F04":"name, age, class…","F06":"A: What is your name?…"}`.
    Labels + display order come from `programme_field_type`, not the JSON.
  - **`focus_skill_ids jsonb`** — ordered array of `programme_skill` uuids (the 3–5 monthly
    focus skills, spec §16.1). Names resolve from `programme_skill`.

  Unique `(programme_id, academic_year_id, lower(grade), month)`. There is **no**
  `programme_unit_field` / `programme_unit_focus_skill` table — that content is the JSON above.
- **programme_source_doc** — the stored class-module `.docx`, **one per grade** (the 15 SELC
  files are per-grade: one file = one grade × 11 months). `programme_id`, `academic_year_id`,
  `grade`, `file_id` (→ shared `file_storage`, `entity_type='programme_source'`), `version`.
  Unique `(programme, year, grade)`. This is the downloadable document library — download the
  current Word file, edit it, re-upload, and the importer re-parses that grade's 11 units.

## Data model (later phases — designed, not built)

- **programme_content_item** (+ `_skill_link`, `_domain_link`) — atomic, searchable/teachable
  items under a field, each with a `material_type_id`, exactly one `primary_skill_id`, optional
  supporting skills / secondary domains, `status`. Enables search "all Role Plays for Class
  VIII", "Class VII financial communication" (spec §11, §23). Phase 2.
- **programme_support_block** — unit-linked 10 blocks (This Month's Goal, Before You Teach,
  Teacher Language Bank, …, Teacher Micro-Practice). Linked layer, **never a 16th field**
  (spec §12). Phase 2.
- **programme_toolkit** — T1–T16 teacher development modules (`code`, `title`, `tier`,
  `content`), linkable from a unit's "Learn More" (spec §13). Phase 2.
- **programme_level** — assessment levels per `assessment_band` (Early: Emerging→Developing→
  Secure; I–VIII: …→Consistently Demonstrates; IX–XII: …→Independent) (spec §15.2). Phase 3.
- **programme_observation** — per-student longitudinal evidence: `student_id`, `academic_year_id`,
  `class_section_id`, `unit_id`, `skill_id`, `evidence_type` (baseline/observation/monthly-task/
  capstone), `level_id` (band-valid), `support_level`, `quick_note`, `teacher_id`,
  `observation_date`. `Not Observed / Insufficient Evidence` is a **separate state**, never
  `Emerging`. Batch section entry writes many rows at once (spec §16). Phase 3.
- **programme_unit_revision** — unit snapshots for versioning + copy-forward
  (Copy Forward → Review → Modify → Publish; never silently overwrite last year) (spec §20.1).
  Phase 4. Fork the `syllabus_revision` shape.

## Endpoints (Phase 1)

Prefix `/programmes/*` (gateway route), ports **3057/3058** (local) · **6057/6058** (prod).

- `GET /health`
> All endpoint paths are RELATIVE to the module, which the gateway/custom-domain mounts under
> `/programmes/*`. So the "list programmes" endpoint is `catalog` (not `programmes`) — `/programmes/programmes`
> would be redundant. Paths below are the on-the-wire paths (with the `/programmes` prefix).

- `GET /programmes/health`
- `GET /programmes/lookups` — programmes + months + workflow statuses + assessment bands
- `GET /programmes/grades` — grades derived from base-class names, each with its sections
- **Programme catalog**
  - `GET /programmes/catalog` — the programme rows
  - `GET /programmes/catalog/{code}` — a programme + its seeded masters (editor dropdowns)
- **Units (admin content editor)**
  - `GET /programmes/units?programme=&grade=&month=&academicYearId=` · `GET /programmes/units/{id}`
  - `POST /programmes/units` · `PUT /programmes/units/{id}` · `DELETE /programmes/units/{id}` —
    create/edit/soft-delete a unit including its `fields` JSON, `focusSkillIds`, and
    `workflowStatus` (draft↔published in Phase 1). The whole page saves in one call (no separate
    field/focus-skill endpoints — they're columns on the unit).
- **Source documents** (store / download / re-upload)
  - `GET /programmes/sources?programme=&academicYearId=` — list the stored `.docx` per grade
  - `GET /programmes/sources/{grade}/file?programme=&academicYearId=` — download the Word file
  - `POST /programmes/sources/{grade}?programme=` — upload a new `.docx` (body `{ base64Data,
    fileName, academicYearId }`) → re-parse that grade's 11 units and **overwrite** each month's
    content wholesale, replace the stored file, bump `version`. The client shows a **"this
    replaces current content for Class {grade}"** confirm first. No content snapshot in Phase 1
    (the `unit_revision` safety net is Phase 4).
- **Teacher reader** (the outcome-delivering surface)
  - `GET /programmes/teach?programme=&grade=&month=&academicYearId=` → `{ programme, grade, month,
    monthLabel, unit: { title, programmeFocus, primaryDomain, focusSkills[], fields[] } | null }`
    — one page, 15 fields as cards (labelled/ordered from the field-type master), focus skills on
    top. Mobile-web friendly.

Reads require `programme.view` (teacher/admin/god); writes (unit create/update/delete, source
upload) require `programme.manage` (admin/god/programme-incharge). API is camelCase
(auto-transformed from snake_case by `shared/lib/db.ts`).

## Content import

`scripts/import-programmes.js --stage <stage> --school <CODE> --dir <docx-folder> [--year <uuid>]`
seeds the SELC masters (`programmes-selc-seed.js`) then parses the 15 class-module `.docx` files
via the shared parser `programmes-parse.js`. The documents are highly regular:

- Split on `MONTH — Theme` headers (`APRIL — …` … `FEBRUARY — …`) → one **unit** per (grade, month).
- Within a month, split on the numbered field headers `1. Theme` … `15. Assessment / Observation`
  → map to `F01`…`F15` → the unit's **`fields`** JSON (value = everything under the heading).
- Unit `title` = the text under `1. Theme`; `programme_focus` from the class "Programme Focus";
  `focus skills` from the month's "Focus Skills" block → matched against seeded `programme_skill`.
- Store the source `.docx` in `file_storage` + a `programme_source_doc` row (per grade); stamp
  each unit's `source_file_id`. The same parser backs both the CLI import and the self-service
  re-upload endpoint (`POST /programmes/{code}/sources/{grade}`) — re-parse overwrites the
  grade's 11 units in place (upsert by month), so no row-fingerprint matching is needed.

Scale: 15 grades × 11 months ≈ **165 units** (one JSON document each). One-time import + QA
against the source docs (re-runnable; upsert by `(programme, year, grade, month)`).

## Non-goals (Phase 1) / Do-not-build (spec §30)

- No separate architecture per class band; no new Material Type for Debate/Discussion/
  Negotiation/etc. (those are Skills).
- No grammar/vocabulary sub-curriculum; no CEFR labels.
- No averaged percentage/proficiency score from ordinal observation levels; no student
  "weak/strong" labels; no teacher ranking from toolkit use.
- No hardcoded class names or session years in application logic.
- No self-service programme-designer UI (seed by script).
- No student/parent `/me` surface yet; no media library; no approval workflow yet.

## Open items to confirm before build

- **Programme code + display name** — proposed `SELC` / "Spoken English & Life Communication".
- **Authz actions** — reuse the central `requireAction`/`guard` pattern: `programme.content.edit`
  (admin/god) vs `programme.teach` (teacher, read). To wire when handlers are built.
- **Early-years variance** — confirm Nursery/LKG/UKG docs carry the same 15 fields (audit says
  yes); the importer will flag any month missing a field for manual review.
