import {
  classesOf,
  Lesson,
  Placement,
  ScoredTimetable,
  SolveResult,
  SolverInput,
  SolverTeacherConstraint,
  Timetable,
} from "./types";
import {
  getDay,
  firstTeachingSlot,
  startPositions,
  StartPosition,
} from "./grid";
import {
  availableSlotsByTeacher,
  Occ,
  violationMessage,
} from "./constraint-checks";
import { scoreTimetable } from "./score";

// Small deterministic PRNG so candidates are reproducible from a seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface State {
  classBusy: Set<string>;
  teacherBusy: Set<string>;
  groupDay: Map<string, number>;
  groupDayPeriods: Map<string, number>;
  // Per group: how many placements start at each sequence (the group's "columns").
  // Drives the column-consistency placement bias (keep a subject in one period column).
  groupCol: Map<string, Map<number, number>>;
  teacherOcc: Map<string, Occ[]>;
  placements: Placement[];
}

class Solver {
  private input: SolverInput;
  private hardByTeacher: Map<string, SolverTeacherConstraint[]>;
  private deadline: number;
  // Cohort lockstep: each class -> its co-scheduled sibling classes. Used to bias
  // a member's own lessons toward slots where siblings are already busy.
  private siblingsByClass: Map<string, string[]>;
  // Teacher availability whitelist: teacher -> allowed "day|sequence" set. When present,
  // the teacher may ONLY be placed in those slots.
  private allowedByTeacher: Map<string, Set<string>>;
  // The "flex tail": last 2 teaching slots of each day ("day|seq"). Column-consistency
  // prefers a subject's home column to be OUTSIDE this set (the tail absorbs overflow).
  private flexSeqs: Set<string>;

  constructor(input: SolverInput) {
    this.input = input;
    this.hardByTeacher = new Map();
    for (const c of input.constraints) {
      if (c.hardness !== "hard") continue;
      if (!this.hardByTeacher.has(c.teacherId))
        this.hardByTeacher.set(c.teacherId, []);
      this.hardByTeacher.get(c.teacherId)!.push(c);
    }
    this.allowedByTeacher = availableSlotsByTeacher(input.constraints);
    this.siblingsByClass = new Map();
    for (const group of input.cohorts ?? []) {
      for (const c of group) {
        this.siblingsByClass.set(
          c,
          group.filter((o) => o !== c),
        );
      }
    }
    this.flexSeqs = new Set();
    for (const d of input.grid.days) {
      const teaching = d.slots
        .filter((s) => s.slotType === "teaching")
        .map((s) => s.sequence)
        .sort((a, b) => a - b);
      for (const seq of teaching.slice(-2))
        this.flexSeqs.add(`${d.dayOfWeek}|${seq}`);
    }
    this.deadline = Date.now() + (input.timeBudgetMs ?? 8000);
  }

  // How many (sibling, slot) pairs a candidate position would line up with — i.e.
  // place this lesson where its cohort siblings are already busy (keeps them in sync).
  private siblingAlignment(
    lesson: Lesson,
    day: number,
    pos: StartPosition,
    state: State,
  ): number {
    let score = 0;
    for (const c of classesOf(lesson)) {
      const sibs = this.siblingsByClass.get(c);
      if (!sibs) continue;
      for (const sib of sibs) {
        for (let k = 0; k < lesson.size; k++) {
          if (state.classBusy.has(`${sib}|${day}|${pos.startSequence + k}`))
            score++;
        }
      }
    }
    return score;
  }

  private positionsFor(lesson: Lesson): StartPosition[] {
    if (lesson.pinnedDay) {
      const day = getDay(this.input.grid, lesson.pinnedDay);
      if (!day) return [];
      const first = firstTeachingSlot(day);
      if (!first) return [];
      return [
        {
          startSequence: first.sequence,
          slotIds: [first.slotId],
          ...({ dayOfWeek: lesson.pinnedDay } as any),
        },
      ];
    }
    const positions: StartPosition[] = [];
    for (const day of this.input.grid.days) {
      for (const pos of startPositions(day, lesson.size)) {
        positions.push({ ...pos, ...({ dayOfWeek: day.dayOfWeek } as any) });
      }
    }
    return positions;
  }

  private dayOf(pos: StartPosition): number {
    return (pos as any).dayOfWeek;
  }

  private canPlace(
    lesson: Lesson,
    day: number,
    pos: StartPosition,
    state: State,
  ): boolean {
    // every co-scheduled class free
    for (const c of classesOf(lesson)) {
      for (let k = 0; k < lesson.size; k++) {
        if (state.classBusy.has(`${c}|${day}|${pos.startSequence + k}`))
          return false;
      }
    }
    // teachers free
    for (const t of lesson.teacherIds) {
      for (let k = 0; k < lesson.size; k++) {
        if (state.teacherBusy.has(`${t}|${day}|${pos.startSequence + k}`))
          return false;
      }
    }
    // teacher availability whitelist: a teacher with an allowed-set may ONLY teach there.
    for (const t of lesson.teacherIds) {
      const allowed = this.allowedByTeacher.get(t);
      if (!allowed) continue;
      for (let k = 0; k < lesson.size; k++) {
        if (!allowed.has(`${day}|${pos.startSequence + k}`)) return false;
      }
    }
    // group block rules
    if (lesson.groupKey) {
      const key = `${lesson.groupKey}|${day}`;
      const count = state.groupDay.get(key) || 0;
      if (lesson.notTwiceSameDay && count >= 1) return false;
      if (lesson.maxPerDay !== undefined && count + 1 > lesson.maxPerDay)
        return false;
      // hard cap on PERIODS/day for this subject (a double = 2 periods)
      if (lesson.maxPeriodsPerDay !== undefined) {
        const periods = state.groupDayPeriods.get(key) || 0;
        if (periods + lesson.size > lesson.maxPeriodsPerDay) return false;
      }
    }
    // hard teacher constraints (re-check affected teachers with tentative occ)
    for (const t of lesson.teacherIds) {
      const constraints = this.hardByTeacher.get(t);
      if (!constraints || constraints.length === 0) continue;
      const tentative: Occ[] = (state.teacherOcc.get(t) || []).slice();
      for (let k = 0; k < lesson.size; k++) {
        tentative.push({
          teacherId: t,
          classId: lesson.classId,
          day,
          sequence: pos.startSequence + k,
          slotId: pos.slotIds[k],
        });
      }
      for (const c of constraints) {
        if (violationMessage(tentative, c)) return false;
      }
    }
    return true;
  }

  private apply(
    lesson: Lesson,
    day: number,
    pos: StartPosition,
    state: State,
  ): Placement {
    const classes = classesOf(lesson);
    for (let k = 0; k < lesson.size; k++) {
      const seq = pos.startSequence + k;
      // every co-scheduled class is busy in this slot...
      for (const c of classes) state.classBusy.add(`${c}|${day}|${seq}`);
      // ...but each teacher is booked only once (one room, combined cohort).
      for (const t of lesson.teacherIds) {
        state.teacherBusy.add(`${t}|${day}|${seq}`);
        if (!state.teacherOcc.has(t)) state.teacherOcc.set(t, []);
        state.teacherOcc
          .get(t)!
          .push({
            teacherId: t,
            classId: lesson.classId,
            day,
            sequence: seq,
            slotId: pos.slotIds[k],
          });
      }
    }
    if (lesson.groupKey) {
      const key = `${lesson.groupKey}|${day}`;
      state.groupDay.set(key, (state.groupDay.get(key) || 0) + 1);
      state.groupDayPeriods.set(
        key,
        (state.groupDayPeriods.get(key) || 0) + lesson.size,
      );
      if (!state.groupCol.has(lesson.groupKey))
        state.groupCol.set(lesson.groupKey, new Map());
      const cm = state.groupCol.get(lesson.groupKey)!;
      cm.set(pos.startSequence, (cm.get(pos.startSequence) || 0) + 1);
    }
    const placement: Placement = {
      lessonId: lesson.id,
      classId: lesson.classId,
      classIds: lesson.classIds,
      dayOfWeek: day,
      startSequence: pos.startSequence,
      slotIds: pos.slotIds,
      offerings: lesson.offerings,
      size: lesson.size,
      bandId: lesson.bandId,
    };
    state.placements.push(placement);
    return placement;
  }

  private undo(
    lesson: Lesson,
    day: number,
    pos: StartPosition,
    state: State,
  ): void {
    const classes = classesOf(lesson);
    for (let k = 0; k < lesson.size; k++) {
      const seq = pos.startSequence + k;
      for (const c of classes) state.classBusy.delete(`${c}|${day}|${seq}`);
      for (const t of lesson.teacherIds) {
        state.teacherBusy.delete(`${t}|${day}|${seq}`);
        const occ = state.teacherOcc.get(t)!;
        occ.pop();
      }
    }
    if (lesson.groupKey) {
      const key = `${lesson.groupKey}|${day}`;
      state.groupDay.set(key, (state.groupDay.get(key) || 0) - 1);
      state.groupDayPeriods.set(
        key,
        (state.groupDayPeriods.get(key) || 0) - lesson.size,
      );
      const cm = state.groupCol.get(lesson.groupKey);
      if (cm) cm.set(pos.startSequence, (cm.get(pos.startSequence) || 0) - 1);
    }
    state.placements.pop();
  }

  // Backtracking with MRV (fewest feasible positions first) + randomized tie-break.
  private backtrack(
    remaining: Lesson[],
    state: State,
    rnd: () => number,
  ): boolean {
    if (remaining.length === 0) return true;
    if (Date.now() > this.deadline) return false;

    // MRV: choose the lesson with the fewest currently-feasible positions.
    let bestIdx = -1;
    let bestPositions: { day: number; pos: StartPosition }[] | null = null;
    for (let i = 0; i < remaining.length; i++) {
      const lesson = remaining[i];
      const feasible: { day: number; pos: StartPosition }[] = [];
      for (const pos of this.positionsFor(lesson)) {
        const day = this.dayOf(pos);
        if (this.canPlace(lesson, day, pos, state)) feasible.push({ day, pos });
      }
      if (feasible.length === 0) return false; // dead end
      if (bestPositions === null || feasible.length < bestPositions.length) {
        bestPositions = feasible;
        bestIdx = i;
        if (feasible.length === 1) break; // can't do better
      }
    }

    const lesson = remaining[bestIdx];
    const rest = remaining
      .slice(0, bestIdx)
      .concat(remaining.slice(bestIdx + 1));

    // Try preferred positions first, then a shuffled remainder.
    const preferred = bestPositions!.filter((c) =>
      lesson.prefer?.some(
        (p) => p.day === c.day && p.slot === c.pos.startSequence,
      ),
    );
    // Keep the original PRNG call order (preferred shuffled, then others) so
    // non-cohort solves are byte-for-byte unchanged.
    const preferredShuffled = shuffle(preferred, rnd);
    let others = shuffle(
      bestPositions!.filter((c) => !preferred.includes(c)),
      rnd,
    );
    // Bias the candidate order (stable over the shuffle, so restart diversity is kept):
    //  1) column consistency — cluster a group into the period-column it already uses,
    //     and prefer a home column OUTSIDE the flex tail;
    //  2) cohort lockstep — prefer slots where co-scheduled siblings are already busy.
    const usesCohort =
      this.siblingsByClass.size > 0 &&
      classesOf(lesson).some((c) => this.siblingsByClass.has(c));
    if (lesson.groupKey || usesCohort) {
      const cols = lesson.groupKey
        ? state.groupCol.get(lesson.groupKey)
        : undefined;
      others = others
        .map((c) => {
          const seq = c.pos.startSequence;
          return {
            c,
            colAff: cols?.get(seq) || 0,
            flexPen: this.flexSeqs.has(`${c.day}|${seq}`) ? 1 : 0,
            sib: usesCohort ? this.siblingAlignment(lesson, c.day, c.pos, state) : 0,
          };
        })
        .sort(
          (x, y) =>
            y.colAff - x.colAff || x.flexPen - y.flexPen || y.sib - x.sib,
        )
        .map((x) => x.c);
    }
    const ordered = [...preferredShuffled, ...others];

    for (const choice of ordered) {
      this.apply(lesson, choice.day, choice.pos, state);
      if (this.backtrack(rest, state, rnd)) return true;
      this.undo(lesson, choice.day, choice.pos, state);
      if (Date.now() > this.deadline) return false;
    }
    return false;
  }

  public solveOnce(seed: number): Timetable | null {
    const rnd = mulberry32(seed);
    const state: State = {
      classBusy: new Set(),
      teacherBusy: new Set(),
      groupDay: new Map(),
      groupDayPeriods: new Map(),
      groupCol: new Map(),
      teacherOcc: new Map(),
      placements: [],
    };
    // Pins first (fixed), then doubles, then singles; shuffle within tiers.
    const pins = this.input.lessons.filter((l) => l.pinnedDay);
    const rest = this.input.lessons
      .filter((l) => !l.pinnedDay)
      .sort((a, b) => b.size - a.size);
    const ordered = [...pins, ...shuffle(rest, rnd)];
    const ok = this.backtrack(ordered, state, rnd);
    if (!ok) return null;
    return { placements: state.placements };
  }
}

// Run multiple seeded restarts, keep the top-N distinct candidates by score.
export function solve(input: SolverInput, numCandidates = 3): SolveResult {
  const solver = new Solver(input);
  const restarts = Math.max(numCandidates * 4, 8);
  const found: Timetable[] = [];
  const signatures = new Set<string>();

  for (let i = 0; i < restarts; i++) {
    const seed = (input.seed ?? 1) * 1000 + i;
    const tt = solver.solveOnce(seed);
    if (!tt) continue;
    const sig = tt.placements
      .map((p) => `${p.lessonId}@${p.dayOfWeek}:${p.startSequence}`)
      .sort()
      .join("|");
    if (signatures.has(sig)) continue;
    signatures.add(sig);
    found.push(tt);
  }

  if (found.length === 0) {
    return {
      feasible: false,
      candidates: [],
      reason:
        "No timetable satisfied all hard constraints within the time budget.",
    };
  }

  const scored: ScoredTimetable[] = found
    .map((tt) => {
      const s = scoreTimetable(input, tt);
      return { timetable: tt, score: s.score, breakdown: s.breakdown };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, numCandidates);

  return { feasible: true, candidates: scored };
}
