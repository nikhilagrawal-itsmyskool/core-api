import { DB, singleLineString } from '../../shared/lib/db';

// School resolution + cross-entity checks (no FKs — validated in app code).
export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode]
  );
  return results.length > 0 ? results[0].uuid : null;
}

export async function findStudent(schoolId: string, studentId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name, status from student where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [studentId, schoolId]
  );
  return rows.length > 0 ? rows[0] : null;
}
