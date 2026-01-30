export interface Employee {
  uuid: string;
  name: string;
  email?: string;
  phone?: string;
  designation?: string;
  status: string;
  schoolId: string;
  createdAt?: Date;
  updatedAt?: Date;
}
