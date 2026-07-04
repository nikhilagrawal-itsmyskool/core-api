# Cohort electives: pooled vs parallel — design note

> **Status:** open design question, not yet implemented in the solver/model. Written after
> importing the school's hand-made 2026-27 timetable surfaced the tension below. The interim
> workaround already lives in the Excel importer (`cpsat/import_excel_solution.py`, see §4).

## 1. What happened

Importing dbpasn's hand-made whole-school timetable produced **2 class/slot clashes**, both on the
XI-A cohort (Science + Commerce):

- **Tue period VIII** — XI-A Science had **Physics** *and* the elective band booked at once.
- **Fri period VII** — XI-A Commerce had **Applied Mathematics** *and* the elective band at once.

These were not data-entry errors. They are the symptom of the model forcing something the school
does not actually do.

## 2. Two real-world concepts the model conflates

Today a cross-class `elective_band` (a band scoped to a `class_group`, i.e. a cohort) means exactly
one thing: **hard co-scheduling** — one solver `Lesson` with `classIds=[all members]` that books
every member class at the **identical** `(day, sequence)`, carrying **all** offerings
(`solver/build-lessons.ts`, ~L358–374; `solve.ts` marks `${class}|${day}|${seq}` busy for every
`classesOf(lesson)`; `DESIGN.md` composite-class section makes the whole "no-clash" guarantee depend
on the electives being perfectly aligned).

But two genuinely different things are being modelled with that one primitive:

- **Pooled electives** — students from *both* streams physically **regroup** into one room by chosen
  subject (e.g. every XI student who chose Painting sits in one Painting class, Science or Commerce).
  This **must** be hard co-scheduled: it is literally one class of mixed students at one time. The
  current model is correct here. (dbpasn's `CS/Painting/Hindi` band is likely this.)

- **Parallel-stream subjects** — each stream does its **own** subjects in its **own** room with its
  **own** teacher (Science: Bio/Maths; Commerce: Accountancy — or its core Applied Maths). Running
  them at the same time is a **convenience** (aligned bells/breaks/supervision), **not** a rule. There
  is no shared room and no regrouping, so there is **no reason** to force identical slots. (dbpasn's
  `Maths/Accountancy/Biology` band is this — and it is where the clashes came from.)

The model has **no way to express the second case**. Forcing it into the co-scheduled mould makes
legitimate divergences (Science does Bio/Maths at Fri-VII while Commerce does Applied Maths there)
look like clashes.

## 3. Recommendation

Introduce a per-elective (or per-cohort) distinction between **pooled** (hard co-scheduled) and
**parallel** (soft-aligned), and let the solver treat parallel-stream alignment as a **preference**,
not a constraint.

The good news: the soft primitive already exists. `solver/score.ts` has a **`cohortLockstep`**
objective that rewards keeping cohort members busy/free at the same slots. So "prefer aligned, allow
divergence" is a small reuse, not a new mechanism.

Concretely, a future change would:

1. **Tag the intent.** Add a flag on `elective_band` (e.g. `co_schedule boolean`, default true for
   backward compatibility) — or model parallel-stream subjects as ordinary per-class `class_subject`
   rows on each stream instead of a cross-class band at all.
2. **Pooled (co_schedule = true):** unchanged — one `Lesson` with `classIds=[members]`, hard
   co-scheduled. Keep for genuine regrouping electives.
3. **Parallel (co_schedule = false):** emit **per-stream** lessons (each on a single `classId`), and
   let `cohortLockstep` (soft) nudge them onto the same columns without forbidding divergence. No
   hard `classIds=[both]` lesson, so no false clash.

### Where it lands (hooks that already exist)
- `elective_band.class_group_id` / `class.class_group_id` — cohort membership (`timetable-setup.sql`).
- `SolverInput.cohorts` — the cohort groups fed to scoring (`generation-data-loader.ts`, ~L180).
- `ObjectiveWeights.cohortLockstep` + its term in `solver/score.ts` — the soft "keep aligned" reward.
- `solver/build-lessons.ts` band expansion (~L333–376) — where a band becomes one shared lesson vs
  per-stream lessons would branch on the new flag.

### The decision the owner drives (domain, not code)
For each XI/XII elective: **pooled or parallel?** i.e. do students actually regroup across streams
into one room (pooled), or does each stream just run its own subjects at that time (parallel)? That
classification is the real input; the code change is mechanical once it exists.

## 4. Interim: what the Excel importer already does

The importer (`cpsat/import_excel_solution.py`) does **not** wait for the model change. When it reads
XI band cells it now places them **per stream** — each stream gets the offerings its own cell names,
at its own slot (`classId=<stream>`, `classIds=None`, `bandId` retained for grouping). Where the two
streams were drawn on the same slot they still coincide (parallel); where they diverge, each sits in
its own class → **no clash**. It also prints a cohort-alignment line, e.g.:

```
XI-A (Science) + XI-A (Commerce): 23 band-slot(s) aligned across streams, 2 stream-only (parallel…)
  · XI-A (Commerce)  Tue period VIII (Mathematics/Accountancy/Biology)
  · XI-A (Science)   Fri period VII  (Mathematics/Accountancy/Biology)
```

So a hand-made timetable imports faithfully today. The solver-side change above is what would let the
**auto-generator** produce the same parallel-but-divergent grids instead of only perfectly-aligned ones.
