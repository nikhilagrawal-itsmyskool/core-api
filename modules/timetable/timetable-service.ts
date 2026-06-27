import { DB, singleLineString } from '../../shared/lib/db';

// Shared helpers for the timetable module: school resolution and light
// application-level reference checks (no FKs in the schema, per conventions).
class TimetableService {
  // Resolve a school's internal uuid from its public code.
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const results = await DB.query(
      singleLineString`select uuid from school where lower(code) = lower($1)`,
      [schoolCode],
    );
    return results.length > 0 ? results[0].uuid : null;
  }

  // Does a class exist for this school? (class is a core table: name + code + school_id)
  public async classExists(classId: string, schoolId: string): Promise<boolean> {
    const results = await DB.query(
      singleLineString`select 1 from class where uuid = $1 and school_id = $2 limit 1`,
      [classId, schoolId],
    );
    return results.length > 0;
  }

  // Does an active subject exist for this school?
  public async subjectExists(subjectId: string, schoolId: string): Promise<boolean> {
    const results = await DB.query(
      singleLineString`select 1 from subject where uuid = $1 and school_id = $2 and status = 'active' limit 1`,
      [subjectId, schoolId],
    );
    return results.length > 0;
  }

  // Does an active class group (cohort) exist for this school?
  public async classGroupExists(classGroupId: string, schoolId: string): Promise<boolean> {
    const results = await DB.query(
      singleLineString`select 1 from class_group where uuid = $1 and school_id = $2 and status = 'active' limit 1`,
      [classGroupId, schoolId],
    );
    return results.length > 0;
  }
}

export const timetableService = new TimetableService();
