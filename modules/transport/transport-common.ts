import { DB, singleLineString } from '../../shared/lib/db';

// Shared helpers used across the transport services: school resolution,
// cross-entity existence checks (no FKs — validated in app code), and
// name resolution for denormalized display.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return results.length > 0 ? results[0].uuid : null;
}

// Returns the row if an active employee exists in this school, else null.
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

export async function academicYearExists(schoolId: string, academicYearId: string): Promise<boolean> {
  const rows = await DB.query(
    singleLineString`select 1 from academic_year where uuid = $1 and school_id = $2`,
    [academicYearId, schoolId],
  );
  return rows.length > 0;
}

// Resolve a set of employee ids -> { id: name } for denormalized display.
export async function resolveEmployeeNames(schoolId: string, ids: (string | undefined | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 2}`).join(', ');
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where school_id = $1 and uuid in (${placeholders})`,
    [schoolId, ...unique],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.uuid] = r.name;
  return map;
}
