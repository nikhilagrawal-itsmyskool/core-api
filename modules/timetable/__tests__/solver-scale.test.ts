import {
  solve,
  validateTimetable,
  checkFeasibility,
  buildLessons,
  classesOf,
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

// Composite-class variant: same full-school scale, but the two senior classes
// (C23 + C24) run as a COHORT — a composite class like XI-A. They share two
// cross-class bands (one shared single + one 3-offering parallel block), each
// booked in BOTH classes at the same slot, and keep their own stream subjects.
// This stresses the cross-class co-scheduling path at scale.
const COHORT = {
  members: ["C23", "C24"],
  ownSubjects: 6, // per member: 6×6 = 36 own periods
  sharedSinglePeriods: 6, // band-of-one (like English), 1 offering
  bandPeriods: 6, // 3-offering parallel block (like Maths/Bio/Acc)
  bandOfferings: 3,
}; // each member: 36 own + 6 + 6 = 48 (same 20% slack as the others)

function buildCohortInput(): SolverInput {
  const classIds = Array.from({ length: NUM_CLASSES }, (_, i) => `C${i}`);
  const classSubjects: any[] = [];
  const teachingAssignments: any[] = [];
  const classTeachers: any[] = [];
  const electiveBands: any[] = [];
  const teacherLoad = new Array(NUM_TEACHERS).fill(0);
  const cohortSet = new Set(COHORT.members);

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
    // Cohort members carry only their OWN subjects here (shared bands added below);
    // every other class is identical to the baseline scale scenario.
    const subjectCount = cohortSet.has(classId)
      ? COHORT.ownSubjects
      : SUBJECTS_PER_CLASS;
    const subs = Array.from(
      { length: subjectCount },
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
        teacher = i; // distinct class teacher per class (two homerooms for the cohort)
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

  // Two cross-class bands over the cohort members (classIds = both). A band teacher
  // is booked ONCE for the shared slots regardless of how many classes attend.
  const usedBandTeachers = new Set<number>();
  const engT = leastLoaded(usedBandTeachers);
  usedBandTeachers.add(engT);
  teacherLoad[engT] += COHORT.sharedSinglePeriods;
  electiveBands.push({
    bandId: "BENG",
    classIds: COHORT.members,
    periodsPerWeek: COHORT.sharedSinglePeriods,
    offerings: [{ subjectId: "S40", teacherId: `T${engT}` }],
  });
  const mbaOfferings: any[] = [];
  for (let j = 0; j < COHORT.bandOfferings; j++) {
    const t = leastLoaded(usedBandTeachers);
    usedBandTeachers.add(t);
    teacherLoad[t] += COHORT.bandPeriods;
    mbaOfferings.push({ subjectId: `S${41 + j}`, teacherId: `T${t}` });
  }
  electiveBands.push({
    bandId: "BMBA",
    classIds: COHORT.members,
    periodsPerWeek: COHORT.bandPeriods,
    offerings: mbaOfferings,
  });

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
    constraints: [],
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

    it("solves the composite-class variant (a cohort of 2 senior classes)", () => {
      const input = buildCohortInput();

      const feas = checkFeasibility(input);
      expect(feas.feasible).toBe(true);

      const started = Date.now();
      const result = solve(input, 1);
      const elapsed = Date.now() - started;
      // eslint-disable-next-line no-console
      console.log(
        `cohort solve: lessons=${input.lessons.length} cohort=${COHORT.members.join("+")} elapsed=${elapsed}ms feasible=${result.feasible}`,
      );

      expect(result.feasible).toBe(true);
      expect(result.candidates.length).toBeGreaterThan(0);
      const tt = result.candidates[0].timetable;
      // Independent oracle: no class/teacher double-book (the validator checks every
      // co-scheduled class), all lessons placed, pins honored.
      expect(validateTimetable(input, tt)).toEqual([]);

      // Cross-class guarantee: each cohort placement occupies BOTH members at the
      // same slot (12 shared periods: 6 shared-single + 6 band).
      const cohortPlacements = tt.placements.filter(
        (p) => classesOf(p).length > 1,
      );
      expect(cohortPlacements.length).toBe(
        COHORT.sharedSinglePeriods + COHORT.bandPeriods,
      );
      for (const p of cohortPlacements) {
        expect(classesOf(p).slice().sort()).toEqual(COHORT.members.slice().sort());
      }
      // Both members fully scheduled to 48 (36 own + 12 shared).
      const per = new Map<string, number>();
      for (const p of tt.placements) {
        for (const c of classesOf(p)) per.set(c, (per.get(c) || 0) + p.size);
      }
      expect(per.get("C23")).toBe(48);
      expect(per.get("C24")).toBe(48);
    }, 120000);
  },
);
