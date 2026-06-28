import { classesOf, Lesson, ObjectiveWeights, Placement, SolverInput, Timetable } from './types';
import { expandOccupancy, groupByTeacher } from './constraint-checks';

const DEFAULT_WEIGHTS: Required<ObjectiveWeights> = {
  minimizeTeacherGaps: 5,
  honorSoftPreferences: 8,
  evenDailyLoad: 3,
  spreadAcrossWeek: 4,
  cohortLockstep: 6,
  columnConsistency: 12, // near-hard: a subject should keep one period-column across days
  teacherVariety: 4,
};

// Higher score = better. Soft metrics only; hard rules are enforced elsewhere.
export function scoreTimetable(input: SolverInput, timetable: Timetable): { score: number; breakdown: Record<string, number> } {
  const w = { ...DEFAULT_WEIGHTS, ...(input.objectiveWeights || {}) };
  const lessonsById = new Map<string, Lesson>(input.lessons.map((l) => [l.id, l]));
  const placements = timetable.placements;

  // --- teacher gaps (free periods between a teacher's first and last class each day) ---
  let totalGaps = 0;
  const byTeacher = groupByTeacher(expandOccupancy(placements));
  for (const occ of byTeacher.values()) {
    const byDay = new Map<number, number[]>();
    for (const o of occ) { if (!byDay.has(o.day)) byDay.set(o.day, []); byDay.get(o.day)!.push(o.sequence); }
    for (const seqs of byDay.values()) {
      const min = Math.min(...seqs); const max = Math.max(...seqs);
      totalGaps += (max - min + 1) - seqs.length;
    }
  }

  // --- honored soft preferences (block prefer hints + preferred_slot constraints) ---
  let honored = 0;
  for (const p of placements) {
    const lesson = lessonsById.get(p.lessonId);
    if (lesson?.prefer?.some((pref) => pref.day === p.dayOfWeek && pref.slot === p.startSequence)) honored++;
  }
  for (const c of input.constraints) {
    if (c.hardness !== 'soft' || c.type !== 'preferred_slot') continue;
    const occ = byTeacher.get(c.teacherId) || [];
    if (occ.some((o) => o.day === c.value?.day && o.sequence === c.value?.slot)) honored++;
  }

  // --- even daily load (low variance of total placements per weekday) ---
  const perDay = new Map<number, number>();
  for (const p of placements) perDay.set(p.dayOfWeek, (perDay.get(p.dayOfWeek) || 0) + p.size);
  const counts = input.grid.days.map((d) => perDay.get(d.dayOfWeek) || 0);
  const mean = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
  const variance = counts.reduce((a, c) => a + (c - mean) ** 2, 0) / (counts.length || 1);

  // --- spread across week (penalize a subject/band stacking on the same day) ---
  let duplicates = 0;
  const groupDays = new Map<string, number[]>();
  for (const p of placements) {
    const lesson = lessonsById.get(p.lessonId);
    if (!lesson?.groupKey) continue;
    if (!groupDays.has(lesson.groupKey)) groupDays.set(lesson.groupKey, []);
    groupDays.get(lesson.groupKey)!.push(p.dayOfWeek);
  }
  for (const days of groupDays.values()) {
    duplicates += days.length - new Set(days).size;
  }

  // --- cohort lockstep (member classes busy/free in sync) ---
  let cohortMismatch = 0;
  if (input.cohorts && input.cohorts.length > 0) {
    const busy = new Set<string>();
    for (const p of placements) {
      for (const c of classesOf(p)) {
        for (let k = 0; k < p.size; k++) busy.add(`${c}|${p.dayOfWeek}|${p.startSequence + k}`);
      }
    }
    for (const group of input.cohorts) {
      for (const day of input.grid.days) {
        for (const slot of day.slots) {
          if (slot.slotType !== 'teaching') continue;
          let on = 0;
          for (const c of group) if (busy.has(`${c}|${day.dayOfWeek}|${slot.sequence}`)) on++;
          // a slot busy in some members but free in others is a mismatch
          if (on > 0 && on < group.length) cohortMismatch += group.length - on;
        }
      }
    }
  }

  // --- column consistency (same subject in the same period across days) ---
  // Each group should occupy as few period-columns as it needs (one if it runs ≤1×/day).
  // The last 2 teaching periods of each day are a "flex tail" exempt from the penalty.
  const flex = new Set<string>(); // "day|seq"
  for (const d of input.grid.days) {
    const teaching = d.slots
      .filter((s) => s.slotType === "teaching")
      .map((s) => s.sequence)
      .sort((a, b) => a - b);
    for (const seq of teaching.slice(-2)) flex.add(`${d.dayOfWeek}|${seq}`);
  }
  const teachingDays =
    input.grid.days.filter((d) => d.slots.some((s) => s.slotType === "teaching"))
      .length || 1;
  const groupPpw = new Map<string, number>();
  for (const l of input.lessons) {
    if (l.groupKey) groupPpw.set(l.groupKey, (groupPpw.get(l.groupKey) || 0) + l.size);
  }
  const groupCols = new Map<string, Set<number>>(); // distinct start-columns per group (non-flex)
  for (const p of placements) {
    const lesson = lessonsById.get(p.lessonId);
    if (!lesson?.groupKey) continue;
    if (flex.has(`${p.dayOfWeek}|${p.startSequence}`)) continue;
    if (!groupCols.has(lesson.groupKey)) groupCols.set(lesson.groupKey, new Set());
    groupCols.get(lesson.groupKey)!.add(p.startSequence);
  }
  let columnSpread = 0;
  for (const [gk, cols] of groupCols) {
    const ideal = Math.max(1, Math.ceil((groupPpw.get(gk) || cols.size) / teachingDays));
    columnSpread += Math.max(0, cols.size - ideal);
  }

  // --- teacher variety (anti-monotony): same teacher for a class+subject 2× in a day ---
  let varietyRepeats = 0;
  const seenTCSD = new Map<string, number>();
  for (const p of placements) {
    for (const c of classesOf(p)) {
      for (const o of p.offerings) {
        if (!o.teacherId) continue;
        const key = `${o.teacherId}|${c}|${o.subjectId}|${p.dayOfWeek}`;
        const n = (seenTCSD.get(key) || 0) + 1;
        seenTCSD.set(key, n);
        if (n > 1) varietyRepeats++;
      }
    }
  }

  const breakdown: Record<string, number> = {
    teacherGaps: -w.minimizeTeacherGaps * totalGaps,
    softPreferences: w.honorSoftPreferences * honored,
    evenDailyLoad: -w.evenDailyLoad * variance,
    spreadAcrossWeek: -w.spreadAcrossWeek * duplicates,
    cohortLockstep: -w.cohortLockstep * cohortMismatch,
    columnConsistency: -w.columnConsistency * columnSpread,
    teacherVariety: -w.teacherVariety * varietyRepeats,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.round(score * 1000) / 1000, breakdown };
}
