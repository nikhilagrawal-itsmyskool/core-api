import { parseGrade, gradeEquals, currentMonth, monthOrder, fieldCode } from "../programmes-util";

describe("programmes-util", () => {
  test("parseGrade drops the trailing section", () => {
    expect(parseGrade("I-A")).toBe("I");
    expect(parseGrade("Nursery-A")).toBe("Nursery");
    expect(parseGrade("XII")).toBe("XII");
    expect(parseGrade("  VIII-B ")).toBe("VIII");
  });

  test("gradeEquals is case-insensitive on the parsed grade", () => {
    expect(gradeEquals("I-A", "i")).toBe(true);
    expect(gradeEquals("XII", "xii")).toBe(true);
    expect(gradeEquals("I-A", "II")).toBe(false);
  });

  test("fieldCode zero-pads", () => {
    expect(fieldCode(1)).toBe("F01");
    expect(fieldCode(9)).toBe("F09");
    expect(fieldCode(15)).toBe("F15");
  });

  test("monthOrder is teaching order (April=0 .. March=11)", () => {
    expect(monthOrder("april")).toBe(0);
    expect(monthOrder("march")).toBe(11);
    expect(monthOrder("september")).toBe(5);
    expect(monthOrder("nope")).toBe(-1);
  });

  test("currentMonth anchors a date onto the academic month", () => {
    expect(currentMonth("2026-09-15")).toBe("september");
    expect(currentMonth("2026-01-10")).toBe("january");
    expect(currentMonth("2026-04-01")).toBe("april");
  });
});
