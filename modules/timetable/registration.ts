// Registration (0th attendance period) is deterministic, not solved: every class
// that has a class teacher books that teacher — with no subject — into each
// registration slot of every teaching day. Because the grid is school-wide and a
// slot sequence is unique per day, a registration slot never coincides with a
// teaching slot, so this can never clash with the solved teaching grid. The only
// possible clash is a teacher who is class teacher of two classes (they would owe
// two registrations in the same slot) — surfaced as a feasibility issue.

import { SolverGrid } from "./solver/types";
import { registrationSlots } from "./solver/grid";
import { BuildClassTeacher } from "./solver/build-lessons";

export interface RegistrationEntry {
  classId: string;
  dayOfWeek: number;
  timeSlotId: string;
  teacherId: string;
}

// One entry per (class with a class teacher) × (registration slot) × (day that has
// one). classIds scopes the result (e.g. to a wing). Empty when no registration
// slot is configured — so existing grids are unaffected.
export function computeRegistrationEntries(
  grid: SolverGrid,
  classTeachers: BuildClassTeacher[],
  classIds: string[],
): RegistrationEntry[] {
  const inScope = new Set(classIds);
  const teacherOf = new Map<string, string>();
  for (const ct of classTeachers) {
    if (inScope.has(ct.classId)) teacherOf.set(ct.classId, ct.teacherId);
  }

  const entries: RegistrationEntry[] = [];
  for (const day of grid.days) {
    const slots = registrationSlots(day);
    if (slots.length === 0) continue;
    for (const [classId, teacherId] of teacherOf) {
      for (const slot of slots) {
        entries.push({
          classId,
          dayOfWeek: day.dayOfWeek,
          timeSlotId: slot.slotId,
          teacherId,
        });
      }
    }
  }
  return entries;
}

// A teacher who is class teacher of more than one class sharing the same
// registration slot cannot run both registrations at once. Returns one actionable
// message per offending (day, slot, teacher).
export function registrationClashMessages(
  entries: RegistrationEntry[],
): string[] {
  const classesByTeacherSlot = new Map<string, Set<string>>();
  for (const e of entries) {
    const key = `${e.teacherId}|${e.dayOfWeek}|${e.timeSlotId}`;
    if (!classesByTeacherSlot.has(key))
      classesByTeacherSlot.set(key, new Set());
    classesByTeacherSlot.get(key)!.add(e.classId);
  }
  const messages: string[] = [];
  for (const [key, classes] of classesByTeacherSlot) {
    if (classes.size > 1) {
      const [teacherId, day] = key.split("|");
      messages.push(
        `Teacher ${teacherId} is class teacher of ${classes.size} classes that share the registration (0th) period on day ${day} — they cannot take more than one registration at once.`,
      );
    }
  }
  return messages;
}
