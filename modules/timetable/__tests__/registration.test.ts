import {
  computeRegistrationEntries,
  registrationClashMessages,
} from "../registration";
import { SolverGrid } from "../solver";

// A grid with assembly (seq -1), registration (seq 0), then `periods` teaching
// slots (seq 1..periods) on each given weekday.
function makeGrid(
  days: number[],
  periods: number,
  withRegistration = true,
): SolverGrid {
  return {
    days: days.map((dayOfWeek) => {
      const slots: any[] = [
        { slotId: `d${dayOfWeek}assembly`, sequence: -1, slotType: "assembly" },
      ];
      if (withRegistration)
        slots.push({
          slotId: `d${dayOfWeek}reg`,
          sequence: 0,
          slotType: "registration",
        });
      for (let i = 1; i <= periods; i++)
        slots.push({
          slotId: `d${dayOfWeek}s${i}`,
          sequence: i,
          slotType: "teaching",
        });
      return { dayOfWeek, slots };
    }),
  };
}

describe("registration — computeRegistrationEntries", () => {
  it("books the class teacher into the registration slot of every teaching day", () => {
    const grid = makeGrid([1, 2, 3], 6);
    const entries = computeRegistrationEntries(
      grid,
      [
        { classId: "C1", teacherId: "T1" },
        { classId: "C2", teacherId: "T2" },
      ],
      ["C1", "C2"],
    );
    expect(entries.length).toBe(6); // 2 classes × 3 days
    expect(entries.every((e) => e.timeSlotId.endsWith("reg"))).toBe(true);
    const c1 = entries.filter((e) => e.classId === "C1");
    expect(c1.every((e) => e.teacherId === "T1")).toBe(true);
    expect(c1.map((e) => e.dayOfWeek).sort()).toEqual([1, 2, 3]);
  });

  it("produces nothing when the grid has no registration slot (existing grids unaffected)", () => {
    const grid = makeGrid([1, 2, 3], 6, /* withRegistration */ false);
    const entries = computeRegistrationEntries(
      grid,
      [{ classId: "C1", teacherId: "T1" }],
      ["C1"],
    );
    expect(entries).toEqual([]);
  });

  it("skips classes without a class teacher and respects the class scope", () => {
    const grid = makeGrid([1], 4);
    const entries = computeRegistrationEntries(
      grid,
      [
        { classId: "C1", teacherId: "T1" },
        { classId: "C2", teacherId: "T2" },
      ],
      ["C1"], // C2 out of scope
    );
    expect(entries.length).toBe(1);
    expect(entries[0].classId).toBe("C1");
  });
});

describe("registration — registrationClashMessages", () => {
  it("is silent when each class teacher serves one class", () => {
    const grid = makeGrid([1, 2], 4);
    const entries = computeRegistrationEntries(
      grid,
      [
        { classId: "C1", teacherId: "T1" },
        { classId: "C2", teacherId: "T2" },
      ],
      ["C1", "C2"],
    );
    expect(registrationClashMessages(entries)).toEqual([]);
  });

  it("flags a teacher who is class teacher of two classes sharing the registration slot", () => {
    const grid = makeGrid([1], 4);
    const entries = computeRegistrationEntries(
      grid,
      [
        { classId: "C1", teacherId: "T1" },
        { classId: "C2", teacherId: "T1" },
      ], // same teacher
      ["C1", "C2"],
    );
    const msgs = registrationClashMessages(entries);
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toMatch(/class teacher of 2 classes/);
  });
});
