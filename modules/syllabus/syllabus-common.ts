import { DB, singleLineString } from "../../shared/lib/db";

// Shared helpers across the syllabus services: school resolution and
// cross-entity existence/name lookups (no FKs — validated in app code).

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
// date range contains today, else the latest-starting year (mirrors the
// academic-year module's isCurrent rule). Used to default the student timeline
// when the app doesn't pass an academicYearId.
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

// All active classes (sections) in a school with their names, for grade
// derivation and dropdowns.
export async function listClasses(
  schoolId: string,
): Promise<{ uuid: string; name: string; seq: number | null }[]> {
  return DB.query(
    singleLineString`select uuid, name, seq from class where school_id = $1 order by seq asc nulls last, name`,
    [schoolId],
  );
}

// A single class (section) by uuid, or null.
export async function findClass(
  schoolId: string,
  classId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from class where uuid = $1 and school_id = $2`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// An active employee (teacher) by uuid, or null.
export async function findEmployee(
  schoolId: string,
  employeeId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where uuid = $1 and school_id = $2 and status != 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// The section a student is placed in for a given academic year, or null.
export async function findStudentClass(
  schoolId: string,
  studentId: string,
  academicYearId: string,
): Promise<{ classId: string; className: string } | null> {
  const rows = await DB.query(
    singleLineString`
      select sc.class_id as class_id, c.name as class_name
      from student_class sc
      join class c on c.uuid = sc.class_id
      where sc.student_id = $1 and sc.academic_year_id = $2 and sc.school_id = $3
      limit 1
    `,
    [studentId, academicYearId, schoolId],
  );
  return rows.length > 0
    ? { classId: rows[0].classId, className: rows[0].className }
    : null;
}

// Resolve a set of employee ids -> { id: name } for denormalized display.
export async function resolveEmployeeNames(
  schoolId: string,
  ids: (string | undefined | null)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 2}`).join(", ");
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where school_id = $1 and uuid in (${placeholders})`,
    [schoolId, ...unique],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.uuid] = r.name;
  return map;
}
