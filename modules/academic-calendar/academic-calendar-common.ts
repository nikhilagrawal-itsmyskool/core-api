import { DB, singleLineString } from "../../shared/lib/db";

// Shared cross-entity lookups (no FKs — validated in app code). Mirrors the small
// helpers the homework/syllabus modules use so this module stays self-contained.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// "Current" academic year = the year whose date range contains today, else the
// latest-starting year. Defaults the calendar scope when the caller omits it.
export async function getCurrentAcademicYearId(schoolId: string): Promise<string | null> {
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(d: string | undefined | null): boolean {
  return !!d && DATE_RE.test(d);
}
