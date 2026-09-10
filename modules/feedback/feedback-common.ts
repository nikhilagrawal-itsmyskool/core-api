import { DB, singleLineString } from "../../shared/lib/db";
import { REVIEWER_ROLE_CODES } from "./feedback-constants";

// Shared cross-entity lookups (no FKs — validated in app code). Mirrors the small
// helpers leave/homework use so the feedback module stays self-contained.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// "Current" academic year = the year whose date range contains today, else the
// latest-starting year.
export async function getCurrentAcademicYearId(schoolId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from academic_year where school_id = $1
      order by (case when current_date between start_date and end_date then 0 else 1 end),
               start_date desc nulls last
      limit 1`,
    [schoolId],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// An active employee by uuid, or null.
export async function findEmployee(
  schoolId: string,
  employeeId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// A student by uuid, or null.
export async function findStudent(
  schoolId: string,
  studentId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from student where uuid = $1 and school_id = $2`,
    [studentId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// Employee ids holding a reviewer role (the "education director" — god for now). Used
// as the notification audience when a teacher responds. Best-effort: wrapped so a
// missing role table never breaks the flow.
export async function reviewerEmployeeIds(schoolId: string): Promise<string[]> {
  try {
    const codes = REVIEWER_ROLE_CODES as readonly string[];
    const rows = await DB.query(
      singleLineString`select distinct er.employee_id from employee_role er
        join role r on r.uuid = er.role_id
        where er.school_id = $1 and lower(r.code) = any($2)`,
      [schoolId, codes.map((c) => c.toLowerCase())],
    );
    return rows.map((r: any) => r.employeeId).filter(Boolean);
  } catch {
    return [];
  }
}
