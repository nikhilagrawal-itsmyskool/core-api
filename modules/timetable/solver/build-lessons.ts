import { Lesson } from "./types";

// DB-shaped (camelCase) inputs. Kept separate from the DB layer so this is unit
// testable. block_rules follows BlockRules from timetable-interfaces.
export interface BuildBlockRules {
  blocks: {
    size: number;
    count: number;
    prefer?: { day: number; slot: number }[];
  }[];
  maxPerDay?: number;
  notTwiceSameDay?: boolean;
}
export interface BuildClassSubject {
  classId: string;
  subjectId: string;
  periodsPerWeek: number;
  blockRules?: BuildBlockRules;
}
export interface BuildTeachingAssignment {
  classId: string;
  subjectId: string;
  teacherId: string;
  periodShare?: number | null;
}
export interface BuildClassTeacher {
  classId: string;
  teacherId: string;
  firstPeriodSubjectId?: string | null;
  firstPeriodDays?: number[] | null;
}
export interface BuildOffering {
  subjectId: string;
  teacherId: string;
}
export interface BuildElectiveBand {
  bandId: string;
  classId: string;
  periodsPerWeek: number;
  blockRules?: BuildBlockRules;
  offerings: BuildOffering[];
}

export interface BuildInput {
  classIds: string[];
  teachingDays: number[]; // weekdays (1=Mon) that have >=1 teaching slot
  classSubjects: BuildClassSubject[];
  teachingAssignments: BuildTeachingAssignment[];
  classTeachers: BuildClassTeacher[];
  electiveBands: BuildElectiveBand[];
}

interface Unit {
  size: number;
  prefer?: { day: number; slot: number }[];
}

function expandBlocks(
  blockRules: BuildBlockRules | undefined,
  periodsPerWeek: number,
): Unit[] {
  if (!blockRules || !blockRules.blocks || blockRules.blocks.length === 0) {
    return Array.from({ length: periodsPerWeek }, () => ({ size: 1 }));
  }
  const units: Unit[] = [];
  for (const b of blockRules.blocks) {
    for (let i = 0; i < b.count; i++)
      units.push({ size: b.size, prefer: b.prefer });
  }
  return units;
}

// Convert academic config into placeable lessons. Documented v1 behavior:
//  - Class teacher's "homeroom subject" gets one pin per teaching day (first
//    period); its remaining periods become singles (block rules ignored for it).
//  - A class_subject with one teacher expands per its block rules.
//  - A class_subject split across teachers (period_share) becomes singles split
//    by share (block rules ignored for splits).
//  - Each elective band becomes co-scheduled multi-offering lessons.
export function buildLessons(input: BuildInput): {
  lessons: Lesson[];
  warnings: string[];
} {
  const lessons: Lesson[] = [];
  const warnings: string[] = [];
  let counter = 0;
  const nextId = () => `L${++counter}`;

  const classTeacherOf = new Map<string, string>();
  const firstPeriodChoiceOf = new Map<string, string>();
  // Which weekdays each class's 1st period is pinned to the class teacher. A class
  // not present here (firstPeriodDays null/undefined) pins on all teaching days.
  const firstPeriodDaysOf = new Map<string, number[]>();
  for (const ct of input.classTeachers) {
    classTeacherOf.set(ct.classId, ct.teacherId);
    if (ct.firstPeriodSubjectId)
      firstPeriodChoiceOf.set(ct.classId, ct.firstPeriodSubjectId);
    if (ct.firstPeriodDays !== undefined && ct.firstPeriodDays !== null)
      firstPeriodDaysOf.set(ct.classId, ct.firstPeriodDays);
  }

  const assignmentsFor = (classId: string, subjectId: string) =>
    input.teachingAssignments.filter(
      (a) => a.classId === classId && a.subjectId === subjectId,
    );

  // Identify each class's homeroom subject (a class_subject taught by its class teacher).
  // Admin can pin a specific subject (firstPeriodSubjectId); otherwise auto-pick the
  // class teacher's subject with the most periods/week.
  const homeroomSubjectOf = new Map<string, string>();
  for (const classId of input.classIds) {
    const teacherId = classTeacherOf.get(classId);
    if (!teacherId) continue;
    const taughtByClassTeacher = (subjectId: string) =>
      input.classSubjects.some(
        (cs) => cs.classId === classId && cs.subjectId === subjectId,
      ) &&
      assignmentsFor(classId, subjectId).some((a) => a.teacherId === teacherId);

    const chosen = firstPeriodChoiceOf.get(classId);
    if (chosen) {
      if (taughtByClassTeacher(chosen)) {
        homeroomSubjectOf.set(classId, chosen);
        continue;
      }
      warnings.push(
        `Class ${classId}'s chosen first-period subject is not taught by its class teacher — falling back to the auto pick.`,
      );
    }
    const candidates = input.classSubjects
      .filter(
        (cs) =>
          cs.classId === classId &&
          assignmentsFor(classId, cs.subjectId).some(
            (a) => a.teacherId === teacherId,
          ),
      )
      .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek);
    if (candidates.length > 0)
      homeroomSubjectOf.set(classId, candidates[0].subjectId);
    else
      warnings.push(
        `Class ${classId} has a class teacher but that teacher has no subject assigned to the class — no first-period pin created.`,
      );
  }

  for (const cs of input.classSubjects) {
    const groupKey = `cs:${cs.classId}:${cs.subjectId}`;
    const assignments = assignmentsFor(cs.classId, cs.subjectId);
    const maxPerDay = cs.blockRules?.maxPerDay;
    const notTwiceSameDay = cs.blockRules?.notTwiceSameDay;

    if (assignments.length === 0) {
      // No teacher assigned: still schedule it as a teacher-less period (books the
      // class only, no teacher clash) — e.g. supervised study or a library period.
      warnings.push(
        `Class ${cs.classId} subject ${cs.subjectId} has no teacher — scheduled as ${cs.periodsPerWeek} teacher-less period(s).`,
      );
      for (const unit of expandBlocks(cs.blockRules, cs.periodsPerWeek)) {
        lessons.push({
          id: nextId(),
          classId: cs.classId,
          size: unit.size,
          offerings: [{ subjectId: cs.subjectId, teacherId: null }],
          teacherIds: [],
          groupKey,
          maxPerDay,
          notTwiceSameDay,
          prefer: unit.prefer,
        });
      }
      continue;
    }

    const classTeacher = classTeacherOf.get(cs.classId);
    const isHomeroom = homeroomSubjectOf.get(cs.classId) === cs.subjectId;

    if (isHomeroom && classTeacher) {
      // Which weekdays the 1st period is pinned to the class teacher: the configured
      // firstPeriodDays (intersected with teaching days) or, when unset, every
      // teaching day. On excepted days the 1st teaching slot is left to the solver.
      const configuredDays = firstPeriodDaysOf.get(cs.classId);
      const eligibleDays = configuredDays
        ? input.teachingDays.filter((d) => configuredDays.includes(d))
        : [...input.teachingDays];
      // pins: one per eligible day (capped at periodsPerWeek)
      const pinCount = Math.min(cs.periodsPerWeek, eligibleDays.length);
      if (cs.periodsPerWeek < eligibleDays.length) {
        warnings.push(
          `Class ${cs.classId} homeroom subject has ${cs.periodsPerWeek} periods but ${eligibleDays.length} days pin the class teacher to the first period — only ${pinCount} will be the class teacher's.`,
        );
      }
      if (cs.blockRules?.blocks?.some((b) => b.size > 1)) {
        warnings.push(
          `Class ${cs.classId} homeroom subject has double blocks configured — ignored (homeroom periods are placed as singles).`,
        );
      }
      const pinDays = [...eligibleDays]
        .sort((a, b) => a - b)
        .slice(0, pinCount);
      for (const day of pinDays) {
        lessons.push({
          id: nextId(),
          classId: cs.classId,
          size: 1,
          offerings: [{ subjectId: cs.subjectId, teacherId: classTeacher }],
          teacherIds: [classTeacher],
          groupKey,
          pinnedDay: day,
        });
      }
      const remaining = cs.periodsPerWeek - pinCount;
      for (let i = 0; i < remaining; i++) {
        lessons.push({
          id: nextId(),
          classId: cs.classId,
          size: 1,
          offerings: [{ subjectId: cs.subjectId, teacherId: classTeacher }],
          teacherIds: [classTeacher],
          groupKey,
        });
      }
      continue;
    }

    if (assignments.length === 1) {
      const teacherId = assignments[0].teacherId;
      for (const unit of expandBlocks(cs.blockRules, cs.periodsPerWeek)) {
        lessons.push({
          id: nextId(),
          classId: cs.classId,
          size: unit.size,
          offerings: [{ subjectId: cs.subjectId, teacherId }],
          teacherIds: [teacherId],
          groupKey,
          maxPerDay,
          notTwiceSameDay,
          prefer: unit.prefer,
        });
      }
      continue;
    }

    // split across teachers
    if (cs.blockRules?.blocks?.some((b) => b.size > 1)) {
      warnings.push(
        `Class ${cs.classId} subject ${cs.subjectId} is split across teachers — double blocks ignored, placed as singles.`,
      );
    }
    const sharesGiven = assignments.every(
      (a) => typeof a.periodShare === "number" && a.periodShare! > 0,
    );
    let shares: { teacherId: string; count: number }[];
    if (
      sharesGiven &&
      assignments.reduce((s, a) => s + (a.periodShare || 0), 0) ===
        cs.periodsPerWeek
    ) {
      shares = assignments.map((a) => ({
        teacherId: a.teacherId,
        count: a.periodShare!,
      }));
    } else {
      warnings.push(
        `Class ${cs.classId} subject ${cs.subjectId}: period shares missing/inconsistent — splitting ${cs.periodsPerWeek} periods evenly.`,
      );
      const base = Math.floor(cs.periodsPerWeek / assignments.length);
      let extra = cs.periodsPerWeek % assignments.length;
      shares = assignments.map((a) => ({
        teacherId: a.teacherId,
        count: base + (extra-- > 0 ? 1 : 0),
      }));
    }
    for (const share of shares) {
      for (let i = 0; i < share.count; i++) {
        lessons.push({
          id: nextId(),
          classId: cs.classId,
          size: 1,
          offerings: [{ subjectId: cs.subjectId, teacherId: share.teacherId }],
          teacherIds: [share.teacherId],
          groupKey,
          maxPerDay,
          notTwiceSameDay,
        });
      }
    }
  }

  // elective bands
  for (const band of input.electiveBands) {
    if (!band.offerings || band.offerings.length === 0) {
      warnings.push(`Elective band ${band.bandId} has no offerings — skipped.`);
      continue;
    }
    const teacherIds = [...new Set(band.offerings.map((o) => o.teacherId))];
    const groupKey = `band:${band.bandId}`;
    for (const unit of expandBlocks(band.blockRules, band.periodsPerWeek)) {
      lessons.push({
        id: nextId(),
        classId: band.classId,
        size: unit.size,
        offerings: band.offerings.map((o) => ({ ...o })),
        teacherIds,
        bandId: band.bandId,
        groupKey,
        maxPerDay: band.blockRules?.maxPerDay,
        notTwiceSameDay: band.blockRules?.notTwiceSameDay,
        prefer: unit.prefer,
      });
    }
  }

  return { lessons, warnings };
}
