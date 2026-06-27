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
  (`class_teacher`). The **first teaching slot of a day** for a class is
  pinned to its class teacher, teaching one of the subjects they're assigned to
  that class. It counts toward that subject's weekly periods. **Which** subject is
  admin-selectable (`first_period_subject_id`); when unset it defaults to the class
  teacher's subject with the most periods/week. An invalid choice (not taught by
  the class teacher) falls back to that auto pick with a warning.
  - **Per-weekday pin (`first_period_days`):** the first-period pin applies only on
    the listed weekdays (1=Mon..7=Sun). `null` = all teaching days (the original
    behavior); `[]` = the class teacher takes no first period (they float among
    their normal periods). On a non-pinned day the first teaching slot is left open
    for the solver to fill with any subject/teacher — this covers the real case
    where a class teacher takes the first period most days but not all.
- **Registration / 0th period (`slot_type = 'registration'`):** a pre-period
  attendance slot that is **always** the class teacher, on **every** teaching day,
  for every class with a class teacher. It carries **no subject** (does not consume
  any subject's weekly periods) and is **not** solved — it is written
  deterministically as `timetable_entry`/`published_entry` rows with
  `subject_id = null, teacher_id = class teacher`. Because the grid is school-wide
  and a slot sequence is unique per day, a registration slot never coincides with a
  teaching slot, so it can never clash with the solved grid; the one config error
  it can surface — a teacher who is class teacher of two classes sharing the slot —
  is reported by feasibility. By convention assembly = sequence -1, registration =
  sequence 0, teaching periods = 1..N (non-positive sequences are allowed).
- **Teacher-less subjects:** a `class_subject` with **no** `teaching_assignment`
  is still scheduled — it books the class only (no teacher), e.g. a supervised
  study or library period. Its `timetable_entry.teacher_id` is null. Block rules
  apply as usual; two teacher-less periods never count as a teacher clash.
- **Electives / option groups (v1):** XI/XII use **real co-scheduled elective
  bands** (`elective_band` + `elective_offering`). Several subjects run in the
  **same** time slots, each with its own teacher; a student picks one, and the
  class books nothing else in those slots. This **supersedes** the earlier
  "elective = own class" simplification. (`class_group` is the hook for **composite
  classes / cross-section co-scheduling** — see that section below; per-class bands
  remain the v1 default.)
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

## Composite classes (cross-section co-scheduling)

> Status: **built.** Captures a real senior-school case (XI-A) the original per-class
> model could not express. The whole feature reduces to one primitive: **a lesson may
> occupy more than one class** (book several classes' slots at the same time, booking
> each teacher only once). Implemented as an optional `Lesson.classIds`/`Placement.classIds`
> (`solver/types.ts` `classesOf()`); a cohort = `class_group` (member classes carry
> `class.class_group_id`); an `elective_band.class_group_id` makes a band span the cohort.

**The case (XI-A).** One class hosting two streams — **Science** + **Commerce** — that are
partly taught together, partly split:

- **Two class teachers** (one homeroom each, each with its own registration / first-period).
- **Shared singles:** English (8) and Music/Dance (1) — one combined lesson, **one teacher**,
  both streams in the room together.
- **Cross-stream elective bands:** Maths/Bio/Accounting (9) and CS/Painting/Hindi (6) — three
  parallel rooms each, any student of either stream opts into one room.
- **Stream-specific subjects** with **unequal** weekly counts: Science = Physics 8 / Chem 8 /
  PE 6; Commerce = Business 7 / Economics 7 / Applied Maths 8.

Weekly structure — both streams total **46** periods (= the grid):

| Together (24) | per | Science split (22) | per | Commerce split (22) | per |
|---|---|---|---|---|---|
| English (shared)       | 8 | Physics    | 8 | Business Studies | 7 |
| Maths/Bio/Acc band     | 9 | Chemistry  | 8 | Economics        | 7 |
| CS/Painting/Hindi band | 6 | PE         | 6 | Applied Maths    | 8 |
| Music/Dance (shared)   | 1 |            |   |                  |   |

**Why v1 can't do it:** one `class_teacher` per class (two homerooms ⇒ two classes); elective
bands are single-class and equal-length (`build-lessons.ts`); a `Lesson`/`Placement` has a
single `classId` and books only that class (`solve.ts` `classBusy` key
`"${classId}|${day}|${seq}"`), so "taught together across two classes" has no representation;
and the unequal stream parallels (Physics 8 ∥ Business 7) can't be equal-length bands.

**Model:** two co-scheduled classes — `XI-A (Science)`, `XI-A (Commerce)` — grouped in a
`class_group` cohort. Map the 24 "together" slots to **cross-class lessons attached to the
cohort**; leave the stream subjects as ordinary per-class `class_subject`s:

| XI-A element | Construct |
|---|---|
| English 8, Music 1 (together) | cross-class **shared single** (1 offering / 1 teacher, books both classes) |
| Maths/Bio/Acc 9, CS/Painting/Hindi 6 | cross-class **elective band**, N offerings, spans both classes |
| Physics/Chem/PE | per-class `class_subject` on `XI-A (Science)` |
| Business/Econ/Applied-Maths | per-class `class_subject` on `XI-A (Commerce)` |

**Why this also dissolves the unequal-parallel problem:** once the 24 together-slots are
booked across both classes at **identical** positions, the remaining 22 slots are by
construction the **same free window** in both classes — each stream then fills its own 22
independently (Physics/Chem/PE vs Business/Econ/Applied-Maths). The unequal counts never need
pairing; we co-lock the shared portion and let each stream fill the rest. The two homerooms
stay in sync automatically.

**Data-entry model** (split by *where* a thing is taught — never duplicated per class):

| What | Entered against | Mechanism |
|---|---|---|
| Shared single (cohort together) | **Cohort** (once) | shared subject / band-of-one |
| Cross-stream band (any student opts) | **Cohort** (once, N offerings) | `elective_band` with `class_group_id` |
| Stream-specific subject | **Each member class** | `class_subject` + `teaching_assignment` |
| Class teacher | **Each member class** | `class_teacher` |

CS/Painting/Hindi = **one** band on the cohort, **6 combined periods**, three offerings
(CS→A, Painting→B, Hindi→C): one entry reserves the **same 6 slots in both** classes, runs 3
rooms in parallel, spends **6** of each class's 46-period budget — *not* 6×3, *not* entered
twice. **Anti-pattern:** entering the three subjects separately in each class (two
disconnected bands that won't co-locate and can't mix students/teachers across streams).
Period accounting per member class: **24 shared + 22 own = 46**.

**Capability outline (the build):**
- *Data model (additive, no FKs):* tag member classes via the existing `class.class_group_id`;
  add nullable `elective_band.class_group_id` (set ⇒ band spans the group's active classes;
  `class_id` kept for v1 single-class bands — backward compatible). Shared singles reuse the
  band mechanism (a one-offering band over the group) unless a dedicated "shared subject"
  marker is preferred (decide at build). Constraint: a cohort's classes must share the **same
  grid config + academic year**, enforced in feasibility.
- *Solver:* `Lesson.classId`/`Placement.classId` → `classIds: string[]`; `solve.ts`
  `apply`/`canPlace`/`undo` loop `classBusy` over every `classId` (teacher booking unchanged —
  once per slot regardless of class count); `build-lessons.ts` emits one lesson carrying the
  group's `classIds`; the loader expands a `class_group_id` band to its class ids.
- *Validator:* class-double-book check loops `p.classIds`; the band exception (offerings share
  `band_id`) is unaffected.
- *Entry writing:* `writeCandidates` fans a cross-class lesson out to one `timetable_entry`
  per **class × offering × slot** (sharing `band_id`/day/slot); `class_id` stays single-column.
- *Feasibility:* per-class demand/capacity unchanged (a shared lesson counts once per class it
  touches); add the same-config/same-year cohort check.

**Rollout (sequenced after the build):** the school first entered XI-A as a single class. Do
**not** re-model until the feature exists (else the solver schedules the two classes
independently — English placed twice, bands not co-located). Migration = **reuse the existing
row as Science** (the `class` table has no `status` column, so reuse/rename beats delete):
rename `XI-A` → `XI-A (Science)` (keep uuid + class teacher + Physics/Chem/PE); create
`XI-A (Commerce)` + its teacher + its subjects; create the `class_group` and tag both classes;
move the shared items (English/Music/the two bands) onto the cohort. Items leaving the old
single class are soft-deleted (`status='deleted'`) on `class_subject` / `teaching_assignment` /
`class_teacher` / `elective_band` + `elective_offering`, scoped by
`class_id + school_id + academic_year_id`, run via `scripts/run-sql.js`.

**Verification (build):** a solver test reproducing XI-A (two classes in a cohort, two shared
singles, two cross-class bands, the stream subjects) whose output passes `validateTimetable`,
with the shared lessons at **identical** day/slot in both classes and no teacher double-booked.

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
- `class_teacher` — class_id, academic_year_id, teacher_id (one per class/year),
  `first_period_subject_id` (nullable), `first_period_days` (jsonb weekday list,
  null = all teaching days); drives the daily first-period pin and the registration
  (0th-period) attendance booking
- `elective_band` — class_id, academic_year_id, name, `periods_per_week`,
  `block_rules` (jsonb); a within-class parallel option block
- `elective_offering` — band_id, subject_id, teacher_id; one choice in a band.
  All offerings of a band are co-scheduled into the same slots
- `class_group` — cohort of co-scheduled classes that powers **composite classes**
  (see section below); member classes carry `class.class_group_id`, and an
  `elective_band.class_group_id` makes a band span the whole group

**Grid (day-varying)**
- `timetable_config` — name, academic_year_id, status (`active`|`archived`),
  `locked_at`/`lockedby_userid`. **Lock lifecycle:** a config is a **draft**
  (`locked_at` null, freely editable) until **locked**; only a **locked** config can
  be generated, and a locked config is **immutable** (day/slot edits rejected — rename
  and archive still allowed). **Unlock** is permitted only while no `generation_run`
  references it; once generated/published it's permanently locked and revision is via
  **clone** (`POST /configs/{id}/clone` deep-copies days+slots into a new draft). This
  guarantees published timetables never desync from a later grid edit.
- `day_structure` — config_id, `day_of_week` (1=Mon … 7=Sun)
- `time_slot` — day_structure_id, `sequence` (any integer; non-positive allowed so
  assembly = -1 and registration = 0 sit before period 1), start/end time,
  `slot_type` (`teaching`|`assembly`|`break`|`lunch`|`reserved`|`activity`|
  `registration`), label. Only `teaching` is filled by the solver; the rest are
  fixed scaffolding (and barriers a double can't span). `activity` = fixed,
  teacher-less, school-wide (e.g. last two Saturday slots). `registration` = the
  0th attendance period, booked deterministically by each class's class teacher
  (no subject); `timetable_entry.subject_id` is nullable to hold it.

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
  "maxPeriodsPerDay": 2 // HARD cap on periods/day for this subject (a double = 2). Default 2 (applied in the solver).
  // "maxPerDay" / "notTwiceSameDay": deprecated (still read for old data; no longer set by the UI)
}
// Per-day spread: "aim for one slot/day" is a SOFT preference, always on, via the
// score.ts `spreadAcrossWeek` metric (a double counts as one placement). The hard
// ceiling is maxPeriodsPerDay (default 2). A subject needing more than
// maxPeriodsPerDay × teaching-days/week is reported infeasible.

// generation_run.objective_weights — chosen per run
{ "minimizeTeacherGaps": 5, "honorSoftPreferences": 8, "evenDailyLoad": 3, "spreadAcrossWeek": 4 }
```

## API (camelCase JSON, ResponseBuilder)

- Subjects / class-subjects / teaching-assignments — CRUD
- Class-teachers — CRUD
- `POST /timetable/clone-class-setup` — `{ sourceClassId, targetClassId, academicYearId }`
  deep-copies a section's academic setup (class subjects, teaching assignments,
  elective bands+offerings) onto another section in the same year. The **class teacher
  is not copied** — it is the per-section difference, so the admin sets it on the target
  (which may already be set before cloning). Mints new uuids; **rejects** if the target
  already has any cloneable setup (class subjects / assignments / bands — class teacher
  ignored). For near-identical sections (e.g. two VIII), set one up and clone the rest.
- Class-groups (cohorts) — CRUD (`/class-groups`); membership is `class.class_group_id`
- Elective-bands + nested elective-offerings — CRUD; a band targets **either** `classId`
  **or** `classGroupId` (cohort band co-scheduled across the group)
- Config / day-structures / time-slots — CRUD
- `POST /timetable/days/{dayId}/clone-slots` — `{ sourceDayId }` copies every slot
  from another day of the same config onto this day. Target must be empty (the UI
  only offers it on a slot-less day); rejects a non-empty target, a locked config,
  cross-config or self source. Lets an admin set one day up and clone it to the rest.
- `POST /timetable/configs/{id}/lock` · `/unlock` · `/clone` — config lock lifecycle
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
  - **Scale profile (`__tests__/solver-scale.test.ts`, opt-in via `RUN_SOLVER_SCALE=1`):**
    a feasible full-school instance — 25 classes / 50 teachers / 50 subjects /
    6×10, 1200 lessons, 20% slack. **Correctness holds** (complete, clash-free,
    pins honored). **Performance is the constraint** (production `SOLVE_TIME_BUDGET_MS`
    is 45s):
    - *friendly* (no electives/constraints): solves ~15–25s → ~2× margin.
    - *stressed* (5 elective bands + 22 hard teacher day-off/unavailable constraints):
      solves ~25–35s → margin shrinks to ~1.3×.
    Realistic electives + teacher constraints cost ~10s and eat most of the budget;
    a bigger/more-constrained 25-class school would likely exceed 45s and return
    blank — **revisit solver perf (or raise the budget) before onboarding large
    schools.**
- **Worker lifecycle:** enqueue → running → completed; failed path; stale-run
  reclaim.
- **Acceptance:** seed the school's real timetable; generate; compare to their
  hand-made grid; admin checklist (generate → review → publish → per-class /
  per-teacher views → no clashes → prefs honored).

**Handover bar:** validator-backed solver tests green + feasibility pre-check +
acceptance checklist on real seed data → **parallel-run pilot** (the school
keeps making the timetable by hand during the trial and compares).
