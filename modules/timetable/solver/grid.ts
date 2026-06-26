import { GridDay, GridSlot, SolverGrid } from "./types";

// A concrete starting position for a lesson of a given size on a day: the
// teaching slots it would occupy (already verified to be consecutive in real
// sequence, i.e. not spanning a break/lunch/reserved/activity slot).
export interface StartPosition {
  startSequence: number;
  slotIds: string[];
}

function teachingSlots(day: GridDay): GridSlot[] {
  return day.slots
    .filter((s) => s.slotType === "teaching")
    .sort((a, b) => a.sequence - b.sequence);
}

// Maximal runs of teaching slots whose sequences are contiguous (n, n+1, n+2...).
// A double/triple may only be placed within a single run.
function teachingRuns(day: GridDay): GridSlot[][] {
  const slots = teachingSlots(day);
  const runs: GridSlot[][] = [];
  let current: GridSlot[] = [];
  for (const slot of slots) {
    if (
      current.length === 0 ||
      slot.sequence === current[current.length - 1].sequence + 1
    ) {
      current.push(slot);
    } else {
      runs.push(current);
      current = [slot];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

export function getDay(
  grid: SolverGrid,
  dayOfWeek: number,
): GridDay | undefined {
  return grid.days.find((d) => d.dayOfWeek === dayOfWeek);
}

// The first teaching slot of a day (smallest sequence) — the class-teacher pin slot.
export function firstTeachingSlot(day: GridDay): GridSlot | undefined {
  return teachingSlots(day)[0];
}

// Registration (0th attendance period) slots of a day, in sequence order. These
// are never filled by the solver; each is booked deterministically by the class
// teacher of every class (no subject). Usually zero or one per day.
export function registrationSlots(day: GridDay): GridSlot[] {
  return day.slots
    .filter((s) => s.slotType === "registration")
    .sort((a, b) => a.sequence - b.sequence);
}

// All valid start positions for a lesson of `size` consecutive teaching slots.
export function startPositions(day: GridDay, size: number): StartPosition[] {
  const positions: StartPosition[] = [];
  for (const run of teachingRuns(day)) {
    for (let i = 0; i + size <= run.length; i++) {
      const window = run.slice(i, i + size);
      positions.push({
        startSequence: window[0].sequence,
        slotIds: window.map((s) => s.slotId),
      });
    }
  }
  return positions;
}

// Total teaching-slot capacity across the week (used by feasibility).
export function totalTeachingSlots(grid: SolverGrid): number {
  return grid.days.reduce((sum, d) => sum + teachingSlots(d).length, 0);
}

export function teachingSlotCountByDay(grid: SolverGrid): Map<number, number> {
  const map = new Map<number, number>();
  for (const d of grid.days) map.set(d.dayOfWeek, teachingSlots(d).length);
  return map;
}
