import {
  solve,
  validateTimetable,
  checkFeasibility,
  buildLessons,
  classesOf,
  SolverGrid,
  SolverInput,
} from "../solver";

// Uniform grid: `days` weekdays × `periods` teaching slots (sequences 1..periods).
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

// A miniature XI-A composite: two streams (XS = Science, XC = Commerce) sharing a
// cohort. English (band-of-one) and a Maths/Bio band are cross-class (both streams,
// same slots); Physics/Chem are Science-only and Business/Econ Commerce-only.
// Per class: shared 4+4=8 + own 6 = 14 periods; grid is 5×3 = 15 slots (1 slack).
function buildComposite() {
  return buildLessons({
    classIds: ["XS", "XC"],
    teachingDays: [1, 2, 3, 4, 5],
    classSubjects: [
      { classId: "XS", subjectId: "PHY", periodsPerWeek: 3 },
      { classId: "XS", subjectId: "CHEM", periodsPerWeek: 3 },
      { classId: "XC", subjectId: "BUS", periodsPerWeek: 3 },
      { classId: "XC", subjectId: "ECO", periodsPerWeek: 3 },
    ],
    teachingAssignments: [
      { classId: "XS", subjectId: "PHY", teacherId: "Tp" },
      { classId: "XS", subjectId: "CHEM", teacherId: "Tc" },
      { classId: "XC", subjectId: "BUS", teacherId: "Tb" },
      { classId: "XC", subjectId: "ECO", teacherId: "Te" },
    ],
    classTeachers: [],
    electiveBands: [
      // English: one teacher, both streams together (cross-class shared single).
      {
        bandId: "ENG",
        classId: "XS",
        classIds: ["XS", "XC"],
        periodsPerWeek: 4,
        offerings: [{ subjectId: "ENG", teacherId: "Teng" }],
      },
      // Maths/Bio: parallel rooms, any student of either stream opts one.
      {
        bandId: "MB",
        classId: "XS",
        classIds: ["XS", "XC"],
        periodsPerWeek: 4,
        offerings: [
          { subjectId: "MATH", teacherId: "Tm" },
          { subjectId: "BIO", teacherId: "Tbio" },
        ],
      },
    ],
  });
}

describe("composite class — cross-class co-scheduling", () => {
  it("build-lessons emits cross-class lessons carrying classIds for cohort bands", () => {
    const { lessons } = buildComposite();
    const eng = lessons.filter((l) => l.bandId === "ENG");
    const mb = lessons.filter((l) => l.bandId === "MB");
    expect(eng.length).toBe(4);
    expect(mb.length).toBe(4);
    // every cohort-band lesson co-schedules both classes
    for (const l of [...eng, ...mb]) {
      expect(classesOf(l).sort()).toEqual(["XC", "XS"]);
    }
    // a stream-specific subject stays single-class
    const phy = lessons.filter((l) => l.offerings[0].subjectId === "PHY");
    expect(phy.length).toBe(3);
    expect(classesOf(phy[0])).toEqual(["XS"]);
  });

  it("feasibility counts a shared lesson once toward EACH class it touches", () => {
    const { lessons } = buildComposite();
    const input: SolverInput = {
      classIds: ["XS", "XC"],
      grid: makeGrid([1, 2, 3, 4, 5], 3), // 15 slots
      lessons,
      constraints: [],
    };
    const report = checkFeasibility(input);
    // each class needs 14 ≤ 15 → feasible (no over-capacity issue)
    expect(report.feasible).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("solves to a clash-free timetable with shared lessons co-located in both streams", () => {
    const { lessons } = buildComposite();
    const input: SolverInput = {
      classIds: ["XS", "XC"],
      grid: makeGrid([1, 2, 3, 4, 5], 3),
      lessons,
      constraints: [],
      seed: 7,
    };
    const result = solve(input, 2);
    expect(result.feasible).toBe(true);
    const tt = result.candidates[0].timetable;

    // independent validator: no class/teacher double-book, complete, etc.
    expect(validateTimetable(input, tt)).toEqual([]);

    // a cross-class placement occupies the SAME day/slot in both classes by
    // construction (one placement, two classIds) — assert both are recorded.
    const shared = tt.placements.filter((p) => classesOf(p).length > 1);
    expect(shared.length).toBe(8); // 4 English + 4 Maths/Bio
    for (const p of shared) {
      expect(classesOf(p).sort()).toEqual(["XC", "XS"]);
    }

    // every class is fully scheduled: 14 periods each (8 shared + 6 own).
    const perClass = new Map<string, number>();
    for (const p of tt.placements) {
      for (const c of classesOf(p)) {
        perClass.set(c, (perClass.get(c) || 0) + p.size);
      }
    }
    expect(perClass.get("XS")).toBe(14);
    expect(perClass.get("XC")).toBe(14);
  });

  it("rejects a Science-only lesson colliding with a shared slot (validator)", () => {
    // Hand-build a broken timetable: English (shared, both classes) and a Physics
    // (XS only) both at day 1 seq 1 → XS is double-booked.
    const { lessons } = buildComposite();
    const input: SolverInput = {
      classIds: ["XS", "XC"],
      grid: makeGrid([1, 2, 3, 4, 5], 3),
      lessons,
      constraints: [],
    };
    const engLesson = lessons.find((l) => l.bandId === "ENG")!;
    const phyLesson = lessons.find((l) => l.offerings[0].subjectId === "PHY")!;
    const broken = {
      placements: [
        {
          lessonId: engLesson.id,
          classId: "XS",
          classIds: ["XS", "XC"],
          dayOfWeek: 1,
          startSequence: 1,
          slotIds: ["d1s1"],
          offerings: engLesson.offerings,
          size: 1,
          bandId: "ENG",
        },
        {
          lessonId: phyLesson.id,
          classId: "XS",
          dayOfWeek: 1,
          startSequence: 1,
          slotIds: ["d1s1"],
          offerings: phyLesson.offerings,
          size: 1,
        },
      ],
    };
    const issues = validateTimetable(input, broken, false);
    expect(issues.some((i) => i.rule === "class_double_book")).toBe(true);
  });
});
