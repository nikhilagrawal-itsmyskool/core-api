# Assembly — Design

School morning-assembly planning: a per-wing **assembly plan** (a weekly template of what happens in assembly), authored as an unlimited-depth **tree of nodes** (blocks → segments → sub-segments → …) where each node carries a running-order position, guidance text, responsible people, resource links, and a set of weekdays it runs on. Weekday applicability **inherits down the tree** with a subset rule. **Special assemblies** for specific dates are authored by **cloning** the day's resolved tree into an independent, fully editable copy. A light **theme** ("value of the week") spans a date range alongside the tree.

> Status: **Backend built (Phases 0–7), not yet deployed to prod.** Schema (10 tables), plan/audience CRUD + publish, the recursive node tree with day subset+inheritance and append-only audit, special assemblies (day-filtered clone + independent edit), themes, `GET /resolve`, and the `/me/assembly` app surface are all implemented and covered by an integration suite (`__tests__/assembly.test.ts`, 12 tests). Applied to the **local** DB only. Execution ("assembly diary") and duty notifications remain deferred (schema-ready). Remaining: **prod DB setup + module deploy**, and the admin/app frontends.

## Scope boundaries

- **Plan/template first; execution later.** Phase 1 authors *what assembly should be*. A phase-2 "diary" (held/cancelled, actual conductor, remarks) is deferred; FKs and tables are shaped so it bolts on without migration.
- **Notifications deferred.** Responsible-person references are structured so the `communication` module can later remind an in-charge/anchor/performing-class of their duty. No notifications in v1.
- **No file storage.** Resources are text + links only. No document/attachment upload — by explicit choice.
- **No special-assembly recurrence in v1.** Special assemblies are per-academic-year snapshots, re-authored annually. A clone-from-another-date/year helper is a later convenience.
- **Students / employees / classes / academic years** are owned by their modules; assembly stores their uuids (no FKs) and denormalizes display names where useful (per house style).

## Confirmed decisions (from discovery)

1. **A "block" is a content phase of one assembly** (Opening / Presentation / Announcements / Closing). The tree describes the anatomy of a single assembly sitting, not a time bucket or a theme grouping.
2. **`days` on a node = recurring weekdays.** The tree is a **weekly template** that repeats every week. (Specific calendar dates are handled by special assemblies, not by tagging nodes with dates.)
3. **Weekday inheritance with a subset rule.** A node with no days inherits its parent's effective days. A node's explicit days **must be a subset** of the parent's effective days — a day outside the parent is **rejected at save**. No days anywhere up the chain = runs on **every** assembly day of the plan.
4. **Unlimited depth, one recursive table** (`assembly_node`, self-referencing `parent_id`). Block/segment/sub/sub-sub are UI labels by depth, not separate tables.
5. **Explicit `sort_order`** among siblings is the running order (source of truth). Optional `start_time` + `duration_minutes` are metadata for schools that want a clocked run-sheet.
6. **Three distinct guidance fields** — `expectation`, `recommendation`, `outcome` — all optional, alongside `title` and `description`.
7. **Responsible parties are multiple per node, each with a role label** (in-charge / anchor / performers / …), stored in a child table. Each is **polymorphic**: employee | class/section | student | free text. A node with no responsible rows **inherits the parent's whole set** (all-or-nothing: inheritance kicks in only when the node itself lists none).
8. **Multiple plans coexist, scoped by wing/grade-band.** Each plan targets an **explicit set of classes/sections** (uuids from the class module), validated so **no class belongs to two plans** in the same academic year.
9. **Draft → published lifecycle.** Only a published plan is "live". Editing happens on the draft; publishing snapshots it live. (Soft-delete is a separate `status`.)
10. **Special assemblies = snapshot & edit.** Creating one **clones** the resolved tree for that date into its own independent tree; all edits (replace a node/subtree, swap only the responsible person, add new nodes, remove/skip) are just ordinary tree edits on the copy. On its date it **replaces** the regular plan for that audience. No live link back to the template.
11. **Append-only audit** on node create/edit/delete/reorder (mirrors the attendance/transport audit pattern).
12. **App read surface.** The student/parent app reads today's/tomorrow's resolved assembly via `/me/assembly/*` endpoints (theme, performers, special notices).

## Resolved open questions (design calls made here)

- **Assembly weekdays** live **on the plan** (`assembly_plan_day`), not per-school — Primary and Senior may differ. This set is the ceiling the subset rule validates against; app defaults it to Mon–Sat.
- **Theme / value-of-the-week** is a first-class-but-light entity (`assembly_theme`): title + description + date range, orthogonal to the tree, informational only. `plan_id` nullable → null means school-wide (all plans that year).
- **Timing** — optional `start_time` (`varchar(8)`, `HH:MM`) and `duration_minutes` per node; nullable; ordering still driven by `sort_order`.
- **Resources** — repeatable child rows (`assembly_node_resource`: label + url + note), text/links only.
- **Special-assembly recurrence** — none in v1; re-authored per year.

## Data model

Conventions (per house style): all SQL lowercase, **no foreign keys**, **no DDL defaults** (defaults in app code), `varchar(12)` uuids via `generateShortUuid(12)`, `school_id` on every row, `status in ('active','deleted')` soft delete, audit columns (`createdby_userid`/`created_at`/`updatedby_userid`/`updated_at`), enums as `varchar + check`, uniqueness via **partial unique indexes** `where status = 'active'`. Weekday sets are stored as **child rows** (not arrays/bitmasks) so they're directly queryable; **absence of rows means "not set" → inherit/all**. DDL to live in `assembly-setup.sql` / `assembly-setup-rollback.sql`.

Weekday domain everywhere: `weekday in ('mon','tue','wed','thu','fri','sat','sun')`.

### Plan & audience

- **assembly_plan** — `academic_year_id`, `name`, `scope_label` (e.g. "Primary (I–V)"), `publish_status in ('draft','published','archived')`, `published_at`, `publishedby_userid`, `status in ('active','deleted')`. Unique `(school_id, academic_year_id, lower(name)) where status='active'`.
- **assembly_plan_class** — `plan_id`, `class_id`, denormalized `class_name`. Two unique indexes (both `where status='active'`): `(plan_id, class_id)` (no dup within a plan) and **`(school_id, academic_year_id, class_id)`** (a class belongs to at most one plan per year — the no-overlap guarantee).
- **assembly_plan_day** — `plan_id`, `weekday`. The weekdays this plan holds assembly (the subset-rule ceiling). Unique `(plan_id, weekday)`.

### The node tree

- **assembly_node** — one recursive table for **both** regular-template and special-assembly trees.
  - `owner_type in ('plan','special')` + `owner_id` (= `plan_id` or `assembly_special.uuid`). Exactly one owner; check enforces `owner_id is not null`.
  - `parent_id` (nullable → root), `sort_order integer not null`, `depth integer` (convenience for UI labels/queries).
  - Content: `title`, `description`, `expectation`, `recommendation`, `outcome` (title `varchar(160)`, rest `text`).
  - Timing (optional): `start_time varchar(8)`, `duration_minutes integer`.
  - `status in ('active','deleted')` + audit columns.
  - Indexes: `(owner_type, owner_id, parent_id, sort_order) where status='active'`; `(school_id, owner_type, owner_id)`.
- **assembly_node_day** — `node_id`, `weekday`. Explicit weekday set for a node; **no rows = inherit parent / all** (per resolution below). Unique `(node_id, weekday)`. Only meaningful on `owner_type='plan'` nodes (special-assembly trees are date-pinned, so their day rows are ignored by the resolver).
- **assembly_node_responsible** — `node_id`, `role varchar(48)` (label: in-charge/anchor/performers/…), `target_type in ('employee','class','student','text')`, `target_id varchar(12)` (uuid when type ≠ text), `target_text varchar(160)` (when type = text), denormalized `target_name`, `sort_order`. Check: `target_id` present for employee/class/student, `target_text` present for text.
- **assembly_node_resource** — `node_id`, `label varchar(160)`, `url text`, `note text`, `sort_order`. Text/links only.

### Special assemblies

- **assembly_special** — `academic_year_id`, `plan_id` (the plan whose day it replaces), `special_date date`, `title varchar(160)`, `description text`, `source in ('cloned','blank')` (how it was seeded), `publish_status in ('draft','published','archived')`, `status in ('active','deleted')` + audit. Unique `(school_id, plan_id, special_date) where status='active'` — one special assembly per plan per date. Its tree is the `assembly_node` rows with `owner_type='special'`, `owner_id = this.uuid`.

### Theme

- **assembly_theme** — `academic_year_id`, `plan_id` (**nullable** → null = all plans that year), `title varchar(160)`, `description text`, `start_date date`, `end_date date`, `status` + audit. Overlaps allowed; the resolver surfaces all active themes covering a date. Index `(school_id, academic_year_id, plan_id)`.

### Audit

- **assembly_node_audit** — append-only. `node_id`, `owner_type`, `owner_id`, `action in ('create','update','delete','reorder')`, `changed_field varchar(48)` (nullable — set for field-level updates), `old_value text`, `new_value text`, `changedby_userid`, `changed_at`. One row per changed field on update; single rows for create/delete/reorder. Index `(school_id, node_id)`.

## Resolution semantics

**How `assembly_plan_day` and `assembly_node_day` relate.** There is **no FK or join row** between them — the only connective tissue is `assembly_node.owner_id → assembly_plan.uuid` (for `owner_type='plan'`). `assembly_plan_day` is the **ceiling/universe** (the weekdays the wing holds assembly at all) and acts as the **virtual parent** of the root nodes: the day-resolution ladder walks a node's `parent_id` upward, and when it reaches a root with no explicit days it falls back to that plan's `assembly_plan_day` set. So plan-days seed the top of the same inheritance chain that node-days extend downward. (Special-assembly nodes, `owner_type='special'`, are date-pinned and ignore both tables.)

```
assembly_plan_day   = ceiling/universe (days the wing holds assembly)
       │  seeds the root's inherited default
       ▼
root assembly_node  → own node_day rows? yes → use them | no → use plan days
       │
       ▼
child assembly_node → own node_day rows? yes → use them | no → inherit parent
```

**Effective weekdays of a node** (regular template only):
1. If the node has explicit `assembly_node_day` rows → those are its effective days.
2. Else → inherit the parent's effective days (recurse up).
3. Root with no rows → the **plan's** `assembly_plan_day` set (i.e. "every assembly day").
- **Validation at save:** a node's explicit days must be a subset of its parent's effective days (root's ceiling = plan days). Reject otherwise. Because children are always ⊆ parent, a node is *shown on day D* iff D ∈ its effective days — no separate ancestor-presence check needed.

**Effective responsible set of a node:** its own `assembly_node_responsible` rows if any; else inherit the parent's whole set (recurse up); else none.

**Resolving "the assembly for plan P on date D":**
1. If an active **published** `assembly_special` exists for `(P, D)` → return its cloned tree (date-pinned; day rows ignored). Special **replaces** the regular plan.
2. Else → take plan P's published tree, keep nodes whose effective weekdays include `weekday(D)`, ordered by `sort_order` within each parent.
3. Attach effective responsible sets + resources per surviving node, and any active themes covering D.
4. `weekday(D)` must be in the plan's `assembly_plan_day` set, else there's no assembly that day.

**Resolving for a student/class on date D:** find the (single) plan whose `assembly_plan_class` set contains the student's class, then resolve as above.

## API (proposed)

Base path `/assembly`. All requests require `X-School-Code`; JSON is camelCase. Proposed ports: **3041/3042** local, **6041/6042** prod; gateway route `/assembly/*`.

- **Lookups**: `GET /lookups` (weekdays, responsible types, publish statuses).
- **Plans**: `POST /plans`, `GET /plans?academicYearId=`, `GET /plans/{id}`, `PUT/DELETE /plans/{id}`, `POST /plans/{id}/publish`. Class set: `PUT /plans/{id}/classes` (set + overlap validation), `GET /plans/{id}/classes`. Weekdays: `PUT /plans/{id}/days`.
- **Nodes**: `POST /plans/{id}/nodes` (create under a parent), `GET /plans/{id}/tree` (full tree), `GET /nodes/{id}`, `PUT /nodes/{id}`, `DELETE /nodes/{id}`, `PUT /plans/{id}/nodes/order` (reorder siblings), `PUT /nodes/{id}/days` (subset-validated). Responsible: `PUT /nodes/{id}/responsible`, resources: `PUT /nodes/{id}/resources`.
- **Special assemblies**: `POST /plans/{id}/specials` (clone that date's resolved tree, or blank), `GET /plans/{id}/specials?from=&to=`, `GET /specials/{id}` (+ its tree), `PUT/DELETE /specials/{id}`, `POST /specials/{id}/publish`. Its nodes reuse the `/nodes/*` endpoints (owner = special).
- **Themes**: `POST /themes`, `GET /themes?academicYearId=&planId=`, `PUT/DELETE /themes/{id}`.
- **Resolve**: `GET /resolve?planId=&date=` → the fully-resolved assembly for a date (special-or-template, effective responsible/resources, themes).
- **App (student/parent)**: `GET /me/assembly/today`, `GET /me/assembly/on?date=` → resolves via the caller's class → plan, published only, read-only shape.

## Cross-module access

- Reads `school`, `academic_year`, `class`, `employee`, `student` by uuid for validation and name denormalization.
- No writes to other modules in v1. (Phase-2 notifications would POST to `communication` with an `assembly_duty` template — deferred.)

## Deferred to phase 2 (schema-ready)

- **Execution / assembly diary**: per `(plan, date)` — held/cancelled + reason, actual conductor, remarks — with finalize + append-only audit, mirroring attendance/transport. Adds `assembly_session`/`_audit` tables; no change to phase-1 tables.
- **Duty notifications** via `communication` (remind in-charge/anchor/performing class). Needs an approved `assembly_duty` template.
- **Clone helpers**: seed a special assembly (or a whole plan) from a prior year/date.

## Test plan (when built)

Integration tests against the gateway: plan CRUD + publish; class-set overlap rejection across plans; weekday subset-rule rejection (child day outside parent) and inheritance (no-days → parent → plan ceiling); node tree create/reorder/delete + audit rows; responsible all-or-nothing inheritance and polymorphic targets; resource CRUD; special-assembly clone produces an independent editable tree; resolve returns special-over-template and applies effective responsible/resources/themes; `/me/assembly` resolves via class→plan and only sees published. Ports 3041/3042 local, 6041/6042 prod.

## Handover checklist

- [ ] Confirm proposed ports 3041/3042 (local) and 6041/6042 (prod) are free; add to `local.config.json`, gateway routes, and the CLAUDE.md port tables.
- [ ] Write `assembly-setup.sql` / `-rollback.sql` + `scripts/db-setup.js` (interactive + `--stage/--action`).
- [ ] Decide the default plan weekday set seeded in app code (proposed Mon–Sat).
- [ ] Confirm role-label vocabulary for responsible parties (free text vs. a suggested enum in `/lookups`).
- [ ] Frontend: tree editor (drag-reorder, per-node day chips with subset guard), plan class-picker, special-assembly "edit from today's template" screen.
