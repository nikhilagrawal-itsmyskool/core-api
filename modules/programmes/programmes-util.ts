import { CALENDAR_TO_MONTH, MONTH_VALUES, Month } from "./programmes-constants";

// Derive a grade label from a class (section) name by dropping the trailing
// "-<section>" segment: "I-A" -> "I", "Nursery-A" -> "Nursery", "XII" -> "XII".
// Assumes the "<grade>-<section>" convention; a name without a hyphen is its own
// grade. Same rule as the syllabus module ("No grade entity").
export function parseGrade(className: string): string {
  const name = (className || "").trim();
  const idx = name.lastIndexOf("-");
  if (idx <= 0) return name;
  return name.slice(0, idx).trim();
}

// Case-insensitive grade equality (grades are stored/compared lowercased in SQL).
export function gradeEquals(a: string, b: string): boolean {
  return parseGrade(a).toLowerCase() === (b || "").trim().toLowerCase();
}

// Resolve the academic month that "today" falls in, for the timeline anchor.
// Accepts an optional YYYY-MM-DD override (testing); otherwise uses now.
export function currentMonth(today?: string): Month {
  let d: Date;
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    d = new Date(`${today}T00:00:00`);
  } else {
    d = new Date();
  }
  const calMonth = d.getMonth() + 1; // 1..12
  return CALENDAR_TO_MONTH[calMonth] || "april";
}

// Index of an academic month in teaching order (april=0 .. march=11), or -1.
export function monthOrder(month: string): number {
  return MONTH_VALUES.indexOf(month as Month);
}

// Zero-padded field code for a 1-based field position: 1 -> "F01", 15 -> "F15".
export function fieldCode(n: number): string {
  return "F" + String(n).padStart(2, "0");
}
