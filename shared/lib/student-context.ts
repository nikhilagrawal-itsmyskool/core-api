import { DB, singleLineString } from './db';

// The parent app's `/…/me` endpoints act on the family's active child (the
// X-Student-Id already authorized by resolveActiveStudent). Most of them need
// that child's *current* class + academic year — the same latest-enrollment
// lateral join used by student-admin-service.getDetail and the family login.
// Factored here so every module resolves it identically.

export interface StudentEnrollment {
  studentId: string;
  academicYearId: string | null;
  academicYearName: string | null;
  classId: string | null;
  className: string | null;
  rollNumber: number | null;
}

// Current enrollment for a student, or null when the student doesn't exist in the
// school (or is deleted). classId/academicYearId are null when the student exists
// but has no active enrollment yet.
export async function resolveStudentEnrollment(
  schoolId: string,
  studentId: string,
): Promise<StudentEnrollment | null> {
  const rows = await DB.query(
    singleLineString`
      select
        s.uuid as student_id,
        cur.academic_year_id, cur.academic_year_name,
        cur.class_id, cur.class_name, cur.roll_number
      from student s
      left join lateral (
        select sc.academic_year_id, ay.name as academic_year_name,
               sc.class_id, c.name as class_name, sc.roll_number
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        left join class c on sc.class_id = c.uuid
        where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last limit 1
      ) cur on true
      where s.uuid = $1 and s.school_id = $2 and (s.status is null or s.status <> 'deleted')
    `,
    [studentId, schoolId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    studentId: r.studentId,
    academicYearId: r.academicYearId ?? null,
    academicYearName: r.academicYearName ?? null,
    classId: r.classId ?? null,
    className: r.className ?? null,
    rollNumber: r.rollNumber ?? null,
  };
}
