import {
  solve,
  validateTimetable,
  checkFeasibility,
  buildLessons,
  scoreTimetable,
  SolverGrid,
  SolverInput,
  Lesson,
} from "../solver";

// A simple uniform grid: `days` weekdays, each with `periods` teaching slots
// (sequences 1..periods). Slot ids are deterministic: d{day}s{seq}.
function makeGrid(days: number[], periods: number): SolverGrid {
  return {
    days: days.map((dayOfWeek) => ({
      dayOfWeek,
      slots: Array.from({ length: periods }, (_, i) => ({
        slotId: `d${dayOfWeek}s${i + 1}`,
        sequence: i + 1,
        slotType: "teaching" as const,
      })),
    })),
  };
}

describe("solver — build-lessons", () => {
  it("creates one class-teacher pin per teaching day plus remainder singles", () => {
    const { lessons, warnings } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [{ classId: "C1", subjectId: "ENG", periodsPerWeek: 6 }],
      teachingAssignments: [
        { classId: "C1", subjectId: "ENG", teacherId: "T1" },
      ],
      classTeachers: [{ classId: "C1", teacherId: "T1" }],
      electiveBands: [],
    });
    const pins = lessons.filter((l) => l.pinnedDay);
    expect(pins.length).toBe(5); // one per teaching day
    expect(lessons.length).toBe(6); // 5 pins + 1 remainder
    expect(warnings).toEqual([]);
  });

  it("expands doubles from block rules", () => {
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [
        {
          classId: "C1",
          subjectId: "PHY",
          periodsPerWeek: 10,
          blockRules: {
            blocks: [
              { size: 2, count: 2 },
              { size: 1, count: 6 },
            ],
          },
        },
      ],
      teachingAssignments: [
        { classId: "C1", subjectId: "PHY", teacherId: "T2" },
      ],
      classTeachers: [],
      electiveBands: [],
    });
    expect(lessons.filter((l) => l.size === 2).length).toBe(2);
    expect(lessons.filter((l) => l.size === 1).length).toBe(6);
  });

  it("builds co-scheduled band lessons carrying every offering", () => {
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3],
      classSubjects: [],
      teachingAssignments: [],
      classTeachers: [],
      electiveBands: [
        {
          bandId: "B1",
          classId: "C1",
          periodsPerWeek: 3,
          offerings: [
            { subjectId: "PHY", teacherId: "T1" },
            { subjectId: "BIO", teacherId: "T2" },
          ],
        },
      ],
    });
    expect(lessons.length).toBe(3);
    expect(lessons[0].offerings.length).toBe(2);
    expect(lessons[0].teacherIds.sort()).toEqual(["T1", "T2"]);
    expect(lessons[0].bandId).toBe("B1");
  });
});

describe("solver — no-teacher subjects (a)", () => {
  it("schedules a subject with no teaching assignment as teacher-less lessons", () => {
    const { lessons, warnings } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [{ classId: "C1", subjectId: "STUDY", periodsPerWeek: 3 }],
      teachingAssignments: [], // no teacher
      classTeachers: [],
      electiveBands: [],
    });
    expect(lessons.length).toBe(3); // not skipped
    expect(lessons.every((l) => l.teacherIds.length === 0)).toBe(true);
    expect(lessons.every((l) => l.offerings[0].teacherId === null)).toBe(true);
    expect(warnings.join(" ")).toMatch(/teacher-less/);
  });

  it("does not treat two different teacher-less periods as a teacher clash", () => {
    const grid = makeGrid([1], 1); // single slot, both classes must use it
    const { lessons } = buildLessons({
      classIds: ["C1", "C2"],
      teachingDays: [1],
      classSubjects: [
        { classId: "C1", subjectId: "STUDY", periodsPerWeek: 1 },
        { classId: "C2", subjectId: "STUDY", periodsPerWeek: 1 },
      ],
      teachingAssignments: [],
      classTeachers: [],
      electiveBands: [],
    });
    const input: SolverInput = {
      classIds: ["C1", "C2"],
      grid,
      lessons,
      constraints: [],
      seed: 1,
    };
    const result = solve(input, 1);
    expect(result.feasible).toBe(true); // both fit the same slot — no phantom teacher clash
    expect(
      validateTimetable(input, result.candidates[0].timetable, false),
    ).toEqual([]);
  });
});

describe("solver — admin-selectable first-period subject (c)", () => {
  const base = {
    classIds: ["C1"],
    teachingDays: [1, 2, 3, 4, 5],
    classSubjects: [
      { classId: "C1", subjectId: "ENG", periodsPerWeek: 6 }, // most periods → auto pick
      { classId: "C1", subjectId: "LIB", periodsPerWeek: 2 },
    ],
    teachingAssignments: [
      { classId: "C1", subjectId: "ENG", teacherId: "T1" },
      { classId: "C1", subjectId: "LIB", teacherId: "T1" },
    ],
    electiveBands: [],
  };

  it("auto-picks the class teacher subject with the most periods/week", () => {
    const { lessons } = buildLessons({
      ...base,
      classTeachers: [{ classId: "C1", teacherId: "T1" }],
    });
    const pins = lessons.filter((l) => l.pinnedDay);
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((l) => l.offerings[0].subjectId === "ENG")).toBe(true);
  });

  it("honors an explicit firstPeriodSubjectId over the auto pick", () => {
    const { lessons } = buildLessons({
      ...base,
      classTeachers: [
        { classId: "C1", teacherId: "T1", firstPeriodSubjectId: "LIB" },
      ],
    });
    const pins = lessons.filter((l) => l.pinnedDay);
    expect(pins.every((l) => l.offerings[0].subjectId === "LIB")).toBe(true);
  });

  it("falls back to auto (with a warning) when the chosen subject is not taught by the class teacher", () => {
    const { lessons, warnings } = buildLessons({
      ...base,
      classTeachers: [
        { classId: "C1", teacherId: "T1", firstPeriodSubjectId: "NOPE" },
      ],
    });
    const pins = lessons.filter((l) => l.pinnedDay);
    expect(pins.every((l) => l.offerings[0].subjectId === "ENG")).toBe(true);
    expect(warnings.join(" ")).toMatch(/falling back to the auto pick/);
  });
});

describe("solver — per-weekday class-teacher first period (firstPeriodDays)", () => {
  const base = {
    classIds: ["C1"],
    teachingDays: [1, 2, 3, 4, 5],
    classSubjects: [{ classId: "C1", subjectId: "ENG", periodsPerWeek: 6 }],
    teachingAssignments: [{ classId: "C1", subjectId: "ENG", teacherId: "T1" }],
    electiveBands: [],
  };

  it("pins only the configured weekdays, leaving the rest open", () => {
    const { lessons } = buildLessons({
      ...base,
      classTeachers: [
        { classId: "C1", teacherId: "T1", firstPeriodDays: [1, 3, 5] },
      ],
    });
    const pins = lessons.filter((l) => l.pinnedDay);
    expect(pins.length).toBe(3);
    expect(pins.map((l) => l.pinnedDay).sort()).toEqual([1, 3, 5]);
    // 6 periods total: 3 pinned + 3 unpinned singles
    expect(lessons.filter((l) => !l.pinnedDay).length).toBe(3);
  });

  it("creates no first-period pin when firstPeriodDays is empty (class teacher floats)", () => {
    const { lessons } = buildLessons({
      ...base,
      classTeachers: [{ classId: "C1", teacherId: "T1", firstPeriodDays: [] }],
    });
    expect(lessons.filter((l) => l.pinnedDay).length).toBe(0);
    expect(lessons.length).toBe(6); // all unpinned singles
  });

  it("pins every teaching day when firstPeriodDays is null (default behavior)", () => {
    const { lessons } = buildLessons({
      ...base,
      classTeachers: [
        { classId: "C1", teacherId: "T1", firstPeriodDays: null },
      ],
    });
    expect(lessons.filter((l) => l.pinnedDay).length).toBe(5);
  });

  it("solver leaves the excepted day's first period open and pins the others", () => {
    const grid = makeGrid([1, 2, 3, 4, 5], 6);
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [
        { classId: "C1", subjectId: "ENG", periodsPerWeek: 6 }, // homeroom (T1)
        { classId: "C1", subjectId: "MATH", periodsPerWeek: 6 },
        { classId: "C1", subjectId: "SCI", periodsPerWeek: 6 },
      ],
      teachingAssignments: [
        { classId: "C1", subjectId: "ENG", teacherId: "T1" },
        { classId: "C1", subjectId: "MATH", teacherId: "T2" },
        { classId: "C1", subjectId: "SCI", teacherId: "T3" },
      ],
      classTeachers: [
        { classId: "C1", teacherId: "T1", firstPeriodDays: [1, 2, 4, 5] },
      ], // not day 3
      electiveBands: [],
    });
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      lessons,
      constraints: [],
      seed: 9,
    };
    const result = solve(input, 1);
    expect(result.feasible).toBe(true);
    const tt = result.candidates[0].timetable;
    expect(validateTimetable(input, tt)).toEqual([]);
    for (const day of [1, 2, 4, 5]) {
      const first = tt.placements.find(
        (p) => p.dayOfWeek === day && p.startSequence === 1,
      );
      expect(first!.offerings[0].teacherId).toBe("T1");
    }
    // Day 3 first period may be any teacher — not forced to the class teacher.
  });
});

describe("solver — solve produces valid timetables", () => {
  function buildInput(): SolverInput {
    const grid = makeGrid([1, 2, 3, 4, 5], 6); // 30 slots
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [
        { classId: "C1", subjectId: "ENG", periodsPerWeek: 6 }, // homeroom (T1)
        { classId: "C1", subjectId: "MATH", periodsPerWeek: 6 },
        {
          classId: "C1",
          subjectId: "PHY",
          periodsPerWeek: 6,
          blockRules: {
            blocks: [
              { size: 2, count: 1 },
              { size: 1, count: 4 },
            ],
          },
        },
      ],
      teachingAssignments: [
        { classId: "C1", subjectId: "ENG", teacherId: "T1" },
        { classId: "C1", subjectId: "MATH", teacherId: "T2" },
        { classId: "C1", subjectId: "PHY", teacherId: "T3" },
      ],
      classTeachers: [{ classId: "C1", teacherId: "T1" }],
      electiveBands: [],
    });
    return { classIds: ["C1"], grid, lessons, constraints: [], seed: 7 };
  }

  it("feasibility passes and solve output passes the independent validator", () => {
    const input = buildInput();
    expect(checkFeasibility(input).feasible).toBe(true);
    const result = solve(input, 3);
    expect(result.feasible).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const cand of result.candidates) {
      expect(validateTimetable(input, cand.timetable)).toEqual([]);
    }
  });

  it("pins the class teacher into the first period of every teaching day", () => {
    const input = buildInput();
    const result = solve(input, 1);
    const tt = result.candidates[0].timetable;
    for (const day of [1, 2, 3, 4, 5]) {
      const first = tt.placements.find(
        (p) =>
          p.dayOfWeek === day && p.startSequence === 1 && p.classId === "C1",
      );
      expect(first).toBeDefined();
      expect(first!.offerings[0].teacherId).toBe("T1"); // class teacher
    }
  });

  it("never double-books a teacher shared across two classes", () => {
    const grid = makeGrid([1, 2, 3, 4, 5], 6);
    const { lessons } = buildLessons({
      classIds: ["C1", "C2"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [
        { classId: "C1", subjectId: "MATH", periodsPerWeek: 6 },
        { classId: "C2", subjectId: "MATH", periodsPerWeek: 6 },
      ],
      teachingAssignments: [
        { classId: "C1", subjectId: "MATH", teacherId: "TM" },
        { classId: "C2", subjectId: "MATH", teacherId: "TM" }, // same teacher both classes
      ],
      classTeachers: [],
      electiveBands: [],
    });
    const input: SolverInput = {
      classIds: ["C1", "C2"],
      grid,
      lessons,
      constraints: [],
      seed: 3,
    };
    const result = solve(input, 1);
    expect(result.feasible).toBe(true);
    expect(
      validateTimetable(input, result.candidates[0].timetable, false),
    ).toEqual([]);
  });
});

describe("solver — max periods per day (hard cap, default 2)", () => {
  it("never places more than 2 periods of a subject in a day (default cap)", () => {
    const grid = makeGrid([1, 2, 3, 4, 5], 6);
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [
        { classId: "C1", subjectId: "MATH", periodsPerWeek: 7 }, // 7 over 5 days → one day needs 2
        { classId: "C1", subjectId: "ENG", periodsPerWeek: 5 },
      ],
      teachingAssignments: [
        { classId: "C1", subjectId: "MATH", teacherId: "T1" },
        { classId: "C1", subjectId: "ENG", teacherId: "T2" },
      ],
      classTeachers: [],
      electiveBands: [],
    });
    expect(lessons.every((l) => l.maxPeriodsPerDay === 2)).toBe(true);
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      lessons,
      constraints: [],
      seed: 4,
    };
    const result = solve(input, 1);
    expect(result.feasible).toBe(true);
    const tt = result.candidates[0].timetable;
    expect(validateTimetable(input, tt)).toEqual([]);
    const perDay = new Map<number, number>();
    for (const p of tt.placements.filter(
      (x) => x.offerings[0].subjectId === "MATH",
    )) {
      perDay.set(p.dayOfWeek, (perDay.get(p.dayOfWeek) || 0) + p.size);
    }
    expect([...perDay.values()].every((n) => n <= 2)).toBe(true);
  });

  it("honors a double (size 2) under the default cap of 2", () => {
    const grid = makeGrid([1, 2, 3, 4, 5], 6);
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [
        {
          classId: "C1",
          subjectId: "PHY",
          periodsPerWeek: 2,
          blockRules: { blocks: [{ size: 2, count: 1 }] },
        },
      ],
      teachingAssignments: [
        { classId: "C1", subjectId: "PHY", teacherId: "T1" },
      ],
      classTeachers: [],
      electiveBands: [],
    });
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      lessons,
      constraints: [],
      seed: 2,
    };
    const result = solve(input, 1);
    expect(result.feasible).toBe(true);
    const tt = result.candidates[0].timetable;
    expect(validateTimetable(input, tt)).toEqual([]);
    expect(
      tt.placements.find((p) => p.offerings[0].subjectId === "PHY")!.size,
    ).toBe(2);
  });

  it("feasibility flags a subject that needs more than cap × teaching-days", () => {
    const grid = makeGrid([1], 6); // a single teaching day
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1],
      classSubjects: [{ classId: "C1", subjectId: "MATH", periodsPerWeek: 3 }], // 3 > 2×1
      teachingAssignments: [
        { classId: "C1", subjectId: "MATH", teacherId: "T1" },
      ],
      classTeachers: [],
      electiveBands: [],
    });
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      lessons,
      constraints: [],
      seed: 1,
    };
    const feas = checkFeasibility(input);
    expect(feas.feasible).toBe(false);
    expect(feas.issues.join(" ")).toMatch(/cap of 2\/day/);
  });

  it("validator flags 3 periods of a subject on one day", () => {
    const grid = makeGrid([1], 6);
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      constraints: [],
      lessons: [0, 1, 2].map((i) => ({
        id: `L${i}`,
        classId: "C1",
        size: 1,
        offerings: [{ subjectId: "MATH", teacherId: "T1" }],
        teacherIds: ["T1"],
        groupKey: "cs:C1:MATH",
        maxPeriodsPerDay: 2,
      })) as Lesson[],
    };
    const broken = {
      placements: [1, 2, 3].map((seq, i) => ({
        lessonId: `L${i}`,
        classId: "C1",
        dayOfWeek: 1,
        startSequence: seq,
        slotIds: [`d1s${seq}`],
        offerings: [{ subjectId: "MATH", teacherId: "T1" }],
        size: 1,
      })),
    };
    const issues = validateTimetable(input, broken, false);
    expect(issues.some((i) => i.rule === "max_periods_per_day")).toBe(true);
  });
});

describe("solver — infeasibility & constraints", () => {
  it("reports infeasible when demand exceeds capacity (clean reason, no hang)", () => {
    const grid = makeGrid([1], 2); // only 2 slots
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      constraints: [],
      lessons: Array.from({ length: 5 }, (_, i) => ({
        id: `L${i}`,
        classId: "C1",
        size: 1,
        offerings: [{ subjectId: "X", teacherId: "T1" }],
        teacherIds: ["T1"],
      })) as Lesson[],
    };
    const feas = checkFeasibility(input);
    expect(feas.feasible).toBe(false);
    expect(feas.issues.join(" ")).toMatch(/needs 5 periods/);
  });

  it("honors a hard day_off constraint", () => {
    const grid = makeGrid([1, 2, 3, 4, 5], 6);
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [{ classId: "C1", subjectId: "MATH", periodsPerWeek: 6 }],
      teachingAssignments: [
        { classId: "C1", subjectId: "MATH", teacherId: "TM" },
      ],
      classTeachers: [],
      electiveBands: [],
    });
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      lessons,
      seed: 5,
      constraints: [
        {
          teacherId: "TM",
          type: "day_off",
          value: { day: 3 },
          hardness: "hard",
        },
      ],
    };
    const result = solve(input, 1);
    expect(result.feasible).toBe(true);
    const tt = result.candidates[0].timetable;
    expect(tt.placements.some((p) => p.dayOfWeek === 3)).toBe(false);
    expect(validateTimetable(input, tt, false)).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    const grid = makeGrid([1, 2, 3, 4, 5], 6);
    const { lessons } = buildLessons({
      classIds: ["C1"],
      teachingDays: [1, 2, 3, 4, 5],
      classSubjects: [{ classId: "C1", subjectId: "MATH", periodsPerWeek: 5 }],
      teachingAssignments: [
        { classId: "C1", subjectId: "MATH", teacherId: "TM" },
      ],
      classTeachers: [],
      electiveBands: [],
    });
    const input: SolverInput = {
      classIds: ["C1"],
      grid,
      lessons,
      constraints: [],
      seed: 42,
    };
    const a = solve(input, 1).candidates[0];
    const b = solve(input, 1).candidates[0];
    expect(scoreTimetable(input, a.timetable).score).toBe(
      scoreTimetable(input, b.timetable).score,
    );
  });
});

describe("solver — validator catches a hand-broken timetable", () => {
  it("flags a teacher double-book", () => {
    const grid = makeGrid([1], 2);
    const input: SolverInput = {
      classIds: ["C1", "C2"],
      grid,
      constraints: [],
      lessons: [
        {
          id: "L1",
          classId: "C1",
          size: 1,
          offerings: [{ subjectId: "X", teacherId: "T1" }],
          teacherIds: ["T1"],
        },
        {
          id: "L2",
          classId: "C2",
          size: 1,
          offerings: [{ subjectId: "X", teacherId: "T1" }],
          teacherIds: ["T1"],
        },
      ],
    };
    const broken = {
      placements: [
        {
          lessonId: "L1",
          classId: "C1",
          dayOfWeek: 1,
          startSequence: 1,
          slotIds: ["d1s1"],
          offerings: [{ subjectId: "X", teacherId: "T1" }],
          size: 1,
        },
        {
          lessonId: "L2",
          classId: "C2",
          dayOfWeek: 1,
          startSequence: 1,
          slotIds: ["d1s1"],
          offerings: [{ subjectId: "X", teacherId: "T1" }],
          size: 1,
        },
      ],
    };
    const issues = validateTimetable(input, broken, false);
    expect(issues.some((i) => i.rule === "teacher_double_book")).toBe(true);
  });
});
