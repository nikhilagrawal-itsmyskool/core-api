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

// Stressed variant: adds elective bands (co-scheduled, multi-teacher) to the
// senior classes and HARD teacher constraints (day-off + unavailable slots) to
// non-class-teachers (class teachers are pinned every teaching day, so they
// cannot take a day off). Tunable so we can find the breaking point.
const STRESS = {
  electiveClasses: 5, // top N classes get an elective band
  bandPeriods: 6,
  bandOfferings: 3, // subjects (and teachers) co-scheduled in the band
  dayOffTeachers: 12, // non-CT teachers each given one hard day_off
  unavailableSlots: 10, // hard unavailable (day, slot) constraints
};

function buildStressedInput(): SolverInput {
  const classIds = Array.from({ length: NUM_CLASSES }, (_, i) => `C${i}`);
  const classSubjects: any[] = [];
  const teachingAssignments: any[] = [];
  const classTeachers: any[] = [];
  const electiveBands: any[] = [];
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
    const isElective = i >= NUM_CLASSES - STRESS.electiveClasses;
    // Elective classes: 7 regular subjects (42) + a 6-period band = 48.
    // Others: 8 regular subjects = 48. Both keep ~20% slack.
    const regularCount = isElective ? 7 : SUBJECTS_PER_CLASS;
    const subs = Array.from(
      { length: regularCount },
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
        teacher = i; // distinct class teacher per class (T0..T24)
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

    if (isElective) {
      const offerings: any[] = [];
      for (let j = 0; j < STRESS.bandOfferings; j++) {
        const subjectId = `S${(i * 3 + regularCount + j) % NUM_SUBJECTS}`;
        const t = leastLoaded(usedTeachers);
        usedTeachers.add(t);
        teacherLoad[t] += STRESS.bandPeriods;
        offerings.push({ subjectId, teacherId: `T${t}` });
      }
      electiveBands.push({
        bandId: `B${i}`,
        classId,
        periodsPerWeek: STRESS.bandPeriods,
        offerings,
      });
    }
  }

  // Hard teacher constraints — non-CT teachers only (T25..T49).
  const constraints: any[] = [];
  for (let j = 0; j < STRESS.dayOffTeachers; j++) {
    constraints.push({
      teacherId: `T${25 + (j % 25)}`,
      type: "day_off",
      value: { day: 2 + (j % 5) }, // spread across Tue..Sat
      hardness: "hard",
    });
  }
  for (let j = 0; j < STRESS.unavailableSlots; j++) {
    constraints.push({
      teacherId: `T${25 + ((j + 13) % 25)}`,
      type: "unavailable_slot",
      value: { day: 1 + (j % 6), slot: 1 + (j % 10) },
      hardness: "hard",
    });
  }

  const { lessons } = buildLessons({
    classIds,
    teachingDays: DAYS,
    classSubjects,
    teachingAssignments,
    classTeachers,
    electiveBands,
  });

  return {
    classIds,
    grid: makeGrid(),
    lessons,
    constraints,
    seed: 7,
    timeBudgetMs: 60000,
  };
}

// Slow (tens of seconds): opt-in only so the normal suite stays fast.
// Run with:  set RUN_SOLVER_SCALE=1 && node node_modules/jest/bin/jest.js solver-scale
// Empirical profile (1200 lessons), production budget = 45s (SOLVE_TIME_BUDGET_MS):
//   - friendly (no electives/constraints): infeasible ≤15s, solves ~15-25s → ~2x margin.
//   - stressed (5 elective bands + 22 hard teacher constraints): infeasible ≤25s,
//     solves ~25-35s → margin down to ~1.3x. A bigger/more-constrained school would
//     likely blow the 45s budget and return blank — revisit solver perf first.
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

    it("solves the stressed variant (electives + hard teacher constraints)", () => {
      const input = buildStressedInput();

      const feas = checkFeasibility(input);
      // eslint-disable-next-line no-console
      console.log(
        `stressed feasibility: ${feas.feasible} ${feas.feasible ? "" : feas.issues.join(" | ")}`,
      );
      expect(feas.feasible).toBe(true);

      const started = Date.now();
      const result = solve(input, 1);
      const elapsed = Date.now() - started;
      // eslint-disable-next-line no-console
      console.log(
        `stressed solve: lessons=${input.lessons.length} bands=${STRESS.electiveClasses} constraints=${input.constraints.length} elapsed=${elapsed}ms feasible=${result.feasible}`,
      );

      expect(result.feasible).toBe(true);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(validateTimetable(input, result.candidates[0].timetable)).toEqual(
        [],
      );
    }, 120000);
  },
);
