import { DB, singleLineString } from "../../shared/lib/db";

// Shared cross-entity lookups (no FKs — validated in app code). Mirrors the small
// helpers the syllabus module uses so the homework module stays self-contained.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// "Current" academic year = the year whose date range contains today, else the
// latest-starting year. Defaults the class-teacher resolution + student view.
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

// A class homework can be posted for: a real base teaching class (no streams) OR a
// stream-child class (e.g. "XI-A (Science)"). Cohort/composite rows (class_group_id)
// are rejected. Streamed senior sections post per stream — the stream-child class is
// the unit, since the timetable class_teacher and the students' stream both live there.
export async function findPostableClass(
  schoolId: string,
  classId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from class
      where uuid = $1 and school_id = $2
        and (stream_code is not null or (base_class_id is null and class_group_id is null))`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// A class name by uuid (works for base or stream-child rows), or null.
export async function findClassName(schoolId: string, classId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select name from class where uuid = $1 and school_id = $2`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0].name : null;
}

// An active employee (teacher) by uuid, or null.
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
