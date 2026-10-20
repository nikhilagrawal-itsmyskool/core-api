import { DB, singleLineString } from "../../shared/lib/db";

// Shared cross-entity lookups (no FKs — validated in app code). Mirrors the small helpers
// the homework/syllabus modules use so the outreach module stays self-contained.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// Reverse of the above — the publish path needs the X-School-Code to call the
// communication module, but the teacher /me surface only carries the school uuid.
export async function getSchoolCodeById(schoolId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select code from school where uuid = $1`,
    [schoolId],
  );
  return rows.length > 0 ? rows[0].code : null;
}

// "Current" academic year = the year whose date range contains today, else the
// latest-starting year.
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

// Grade label = the class-name prefix before the first hyphen ("I-A" -> "I",
// "Nursery" -> "Nursery"). Mirrors examination-common.gradeOf (first-hyphen split).
export function gradeOf(className: string): string {
  if (!className) return "";
  const i = className.indexOf("-");
  return (i === -1 ? className : className.slice(0, i)).trim();
}

// A real base teaching class (not a stream child, not a cohort/composite), by uuid.
export async function findBaseClass(
  schoolId: string,
  classId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from class
      where uuid = $1 and school_id = $2 and base_class_id is null and class_group_id is null`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function findClassName(schoolId: string, classId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select name from class where uuid = $1 and school_id = $2`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0].name : null;
}

export async function findEmployeeName(schoolId: string, employeeId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select name from employee where uuid = $1 and school_id = $2`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0].name : null;
}
