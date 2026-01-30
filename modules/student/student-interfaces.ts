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
