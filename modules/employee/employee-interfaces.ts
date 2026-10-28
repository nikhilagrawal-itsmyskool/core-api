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
  deviceNumber?: string; // numeric PIN on biometric/attendance devices (see biometric module)
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
  deviceNumber?: string;
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
  deviceNumber?: string;
  gender?: string;
  dob?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  roleIds?: string[];
  loginDisabled?: boolean; // true = inactive (login blocked); false = active
}

export interface UploadPhotoRequest {
  fileName?: string;
  mimeType: string;
  base64Data: string;
  variant?: string; // 'original' | 'thumb'
}

export interface EmployeeCredentials {
  username: string;
  password: string;
  mustChangePassword: boolean;
  displayName: string;
}
