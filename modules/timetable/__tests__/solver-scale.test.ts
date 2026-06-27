import {
  solve,
  validateTimetable,
  checkFeasibility,
  buildLessons,
  SolverGrid,
  SolverInput,
} from "../solver";

// Full-school scale scenario: 6 days × 10 periods, 25 classes, 50 teachers,
// 50 subjects. Deterministically constructed to be FEASIBLE (not random — random
// data would be over-constrained and prove nothing):
//   - each class takes 8 subjects × 6 periods = 48 periods in a 60-slot week
//     (20% slack, like real schools with free/study periods),
//   - each class has a DISTINCT class teacher (T0..T24) so the first-period pins
//     at slot 1 never collide,
//   - the pinned subject supplies exactly 6 periods (one pin per teaching day),
//   - remaining subject-teaching is spread to the least-loaded teacher so no
//     teacher is overloaded (~24 periods each ≈ 40% load).
const DAYS = [1, 2, 3, 4, 5, 6];
const PERIODS = 10;
const NUM_CLASSES = 25;
const NUM_TEACHERS = 50;
const NUM_SUBJECTS = 50;
const SUBJECTS_PER_CLASS = 8;
const PERIODS_PER_SUBJECT = 6;

function makeGrid(): SolverGrid {
  return {
    days: DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      slots: Array.from({ length: PERIODS }, (_, i) => ({
        slotId: `d${dayOfWeek}s${i + 1}`,
        sequence: i + 1,
        slotType: "teaching" as const,
      })),
    })),
  };
}

function buildScaleInput(): SolverInput {
  const classIds = Array.from({ length: NUM_CLASSES }, (_, i) => `C${i}`);
  const classSubjects: any[] = [];
  const teachingAssignments: any[] = [];
  const classTeachers: any[] = [];
  const teacherLoad = new Array(NUM_TEACHERS).fill(0);

  const leastLoaded = (avoid: Set<number>): number => {
    let best = -1;
    for (let t = 0; t < NUM_TEACHERS; t++) {
      if (avoid.has(t)) continue;
      if (best < 0 || teacherLoad[t] < teacherLoad[best]) best = t;
    }
    return best;
  };

  for (let i = 0; i < NUM_CLASSES; i++) {
    const classId = `C${i}`;
    // 8 distinct subjects per class (overlapping across classes is fine).
    const subs = Array.from(
      { length: SUBJECTS_PER_CLASS },
      (_, k) => `S${(i * 3 + k) % NUM_SUBJECTS}`,
    );
    const usedTeachers = new Set<number>();

    for (let k = 0; k < subs.length; k++) {
      classSubjects.push({
        classId,
        subjectId: subs[k],
        periodsPerWeek: PERIODS_PER_SUBJECT,
      });

      let teacher: number;
      if (k === 0) {
        // The pinned class-teacher subject: a distinct teacher per class.
        teacher = i;
        classTeachers.push({
          classId,
          teacherId: `T${teacher}`,
          firstPeriodSubjectId: subs[0],
        });
      } else {
        teacher = leastLoaded(usedTeachers);
      }
      usedTeachers.add(teacher);
      teacherLoad[teacher] += PERIODS_PER_SUBJECT;
      teachingAssignments.push({
        classId,
        subjectId: subs[k],
        teacherId: `T${teacher}`,
      });
    }
  }

  const { lessons } = buildLessons({
    classIds,
    teachingDays: DAYS,
    classSubjects,
    teachingAssignments,
    classTeachers,
    electiveBands: [],
  });

  return {
    classIds,
    grid: makeGrid(),
    lessons,
    constraints: [],
    seed: 7,
    timeBudgetMs: 60000,
  };
}

// Slow (tens of seconds): opt-in only so the normal suite stays fast.
// Run with:  set RUN_SOLVER_SCALE=1 && node node_modules/jest/bin/jest.js solver-scale
// Empirical profile (1200 lessons): infeasible <15s, solves ~15-25s, production
// budget is 45s (SOLVE_TIME_BUDGET_MS) — ~2x margin for this slack/constraint level.
const scaleDescribe = process.env.RUN_SOLVER_SCALE ? describe : describe.skip;

scaleDescribe(
  "solver — full-school scale (25 classes / 50 teachers / 50 subjects / 6×10)",
  () => {
    it("is feasible, solves within budget, and the result passes the validator", () => {
      const input = buildScaleInput();

      const feas = checkFeasibility(input);
      expect(feas.feasible).toBe(true);

      const started = Date.now();
      const result = solve(input, 1);
      const elapsed = Date.now() - started;
      // eslint-disable-next-line no-console
      console.log(
        `scale solve: lessons=${input.lessons.length} elapsed=${elapsed}ms feasible=${result.feasible}`,
      );

      expect(result.feasible).toBe(true);
      expect(result.candidates.length).toBeGreaterThan(0);
      // Independent oracle: zero hard-rule violations, every lesson placed, pins honored.
      expect(validateTimetable(input, result.candidates[0].timetable)).toEqual(
        [],
      );
    }, 120000);
  },
);
