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
  //   - A "real"/pickable class is one that is NOT a stream child, i.e. class.base_class_id
  //     is null. Stream-child rows (e.g. XI-A's SCI/COM splits, base_class_id set) are hidden.
  //   - includeCohort additionally surfaces timetable cohort/composite classes (class_group_id
  //     set) — that branch still keys on class_group_id, which the timetable module owns.
  //   - When academicYearId is given, restricts to that session's classes. A real class
  //     belongs to the year if it has active student enrolment that year (the same rule as
  //     class-strength); a cohort class belongs to the year via its class_group's
  //     academic_year_id (cohort classes carry no enrolment).
  public async search(schoolId: string, name?: string, academicYearId?: string, includeCohort = false): Promise<ClassDropdownItem[]> {
    const searchPattern = name && name.trim() ? `%${name.trim()}%` : '%';
    const params: any[] = [schoolId, searchPattern];
    const conds: string[] = [`c.school_id = $1`, `lower(c.name) like lower($2)`];

    if (academicYearId) {
      params.push(academicYearId);
      const ay = `$${params.length}`;
      const realInYear = singleLineString`
        c.base_class_id is null and exists (
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
      conds.push(`c.base_class_id is null`);
    }

    const query = singleLineString`
      select c.uuid, c.name, c.code, c.seq from class c
      where ${conds.join(' and ')}
      order by c.seq asc nulls last, c.name
    `;
    return DB.query(query, params);
  }

  // Streams offered under a base class — the stream-child class rows (base_class_id set)
  // resolved to their stream code + display name (from the class_stream lookup). Empty
  // when the class has no streams. Drives the stream picker on student admission/edit.
  public async getStreams(schoolId: string, baseClassId: string): Promise<{ code: string; name: string }[]> {
    const query = singleLineString`
      select c.stream_code as code, coalesce(cs.name, c.stream_code) as name
      from class c
      left join class_stream cs
        on cs.school_id = c.school_id and lower(cs.code) = lower(c.stream_code) and cs.status = 'active'
      where c.school_id = $1 and c.base_class_id = $2 and c.stream_code is not null
      order by cs.seq asc nulls last, c.stream_code
    `;
    return DB.query(query, [schoolId, baseClassId]);
  }
}

export const classService = new ClassService();
