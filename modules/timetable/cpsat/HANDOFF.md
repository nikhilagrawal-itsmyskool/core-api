# CP-SAT Timetable Solver — Session Handoff

> **Read this first.** This document carries the full context for moving the timetable
> generation off the in-house backtracking solver and onto **Google OR-Tools CP-SAT**.
> It is written so a *fresh* Claude Code session (in WSL on the prod machine) can resume
> with no prior chat history. Everything you need is here or referenced by path.

---

## 1. TL;DR / why we're here

The whole-school timetable (Class 1–XI, **20 classes / 832 lessons**) **fails to generate**
on the current engine. We proved, on prod:

- It is **feasible** (the feasibility pre-check passes — demand fits the slots).
- The current **backtracking solver times out** finding nothing — first at 60s, then at a
  raised **300s** budget (commit on `develop`). Same error each time:
  *"No timetable satisfied all hard constraints within the time budget."*
- **20 classes is *within* proven-solvable size** (the scale harness solves ~25 classes /
  ~1200 lessons in ~25–35s). So this is **constraint thrash, not scale**: the hard teacher
  **availability whitelists** (e.g. a teacher available *only* at period 6, teaching exactly
  6 periods → zero slack) send the backtracker into deep dead-ends it can't escape.

**Decision (owner, Nikhil):** stop patching the backtracker. Build the real thing —
**CP-SAT** — which propagates, learns from conflicts, and optimizes the soft objective
properly. School timetabling is a textbook CP-SAT use case.

**Approach for now:** a **manual pull → solve → push spike** on the prod machine:
1. Dump the *assembled* `SolverInput` for the config (real loader → JSON; perfect fidelity).
2. Solve it with CP-SAT (Python in WSL).
3. Push the result back into prod as a **candidate** (additive — never touches a published TT).

If the spike produces a good whole-school timetable, we productionize (CP-SAT worker service).

---

## 2. Environment (the prod machine)

- **Prod Postgres runs on Windows**, `localhost:5432` from Windows' view. Creds in
  `configs/prod/prod.yml`: db `itsmyskool_prod`, user `postgres`, pass `itsmyskool`, ssl off.
- **CP-SAT runs in WSL (Linux)** — `pip install ortools` is painless there.
- **WSL → Windows Postgres:** WSL2 cannot always reach Windows via `localhost`. Use the
  **Windows host IP**. Find it from WSL with:
  ```bash
  ip route show | grep -i default | awk '{print $3}'      # the Windows host IP (mirrored-net: localhost may also work)
  cat /etc/resolv.conf | grep nameserver                  # often the same host IP
  ```
  Then test: `psql -h <winhost-ip> -U postgres -d itsmyskool_prod -c 'select 1'`.
  You may need to (a) allow `<winhost-ip>` in Windows `pg_hba.conf` + `listen_addresses='*'`
  in `postgresql.conf`, and (b) open the Windows firewall for TCP 5432. (Read-only access only.)

### Key identifiers (school: **dbpasn**)
| Thing | Value |
|------|------|
| Config id | `5jqyyk2h2njw` |
| Academic year id | `w3ajbki9xhbm` |
| "All Classes" wing id | `jamtcim4if25` (covers all 20 classes = whole school) |
| Prod API base | `https://api.itsmyskool.com` (school header `X-School-Code: dbpasn`) |
| Prod login (owner-authorized) | user `9616617891` / pass `Itsmyskool@123` |

> Prod write authorization is **narrow**: additive candidate inserts for *our* spike only.
> Do **not** loop `/timetable/runs/process-next` (it claims *other* schools' queued runs).

---

## 3. The pipeline & assets in this repo

```
[prod DB]  --(real loader)-->  SolverInput.json  --(CP-SAT)-->  solution.json  --(push)-->  [prod DB candidate]
```

| Step | Asset | Notes |
|------|-------|-------|
| Faithful dump | `modules/timetable/cpsat/dump-solver-input.test.ts` | Jest spec that runs the **actual** `loadConfigForSolve` + `buildLessons` and writes the assembled `SolverInput` to JSON. Zero fidelity drift. **Use this.** |
| Solve | `modules/timetable/cpsat/solve_cpsat.py` | CP-SAT model **scaffold** — faithful to the spec in §5, but **untested against real data**. Validate + iterate. |
| Push back | *(to write)* | Reuse the TS candidate-write path — see §6. |
| Read-only inspect | `scripts/prod-timetable-inspect.js` | Lists runs/candidates, per-class period totals, teacher clashes, score breakdown, `--grid`, `--teacher`. Use to sanity-check after pushing. |

---

## 4. Setup (WSL on prod machine)

```bash
# 0. get this repo state
git pull origin develop

# 1. Python + OR-Tools
sudo apt update && sudo apt install -y python3 python3-pip
pip3 install ortools

# 2. Node tooling (the dumper runs via jest/ts-jest — dev deps must be present)
npm install            # ensure devDependencies (jest, ts-jest, typescript) are installed

# 3. confirm WSL can reach Windows Postgres (see §2), note the host IP as $PGHOST
```

### Produce the faithful input
```bash
# from repo root, in WSL — point at Windows Postgres
DUMP_CONFIG_ID=5jqyyk2h2njw DUMP_OUT=/tmp/solver-input.json \
POSTGRES_HOST=$PGHOST POSTGRES_DATABASE=itsmyskool_prod \
POSTGRES_USERNAME=postgres POSTGRES_PASSWORD=itsmyskool POSTGRES_PORT=5432 POSTGRES_SSL=false \
npx jest modules/timetable/cpsat/dump-solver-input.test.ts --runTestsByPath --forceExit
# -> writes /tmp/solver-input.json  (the EXACT input the engine feeds the solver)
```

### Solve
```bash
python3 modules/timetable/cpsat/solve_cpsat.py --in /tmp/solver-input.json --out /tmp/solution.json --time 120
# prints feasibility, objective, per-class grid; writes /tmp/solution.json (Placement[] shape)
```

---

## 5. CP-SAT model spec (authoritative)

Input is `SolverInput` (`modules/timetable/solver/types.ts`). The model must reproduce the
**hard** rules enforced in `solver/solve.ts` (`canPlace`) + `solver/constraint-checks.ts`,
and **optimize** the soft objective in `solver/score.ts`.

### Derived sets
- For each day `d`, `teachingSeq[d]` = sorted `sequence`s of slots with `slotType==='teaching'`.
- A lesson of `size s` may **start** at sequence `q` on day `d` iff `q, q+1, …, q+s-1` are all
  in `teachingSeq[d]` (contiguous teaching run — a double cannot jump the lunch gap).
- `flex[d]` = the **last 2** teaching sequences of day `d` (the day-varying tail).

### Decision variables
For each lesson `L`, enumerate candidate positions `P(L) = {(d, q)}` (valid starts, after the
hard prunes below). Boolean `x[L,d,q]`. **Exactly one** position: `sum_{(d,q)∈P(L)} x[L,d,q] = 1`.
- **Pinned** lessons (`L.pinnedDay`): `P(L)` = single fixed position (first teaching slot of
  that weekday); just fix it.

### Occupancy (helper expressions, not new vars unless needed)
- `occClass[c,d,seq]` = Σ `x[L,d,q]` over `(L,q)` with `c ∈ classesOf(L)` and `q ≤ seq ≤ q+size-1`.
- `occTeacher[t,d,seq]` = same over `L` with `t ∈ L.teacherIds`.
  (`classesOf(L)` = `L.classIds` if non-empty else `[L.classId]`. A cohort band is **one**
  lesson over several classes but lists each teacher once → books the teacher once. ✔)

### Hard constraints
1. **Class no-overlap:** `occClass[c,d,seq] ≤ 1` ∀ c,d,teaching-seq.
2. **Teacher no-overlap:** `occTeacher[t,d,seq] ≤ 1` ∀ t,d,seq.
3. **Availability whitelist** (`available_slot`, implicitly hard): if teacher `t` has an allowed
   set `A_t`, **prune** any position putting `t` outside `A_t`. (`value.day`,`value.slot` are
   already concrete `day` + grid `sequence` — the loader translated teaching-period→sequence.)
4. **Hard `unavailable_slot` / `day_off`:** prune positions where a teacher would sit in an
   unavailable `(day,seq)` or any slot on a day_off. (Only when `hardness==='hard'`.)
5. **Group block rules** per `groupKey g`, day `d`:
   `Σ size·x[L,d,q]` over `L∈g` `≤ maxPeriodsPerDay(g)` (default **2**). Honor deprecated
   `notTwiceSameDay` (≤1 placement/day) / `maxPerDay` if present.
6. **Hard teacher limits** (`hardness==='hard'`):
   - `max_per_day`: `Σ_seq occTeacher[t,d,seq] ≤ v.max` ∀ d.
   - `weekly_max`: `Σ_{d,seq} occTeacher[t,d,seq] ≤ v.max`.
   - `max_consecutive`: for every window of `v.max+1` consecutive teaching seqs on day d,
     `Σ occTeacher[t,d,·] ≤ v.max`.

### Soft objective (minimize weighted penalty; weights = `DEFAULT_WEIGHTS` in `score.ts`)
| Term | Weight | Definition |
|------|-------:|-----------|
| **columnConsistency** | 12 | Per group, distinct **non-flex start-columns** used beyond `ceil(ppw/teachingDays)`. *The headline "looks hand-made" driver.* |
| honorSoftPreferences | 8 | +reward per placement at a `prefer` hint or soft `preferred_slot`. |
| cohortLockstep | 6 | Per cohort, per teaching slot busy in some members but not all → `(|grp|−busy)`. |
| minimizeTeacherGaps | 5 | Per teacher/day: `(last−first+1) − count` of occupied seqs. *(can defer)* |
| spreadAcrossWeek | 4 | Per group: placements beyond 1 on the same day. |
| teacherVariety | 4 | Same `teacher+class+subject` twice in a day. |
| evenDailyLoad | 3 | Variance of per-day total periods. *(nonlinear — defer / L1-approx)* |

CP-SAT: add hard constraints, set `Minimize(Σ weighted penalties − Σ rewards)`, give it a
time limit (start 60–120s), read `solver.BestObjectiveBound` / status. It returns the best
feasible solution found (and can prove optimality on small instances).

### Output (`solution.json`)
Array of `Placement` (`types.ts`): `{lessonId, classId, classIds?, dayOfWeek, startSequence,
slotIds, offerings, size, bandId?}` — same shape the TS engine writes, so the push path reuses
the existing entry fan-out.

---

## 6. Pushing the result back (next step after a good solve)

Reuse the TS write path rather than hand-rolling SQL:
- Read `modules/timetable/generation-service.ts` — the candidate/entry writer. Tables:
  `generation_run`, `timetable_candidate`, `timetable_entry` (entries **fan out per class** —
  one row per (class, slot); a cohort placement writes a row for each member class).
- Plan: a small TS script `import-cpsat-candidate.ts` that takes `solution.json` + the runId
  (or creates a `generation_run` of source='cpsat'), scores it via `scoreTimetable`, and writes
  a `timetable_candidate` + its `timetable_entry` rows. Then it shows up in the existing Runs UI
  for review/publish — **no frontend change needed**.
- Verify with `node scripts/prod-timetable-inspect.js --user 9616617891 --pass 'Itsmyskool@123'`.

---

## 7. Status / what's already done

- `develop` has the solve budget at **300s** + process-next Lambda timeout **360s** (commits
  `0127858`, `1b17b51`) — a stopgap for the *old* solver. Harmless to leave; **superseded** by
  CP-SAT. Consider reverting to 60s once CP-SAT is the path (keeps the old engine snappy for
  small/wing solves).
- Phase A/B solver work (column-consistency, `available_slot` whitelist, teaching-period
  numbering, multi-day constraints, cohort bands, multi-teacher band shares) is **built &
  deployed** — that's the model the dumper captures, and what CP-SAT must match.
- The current backtracker still works for **friendly / small** instances; CP-SAT is about the
  hard whole-school case.

## 8. Open questions for the owner (Nikhil)
1. Acceptance bar: must the output **look hand-made** (strict period-fixed columns), or is any
   clash-free, constraint-respecting grid OK for v1? (Changes how hard we push `columnConsistency`.)
2. His manual method: does he truly fix subjects to periods first, and how does he order the
   scarce teachers? (Encodes directly into the CP-SAT objective / search hints.)

## 9. First actions for the resuming session
1. Get WSL→Windows Postgres connectivity green (§2).
2. `pip3 install ortools`; `npm install`.
3. Run the dumper (§4) → `/tmp/solver-input.json`. Eyeball counts (20 classes, ~832 lessons).
4. Run `solve_cpsat.py` → does CP-SAT find a feasible whole-school solution, and how fast?
   *This is the moment of truth the owner wants to see.*
5. If feasible: render the grid, check column-consistency + the whitelisted teachers (Nitin
   period-6 Chemistry, Dinesh), then write the push script (§6).
6. If infeasible/slow: inspect which constraints bind (CP-SAT gives an infeasibility core /
   you can relax soft terms); report honestly.
