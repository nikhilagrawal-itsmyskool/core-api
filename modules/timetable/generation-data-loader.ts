import { DB, singleLineString } from '../../shared/lib/db';
import { SolverGrid, SolverTeacherConstraint } from './solver/types';
import { BuildInput } from './solver/build-lessons';

export interface LoadedConfig {
  configId: string;
  academicYearId: string;
  grid: SolverGrid;
  teachingDays: number[];
  buildInput: BuildInput;
  constraints: SolverTeacherConstraint[];
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
  const classSubjects = await DB.query(
    singleLineString`select class_id, subject_id, periods_per_week, block_rules from class_subject where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  const teachingAssignments = await DB.query(
    singleLineString`select class_id, subject_id, teacher_id, period_share from teaching_assignment where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  const classTeachers = await DB.query(
    singleLineString`select class_id, teacher_id, first_period_subject_id from class_teacher where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  const bands = await DB.query(
    singleLineString`select uuid, class_id, periods_per_week, block_rules from elective_band where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  const electiveBands = [];
  for (const band of bands) {
    const offerings = await DB.query(
      singleLineString`select subject_id, teacher_id from elective_offering where band_id = $1 and school_id = $2 and status = 'active'`,
      [band.uuid, schoolId],
    );
    electiveBands.push({
      bandId: band.uuid, classId: band.classId, periodsPerWeek: band.periodsPerWeek,
      blockRules: band.blockRules, offerings: offerings.map((o: any) => ({ subjectId: o.subjectId, teacherId: o.teacherId })),
    });
  }

  const constraintRows = await DB.query(
    singleLineString`select teacher_id, constraint_type, value, hardness, weight from teacher_constraint where school_id = $1 and academic_year_id = $2 and status = 'active'`,
    [schoolId, academicYearId],
  );
  const constraints: SolverTeacherConstraint[] = constraintRows.map((c: any) => ({
    teacherId: c.teacherId, type: c.constraintType, value: c.value, hardness: c.hardness, weight: c.weight ?? undefined,
  }));

  // Scope to a wing's classes when requested (else whole school).
  const wingSet = wingClassIds && wingClassIds.length > 0 ? new Set(wingClassIds) : null;
  const inScope = (classId: string) => !wingSet || wingSet.has(classId);
  const scopedClassSubjects = classSubjects.filter((c: any) => inScope(c.classId));
  const scopedTeachingAssignments = teachingAssignments.filter((a: any) => inScope(a.classId));
  const scopedClassTeachers = classTeachers.filter((c: any) => inScope(c.classId));
  const scopedElectiveBands = electiveBands.filter((b: any) => inScope(b.classId));

  // classes in play
  const classIds = [...new Set<string>([
    ...scopedClassSubjects.map((c: any) => c.classId),
    ...scopedElectiveBands.map((b: any) => b.classId),
    ...scopedClassTeachers.map((c: any) => c.classId),
  ])];

  const buildInput: BuildInput = {
    classIds,
    teachingDays,
    classSubjects: scopedClassSubjects.map((c: any) => ({ classId: c.classId, subjectId: c.subjectId, periodsPerWeek: c.periodsPerWeek, blockRules: c.blockRules })),
    teachingAssignments: scopedTeachingAssignments.map((a: any) => ({ classId: a.classId, subjectId: a.subjectId, teacherId: a.teacherId, periodShare: a.periodShare })),
    classTeachers: scopedClassTeachers.map((c: any) => ({ classId: c.classId, teacherId: c.teacherId, firstPeriodSubjectId: c.firstPeriodSubjectId })),
    electiveBands: scopedElectiveBands,
  };

  return { configId, academicYearId, grid, teachingDays, buildInput, constraints };
}
