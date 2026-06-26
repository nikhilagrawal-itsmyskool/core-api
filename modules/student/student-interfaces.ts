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

export interface CreateStudentRequest {
  name: string;
  admissionNumber: string;
  gender?: string;
  dob?: string;
  familyUniqueNumber?: string;
  oldAdmissionNumber?: string;
  communicationPreference?: string;
  houseId?: string;
  // Optional initial enrollment
  academicYearId?: string;
  classId?: string;
  rollNumber?: number;
  // Optional inline guardians
  guardians?: CreateGuardianRequest[];
}

export interface UpdateStudentRequest {
  name?: string;
  admissionNumber?: string;
  gender?: string;
  dob?: string;
  familyUniqueNumber?: string;
  oldAdmissionNumber?: string;
  communicationPreference?: string;
  houseId?: string | null;
  status?: string;
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
  currentAcademicYearId?: string;
  currentAcademicYearName?: string;
  currentClassId?: string;
  currentClassName?: string;
  currentRollNumber?: number;
  guardians: Guardian[];
  enrollments: EnrollmentRow[];
  photoId?: string;
}

export interface EnrollmentRow {
  uuid: string;
  academicYearId?: string;
  academicYearName?: string;
  classId?: string;
  className?: string;
  rollNumber?: number;
  status?: string;
}

// ---- Guardians ----

export interface Guardian {
  uuid: string;
  studentId: string;
  schoolId: string;
  relation: string;
  name?: string;
  occupation?: string;
  address?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  isPrimaryContact?: boolean;
  status: string;
  photoId?: string;
}

export interface CreateGuardianRequest {
  relation: string;
  name?: string;
  occupation?: string;
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

// ---- Photos ----

export interface UploadPhotoRequest {
  fileName: string;
  mimeType: string;
  base64Data: string;
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
