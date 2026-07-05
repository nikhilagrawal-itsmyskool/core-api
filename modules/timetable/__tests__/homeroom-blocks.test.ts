import { buildLessons } from "../solver";

// A class whose class teacher (CT) takes Physics (PHY) as the first-period subject.
const CLASS_TEACHERS = [
  { classId: "C", teacherId: "CT", firstPeriodSubjectId: "PHY", firstPeriodDays: null },
];
const ASSIGNMENTS = [{ classId: "C", subjectId: "PHY", teacherId: "CT" }];

describe("homeroom subject + block rules", () => {
  it("keeps the first-period pins AND honors the leftover double + prefer", () => {
    const { lessons } = buildLessons({
      classIds: ["C"],
      teachingDays: [1, 2, 3, 4, 5, 6],
      classSubjects: [
        {
          classId: "C",
          subjectId: "PHY",
          periodsPerWeek: 8,
          blockRules: {
            blocks: [
              { size: 1, count: 6 },
              { size: 2, count: 1, prefer: [{ day: 2, slot: 10 }] },
            ],
            maxPeriodsPerDay: 3,
          },
        },
      ],
      teachingAssignments: ASSIGNMENTS,
      classTeachers: CLASS_TEACHERS,
      electiveBands: [],
    });

    const phy = lessons.filter((l) => l.groupKey === "cs:C:PHY");
    const pins = phy.filter((l) => l.pinnedDay != null);
    const doubles = phy.filter((l) => l.size === 2);

    expect(pins).toHaveLength(6);
    expect(pins.map((l) => l.pinnedDay).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    // the leftover 2 periods form the configured double, carrying its prefer hint
    expect(doubles).toHaveLength(1);
    expect(doubles[0].prefer).toEqual([{ day: 2, slot: 10 }]);
    expect(phy.filter((l) => l.pinnedDay == null && l.size === 1)).toHaveLength(0);
    expect(phy.reduce((s, l) => s + l.size, 0)).toBe(8);
  });

  it("falls back to singles (with a warning) when pins can't be reconciled with the blocks", () => {
    const { lessons, warnings } = buildLessons({
      classIds: ["C"],
      teachingDays: [1, 2, 3, 4, 5, 6],
      classSubjects: [
        {
          classId: "C",
          subjectId: "PHY",
          periodsPerWeek: 8,
          // 4 doubles = 8 periods, no singles — but 6 first-period pins are required.
          blockRules: { blocks: [{ size: 2, count: 4 }] },
        },
      ],
      teachingAssignments: ASSIGNMENTS,
      classTeachers: CLASS_TEACHERS,
      electiveBands: [],
    });

    const phy = lessons.filter((l) => l.groupKey === "cs:C:PHY");
    expect(phy.filter((l) => l.pinnedDay != null)).toHaveLength(6);
    expect(phy.filter((l) => l.size === 2)).toHaveLength(0);
    expect(phy.filter((l) => l.pinnedDay == null && l.size === 1)).toHaveLength(2);
    expect(warnings.some((w) => /can't be reconciled/.test(w))).toBe(true);
  });
});
