#!/usr/bin/env python3
"""
CP-SAT timetable solver — SCAFFOLD (faithful to modules/timetable/solver/* semantics).

Status: written from the model spec in cpsat/HANDOFF.md §5 but NOT YET validated against
real data. Treat it as a strong starting point: run it on the dumped SolverInput, then
verify/iterate. Hard constraints + the headline soft terms are implemented; teacherGaps and
evenDailyLoad are TODO (they're nonlinear / lower priority for a first feasible-and-pretty run).

Input  : the JSON written by cpsat/dump-solver-input.test.ts  ({ meta, input, labels, warnings })
Output : solution.json — a list of Placement objects (same shape as solver/types.ts Placement),
         consumable by the TS candidate-import path (HANDOFF §6).

Usage:
  python3 solve_cpsat.py --in /tmp/solver-input.json --out /tmp/solution.json --time 120
"""
import argparse
import json
import math
import sys
from collections import defaultdict

from ortools.sat.python import cp_model

WEIGHTS = {  # mirror DEFAULT_WEIGHTS in solver/score.ts
    "columnConsistency": 12,
    "honorSoftPreferences": 8,
    "cohortLockstep": 6,
    "minimizeTeacherGaps": 5,   # TODO (not yet modeled)
    "spreadAcrossWeek": 4,
    "teacherVariety": 4,
    "evenDailyLoad": 3,         # TODO (not yet modeled)
}


def classes_of(lesson):
    ids = lesson.get("classIds") or []
    return ids if len(ids) > 0 else [lesson["classId"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", default="solution.json")
    ap.add_argument("--time", type=float, default=120.0, help="solver time limit (s)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    with open(args.inp) as f:
        payload = json.load(f)
    data = payload["input"] if "input" in payload else payload
    labels = payload.get("labels", {})
    grid = data["grid"]
    lessons = data["lessons"]
    constraints = data.get("constraints", [])
    cohorts = data.get("cohorts", []) or []

    # ---- derived grid sets ---------------------------------------------------
    teaching_seqs = {}      # day -> sorted list of teaching sequences
    slot_id = {}            # (day, seq) -> slotId
    for day in grid["days"]:
        d = day["dayOfWeek"]
        ts = sorted(s["sequence"] for s in day["slots"] if s["slotType"] == "teaching")
        teaching_seqs[d] = ts
        for s in day["slots"]:
            slot_id[(d, s["sequence"])] = s["slotId"]
    teaching_set = {d: set(seqs) for d, seqs in teaching_seqs.items()}
    teaching_days = sum(1 for d in teaching_seqs if teaching_seqs[d])
    first_teaching = {d: (seqs[0] if seqs else None) for d, seqs in teaching_seqs.items()}
    flex = set()            # {(day, seq)} — last 2 teaching periods per day
    for d, seqs in teaching_seqs.items():
        for q in seqs[-2:]:
            flex.add((d, q))

    # ---- teacher constraint indexes -----------------------------------------
    allowed = defaultdict(set)        # teacher -> {(d, seq)}  (available_slot whitelist)
    hard_unavail = defaultdict(set)   # teacher -> {(d, seq)}  (hard unavailable_slot)
    hard_dayoff = defaultdict(set)    # teacher -> {day}       (hard day_off)
    hard_limits = defaultdict(list)   # teacher -> [constraint]
    soft_pref = defaultdict(set)      # teacher -> {(d, seq)}  (soft preferred_slot)
    for c in constraints:
        t, typ, v, hard = c["teacherId"], c["type"], (c.get("value") or {}), c.get("hardness") == "hard"
        if typ == "available_slot":
            if v.get("day") is not None and v.get("slot") is not None:
                allowed[t].add((v["day"], v["slot"]))
        elif typ == "unavailable_slot" and hard:
            hard_unavail[t].add((v["day"], v["slot"]))
        elif typ == "day_off" and hard:
            hard_dayoff[t].add(v["day"])
        elif typ in ("max_per_day", "weekly_max", "max_consecutive") and hard:
            hard_limits[t].append(c)
        elif typ == "preferred_slot" and not hard:
            if v.get("day") is not None and v.get("slot") is not None:
                soft_pref[t].add((v["day"], v["slot"]))

    def position_ok(lesson, d, q):
        seqs = [q + k for k in range(lesson["size"])]
        if any(s not in teaching_set[d] for s in seqs):
            return False
        for t in lesson["teacherIds"]:
            if t in allowed and any((d, s) not in allowed[t] for s in seqs):
                return False
            if t in hard_unavail and any((d, s) in hard_unavail[t] for s in seqs):
                return False
            if t in hard_dayoff and d in hard_dayoff[t]:
                return False
        return True

    def positions_for(lesson):
        if lesson.get("pinnedDay") is not None:
            d = lesson["pinnedDay"]
            q = first_teaching.get(d)
            if q is None:
                return []
            return [(d, q)] if position_ok({**lesson, "size": 1}, d, q) else []
        out = []
        for d, seqs in teaching_seqs.items():
            for q in seqs:
                if position_ok(lesson, d, q):
                    out.append((d, q))
        return out

    # ---- model ---------------------------------------------------------------
    model = cp_model.CpModel()
    x = {}                                  # (lessonIdx, d, q) -> BoolVar
    class_slot = defaultdict(list)          # (c, d, seq) -> [vars]
    teacher_slot = defaultdict(list)        # (t, d, seq) -> [vars]
    group_day = defaultdict(list)           # (groupKey, d) -> [(var, size)]
    group_col = defaultdict(lambda: defaultdict(list))  # groupKey -> col(seq) -> [vars]  (non-flex starts)
    variety = defaultdict(list)             # (t, c, subj, d) -> [vars]
    no_pos = []

    for li, lesson in enumerate(lessons):
        pos = positions_for(lesson)
        if not pos:
            no_pos.append(lesson["id"])
            continue
        vs = []
        for (d, q) in pos:
            var = model.NewBoolVar(f"x_{li}_{d}_{q}")
            x[(li, d, q)] = var
            vs.append(var)
            size = lesson["size"]
            for k in range(size):
                seq = q + k
                for c in classes_of(lesson):
                    class_slot[(c, d, seq)].append(var)
                for t in lesson["teacherIds"]:
                    teacher_slot[(t, d, seq)].append(var)
            gk = lesson.get("groupKey")
            if gk:
                group_day[(gk, d)].append((var, size))
                if (d, q) not in flex:
                    group_col[gk][q].append(var)
            for c in classes_of(lesson):
                for o in lesson["offerings"]:
                    if o.get("teacherId"):
                        variety[(o["teacherId"], c, o["subjectId"], d)].append(var)
        model.Add(sum(vs) == 1)             # each lesson placed exactly once

    if no_pos:
        print(f"WARNING: {len(no_pos)} lesson(s) have NO feasible position (hard-infeasible): "
              f"{no_pos[:10]}{'...' if len(no_pos) > 10 else ''}", file=sys.stderr)

    # H1/H2 no-overlap
    for vs in class_slot.values():
        if len(vs) > 1:
            model.Add(sum(vs) <= 1)
    for vs in teacher_slot.values():
        if len(vs) > 1:
            model.Add(sum(vs) <= 1)

    # H5 group block rules: periods/day <= maxPeriodsPerDay (default 2)
    cap_by_group = {}
    for lesson in lessons:
        gk = lesson.get("groupKey")
        if gk:
            cap_by_group[gk] = lesson.get("maxPeriodsPerDay", 2) or 2
    for (gk, d), pairs in group_day.items():
        cap = cap_by_group.get(gk, 2)
        model.Add(sum(var * size for var, size in pairs) <= cap)

    # H6 hard teacher limits
    teacher_days = defaultdict(lambda: defaultdict(list))   # t -> d -> [vars] (per occupied slot)
    teacher_all = defaultdict(list)
    for (t, d, seq), vs in teacher_slot.items():
        teacher_days[t][d].extend(vs)
        teacher_all[t].extend(vs)
    for t, cons in hard_limits.items():
        for c in cons:
            v = c["value"] or {}
            mx = v.get("max")
            if mx is None:
                continue
            if c["type"] == "weekly_max":
                model.Add(sum(teacher_all[t]) <= mx)
            elif c["type"] == "max_per_day":
                for d, vs in teacher_days[t].items():
                    model.Add(sum(vs) <= mx)
            elif c["type"] == "max_consecutive":
                for d in teaching_seqs:
                    seqs = teaching_seqs[d]
                    for i in range(len(seqs) - mx):
                        window = [teacher_slot.get((t, d, seqs[i + k]), []) for k in range(mx + 1)]
                        flat = [vv for w in window for vv in w]
                        if flat:
                            model.Add(sum(flat) <= mx)

    # ---- objective (minimize weighted penalty - rewards) --------------------
    penalty_terms = []

    # columnConsistency (w=12): used non-flex columns per group beyond ceil(ppw/teachingDays)
    ppw = defaultdict(int)
    for lesson in lessons:
        gk = lesson.get("groupKey")
        if gk:
            ppw[gk] += lesson["size"]
    for gk, cols in group_col.items():
        used_vars = []
        for q, vs in cols.items():
            u = model.NewBoolVar(f"col_{gk}_{q}")
            for v in vs:
                model.Add(u >= v)
            used_vars.append(u)
        ideal = max(1, math.ceil(ppw.get(gk, 1) / max(1, teaching_days)))
        extra = model.NewIntVar(0, len(used_vars), f"colspread_{gk}")
        model.Add(extra >= sum(used_vars) - ideal)
        penalty_terms.append(WEIGHTS["columnConsistency"] * extra)

    # spreadAcrossWeek (w=4): group placements beyond 1 on the same day
    for (gk, d), pairs in group_day.items():
        cnt = sum(var for var, _ in pairs)
        dup = model.NewIntVar(0, len(pairs), f"dup_{gk}_{d}")
        model.Add(dup >= cnt - 1)
        penalty_terms.append(WEIGHTS["spreadAcrossWeek"] * dup)

    # teacherVariety (w=4): same teacher+class+subject >1 in a day
    for key, vs in variety.items():
        if len(vs) > 1:
            rep = model.NewIntVar(0, len(vs), "rep_" + "_".join(map(str, key)))
            model.Add(rep >= sum(vs) - 1)
            penalty_terms.append(WEIGHTS["teacherVariety"] * rep)

    # cohortLockstep (w=6): per cohort, per teaching slot, |G|*anyBusy - busyCount
    for gi, group in enumerate(cohorts):
        G = len(group)
        for d, seqs in teaching_seqs.items():
            for seq in seqs:
                members_busy = []
                for m in group:
                    vs = class_slot.get((m, d, seq), [])
                    members_busy.append(sum(vs) if vs else 0)
                if all(isinstance(b, int) for b in members_busy):
                    continue
                z = model.NewBoolVar(f"co_{gi}_{d}_{seq}")
                for b in members_busy:
                    model.Add(z >= b)
                penalty_terms.append(WEIGHTS["cohortLockstep"] * (G * z - sum(members_busy)))

    # honorSoftPreferences (w=8): reward placements at a prefer hint (subtract penalty)
    reward_terms = []
    for li, lesson in enumerate(lessons):
        prefs = lesson.get("prefer") or []
        if not prefs:
            continue
        pref_vars = [x[(li, p["day"], p["slot"])] for p in prefs if (li, p["day"], p["slot"]) in x]
        if pref_vars:
            h = model.NewBoolVar(f"pref_{li}")
            model.Add(h <= sum(pref_vars))
            reward_terms.append(WEIGHTS["honorSoftPreferences"] * h)
    # TODO: soft preferred_slot (teacher occupied at soft_pref slot), minimizeTeacherGaps, evenDailyLoad

    model.Minimize(sum(penalty_terms) - sum(reward_terms))

    # ---- solve ---------------------------------------------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = args.time
    solver.parameters.num_search_workers = args.workers
    solver.parameters.log_search_progress = True
    status = solver.Solve(model)
    print(f"\nstatus={solver.StatusName(status)} objective={solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else '-'} "
          f"bound={solver.BestObjectiveBound} time={solver.WallTime():.1f}s", file=sys.stderr)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print("NO SOLUTION (infeasible or no feasible solution within time).", file=sys.stderr)
        if no_pos:
            print(f"  Likely cause: {len(no_pos)} lessons had no legal slot (over-constrained whitelist?).", file=sys.stderr)
        sys.exit(2)

    # ---- extract placements --------------------------------------------------
    placements = []
    for li, lesson in enumerate(lessons):
        chosen = None
        for d, seqs in teaching_seqs.items():
            for q in seqs:
                v = x.get((li, d, q))
                if v is not None and solver.Value(v) == 1:
                    chosen = (d, q)
                    break
            if chosen:
                break
        if not chosen:
            continue
        d, q = chosen
        size = lesson["size"]
        placements.append({
            "lessonId": lesson["id"],
            "classId": lesson["classId"],
            "classIds": lesson.get("classIds"),
            "dayOfWeek": d,
            "startSequence": q,
            "slotIds": [slot_id[(d, q + k)] for k in range(size)],
            "offerings": lesson["offerings"],
            "size": size,
            "bandId": lesson.get("bandId"),
        })

    with open(args.out, "w") as f:
        json.dump(placements, f, indent=2)
    print(f"wrote {args.out}: {len(placements)} placements", file=sys.stderr)

    # ---- quick per-class grid for eyeballing --------------------------------
    render_grid(placements, grid, labels)


def render_grid(placements, grid, labels):
    sub = labels.get("subject", {})
    cls = labels.get("class", {})
    tch = labels.get("teacher", {})
    days = [d["dayOfWeek"] for d in grid["days"]]
    teaching = {d["dayOfWeek"]: sorted(s["sequence"] for s in d["slots"] if s["slotType"] == "teaching")
                for d in grid["days"]}
    by_class = defaultdict(dict)  # class -> (day,seq) -> label
    for p in placements:
        ids = p.get("classIds") or [p["classId"]]
        label = "/".join((sub.get(o["subjectId"], o["subjectId"][:4]) +
                          ("·" + tch.get(o["teacherId"], o["teacherId"][:3]) if o.get("teacherId") else ""))
                         for o in p["offerings"])
        for c in ids:
            for k in range(p["size"]):
                by_class[c][(p["dayOfWeek"], p["startSequence"] + k)] = label[:14]
    for c in sorted(by_class):
        print(f"\n--- {cls.get(c, c)} ---")
        for d in days:
            row = " ".join((by_class[c].get((d, seq), "·")).ljust(14) for seq in teaching.get(d, []))
            print(f"  D{d}: {row}")


if __name__ == "__main__":
    main()
