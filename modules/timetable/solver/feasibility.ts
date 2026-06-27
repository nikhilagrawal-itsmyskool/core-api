import { SolverInput } from "./types";
import {
  getDay,
  firstTeachingSlot,
  startPositions,
  teachingSlotCountByDay,
  totalTeachingSlots,
} from "./grid";

export interface FeasibilityReport {
  feasible: boolean;
  issues: string[];
  warnings: string[];
}

// Fast over/under-constraint check before the (expensive) solve. Returns
// actionable messages — real school inputs are frequently infeasible.
export function checkFeasibility(input: SolverInput): FeasibilityReport {
  const issues: string[] = [];
  const warnings: string[] = [];

  const totalSlots = totalTeachingSlots(input.grid);
  const perDay = teachingSlotCountByDay(input.grid);

  // The maximum run of consecutive teaching slots available on any day (a
  // size-N lesson needs a run of length >= N somewhere).
  let maxRun = 0;
  for (const day of input.grid.days) {
    for (let size = 1; size <= 12; size++) {
      if (startPositions(day, size).length > 0) maxRun = Math.max(maxRun, size);
    }
  }

  // --- overall demand vs capacity (per class) ---
  const classDemand = new Map<string, number>();
  const teacherDemand = new Map<string, number>();
  for (const lesson of input.lessons) {
    classDemand.set(
      lesson.classId,
      (classDemand.get(lesson.classId) || 0) + lesson.size,
    );
    for (const t of lesson.teacherIds) {
      teacherDemand.set(t, (teacherDemand.get(t) || 0) + lesson.size);
    }
    if (lesson.size > maxRun) {
      issues.push(
        `A ${lesson.size}-period block for class ${lesson.classId} cannot fit: no day has ${lesson.size} consecutive teaching slots (longest run is ${maxRun}).`,
      );
    }
  }

  for (const [classId, demand] of classDemand) {
    if (demand > totalSlots) {
      issues.push(
        `Class ${classId} needs ${demand} periods but only ${totalSlots} teaching slots exist in the week.`,
      );
    }
  }

  // --- per-subject hard period-per-day cap vs weekly demand ---
  // A group can place at most maxPeriodsPerDay periods on each teaching day, so its
  // weekly periods must fit in (teaching days for that class) × cap.
  const teachingDayCount = input.grid.days.filter((d) =>
    d.slots.some((s) => s.slotType === "teaching"),
  ).length;
  const groupPeriods = new Map<string, number>();
  const groupCap = new Map<string, number>();
  for (const lesson of input.lessons) {
    if (!lesson.groupKey) continue;
    groupPeriods.set(
      lesson.groupKey,
      (groupPeriods.get(lesson.groupKey) || 0) + lesson.size,
    );
    if (
      lesson.maxPeriodsPerDay !== undefined &&
      !groupCap.has(lesson.groupKey)
    ) {
      groupCap.set(lesson.groupKey, lesson.maxPeriodsPerDay);
      if (lesson.size > lesson.maxPeriodsPerDay) {
        issues.push(
          `A ${lesson.size}-period block for ${lesson.groupKey} exceeds its max ${lesson.maxPeriodsPerDay} periods/day.`,
        );
      }
    }
  }
  for (const [groupKey, periods] of groupPeriods) {
    const cap = groupCap.get(groupKey);
    if (
      cap !== undefined &&
      teachingDayCount > 0 &&
      periods > cap * teachingDayCount
    ) {
      issues.push(
        `${groupKey} needs ${periods} periods/week but the cap of ${cap}/day across ${teachingDayCount} teaching days allows only ${cap * teachingDayCount}.`,
      );
    }
  }

  // --- per-teacher demand vs availability after hard constraints ---
  const hardByTeacher = new Map<string, typeof input.constraints>();
  for (const c of input.constraints) {
    if (c.hardness !== "hard") continue;
    if (!hardByTeacher.has(c.teacherId)) hardByTeacher.set(c.teacherId, []);
    hardByTeacher.get(c.teacherId)!.push(c);
  }

  for (const [teacherId, demand] of teacherDemand) {
    let available = totalSlots;
    let weeklyCap = Infinity;
    for (const c of hardByTeacher.get(teacherId) || []) {
      if (c.type === "day_off") available -= perDay.get(c.value?.day) || 0;
      else if (c.type === "unavailable_slot") {
        const day = getDay(input.grid, c.value?.day);
        if (
          day?.slots.some(
            (s) => s.slotType === "teaching" && s.sequence === c.value?.slot,
          )
        )
          available -= 1;
      } else if (c.type === "weekly_max")
        weeklyCap = Math.min(weeklyCap, c.value?.max ?? Infinity);
    }
    const effective = Math.min(available, weeklyCap);
    if (demand > effective) {
      issues.push(
        `Teacher ${teacherId} is assigned ${demand} periods but is only free for ${effective} after their hard constraints.`,
      );
    }
  }

  // --- class-teacher pins need a first teaching slot on each pinned day ---
  for (const lesson of input.lessons) {
    if (!lesson.pinnedDay) continue;
    const day = getDay(input.grid, lesson.pinnedDay);
    if (!day || !firstTeachingSlot(day)) {
      issues.push(
        `Class ${lesson.classId} has a class-teacher pin on day ${lesson.pinnedDay} but that day has no teaching slot.`,
      );
    }
  }

  if (input.lessons.length === 0)
    warnings.push("No lessons to schedule — nothing was configured.");

  return {
    feasible: issues.length === 0,
    issues: [...new Set(issues)],
    warnings,
  };
}
