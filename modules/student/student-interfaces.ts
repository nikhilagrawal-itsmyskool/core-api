export interface Student {
  uuid: string;
  name: string;
  email?: string;
  phone?: string;
  admissionNo?: string;
  status: string;
  schoolId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface StudentWithClass extends Student {
  classId?: string;
  className?: string;
  academicYearId?: string;
  academicYearName?: string;
}

// ---- Admin: full student record ----

// Demographic / identity / lifecycle fields shared by create & update.
export interface StudentCoreFields {
  gender?: string;
  dob?: string;
  familyUniqueNumber?: string;
  oldAdmissionNumber?: string;
  communicationPreference?: string;
  houseId?: string | null;
  // extended demographics
  studentEmail?: string;
  studentMobile?: string;
  studentWhatsapp?: string;
  categoryCode?: string;
  nationalityCode?: string;
  motherTongueCode?: string;
  bloodGroupCode?: string;
  aadhaarNumber?: string;
  previousSchool?: string;
  // lifecycle
  admissionDate?: string;
  withdrawalDate?: string;
  withdrawalRemarks?: string;
}

export interface CreateStudentRequest extends StudentCoreFields {
  name: string;
  admissionNumber: string;
  // Optional initial enrollment
  academicYearId?: string;
  classId?: string;
  streamCode?: string;
  rollNumber?: number;
  joinDate?: string;
  // Optional inline guardians / addresses
  guardians?: CreateGuardianRequest[];
  addresses?: CreateAddressRequest[];
}

export interface UpdateStudentRequest extends StudentCoreFields {
  name?: string;
  admissionNumber?: string;
  status?: string;
  // Stream for the student's current enrollment (applied to the latest student_class row).
  streamCode?: string;
}

export interface StudentDetail {
  uuid: string;
  admissionNumber?: string;
  name: string;
  gender?: string;
  dob?: string;
  familyUniqueNumber?: string;
  communicationPreference?: string;
  oldAdmissionNumber?: string;
  status: string;
  schoolId: string;
  houseId?: string;
  houseName?: string;
  houseColor?: string;
  // extended demographics
  studentEmail?: string;
  studentMobile?: string;
  studentWhatsapp?: string;
  categoryCode?: string;
  nationalityCode?: string;
  motherTongueCode?: string;
  bloodGroupCode?: string;
  aadhaarNumber?: string;
  previousSchool?: string;
  admissionDate?: string;
  withdrawalDate?: string;
  withdrawalRemarks?: string;
  currentAcademicYearId?: string;
  currentAcademicYearName?: string;
  currentClassId?: string;
  currentClassName?: string;
  currentStreamCode?: string;
  currentStreamName?: string; // class_stream display name (e.g. Science) for currentStreamCode
  currentEffectiveClassId?: string; // stream-specific class (base when no stream); for timetable/syllabus
  currentRollNumber?: number;
  classTeacher?: ClassTeacherRef | null;
  guardians: Guardian[];
  enrollments: EnrollmentRow[];
  addresses: StudentAddress[];
  siblings: SiblingRef[];
  photoId?: string;
  photoThumbId?: string;
}

// Class teacher of the student's current class, resolved from the timetable
// module's class_teacher link. `subjects` is a comma-joined list of the subject(s)
// that teacher teaches this class (from teaching_assignment), or null.
export interface ClassTeacherRef {
  name: string;
  mobile?: string | null;
  whatsapp?: string | null;
  subjects?: string | null;
}

export interface EnrollmentRow {
  uuid: string;
  studentId?: string; // the student record this year lives under (differs for 'historical' prev-admission years)
  academicYearId?: string;
  academicYearName?: string;
  classId?: string;
  className?: string;
  streamCode?: string;
  streamName?: string;
  rollNumber?: number;
  joinDate?: string;
  status?: string;
  kind?: 'current' | 'historical' | 'gap'; // set when the history is a merged re-admission timeline
}

// ---- Addresses ----

export interface StudentAddress {
  uuid: string;
  studentId: string;
  schoolId: string;
  isPermanent?: boolean;
  isCommunication?: boolean;
  line?: string;
  localityCode?: string;
  cityCode?: string;
  stateCode?: string;
  countryCode?: string;
  pincode?: string;
  status: string;
}

export interface CreateAddressRequest {
  isPermanent?: boolean;
  isCommunication?: boolean;
  line?: string;
  localityCode?: string;
  cityCode?: string;
  stateCode?: string;
  countryCode?: string;
  pincode?: string;
}

export interface UpdateAddressRequest extends Partial<CreateAddressRequest> {}

// ---- Siblings ----

export interface SiblingRef {
  uuid: string;            // student_sibling row uuid
  siblingStudentId: string;
  admissionNumber?: string;
  name?: string;
  className?: string;
}

// ---- Lookups ----

export interface StudentLookup {
  uuid: string;
  schoolId: string;
  lookupType: string;
  code: string;
  label?: string;
  extra?: any;
  status: string;
}

export interface CreateLookupRequest {
  lookupType: string;
  code: string;
  label?: string;
  extra?: any;
}

export interface UpdateLookupRequest {
  label?: string;
  extra?: any;
}

// ---- Guardians ----

export interface Guardian {
  uuid: string;
  studentId: string;
  schoolId: string;
  relation: string;
  relationship?: string;
  name?: string;
  occupation?: string;
  designation?: string;
  organisation?: string;
  education?: string;
  address?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  isPrimaryContact?: boolean;
  status: string;
  photoId?: string;
  photoThumbId?: string;
}

export interface CreateGuardianRequest {
  relation: string;
  relationship?: string;
  name?: string;
  occupation?: string;
  designation?: string;
  organisation?: string;
  education?: string;
  address?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  isPrimaryContact?: boolean;
}

export interface UpdateGuardianRequest extends Partial<CreateGuardianRequest> {}

// ---- Houses ----

export interface House {
  uuid: string;
  schoolId: string;
  name: string;
  code: string;
  color?: string;
  status: string;
}

export interface CreateHouseRequest {
  name: string;
  code?: string;
  color?: string;
}

export interface UpdateHouseRequest {
  name?: string;
  color?: string;
}

// ---- House staff (in-charge / co-in-charge / member teachers) ----
export type HouseTeacherRole = 'incharge' | 'coincharge' | 'member';

export interface HouseTeacher {
  uuid: string;
  houseId: string;
  employeeId: string;
  employeeName?: string;
  role: HouseTeacherRole;
}

export interface HouseTeacherInput {
  employeeId: string;
  role: HouseTeacherRole;
}

export interface SetHouseTeachersRequest {
  teachers: HouseTeacherInput[];
}

// ---- Photos ----

export interface UploadPhotoRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
  variant?: string; // 'original' (default) | 'thumb'
}

// ---- Promotion lifecycle ----

export interface PromoteItem {
  studentId: string;
  toClassId: string;
  rollNumber?: number;
}

export interface PromoteRequest {
  academicYearFromId: string;
  academicYearToId: string;
  items: PromoteItem[];
}

export interface PromoteClassRequest {
  fromClassId: string;
  academicYearFromId: string;
  toClassId: string;
  academicYearToId: string;
  excludeStudentIds?: string[];
}

export interface GraduateRequest {
  academicYearFromId: string;
  studentIds: string[];
}

export interface PromotionResultRow {
  studentId: string;
  outcome: 'done' | 'skipped';
  reason?: string;
}

export interface PromotionResult {
  done: number;
  skipped: number;
  results: PromotionResultRow[];
}
