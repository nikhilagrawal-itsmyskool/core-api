import { DB, singleLineString } from '../../shared/lib/db';
import { AcademicYearDropdownItem } from './academic-year-interfaces';

class AcademicYearService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async search(schoolId: string): Promise<AcademicYearDropdownItem[]> {
    // `isCurrent` marks the canonical "current" session: the year whose date
    // range contains today, falling back to the latest-starting year when today
    // sits in a gap between sessions. Search UIs pin their default to this row.
    const query = singleLineString`
      with picked as (
        select uuid from academic_year
        where school_id = $1
        order by
          (case when current_date between start_date and end_date then 0 else 1 end),
          start_date desc nulls last
        limit 1
      )
      select ay.uuid, ay.name,
             (ay.uuid = (select uuid from picked)) as is_current
      from academic_year ay
      where ay.school_id = $1
      order by ay.start_date desc nulls last
    `;

    return DB.query(query, [schoolId]);
  }
}

export const academicYearService = new AcademicYearService();
