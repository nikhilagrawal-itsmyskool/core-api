import { DB, singleLineString } from '../../shared/lib/db';

// Shared helpers used across the assembly services: school resolution,
// cross-entity existence checks (no FKs — validated in app code), and
// name resolution for denormalized display of responsible parties.

// True only for a real yyyy-mm-dd calendar date (rejects e.g. 2026-13-40).
export function isValidDate(s: string | undefined | null): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return results.length > 0 ? results[0].uuid : null;
}

export async function academicYearExists(schoolId: string, academicYearId: string): Promise<boolean> {
  const rows = await DB.query(
    singleLineString`select 1 from academic_year where uuid = $1 and school_id = $2`,
    [academicYearId, schoolId],
  );
  return rows.length > 0;
}

export async function findClass(schoolId: string, classId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from class where uuid = $1 and school_id = $2`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function findEmployee(schoolId: string, employeeId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where uuid = $1 and school_id = $2 and status != 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function findStudent(schoolId: string, studentId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from student where uuid = $1 and school_id = $2 and status = 'active'`,
    [studentId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// Resolve a set of ids of one entity type -> { id: name } for denormalized display.
async function resolveNames(schoolId: string, table: string, ids: (string | undefined | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 2}`).join(', ');
  const rows = await DB.query(
    singleLineString`select uuid, name from ${table} where school_id = $1 and uuid in (${placeholders})`,
    [schoolId, ...unique],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.uuid] = r.name;
  return map;
}

export const resolveEmployeeNames = (schoolId: string, ids: (string | undefined | null)[]) =>
  resolveNames(schoolId, 'employee', ids);
export const resolveClassNames = (schoolId: string, ids: (string | undefined | null)[]) =>
  resolveNames(schoolId, 'class', ids);
export const resolveStudentNames = (schoolId: string, ids: (string | undefined | null)[]) =>
  resolveNames(schoolId, 'student', ids);
