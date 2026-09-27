// Pure parser test — feeds a synthetic paragraph list (no .docx needed) to the
// shared CommonJS parser and asserts the month/field/focus-skill extraction.
const { parseClassModule } = require("../programmes-parse.js");

const PARAS = [
  "Spoken English & Life Communication Programme",
  "Class I",
  "Programme Focus",
  "Interact → Narrate → Request → Explain",
  "MONTHLY UNITS — APRIL TO FEBRUARY",
  "APRIL — My Test Theme",
  "1. Theme",
  "My Test Theme",
  "2. Life Connection",
  "Some life connection text.",
  "4. Key Vocabulary",
  "alpha, beta, gamma",
  "15. Assessment / Observation",
  "Assessment guidance.",
  "Focus Skills",
  "• Listening",
  "• Speaking",
  "Observe:",
  "listening; speaking",
  "MAY — Second Month",
  "1. Theme",
  "Second Theme",
  "CLASS I — YEAR-END COMMUNICATION PROFILE",
  "trailing content that must be ignored",
];

describe("programmes-parse", () => {
  const r = parseClassModule(PARAS);

  test("detects grade and programme focus from the preamble", () => {
    expect(r.detectedGrade).toBe("I");
    expect(r.programmeFocus).toBe("Interact → Narrate → Request → Explain");
  });

  test("extracts the two months in order", () => {
    expect(r.months.map((m: any) => m.month)).toEqual(["april", "may"]);
  });

  test("month title comes from field F01 (Theme)", () => {
    expect(r.months[0].title).toBe("My Test Theme");
    expect(r.months[1].title).toBe("Second Theme");
  });

  test("maps numbered headings to field codes with content under them", () => {
    const f = r.months[0].fields;
    expect(f.F01).toBe("My Test Theme");
    expect(f.F02).toBe("Some life connection text.");
    expect(f.F04).toBe("alpha, beta, gamma");
    expect(f.F15).toContain("Assessment guidance.");
  });

  test("does NOT put a heading line into the content", () => {
    expect(r.months[0].fields.F04).not.toContain("Key Vocabulary");
  });

  test("captures the monthly focus skills", () => {
    expect(r.months[0].focusSkills).toEqual(["Listening", "Speaking"]);
  });

  test("stops at the trailing all-caps section (no leakage into the last month)", () => {
    const may = r.months[1];
    // 'CLASS I — YEAR-END…' ends the region, so the trailing line is never captured.
    const allText = Object.values(may.fields).join(" ");
    expect(allText).not.toContain("trailing content");
  });
});
