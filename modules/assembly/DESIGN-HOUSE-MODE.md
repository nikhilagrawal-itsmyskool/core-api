# Assembly — House Mode (finalized plan)

A major, **optional** extension: a per-school **`assembly_mode`** switches between the
existing **`template`** model (small schools — plans + tree + resolve, unchanged) and
the full **`house`** model (rotating houses author a **weekly roster** within the
template guideline, with a finalize/approve workflow, a stored checklist, and
evaluator **grading** → weekly average → **house-of-the-month**).

> Source of truth: four requirement docs (Assembly New / Advance Roster / House
> Execution Check List / Comprehensive Grading Log). This file is the agreed model.

## Coexistence (no forking, no bloat)
- **One shared template.** The block→segment→sub-segment tree + per-weekday content is
  the same in both modes. The roster is an **overlay keyed to (week, day, node)** that
  *fills* slots — it never clones/forks the tree.
- **Per-node `fill_mode` (`auto` | `roster`)** on `assembly_node`. `auto` = fixed
  template content (Pratah Smaran); `roster` = a slot the house fills weekly (the
  `-----` rows + optional segments). **Ignored in `template` mode.**
- **House machinery is inert for template schools** — houses/roster/checklist/grading
  tables stay empty, menus hidden. Zero added surface.
- `G1` (dated plans) stays a general capability; **`G2` per-node rotation is the
  *template-mode* way to vary responsibility**, while **house-mode takes responsibility
  from the roster** — the resolver picks its source from the mode flag, so they never
  collide.

## Mode & rollout
- `assembly_school_config(school_id pk, mode 'template'|'house', rotation_anchor date, ...)`. Default `template`. DBPASN → `house`.

## Houses & rotation (reuse the student-module houses)
- Extend the existing house (students already belong) — do NOT duplicate:
  - `assembly_house_meta(house_id pk, school_id, incharge_id, coincharge_id, rotation_order int)`.
  - `assembly_house_teacher(uuid, school_id, house_id, employee_id, status)` — member teachers.
- **Rotation**: one house per **calendar week** (Mon-anchored), auto-cycle by
  `rotation_order` from `rotation_anchor`. Holidays ignored (count calendar weeks).
  - `assembly_week_house(school_id, week_start, house_id|null)` — manual override for a
    week (null = "no house / skip"); an override does NOT shift the cycle.
  - Effective house for a week = override if present, else `houses[weekIndex % n]`.
- Supports N houses (not hardcoded to 4).

## Weekly roster (the instance)
- `assembly_week(uuid, school_id, week_start, house_id, academic_year_id, status
  'draft'|'submitted'|'approved', submittedby/at, approvedby/at, locked bool,
  deadline_at, ...)`. Approved ⇒ locked.
- `assembly_roster_day(uuid, week_id, entry_date, anchor1_student_id, anchor1_name,
  anchor1_class, anchor2_*, day_owner_employee_id)` — per-day anchors + a day owner.
- `assembly_roster_entry(uuid, week_id, entry_date, node_id, opted bool, content text,
  student_id, student_name, student_class, owner_employee_id, ...)` — per (day, roster
  node): opt-in/out of optional segments, the day's variable content, the **linked
  student** speaker (feeds the student 360° view), and per-segment delegation owner.
- `assembly_week_unlock(uuid, week_id, unlockedby, unlocked_at, reason)` — audit of unlocks.
- No auto-inherit from last week (re-enter; "copy last week" is a later convenience).

## Finalization workflow & deadlines
- **draft → submitted → approved(=locked)**. Approve/unlock by **god / `assembly-incharge`**.
- Hard deadline **Wed 2 pm of the week immediately before** the assembly week. If not
  approved by then → **auto-lock (no edits) + notify** house in-charge + assembly-incharge;
  a god/assembly-incharge **unlock** (recorded) is required to edit late.
- **Reminders** to the house in-charge at ~10 days, 3 days, deadline morning (communication module + a scheduled drain job, like the timetable/communication pattern).

## Checklist (stored, configurable, non-gating)
- `assembly_checklist_item(uuid, school_id, phase, scope 'week'|'day', text, sort_order)` — seeded from the doc (Phase 1 weekly, Phase 2 daily, Phase 3 weekly).
- `assembly_checklist_tick(uuid, week_id, item_id, entry_date, checked, checkedby, at)` + a week-level sign-off. Recorded, not a hard gate.

## Grading & house-of-the-month (rubric configurable per school)
- `assembly_rubric_metric(uuid, school_id, name, max_marks, sort)`, `assembly_rubric_penalty(uuid, school_id, name, value, sort)`, `assembly_rubric_config(school_id, scaling_adjustment)` — seeded from the log (7 metrics ×5, −5 scaling, 4 penalties).
- `assembly_evaluator(uuid, school_id, employee_id, start_date, end_date)` — assigned by god/assembly-incharge; grades days in range.
- `assembly_grade(uuid, school_id, grade_date, week_id, house_id, evaluator_id, star_presenter, diction, feedback, ...)`, `assembly_grade_metric(grade_id, metric_id, score)`, `assembly_grade_penalty(grade_id, penalty_id, applied)`.
- **Aggregation**: day = avg of evaluators' final scores; week = avg of the house-week's
  days; month → **house-of-the-month** = house with the highest weekly average (multi-week
  house → average its weeks).
- **Visibility**: scores + leaderboard to god/assembly-incharge + the graded house's
  in-charge; not students (v1).

## Resolve (house mode)
- `mode='template'` → today's behavior (template + G2 responsibility).
- `mode='house'` → resolve the date's template, then **overlay the week's *approved*
  roster**: keep only opted-in `roster` nodes, fill their content, set responsible from
  the roster (owner/anchors/student speaker), and attach the house-on-duty. Grades/
  checklist are separate reads.

## Roles & permissions
- New role **`assembly-incharge`** (assembly admin). Actions:
  - `assembly.manage` — template authoring (god/admin).
  - `assembly.house.manage` — houses, rotation, rubric, approvals, unlocks, evaluator assignment (god/assembly-incharge).
  - `assembly.roster.edit` — the house in-charge for **their** house's weeks; god/assembly-incharge for all.
  - `assembly.grade` — assigned evaluators (derived from `assembly_evaluator`).
  - `assembly.checklist` — house rep.
- "House in-charge" / "evaluator" access is **derived** (house record + evaluator assignment), not a static role.

## Frontends
- **Admin-portal (desktop, house-mode):** Houses & Rotation, Weekly Roster editor
  (submit/approve/unlock), Checklist config, Grading (rubric + evaluator assignment +
  leaderboard). Template authoring unchanged. `fill_mode` toggle added to the tree editor.
- **PWA (teacher, on-ground):** **Roster editing** (house in-charge — mobile-allowed),
  **Checklist ticking**, **Grade entry** (evaluators), view today's roster.
- **Student-app:** the resolved day incl. **house-on-duty + anchors/presenters**; a
  read-only **House-of-the-Month / leaderboard** view.

## Notifications
- Communication templates: roster-deadline reminders + missed-deadline lock. Stub
  provider locally; register templates like transport/attendance.

## Phases
- **A — Houses + mode + rotation** — backend ✅ (commit `76411e4`; migration `assembly-migrate-3`). Admin Houses/Rotation screens still pending (batched with the UI phase).
- **B — Weekly roster + finalize/approve/lock + resolve overlay** — backend ✅ (migration `assembly-migrate-4-roster`). Admin roster editor + PWA roster editing + student-app house-on-duty batched with the UI phase.
- **C — Checklist** (config + tick; PWA ticking). ⏳ not started.
- **D — Grading + rubric + evaluators + leaderboard** (backend + admin + PWA grade entry + student-app leaderboard). ⏳ not started.
- Deploy: build/commit/push per phase; prod DB migrations + serverless deploy once at the end (prod not half-shipped).
- **Frontend**: per the agreed sequencing, all admin-portal + PWA + student-app UI for A–D is built as one batch AFTER the backend phases, before the single end-deploy.

### Phase B backend — as built
- Tables `assembly_week` (per plan/wing, per week; `draft→submitted→approved`=locked), `assembly_roster_day` (per-day anchors + day owner), `assembly_roster_entry` (per day+roster-node opt-in/content/student speaker/owner), `assembly_week_unlock` (audit).
- Endpoints: `POST/GET /plans/{id}/weeks` (ensure idempotent / list), `GET /weeks/{id}` (editor read model = week + each assembly date's fillable slots), `PUT /weeks/{id}/roster` (bulk replace-per-kind, editable-gated), `POST /weeks/{id}/{submit|approve|unlock}`.
- **House-on-duty snapshot** taken at week-create from the per-plan rotation; a skip week has no house.
- **Deadline / lock**: `deadline_at` = Wed 14:00 of the prior week; editing is gated on `locked` + status + deadline (with a recorded `unlock` to re-open late). The *lock* is enforced at write-time (no scheduler needed).
- **Resolve overlay**: in `house` mode `resolve` attaches the house-on-duty and, when an **approved** roster exists, overlays it onto the template — fills `roster` slot content, sets the speaker/owner as effective responsible, prunes opted-out optional nodes, and attaches the day's anchors + owner. Specials get the house label but no roster overlay.

### Deferred (Phase B follow-ups, schema-ready)
- **Reminder / missed-deadline notifications**: the ~10-day / 3-day / deadline-morning reminders and the missed-deadline *notify* (communication module + a scheduled drain job, like timetable/communication). The lock behaviour already works without it; only the proactive messaging is outstanding.
- **Role enforcement** (`assembly-incharge`, derived house-in-charge/evaluator) at the service layer — currently, like the rest of the module, actions are open behind the authorizer; wire per-action gates when the role lands.
