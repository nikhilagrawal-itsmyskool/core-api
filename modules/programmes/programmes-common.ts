import { DB, singleLineString } from "../../shared/lib/db";

// Shared helpers across the programmes services: school resolution and
// cross-entity lookups (no FKs — validated in app code). Mirrors syllabus-common.

export async function getSchoolIdByCode(
  schoolCode: string,
): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return results.length > 0 ? results[0].uuid : null;
}

export async function academicYearExists(
  schoolId: string,
  academicYearId: string,
): Promise<boolean> {
  const rows = await DB.query(
    singleLineString`select 1 from academic_year where uuid = $1 and school_id = $2`,
    [academicYearId, schoolId],
  );
  return rows.length > 0;
}

// The school's current academic year uuid, or null. "Current" = the year whose
// date range contains today, else the latest-starting year.
export async function getCurrentAcademicYearId(
  schoolId: string,
): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`
      select uuid from academic_year
      where school_id = $1
      order by (case when current_date between start_date and end_date then 0 else 1 end),
               start_date desc nulls last
      limit 1
    `,
    [schoolId],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// The real teaching sections only — base classes (base_class_id is null),
// excluding stream-child rows and composite cohorts. Grades derive from these.
export async function listBaseClasses(
  schoolId: string,
): Promise<{ uuid: string; name: string; seq: number | null }[]> {
  return DB.query(
    singleLineString`
      select uuid, name, seq from class
      where school_id = $1 and base_class_id is null
      order by seq asc nulls last, name
    `,
    [schoolId],
  );
}
