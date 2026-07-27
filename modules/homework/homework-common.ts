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

// The BASE section a student is placed in for a given academic year, or null.
// Homework is keyed on the base class (class_id), so streams share one set.
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
        and (sc.status is null or sc.status <> 'deleted')
      limit 1
    `,
    [studentId, academicYearId, schoolId],
  );
  return rows.length > 0 ? { classId: rows[0].classId, className: rows[0].className } : null;
}

// A base class (section) by uuid, or null. base_class_id is null = a real section
// (excludes stream-child rows like "XI-A (Science)").
export async function findBaseClass(
  schoolId: string,
  classId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from class where uuid = $1 and school_id = $2 and base_class_id is null`,
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
    singleLineString`select uuid, name from employee where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}
