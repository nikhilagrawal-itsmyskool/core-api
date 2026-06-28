import { Lesson } from "./types";

// DB-shaped (camelCase) inputs. Kept separate from the DB layer so this is unit
// testable. block_rules follows BlockRules from timetable-interfaces.
export interface BuildBlockRules {
  blocks: {
    size: number;
    count: number;
    prefer?: { day: number; slot: number }[];
  }[];
  maxPeriodsPerDay?: number;
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
  // A band offering's subject may be split across teachers (like class_subject's
  // period_share): several offerings with the same subjectId, each a share. null =
  // that teacher takes all of the subject's band periods.
  periodShare?: number | null;
}
export interface BuildElectiveBand {
  bandId: string;
  classId: string;
  // Cross-class (cohort) band: every class co-scheduled into the same slots.
  // Absent/empty = a normal single-class band on [classId]. Set with >1 class for
  // a composite class like XI-A (Science + Commerce share the band's rooms/slots).
  classIds?: string[];
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

// Spread a subject's teachers across U band units. One teacher -> all units. Several
// (a split) -> contiguous blocks sized by share (or evenly when shares are absent), e.g.
// Bio ADS:6 / SP:3 over 9 units -> [ADS×6, SP×3]. The solver then arranges them across
// days; teacherVariety nudges same-day repeats onto the other teacher.
function assignTeachersPerUnit(
  teachers: { teacherId: string; share?: number | null }[],
  U: number,
): string[] {
  if (teachers.length <= 1)
    return Array(U).fill(teachers[0]?.teacherId ?? null);
  const allShares = teachers.every(
    (t) => typeof t.share === "number" && t.share! > 0,
  );
  let counts: number[];
  if (allShares) {
    const total = teachers.reduce((s, t) => s + (t.share || 0), 0);
    counts = teachers.map((t) => Math.round(((t.share || 0) / total) * U));
  } else {
    const base = Math.floor(U / teachers.length);
    let extra = U % teachers.length;
    counts = teachers.map(() => base + (extra-- > 0 ? 1 : 0));
  }
  // reconcile rounding so the counts sum to exactly U
  let sum = counts.reduce((a, b) => a + b, 0);
  for (let i = 0; sum < U; i = (i + 1) % counts.length) (counts[i]++, sum++);
  for (let i = 0; sum > U; i = (i + 1) % counts.length)
    if (counts[i] > 0) (counts[i]--, sum--);
  const out: string[] = [];
  teachers.forEach((t, ti) => {
    for (let k = 0; k < counts[ti]; k++) out.push(t.teacherId);
  });
  return out;
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
    const groupKey = `band:${band.bandId}`;
    // Member classes co-scheduled by this band (a composite-class band lists >1).
    const members =
      band.classIds && band.classIds.length > 0
        ? band.classIds
        : [band.classId];
    const units = expandBlocks(band.blockRules, band.periodsPerWeek);
    // Group offerings by subject; a subject split across teachers gets a teacher per unit.
    const bySubject = new Map<string, { teacherId: string; share?: number | null }[]>();
    for (const o of band.offerings) {
      if (!bySubject.has(o.subjectId)) bySubject.set(o.subjectId, []);
      bySubject.get(o.subjectId)!.push({ teacherId: o.teacherId, share: o.periodShare });
    }
    const teacherPerUnit = new Map<string, string[]>();
    for (const [subjectId, teachers] of bySubject)
      teacherPerUnit.set(subjectId, assignTeachersPerUnit(teachers, units.length));
    const subjectIds = [...bySubject.keys()];

    units.forEach((unit, i) => {
      const offerings = subjectIds.map((subjectId) => ({
        subjectId,
        teacherId: teacherPerUnit.get(subjectId)![i],
      }));
      lessons.push({
        id: nextId(),
        classId: members[0],
        classIds: members.length > 1 ? members : undefined,
        size: unit.size,
        offerings,
        teacherIds: [...new Set(offerings.map((o) => o.teacherId))],
        bandId: band.bandId,
        groupKey,
        maxPerDay: band.blockRules?.maxPerDay,
        notTwiceSameDay: band.blockRules?.notTwiceSameDay,
        prefer: unit.prefer,
      });
    });
  }

  // Hard per-day period cap (default 2) for every lesson of a group — covers
  // homeroom pins, singles, splits and bands centrally. A double (size 2) = 2 periods.
  const capByGroup = new Map<string, number>();
  for (const cs of input.classSubjects) {
    capByGroup.set(
      `cs:${cs.classId}:${cs.subjectId}`,
      cs.blockRules?.maxPeriodsPerDay ?? 2,
    );
  }
  for (const band of input.electiveBands) {
    capByGroup.set(
      `band:${band.bandId}`,
      band.blockRules?.maxPeriodsPerDay ?? 2,
    );
  }
  for (const l of lessons) {
    if (l.maxPeriodsPerDay === undefined) {
      l.maxPeriodsPerDay = (l.groupKey && capByGroup.get(l.groupKey)) ?? 2;
    }
  }

  return { lessons, warnings };
}
