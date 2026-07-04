import { DB, singleLineString } from '../../shared/lib/db';
import { SolverGrid, SolverTeacherConstraint } from './solver/types';
import { BuildInput } from './solver/build-lessons';
import { SolverLabels } from './message-labels';

export interface LoadedConfig {
  configId: string;
  academicYearId: string;
  grid: SolverGrid;
  teachingDays: number[];
  buildInput: BuildInput;
  constraints: SolverTeacherConstraint[];
  warnings: string[]; // e.g. class-subjects skipped because their subject is deleted
  labels: SolverLabels; // id -> human label, for humanizing issue/warning messages
  cohorts: string[][]; // class_group memberships in scope (composite classes), >= 2 each
}

// Load all academic + grid data for a config into the shapes the solver needs.
// Reads only active rows for the config's academic year. When `wingClassIds` is a
// non-empty array, the solve is scoped to just those classes (a wing); otherwise
// it covers the whole school for that academic year.
export async function loadConfigForSolve(schoolId: string, configId: string, wingClassIds?: string[] | null): Promise<LoadedConfig | null> {
  const configRows = await DB.query(
    singleLineString`select * from timetable_config where uuid = $1 and school_id = $2`,
    [configId, schoolId],
  );
  if (configRows.length === 0) return null;
  const academicYearId = configRows[0].academicYearId;

  // --- grid ---
  const days = await DB.query(
    singleLineString`select * from day_structure where config_id = $1 and school_id = $2 order by day_of_week`,
    [configId, schoolId],
  );
  const grid: SolverGrid = { days: [] };
  const teachingDays: number[] = [];
  for (const day of days) {
    const slots = await DB.query(
      singleLineString`select uuid, sequence, slot_type from time_slot where day_structure_id = $1 and school_id = $2 order by sequence`,
      [day.uuid, schoolId],
    );
    const gridSlots = slots.map((s: any) => ({ slotId: s.uuid, sequence: s.sequence, slotType: s.slotType }));
    grid.days.push({ dayOfWeek: day.dayOfWeek, slots: gridSlots });
    if (gridSlots.some((s: any) => s.slotType === 'teaching')) teachingDays.push(day.dayOfWeek);
  }

  // --- academic backbone ---
  // Exclude rows whose subject was soft-deleted — a deleted subject must never be
  // scheduled. (The Class Setup UI flags such orphaned rows with "(deleted)".)
  const classSubjects = await DB.query(
    singleLineString`select class_id, subject_id, periods_per_week, block_rules from class_subject
      where school_id = $1 and academic_year_id = $2 and status = 'active'
      and exists (select 1 from subject sub where sub.uuid = class_subject.subject_id and sub.status = 'active')`,
    [schoolId, academicYearId],
  );
  const teachingAssignments = await DB.query(
    singleLineString`select class_id, subject_id, teacher_id, period_share from teaching_assignment
      where school_id = $1 and academic_year_id = $2 and status = 'active'
      and exists (select 1 from subject sub where sub.uuid = teaching_assignment.subject_id and sub.status = 'active')`,
    [schoolId, academicYearId],
  );
  const classTeachers = await DB.query(
    singleLineString`select class_id, teacher_id, first_period_subject_id, first_period_days from class_teacher where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  // Member classes of each class_group (composite cohorts). A band pointing at a
  // group co-schedules across all its members; a plain band targets one class_id.
  const groupMemberRows = await DB.query(
    singleLineString`select uuid, class_group_id from class where school_id = $1 and class_group_id is not null`,
    [schoolId],
  );
  const groupMembers = new Map<string, string[]>();
  for (const r of groupMemberRows) {
    if (!groupMembers.has(r.classGroupId)) groupMembers.set(r.classGroupId, []);
    groupMembers.get(r.classGroupId)!.push(r.uuid);
  }

  const bands = await DB.query(
    singleLineString`select uuid, class_id, class_group_id, periods_per_week, block_rules, co_schedule from elective_band where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  const bandWarnings: string[] = [];
  const electiveBands = [];
  for (const band of bands) {
    const members = band.classGroupId
      ? groupMembers.get(band.classGroupId) ?? []
      : band.classId
        ? [band.classId]
        : [];
    if (members.length === 0) {
      bandWarnings.push(
        `Elective band ${band.uuid} has no classes (empty cohort or unset class) — skipped.`,
      );
      continue;
    }
    const offerings = await DB.query(
      singleLineString`select subject_id, teacher_id, period_share, class_id from elective_offering
        where band_id = $1 and school_id = $2 and status = 'active'
        and exists (select 1 from subject sub where sub.uuid = elective_offering.subject_id and sub.status = 'active')`,
      [band.uuid, schoolId],
    );
    electiveBands.push({
      bandId: band.uuid, classId: members[0], classIds: members, periodsPerWeek: band.periodsPerWeek,
      blockRules: band.blockRules,
      coSchedule: band.coSchedule ?? null,
      offerings: offerings.map((o: any) => ({ subjectId: o.subjectId, teacherId: o.teacherId, periodShare: o.periodShare ?? null, classId: o.classId ?? null })),
    });
  }

  const constraintRows = await DB.query(
    singleLineString`select teacher_id, constraint_type, value, hardness, weight from teacher_constraint where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  // Per-day teaching sequences (sorted): teaching-period index (1-based) -> grid sequence.
  // A constraint's `slot` is the Nth TEACHING period; translate to the real sequence so the
  // solver (which compares raw sequence) honors what the admin meant. `days[]` (or a single
  // `day`) is expanded into one solver constraint per day.
  const teachingSeqByDay = new Map<number, number[]>();
  for (const day of grid.days) {
    teachingSeqByDay.set(
      day.dayOfWeek,
      day.slots.filter((s) => s.slotType === "teaching").map((s) => s.sequence).sort((a, b) => a - b),
    );
  }
  const toSeq = (day: number, periodIndex: number): number | null => {
    const seqs = teachingSeqByDay.get(day);
    if (!seqs || !(periodIndex >= 1) || periodIndex > seqs.length) return null;
    return seqs[periodIndex - 1];
  };
  const SLOT_TYPES = new Set(["unavailable_slot", "preferred_slot", "available_slot"]);
  const DAY_TYPES = new Set(["day_off", "unavailable_slot", "preferred_slot", "available_slot"]);
  const constraintWarnings: string[] = [];
  const constraints: SolverTeacherConstraint[] = [];
  for (const c of constraintRows) {
    const type = c.constraintType;
    const v = c.value || {};
    const base = { teacherId: c.teacherId, type, hardness: c.hardness, weight: c.weight ?? undefined };
    if (!DAY_TYPES.has(type)) {
      constraints.push({ ...base, value: v });
      continue;
    }
    const days: number[] = Array.isArray(v.days) ? v.days : v.day != null ? [v.day] : [];
    for (const day of days) {
      if (SLOT_TYPES.has(type)) {
        const seq = toSeq(Number(day), Number(v.slot));
        if (seq == null) {
          constraintWarnings.push(
            `Teacher ${c.teacherId} ${type}: teaching period ${v.slot} doesn't exist on day ${day} — skipped.`,
          );
          continue;
        }
        constraints.push({ ...base, value: { day, slot: seq } });
      } else {
        constraints.push({ ...base, value: { day } });
      }
    }
  }

  // Scope to a wing's classes when requested (else whole school).
  const wingSet = wingClassIds && wingClassIds.length > 0 ? new Set(wingClassIds) : null;
  const inScope = (classId: string) => !wingSet || wingSet.has(classId);
  const scopedClassSubjects = classSubjects.filter((c: any) => inScope(c.classId));
  const scopedTeachingAssignments = teachingAssignments.filter((a: any) => inScope(a.classId));
  const scopedClassTeachers = classTeachers.filter((c: any) => inScope(c.classId));
  // A band stays if any member is in scope; its member list is narrowed to in-scope
  // classes (so a wing solve co-schedules only the wing's members of a cohort band).
  const scopedElectiveBands = electiveBands
    .map((b: any) => {
      const ids = b.classIds.filter(inScope);
      return { ...b, classIds: ids, classId: ids[0] ?? b.classId };
    })
    .filter((b: any) => b.classIds.length > 0);

  // classes in play
  const classIds = [...new Set<string>([
    ...scopedClassSubjects.map((c: any) => c.classId),
    ...scopedElectiveBands.flatMap((b: any) => b.classIds),
    ...scopedClassTeachers.map((c: any) => c.classId),
  ])];

  // Cohorts (composite classes) for lockstep: each class_group's in-scope members,
  // kept only when 2+ members are in scope.
  const cohorts: string[][] = [];
  for (const members of groupMembers.values()) {
    const inScopeMembers = [...new Set(members.filter(inScope))];
    if (inScopeMembers.length >= 2) cohorts.push(inScopeMembers);
  }

  const buildInput: BuildInput = {
    classIds,
    teachingDays,
    classSubjects: scopedClassSubjects.map((c: any) => ({ classId: c.classId, subjectId: c.subjectId, periodsPerWeek: c.periodsPerWeek, blockRules: c.blockRules })),
    teachingAssignments: scopedTeachingAssignments.map((a: any) => ({ classId: a.classId, subjectId: a.subjectId, teacherId: a.teacherId, periodShare: a.periodShare })),
    classTeachers: scopedClassTeachers.map((c: any) => ({ classId: c.classId, teacherId: c.teacherId, firstPeriodSubjectId: c.firstPeriodSubjectId, firstPeriodDays: c.firstPeriodDays ?? null })),
    electiveBands: scopedElectiveBands,
  };

  // Warn (don't fail) about active class-subjects whose subject is deleted — these
  // were skipped above and won't be scheduled; the admin should fix them in Class Setup.
  const deletedRefs = await DB.query(
    singleLineString`select cs.class_id as class_id, s.name as subject_name
      from class_subject cs join subject s on s.uuid = cs.subject_id
      where cs.school_id = $1 and cs.academic_year_id = $2 and cs.status = 'active' and s.status = 'deleted'`,
    [schoolId, academicYearId],
  );
  const warnings = [
    ...bandWarnings,
    ...constraintWarnings,
    ...deletedRefs
      .filter((r: any) => inScope(r.classId))
      .map((r: any) => `Class ${r.classId}: subject "${r.subjectName}" is deleted — skipped from generation.`),
  ];

  // --- display labels (id -> human name) for humanizing messages ---
  // Collect every id that can appear in an issue/warning string, then look up names.
  const subjectIds = new Set<string>([
    ...scopedClassSubjects.map((c: any) => c.subjectId),
    ...scopedTeachingAssignments.map((a: any) => a.subjectId),
    ...scopedElectiveBands.flatMap((b: any) => b.offerings.map((o: any) => o.subjectId)),
  ]);
  const teacherIds = new Set<string>([
    ...scopedTeachingAssignments.map((a: any) => a.teacherId),
    ...scopedClassTeachers.map((c: any) => c.teacherId),
    ...scopedElectiveBands.flatMap((b: any) => b.offerings.map((o: any) => o.teacherId)),
    ...constraints.map((c) => c.teacherId),
  ]);

  const labels = await loadLabels(schoolId, classIds, [...subjectIds], [...teacherIds]);

  return { configId, academicYearId, grid, teachingDays, buildInput, constraints, warnings, labels, cohorts };
}

// Look up display names for the ids in play. Each lookup is empty-safe (any($)
// over [] simply returns no rows).
async function loadLabels(
  schoolId: string,
  classIds: string[],
  subjectIds: string[],
  teacherIds: string[],
): Promise<SolverLabels> {
  const labels: SolverLabels = { class: new Map(), subject: new Map(), teacher: new Map() };

  const classes = await DB.query(
    singleLineString`select uuid, name from class where school_id = $1 and uuid = any($2)`,
    [schoolId, classIds],
  );
  for (const c of classes) labels.class.set(c.uuid, c.name);

  const subjects = await DB.query(
    singleLineString`select uuid, name, code from subject where school_id = $1 and uuid = any($2)`,
    [schoolId, subjectIds],
  );
  for (const s of subjects) labels.subject.set(s.uuid, `${s.name} (${s.code})`);

  const teachers = await DB.query(
    singleLineString`select uuid, name from employee where school_id = $1 and uuid = any($2)`,
    [schoolId, teacherIds],
  );
  for (const t of teachers) labels.teacher.set(t.uuid, t.name);

  return labels;
}
