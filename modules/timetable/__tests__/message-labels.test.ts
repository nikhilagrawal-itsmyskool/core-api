import { humanizeMessages, SolverLabels } from "../message-labels";

const labels: SolverLabels = {
  class: new Map([
    ["wqy7ln4orwd1", "Grade 5A"],
    ["zw6um3x11zth", "Grade 5B"],
  ]),
  subject: new Map([
    ["eorfiuhzbj08", "Mathematics (MATH)"],
    ["l7c24p9lshm9", "Science (SCI)"],
  ]),
  teacher: new Map([["abc123def456", "Asha Rao"]]),
};

describe("humanizeMessages", () => {
  it("replaces class and subject ids with names + codes", () => {
    const [out] = humanizeMessages(
      [
        "Class wqy7ln4orwd1 subject eorfiuhzbj08 has no teacher — scheduled as 2 teacher-less period(s).",
      ],
      labels,
    );
    expect(out).toBe(
      "Class Grade 5A subject Mathematics (MATH) has no teacher — scheduled as 2 teacher-less period(s).",
    );
  });

  it("replaces teacher ids in teacher messages", () => {
    const [out] = humanizeMessages(
      ["Teacher abc123def456 is assigned 30 periods but is only free for 25."],
      labels,
    );
    expect(out).toBe("Teacher Asha Rao is assigned 30 periods but is only free for 25.");
  });

  it("flattens cs:<classId>:<subjectId> groupKey forms", () => {
    const [out] = humanizeMessages(
      ["cs:wqy7ln4orwd1:l7c24p9lshm9 needs 8 periods/week but the cap of 2/day allows only 6."],
      labels,
    );
    expect(out).toBe(
      "Grade 5A Science (SCI) needs 8 periods/week but the cap of 2/day allows only 6.",
    );
  });

  it("leaves unknown ids (e.g. elective bands) untouched", () => {
    const [out] = humanizeMessages(
      ["Elective band band99unknown1 has no offerings — skipped."],
      labels,
    );
    expect(out).toBe("Elective band band99unknown1 has no offerings — skipped.");
  });

  it("handles multiple ids and multiple messages", () => {
    const out = humanizeMessages(
      [
        "Class wqy7ln4orwd1 needs 48 periods but only 46 teaching slots exist in the week.",
        "Class zw6um3x11zth subject eorfiuhzbj08 has no teacher.",
      ],
      labels,
    );
    expect(out[0]).toContain("Class Grade 5A needs 48 periods");
    expect(out[1]).toBe("Class Grade 5B subject Mathematics (MATH) has no teacher.");
  });
});
