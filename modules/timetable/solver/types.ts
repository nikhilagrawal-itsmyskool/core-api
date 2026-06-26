// Pure solver data model. These types are independent of the DB layer so the
// solver can be unit-tested with hand-built inputs (no server / no Postgres).

export type SlotType = 'teaching' | 'assembly' | 'break' | 'lunch' | 'reserved' | 'activity';

export interface GridSlot {
  slotId: string;
  sequence: number; // ordering within the day (1-based)
  slotType: SlotType;
}

export interface GridDay {
  dayOfWeek: number; // 1=Mon .. 7=Sun
  slots: GridSlot[]; // all slots (teaching + fixed), any order; sorted internally
}

export interface SolverGrid {
  days: GridDay[];
}

// One placeable unit. A normal lesson has a single offering; an elective-band
// lesson carries every offering (co-scheduled) and occupies all their teachers.
export interface Offering {
  subjectId: string;
  teacherId: string | null; // null = a teacher-less period (books the class only)
}

export interface Lesson {
  id: string;
  classId: string;
  size: number; // consecutive teaching slots required (1 = single, 2 = double)
  offerings: Offering[];
  teacherIds: string[]; // distinct teachers this lesson occupies
  bandId?: string;
  // Soft placement hints: preferred (day, sequence) starts. sequence is the
  // time_slot sequence of the first slot.
  prefer?: { day: number; slot: number }[];
  // Class-teacher first-period pin: when set, the lesson is fixed to the first
  // teaching slot of this weekday (size is always 1 for a pin).
  pinnedDay?: number;
  // Block-rule metadata shared by all lessons of the same class_subject / band.
  // groupKey ties them together (e.g. classId+subjectId, or bandId).
  groupKey?: string;
  maxPerDay?: number; // hard: at most this many of the group per day
  notTwiceSameDay?: boolean; // hard: at most one of the group per day
}

export type Hardness = 'hard' | 'soft';

export interface SolverTeacherConstraint {
  teacherId: string;
  type: 'max_per_day' | 'max_consecutive' | 'weekly_max' | 'day_off' | 'unavailable_slot' | 'preferred_slot';
  value: any; // shape depends on type (see constraint-checks)
  hardness: Hardness;
  weight?: number;
}

export interface ObjectiveWeights {
  minimizeTeacherGaps?: number;
  honorSoftPreferences?: number;
  evenDailyLoad?: number;
  spreadAcrossWeek?: number;
}

export interface SolverInput {
  classIds: string[];
  grid: SolverGrid;
  lessons: Lesson[];
  constraints: SolverTeacherConstraint[];
  objectiveWeights?: ObjectiveWeights;
  seed?: number;
  timeBudgetMs?: number;
}

// A placed lesson: occupies `slotIds` (length === lesson.size) on `dayOfWeek`.
export interface Placement {
  lessonId: string;
  classId: string;
  dayOfWeek: number;
  startSequence: number;
  slotIds: string[];
  offerings: Offering[];
  size: number;
  bandId?: string;
}

export interface Timetable {
  placements: Placement[];
}

export interface ScoredTimetable {
  timetable: Timetable;
  score: number;
  breakdown: Record<string, number>;
}

export interface ValidationIssue {
  rule: string;
  message: string;
}

export interface SolveResult {
  feasible: boolean;
  candidates: ScoredTimetable[];
  // populated when feasible === false
  reason?: string;
  unplacedLessonIds?: string[];
}
