export interface StudentTc {
  uuid: string;
  schoolId: string;
  studentId: string;
  applicationDate?: string;
  srnNumber?: string;
  tcNumber?: string;
  bookNo?: string;
  issueDate?: string;
  reasonForLeaving?: string;
  result?: string;
  failedInClass?: string;
  subjectsStudied?: string;
  qualifiedForPromotion?: string;
  duesPaidUpto?: string;
  feeConcession?: string;
  nccScoutGuide?: string;
  gamesActivities?: string;
  generalConduct?: string;
  remarks?: string;
  totalAttendanceDays?: number;
  totalWorkingDays?: number;
  status: string;
  printedAt?: string;
  printCount?: number;
  // Identity overrides (stored only when filled/corrected; else derived live).
  motherName?: string;
  fatherName?: string;
  dob?: string;
  nationality?: string;
  category?: string;
  firstAdmissionDate?: string;
}

// All TC-specific editable fields the form submits. Identity fields (name, parents,
// DOB, class, etc.) are NOT here — they derive live from the student record at print.
export interface CreateTcRequest {
  applicationDate?: string;
  srnNumber?: string;
  tcNumber?: string;
  bookNo?: string;
  issueDate?: string;
  reasonForLeaving?: string;
  result?: string;
  failedInClass?: string;
  subjectsStudied?: string;
  qualifiedForPromotion?: string;
  duesPaidUpto?: string;
  feeConcession?: string;
  nccScoutGuide?: string;
  gamesActivities?: string;
  generalConduct?: string;
  remarks?: string;
  totalAttendanceDays?: number;
  totalWorkingDays?: number;
  // Identity overrides (optional; filled when the student record is sparse).
  motherName?: string;
  fatherName?: string;
  dob?: string;
  nationality?: string;
  category?: string;
  firstAdmissionDate?: string;
  status?: string; // defaults to 'applied'
  // When status transitions to 'issued' and dues are outstanding, a caller holding
  // transfer.dues.override may force the issue by passing overrideDues: true.
  overrideDues?: boolean;
}

export interface UpdateTcRequest extends Partial<CreateTcRequest> {
  // When status transitions to 'issued', the student is withdrawn
  // (student.status -> inactive, withdrawal_date set).
  withdrawalDate?: string;
  withdrawalRemarks?: string;
}

// Per-school TC configuration (resolved = row merged over factory defaults).
export interface TransferConfig {
  duesGateMode: string; // block | warn | off
  tcBookNo: string;
  srnPrefix: string;
  tcNumberPrefix: string;
  defaultResult: string;
  defaultConduct: string;
  defaultPromotion: string;
  defaultFailed: string;
  defaultDuesPaidUpto: string;
  defaultNcc: string;
  resultOptions: string[];
  conductOptions: string[];
  autoDeriveSubjects: boolean;
}

// Values derived live from the student record (never stored on the TC).
export interface DerivedStudent {
  name: string;
  admissionNumber: string | null;
  dob: string | null; // YYYY-MM-DD
  dobInWords: string | null;
  fatherName: string | null;
  motherName: string | null;
  nationality: string | null;
  category: string | null;
  admissionDate: string | null; // first admission
  classFigures: string | null; // class.code e.g. "X"
  classWords: string | null; // class.name e.g. "TENTH A"
  academicYearId: string | null;
  classId: string | null;
}
