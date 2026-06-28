import {
  solve,
  validateTimetable,
  checkFeasibility,
  buildLessons,
  scoreTimetable,
  classesOf,
  SolverGrid,
  SolverInput,
} from "../solver";

// Reproduce XI-A from the brother's hand-made sheet, end to end, with the new solver:
// a cohort (Science + Commerce), a shared single (English) + a Maths/Bio/Acc band whose
// Bio is SPLIT across two teachers (ADS 6 / SP 2), stream-specific subjects, and NKG only
// AVAILABLE at the 6th teaching period (so Chemistry must live there). The grid has
// non-teaching slots interspersed (assembly/reserved/lunch) so teaching-period 6 = seq 10.
//
// Goal: show the output is period-fixed (column-consistent), honors NKG's availability, and
// represents Bio's two-teacher split — like the hand-made timetable.

const DAYS = [1, 2, 3, 4, 5, 6];
// Per day: 1 assembly, 2 reserved, 3-6 teaching (T1-T4), 7 lunch, 8 reserved, 9-12 teaching (T5-T8).
const TEACHING_SEQS = [3, 4, 5, 6, 9, 10, 11, 12]; // T1..T8
const P6_SEQ = 10; // the 6th teaching period

function makeGrid(): SolverGrid {
  const slot = (d: number, seq: number, slotType: any) => ({
    slotId: `d${d}s${seq}`,
    sequence: seq,
    slotType,
  });
  return {
    days: DAYS.map((d) => ({
      dayOfWeek: d,
      slots: [
        slot(d, 1, "assembly"),
        slot(d, 2, "reserved"),
        slot(d, 3, "teaching"),
        slot(d, 4, "teaching"),
        slot(d, 5, "teaching"),
        slot(d, 6, "teaching"),
        slot(d, 7, "lunch"),
        slot(d, 8, "reserved"),
        slot(d, 9, "teaching"),
        slot(d, 10, "teaching"),
        slot(d, 11, "teaching"),
        slot(d, 12, "teaching"),
      ],
    })),
  };
}

function buildXiA(): SolverInput {
  const { lessons } = buildLessons({
    classIds: ["XS", "XC"],
    teachingDays: DAYS,
    classSubjects: [
      // Science stream
      { classId: "XS", subjectId: "PHY", periodsPerWeek: 6 },
      { classId: "XS", subjectId: "CHEM", periodsPerWeek: 6 },
      { classId: "XS", subjectId: "PE", periodsPerWeek: 6 },
      // Commerce stream
      { classId: "XC", subjectId: "BUS", periodsPerWeek: 6 },
      { classId: "XC", subjectId: "ECO", periodsPerWeek: 6 },
      { classId: "XC", subjectId: "AMATH", periodsPerWeek: 6 },
    ],
    teachingAssignments: [
      { classId: "XS", subjectId: "PHY", teacherId: "PM" },
      { classId: "XS", subjectId: "CHEM", teacherId: "NKG" },
      { classId: "XS", subjectId: "PE", teacherId: "AP" },
      { classId: "XC", subjectId: "BUS", teacherId: "VD" },
      { classId: "XC", subjectId: "ECO", teacherId: "EC" },
      { classId: "XC", subjectId: "AMATH", teacherId: "AM" },
    ],
    classTeachers: [],
    electiveBands: [
      // shared single: English, both streams together
      {
        bandId: "ENG",
        classId: "XS",
        classIds: ["XS", "XC"],
        periodsPerWeek: 6,
        offerings: [{ subjectId: "ENG", teacherId: "DCA" }],
      },
      // cross-stream band: Maths / Biology / Accounting — Bio split ADS(6) / SP(2).
      {
        bandId: "MBA",
        classId: "XS",
        classIds: ["XS", "XC"],
        periodsPerWeek: 8,
        offerings: [
          { subjectId: "MATH", teacherId: "BS" },
          { subjectId: "BIO", teacherId: "ADS", periodShare: 6 },
          { subjectId: "BIO", teacherId: "SP", periodShare: 2 },
          { subjectId: "ACC", teacherId: "VD" },
        ],
      },
    ],
  });

  // NKG is AVAILABLE only at the 6th teaching period (seq 10), every day → Chemistry must
  // sit there. (One available_slot per day; the loader would expand a multi-day row to this.)
  const constraints = DAYS.map((d) => ({
    teacherId: "NKG",
    type: "available_slot" as const,
    value: { day: d, slot: P6_SEQ },
    hardness: "hard" as const,
  }));

  return {
    classIds: ["XS", "XC"],
    grid: makeGrid(),
    lessons,
    constraints,
    seed: 7,
  };
}

const DAY = (d: number) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d];

function renderClass(tt: any, classId: string): string {
  const cell: Record<string, string> = {};
  for (const p of tt.placements) {
    if (!classesOf(p).includes(classId)) continue;
    for (let k = 0; k < p.size; k++) {
      const seq = p.startSequence + k;
      const label = p.offerings
        .map((o: any) => `${o.subjectId}${o.teacherId ? `·${o.teacherId}` : ""}`)
        .join("/");
      cell[`${p.dayOfWeek}|${seq}`] = label;
    }
  }
  const head = "     " + TEACHING_SEQS.map((_, i) => `P${i + 1}`.padEnd(12)).join("");
  const rows = DAYS.map((d) => {
    const line = TEACHING_SEQS.map((seq) => (cell[`${d}|${seq}`] || "·").padEnd(12)).join("");
    return `${DAY(d).padEnd(5)}${line}`;
  });
  return [`--- ${classId} ---`, head, ...rows].join("\n");
}

describe("XI-A reproduce (new solver vs the hand-made sheet)", () => {
  it("is column-consistent, honors NKG availability, and represents Bio's two teachers", () => {
    const input = buildXiA();

    const feas = checkFeasibility(input);
    expect(feas.feasible).toBe(true);

    const result = solve(input, 1);
    expect(result.feasible).toBe(true);
    const tt = result.candidates[0].timetable;

    // independent validator: no clashes, complete, and NKG never outside his available slot
    expect(validateTimetable(input, tt)).toEqual([]);

    // eslint-disable-next-line no-console
    console.log(
      "\n" + renderClass(tt, "XS") + "\n\n" + renderClass(tt, "XC") + "\n",
    );

    // 1) NKG (Chemistry) only ever at the 6th teaching period (seq 10).
    const nkg = tt.placements.filter((p) =>
      p.offerings.some((o) => o.teacherId === "NKG"),
    );
    expect(nkg.length).toBeGreaterThan(0);
    for (const p of nkg) expect(p.startSequence).toBe(P6_SEQ);

    // 2) Chemistry is column-consistent: one period-column across all days.
    const chemCols = new Set(nkg.map((p) => p.startSequence));
    expect(chemCols.size).toBe(1);

    // 3) Bio's split is represented — both teachers actually appear.
    const bioTeachers = new Set<string>();
    for (const p of tt.placements)
      for (const o of p.offerings) if (o.subjectId === "BIO") bioTeachers.add(o.teacherId!);
    expect(bioTeachers).toEqual(new Set(["ADS", "SP"]));

    // 4) Column-consistency took hold for EVERY subject (not just the forced Chemistry):
    //    each group occupies at most 2 period-columns in the fixed zone. This fails on a
    //    scattered timetable.
    const flex = new Set<string>();
    for (const d of input.grid.days) {
      const teaching = d.slots
        .filter((s) => s.slotType === "teaching")
        .map((s) => s.sequence)
        .sort((a, b) => a - b);
      for (const seq of teaching.slice(-2)) flex.add(`${d.dayOfWeek}|${seq}`);
    }
    const lessonsById = new Map(input.lessons.map((l) => [l.id, l]));
    const groupCols = new Map<string, Set<number>>();
    for (const p of tt.placements) {
      const gk = lessonsById.get(p.lessonId)?.groupKey;
      if (!gk || flex.has(`${p.dayOfWeek}|${p.startSequence}`)) continue;
      if (!groupCols.has(gk)) groupCols.set(gk, new Set());
      groupCols.get(gk)!.add(p.startSequence);
    }
    // Strong column-consistency overall: total "extra" columns beyond each group's
    // minimum is small (a scattered timetable scores far higher here).
    const groupPpw = new Map<string, number>();
    for (const l of input.lessons)
      if (l.groupKey) groupPpw.set(l.groupKey, (groupPpw.get(l.groupKey) || 0) + l.size);
    let columnSpread = 0;
    for (const [gk, cols] of groupCols) {
      const ideal = Math.max(1, Math.ceil((groupPpw.get(gk) || cols.size) / DAYS.length));
      columnSpread += Math.max(0, cols.size - ideal);
    }
    // With the distinct-column bias this is essentially 0 — allow a small margin.
    expect(columnSpread).toBeLessThanOrEqual(2);

    // 5) English (shared) sits in the SAME column for both streams (cohort + column).
    const engCols = new Set(
      tt.placements
        .filter((p) => p.offerings.some((o) => o.subjectId === "ENG"))
        .map((p) => p.startSequence),
    );
    expect(engCols.size).toBe(1);

    const bd = scoreTimetable(input, tt).breakdown;
    expect(bd).toHaveProperty("columnConsistency");
    expect(bd).toHaveProperty("teacherVariety");
  });
});
