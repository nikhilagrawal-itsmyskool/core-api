// Pure helper (no DB) for the per-wing generation "assume disjoint, warn" rule.
//
// Given every (teacherId, classId) teaching pair for the academic year and the
// set of classes in the wing being generated, return a warning for each teacher
// who teaches BOTH inside and outside the wing — generating the wing alone could
// double-book them against another wing's timetable.
export function crossWingTeacherWarnings(
  pairs: { teacherId: string; classId: string }[],
  wingClassIds: string[],
): string[] {
  const wing = new Set(wingClassIds);
  const inside = new Set<string>();
  const outside = new Set<string>();
  for (const p of pairs) {
    if (!p.teacherId) continue;
    if (wing.has(p.classId)) inside.add(p.teacherId);
    else outside.add(p.teacherId);
  }
  const shared = [...inside].filter((t) => outside.has(t)).sort();
  return shared.map(
    (teacherId) => `Teacher ${teacherId} also teaches classes outside this wing — generating this wing alone may clash with another wing's timetable.`,
  );
}
