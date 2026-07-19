import {
  currentMonth,
  gradeEquals,
  monthOrder,
  parseGrade,
} from "../syllabus-util";

// Pure-logic unit tests — no server or DB. These underpin the student timeline
// (grade resolution + "we are here" month anchor).
describe("syllabus-util", () => {
  describe("parseGrade", () => {
    it("drops the trailing section from a section name", () => {
      expect(parseGrade("I-A")).toBe("I");
      expect(parseGrade("II-B")).toBe("II");
      expect(parseGrade("Nursery-A")).toBe("Nursery");
      expect(parseGrade("LKG-B")).toBe("LKG");
    });

    it("treats a name without a section as its own grade", () => {
      expect(parseGrade("XII")).toBe("XII");
      expect(parseGrade("Nursery")).toBe("Nursery");
    });

    it("trims and tolerates spacing", () => {
      expect(parseGrade("  I-A ")).toBe("I");
    });
  });

  describe("gradeEquals", () => {
    it("compares parsed grade case-insensitively", () => {
      expect(gradeEquals("I-A", "i")).toBe(true);
      expect(gradeEquals("I-A", "II")).toBe(false);
      expect(gradeEquals("Nursery-B", "nursery")).toBe(true);
    });
  });

  describe("currentMonth", () => {
    it("maps a YYYY-MM-DD override onto the academic month", () => {
      expect(currentMonth("2026-07-18")).toBe("july");
      expect(currentMonth("2026-04-01")).toBe("april");
      expect(currentMonth("2027-03-31")).toBe("march");
      expect(currentMonth("2026-12-25")).toBe("december");
    });

    it("returns some valid month with no override", () => {
      expect(monthOrder(currentMonth())).toBeGreaterThanOrEqual(0);
    });
  });

  describe("monthOrder", () => {
    it("orders months in teaching order (April first, March last)", () => {
      expect(monthOrder("april")).toBe(0);
      expect(monthOrder("march")).toBe(11);
      expect(monthOrder("july")).toBeGreaterThan(monthOrder("april"));
      expect(monthOrder("january")).toBeGreaterThan(monthOrder("december"));
    });

    it("returns -1 for an unknown month", () => {
      expect(monthOrder("smarch")).toBe(-1);
    });
  });
});
