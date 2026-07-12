export interface StudentTc {
  uuid: string;
  schoolId: string;
  studentId: string;
  applicationDate?: string;
  srnNumber?: string;
  issueDate?: string;
  reasonForLeaving?: string;
  totalAttendanceDays?: number;
  totalWorkingDays?: number;
  status: string;
}

export interface CreateTcRequest {
  applicationDate?: string;
  srnNumber?: string;
  issueDate?: string;
  reasonForLeaving?: string;
  totalAttendanceDays?: number;
  totalWorkingDays?: number;
  status?: string; // defaults to 'applied'
}

export interface UpdateTcRequest extends Partial<CreateTcRequest> {
  // When status transitions to 'issued', the student is withdrawn
  // (student.status -> inactive, withdrawal_date set).
  withdrawalDate?: string;
  withdrawalRemarks?: string;
}
