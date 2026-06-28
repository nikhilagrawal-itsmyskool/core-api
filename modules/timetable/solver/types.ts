// Pure solver data model. These types are independent of the DB layer so the
// solver can be unit-tested with hand-built inputs (no server / no Postgres).

export type SlotType =
  | "teaching"
  | "assembly"
  | "break"
  | "lunch"
  | "reserved"
  | "activity"
  | "registration";

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
  // Classes co-scheduled by this one lesson. Absent/empty = just [classId] (the
  // normal single-class case). Set to >1 class only for a cross-class group band
  // or shared single (a cohort/composite class like XI-A): the lesson books every
  // listed class at the same slot, while each teacher is still booked only once.
  classIds?: string[];
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
  maxPeriodsPerDay?: number; // hard: at most this many PERIODS of the group per day (double counts as 2); default 2
  maxPerDay?: number; // deprecated hard: at most this many placements of the group per day
  notTwiceSameDay?: boolean; // deprecated hard: at most one placement of the group per day
}

export type Hardness = "hard" | "soft";

export interface SolverTeacherConstraint {
  teacherId: string;
  type:
    | "max_per_day"
    | "max_consecutive"
    | "weekly_max"
    | "day_off"
    | "unavailable_slot"
    | "preferred_slot"
    | "available_slot";
  value: any; // shape depends on type (see constraint-checks)
  hardness: Hardness;
  weight?: number;
}

export interface ObjectiveWeights {
  minimizeTeacherGaps?: number;
  honorSoftPreferences?: number;
  evenDailyLoad?: number;
  spreadAcrossWeek?: number;
  // Keep a cohort's member classes busy/free at the same slots (composite classes
  // move in lockstep). Penalizes any teaching slot where some members are busy and
  // others free. Soft — never blocks a solution.
  cohortLockstep?: number;
  // Keep a subject in the SAME period across days ("Chemistry is always 2nd period").
  // Penalizes a group using more distinct period-columns than it needs; the last 2
  // teaching periods of each day are exempt (the day-varying "flex tail"). Soft.
  columnConsistency?: number;
  // Anti-monotony: when a subject is split across two teachers, don't give the same
  // class the same teacher for that subject twice in a day — penalize repeats so the
  // solver alternates teachers. Soft.
  teacherVariety?: number;
}

export interface SolverInput {
  classIds: string[];
  grid: SolverGrid;
  lessons: Lesson[];
  constraints: SolverTeacherConstraint[];
  objectiveWeights?: ObjectiveWeights;
  seed?: number;
  timeBudgetMs?: number;
  // Groups of class ids that should run in lockstep (a cohort / composite class).
  // Drives the placement bias + cohortLockstep score. Each group has >= 2 classes.
  cohorts?: string[][];
}

// A placed lesson: occupies `slotIds` (length === lesson.size) on `dayOfWeek`.
export interface Placement {
  lessonId: string;
  classId: string;
  // All classes this placement occupies (mirrors Lesson.classIds). Absent = [classId].
  classIds?: string[];
  dayOfWeek: number;
  startSequence: number;
  slotIds: string[];
  offerings: Offering[];
  size: number;
  bandId?: string;
}

// The set of classes a lesson/placement occupies: its classIds when present,
// else just [classId]. Single-class is the universal default.
export function classesOf(x: { classId: string; classIds?: string[] }): string[] {
  return x.classIds && x.classIds.length > 0 ? x.classIds : [x.classId];
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
