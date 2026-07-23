import { DB, singleLineString } from '../../shared/lib/db';
import { ClassDropdownItem } from './class-interfaces';

class ClassService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  // Class dropdown search.
  //   - Cohort/composite classes (class.class_group_id set, created for timetable
  //     co-scheduling) are hidden unless includeCohort is set.
  //   - When academicYearId is given, restricts to that session's classes. A "real"
  //     class belongs to the year if it has active student enrolment that year (the
  //     same rule as class-strength); a cohort class belongs to the year via its
  //     class_group's academic_year_id (cohort classes carry no enrolment).
  public async search(schoolId: string, name?: string, academicYearId?: string, includeCohort = false): Promise<ClassDropdownItem[]> {
    const searchPattern = name && name.trim() ? `%${name.trim()}%` : '%';
    const params: any[] = [schoolId, searchPattern];
    const conds: string[] = [`c.school_id = $1`, `lower(c.name) like lower($2)`];

    if (academicYearId) {
      params.push(academicYearId);
      const ay = `$${params.length}`;
      const realInYear = singleLineString`
        c.class_group_id is null and exists (
          select 1 from student_class sc
          join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status <> 'deleted'
          where sc.class_id = c.uuid and sc.school_id = c.school_id and sc.academic_year_id = ${ay}
            and (sc.status is null or sc.status <> 'deleted')
        )`;
      if (includeCohort) {
        const cohortInYear = singleLineString`
          c.class_group_id is not null and exists (
            select 1 from class_group cg
            where cg.uuid = c.class_group_id and cg.school_id = c.school_id and cg.academic_year_id = ${ay} and cg.status = 'active'
          )`;
        conds.push(`((${realInYear}) or (${cohortInYear}))`);
      } else {
        conds.push(`(${realInYear})`);
      }
    } else if (!includeCohort) {
      conds.push(`c.class_group_id is null`);
    }

    const query = singleLineString`
      select c.uuid, c.name, c.code, c.seq from class c
      where ${conds.join(' and ')}
      order by c.seq asc nulls last, c.name
    `;
    return DB.query(query, params);
  }
}

export const classService = new ClassService();
