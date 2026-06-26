import { Placement, SolverTeacherConstraint, ValidationIssue } from './types';

// A single teaching-slot occupancy by a teacher.
export interface Occ {
  teacherId: string;
  classId: string;
  day: number;
  sequence: number;
  slotId: string;
}

// Expand placements into per-slot occupancy entries (one per teacher per slot).
export function expandOccupancy(placements: Placement[]): Occ[] {
  const occ: Occ[] = [];
  for (const p of placements) {
    for (let k = 0; k < p.size; k++) {
      const sequence = p.startSequence + k;
      const slotId = p.slotIds[k];
      const teachers = new Set(p.offerings.map((o) => o.teacherId).filter((t): t is string => !!t));
      for (const teacherId of teachers) {
        occ.push({ teacherId, classId: p.classId, day: p.dayOfWeek, sequence, slotId });
      }
    }
  }
  return occ;
}

export function groupByTeacher(occ: Occ[]): Map<string, Occ[]> {
  const map = new Map<string, Occ[]>();
  for (const o of occ) {
    if (!map.has(o.teacherId)) map.set(o.teacherId, []);
    map.get(o.teacherId)!.push(o);
  }
  return map;
}

function maxConsecutive(sequences: number[]): number {
  if (sequences.length === 0) return 0;
  const sorted = [...sequences].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) { run++; best = Math.max(best, run); }
    else if (sorted[i] !== sorted[i - 1]) { run = 1; }
  }
  return best;
}

// Does a teacher's occupancy violate one HARD constraint? Returns a message or null.
export function violationMessage(teacherOcc: Occ[], c: SolverTeacherConstraint): string | null {
  const v = c.value || {};
  switch (c.type) {
    case 'day_off':
      if (teacherOcc.some((o) => o.day === v.day)) return `teacher ${c.teacherId} has a class on their day off (day ${v.day})`;
      return null;
    case 'unavailable_slot':
      if (teacherOcc.some((o) => o.day === v.day && o.sequence === v.slot)) {
        return `teacher ${c.teacherId} is scheduled in an unavailable slot (day ${v.day}, period ${v.slot})`;
      }
      return null;
    case 'max_per_day': {
      const byDay = new Map<number, number>();
      for (const o of teacherOcc) byDay.set(o.day, (byDay.get(o.day) || 0) + 1);
      for (const [day, count] of byDay) if (count > v.max) return `teacher ${c.teacherId} exceeds max ${v.max} periods on day ${day} (${count})`;
      return null;
    }
    case 'weekly_max':
      if (teacherOcc.length > v.max) return `teacher ${c.teacherId} exceeds weekly max ${v.max} (${teacherOcc.length})`;
      return null;
    case 'max_consecutive': {
      const byDay = new Map<number, number[]>();
      for (const o of teacherOcc) { if (!byDay.has(o.day)) byDay.set(o.day, []); byDay.get(o.day)!.push(o.sequence); }
      for (const [day, seqs] of byDay) if (maxConsecutive(seqs) > v.max) return `teacher ${c.teacherId} exceeds max ${v.max} consecutive periods on day ${day}`;
      return null;
    }
    case 'preferred_slot':
      return null; // soft only
    default:
      return null;
  }
}

// Full re-check of all HARD teacher constraints against a complete placement set.
export function checkHardTeacherConstraints(placements: Placement[], constraints: SolverTeacherConstraint[]): ValidationIssue[] {
  const byTeacher = groupByTeacher(expandOccupancy(placements));
  const issues: ValidationIssue[] = [];
  for (const c of constraints) {
    if (c.hardness !== 'hard') continue;
    const occ = byTeacher.get(c.teacherId) || [];
    const msg = violationMessage(occ, c);
    if (msg) issues.push({ rule: `teacher_constraint:${c.type}`, message: msg });
  }
  return issues;
}
