import { DB, singleLineString } from '../../shared/lib/db';

// Shared cross-entity lookups (no FKs — validated in app code), mirroring the small
// helpers leave/homework/syllabus use so the module stays self-contained.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// An active employee by uuid (scoped to school), or null.
export async function findEmployee(
  schoolId: string,
  employeeId: string,
): Promise<{ uuid: string; name: string; deviceNumber: string | null; employeeNumber: string | null; code: string | null } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name, device_number, employee_number, code from employee
      where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// A valid device PIN is numeric and short enough for the firmware (<= 9 digits).
export function isValidDevicePin(value: string | null | undefined): boolean {
  return !!value && /^[0-9]{1,9}$/.test(value.trim());
}

// The registered device for a serial number, or null (the SN allowlist lookup).
export async function findDeviceBySn(serialNumber: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select * from biometric_device where serial_number = $1`,
    [serialNumber],
  );
  return rows.length > 0 ? rows[0] : null;
}

// Active devices for a school (sync targets).
export async function activeDevicesForSchool(schoolId: string): Promise<any[]> {
  return DB.query(
    singleLineString`select * from biometric_device where school_id = $1 and status = 'active' order by created_at`,
    [schoolId],
  );
}

// The employee whose device_number matches `pin` in this school, or null. Used to
// attribute an incoming punch/enrolment to a person.
export async function employeeByDeviceNumber(
  schoolId: string,
  pin: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from employee
      where school_id = $1 and device_number = $2 and status <> 'deleted' limit 1`,
    [schoolId, pin],
  );
  return rows.length > 0 ? rows[0] : null;
}

// First device number used for auto-assignment. Kept clear of the small PINs an admin
// may have hand-enrolled on the keypad (the super admin was PIN 1).
const DEVICE_NUMBER_BASE = 1000;

// Next free numeric device_number for a school: max(existing, BASE) + 1. Numeric only.
export async function nextDeviceNumber(schoolId: string): Promise<string> {
  const rows = await DB.query(
    singleLineString`select coalesce(max(device_number::int), $2) as m from employee
      where school_id = $1 and device_number ~ '^[0-9]+$'`,
    [schoolId, DEVICE_NUMBER_BASE],
  );
  const max = rows.length ? Number(rows[0].m) : DEVICE_NUMBER_BASE;
  return String(Math.max(max, DEVICE_NUMBER_BASE) + 1);
}
