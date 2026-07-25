import { DB, singleLineString } from './db';

// The effective (stream-specific) class a student belongs to for a given academic year.
//   - classId:    the class uuid to use downstream (syllabus timeline, timetable, etc.)
//   - streamCode: the student's enrolment stream (SCI / COM), or null
//   - isStream:   true when classId resolved to a stream-child row; false when it fell
//                 back to the base enrolment class
export interface EffectiveClass {
  classId: string;
  streamCode: string | null;
  isStream: boolean;
}

// Map a student to their effective class for the year. A student enrols into the BASE
// class (student_class.class_id) and carries an optional stream_code. When a stream is set
// and a stream-child class exists (class.base_class_id = the enrolment class_id, matching
// stream_code), the child class is the effective one (its own timetable / stream syllabus);
// otherwise we fall back to the enrolment class itself. Returns null if the student has no
// active enrolment for the year.
//
// Shared so the syllabus and timetable student read surfaces resolve streams identically.
export async function resolveEffectiveClassId(
  schoolId: string,
  studentId: string,
  academicYearId: string
): Promise<EffectiveClass | null> {
  const enrolmentQuery = singleLineString`
    select sc.class_id, sc.stream_code
    from student_class sc
    where sc.student_id = $1 and sc.academic_year_id = $2 and sc.school_id = $3
      and (sc.status is null or sc.status <> 'deleted')
    limit 1
  `;
  const enrolments = await DB.query(enrolmentQuery, [studentId, academicYearId, schoolId]);
  if (enrolments.length === 0) {
    return null;
  }

  const { classId, streamCode } = enrolments[0];
  if (!streamCode) {
    return { classId, streamCode: null, isStream: false };
  }

  const streamClassQuery = singleLineString`
    select c.uuid
    from class c
    where c.school_id = $1 and c.base_class_id = $2 and lower(c.stream_code) = lower($3)
    limit 1
  `;
  const streamClasses = await DB.query(streamClassQuery, [schoolId, classId, streamCode]);
  if (streamClasses.length > 0) {
    return { classId: streamClasses[0].uuid, streamCode, isStream: true };
  }

  return { classId, streamCode, isStream: false };
}
