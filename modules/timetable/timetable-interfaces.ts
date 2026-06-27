import {
  SubjectKind,
  SlotType,
  ConstraintType,
  Hardness,
  StatusValue,
  ConfigStatus,
} from "./timetable-constants";

// Common audit fields on every row.
export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid?: string;
  createdAt?: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ----------------------------------------------------------------- block_rules
// Shared by class_subject and elective_band. sum(size*count) must equal
// periods_per_week. `prefer` is a soft placement hint honored by the solver score.
export interface BlockRule {
  size: number;
  count: number;
  prefer?: { day: number; slot: number }[];
}

export interface BlockRules {
  blocks: BlockRule[];
  // Hard cap on periods of this subject per day (a double = 2). Default 2 (applied
  // in the solver). The "aim for one slot/day" preference is soft (see score.ts).
  maxPeriodsPerDay?: number;
  // Deprecated (no longer set by the UI; kept for backward compatibility):
  maxPerDay?: number;
  notTwiceSameDay?: boolean;
}

// --------------------------------------------------------------------- subject
export interface Subject extends BaseEntity {
  name: string;
  code: string;
  kind: SubjectKind;
  status: StatusValue;
}

export interface CreateSubjectRequest {
  name: string;
  code: string;
  kind: SubjectKind;
}

export interface UpdateSubjectRequest {
  name?: string;
  code?: string;
  kind?: SubjectKind;
}

// --------------------------------------------------------------- class_subject
export interface ClassSubject extends BaseEntity {
  academicYearId: string;
  classId: string;
  subjectId: string;
  subjectName?: string;
  subjectCode?: string;
  subjectStatus?: StatusValue; // 'deleted' = orphaned reference (flagged in the UI)
  periodsPerWeek: number;
  blockRules?: BlockRules;
  status: StatusValue;
}

export interface CreateClassSubjectRequest {
  academicYearId: string;
  classId: string;
  subjectId: string;
  periodsPerWeek: number;
  blockRules?: BlockRules;
}

export interface UpdateClassSubjectRequest {
  periodsPerWeek?: number;
  blockRules?: BlockRules;
}

// ---------------------------------------------------------- teaching_assignment
export interface TeachingAssignment extends BaseEntity {
  academicYearId: string;
  classId: string;
  subjectId: string;
  subjectName?: string;
  subjectCode?: string;
  subjectStatus?: StatusValue;
  teacherId: string;
  periodShare?: number;
  status: StatusValue;
}

export interface CreateTeachingAssignmentRequest {
  academicYearId: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  periodShare?: number;
}

export interface UpdateTeachingAssignmentRequest {
  periodShare?: number | null;
}

// ----------------------------------------------------------------- class_teacher
export interface ClassTeacher extends BaseEntity {
  academicYearId: string;
  classId: string;
  teacherId: string;
  // null/undefined = auto-pick the class teacher's subject with the most periods/week.
  firstPeriodSubjectId?: string | null;
  // Weekdays (1=Mon..7=Sun) the class teacher takes the 1st (first teaching) period.
  // null/undefined = all teaching days; [] = takes no first period (floats).
  firstPeriodDays?: number[] | null;
  status: StatusValue;
}

export interface CreateClassTeacherRequest {
  academicYearId: string;
  classId: string;
  teacherId: string;
  firstPeriodSubjectId?: string | null;
  firstPeriodDays?: number[] | null;
}

export interface UpdateClassTeacherRequest {
  teacherId?: string;
  firstPeriodSubjectId?: string | null;
  firstPeriodDays?: number[] | null;
}

// ------------------------------------------------------------------------ wing
// A named set of classes (primary/middle/senior, etc.) for an academic year.
export interface Wing extends BaseEntity {
  academicYearId: string;
  name: string;
  classIds: string[];
  classes?: { classId: string; className?: string }[];
  status: StatusValue;
}

export interface CreateWingRequest {
  academicYearId: string;
  name: string;
  classIds: string[];
}

export interface UpdateWingRequest {
  name?: string;
  classIds?: string[];
}

// ------------------------------------------------------- elective band/offering
export interface ElectiveOffering extends BaseEntity {
  bandId: string;
  subjectId: string;
  subjectName?: string;
  subjectCode?: string;
  subjectStatus?: StatusValue;
  teacherId: string;
  status: StatusValue;
}

export interface ElectiveBand extends BaseEntity {
  academicYearId: string;
  classId: string;
  name: string;
  periodsPerWeek: number;
  blockRules?: BlockRules;
  status: StatusValue;
  offerings?: ElectiveOffering[];
}

export interface ElectiveOfferingInput {
  subjectId: string;
  teacherId: string;
}

export interface CreateElectiveBandRequest {
  academicYearId: string;
  classId: string;
  name: string;
  periodsPerWeek: number;
  blockRules?: BlockRules;
  offerings?: ElectiveOfferingInput[];
}

export interface UpdateElectiveBandRequest {
  name?: string;
  periodsPerWeek?: number;
  blockRules?: BlockRules;
}

export interface CreateElectiveOfferingRequest {
  subjectId: string;
  teacherId: string;
}

// ------------------------------------------------------------- clone class setup
// Deep-copy one section's academic setup (class subjects, teaching assignments,
// and elective bands+offerings) onto another section in the same academic year.
// The class teacher is NOT copied — it is the per-section difference, set on the
// target afterward. New uuids are minted; the target must have no cloneable setup.
export interface CloneClassSetupRequest {
  sourceClassId: string;
  targetClassId: string;
  academicYearId: string;
}

export interface CloneClassSetupResult {
  classSubjects: number;
  teachingAssignments: number;
  electiveBands: number;
  electiveOfferings: number;
}

// ------------------------------------------------------------- timetable_config
export interface TimetableConfig extends BaseEntity {
  academicYearId: string;
  name: string;
  status: ConfigStatus;
  // Lock lifecycle: null = draft (editable); non-null = locked (immutable, the
  // only state usable for generation).
  lockedAt?: string | null;
  lockedbyUserid?: string | null;
  days?: DayStructure[];
}

export interface CreateConfigRequest {
  academicYearId: string;
  name: string;
}

export interface UpdateConfigRequest {
  name?: string;
  status?: ConfigStatus;
}

export interface CloneConfigRequest {
  name?: string;
}

// --------------------------------------------------------------- day_structure
export interface DayStructure extends BaseEntity {
  configId: string;
  dayOfWeek: number;
  label?: string;
  slots?: TimeSlot[];
}

export interface CreateDayStructureRequest {
  dayOfWeek: number;
  label?: string;
}

export interface UpdateDayStructureRequest {
  label?: string;
}

// -------------------------------------------------------------------- time_slot
export interface TimeSlot extends BaseEntity {
  dayStructureId: string;
  sequence: number;
  startTime?: string;
  endTime?: string;
  slotType: SlotType;
  label?: string;
}

export interface CreateTimeSlotRequest {
  sequence: number;
  startTime?: string;
  endTime?: string;
  slotType: SlotType;
  label?: string;
}

export interface UpdateTimeSlotRequest {
  sequence?: number;
  startTime?: string;
  endTime?: string;
  slotType?: SlotType;
  label?: string;
}

// ------------------------------------------------------------ teacher_constraint
export interface TeacherConstraint extends BaseEntity {
  academicYearId: string;
  teacherId: string;
  constraintType: ConstraintType;
  value?: any;
  hardness: Hardness;
  weight?: number;
  status: StatusValue;
}

export interface CreateTeacherConstraintRequest {
  academicYearId: string;
  teacherId: string;
  constraintType: ConstraintType;
  value?: any;
  hardness: Hardness;
  weight?: number;
}

export interface UpdateTeacherConstraintRequest {
  value?: any;
  hardness?: Hardness;
  weight?: number;
}
