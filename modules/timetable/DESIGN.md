# Timetable Module — Design

Auto-generating school timetable system. Configure the academic structure and
preferences, run a constraint solver as a background job, review several
candidate timetables, and publish one as the weekly master.

> Status: **Phases 1–2 built** (foundation CRUD + solver + job queue + generate/
> publish), test-backed. Not yet handed to a school. Phase 3 (live editing) is the
> only remaining piece; `validate-move` is already in place as its foundation.

## Why this is hard

Timetable generation is **NP-hard constraint satisfaction**. To guarantee no
teacher is double-booked, the *whole school must be scheduled together* — you
cannot solve one class at a time. A real solve can take seconds to minutes, so
it cannot run inside a normal request. The engine is a **deterministic solver**,
not an LLM (LLMs cheerfully double-book teachers); any LLM use is confined to
optional preference-capture/explanation and is not part of v1.

## Confirmed decisions

- The timetable module **owns the academic backbone** (subject, class↔subject
  demand, teacher assignment) — none of it existed in the DB before.
- **No rooms/labs** as a scheduling constraint in v1 — only teacher and class
  clashes. Rooms come later.
- **Full auto-solver** that produces several candidate timetables; the admin
  picks one.
- **Async generation** via a Postgres-backed job queue + a worker poller. No
  real Lambda today (runs locally under serverless-offline); the worker is a
  plain Node process. Moving to AWS later swaps only the trigger.
- The daily grid **varies by day** (e.g. Saturday differs). **Games and Library
  are subjects.** Fixed slots (assembly/break/lunch) sit **inside** the grid as
  reserved slots. Periods are **uniform length**; a "double" = two consecutive
  same-subject teaching slots.
- Block rules (e.g. "Physics XI = 10/week as two doubles + six singles") are
  **hard** constraints.
- One class+subject can be **split between two teachers** (`period_share`).
- Teacher constraints are **per-teacher** and individually **hard or soft**.
  Default: `unavailable_slot`/`day_off` hard, `preferred_slot` soft.
- **Class teacher (hard):** every class has a class teacher for the year
  (`class_teacher`). The **first teaching slot of every day** for a class is
  pinned to its class teacher, teaching one of the subjects they're assigned to
  that class. It counts toward that subject's weekly periods and doubles as
  attendance. **Which** subject is admin-selectable (`first_period_subject_id`);
  when unset it defaults to the class teacher's subject with the most periods/
  week. An invalid choice (not taught by the class teacher) falls back to that
  auto pick with a warning.
- **Teacher-less subjects:** a `class_subject` with **no** `teaching_assignment`
  is still scheduled — it books the class only (no teacher), e.g. a supervised
  study or library period. Its `timetable_entry.teacher_id` is null. Block rules
  apply as usual; two teacher-less periods never count as a teacher clash.
- **Electives / option groups (v1):** XI/XII use **real co-scheduled elective
  bands** (`elective_band` + `elective_offering`). Several subjects run in the
  **same** time slots, each with its own teacher; a student picks one, and the
  class books nothing else in those slots. This **supersedes** the earlier
  "elective = own class" simplification. (`class_group` stays defined for future
  cross-section banding; per-class bands cover v1.)
- **Combined periods** are **doubles** (two consecutive same-subject slots) with
  an optional **soft** placement hint (`prefer` in `block_rules`): the solver
  tries the preferred day/slot but may override it.
- **Saturday activity:** the last two Saturday slots are a fixed school-wide
  activity (`slot_type = 'activity'`) with **no teacher** — pure grid config the
  solver never fills.
- **Scoring/objective weights** are an input chosen **before** each generation
  run. Candidates differ by which trade-offs they favor.
- Scope = **one academic year**. By default all its classes solve **together**;
  optionally a **wing** (a named set of classes — primary/middle/senior, owned by
  the timetable module via `timetable_wing` / `timetable_wing_class`, the core
  `class` table untouched) scopes a run to just that subset. Wings are assumed
  **teacher-disjoint**: feasibility *warns* if a wing's teacher also teaches
  outside it but still generates (no cross-wing slot locking). Publishing is
  **per scope** — one active master per `(year, wing_id)`, so whole-school and
  per-wing masters coexist (a `null` wing_id is the whole-school master).
- Flow: candidate → published weekly **master** → (Phase 3) per-calendar-day
  **copies** that are individually editable. Substitute/absence cover is out of
  scope (the daily-copy layer is its future foundation).

## Build phases

A manual builder alone just reproduces what schools already do by hand, so it is
not a shippable release. Phases 1 and 2 ship **together** as the first trial.

1. **Foundation (not shipped alone):** subjects, class↔subject (weekly periods +
   block rules), teaching assignments, class teachers, elective bands +
   offerings, the day-varying grid config, teacher constraints, and the
   clash/constraint validator (reused later by live edit).
2. **First real release:** feasibility pre-check → auto-solver → candidates →
   scoring → publish a master.
3. **Later:** live editing of the published master + per-day copies.

## Data model

Per-school. Conventions: `varchar(12)` uuid PK, snake_case, status `check`
constraints, **no foreign keys**, no DDL defaults (set in app code), audit
columns, `school_id` on every row, partial unique indexes `where status =
'active'`. See `timetable-setup.sql` for the authoritative DDL.

**Academic backbone**
- `subject` — name, code, `kind` (`academic`|`games`|`library`|`activity`)
- `class_subject` — class_id, subject_id, academic_year_id, `periods_per_week`,
  `block_rules` (jsonb)
- `teaching_assignment` — class_id, subject_id, teacher_id, academic_year_id,
  `period_share` (null = all periods of that class+subject)
- `class_teacher` — class_id, academic_year_id, teacher_id (one per class/year);
  drives the daily first-period pin
- `elective_band` — class_id, academic_year_id, name, `periods_per_week`,
  `block_rules` (jsonb); a within-class parallel option block
- `elective_offering` — band_id, subject_id, teacher_id; one choice in a band.
  All offerings of a band are co-scheduled into the same slots
- `class_group` — future cross-section banding; v1 solver ignores it

**Grid (day-varying)**
- `timetable_config` — name, academic_year_id, status (`active`|`archived`)
- `day_structure` — config_id, `day_of_week` (1=Mon … 7=Sun)
- `time_slot` — day_structure_id, `sequence`, start/end time, `slot_type`
  (`teaching`|`assembly`|`break`|`lunch`|`reserved`|`activity`), label.
  `activity` = fixed, teacher-less, school-wide (e.g. last two Saturday slots)

**Teacher rules (per-teacher, hard/soft each)**
- `teacher_constraint` — teacher_id, academic_year_id, `constraint_type`
  (`max_per_day`|`max_consecutive`|`weekly_max`|`day_off`|`unavailable_slot`|
  `preferred_slot`), `value` (jsonb), `hardness` (`hard`|`soft`), `weight`

**Generation → candidates (the queue)**
- `generation_run` — config_id, academic_year_id, status
  (`queued`|`running`|`completed`|`failed`), `objective_weights` (jsonb),
  `num_candidates`, `progress`, `worker_id`, `heartbeat_at`, `attempts`,
  `error`, started/finished timestamps
- `timetable_candidate` — generation_run_id, `rank`, `score`, `score_breakdown`
- `timetable_entry` — candidate_id, class_id, subject_id, teacher_id,
  `day_of_week`, time_slot_id, `block_group_id` (ties a double together),
  `band_id` (nullable; ties an elective band's co-scheduled offerings — several
  entries share a class+day+slot only when they share a `band_id`)

**Publish (master)**
- `published_timetable` — academic_year_id, source_candidate_id, status
  (`active`|`archived`), `effective_from`
- `published_entry` — published_timetable_id + the `timetable_entry` shape
  (editable copy; also carries `band_id`)

*(Phase 3 adds `daily_timetable` / `daily_entry`.)*

### JSON shapes

```jsonc
// class_subject.block_rules (also elective_band.block_rules)
// must satisfy sum(size*count) == periods_per_week
{
  "blocks": [
    // optional `prefer` = soft placement hint (solver tries, may override)
    { "size": 2, "count": 2, "prefer": [ { "day": 3, "slot": 1 } ] }, // doubles
    { "size": 1, "count": 6 }
  ], // 10/week
  "maxPerDay": 2,
  "notTwiceSameDay": true
}

// generation_run.objective_weights — chosen per run
{ "minimizeTeacherGaps": 5, "honorSoftPreferences": 8, "evenDailyLoad": 3, "spreadAcrossWeek": 4 }
```

## API (camelCase JSON, ResponseBuilder)

- Subjects / class-subjects / teaching-assignments — CRUD
- Class-teachers — CRUD
- Elective-bands + nested elective-offerings — CRUD
- Config / day-structures / time-slots — CRUD
- Teacher-constraints — CRUD
- `POST /timetable/feasibility` — fast pre-check report
- `POST /timetable/generate` — inserts a run, returns `{ runId }` immediately
- `GET  /timetable/runs/{id}` — status + progress
- `GET  /timetable/runs/{id}/candidates` — list + per-class/per-teacher views
- `POST /timetable/publish` — `{ candidateId, effectiveFrom }`
- `GET  /timetable/published?academicYearId=` — active master + entries + grid config (for the admin-portal view)
- `POST /timetable/validate-move` — built now, powers Phase-3 live editing
- `GET  /timetable/health`

## Async execution (DB-as-queue, no AWS needed)

`generate` only inserts a `generation_run` row (`queued`) and returns fast. A
worker (`scripts/local/timetable-worker.js`, launched by `start:all`) loops:

```sql
update generation_run
set status = 'running', worker_id = $1, heartbeat_at = now()
where uuid = (
  select uuid from generation_run
  where status = 'queued'
  order by created_at
  limit 1
  for update skip locked
)
returning *;
```

`for update skip locked` makes concurrent workers safe. The worker writes
`progress` + `heartbeat_at`; a run stuck in `running` with a stale heartbeat is
reclaimable, so a crashed worker self-heals. On AWS later, only the trigger
changes (EventBridge/SQS/Fargate) — the queue table is the contract and the
solver code is untouched.

**As built:** the claim+solve logic lives entirely in the TS Lambda behind the
internal `POST /timetable/runs/process-next` endpoint (it runs the claim SQL,
loads the config, solves, writes candidates, marks completed/failed). The local
worker (`scripts/local/timetable-worker.js`, launched by `start:all` and hitting
the gateway) is a tiny JS poller that just calls that endpoint — this avoids
needing `ts-node` to run the solver outside the bundle, and keeps the AWS swap to
"replace the poller with a trigger." Tests drive `process-next` directly for
determinism instead of relying on the background poller.

## Solver (`solver/`, pure functions, no DB)

1. **`feasibility.ts`** — runs before solving: total demand vs teaching-slot
   capacity; per-teacher assigned load vs available slots after hard
   constraints. Returns **actionable** reasons ("Physics XI needs 10 periods but
   teacher X is only free for 6"). Also checks that **each class has a class
   teacher** with ≥1 matching `teaching_assignment`, and that the pinned
   subject(s) supply ≥ (number of teaching days) periods (the daily first-period
   pin consumes one per day); and that **each band offering's teacher** is free
   enough for the band's slots. Real school inputs are often over-constrained, so
   this is what prevents a frustrating blank result.
2. **`build-lessons.ts`** — expand each class_subject into lesson units per
   `block_rules` (a size-2 block = one unit needing 2 consecutive teaching
   slots); attach teacher(s) by `period_share`. Expand each `elective_band` the
   same way, but a band unit carries **all** its offerings (subject+teacher) and
   must be placed once, occupying the same slot(s) for every offering.
3. **`solve.ts`** — backtracking, most-constrained-first + forward checking
   enforces hard constraints (no class/teacher double-book, blocks don't cross
   non-teaching slots, maxPerDay, notTwiceSameDay, hard teacher constraints,
   **class-teacher first-period pin**, **band co-scheduling** — host class busy +
   every offering teacher busy for the band slots), then a local-search pass
   improves the soft score. N candidates from M seeded restarts, keep top-N
   distinct. Time-budget guard; no solution → infeasible + which lessons failed.
4. **`validate-timetable.ts`** — independent re-check of every hard rule
   (including the class-teacher pin and band rule: a class may hold multiple
   entries in one slot **only** when they share a `band_id`). Used in tests
   **and** by `validate-move`.
5. **`score.ts`** — weighted sum of soft metrics (teacher gaps, even daily load,
   week spread, honored soft prefs, **honored `prefer` block placements**);
   emits `score_breakdown`.

## Test plan

The solver is heuristic, so **don't assert exact output — validate it**: assert
that whatever `solve` returns passes the independent `validateTimetable`.

- **Unit (no server):** services + validation (period counts, block-rule
  parsing); the clash/constraint checker (hammered hard); `score` deterministic
  cases.
- **Solver (property-style):** synthetic scenarios → output passes the
  validator; hand-verifiable golden cases; infeasible scenarios return a clean
  reason (no hang/broken grid); seed determinism; perf budget (~20 classes / 40
  teachers / 6×8 grid).
- **Worker lifecycle:** enqueue → running → completed; failed path; stale-run
  reclaim.
- **Acceptance:** seed the school's real timetable; generate; compare to their
  hand-made grid; admin checklist (generate → review → publish → per-class /
  per-teacher views → no clashes → prefs honored).

**Handover bar:** validator-backed solver tests green + feasibility pre-check +
acceptance checklist on real seed data → **parallel-run pilot** (the school
keeps making the timetable by hand during the trial and compares).
