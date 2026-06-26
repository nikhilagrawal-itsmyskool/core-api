import { Lesson, ObjectiveWeights, Placement, SolverInput, Timetable } from './types';
import { expandOccupancy, groupByTeacher } from './constraint-checks';

const DEFAULT_WEIGHTS: Required<ObjectiveWeights> = {
  minimizeTeacherGaps: 5,
  honorSoftPreferences: 8,
  evenDailyLoad: 3,
  spreadAcrossWeek: 4,
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

  const breakdown: Record<string, number> = {
    teacherGaps: -w.minimizeTeacherGaps * totalGaps,
    softPreferences: w.honorSoftPreferences * honored,
    evenDailyLoad: -w.evenDailyLoad * variance,
    spreadAcrossWeek: -w.spreadAcrossWeek * duplicates,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.round(score * 1000) / 1000, breakdown };
}
