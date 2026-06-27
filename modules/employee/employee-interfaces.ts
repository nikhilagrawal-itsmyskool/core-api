export interface EmployeeRole {
  uuid: string;
  code: string;
  name: string;
}

export interface Employee {
  uuid: string;
  employeeNumber?: string;
  name: string;
  code?: string; // short teacher code (e.g. "NKG") for the master timetable
  gender?: string;
  dob?: string;
  familyUniqueNumber: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  status: string;
  schoolId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EmployeeWithRoles extends Employee {
  roles: EmployeeRole[];
}

export interface CreateEmployeeRequest {
  name: string;
  familyUniqueNumber: string;
  employeeNumber?: string;
  code?: string;
  gender?: string;
  dob?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  roleIds?: string[];
}

export interface UpdateEmployeeRequest {
  name?: string;
  familyUniqueNumber?: string;
  employeeNumber?: string;
  code?: string;
  gender?: string;
  dob?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  roleIds?: string[];
}

export interface EmployeeCredentials {
  username: string;
  password: string;
  mustChangePassword: boolean;
  displayName: string;
}
