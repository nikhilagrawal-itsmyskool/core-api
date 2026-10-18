# Proposed permission catalogs — FOR REVIEW before build/deploy

Strict `module.resource.action`. Pattern per module: god Permissions grid + temporary-teacher
grant panel; admin + the module's in-charge keep their `module.*` wildcard; teachers get
read-only only where they already have a read today (preserve, don't expand); everything else
god-first. **Nothing here is built or deployed yet — review the action names first.**

Legend for teacher column = what the `teacher` role would hold (today's teacher grants in parens).

---

## asset  (no teacher access today → none)
Handlers: asset-handler (tree/items/counts/moves/responsibility), asset-type-handler, asset-lookup.
| Action | Covers |
|---|---|
| `asset.register.view` | Tree, search, counts, summary, responsibility, movements + lookups |
| `asset.register.manage` | Create/edit/delete/move/individualize assets, set responsibility |
| `asset.type.view` | The per-school asset-type master (read) |
| `asset.type.manage` | Create/edit/delete asset types |
Teacher: **none**. Grid rows: admin, assets-incharge.

## library  (teacher has `library.view` today → `library.catalog.view`)
Handlers: work, copy, circulation, fine, policy, label, lookup.
| Action | Covers |
|---|---|
| `library.catalog.view` | Browse works/copies, labels, lookups |
| `library.catalog.manage` | Create/edit works, copies, print labels |
| `library.circulation.view` | View issues/returns/renewals |
| `library.circulation.manage` | Issue / return / renew |
| `library.fine.view` | View overdue/lost fines |
| `library.fine.manage` | Waive / collect library fines |
| `library.config.view` | Read circulation policy + per-school lookups |
| `library.config.manage` | Edit circulation policy + lookups (the Settings screen) |
Teacher: **`library.catalog.view`**. Grid rows: admin, library-incharge, teacher.

## supplies  (teacher has `supplies.view` today → inventory.view + issue.view)
Handlers: category, item, purchase-batch, issue, wastage, lookup.
| Action | Covers |
|---|---|
| `supplies.category.view` / `.manage` | Per-school supply categories (setup) |
| `supplies.inventory.view` / `.manage` | Supply items + lookups |
| `supplies.purchase.view` / `.manage` | Bulk purchases / batches / bills |
| `supplies.issue.view` / `.manage` | Issue log |
| `supplies.wastage.view` / `.manage` | Wastage log |
Teacher: **`supplies.inventory.view` + `supplies.issue.view`**. Grid rows: admin, supplies-incharge, teacher.

## uniform  (no teacher access today → none)
Handlers: item, purchase, set, sale, lookup, stats.
| Action | Covers |
|---|---|
| `uniform.inventory.view` / `.manage` | Items + lookups + stats |
| `uniform.purchase.view` / `.manage` | Purchases |
| `uniform.set.view` / `.manage` | Priced sets |
| `uniform.sale.view` / `.manage` | Sales / assignment |
Teacher: **none**. Grid rows: admin, (uniform has no dedicated incharge role — just admin/god).

## shop  (no teacher access today → none)
Handlers: intake, item, purchase, set, sale, lookup, stats.
| Action | Covers |
|---|---|
| `shop.inventory.view` / `.manage` | Items + lookups + stats |
| `shop.purchase.view` / `.manage` | Purchases + set-intake |
| `shop.set.view` / `.manage` | Priced sets |
| `shop.sale.view` / `.manage` | Sales / assignment |
Teacher: **none**. Grid rows: admin.

---

## Needs a design pass + your input (NOT proposed yet — too much judgement to guess)
- **fine** (disciplinary incidents: incident/collection/evidence/note) — likely `fine.incident.{view,manage}` + `fine.collection.{view,manage}`.
- **hiring** (candidate/stage/file) — likely `hiring.candidate.{view,manage}` (+ stage?).
- **assembly** — large (16 handlers: plan/node/special/theme/week, grading/house, duties/checklist, pulse). Needs careful resource modelling + `assembly.config.manage` for AssemblySettings.
- **homework** — `homework.{post,manage}` today; map the /me conduct surface vs admin override.
- **academic-calendar** — `academic-calendar.{view,manage}` today (teacher has view); may add `academic-calendar.config.manage` for the type master + holidays/closure.
- **Backfill (already guarded, just add grid+panel):** transfer, employee, communication, assistant, student, transport, timetable, feedback, syllabus, programmes (+ `programmes.config.manage`).

> Review the action names above (especially the resource split), correct anything that breaks
> the `module.resource.action` convention, and I'll build + deploy the approved ones.

---

## READY FOR REVIEW — assembly, programmes, class/academic-year (2026-10-17)

### assembly (✅ homework + academic-calendar now DONE; these are the last unguarded ones)
~96 endpoints, 15 handlers. Student app (`me.today`, `me.on`, duties `leaderboard`) uses the
student token → **PUBLIC**. Everything else is staff. `assembly.view`/`assembly.manage` already
exist and are wired in the portal; proposal keeps them and ADDS two leaves.

| Action | Covers | Roles |
|---|---|---|
| `assembly.view` | all staff reads: lookups, pulse, plan/node/special/theme (get/list/tree), weeks (list/get), references (list/file), checklist (items/week), grading (rubric/evaluators/grades/leaderboard read), houses (read), resolve, documents (list/file) | admin, teacher, assembly-incharge, education-director |
| `assembly.manage` | all admin authoring + workflow: plan CRUD/publish/clone/setClasses/setDays, node tree CRUD/reorder/responsible/resources/dayContent, special CRUD/publish, theme CRUD, week ensure/saveRoster/approve/recall/lock/unlock, references add/update/remove, checklist master CRUD + saveTicks/signoff/clearSignoff, grading metric/penalty/evaluator CRUD + saveGrade/deleteGrade, house rotation/setWeekHouse, documents upload/remove | admin, assembly-incharge, education-director |
| `assembly.conduct` *(NEW)* | the teacher duty `/me` surface: duties list/getWeek/saveRoster/submit/recall/references/checklist/saveChecklist/signoff/ensureWeek/getGrades/saveGrade (run my assigned assembly week) | teacher, admin, assembly-incharge |
| `assembly.config.manage` *(NEW, god-first)* | module config: house `setConfig`, grading `setConfig` (the rubric framing) | god (grant to others via grid) |
| PUBLIC | health, `me.today`, `me.on`, duties `leaderboard` (student app) | — |

Open question: `assembly-incharge` currently holds `assembly.*` (wildcard) → that would also grant
`assembly.config.manage`. Keep the wildcard (incharge = module owner, gets config too), or narrow
incharge to explicit `view+manage+conduct` so config stays strictly god-first?

### programmes (SELC etc.) — namespace is singular `programme.*` today
All 14 endpoints are staff (`resolveSchool`) — NO student-token endpoints. `SelcSettings.jsx`
makes no backend call, so `programme.config.manage` is a **grid + frontend visibility gate only**
(no endpoint to guard).

| Action | Covers | Roles |
|---|---|---|
| `programme.view` | getLookups, getGrades, programme list/getByCode, unit list/getById, source list/download | admin, teacher, programme-incharge, education-director |
| `programme.manage` | programme.update, unit create/update/remove, source upload | admin, programme-incharge |
| `programme.teach` *(NEW?)* | unit `teach` (mark a unit taught) — a teaching-staff action | teacher, admin, programme-incharge |
| `programme.config.manage` *(NEW, god-first, frontend-only)* | reveal/manage SelcSettings | god |

Open question: is `teach` really a teacher action (every teacher can mark taught), or admin-only?
And confirm singular `programme.config.manage` (to match existing `programme.view`), not plural.

### class / academic-year (tiny read-only lookups)
`class.search`, `class.streams`, `academic-year.search` — dropdown feeders consumed by MANY
modules' screens under whatever role the user holds (admin, every *-incharge, manager,
education-director, teacher…). Gating them with a `.view` action means that action must be granted
to nearly every role or dropdowns break. Three options:
  (a) **leave authenticated-only** — add them to the coverage test as all-PUBLIC (any valid JWT,
      incl. student token, can read class/AY names+uuids; lowest risk, no behaviour change);
  (b) gate with `class.view` / `academic-year.view` granted to all employee roles (not students);
  (c) skip entirely (don't add to the rollout).
